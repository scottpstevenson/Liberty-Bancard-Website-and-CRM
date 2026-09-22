/**
 * south-florida-prospecting.ts
 *
 * Independent South Florida Prospecting program.
 *
 * Works when:
 *   - master_leads = 0
 *   - No MI-09 pilot run exists
 *   - No CRO-03A qualification handoff exists
 *   - No paid provider has run
 *
 * Operator flow:
 *   1. ensureProgram()           → idempotent program definition
 *   2. previewFunnel()           → read-only funnel / ROI preview
 *   3. freezeCohort()            → deterministic cohort freeze (idempotent)
 *   4. runFreeDiscovery()        → no-cost evidence collection
 *   5. previewPaidEscalation()   → cost preview per provider
 *   6. executePaidWaterfall()    → operator-authorized bounded paid run
 *   7. previewValidation()       → ZeroBounce preview + cost
 *   8. executeValidation()       → bounded validation via canonical admission
 *   9. stageForCampaign()        → idempotent, re-checks all gates
 *
 * All paid stages require explicit operator authorization; no automatic sending.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { createHash } from "crypto";
import { selectRoiCohort, loadPilotVerticalIds, type RoiCohortSelection } from "./roi-cohort-selector";
import { unseal as unsealCandidateEvidence } from "./candidate-evidence-service";
import { CRO03A_COUNTY_FIPS } from "../cro03a/geography";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

const PROGRAM_NAME = "south-florida-v1";
const SOUTH_FLORIDA_FIPS = Object.values(CRO03A_COUNTY_FIPS);
const SFP_POLICY_VERSION = 1;

// ── Outreach eligibility status enum ──────────────────────────────────────────
export type OutreachEligibilityStatus =
  | "validated_outreach_eligible"
  | "validated_review_required"
  | "validated_suppressed"
  | "validated_existing_relationship"
  | "validated_policy_ineligible"
  | "validation_pending"
  | "catch_all_review"
  | "invalid"
  | "discovery_required";

// ── Program ────────────────────────────────────────────────────────────────────

export interface SfpProgram {
  id: string;
  name: string;
  countyFips: string[];
  verticalIds: string[];
  maxCohortSize: number;
  policyVersion: number;
  isActive: boolean;
  recurringEnabled: boolean;
  activatedAt: string | null;
  createdAt: string;
  createdBy: string;
}

/**
 * Idempotent program definition. Creates or returns the existing program.
 * The program starts inactive — operator must explicitly activate after publish.
 */
export async function ensureProgram(opts: {
  createdBy?: string;
  maxCohortSize?: number;
} = {}): Promise<SfpProgram> {
  const verticalIds = await loadPilotVerticalIds();
  const countyFips = [...SOUTH_FLORIDA_FIPS];

  const existing = rows(await db.execute(sql`
    SELECT * FROM sfp_programs WHERE name = ${PROGRAM_NAME} LIMIT 1
  `))[0];

  if (existing) {
    // Converge the mutable program definition to the current canonical
    // vertical/county configuration. Frozen cohort members remain immutable.
    const converged = rows(await db.execute(sql`
      UPDATE sfp_programs
         SET county_fips=ARRAY[${sql.join(countyFips.map((f) => sql`${f}`), sql`, `)}],
             vertical_ids=ARRAY[${sql.join(verticalIds.map((v) => sql`${v}`), sql`, `)}],
             policy_version=${SFP_POLICY_VERSION}
       WHERE id=${String(existing.id)}::uuid
       RETURNING *
    `))[0];
    return _mapProgram(converged);
  }

  const created = rows(await db.execute(sql`
    INSERT INTO sfp_programs
      (name, county_fips, vertical_ids, max_cohort_size, policy_version, is_active, created_by)
    VALUES (
      ${PROGRAM_NAME},
      ARRAY[${sql.join(countyFips.map((f) => sql`${f}`), sql`, `)}],
      ARRAY[${sql.join(verticalIds.map((v) => sql`${v}`), sql`, `)}],
      ${opts.maxCohortSize ?? 100},
      ${SFP_POLICY_VERSION},
      false,
      ${opts.createdBy ?? "system:sfp"}
    )
    ON CONFLICT (name) DO UPDATE SET max_cohort_size = EXCLUDED.max_cohort_size
    RETURNING *
  `))[0];

  return _mapProgram(created ?? existing);
}

function _mapProgram(row: any): SfpProgram {
  return {
    id: String(row.id),
    name: String(row.name),
    countyFips: Array.isArray(row.county_fips) ? row.county_fips : JSON.parse(row.county_fips ?? "[]"),
    verticalIds: Array.isArray(row.vertical_ids) ? row.vertical_ids : JSON.parse(row.vertical_ids ?? "[]"),
    maxCohortSize: Number(row.max_cohort_size ?? 100),
    policyVersion: Number(row.policy_version ?? 1),
    isActive: Boolean(row.is_active),
    recurringEnabled: Boolean(row.recurring_enabled),
    activatedAt: row.activated_at ? String(row.activated_at) : null,
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
  };
}

