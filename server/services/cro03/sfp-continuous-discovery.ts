/**
 * Continuous, restart-safe SFP paid-discovery + validation orchestrator.
 *
 * Closes the one real automation gap in the SFP pipeline: paid Serper
 * domain-discovery and ZeroBounce validation previously only ran via manual
 * admin "arm pilot" / execute calls (1-25 businesses at a time). Free
 * classification (sfp-free-classification-continuation.ts) and campaign
 * staging (sfp-campaign-staging-worker.ts) were already fully automated
 * recurring workers — this file adds the missing middle two stages using the
 * exact same reservation/settlement/idempotency machinery those manual routes
 * already use. It invents no new authority: every write here goes through
 * the existing $50 aggregate-budget gate, provider_controls caps, identity
 * quarantine, cooldown exclusion, and the sfp_outreach_eligibility /
 * ready_held boundary.
 *
 * Each tick does a small bounded amount of work and returns. It never
 * enables transport/credentials, never raises the $50 cap or any provider
 * cap, never bypasses quarantine/cooldown, and never enrolls or sends.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  getProgramReadOnly,
  freezeCohort,
} from "./south-florida-prospecting";
import { previewSfpPaidWaterfall, executeSfpSerperDiscovery } from "./sfp-paid-waterfall";
import { previewSfpValidation, executeSfpValidation } from "./sfp-validation";
import { assertAggregatePaidBudgetAvailable } from "../mi09-pilot-authority";
import { getSfpProviderReadiness } from "./sfp-provider-operations";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

// Matches the existing admin "arm pilot" ceiling (lead-ops.ts:3344) — this
// worker never requests a larger batch than an operator was ever allowed to.
const SERPER_BATCH_PER_TICK = 10;
const VALIDATION_BATCH_PER_TICK = 25; // SFP_VALIDATION_MAX enforced again inside executeSfpValidation

function hourBucket(): string {
  return new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh — one attempt per cohort per hour
}

async function auditTick(action: string, outcome: string, details: Record<string, unknown>) {
  await db.execute(sql`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
    VALUES ('system', ${action}, 'sfp_program', 'south_florida_v2',
            ${JSON.stringify({ outcome, ...details })}::jsonb, 'system', 'sfp-continuous-discovery')
  `).catch(() => {});
}

export interface SfpContinuousDiscoveryTickResult {
  ran: boolean;
  reason?: string;
  cohortRunId?: string;
  newlyFrozen?: boolean;
  processed?: number;
  succeeded?: number;
  failed?: number;
  noResult?: number;
}

/** Rolling cohort rotation + bounded Serper discovery. */
export async function processSfpContinuousDiscoveryTick(): Promise<SfpContinuousDiscoveryTickResult> {
  if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true" || !process.env.SERPER_API_KEY) {
    return { ran: false, reason: "transport_or_credential_unavailable" };
  }
  const program = await getProgramReadOnly();
  if (!program || !program.isActive) {
    return { ran: false, reason: "program_inactive" };
  }
  try {
    await assertAggregatePaidBudgetAvailable();
  } catch (err: any) {
    await auditTick("sfp_continuous_discovery_tick", "budget_exhausted", { error: String(err?.message ?? err) });
    return { ran: false, reason: "aggregate_budget_exhausted" };
  }

  // Durable-paused fast path: check the shared provider_controls gate BEFORE
  // touching any cohort or stage row. A disabled/exhausted/open-circuit
  // provider must never freeze a new cohort, claim a stage, or attempt a
  // reservation — doing so previously stranded a cohort in a 'partial' stage
  // that every later tick within the same hour bucket could not reclaim
  // (SFP_STAGE_ALREADY_RUNNING). This makes "paused" its own quiet, resumable
  // outcome distinct from "failed": nothing is written except one audit row,
  // and the very next tick after the provider is re-enabled resumes the same
  // frozen cohort's remaining Serper-eligible work with no operator action.
  const readiness = await getSfpProviderReadiness("serper");
  if (!readiness.ready) {
    await auditTick("sfp_continuous_discovery_tick", "provider_paused", { reason: readiness.reason });
    return { ran: false, reason: `provider_paused:${readiness.reason}` };
  }

  // 1) Reuse an existing usable frozen cohort if it still has Serper-eligible
  // work (respects the same terminal/cooldown/quarantine exclusions the
  // manual preview route uses).
  const candidates = rows(await db.execute(sql`
    SELECT id FROM sfp_cohort_runs
     WHERE program_id = ${program.id}::uuid AND cohort_state='frozen'
       AND voided_at IS NULL AND superseded_at IS NULL
     ORDER BY frozen_at DESC LIMIT 10
  `));
  let cohortRunId: string | null = null;
  for (const c of candidates) {
    try {
      const preview = await previewSfpPaidWaterfall(String(c.id));
      if (preview.businessesNeedingPaidDiscovery > 0 && preview.serperEligibleNow > 0) {
        cohortRunId = String(c.id);
        break;
      }
    } catch { /* unusable cohort — try the next candidate */ }
  }

  // 2) No usable cohort with remaining eligible work — roll forward to the
  // next batch (bounded to the program's own max_cohort_size, same as an
  // operator freezing a new cohort by hand).
  let newlyFrozen = false;
  if (!cohortRunId) {
    try {
      const freeze = await freezeCohort({
        idempotencyKey: `sfp-continuous:${program.id}:${hourBucket()}`,
        actorId: "system:sfp-continuous-discovery",
      });
      cohortRunId = freeze.run.id;
      newlyFrozen = freeze.newlyFrozen;
    } catch (err: any) {
      await auditTick("sfp_continuous_discovery_tick", "freeze_failed", { error: String(err?.message ?? err) });
      return { ran: false, reason: "no_usable_cohort_and_freeze_failed" };
    }
  }
  if (!cohortRunId) return { ran: false, reason: "no_eligible_cohort" };

  // 3) Bounded, idempotent Serper batch for this cohort. internalSkipPreviewCheck
  // is the same seam the arm-pilot route would otherwise satisfy with a
  // client-supplied preview hash — safe here because this worker always
  // (re)computes eligibility itself immediately beforehand.
  try {
    const result = await executeSfpSerperDiscovery({
      cohortRunId,
      idempotencyKey: `sfp-continuous:${cohortRunId}:serper:${hourBucket()}`,
      actorId: "system:sfp-continuous-discovery",
      maxBusinesses: SERPER_BATCH_PER_TICK,
      internalSkipPreviewCheck: true,
    });
    await auditTick("sfp_continuous_discovery_tick", "discovery_completed", {
      cohortRunId, newlyFrozen, processed: result.processed, succeeded: result.succeeded,
      failed: result.failed, noResult: result.noResult,
    });
    return {
      ran: true, cohortRunId, newlyFrozen,
      processed: result.processed, succeeded: result.succeeded, failed: result.failed, noResult: result.noResult,
    };
  } catch (err: any) {
    await auditTick("sfp_continuous_discovery_tick", "discovery_failed", { cohortRunId, error: String(err?.message ?? err) });
    return { ran: true, cohortRunId, newlyFrozen, reason: "discovery_failed" };
  }
}

