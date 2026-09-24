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
import { createHash } from "crypto";
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
const SFP_INACTIVE_ENTITY_STATUSES = [
  "inactive", "closed", "dissolved", "revoked", "expired", "archived",
] as const;

/**
 * Shared hard-exclusion predicate for pre-cohort Phase A and the frozen-cohort
 * selector. This deliberately excludes only authoritative business-level
 * facts; a single suppressed contact is never promoted to a business-wide
 * exclusion.
 */
export async function getSfpBusinessHardExclusionReasons(
  businessIds: number[],
  executor: { execute: (q: any) => Promise<any> } = db,
): Promise<Map<number, string>> {
  if (businessIds.length === 0) return new Map();
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const records = rows(await executor.execute(sql`
    SELECT b.id AS business_id,
      CASE
        WHEN ${businessHasDbprLineageSql(sql`b.id`)} THEN 'dbpr'
        WHEN LOWER(COALESCE(b.status,'')) = 'suppressed' THEN 'business_wide_suppression'
        WHEN EXISTS (
          SELECT 1 FROM sdr_merchants sm
           WHERE sm.business_id=b.id AND sm.existing_customer_flag=TRUE
        ) THEN 'existing_customer'
        WHEN LOWER(COALESCE(b.status,'')) IN
          (${sql.join(SFP_INACTIVE_ENTITY_STATUSES.map((status) => sql`${status}`), sql`, `)})
          THEN 'inactive_entity'
        WHEN LOWER(COALESCE(b.canonical_name,'')) LIKE '%test%'
          OR LOWER(COALESCE(b.canonical_name,'')) LIKE '%demo%'
          OR LOWER(COALESCE(b.canonical_name,'')) LIKE '%internal%'
          THEN 'test_demo_internal'
        ELSE NULL
      END AS exclusion_reason
      FROM businesses b
     WHERE b.record_class='canonical'
       AND b.id = ANY(ARRAY[${idList}]::integer[])
  `));
  return new Map<number, string>(
    records.filter((r: any) => r.exclusion_reason).map((r: any) => [
      Number(r.business_id), String(r.exclusion_reason),
    ]),
  );
}

/** Current ROI scoring algorithm version. Bump when formula changes. */
export const ROI_SCORE_VERSION = 2 as const;

/**
 * Correction 5: subject-aware suppression/bounce evidence. A business-level
 * exclusion must never be recorded as a blanket, evidence-free "business"
 * scope when the actual determining fact is at the contact or email level —
 * doing so would make it impossible to tell, from the ledger alone, whether
 * suppressing one email address correctly implied the whole business had no
 * usable contact left, or whether the exclusion silently over-broadened.
 * `subjectHash` is a SHA-256 of the specific contact id or (lowercased)
 * email address that decided the outcome — never the raw PII itself.
 */
/**
 * Task #1998 round-3 correction (item 3): a single per-business "sample"
 * subject is not genuine subject-aware evidence — it silently discards every
 * OTHER determining contact/email at that business, and it inferred `scope`
 * from whether an email field happened to be present rather than from which
 * predicate actually fired. `subjects` now carries one entry per contact
 * whose own row genuinely determined the exclusion, each with the real
 * authority (the specific column/rule that fired), a canonical reason code,
 * an evidence reference, and the channel that predicate governs. The
 * top-level scope/subjectHash/reason/contactId fields mirror the first
 * subject for backward-compatible call sites but are no longer the only
 * evidence recorded.
 */
export interface SuppressionSubject {
  scope: "contact" | "email";
  subjectHash: string;
  contactId: number;
  /** The specific column/rule that determined this subject was unusable,
   *  e.g. "contact.unsubscribe_status", "contact.bounce_status". */
  authority: string;
  /** Canonical, closed-vocabulary reason code — never a free-text sample. */
  reasonCode: string;
  /** Stable reference an auditor can use to look up the deciding fact
   *  (never raw PII — a contact id reference, not the email itself). */
  evidenceRef: string;
  /** Which contact channel this predicate governs. */
  channel: "email" | "sms" | "all";
}
export interface SuppressionEvidence {
  /** "business" only when a business-level authoritative rule applied, or
   *  when every contact's own individual subjects independently prove no
   *  usable subject remains (both are genuine deterministic facts, not a
   *  guess). Otherwise "contact"/"email" mirroring subjects[0]. */
  scope: "contact" | "email" | "business";
  subjectHash: string;
  reason: string;
  contactId: number | null;
  /** Every individual contact/email whose own row determined this outcome —
   *  never truncated to one sample. Empty only for an authoritative
   *  business-wide rule with no per-contact predicate involved. */
  subjects: SuppressionSubject[];
  /** True only when an authoritative business-wide rule (e.g. businesses.status
   *  = 'suppressed') applied directly — never inferred merely because every
   *  currently-known contact happens to be suppressed/bounced. */
  businessWideRuleApplied: boolean;
}
function _hashSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