/** Explicit operator-owned activation. Credentials never activate this program. */
export async function setProgramActivation(input: {
  active: boolean;
  actorId: string;
  recurringEnabled?: boolean;
}): Promise<SfpProgram> {
  const program = await ensureProgram({ createdBy: input.actorId });
  const updated = rows(await db.execute(sql`
    UPDATE sfp_programs
       SET is_active = ${input.active},
           recurring_enabled = ${input.active && input.recurringEnabled === true},
           activated_at = CASE WHEN ${input.active} THEN NOW() ELSE activated_at END,
           activated_by = CASE WHEN ${input.active} THEN ${input.actorId} ELSE activated_by END
     WHERE id = ${program.id}::uuid
     RETURNING *
  `))[0];
  await db.execute(sql`
    INSERT INTO audit_logs (action, entity_type, entity_key, actor_type, actor_id, details)
    VALUES ('sfp_program_activation_changed', 'sfp_program', ${program.id}, 'user', ${input.actorId},
            ${JSON.stringify({ active: input.active, recurringEnabled: input.active && input.recurringEnabled === true })}::jsonb)
  `);
  return _mapProgram(updated);
}

// ── Funnel preview (read-only) ─────────────────────────────────────────────────

export interface SfpFunnelPreview {
  program: SfpProgram;
  funnel: RoiCohortSelection["funnel"];
  topCandidates: Array<{
    businessId: number;
    roiScore: number;
    geographyClass: string;
    geographySource: string;
    vertical: string | null;
    countyFips: string | null;
    eligible: boolean;
    dispositionReason: string;
  }>;
  verticalIds: string[];
  countyFips: string[];
  capturedAt: string;
}

export async function previewFunnel(opts: {
  maxPreview?: number;
  programId?: string;
} = {}): Promise<SfpFunnelPreview> {
  const program = await ensureProgram();
  if (!program.isActive) throw new Error("SFP_PROGRAM_INACTIVE:activate_the_program_before_freezing_a_cohort");
  const result = await selectRoiCohort({
    maxCohort: opts.maxPreview ?? 25,
    verticalIds: program.verticalIds,
    countyFips: program.countyFips,
    persistScores: false,
    includeGeographyUnresolved: false,
  });

  return {
    program,
    funnel: result.funnel,
    topCandidates: result.eligible.map((c) => ({
      businessId: c.canonicalBusinessId,
      roiScore: c.roiScore,
      geographyClass: c.geographyClass,
      geographySource: c.geographySource,
      vertical: c.vertical,
      countyFips: c.countyFips,
      eligible: c.eligible,
      dispositionReason: c.dispositionReason,
    })),
    verticalIds: result.verticalIds,
    countyFips: result.countyFips,
    capturedAt: result.selectedAt,
  };
}

// ── Cohort freeze ──────────────────────────────────────────────────────────────

export interface SfpCohortRun {
  id: string;
  programId: string;
  idempotencyKey: string;
  status: string;
  cohortSize: number;
  cohortHash: string | null;
  frozenAt: string | null;
  releaseSha: string;
  actorId: string;
  createdAt: string;
}