export interface SfpContinuousValidationTickResult {
  ran: boolean;
  reason?: string;
  cohortRunId?: string;
  addressesValidated?: number;
  validCount?: number;
}

/** Bounded ZeroBounce validation for whichever frozen cohort has candidates
 * ready to validate. Staging (ready_held) is already fully automated by
 * sfp-campaign-staging-worker.ts once rows reach validated_outreach_eligible
 * — this tick only needs to feed that queue. */
export async function processSfpContinuousValidationTick(): Promise<SfpContinuousValidationTickResult> {
  const program = await getProgramReadOnly();
  if (!program || !program.isActive) return { ran: false, reason: "program_inactive" };
  if (process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED !== "true") {
    return { ran: false, reason: "validation_promotion_disabled" };
  }
  const readiness = await getSfpProviderReadiness("zerobounce");
  if (!readiness.ready) {
    await auditTick("sfp_continuous_validation_tick", "provider_paused", { reason: readiness.reason });
    return { ran: false, reason: `provider_paused:${readiness.reason}` };
  }

  const candidates = rows(await db.execute(sql`
    SELECT id FROM sfp_cohort_runs
     WHERE program_id = ${program.id}::uuid AND cohort_state='frozen'
       AND voided_at IS NULL AND superseded_at IS NULL
     ORDER BY frozen_at DESC LIMIT 10
  `));
  for (const c of candidates) {
    const cohortRunId = String(c.id);
    try {
      const preview = await previewSfpValidation(cohortRunId);
      if (!preview.gateOpen || preview.selectedCandidates.length === 0) continue;
      const result = await executeSfpValidation(cohortRunId, {
        idempotencyKey: `sfp-continuous:${cohortRunId}:validate:${hourBucket()}`,
        actorId: "system:sfp-continuous-discovery",
        maxValidations: VALIDATION_BATCH_PER_TICK,
        snapshotHash: preview.snapshotHash,
      });
      await auditTick("sfp_continuous_validation_tick", "validation_completed", {
        cohortRunId, addressesValidated: result.addressesValidated, validCount: result.validCount,
      });
      return { ran: true, cohortRunId, addressesValidated: result.addressesValidated, validCount: result.validCount };
    } catch (err: any) {
      await auditTick("sfp_continuous_validation_tick", "validation_failed", { cohortRunId, error: String(err?.message ?? err) });
      // try the next cohort candidate rather than failing the whole tick
    }
  }
  return { ran: false, reason: "no_cohort_with_validation_work" };
}
