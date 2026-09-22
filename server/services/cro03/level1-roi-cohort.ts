/**
 * level1-roi-cohort.ts
 *
 * Wires selectRoiCohort() into the MI-09 Level 1 pilot freeze path.
 *
 * The original selectDeterministicPilotCohort() requires canonical_source_links
 * and a non-empty source_adapter_filter — both absent for businesses discovered
 * via the ROI cohort selector (which reads directly from businesses +
 * business_locations without needing a source-adapter provenance chain).
 *
 * This service:
 *  1. Convergently creates/returns the canonical Level 1 pilot definition
 *     (county=South FL FIPS, vertical=five configured verticals, no paid
 *     providers, max_cohort_size=25).
 *  2. Selects the top-25 ROI-ranked businesses via selectRoiCohort() for a
 *     given pilot run's scope.
 *  3. Freezes them via the existing freezePilotCohort() (idempotent).
 *  4. Builds a free-evidence report showing discovered candidates per business
 *     without triggering any paid provider calls.
 *
 * Level 1 never calls ZeroBounce, Serper, Apollo, Outscraper, OpenAI, GHL,
 * campaigns, sequences, or outreach. Validation is a separate explicit step
 * (cohort-validation.ts).
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { createHash } from "node:crypto";
import {
  getPilotRun,
  createPilotDefinition,
  freezePilotCohort,
} from "../mi09-pilot-authority";
import {
  selectRoiCohort,
  loadPilotVerticalIds,
  ROI_SCORE_VERSION,
  type RoiCandidateScore,
} from "./roi-cohort-selector";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Canonical South Florida county FIPS codes (Broward, Miami-Dade, Palm Beach). */
const SOUTH_FLORIDA_FIPS = ["12011", "12086", "12099"] as const;

/** Maximum cohort size for Level 1. */
const LEVEL1_MAX_COHORT = 25;

/** Source adapter key used for ROI-cohort members (no canonical_source_links needed). */
const ROI_SOURCE_ADAPTER_KEY = "roi-cohort-selector";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Level1RoiCohortResult {
  /** true = newly frozen, false = already frozen (idempotent replay) */
  frozen: boolean;
  cohortFrozenHash: string;
  selectedCount: number;
  eligiblePoolSize: number;
  /** Top ROI scores in cohort order */
  roiScores: Array<{ businessId: number; score: number; vertical: string | null; countyFips: string | null }>;
  /** Exclusion summary from the ROI selector */
  excluded: {
    total: number;
    reasons: string[];
  };
  countyFips: string[];
  verticalIds: string[];
  scoreVersion: typeof ROI_SCORE_VERSION;
  selectedAt: string;
}

export interface Level1FreeEvidenceReport {
  pilotRunId: string;
  frozenAt: string | null;
  cohortSize: number;
  /** Businesses with at least one staged free_discovery_candidate */
  businessesWithCandidates: number;
  /** Businesses with no staged free_discovery_candidate */
  businessesWithoutCandidates: number;
  /** Total staged candidates across all cohort businesses */
  totalStagedCandidates: number;
  /** Per-business summary */
  perBusiness: Array<{
    businessId: number;
    vertical: string | null;
    countyFips: string | null;
    stagedCandidateCount: number;
    bestCandidateId: string | null;
    bestCandidateMasked: string | null;
    bestCandidateConfidence: number | null;
  }>;
}

// ── Canonical Level 1 definition ──────────────────────────────────────────────

/**
 * Convergently creates (or returns the existing) canonical Level 1 pilot
 * definition for the South Florida / five-vertical paid pilot.
 *
 * The definition fixes:
 *  - county_scope  = South Florida FIPS (configurable override via verticalIds param)
 *  - vertical_scope = five configured verticals (from system_settings)
 *  - source_adapter_filter = [] (ROI cohort selector does not use source adapters)
 *  - max_cohort_size = 25
 *  - paid_providers_allowed = {} (all false — Level 1 is free-only)
 */
export async function ensureLevel1PilotDefinition(opts: {
  countyScope?: string[];
  verticalScope?: string[];
  createdBy?: string;
} = {}): Promise<{ id: string; pilotDefinitionHash: string; countyScope: string[]; verticalScope: string[] }> {
  const countyScope = opts.countyScope ?? [...SOUTH_FLORIDA_FIPS];
  const verticalScope = opts.verticalScope ?? await loadPilotVerticalIds();
  const result = await createPilotDefinition({
    level: 1,
    countyScope,
    verticalScope,
    sourceAdapterFilter: [],   // ROI cohort selector reads directly from businesses
    maxCohortSize: LEVEL1_MAX_COHORT,
    enrichmentRecipeVersion: 1,
    paidProvidersAllowed: {},  // Level 1: all paid providers off
    stopConditionThresholds: {
      conflictPct: 20,
      apolloYieldPct: 0,
      zbUnknownPct: 100,
      spendCapMicros: 0,       // $0 spend cap — Level 1 is free-only
    },
    createdBy: opts.createdBy ?? "system:level1-roi-cohort",
  });
  return { ...result, countyScope, verticalScope };
}

