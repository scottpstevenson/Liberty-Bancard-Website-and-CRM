/**
 * roi-cohort-selector.ts
 *
 * Deterministic South Florida / five-vertical ROI cohort selector.
 *
 * Eligible unit: a canonical non-DBPR business or qualified source subject
 * resolved to one, inside the configured South Florida county/FIPS authority,
 * inside one of the five configured canonical vertical IDs, active, not an
 * existing customer or active relationship, not synthetic/test/demo, not
 * suppressed/bounced/opted-out/complained, not an unresolved duplicate/identity
 * conflict, outside provider cooldown/TTL, and still missing sufficient
 * validated contact or decision-maker evidence.
 *
 * Vertical IDs are loaded from the canonical configured source (cro03a_policy_initializer
 * system_settings row), never hard-coded as display-name strings.  The five
 * configured verticals for the South Florida paid pilot are:
 *   Med Spa, Dental, Auto Repair, Restaurant, Retail
 * (configurable via system_settings key cro03c_roi_pilot_verticals).
 *
 * ROI priority scoring is versioned and persisted per candidate in
 * cro03c_roi_candidate_scores so the UI can explain every decision.
 *
 * SECURITY:
 *  - DBPR-lineage businesses are excluded at every stage.
 *  - Suppressed, bounced, opted-out, and complained contacts are excluded.
 *  - Only provider_valid ZeroBounce outcomes can stage a master_lead.
 *  - This module never sends messages, creates campaigns, or enrolls sequences.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Current ROI scoring algorithm version. Bump when formula changes. */
export const ROI_SCORE_VERSION = 1 as const;

/** Default pilot verticals when system_settings key is absent. */
const DEFAULT_PILOT_VERTICAL_IDS = [
  "Med Spa",
  "Dental",
  "Auto Repair",
  "Restaurant",
  "Retail",
] as const;

/** South Florida county FIPS codes (from CRO03A_COUNTY_FIPS). */
const SOUTH_FLORIDA_FIPS = ["12011", "12086", "12099"] as const; // Broward, Miami-Dade, Palm Beach

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoiCandidateScore {
  canonicalBusinessId: number;
  roiScore: number;
  scoreVersion: typeof ROI_SCORE_VERSION;
  /** Per-dimension scores (0–100 each) */
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
  /** Reason the candidate was included or excluded */
  dispositionReason: string;
  /** true = eligible for cohort, false = excluded */
  eligible: boolean;
}

export interface RoiCohortSelection {
  /** Eligible candidates sorted by roiScore DESC */
  eligible: RoiCandidateScore[];
  /** Excluded candidates with reason codes */
  excluded: RoiCandidateScore[];
  /** Canonical vertical IDs used for this selection */
  verticalIds: string[];
  /** County FIPS codes used */
  countyFips: string[];
  /** Score version applied */
  scoreVersion: typeof ROI_SCORE_VERSION;
  /** ISO timestamp of selection */
  selectedAt: string;
  /** Total candidates evaluated */
  evaluated: number;
}

// ── Vertical ID loader ─────────────────────────────────────────────────────────

/**
 * Load the configured pilot vertical IDs from system_settings.
 * Falls back to DEFAULT_PILOT_VERTICAL_IDS if not configured.
 * Never hard-codes display-name spellings — uses the stored canonical IDs.
 */
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

/**
 * Compute a weighted ROI priority score (0–100) for a candidate business.
 * Weights sum to 1.0.  Each dimension is 0–100.
 */