export async function freezeCohort(opts: {
  idempotencyKey: string;
  actorId: string;
  maxCohortSize?: number;
  releaseSha?: string;
}): Promise<{ run: SfpCohortRun; newlyFrozen: boolean; funnel: RoiCohortSelection["funnel"] }> {
  // Idempotency check
  const existing = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE idempotency_key = ${opts.idempotencyKey} LIMIT 1
  `))[0];
  if (existing?.cohort_hash) {
    return {
      run: _mapRun(existing),
      newlyFrozen: false,
      funnel: { totalScanned: 0, southFlorida: 0, outsideGeography: 0, geographyUnresolved: 0,
                inTargetVertical: 0, verticalUnresolved: 0, dbprExcluded: 0, existingCustomer: 0,
                testDemoInternal: 0, suppressed: 0, bouncedInvalidOnly: 0, inactiveEntity: 0,
                eligibleAfterExclusions: 0 },
    };
  }

  const program = await ensureProgram();

  // Create draft run row
  const runRow = rows(await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (program_id, idempotency_key, status, actor_id, release_sha)
    VALUES (${program.id}::uuid, ${opts.idempotencyKey}, 'freezing',
            ${opts.actorId}, ${opts.releaseSha ?? process.env.RELEASE_SHA ?? ""})
    ON CONFLICT (idempotency_key) DO UPDATE SET status = 'freezing'
    RETURNING *
  `))[0];
  const runId = String(runRow.id);

  try {
    // ROI selection — all businesses, no pre-rank limit
    const result = await selectRoiCohort({
      maxCohort: opts.maxCohortSize ?? program.maxCohortSize,
      verticalIds: program.verticalIds,
      countyFips: program.countyFips,
      persistScores: true,
      actorId: opts.actorId,
    });

    if (result.eligible.length === 0) {
      // Build a human-readable reason from the funnel
      const f = result.funnel;
      let zeroReason = "no_eligible_businesses_after_exclusions";
      if (f.totalScanned === 0) zeroReason = "no_businesses_in_database";
      else if (f.southFlorida === 0) zeroReason = "no_south_florida_businesses_found:check_geography_fields";
      else if (f.inTargetVertical === 0) zeroReason = `no_businesses_in_target_verticals:${result.verticalIds.join(",")}`;
      else if (f.dbprExcluded > 0) zeroReason = `all_eligible_businesses_dbpr_excluded:count=${f.dbprExcluded}`;
      else if (f.existingCustomer > 0) zeroReason = `all_eligible_businesses_existing_customer:count=${f.existingCustomer}`;
      else if (f.eligibleAfterExclusions === 0) zeroReason = `zero_after_all_exclusions:scanned=${f.totalScanned},sf=${f.southFlorida},vertical=${f.inTargetVertical}`;

      await db.execute(sql`
        UPDATE sfp_cohort_runs SET status = 'error', error_detail = ${zeroReason}
        WHERE id = ${runId}::uuid
      `);
      throw new Error(`COHORT_CENSUS_INSUFFICIENT:${zeroReason}`);
    }

    // Insert cohort members
    for (const c of result.eligible) {
      await db.execute(sql`
        INSERT INTO sfp_cohort_members
          (cohort_run_id, business_id, roi_score, geography_class, geography_source,
           county_fips, vertical, exclusion_reason)
        VALUES (${runId}::uuid, ${c.canonicalBusinessId}, ${c.roiScore},
                ${c.geographyClass}, ${c.geographySource}, ${c.countyFips}, ${c.vertical}, ${null})
        ON CONFLICT (cohort_run_id, business_id) DO NOTHING
      `);
    }

    // Compute cohort hash
    const cohortHash = createHash("sha256")
      .update(result.eligible.map((c) => c.canonicalBusinessId).sort().join(","))
      .digest("hex");

    await db.execute(sql`
      UPDATE sfp_cohort_runs
      SET status = 'frozen', cohort_size = ${result.eligible.length},
          cohort_hash = ${cohortHash}, frozen_at = NOW()
      WHERE id = ${runId}::uuid
    `);

    // Persist funnel snapshot
    const f = result.funnel;
    await db.execute(sql`
      INSERT INTO sfp_funnel_snapshots
        (cohort_run_id, total_businesses, south_florida, outside_geography,
         geography_unresolved, in_target_vertical, vertical_unresolved,
         dbpr_excluded, suppressed, bounced_invalid_only, existing_customer, test_demo_internal, inactive_entity,
         outreach_eligible, selected_frozen)
      VALUES (${runId}::uuid, ${f.totalScanned}, ${f.southFlorida}, ${f.outsideGeography},
              ${f.geographyUnresolved}, ${f.inTargetVertical}, ${f.verticalUnresolved},
              ${f.dbprExcluded}, ${f.suppressed}, ${f.bouncedInvalidOnly}, ${f.existingCustomer}, ${f.testDemoInternal}, ${f.inactiveEntity},
              ${f.eligibleAfterExclusions}, ${result.eligible.length})
      ON CONFLICT (cohort_run_id) DO UPDATE SET
        total_businesses = EXCLUDED.total_businesses,
        south_florida = EXCLUDED.south_florida,
        outside_geography = EXCLUDED.outside_geography,
        geography_unresolved = EXCLUDED.geography_unresolved,
        in_target_vertical = EXCLUDED.in_target_vertical,
        vertical_unresolved = EXCLUDED.vertical_unresolved,
        dbpr_excluded = EXCLUDED.dbpr_excluded,
        suppressed = EXCLUDED.suppressed,
        bounced_invalid_only = EXCLUDED.bounced_invalid_only,
        existing_customer = EXCLUDED.existing_customer,
        test_demo_internal = EXCLUDED.test_demo_internal,
        inactive_entity = EXCLUDED.inactive_entity,
        outreach_eligible = EXCLUDED.outreach_eligible,
        selected_frozen = EXCLUDED.selected_frozen
    `);

    const updatedRun = rows(await db.execute(sql`
      SELECT * FROM sfp_cohort_runs WHERE id = ${runId}::uuid LIMIT 1
    `))[0];

    return { run: _mapRun(updatedRun), newlyFrozen: true, funnel: result.funnel };
  } catch (err) {
    await db.execute(sql`
      UPDATE sfp_cohort_runs SET status = 'error', error_detail = ${(err as Error).message}
      WHERE id = ${runId}::uuid AND status != 'frozen'
    `);
    throw err;
  }
}

function _mapRun(row: any): SfpCohortRun {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status),
    cohortSize: Number(row.cohort_size ?? 0),
    cohortHash: row.cohort_hash ? String(row.cohort_hash) : null,
    frozenAt: row.frozen_at ? String(row.frozen_at) : null,
    releaseSha: String(row.release_sha ?? ""),
    actorId: String(row.actor_id),
    createdAt: String(row.created_at),
  };
}

// ── Free discovery report ─────────────────────────────────────────────────────

export interface SfpFreeEvidenceReport {
  cohortRunId: string;
  cohortSize: number;
  businessesWithCandidates: number;
  businessesWithoutCandidates: number;
  totalCandidates: number;
  perBusiness: Array<{
    businessId: number;
    candidateCount: number;
    bestCandidateMasked: string | null;
    bestCandidateConfidence: number | null;
    disposition: string;
  }>;
  capturedAt: string;
}