// ── ROI-based cohort selection + freeze ──────────────────────────────────────

/**
 * Select the top-25 ROI-ranked businesses for a Level 1 pilot run and freeze
 * them as the run's cohort.  Idempotent: if the cohort is already frozen,
 * returns the existing hash without re-querying.
 *
 * This replaces selectDeterministicPilotCohort() for Level 1 runs:
 *  - reads from businesses + business_locations (no canonical_source_links needed)
 *  - works when master_leads contains zero rows
 *  - uses the pilot definition's county/vertical scope
 *  - enforces DBPR, existing-customer, bounce, opt-out, test/demo exclusions
 *  - freezes via the existing freezePilotCohort() (same idempotency and hash)
 */
export async function selectAndFreezeLevel1RoiCohort(
  pilotRunId: string,
): Promise<Level1RoiCohortResult> {
  const run = await getPilotRun(pilotRunId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");
  if (Number(run.level) !== 1) {
    throw new Error("LEVEL1_ROI_COHORT:run_is_not_level_1");
  }

  // Idempotent: if already frozen, return the existing state.
  if (run.cohort_frozen_hash) {
    const members = rows(await db.execute(sql`
      SELECT canonical_business_id AS business_id, vertical, county_fips
      FROM mi09_pilot_cohort_members WHERE pilot_run_id = ${pilotRunId}::uuid
      ORDER BY canonical_business_id ASC
    `));
    return {
      frozen: false,
      cohortFrozenHash: String(run.cohort_frozen_hash),
      selectedCount: members.length,
      eligiblePoolSize: members.length,
      roiScores: members.map((m: any) => ({
        businessId: Number(m.business_id),
        score: 0,
        vertical: m.vertical ?? null,
        countyFips: m.county_fips ?? null,
      })),
      excluded: { total: 0, reasons: [] },
      countyFips: [],
      verticalIds: [],
      scoreVersion: ROI_SCORE_VERSION,
      selectedAt: new Date().toISOString(),
    };
  }

  // Load the pilot definition's scope.
  const def = rows(await db.execute(sql`
    SELECT county_scope, vertical_scope, max_cohort_size
    FROM mi09_pilot_definitions WHERE id = ${String(run.pilot_definition_id)}::uuid
  `))[0];
  if (!def) throw new Error(`PILOT_DEFINITION_NOT_FOUND:${run.pilot_definition_id}`);

  const parseJsonb = (v: any): string[] => {
    if (!v) return [];
    if (typeof v === "string") return JSON.parse(v);
    return v as string[];
  };

  const countyFips = parseJsonb(def.county_scope);
  const verticalIds = parseJsonb(def.vertical_scope);
  const maxCohort = Number(def.max_cohort_size) || LEVEL1_MAX_COHORT;

  // Use the ROI cohort selector — reads directly from businesses + business_locations.
  const cohort = await selectRoiCohort({
    maxCohort,
    countyFips: countyFips.length > 0 ? countyFips : [...SOUTH_FLORIDA_FIPS],
    verticalIds: verticalIds.length > 0 ? verticalIds : await loadPilotVerticalIds(),
    persistScores: true,
    actorId: `level1-roi-cohort:${pilotRunId}`,
    now: new Date(),
  });

  if (cohort.eligible.length === 0) {
    throw new Error("COHORT_CENSUS_INSUFFICIENT:no_eligible_businesses_after_exclusions");
  }

  // Fetch county_fips and vertical for each selected business so we can pass
  // them through to freezePilotCohort() (which needs them for scope validation).
  const bizIds = cohort.eligible.map((c) => c.canonicalBusinessId);
  const bizDetailRows = rows(await db.execute(sql`
    SELECT
      b.id::int AS business_id,
      b.vertical,
      MIN(bl.county_fips) AS county_fips
    FROM businesses b
    LEFT JOIN business_locations bl ON bl.business_id = b.id
      AND bl.county_fips = ANY(ARRAY[${sql.join(
        (countyFips.length > 0 ? countyFips : [...SOUTH_FLORIDA_FIPS]).map((f) => sql`${f}`),
        sql`, `
      )}])
    WHERE b.id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
    GROUP BY b.id, b.vertical
  `));
  const bizDetail = new Map<number, { vertical: string | null; countyFips: string | null }>();
  for (const r of bizDetailRows) {
    bizDetail.set(Number(r.business_id), {
      vertical: r.vertical ?? null,
      countyFips: r.county_fips ?? null,
    });
  }

  // Build the member list for freezePilotCohort().
  const members = cohort.eligible.map((c) => {
    const detail = bizDetail.get(c.canonicalBusinessId) ?? { vertical: null, countyFips: null };
    return {
      canonicalBusinessId: c.canonicalBusinessId,
      sourceAdapterKey: ROI_SOURCE_ADAPTER_KEY,
      countyFips: detail.countyFips ?? undefined,
      vertical: detail.vertical ?? undefined,
    };
  });

  // Freeze via the existing authority (validates county/vertical/conflict exclusions).
  const freezeResult = await freezePilotCohort({ pilotRunId, members });

  const excluded = cohort.excluded;
  const exclusionReasons = [...new Set(excluded.map((e) => e.dispositionReason))];

  return {
    frozen: freezeResult.frozen,
    cohortFrozenHash: freezeResult.cohortFrozenHash,
    selectedCount: members.length,
    eligiblePoolSize: cohort.evaluated,
    roiScores: cohort.eligible.map((c) => ({
      businessId: c.canonicalBusinessId,
      score: c.roiScore,
      vertical: bizDetail.get(c.canonicalBusinessId)?.vertical ?? null,
      countyFips: bizDetail.get(c.canonicalBusinessId)?.countyFips ?? null,
    })),
    excluded: {
      total: excluded.length,
      reasons: exclusionReasons,
    },
    countyFips: cohort.countyFips,
    verticalIds: cohort.verticalIds,
    scoreVersion: cohort.scoreVersion,
    selectedAt: cohort.selectedAt,
  };
}

// ── Free-evidence report ──────────────────────────────────────────────────────

/**
 * Build a report of discovered free-evidence candidates for each frozen cohort
 * business.  Returns per-business counts and the best candidate masked value.
 * Never calls any paid provider.
 */
export async function getLevel1FreeEvidenceReport(
  pilotRunId: string,
): Promise<Level1FreeEvidenceReport> {
  const run = await getPilotRun(pilotRunId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");

  const members = rows(await db.execute(sql`
    SELECT canonical_business_id AS business_id, vertical, county_fips
    FROM mi09_pilot_cohort_members WHERE pilot_run_id = ${pilotRunId}::uuid
    ORDER BY canonical_business_id ASC
  `));

  if (members.length === 0) {
    return {
      pilotRunId,
      frozenAt: run.cohort_frozen_at ? new Date(run.cohort_frozen_at).toISOString() : null,
      cohortSize: 0,
      businessesWithCandidates: 0,
      businessesWithoutCandidates: 0,
      totalStagedCandidates: 0,
      perBusiness: [],
    };
  }

  const bizIds = members.map((m: any) => Number(m.business_id));

  // Find staged free_discovery_candidates for each business.
  const candidateRows = rows(await db.execute(sql`
    SELECT
      fdc.business_id::int AS business_id,
      COUNT(*)::int AS staged_count,
      (
        SELECT fdc2.id FROM free_discovery_candidates fdc2
        WHERE fdc2.business_id = fdc.business_id
          AND fdc2.disposition = 'staged'
        ORDER BY fdc2.confidence DESC, fdc2.created_at ASC
        LIMIT 1
      ) AS best_candidate_id,
      (
        SELECT fdc2.masked_value FROM free_discovery_candidates fdc2
        WHERE fdc2.business_id = fdc.business_id
          AND fdc2.disposition = 'staged'
        ORDER BY fdc2.confidence DESC, fdc2.created_at ASC
        LIMIT 1
      ) AS best_candidate_masked,
      (
        SELECT fdc2.confidence FROM free_discovery_candidates fdc2
        WHERE fdc2.business_id = fdc.business_id
          AND fdc2.disposition = 'staged'
        ORDER BY fdc2.confidence DESC, fdc2.created_at ASC
        LIMIT 1
      ) AS best_candidate_confidence
    FROM free_discovery_candidates fdc
    WHERE fdc.business_id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND fdc.disposition = 'staged'
    GROUP BY fdc.business_id
  `));

  const candidatesByBiz = new Map<number, any>();
  for (const r of candidateRows) {
    candidatesByBiz.set(Number(r.business_id), r);
  }

  let withCandidates = 0;
  let withoutCandidates = 0;
  let totalStaged = 0;

  const perBusiness = members.map((m: any) => {
    const bizId = Number(m.business_id);
    const cand = candidatesByBiz.get(bizId);
    const count = cand ? Number(cand.staged_count) : 0;
    totalStaged += count;
    if (count > 0) withCandidates++; else withoutCandidates++;
    return {
      businessId: bizId,
      vertical: m.vertical ?? null,
      countyFips: m.county_fips ?? null,
      stagedCandidateCount: count,
      bestCandidateId: cand?.best_candidate_id ? String(cand.best_candidate_id) : null,
      bestCandidateMasked: cand?.best_candidate_masked ?? null,
      bestCandidateConfidence: cand?.best_candidate_confidence != null
        ? Number(cand.best_candidate_confidence)
        : null,
    };
  });

  return {
    pilotRunId,
    frozenAt: run.cohort_frozen_at ? new Date(run.cohort_frozen_at).toISOString() : null,
    cohortSize: members.length,
    businessesWithCandidates: withCandidates,
    businessesWithoutCandidates: withoutCandidates,
    totalStagedCandidates: totalStaged,
    perBusiness,
  };
}