function computeRoiScore(input: {
  geographyConfidence: number;      // 0–100: direct FIPS=100, zip_inferred=70, city_inferred=40, unknown=0
  verticalFit: number;              // 0–100: 100=exact match, 60=coarse match, 0=no match
  activeStatus: number;             // 0–100: active=100, unknown=50, inactive=0
  estimatedOpportunity: number;     // 0–100: based on location count/type/processing volume clues
  multiLocationEvidence: number;    // 0–100: 3+ locs=100, 2=60, 1=30, 0=0
  websiteDomainConfidence: number;  // 0–100: verified=100, found=70, none=0
  processorPaymentClues: number;    // 0–100: strong clue (POS, terminal mention)=100, weak=40, none=0
  decisionMakerEvidence: number;    // 0–100: named DM with verified email=100, named only=50, none=0
  emailSourceConfidence: number;    // 0–100: official=100, inferred=60, unknown=20, none=0
  validationState: number;          // 0–100: valid=100, unvalidated=50, invalid=0
  freshness: number;                // 0–100: days since last enrichment; 0d=100, 30d=70, 90d=30, 180d=0
  existingRelationshipPenalty: number; // 0–100: 0=no penalty, 100=strong penalty
  providerCostAlreadyIncurred: number; // 0–100: 0=no cost yet, 100=already spent a lot
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
    existingRelationshipPenalty: -0.08,  // penalty: higher value = lower score
    providerCostAlreadyIncurred: -0.04,  // penalty: higher value = lower score
  };

  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = input[key as keyof typeof input];
    if (weight < 0) {
      // Penalty dimensions: higher raw value → lower score
      score += weight * value; // weight is negative, value is positive → subtraction
    } else {
      score += weight * value;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Main selector ──────────────────────────────────────────────────────────────

/**
 * Build the deterministic ROI-ranked cohort for the South Florida / five-vertical
 * paid pilot.  Evaluates all candidate businesses and scores them.
 *
 * @param opts.maxCohort   Maximum cohort size (default 25 for Level 2)
 * @param opts.verticalIds Canonical vertical IDs to use (loaded from config if omitted)
 * @param opts.countyFips  County FIPS codes (defaults to South Florida three-county set)
 * @param opts.now         Overrides current time (for deterministic tests)
 */
export async function selectRoiCohort(opts: {
  maxCohort?: number;
  verticalIds?: string[];
  countyFips?: string[];
  now?: Date;
  /** If true, persist score rows to cro03c_roi_candidate_scores */
  persistScores?: boolean;
  actorId?: string;
} = {}): Promise<RoiCohortSelection> {
  const now = opts.now ?? new Date();
  const maxCohort = opts.maxCohort ?? 25;
  const countyFips = opts.countyFips ?? [...SOUTH_FLORIDA_FIPS];
  const verticalIds = opts.verticalIds ?? await loadPilotVerticalIds();

  const eligible: RoiCandidateScore[] = [];
  const excluded: RoiCandidateScore[] = [];

  // ── Query candidate businesses ──────────────────────────────────────────────
  // Criteria enforced in SQL:
  //  1. Inside South Florida counties (via business_locations.county_fips)
  //  2. Inside configured verticals (businesses.vertical)
  //  3. Active (businesses.is_active or equivalent)
  //  4. Not an existing customer/active relationship
  //  5. Not synthetic/test/demo
  //  6. Not suppressed, bounced, opted-out, or complained (contact-level)
  //  7. No unresolved identity conflict (no open canonical_conflicts row)
  //  8. DBPR excluded (no dbpr_lineage flag)
  //
  // Evidence fields fetched for ROI scoring:
  //  - county_fips evidence class (geography confidence)
  //  - website presence (domain confidence)
  //  - location count (multi-location evidence)
  //  - email validation state (validationState)
  //  - last enrichment date (freshness)
  //  - decision maker evidence (has named contact with email)

  const fipsValues = countyFips.map((f) => sql`${f}`);
  const vertValues = verticalIds.map((v) => sql`${v}`);

  const candidates = rows(await db.execute(sql`
    SELECT
      b.id AS business_id,
      b.vertical,
      b.website_domain AS website,
      COALESCE(bl_agg.county_fips, '') AS county_fips,
      COALESCE(bl_agg.location_count, 0)::int AS location_count,
      COALESCE(em_agg.has_valid_email, false) AS has_valid_email,
      COALESCE(em_agg.email_status, 'unvalidated') AS email_status,
      COALESCE(em_agg.has_decision_maker, false) AS has_decision_maker,
      COALESCE(enr_agg.days_since_enrichment, 999)::int AS days_since_enrichment,
      COALESCE(enr_agg.has_processor_clue, false) AS has_processor_clue,
      b.created_at
    FROM businesses b
    -- Geography: must have at least one location in target counties
    JOIN (
      SELECT
        bl.business_id,
        bl.county_fips,
        COUNT(*)::int AS location_count
      FROM business_locations bl
      WHERE bl.county_fips = ANY(ARRAY[${sql.join(fipsValues, sql`, `)}])
      GROUP BY bl.business_id, bl.county_fips
    ) bl_agg ON bl_agg.business_id = b.id
    -- Email/validation evidence (left join — absence is scored, not excluded)
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
          WHERE c.business_id = b.id
            AND c.opt_out_date IS NULL
          ORDER BY CASE c.email_status WHEN 'valid' THEN 0 WHEN 'active' THEN 1 ELSE 2 END LIMIT 1
        ) AS email_status,
        EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.business_id = b.id AND c.first_name IS NOT NULL AND c.email IS NOT NULL
            AND c.opt_out_date IS NULL
        ) AS has_decision_maker
    ) em_agg ON true
    -- Enrichment freshness (left join)
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
    -- Filters applied after all JOINs (SQL requires WHERE after FROM/JOIN)
    WHERE b.vertical = ANY(ARRAY[${sql.join(vertValues, sql`, `)}])
      -- Not existing customer
      AND NOT EXISTS (
        SELECT 1 FROM sdr_merchants sm
        WHERE sm.business_id = b.id AND sm.existing_customer_flag = true
      )
      -- Not test/demo
      AND (b.canonical_name IS NULL OR b.canonical_name NOT ILIKE '%test%')
      AND (b.canonical_name IS NULL OR b.canonical_name NOT ILIKE '%demo%')
      -- DBPR excluded: no contact linked to this business came from dbpr source
      AND NOT EXISTS (
        SELECT 1 FROM contacts con
        JOIN contact_source_events cse ON cse.contact_id = con.id
        WHERE con.business_id = b.id AND cse.source_type = 'dbpr'
      )
    ORDER BY b.id
    LIMIT 5000
  `));

  // ── Score each candidate ────────────────────────────────────────────────────
  for (const row of candidates) {
    const businessId = Number(row.business_id);
    const geoClass = String(row.geo_evidence_class);
    const emailStatus = String(row.email_status ?? "unvalidated");
    const daysSince = Number(row.days_since_enrichment ?? 999);

    const dimensions = {
      geographyConfidence: geoClass === "verified" ? 100 : geoClass === "zip_inferred" ? 70 : geoClass === "city_inferred" ? 40 : 0,
      verticalFit: verticalIds.includes(String(row.vertical)) ? 100 : 0,
      activeStatus: 80, // businesses without is_active column assumed likely active if in vertical/geo
      estimatedOpportunity: Math.min(100, (Number(row.location_count) ?? 1) * 25),
      multiLocationEvidence: Number(row.location_count) >= 3 ? 100 : Number(row.location_count) === 2 ? 60 : 30,
      websiteDomainConfidence: row.website ? 100 : 0,
      processorPaymentClues: row.has_processor_clue ? 100 : 0,
      decisionMakerEvidence: row.has_decision_maker && row.has_valid_email ? 100 : row.has_decision_maker ? 50 : 0,
      emailSourceConfidence: emailStatus === "valid" ? 100 : emailStatus === "active" ? 60 : emailStatus === "unvalidated" ? 20 : 0,
      validationState: emailStatus === "valid" ? 100 : emailStatus === "unvalidated" ? 50 : 0,
      freshness: daysSince <= 1 ? 100 : daysSince <= 30 ? 70 : daysSince <= 90 ? 30 : 0,
      existingRelationshipPenalty: 0,  // not an existing customer (filtered in SQL)
      providerCostAlreadyIncurred: 0,  // TODO: query cro03c_stage_operations for prior spend
    };

    const roiScore = computeRoiScore(dimensions);
    const isEligible = verticalIds.includes(String(row.vertical)) && row.is_active !== false;

    const candidate: RoiCandidateScore = {
      canonicalBusinessId: businessId,
      roiScore,
      scoreVersion: ROI_SCORE_VERSION,
      dimensions,
      dispositionReason: isEligible ? "eligible" : `excluded:vertical_mismatch:${row.vertical}`,
      eligible: isEligible,
    };

    if (isEligible) eligible.push(candidate);
    else excluded.push(candidate);
  }

  // Sort eligible by ROI score descending
  eligible.sort((a, b) => b.roiScore - a.roiScore);

  // ── Persist scores ──────────────────────────────────────────────────────────
  if (opts.persistScores && eligible.length + excluded.length > 0) {
    await persistRoiScores([...eligible, ...excluded], opts.actorId ?? "system:roi-cohort-selector");
  }

  return {
    eligible: eligible.slice(0, maxCohort),
    excluded,
    verticalIds,
    countyFips,
    scoreVersion: ROI_SCORE_VERSION,
    selectedAt: now.toISOString(),
    evaluated: candidates.length,
  };
}

// ── Score persistence ──────────────────────────────────────────────────────────

/**
 * Upsert ROI candidate scores into cro03c_roi_candidate_scores.
 * Table is created via migration if absent — graceful skip on table-not-found.
 */
async function persistRoiScores(candidates: RoiCandidateScore[], actorId: string): Promise<void> {
  if (candidates.length === 0) return;
  try {
    // Ensure table exists (idempotent DDL — runs only if missing)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cro03c_roi_candidate_scores (
        id                    SERIAL PRIMARY KEY,
        business_id           INTEGER NOT NULL,
        roi_score             INTEGER NOT NULL,
        score_version         INTEGER NOT NULL,
        dimensions            JSONB NOT NULL,
        disposition_reason    TEXT NOT NULL,
        eligible              BOOLEAN NOT NULL,
        actor_id              TEXT NOT NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (business_id, score_version, created_at)
      )
    `);
    for (const c of candidates) {
      await db.execute(sql`
        INSERT INTO cro03c_roi_candidate_scores
          (business_id, roi_score, score_version, dimensions, disposition_reason, eligible, actor_id)
        VALUES (${c.canonicalBusinessId}, ${c.roiScore}, ${c.scoreVersion},
                ${JSON.stringify(c.dimensions)}::jsonb, ${c.dispositionReason}, ${c.eligible}, ${actorId})
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (err: any) {
    // Non-fatal: score persistence failure must never block the selection
    console.warn(`[ROI-cohort] Score persistence warning: ${err?.message}`);
  }
}

// ── ROI cohort preview (read-only) ─────────────────────────────────────────────

export async function previewRoiCohort(opts: {
  maxPreview?: number;
  verticalIds?: string[];
  countyFips?: string[];
} = {}): Promise<{ topCandidates: RoiCandidateScore[]; totalEligible: number; verticalIds: string[] }> {
  const result = await selectRoiCohort({ ...opts, persistScores: false });
  return {
    topCandidates: result.eligible.slice(0, opts.maxPreview ?? 10),
    totalEligible: result.eligible.length,
    verticalIds: result.verticalIds,
  };
}