export async function getFreeEvidenceReport(cohortRunId: string): Promise<SfpFreeEvidenceReport> {
  const runRow = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (!runRow.cohort_hash) throw new Error("SFP_COHORT_NOT_FROZEN");

  const members = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members
    WHERE cohort_run_id = ${cohortRunId}::uuid
    ORDER BY roi_score DESC
  `));
  const bizIds = members.map((m: any) => Number(m.business_id));
  if (bizIds.length === 0) {
    return { cohortRunId, cohortSize: 0, businessesWithCandidates: 0, businessesWithoutCandidates: 0,
             totalCandidates: 0, perBusiness: [], capturedAt: new Date().toISOString() };
  }

  const candidateRows = rows(await db.execute(sql`
    SELECT
      fdc.business_id,
      COUNT(*)::int AS candidate_count,
      MAX(fdc.confidence) AS best_confidence,
      (SELECT fdc2.masked_value FROM free_discovery_candidates fdc2
       WHERE fdc2.business_id = fdc.business_id AND fdc2.disposition IN ('staged', 'validation_admitted')
       ORDER BY fdc2.confidence DESC, fdc2.created_at ASC LIMIT 1) AS best_masked,
      (SELECT fdc2.disposition FROM free_discovery_candidates fdc2
       WHERE fdc2.business_id = fdc.business_id
       ORDER BY fdc2.confidence DESC LIMIT 1) AS top_disposition
    FROM free_discovery_candidates fdc
    WHERE fdc.business_id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND fdc.disposition IN ('staged', 'validation_admitted')
    GROUP BY fdc.business_id
  `));

  const candMap = new Map<number, any>();
  for (const r of candidateRows) candMap.set(Number(r.business_id), r);

  let withCandidates = 0;
  let totalCandidates = 0;
  const perBusiness = bizIds.map((bizId) => {
    const cand = candMap.get(bizId);
    if (cand) {
      withCandidates++;
      totalCandidates += Number(cand.candidate_count);
      return {
        businessId: bizId,
        candidateCount: Number(cand.candidate_count),
        bestCandidateMasked: cand.best_masked ? String(cand.best_masked) : null,
        bestCandidateConfidence: cand.best_confidence ? Number(cand.best_confidence) : null,
        disposition: String(cand.top_disposition ?? "staged"),
      };
    }
    return { businessId: bizId, candidateCount: 0, bestCandidateMasked: null, bestCandidateConfidence: null, disposition: "no_candidate" };
  });

  return {
    cohortRunId,
    cohortSize: bizIds.length,
    businessesWithCandidates: withCandidates,
    businessesWithoutCandidates: bizIds.length - withCandidates,
    totalCandidates,
    perBusiness,
    capturedAt: new Date().toISOString(),
  };
}

export interface SfpFreeDiscoveryResult {
  stageRunId: string;
  cohortRunId: string;
  selected: number;
  enriched: number;
  failed: number;
  skipped: number;
  replayed: boolean;
  completedAt: string;
}

/**
 * Execute the real free-only crawler for a frozen ROI cohort. This is not a
 * report endpoint: it calls the canonical free lane and durably records the
 * bounded stage run. The free lane's paid-provider kill line remains intact.
 */
export async function runSfpFreeDiscovery(input: {
  cohortRunId: string;
  idempotencyKey: string;
  actorId: string;
  maxBusinesses?: number;
}): Promise<SfpFreeDiscoveryResult> {
  const maxBusinesses = Math.max(1, Math.min(500, Number(input.maxBusinesses ?? 100)));
  const cohort = rows(await db.execute(sql`
    SELECT r.id, r.cohort_hash, p.is_active
      FROM sfp_cohort_runs r JOIN sfp_programs p ON p.id = r.program_id
     WHERE r.id = ${input.cohortRunId}::uuid
  `))[0];
  if (!cohort) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (!cohort.cohort_hash) throw new Error("SFP_COHORT_NOT_FROZEN");
  if (!cohort.is_active) throw new Error("SFP_PROGRAM_INACTIVE");

  const existing = rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='free_discovery' AND idempotency_key=${input.idempotencyKey} LIMIT 1
  `))[0];
  if (existing?.state === "completed") {
    return {
      stageRunId: String(existing.id), cohortRunId: input.cohortRunId,
      selected: Number(existing.selected_count), enriched: Number(existing.succeeded_count),
      failed: Number(existing.failed_count), skipped: Number(existing.skipped_count),
      replayed: true, completedAt: String(existing.completed_at),
    };
  }

  const stage = existing ?? rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs
      (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, started_at, last_heartbeat_at)
    VALUES (${input.cohortRunId}::uuid, 'free_discovery', ${input.idempotencyKey}, ${input.actorId},
            'running', ${maxBusinesses}, NOW(), NOW())
    ON CONFLICT (stage, idempotency_key) DO UPDATE
      SET state=CASE WHEN sfp_stage_runs.state IN ('failed','stalled','partial') THEN 'running' ELSE sfp_stage_runs.state END,
          last_heartbeat_at=NOW(), updated_at=NOW()
    RETURNING *
  `))[0];

  const members = rows(await db.execute(sql`
    SELECT m.business_id
      FROM sfp_cohort_members m
      JOIN businesses b ON b.id=m.business_id
     WHERE m.cohort_run_id=${input.cohortRunId}::uuid
       AND b.record_class='canonical'
       AND b.website_domain IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM sfp_stage_items i
          WHERE i.stage_run_id=${String(stage.id)}::uuid AND i.business_id=m.business_id
            AND i.provider='first_party_web' AND i.state IN ('completed','no_result','skipped')
       )
     ORDER BY m.roi_score DESC, m.business_id ASC
     LIMIT ${maxBusinesses}
  `));
  const businessIds = members.map((m: any) => Number(m.business_id));
  await db.execute(sql`
    UPDATE sfp_stage_runs SET selected_count=${businessIds.length}, last_heartbeat_at=NOW(), updated_at=NOW()
     WHERE id=${String(stage.id)}::uuid
  `);
  for (const businessId of businessIds) {
    await db.execute(sql`
      INSERT INTO sfp_stage_items (stage_run_id,business_id,provider,state)
      VALUES (${String(stage.id)}::uuid,${businessId},'first_party_web','pending')
      ON CONFLICT (stage_run_id,business_id,provider) DO NOTHING
    `);
  }

  const { runFreeEnrichmentLane } = await import("../free-enrichment-lane");
  let laneResults: Awaited<ReturnType<typeof runFreeEnrichmentLane>> = [];
  try {
    laneResults = await runFreeEnrichmentLane(businessIds);
  } catch (error: any) {
    await db.execute(sql`
      UPDATE sfp_stage_runs SET state='failed', terminal_reason=${String(error?.message ?? error).slice(0, 200)},
             completed_at=NOW(),updated_at=NOW() WHERE id=${String(stage.id)}::uuid
    `);
    throw error;
  }
  const enriched = laneResults.filter((r) => r.outcome === "enriched").length;
  const failed = laneResults.filter((r) => r.outcome === "failed").length;
  const skipped = laneResults.filter((r) => r.outcome === "skipped").length;
  for (const result of laneResults) {
    await db.execute(sql`
      UPDATE sfp_stage_items SET state=${result.outcome === "enriched" ? "completed" : result.outcome === "failed" ? "failed" : "skipped"},
             outcome_code=${result.error ?? result.outcome},completed_at=NOW(),updated_at=NOW()
       WHERE stage_run_id=${String(stage.id)}::uuid AND business_id=${result.businessId} AND provider='first_party_web'
    `);
  }
  const completedAt = new Date().toISOString();
  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failed > 0 ? "partial" : "completed"},processed_count=${laneResults.length},
           succeeded_count=${enriched},failed_count=${failed},skipped_count=${skipped},
           last_heartbeat_at=NOW(),completed_at=${completedAt}::timestamptz,updated_at=NOW()
     WHERE id=${String(stage.id)}::uuid
  `);
  return { stageRunId: String(stage.id), cohortRunId: input.cohortRunId, selected: businessIds.length,
           enriched, failed, skipped, replayed: false, completedAt };
}

