/**
 * roi-cohort-selector.ts
 *
 * Deterministic South Florida / five-vertical ROI cohort selector.
 *
 * Eligible unit: a canonical non-DBPR business inside the configured
 * South Florida counties, in one of the five configured canonical
 * verticals, active, not an existing customer, not synthetic/test/demo.
 *
 * Geography resolution order (fallback chain):
 *   1. business_locations.county_fips (verified)
 *   2. businesses.postal_code ZIP inference (zip_inferred)
 *   3. businesses.city city inference (city_inferred)
 *   4. unresolved (geography_unresolved → scored, not hard-excluded)
 *
 * ROI priority scoring evaluates ALL eligible businesses before applying
 * the cohort cap. There is no ID-based pre-filter before scoring.
 *
 * Score persistence uses the migration-managed cro03c_roi_candidate_scores
 * table (migration 0275). No runtime DDL.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  evaluateSouthFloridaGeography,
  CRO03A_COUNTY_FIPS,
  type GeographyEvidenceClass,
} from "../cro03a/geography";
import { businessHasDbprLineageSql } from "../dbpr";
import { classifyVertical, CLASSIFIER_VERSION, type ClassifierResult } from "./sfp-vertical-classifier";
import {
  resolveGeographyFromCandidates,
  GEOGRAPHY_RESOLVER_VERSION,
  type LocationCandidateInput,
  type GeographyResolution,
} from "./sfp-geography-resolver";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Current ROI scoring algorithm version. Bump when formula changes. */
export const ROI_SCORE_VERSION = 2 as const;

/** Default pilot verticals when system_settings key is absent. */
const DEFAULT_PILOT_VERTICAL_IDS = [
  "Med Spa",
  "Dental",
  "Auto Repair",
  "Restaurant",
  "Retail",
] as const;

// The boolean alias-map matcher formerly here (VERTICAL_ALIASES /
// verticalMatchesTargets) has been replaced by the real, versioned
// five-target classifier in ./sfp-vertical-classifier.ts, which returns a
// confidence-scored outcome (resolved_high/resolved_medium/review_required/
// not_target/unresolved) with an evidence hash instead of a plain boolean.

/** South Florida county FIPS codes. */
const SOUTH_FLORIDA_FIPS = Object.values(CRO03A_COUNTY_FIPS); // ["12011","12086","12099"]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoiCandidateScore {
  canonicalBusinessId: number;
  roiScore: number;
  scoreVersion: typeof ROI_SCORE_VERSION;
  dimensions: {
    geographyConfidence: number;
    verticalFit: number;
    activeStatus: number;
    estimatedOpportunity: number;
    multiLocationEvidence: number;
    websiteDomainConfidence: number;
    processorPaymentClues: number;
    decisionMakerEvidence: number;
    emailSourceConfidence: number;
    validationState: number;
    freshness: number;
    existingRelationshipPenalty: number;
    providerCostAlreadyIncurred: number;
  };
  /** Geography evidence class for this candidate */
  geographyClass: GeographyEvidenceClass;
  /** Source field that resolved geography */
  geographySource: "county_fips" | "zip" | "city" | "none";
  countyFips: string | null;
  vertical: string | null;
  /** Reason the candidate was included or excluded */
  dispositionReason: string;
  /** true = eligible for cohort, false = excluded */
  eligible: boolean;
  /** Full deterministic geography resolution (VFC-02): version, winning
   *  location id, evidence class, and reasons, evaluated over every
   *  business_locations row for this business. */
  geographyResolution: GeographyResolution | null;
  /** Full deterministic five-target classifier result (VFC-01). */
  classifierResult: ClassifierResult | null;
}

export interface RoiCohortSelection {
  eligible: RoiCandidateScore[];
  excluded: RoiCandidateScore[];
  verticalIds: string[];
  countyFips: string[];
  scoreVersion: typeof ROI_SCORE_VERSION;
  selectedAt: string;
  evaluated: number;
  /** Truthful funnel — counts at each exclusion stage */
  funnel: {
    totalScanned: number;
    southFlorida: number;
    outsideGeography: number;
    geographyUnresolved: number;
    inTargetVertical: number;
    verticalUnresolved: number;
    dbprExcluded: number;
    existingCustomer: number;
    testDemoInternal: number;
    suppressed: number;
    bouncedInvalidOnly: number;
    inactiveEntity: number;
    eligibleAfterExclusions: number;
  };
}