/**
 * Task #1999 (Architecture correction 4 / C6): read-only projection of ONLY
 * authoritative business-wide/domain-wide suppression evidence for a given
 * set of businesses — never a subject-scoped (single contact/candidate)
 * suppression. This intentionally mirrors, rather than duplicates the full
 * scan in, the aggregation this module already performs inside
 * selectRoiCohort: explicit businesses.status='suppressed' is the current
 * authoritative business-wide rule. Contact/email suppressions remain
 * subject-scoped and are never promoted by this function, even if every
 * currently known contact is suppressed.
 */
export async function getBusinessWideSuppressionExclusions(
  businessIds: number[],
  executor: { execute: (q: any) => Promise<any> } = db,
): Promise<Set<number>> {
  if (businessIds.length === 0) return new Set();
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const suppressionRows = rows(await executor.execute(sql`
    SELECT id FROM businesses
     WHERE id = ANY(ARRAY[${idList}]::integer[])
       AND LOWER(COALESCE(status,'')) = 'suppressed'
  `));
  return new Set<number>(suppressionRows.map((r: any) => Number(r.id)));
}

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
  /** Correction 5: subject-aware suppression/bounce evidence, set only when
   *  dispositionReason is excluded:suppressed or excluded:bounced_invalid_only. */
  suppressionEvidence: SuppressionEvidence | null;
  classificationEvidence?: {
    id: string;
    evidenceHash: string;
    policyVersion: number;
    classifierVersion: number;
    modelVersion: string | null;
    promptVersion: string | null;
  } | null;
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
  /** Active Phase-A evidence policy. Missing evidence is intentionally neutral. */
  classificationPolicyVersion?: number;
} = {}): Promise<RoiCohortSelection> {
  const exec = opts.executor ?? db;
  const now = opts.now ?? new Date();
  const maxCohort = opts.maxCohort ?? 25;
  const countyFips = opts.countyFips ?? [...SOUTH_FLORIDA_FIPS];
  const verticalIds = opts.verticalIds ?? await loadPilotVerticalIds();
  const classificationPolicyVersion = opts.classificationPolicyVersion ?? 1;
  const phaseAEvidenceRows = rows(await exec.execute(sql`
    SELECT DISTINCT ON (business_id) business_id,outcome,id,evidence_hash,policy_version,
           classifier_version,model_version,prompt_version,confidence,reason_codes
      FROM sfp_classification_evidence
     WHERE policy_version=${classificationPolicyVersion} AND terminal_state='completed'
     ORDER BY business_id,created_at DESC,evidence_hash ASC
  `));
  const phaseAEvidenceByBusiness = new Map<number, any>(
    phaseAEvidenceRows.map((r: any) => [Number(r.business_id), r]),
  );

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

  // Subject-scoped suppression: a suppression flag on ONE contact must not
  // blanket-exclude the whole business when another, non-suppressed contact
  // could still be used. A business is only excluded at the business level
  // when EVERY contact belonging to it is suppressed (no usable unsuppressed
  // candidate remains) — that is the one case where business-wide exclusion
  // is provably correct from per-contact evidence, rather than an
  // over-broad guess.
  //
  // Task #1998 round-3 correction (item 3): the prior version sampled ONE
  // contact via `(ARRAY_AGG(...))[1]` and inferred `scope` from whether the
  // sampled row's `email` column happened to be non-null — not from which
  // predicate actually fired. This version fetches every determining
  // contact's own row directly (one SELECT per suppressed contact, not an
  // aggregate sample), so `subjects` below carries real per-contact
  // authority/reasonCode/channel evidence for every subject that
  // contributed to the outcome.
  const suppressionPredicateRows = rows(await exec.execute(sql`
    SELECT
      id, business_id, email,
      opt_out_date, opted_out_email, opt_out_status, unsubscribe_status,
      complaint_status, do_not_auto_contact, suppression_reason
    FROM contacts
    WHERE business_id IS NOT NULL
      AND (
        opt_out_date IS NOT NULL OR opted_out_email=TRUE OR opt_out_status='opted_out'
        OR unsubscribe_status='unsubscribed' OR complaint_status='reported'
        OR do_not_auto_contact=TRUE OR suppression_reason IS NOT NULL
      )
    ORDER BY business_id, id
  `));
  const totalContactsByBiz = new Map<number, number>();
  for (const r of rows(await exec.execute(sql`
    SELECT business_id, COUNT(*)::int AS total_contacts FROM contacts
    WHERE business_id IS NOT NULL GROUP BY business_id
  `))) {
    totalContactsByBiz.set(Number(r.business_id), Number(r.total_contacts));
  }
  function _suppressionSubjectFrom(r: any): SuppressionSubject {
    const contactId = Number(r.id);
    const email = r.email ? String(r.email).trim().toLowerCase() : null;
    let authority: string;
    let reasonCode: string;
    let channel: SuppressionSubject["channel"];
    if (r.opted_out_email === true) {
      authority = "contact.opted_out_email"; reasonCode = "opted_out_email"; channel = "email";
    } else if (r.unsubscribe_status === "unsubscribed") {
      authority = "contact.unsubscribe_status"; reasonCode = "unsubscribed"; channel = "email";
    } else if (r.complaint_status === "reported") {
      authority = "contact.complaint_status"; reasonCode = "complaint"; channel = "email";
    } else if (r.opt_out_date !== null || r.opt_out_status === "opted_out") {
      authority = "contact.opt_out_status"; reasonCode = "opt_out"; channel = "all";
    } else if (r.do_not_auto_contact === true) {
      authority = "contact.do_not_auto_contact"; reasonCode = "do_not_contact"; channel = "all";
    } else {
      authority = "contact.suppression_reason"; reasonCode = String(r.suppression_reason ?? "suppressed"); channel = "all";
    }
    const scope: SuppressionSubject["scope"] = channel === "email" && email ? "email" : "contact";
    return {
      scope,
      subjectHash: _hashSubject(scope === "email" && email ? email : `contact:${contactId}`),
      contactId,
      authority,
      reasonCode,
      evidenceRef: `contact:${contactId}`,
      channel,
    };
  }
  const suppressionSubjectsByBiz = new Map<number, SuppressionSubject[]>();
  for (const r of suppressionPredicateRows) {
    const bizId = Number(r.business_id);
    const list = suppressionSubjectsByBiz.get(bizId) ?? [];
    list.push(_suppressionSubjectFrom(r));
    suppressionSubjectsByBiz.set(bizId, list);
  }
  const suppressedBizIds = new Set(
    Array.from(suppressionSubjectsByBiz.entries())
      .filter(([bizId, subjects]) => (totalContactsByBiz.get(bizId) ?? 0) > 0 && subjects.length === totalContactsByBiz.get(bizId))
      .map(([bizId]) => bizId),
  );
  const suppressionEvidenceByBiz = new Map<number, SuppressionEvidence>();
  for (const bizId of suppressedBizIds) {
    const subjects = suppressionSubjectsByBiz.get(bizId) ?? [];
    const first = subjects[0];
    // "business" scope is used here ONLY as the aggregate label for "every
    // contact independently proved unusable" — the deterministic per-subject
    // evidence in `subjects` is what actually proves it, never a guess.
    suppressionEvidenceByBiz.set(bizId, {
      scope: subjects.length > 1 ? "business" : first.scope,
      subjectHash: first.subjectHash,
      reason: first.reasonCode,
      contactId: first.contactId,
      subjects,
      businessWideRuleApplied: false,
    });
  }

  // Bounced/invalid-only exclusion — same per-subject evidence discipline.
  // Task #1998 round-3 correction (item 3): a business whose currently-known
  // emails are ALL bounced/invalid must never be treated as PERMANENTLY
  // excluded merely on that fact — free/paid discovery could still surface a
  // different address for the same business. This predicate therefore only
  // fires when the business has never had free discovery attempted
  // (free_enrichment_status IS NULL) — once free discovery HAS run, a
  // bounced-only business with contacts already discovered is genuinely
  // exhausted at the current comprehensiveness level and the exclusion is
  // safe to record as evidence (not a guess) rather than silently retried
  // forever. This mirrors the existing `requiresFreeDiscovery`
  // funnel semantics elsewhere in this module.
  const bouncedOnlyPredicateRows = rows(await exec.execute(sql`
    SELECT
      c.id, c.business_id, c.email, c.bounce_status, c.email_status
    FROM contacts c
    WHERE c.business_id IS NOT NULL AND c.email IS NOT NULL
      AND ((c.bounce_status IS NOT NULL AND c.bounce_status IN ('hard','complained'))
           OR COALESCE(c.email_status,'') IN ('bounced','invalid'))
    ORDER BY c.business_id, c.id
  `));
  const emailedContactCountByBiz = new Map<number, number>();
  const usableEmailContactCountByBiz = new Map<number, number>();
  for (const r of rows(await exec.execute(sql`
    SELECT business_id,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS emailed_contacts,
      COUNT(*) FILTER (WHERE email IS NOT NULL AND (bounce_status IS NULL OR bounce_status NOT IN ('hard','complained'))
                       AND COALESCE(email_status,'') NOT IN ('bounced','invalid'))::int AS usable_contacts
    FROM contacts WHERE business_id IS NOT NULL GROUP BY business_id
  `))) {
    emailedContactCountByBiz.set(Number(r.business_id), Number(r.emailed_contacts));
    usableEmailContactCountByBiz.set(Number(r.business_id), Number(r.usable_contacts));
  }
  const discoveryNeverAttemptedBizIds = new Set(
    rows(await exec.execute(sql`
      SELECT id FROM businesses WHERE free_enrichment_status IS NULL
    `)).map((r: any) => Number(r.id)),
  );
  function _bounceSubjectFrom(r: any): SuppressionSubject {
    const contactId = Number(r.id);
    const email = r.email ? String(r.email).trim().toLowerCase() : null;
    const reasonCode = r.bounce_status === "hard" || r.bounce_status === "complained"
      ? `bounce_${r.bounce_status}` : `invalid_email_${String(r.email_status ?? "unknown")}`;
    const authority = r.bounce_status ? "contact.bounce_status" : "contact.email_status";
    return {
      scope: "email",
      subjectHash: _hashSubject(email ?? `contact:${contactId}`),
      contactId,
      authority,
      reasonCode,
      evidenceRef: `contact:${contactId}`,
      channel: "email",
    };
  }
  const bounceSubjectsByBiz = new Map<number, SuppressionSubject[]>();
  for (const r of bouncedOnlyPredicateRows) {
    const bizId = Number(r.business_id);
    const list = bounceSubjectsByBiz.get(bizId) ?? [];
    list.push(_bounceSubjectFrom(r));
    bounceSubjectsByBiz.set(bizId, list);
  }
  const bouncedOnlyIds = new Set(
    Array.from(bounceSubjectsByBiz.keys()).filter((bizId) => {
      const emailed = emailedContactCountByBiz.get(bizId) ?? 0;
      const usable = usableEmailContactCountByBiz.get(bizId) ?? 0;
      if (!(emailed > 0 && usable === 0)) return false;
      // Deterministic evidence "no usable subject remains" requires free
      // discovery to have already run at least once — otherwise discovery
      // could still find another address and this must not be terminal.
      return !discoveryNeverAttemptedBizIds.has(bizId);
    }),
  );
  const bounceEvidenceByBiz = new Map<number, SuppressionEvidence>();
  for (const bizId of bouncedOnlyIds) {
    const subjects = bounceSubjectsByBiz.get(bizId) ?? [];
    const first = subjects[0];
    bounceEvidenceByBiz.set(bizId, {
      scope: subjects.length > 1 ? "business" : first.scope,
      subjectHash: first.subjectHash,
      reason: first.reasonCode,
      contactId: first.contactId,
      subjects,
      businessWideRuleApplied: false,
    });
  }

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
    const hardExclusions = await getSfpBusinessHardExclusionReasons(
      chunk.map((r: any) => Number(r.business_id)), exec,
    );
    const dbprBizIds = new Set(
      Array.from(hardExclusions).filter(([, reason]) => reason === "dbpr").map(([id]) => id),
    );
    const custBizIds = new Set(
      Array.from(hardExclusions).filter(([, reason]) => reason === "existing_customer").map(([id]) => id),
    );

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

      if (hardExclusions.get(bizId) === "business_wide_suppression") {
        funnel.suppressed++;
        excluded.push(_buildCandidate(bizId, row, verticalIds, countyFips, fipsLocationMap,
          "excluded:business_wide_suppression", false, "none", "unknown"));
        continue;
      }

      if (suppressedBizIds.has(bizId)) {
        funnel.suppressed++;
        const evidence = suppressionEvidenceByBiz.get(bizId) ?? null;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,`excluded:suppressed:${evidence?.scope ?? "business"}:${evidence?.subjectHash ?? "unknown"}`,false,"none","unknown",null,null,evidence));
        continue;
      }
      if (bouncedOnlyIds.has(bizId)) {
        funnel.bouncedInvalidOnly++;
        const evidence = bounceEvidenceByBiz.get(bizId) ?? null;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,`excluded:bounced_invalid_only:${evidence?.scope ?? "business"}:${evidence?.subjectHash ?? "unknown"}`,false,"none","unknown",null,null,evidence));
        continue;
      }

      // The canonical status defaults to "new". Only explicit terminal or
      // operator-suppressed states are inactive; otherwise nearly every new
      // prospect would be discarded before enrichment.
      if (hardExclusions.get(bizId) === "inactive_entity") {
        funnel.inactiveEntity++;
        excluded.push(_buildCandidate(bizId,row,verticalIds,countyFips,fipsLocationMap,`excluded:inactive_entity:${businessStatus}`,false,"none","unknown"));
        continue;
      }

      // Test/demo/internal
      if (hardExclusions.get(bizId) === "test_demo_internal") {
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

      // Phase-A decisions are authoritative exclusions for the active policy:
      // target may proceed through the independent deterministic classifier,
      // while non-target/review-required remain out pending a new decision.
      const phaseAEvidence = phaseAEvidenceByBusiness.get(bizId);
      if (phaseAEvidence?.outcome === "non_target" || phaseAEvidence?.outcome === "review_required") {
        funnel.verticalUnresolved++;
        excluded.push(_buildCandidate(
          bizId, row, verticalIds, countyFips, fipsLocationMap,
          `excluded:classification_${String(phaseAEvidence.outcome)}`,
          false, geoSource, geoClass, geoResolution, null,
        ));
        continue;
      }

      // ── Vertical filter (real five-target classifier — VFC-01) ───────────────
      let classifierResult = classifyVertical(vertical, verticalIds);
      if (phaseAEvidence?.outcome === "target" &&
          classifierResult.outcome !== "resolved_high" && classifierResult.outcome !== "resolved_medium") {
        const reasons = typeof phaseAEvidence.reason_codes === "string"
          ? JSON.parse(phaseAEvidence.reason_codes) : phaseAEvidence.reason_codes ?? [];
        classifierResult = {
          ...classifierResult,
          version: Number(phaseAEvidence.classifier_version) as typeof CLASSIFIER_VERSION,
          outcome: "resolved_medium",
          confidence: Number(phaseAEvidence.confidence ?? 0.65),
          evidenceHash: String(phaseAEvidence.evidence_hash),
          reasons: [...reasons, "PHASE_A_CLASSIFICATION_EVIDENCE"],
        };
      }
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
        suppressionEvidence: null,
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
  for (const candidate of [...eligible, ...excluded, ...allScored]) {
    const evidence = phaseAEvidenceByBusiness.get(candidate.canonicalBusinessId);
    if (evidence) candidate.classificationEvidence = {
      id: String(evidence.id), evidenceHash: String(evidence.evidence_hash),
      policyVersion: Number(evidence.policy_version), classifierVersion: Number(evidence.classifier_version),
      modelVersion: evidence.model_version ?? null, promptVersion: evidence.prompt_version ?? null,
    };
  }
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
  suppressionEvidence: SuppressionEvidence | null = null,
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
    suppressionEvidence,
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