// ── Validated outreach prospects ───────────────────────────────────────────────

export interface ValidatedProspect {
  businessId: number;
  businessName: string | null;
  normalizedVertical: string | null;
  county: string | null;
  roiScore: number;
  maskedEmail: string | null;
  namedContact: boolean;
  roleInbox: boolean;
  discoverySource: string | null;
  evidenceConfidence: number | null;
  validationStatus: OutreachEligibilityStatus;
  validationAt: string | null;
  validationAgeDays: number | null;
  zbOutcome: string | null;
  suppressionStatus: string;
  outreachPolicyStatus: string;
  exclusionReason: string | null;
  campaignStagedAt: string | null;
  policyVersion: number;
}

export async function getValidatedProspects(opts: {
  cohortRunId: string;
  filters?: {
    county?: string;
    vertical?: string;
    namedContact?: boolean;
    roleInbox?: boolean;
    status?: OutreachEligibilityStatus;
    source?: string;
    outreachEligible?: boolean;
    reviewRequired?: boolean;
  };
  limit?: number;
  offset?: number;
}): Promise<{ prospects: ValidatedProspect[]; total: number; byCohort: Record<string, number> }> {
  const { cohortRunId, filters = {}, limit = 50, offset = 0 } = opts;

  let whereClause = sql`soe.cohort_run_id = ${cohortRunId}::uuid`;
  if (filters.county) whereClause = sql`${whereClause} AND scm.county_fips = ${filters.county}`;
  if (filters.vertical) whereClause = sql`${whereClause} AND b.vertical = ${filters.vertical}`;
  if (filters.source) whereClause = sql`${whereClause} AND soe.discovery_source = ${filters.source}`;
  if (filters.namedContact !== undefined) whereClause = sql`${whereClause} AND soe.named_contact = ${filters.namedContact}`;
  if (filters.roleInbox !== undefined) whereClause = sql`${whereClause} AND soe.role_inbox = ${filters.roleInbox}`;
  if (filters.status) whereClause = sql`${whereClause} AND soe.status = ${filters.status}`;
  if (filters.outreachEligible) whereClause = sql`${whereClause} AND soe.status = 'validated_outreach_eligible'`;
  if (filters.reviewRequired) whereClause = sql`${whereClause} AND soe.status IN ('validated_review_required','catch_all_review')`;

  const prospectRows = rows(await db.execute(sql`
    SELECT
      soe.*,
      b.canonical_name AS business_name,
      b.vertical AS business_vertical,
      scm.roi_score,
      scm.county_fips,
      scm.geography_class
    FROM sfp_outreach_eligibility soe
    JOIN sfp_cohort_members scm ON scm.cohort_run_id = soe.cohort_run_id
      AND scm.business_id = soe.business_id
    JOIN businesses b ON b.id = soe.business_id
    WHERE ${whereClause}
    ORDER BY scm.roi_score DESC, soe.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  const totalRow = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM sfp_outreach_eligibility soe
    WHERE ${whereClause}
  `))[0];

  const statusRows = rows(await db.execute(sql`
    SELECT status, COUNT(*)::int AS cnt
    FROM sfp_outreach_eligibility
    WHERE cohort_run_id = ${cohortRunId}::uuid
    GROUP BY status
  `));
  const byCohort: Record<string, number> = {};
  for (const r of statusRows) byCohort[String(r.status)] = Number(r.cnt);

  const prospects: ValidatedProspect[] = prospectRows.map((r: any) => ({
    businessId: Number(r.business_id),
    businessName: r.business_name ? String(r.business_name) : null,
    normalizedVertical: r.business_vertical ? String(r.business_vertical) : null,
    county: r.county_fips ? String(r.county_fips) : null,
    roiScore: Number(r.roi_score ?? 0),
    maskedEmail: r.masked_email ? String(r.masked_email) : null,
    namedContact: Boolean(r.named_contact),
    roleInbox: Boolean(r.role_inbox),
    discoverySource: r.discovery_source ? String(r.discovery_source) : null,
    evidenceConfidence: r.evidence_confidence ? Number(r.evidence_confidence) : null,
    validationStatus: r.status as OutreachEligibilityStatus,
    validationAt: r.validation_at ? String(r.validation_at) : null,
    validationAgeDays: r.validation_age_days ? Number(r.validation_age_days) : null,
    zbOutcome: r.zb_outcome ? String(r.zb_outcome) : null,
    suppressionStatus: String(r.suppression_status ?? "unchecked"),
    outreachPolicyStatus: r.status === "validated_outreach_eligible" ? "eligible" : "ineligible",
    exclusionReason: r.decision_reason ? String(r.decision_reason) : null,
    campaignStagedAt: r.campaign_staged_at ? String(r.campaign_staged_at) : null,
    policyVersion: Number(r.policy_version ?? 1),
  }));

  return { prospects, total: Number(totalRow?.cnt ?? 0), byCohort };
}