// ── Vertical ID loader ─────────────────────────────────────────────────────────

export async function loadPilotVerticalIds(): Promise<string[]> {
  try {
    const row = rows(await db.execute(sql`
      SELECT value FROM system_settings WHERE key = 'cro03c_roi_pilot_verticals' LIMIT 1
    `))[0];
    if (row?.value) {
      const raw = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      if (Array.isArray(raw) && raw.length > 0 && raw.every((v: unknown) => typeof v === "string")) {
        return raw as string[];
      }
    }
  } catch { /* fall through to default */ }
  return [...DEFAULT_PILOT_VERTICAL_IDS];
}

// ── ROI scoring ────────────────────────────────────────────────────────────────

function computeRoiScore(input: {
  geographyConfidence: number;
  verticalFit: number;
  activeStatus: number;
  estimatedOpportunity: number;
  multiLocationEvidence: number;
  websiteDomainConfidence: number;
  processorPaymentClues: number;
  decisionMakerEvidence: number;
  emailSourceConfidence: number;
  validationState: number;
  freshness: number;
  existingRelationshipPenalty: number;
  providerCostAlreadyIncurred: number;
}): number {
  const WEIGHTS = {
    geographyConfidence: 0.10,
    verticalFit: 0.12,
    activeStatus: 0.08,
    estimatedOpportunity: 0.12,
    multiLocationEvidence: 0.06,
    websiteDomainConfidence: 0.07,
    processorPaymentClues: 0.07,
    decisionMakerEvidence: 0.10,
    emailSourceConfidence: 0.08,
    validationState: 0.08,
    freshness: 0.06,
    existingRelationshipPenalty: -0.08,
    providerCostAlreadyIncurred: -0.04,
  };

  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += weight * (input[key as keyof typeof input] as number);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Map geography evidence class to geographyConfidence score (0-100). */
function geoClassToConfidence(cls: GeographyEvidenceClass): number {
  switch (cls) {
    case "verified": return 100;
    case "zip_inferred": return 70;
    case "city_inferred": return 40;
    case "conflicting": return 20;
    default: return 0;
  }
}

// ── Main selector ──────────────────────────────────────────────────────────────

/**
 * Build the deterministic ROI-ranked cohort for South Florida / five-vertical.
 *
 * Evaluates ALL eligible canonical businesses — no ID-based pre-filter.
 * Geography fallback: FIPS → ZIP inference → city inference → unresolved.
 * Unresolved-geography businesses are scored (lower score) but not hard-excluded,
 * so the funnel accurately reports the reason for any zero result.
 */
export async function selectRoiCohort(opts: {
  maxCohort?: number;
  verticalIds?: string[];
  countyFips?: string[];
  now?: Date;
  persistScores?: boolean;
  actorId?: string;
  /** If true, businesses with unresolved geography are included (scored lower).
   *  Defaults to false (they are scored but excluded from the eligible set). */
  includeGeographyUnresolved?: boolean;
  /** DB executor to run every query against. Pass a transaction handle
   *  (e.g. from db.transaction(async (tx) => ...)) so the entire scan runs
   *  against one consistent snapshot. Defaults to the shared pool. */
  executor?: { execute: (q: any) => Promise<any> };
} = {}): Promise<RoiCohortSelection> {
  const exec = opts.executor ?? db;
  const now = opts.now ?? new Date();
  const maxCohort = opts.maxCohort ?? 25;
  const countyFips = opts.countyFips ?? [...SOUTH_FLORIDA_FIPS];
  const verticalIds = opts.verticalIds ?? await loadPilotVerticalIds();

  // ── Funnel counters ──────────────────────────────────────────────────────────
  const funnel = {
    totalScanned: 0,
    southFlorida: 0,
    outsideGeography: 0,
    geographyUnresolved: 0,
    inTargetVertical: 0,
    verticalUnresolved: 0,
    dbprExcluded: 0,
    existingCustomer: 0,
    testDemoInternal: 0,
    suppressed: 0,
    bouncedInvalidOnly: 0,
    inactiveEntity: 0,
    eligibleAfterExclusions: 0,
  };

  const eligible: RoiCandidateScore[] = [];
  const excluded: RoiCandidateScore[] = [];

  // ── Query ALL canonical businesses (no ID limit before scoring) ─────────────
  // We fetch in chunks of 500 to avoid OOM on large tables, but retain the
  // global top candidates after all chunks are scored.
  const CHUNK = 500;
  // Keyset pagination on the stable canonical business id, not a mutable
  // OFFSET. OFFSET-based pagination over a live table can skip or duplicate
  // rows when concurrent writes shift row order between chunk fetches;
  // keyset pagination on an indexed, immutable primary key does not.
  let lastSeenId = 0;
  const allScored: RoiCandidateScore[] = [];

  // Pre-build DBPR-excluded business IDs set using the canonical DBPR-family
  // predicate (server/services/dbpr.ts) rather than an ad hoc contact-source
  // join, so this selector stays in lockstep with every other DBPR exclusion
  // boundary in the codebase. Scoped to canonical businesses only.
  const dbprBizRows = rows(await exec.execute(sql`
    SELECT b.id AS business_id
    FROM businesses b
    WHERE b.record_class = 'canonical'
      AND ${businessHasDbprLineageSql(sql`b.id`)}
  `));
  const dbprBizIds = new Set(dbprBizRows.map((r: any) => Number(r.business_id)));

  // Pre-build existing-customer business IDs set
  const custBizRows = rows(await exec.execute(sql`
    SELECT DISTINCT business_id FROM sdr_merchants
    WHERE existing_customer_flag = true AND business_id IS NOT NULL
  `));
  const custBizIds = new Set(custBizRows.map((r: any) => Number(r.business_id)));

  // Subject-scoped suppression: a suppression flag on ONE contact must not
  // blanket-exclude the whole business when another, non-suppressed contact
  // could still be used. A business is only excluded at the business level
  // when EVERY contact belonging to it is suppressed (no usable unsuppressed
  // candidate remains) — that is the one case where business-wide exclusion
  // is provably correct rather than an over-broad guess. Per-contact
  // suppression itself is already tracked as subject-level evidence on the
  // `contacts` row (opt_out_date/opted_out_email/etc.); this query only
  // decides whether the *business* has zero usable candidates left.
  const suppressionRows = rows(await exec.execute(sql`
    SELECT
      business_id,
      COUNT(*)::int AS total_contacts,
      COUNT(*) FILTER (WHERE
        opt_out_date IS NOT NULL OR opted_out_email=TRUE OR opt_out_status='opted_out'
        OR unsubscribe_status='unsubscribed' OR complaint_status='reported'
        OR do_not_auto_contact=TRUE OR suppression_reason IS NOT NULL
      )::int AS suppressed_contacts
    FROM contacts
    WHERE business_id IS NOT NULL
    GROUP BY business_id
  `));
  const suppressedBizIds = new Set(
    suppressionRows
      .filter((r: any) => Number(r.total_contacts) > 0 && Number(r.suppressed_contacts) === Number(r.total_contacts))
      .map((r: any) => Number(r.business_id)),
  );
  const bouncedOnlyRows = rows(await exec.execute(sql`
    SELECT business_id FROM contacts WHERE business_id IS NOT NULL
     GROUP BY business_id HAVING COUNT(*) FILTER (WHERE email IS NOT NULL)>0
       AND COUNT(*) FILTER (WHERE email IS NOT NULL AND (bounce_status IS NULL OR bounce_status NOT IN ('hard','complained'))
                            AND COALESCE(email_status,'') NOT IN ('bounced','invalid'))=0
  `));
  const bouncedOnlyIds = new Set(bouncedOnlyRows.map((r:any)=>Number(r.business_id)));

  // Pre-build location evidence from ALL business_locations rows (not only
  // rows already inside the target counties). A business whose only location
  // is authoritatively OUTSIDE the target counties must resolve to
  // "outside_geography", not "geography_unresolved" — restricting this query
  // to in-county rows made that distinction impossible. We therefore scan
  // every location with a known county_fips and split it into two maps:
  // in-county (drives "inside") and any-known-county (drives "authoritatively
  // outside" when no in-county row exists for that business).
  const allLocFipsRows = rows(await exec.execute(sql`
    SELECT
      bl.business_id,
      bl.county_fips,
      COUNT(*)::int AS location_count
    FROM business_locations bl
    WHERE bl.county_fips IS NOT NULL
    GROUP BY bl.business_id, bl.county_fips
  `));
  // Retained only as a countyFips lookup for non-geography exclusion branches
  // (dbpr/existing-customer/etc.) that report a best-effort county on an
  // already-excluded candidate; it is NOT used for any geography admission
  // decision — that decision is made entirely by the deterministic
  // all-location resolver below.
  const fipsLocationMap = new Map<number, { countyFips: string; locationCount: number }>();
  for (const r of allLocFipsRows) {
    const bizId = Number(r.business_id);
    const fips = String(r.county_fips);
    if (countyFips.includes(fips) && !fipsLocationMap.has(bizId)) {
      fipsLocationMap.set(bizId, { countyFips: fips, locationCount: Number(r.location_count) });
    }
  }

  // Full per-business location rows for the deterministic all-location
  // geography resolver (VFC-02). One bulk query for every business_locations
  // row regardless of whether county_fips is populated, grouped in memory —
  // avoids an N+1 query per business while still evaluating every row.
  const allLocationRows = rows(await exec.execute(sql`
    SELECT id, business_id, is_primary, city, state, postal_code, county_fips
    FROM business_locations
  `));
  const locationsByBusiness = new Map<number, LocationCandidateInput[]>();
  for (const r of allLocationRows) {
    const bizId = Number(r.business_id);
    const list = locationsByBusiness.get(bizId) ?? [];
    list.push({
      locationId: Number(r.id),
      isPrimary: Boolean(r.is_primary),
      city: r.city ?? null,
      state: r.state ?? null,
      postalCode: r.postal_code ?? null,
      countyFips: r.county_fips ?? null,
    });
    locationsByBusiness.set(bizId, list);
  }

  // Chunked business scan — no pre-filter by geography so funnel is truthful
  while (true) {
    const chunk = rows(await exec.execute(sql`
      SELECT
        b.id AS business_id,
        b.vertical,
        b.website_domain AS website,
        b.canonical_name,
        b.city,
        b.state,
        b.postal_code,
        b.status AS business_status,
        COALESCE(em_agg.has_valid_email, false) AS has_valid_email,
        COALESCE(em_agg.email_status, 'unvalidated') AS email_status,
        COALESCE(em_agg.has_decision_maker, false) AS has_decision_maker,
        COALESCE(enr_agg.days_since_enrichment, 999)::int AS days_since_enrichment,
        COALESCE(enr_agg.has_processor_clue, false) AS has_processor_clue,
        COALESCE(all_locs.loc_count, 1)::int AS total_location_count,
        b.created_at
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM contacts c
            WHERE c.business_id = b.id AND c.email_status = 'valid'
              AND (c.bounce_status IS NULL OR c.bounce_status NOT IN ('hard', 'complained'))
              AND c.opt_out_date IS NULL
          ) AS has_valid_email,
          (
            SELECT c.email_status FROM contacts c
            WHERE c.business_id = b.id AND c.opt_out_date IS NULL
            ORDER BY CASE c.email_status WHEN 'valid' THEN 0 WHEN 'active' THEN 1 ELSE 2 END
            LIMIT 1
          ) AS email_status,
          EXISTS (
            SELECT 1 FROM contacts c
            WHERE c.business_id = b.id AND c.first_name IS NOT NULL
              AND c.email IS NOT NULL AND c.opt_out_date IS NULL
          ) AS has_decision_maker
      ) em_agg ON true
      LEFT JOIN LATERAL (
        SELECT
          EXTRACT(DAY FROM NOW() - MAX(al.created_at))::int AS days_since_enrichment,
          EXISTS (
            SELECT 1 FROM audit_logs al2
            WHERE al2.entity_type = 'business' AND al2.entity_key = b.id::text
              AND (al2.action ILIKE '%processor%' OR al2.action ILIKE '%payment%')
          ) AS has_processor_clue
        FROM audit_logs al
        WHERE al.entity_type = 'business' AND al.entity_key = b.id::text
          AND al.action ILIKE '%enrich%'
      ) enr_agg ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS loc_count FROM business_locations WHERE business_id = b.id
      ) all_locs ON true
      WHERE b.record_class='canonical' AND b.id > ${lastSeenId}
      ORDER BY b.id ASC
      LIMIT ${CHUNK}
    `));

    if (chunk.length === 0) break;
    lastSeenId = Number(chunk[chunk.length - 1].business_id);
    funnel.totalScanned += chunk.length;

    for (const row of chunk) {
      const bizId = Number(row.business_id);
      const canonicalName = String(row.canonical_name ?? "");
      const vertical = String(row.vertical ?? "");
      const businessStatus = String(row.business_status ?? "new").trim().toLowerCase();

      // ── Exclusions (counted before scoring for truthful funnel) ──────────────

      // DBPR exclusion
      if (dbprBizIds.has(bizId)) {
        funnel.dbprExcluded++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, "excluded:dbpr", false, "none", "unknown"));
        continue;
      }

      // Existing customer
      if (custBizIds.has(bizId)) {
        funnel.existingCustomer++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, "excluded:existing_customer", false, "none", "unknown"));
        continue;
      }

      if (suppressedBizIds.has(bizId)) {
        funnel.suppressed++;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,"excluded:suppressed",false,"none","unknown"));
        continue;
      }
      if (bouncedOnlyIds.has(bizId)) {
        funnel.bouncedInvalidOnly++;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,"excluded:bounced_invalid_only",false,"none","unknown"));
        continue;
      }

      // The canonical status defaults to "new". Only explicit terminal or
      // operator-suppressed states are inactive; otherwise nearly every new
      // prospect would be discarded before enrichment.
      if (["inactive", "closed", "dissolved", "revoked", "expired", "archived", "suppressed"].includes(businessStatus)) {
        funnel.inactiveEntity++;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,`excluded:inactive_entity:${businessStatus}`,false,"none","unknown"));
        continue;
      }

      // Test/demo/internal
      const lowerName = canonicalName.toLowerCase();
      if (lowerName.includes("test") || lowerName.includes("demo") || lowerName.includes("internal")) {
        funnel.testDemoInternal++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, "excluded:test_demo_internal", false, "none", "unknown"));
        continue;
      }

      // ── Geography resolution (deterministic, all-location resolver — VFC-02) ──
      // Evaluate every business_locations row for this business plus the
      // businesses-table fallback, then select one winner by evidence
      // authority → primary-flag → lowest-location-id (see
      // sfp-geography-resolver.ts). Replaces the prior single-Map lookup
      // that had no deterministic tiebreak among multiple locations.
      const locationCandidates: LocationCandidateInput[] = [...(locationsByBusiness.get(bizId) ?? [])];
      locationCandidates.push({
        locationId: null,
        isPrimary: false,
        city: row.city ? String(row.city) : null,
        state: row.state ? String(row.state) : null,
        postalCode: row.postal_code ? String(row.postal_code) : null,
        countyFips: null,
      });
      const geoResolution = resolveGeographyFromCandidates(locationCandidates);

      let geoClass: GeographyEvidenceClass = geoResolution.evidenceClass ?? "unknown";
      let geoSource: "county_fips" | "zip" | "city" | "none" =
        geoResolution.evidenceClass === "verified" ? "county_fips"
        : geoResolution.evidenceClass === "zip_inferred" ? "zip"
        : geoResolution.evidenceClass === "city_inferred" ? "city"
        : "none";
      const resolvedCountyFips = geoResolution.countyFips;
      const geoEligible = geoResolution.outcome === "resolved";

      if (geoResolution.outcome === "outside_territory") {
        funnel.outsideGeography++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, "excluded:outside_geography", false, geoSource, geoClass, geoResolution, null));
        continue;
      }
      if (geoResolution.outcome === "unresolved" || geoResolution.outcome === "conflicting") {
        funnel.geographyUnresolved++;
        if (!opts.includeGeographyUnresolved) {
          excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, `excluded:geography_unresolved:${geoResolution.outcome}`, false, geoSource, "unknown", geoResolution, null));
          continue;
        }
      }

      if (geoEligible) funnel.southFlorida++;

      // ── Vertical filter (real five-target classifier — VFC-01) ───────────────
      const classifierResult = classifyVertical(vertical, verticalIds);
      if (classifierResult.outcome === "not_target" || classifierResult.outcome === "unresolved") {
        funnel.verticalUnresolved++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, `excluded:vertical_${classifierResult.outcome}:${vertical}`, false, geoSource, geoClass, geoResolution, classifierResult));
        continue;
      }
      if (classifierResult.outcome === "review_required") {
        funnel.verticalUnresolved++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap, `excluded:vertical_review_required:${vertical}`, false, geoSource, geoClass, geoResolution, classifierResult));
        continue;
      }
      // resolved_high or resolved_medium — admitted.
      funnel.inTargetVertical++;
      funnel.eligibleAfterExclusions++;

      // ── Score and classify ────────────────────────────────────────────────────
      const emailStatus = String(row.email_status ?? "unvalidated");
      const daysSince = Number(row.days_since_enrichment ?? 999);
      const locationCount = Number(row.total_location_count ?? 1);

      const dimensions = {
        geographyConfidence: geoClassToConfidence(geoClass),
        verticalFit: 100,
        activeStatus: businessStatus === "active" ? 100 : 80,
        estimatedOpportunity: Math.min(100, locationCount * 25),
        multiLocationEvidence: locationCount >= 3 ? 100 : locationCount === 2 ? 60 : 30,
        websiteDomainConfidence: row.website ? 100 : 0,
        processorPaymentClues: row.has_processor_clue ? 100 : 0,
        decisionMakerEvidence: row.has_decision_maker && row.has_valid_email ? 100 : row.has_decision_maker ? 50 : 0,
        // "active"/"unvalidated" are non-provider-validated email states (see
        // memory: zerobounce-email-status-default — "active" means
        // legacy-never-validated, and "unvalidated" is the schema default).
        // Neither has been confirmed deliverable by a provider, so neither
        // may receive positive provider-validation credit; only "valid"
        // (an actual ZeroBounce-confirmed outcome) scores here.
        emailSourceConfidence: emailStatus === "valid" ? 100 : 0,
        validationState: emailStatus === "valid" ? 100 : 0,
        freshness: daysSince <= 1 ? 100 : daysSince <= 30 ? 70 : daysSince <= 90 ? 30 : 0,
        existingRelationshipPenalty: 0,
        providerCostAlreadyIncurred: 0,
      };

      const roiScore = computeRoiScore(dimensions);
      allScored.push({
        canonicalBusinessId: bizId,
        roiScore,
        scoreVersion: ROI_SCORE_VERSION,
        dimensions,
        geographyClass: geoClass,
        geographySource: geoSource,
        countyFips: resolvedCountyFips,
        vertical,
        dispositionReason: "eligible",
        eligible: true,
        geographyResolution: geoResolution,
        classifierResult,
      });
    }

    if (chunk.length < CHUNK) break;
  }

  // Global rank after all chunks are scored. Stable total order: roi_score
  // DESC, then canonical_business_id ASC as a deterministic tiebreak so two
  // runs against the same data always produce the same ranked order (no
  // dependence on scan/insertion order for equal scores).
  allScored.sort((a, b) => b.roiScore - a.roiScore || a.canonicalBusinessId - b.canonicalBusinessId);

  const topCohort = allScored.slice(0, maxCohort);
  eligible.push(...topCohort);
  // Businesses that scored but didn't make the cap
  for (const c of allScored.slice(maxCohort)) {
    excluded.push({ ...c, eligible: false, dispositionReason: "excluded:cohort_cap" });
  }

  // ── Persist scores ──────────────────────────────────────────────────────────
  if (opts.persistScores && allScored.length > 0) {
    await persistRoiScores(allScored, opts.actorId ?? "system:roi-cohort-selector", exec);
  }

  return {
    eligible: topCohort,
    excluded,
    verticalIds,
    countyFips,
    scoreVersion: ROI_SCORE_VERSION,
    selectedAt: now.toISOString(),
    evaluated: funnel.totalScanned,
    funnel,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function _buildCandidate(
  bizId: number,
  row: any,
  verticalIds: string[],
  _countyFips: string[],
  fipsMap: Map<number, { countyFips: string; locationCount: number }>,
  dispositionReason: string,
  eligible: boolean,
  geoSource: "county_fips" | "zip" | "city" | "none",
  geoClass: GeographyEvidenceClass,
  geographyResolution: GeographyResolution | null = null,
  classifierResult: ClassifierResult | null = null,
): RoiCandidateScore {
  return {
    canonicalBusinessId: bizId,
    roiScore: 0,
    scoreVersion: ROI_SCORE_VERSION,
    dimensions: {
      geographyConfidence: 0, verticalFit: 0, activeStatus: 0,
      estimatedOpportunity: 0, multiLocationEvidence: 0, websiteDomainConfidence: 0,
      processorPaymentClues: 0, decisionMakerEvidence: 0, emailSourceConfidence: 0,
      validationState: 0, freshness: 0, existingRelationshipPenalty: 0,
      providerCostAlreadyIncurred: 0,
    },
    geographyClass: geoClass,
    geographySource: geoSource,
    countyFips: geographyResolution?.countyFips ?? fipsMap.get(bizId)?.countyFips ?? null,
    vertical: row.vertical ? String(row.vertical) : null,
    dispositionReason,
    eligible,
    geographyResolution,
    classifierResult,
  };
}

// ── Score persistence (uses migration-managed table — no runtime DDL) ──────────

async function persistRoiScores(
  candidates: RoiCandidateScore[],
  actorId: string,
  exec: { execute: (q: any) => Promise<any> } = db,
): Promise<void> {
  if (candidates.length === 0) return;
  try {
    for (const c of candidates) {
      // Upsert on (business_id, score_version): a repeated selection run
      // for the same score version replaces the prior score in place
      // instead of silently accumulating duplicate rows (the previous
      // ON CONFLICT DO NOTHING had no matching unique constraint, so it
      // was never a real no-op — every run re-inserted a full duplicate set).
      await exec.execute(sql`
        INSERT INTO cro03c_roi_candidate_scores
          (business_id, roi_score, score_version, dimensions, disposition_reason, eligible, actor_id)
        VALUES (${c.canonicalBusinessId}, ${c.roiScore}, ${c.scoreVersion},
                ${JSON.stringify(c.dimensions)}::jsonb, ${c.dispositionReason}, ${c.eligible}, ${actorId})
        ON CONFLICT (business_id, score_version) DO UPDATE SET
          roi_score = EXCLUDED.roi_score,
          dimensions = EXCLUDED.dimensions,
          disposition_reason = EXCLUDED.disposition_reason,
          eligible = EXCLUDED.eligible,
          actor_id = EXCLUDED.actor_id,
          created_at = NOW()
      `);
    }
  } catch (err: any) {
    console.warn(`[ROI-cohort] Score persistence warning: ${err?.message}`);
  }
}

// ── ROI cohort preview (read-only) ─────────────────────────────────────────────

export async function previewRoiCohort(opts: {
  maxPreview?: number;
  verticalIds?: string[];
  countyFips?: string[];
} = {}): Promise<{
  topCandidates: RoiCandidateScore[];
  totalEligible: number;
  verticalIds: string[];
  funnel: RoiCohortSelection["funnel"];
}> {
  const result = await selectRoiCohort({ ...opts, persistScores: false });
  return {
    topCandidates: result.eligible.slice(0, opts.maxPreview ?? 10),
    totalEligible: result.eligible.length,
    verticalIds: result.verticalIds,
    funnel: result.funnel,
  };
}