// ── Campaign staging ───────────────────────────────────────────────────────────

export interface CampaignStagingPreview {
  cohortRunId: string;
  eligibleCount: number;
  alreadyStagedCount: number;
  willStageCount: number;
  ineligibleCount: number;
  ineligibleReasons: Record<string, number>;
  capturedAt: string;
}

export interface CampaignStagingResult {
  cohortRunId: string;
  idempotencyKey: string;
  created: number;
  skipped: number;
  rejected: number;
  reasons: Record<string, number>;
  /** Always true — this action never sends email/SMS/GHL outreach */
  zeroOutreachConfirmed: true;
  completedAt: string;
}

/**
 * Preview campaign staging for eligible prospects.
 * Read-only; no mutations.
 */
export async function previewCampaignStaging(cohortRunId: string): Promise<CampaignStagingPreview> {
  const statusRows = rows(await db.execute(sql`
    SELECT status, COUNT(*)::int AS cnt
    FROM sfp_outreach_eligibility
    WHERE cohort_run_id = ${cohortRunId}::uuid
    GROUP BY status
  `));

  const byCohort: Record<string, number> = {};
  for (const r of statusRows) byCohort[String(r.status)] = Number(r.cnt);

  const eligibleCount = byCohort["validated_outreach_eligible"] ?? 0;
  const alreadyStagedCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM sfp_outreach_eligibility
    WHERE cohort_run_id = ${cohortRunId}::uuid
      AND campaign_staged_at IS NOT NULL
  `))[0]?.cnt ?? 0;

  const willStageCount = Math.max(0, eligibleCount - Number(alreadyStagedCount));
  const ineligibleCount = Object.values(byCohort).reduce((s, v) => s + v, 0) - eligibleCount;

  const reasons: Record<string, number> = {};
  for (const [status, cnt] of Object.entries(byCohort)) {
    if (status !== "validated_outreach_eligible") reasons[status] = cnt;
  }

  return {
    cohortRunId,
    eligibleCount,
    alreadyStagedCount: Number(alreadyStagedCount),
    willStageCount,
    ineligibleCount,
    ineligibleReasons: reasons,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Stage selected eligible prospects for campaign.
 *
 * Per-prospect gates re-verified at execution time:
 *   - validation_status = validated_outreach_eligible
 *   - validation freshness (< 90 days)
 *   - suppression re-check
 *   - DBPR re-check
 *   - existing customer re-check
 *   - cold-outreach policy
 *
 * No email is sent. No sequence is enrolled. No GHL write occurs.
 * Outbound remains paused unless separately authorized.
 */
export async function stageForCampaign(opts: {
  cohortRunId: string;
  idempotencyKey: string;
  actorId: string;
  businessIds?: number[];  // if omitted, stage all eligible
}): Promise<CampaignStagingResult> {
  const { cohortRunId, idempotencyKey, actorId } = opts;

  let whereExtra = sql``;
  if (opts.businessIds && opts.businessIds.length > 0) {
    whereExtra = sql`AND business_id = ANY(ARRAY[${sql.join(opts.businessIds.map((id) => sql`${id}::int`), sql`, `)}])`;
  }

  const eligibleRows = rows(await db.execute(sql`
    SELECT soe.id, soe.business_id, soe.candidate_id, soe.status, soe.zb_outcome,
           soe.validation_at, soe.masked_email, soe.role_inbox, soe.campaign_staged_at,
           soe.decision_reason,fdc.normalized_value_hash,
           b.canonical_name,b.website_domain,b.main_phone,b.vertical,b.city,b.state
    FROM sfp_outreach_eligibility soe
    JOIN free_discovery_candidates fdc ON fdc.id=soe.candidate_id
    JOIN businesses b ON b.id=soe.business_id
    WHERE soe.cohort_run_id = ${cohortRunId}::uuid
      AND soe.status = 'validated_outreach_eligible'
      ${whereExtra}
  `));

  let created = 0;
  let skipped = 0;
  let rejected = 0;
  const reasons: Record<string, number> = {};

  for (const row of eligibleRows) {
    // Already staged (idempotent)
    if (row.campaign_staged_at) {
      skipped++;
      reasons["already_staged"] = (reasons["already_staged"] ?? 0) + 1;
      continue;
    }

    // Freshness check (90-day max)
    if (row.validation_at) {
      const validationDate = new Date(String(row.validation_at));
      const ageDays = (Date.now() - validationDate.getTime()) / 86400000;
      if (ageDays > 90) {
        rejected++;
        reasons["validation_stale"] = (reasons["validation_stale"] ?? 0) + 1;
        // Downgrade status
        await db.execute(sql`
          UPDATE sfp_outreach_eligibility
          SET status = 'validation_pending', decision_reason = 'validation_expired_>90d',
              updated_at = NOW()
          WHERE id = ${String(row.id)}::uuid
        `);
        continue;
      }
    }

    // Re-check DBPR
    const dbprCheck = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM contacts con
      JOIN contact_source_events cse ON cse.contact_id = con.id
      WHERE con.business_id = ${Number(row.business_id)}
        AND cse.source_type = 'dbpr'
    `))[0];
    if (Number(dbprCheck?.cnt) > 0) {
      rejected++;
      reasons["dbpr_excluded"] = (reasons["dbpr_excluded"] ?? 0) + 1;
      await db.execute(sql`
        UPDATE sfp_outreach_eligibility
        SET status = 'validated_policy_ineligible', decision_reason = 'dbpr_excluded_at_staging',
            updated_at = NOW()
        WHERE id = ${String(row.id)}::uuid
      `);
      continue;
    }

    // Re-check existing customer
    const custCheck = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM sdr_merchants
      WHERE business_id = ${Number(row.business_id)} AND existing_customer_flag = true
    `))[0];
    if (Number(custCheck?.cnt) > 0) {
      rejected++;
      reasons["existing_customer"] = (reasons["existing_customer"] ?? 0) + 1;
      await db.execute(sql`
        UPDATE sfp_outreach_eligibility
        SET status = 'validated_existing_relationship', decision_reason = 'existing_customer_at_staging',
            updated_at = NOW()
        WHERE id = ${String(row.id)}::uuid
      `);
      continue;
    }

    // Re-check the canonical contact suppression/bounce surface at the final
    // staging boundary. A provider-valid result is deliverability evidence;
    // it never overrides an opt-out, complaint, hard bounce, or DNC marker.
    const suppressionCheck = rows(await db.execute(sql`
      SELECT EXISTS(
        SELECT 1
        FROM contacts c
        WHERE c.email_token_hash = ${String(row.normalized_value_hash)}
          AND (
            COALESCE(c.opted_out_email, FALSE) = TRUE
            OR c.opt_out_status = 'opted_out'
            OR c.unsubscribe_status = 'unsubscribed'
            OR c.complaint_status = 'reported'
            OR COALESCE(c.do_not_auto_contact, FALSE) = TRUE
            OR c.suppression_reason IS NOT NULL
            OR c.bounce_status = 'hard'
            OR c.email_status IN ('bounced', 'invalid')
          )
      ) AS suppressed
    `))[0];
    if (suppressionCheck?.suppressed === true) {
      rejected++;
      reasons["suppressed_at_staging"] = (reasons["suppressed_at_staging"] ?? 0) + 1;
      await db.execute(sql`
        UPDATE sfp_outreach_eligibility
        SET status = 'validated_suppressed', decision_reason = 'suppressed_at_staging',
            suppression_status = 'suppressed', updated_at = NOW()
        WHERE id = ${String(row.id)}::uuid
      `);
      continue;
    }

    if (!row.candidate_id) {
      rejected++;
      reasons["candidate_missing"] = (reasons["candidate_missing"] ?? 0) + 1;
      continue;
    }
    const plaintextEmail = await decryptCandidateEmail(String(row.candidate_id));
    if (!plaintextEmail) {
      rejected++;
      reasons["candidate_decryption_failed"] = (reasons["candidate_decryption_failed"] ?? 0) + 1;
      continue;
    }
    const contactEmailTokenHash = createHash("sha256")
      .update(plaintextEmail.trim().toLowerCase())
      .digest("hex");
    const plaintextSuppression = rows(await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM contacts c
         WHERE c.email_token_hash = ${contactEmailTokenHash}
           AND (
             COALESCE(c.opted_out_email, FALSE) = TRUE
             OR c.opt_out_status = 'opted_out'
             OR c.unsubscribe_status = 'unsubscribed'
             OR c.complaint_status = 'reported'
             OR COALESCE(c.do_not_auto_contact, FALSE) = TRUE
             OR c.suppression_reason IS NOT NULL
             OR c.bounce_status = 'hard'
             OR c.email_status IN ('bounced', 'invalid')
           )
      ) AS suppressed
    `))[0];
    if (plaintextSuppression?.suppressed === true) {
      rejected++;
      reasons["suppressed_at_staging"] = (reasons["suppressed_at_staging"] ?? 0) + 1;
      await db.execute(sql`
        UPDATE sfp_outreach_eligibility
           SET status='validated_suppressed',decision_reason='suppressed_at_staging',
               suppression_status='suppressed',updated_at=NOW()
         WHERE id=${String(row.id)}::uuid
      `);
      continue;
    }
    // Create a real, durable staging intent. This is intentionally still a
    // no-send boundary: campaign/GHL workers do not consume this table.
    const intent = rows(await db.execute(sql`
      INSERT INTO sfp_campaign_staging_intents
        (cohort_run_id,eligibility_id,business_id,candidate_id,idempotency_key,actor_id,
         state,policy_version,validation_snapshot,lineage)
      VALUES (${cohortRunId}::uuid,${String(row.id)}::uuid,${Number(row.business_id)},
              ${String(row.candidate_id)}::uuid,${idempotencyKey},${actorId},'staged',${SFP_POLICY_VERSION},
              ${JSON.stringify({ zbOutcome: row.zb_outcome, validationAt: row.validation_at, status: row.status })}::jsonb,
              ${JSON.stringify({ source: "sfp", cohortRunId, eligibilityId: String(row.id) })}::jsonb)
      ON CONFLICT (cohort_run_id,business_id,candidate_id) DO UPDATE SET updated_at=NOW()
      RETURNING id
    `))[0];
    const masterLead = rows(await db.execute(sql`
      INSERT INTO master_leads
        (status,company,normalized_company,domain,email,email_type,phone,vertical,
         outreach_readiness,readiness_reason,source,source_path,city,state,website,email_valid,
         pipeline_origin,canonical_business_id,email_token_hash,masked_email,created_at,updated_at)
      VALUES ('staged',${row.canonical_name},LOWER(TRIM(${row.canonical_name})),${row.website_domain},${plaintextEmail},
              ${row.role_inbox ? "role" : "business"},${row.main_phone},${row.vertical},
              'not_ready','awaiting_explicit_campaign_authorization','sfp_validated',
              ${`sfp:${cohortRunId}:${String(row.candidate_id)}`},${row.city},${row.state},${row.website_domain},TRUE,
              'sfp_pipeline',${Number(row.business_id)},${contactEmailTokenHash},${row.masked_email},NOW(),NOW())
      ON CONFLICT (canonical_business_id,email_token_hash)
        WHERE pipeline_origin='sfp_pipeline' AND canonical_business_id IS NOT NULL AND email_token_hash IS NOT NULL
      DO UPDATE SET status='staged',email_valid=TRUE,masked_email=EXCLUDED.masked_email,updated_at=NOW()
      RETURNING id
    `))[0];
    await db.execute(sql`
      UPDATE sfp_outreach_eligibility
         SET campaign_staged_at=NOW(),campaign_staged_by=${actorId},staging_intent_id=${String(intent.id)}::uuid,updated_at=NOW()
       WHERE id=${String(row.id)}::uuid
    `);
    await db.execute(sql`
      UPDATE sfp_campaign_staging_intents SET master_lead_id=${String(masterLead.id)}::uuid,updated_at=NOW()
       WHERE id=${String(intent.id)}::uuid
    `);
    created++;
  }

  return {
    cohortRunId,
    idempotencyKey,
    created,
    skipped,
    rejected,
    reasons,
    zeroOutreachConfirmed: true,
    completedAt: new Date().toISOString(),
  };
}

// ── Cohort run list ────────────────────────────────────────────────────────────

export async function listCohortRuns(opts: {
  programId?: string;
  limit?: number;
} = {}): Promise<SfpCohortRun[]> {
  const program = await ensureProgram();
  const rows2 = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs
    WHERE program_id = ${program.id}::uuid
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 20}
  `));
  return rows2.map(_mapRun);
}

export async function getCohortRun(cohortRunId: string): Promise<SfpCohortRun | null> {
  const row = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  return row ? _mapRun(row) : null;
}

// ── Decryption helper for validation (authorized boundary) ─────────────────────

/**
 * Decrypt a candidate's real email address for ZeroBounce validation.
 * Uses the candidate-evidence envelope boundary — never exposes plaintext
 * in logs, API responses, or telemetry.
 */
export async function decryptCandidateEmail(candidateId: string): Promise<string | null> {
  const candRow = rows(await db.execute(sql`
    SELECT
      id, business_id, field, envelope_ciphertext, envelope_nonce,
      envelope_tag, envelope_key_version, masked_value
    FROM free_discovery_candidates
    WHERE id = ${candidateId}::uuid LIMIT 1
  `))[0];

  if (!candRow) return null;
  if (!candRow.envelope_ciphertext || !candRow.envelope_nonce || !candRow.envelope_tag) {
    // No encrypted envelope — cannot validate
    return null;
  }

  try {
    const decrypted = unsealCandidateEvidence("email", {
      ciphertext: String(candRow.envelope_ciphertext),
      nonce: String(candRow.envelope_nonce),
      tag: String(candRow.envelope_tag),
      keyVersion: Number(candRow.envelope_key_version ?? 1),
    });
    return decrypted;
  } catch (err: any) {
    console.warn(`[SFP] Candidate decryption failed for ${candidateId}: ${err?.message}`);
    return null;
  }
}
