/**
 * Continuous, restart-safe SFP paid-discovery + validation orchestrator.
 *
 * Closes the one real automation gap in the SFP pipeline: paid Serper
 * domain-discovery and ZeroBounce validation previously only ran via manual
 * admin "arm pilot" / execute calls (1-25 businesses at a time), and even
 * after being automated here, each tick call did exactly ONE bounded batch
 * (10 Serper lookups / 25 validations) and returned — with a 10-minute
 * repeat interval that made those small fixed batches the real throughput
 * throughput ceiling for the whole pipeline.
 *
 * Each exported tick function now DRAINS: it keeps taking bounded, safe,
 * idempotent batches back-to-back — rotating across every frozen cohort with
 * outstanding work and freezing new cohorts as needed — until one of its own
 * stop conditions fires (provider health, or a
 * wall-clock time budget safely inside the
 * queue's own repeat interval and lock/lease durations). It invents no new
 * authority: every write still goes through provider enable/circuit controls,
 * identity quarantine, cooldown
 * exclusion, and the sfp_outreach_eligibility / ready_held boundary.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { previewRoiCohort } from "./roi-cohort-selector";
import {
  getProgramReadOnly,
  freezeCohort,
  isSfpValidationPromotionEnabled,
} from "./south-florida-prospecting";
import { previewSfpPaidWaterfall, executeSfpSerperDiscovery, executeSfpPaidPersonAndIdentityDiscovery } from "./sfp-paid-waterfall";
import { previewSfpValidation, executeSfpValidation } from "./sfp-validation";
import { getSfpProviderReadiness } from "./sfp-provider-operations";
import { getSfpCohortGapSnapshot } from "./sfp-cost-preview";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

// Per-call safety ceiling (matches the historical admin "arm pilot" ceiling
// at lead-ops.ts:3344 / the executeSfpSerperDiscovery internal cap of 25).
// This is NOT the tick's overall throughput — see the drain loops below,
// which call this repeatedly until a real stop condition fires.
const SERPER_BATCH_PER_CALL = 10;
const VALIDATION_BATCH_PER_CALL = 25; // SFP_VALIDATION_MAX enforced again inside executeSfpValidation

// Wall-clock ceiling per tick invocation. Both continuous ticks repeat every
// 10 minutes (queue-manager.ts NAMED_QUEUE_SCHEDULES); this budget keeps a
// single tick well inside that window so a draining tick never overlaps the
// next scheduled invocation or outlives its own bounded lease.
const DRAIN_TIME_BUDGET_MS = 7 * 60 * 1000;
// Safety valve: even with a genuinely huge backlog and no provider pause,
// cap the number of provider calls a single tick will attempt so a runaway
// loop (e.g. a bug that keeps finding "eligible" work that never clears)
// cannot spin indefinitely inside the time budget.
const MAX_CALLS_PER_TICK = 200;
// Phase 1 (Serper) gets at most this much of the overall drain window. A
// large Serper backlog must never consume the whole tick and starve Phase 2
// (Outscraper/Apollo) — those providers are independently enabled
// on their own, and previously got zero real calls in production ticks
// where Serper alone filled DRAIN_TIME_BUDGET_MS. Phase 2 always gets the
// remainder of the overall window (DRAIN_TIME_BUDGET_MS - this, or more if
// Phase 1 finishes early), never less.
const PHASE1_TIME_BUDGET_MS = 4 * 60 * 1000;

function deadline(): number {
  return Date.now() + DRAIN_TIME_BUDGET_MS;
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
  cohortRunIds?: string[];
  newlyFrozenCount?: number;
  calls?: number;
  providerRequests?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  noResult?: number;
  waterfallProcessed?: number;
  waterfallSucceeded?: number;
  waterfallFailed?: number;
  stopReason?: string;
  waterfallStopReason?: string;
  elapsedMs?: number;
}

/** A durable monotonically increasing retry key derived from cohort history.
 * COUNT(*) is read before the freeze; concurrent ticks choose the same key
 * and freezeCohort's existing per-key lock/replay contract collapses them. */
async function nextContinuousAdmissionKey(programId: string): Promise<string> {
  const prior = rows(await db.execute(sql`
    SELECT COUNT(*)::bigint AS run_count
      FROM sfp_cohort_runs WHERE program_id=${programId}::uuid
  `))[0];
  return `sfp-continuous:${programId}:admission:${Number(prior?.run_count ?? 0) + 1}`;
}

/** Per-cohort stage-attempt keys persist in stage history, not the wall clock. */
async function nextStageAttemptKey(cohortRunId: string, stage: string, suffix: string): Promise<string> {
  const prior = rows(await db.execute(sql`
    SELECT COUNT(*)::bigint AS run_count
      FROM sfp_stage_runs WHERE cohort_run_id=${cohortRunId}::uuid AND stage=${stage}
  `))[0];
  return `sfp-continuous:${cohortRunId}:${suffix}:${Number(prior?.run_count ?? 0) + 1}`;
}

/** Rolling cohort rotation + a bounded-time DRAIN of Serper discovery work. */
export async function processSfpContinuousDiscoveryTick(): Promise<SfpContinuousDiscoveryTickResult> {
  const program = await getProgramReadOnly();
  if (!program || !program.isActive) {
    return { ran: false, reason: "program_inactive" };
  }

  const end = deadline();
  // Phase 1 stops at whichever is sooner: its own bounded share of the tick,
  // or the overall tick deadline. This guarantees Phase 2 always gets the
  // remainder of `end` (at least DRAIN_TIME_BUDGET_MS - PHASE1_TIME_BUDGET_MS)
  // even when Phase 1's backlog alone could fill the whole tick.
  const phase1End = Math.min(end, Date.now() + PHASE1_TIME_BUDGET_MS);
  const cohortRunIds = new Set<string>();
  let newlyFrozenCount = 0;
  let calls = 0, providerRequests = 0, processed = 0, succeeded = 0, failed = 0, noResult = 0;
  let waterfallProcessed = 0, waterfallSucceeded = 0, waterfallFailed = 0;
  let stopReason = "drain_complete";
  // Tracks cohorts already confirmed to have no remaining work THIS tick, so
  // we don't re-preview them on every loop iteration once they're drained.
  const exhaustedCohorts = new Set<string>();
  let sawWorkThisTick = false;

  // Cohort admission is intentionally independent of Serper readiness and
  // UTC-hour buckets. Use the selector's durable never-frozen count so
  // inventory continues to enter bounded cohorts while discovery providers
  // are paused. freezeCohort persists each sequence key and serializes
  // concurrent identical attempts; failed attempts consume a key because
  // their durable failed run remains part of the sequence.
  try {
    const admission = await previewRoiCohort({
      maxCohort: program.maxCohortSize,
      maxPreview: program.maxCohortSize,
      verticalIds: program.verticalIds,
      countyFips: program.countyFips,
      taxonomyVersion: program.taxonomyVersion,
      policyVersion: program.policyVersion,
    });
    if (admission.unadmittedEligibleCount > 0) {
      const freeze = await freezeCohort({
        idempotencyKey: await nextContinuousAdmissionKey(program.id),
        actorId: "system:sfp-continuous-discovery",
      });
      if (freeze.newlyFrozen) newlyFrozenCount++;
      cohortRunIds.add(freeze.run.id);
    }
  } catch (err: any) {
    await auditTick("sfp_continuous_discovery_tick", "admission_failed", {
      error: String(err?.message ?? err),
    });
  }

  while (Date.now() < phase1End && calls < MAX_CALLS_PER_TICK) {
    // Durable-paused fast path: check the shared provider_controls gate
    // BEFORE touching any cohort or stage row. A disabled/exhausted/open-
    // circuit provider must never freeze a new cohort, claim a stage, or
    // attempt a reservation — this makes "paused" its own quiet, resumable
    // outcome: nothing is written except one audit row, and the very next
    // tick after the provider is re-enabled resumes remaining work.
    const readiness = await getSfpProviderReadiness("serper");
    if (!readiness.ready) {
      stopReason = `provider_paused:${readiness.reason}`;
      await auditTick("sfp_continuous_discovery_tick", "provider_paused", { reason: readiness.reason });
      break;
    }

    // Reuse any older frozen cohort with remaining Serper-eligible work.
    // New cohort admission already ran independently above, before checking
    // provider readiness.
    let claimed: { cohortRunId: string; newlyFrozen: boolean } | null = null;
    const reusableAll = rows(await db.execute(sql`
      SELECT id FROM sfp_cohort_runs
       WHERE program_id = ${program.id}::uuid AND cohort_state='frozen'
         AND voided_at IS NULL AND superseded_at IS NULL AND cohort_size > 0
        ORDER BY COALESCE((SELECT MAX(s.last_heartbeat_at) FROM sfp_stage_runs s
                            WHERE s.cohort_run_id=sfp_cohort_runs.id AND s.stage IN ('paid_waterfall','serper_discovery')),frozen_at) ASC,
                 frozen_at ASC,id ASC
    `));
    const reusable = reusableAll.filter((c: any) => !exhaustedCohorts.has(String(c.id)));
    for (const c of reusable) {
      try {
        const preview = await previewSfpPaidWaterfall(String(c.id));
        if (preview.businessesNeedingPaidDiscovery > 0 && preview.serperEligibleNow > 0) {
          claimed = { cohortRunId: String(c.id), newlyFrozen: false };
          break;
        }
        exhaustedCohorts.add(String(c.id));
      } catch { exhaustedCohorts.add(String(c.id)); }
    }
    if (!claimed) { stopReason = sawWorkThisTick ? "no_further_cohorts_available" : "no_eligible_cohort"; break; }
    const { cohortRunId } = claimed;

    try {
      calls++;
      const result = await executeSfpSerperDiscovery({
        cohortRunId,
        idempotencyKey: await nextStageAttemptKey(cohortRunId, "paid_waterfall", "serper"),
        actorId: "system:sfp-continuous-discovery",
        maxBusinesses: SERPER_BATCH_PER_CALL,
        internalSkipPreviewCheck: true,
      });
      providerRequests += Number(result.providerRequests ?? 0);
      cohortRunIds.add(cohortRunId);
      processed += result.processed;
      succeeded += result.succeeded;
      failed += result.failed;
      noResult += result.noResult ?? 0;
      if (result.processed === 0) {
        // Nothing left for this cohort right now — don't spin on it again
        // this tick; move on to the next cohort (or a fresh freeze).
        exhaustedCohorts.add(cohortRunId);
      } else {
        sawWorkThisTick = true;
      }
    } catch (err: any) {
      await auditTick("sfp_continuous_discovery_tick", "discovery_failed", { cohortRunId, error: String(err?.message ?? err) });
      exhaustedCohorts.add(cohortRunId);
      // Try the next cohort/freeze rather than aborting the whole drain.
    }
  }

  if (Date.now() >= phase1End) {
    stopReason = phase1End < end ? "phase1_time_budget_exhausted" : "time_budget_exhausted";
  }
  if (calls >= MAX_CALLS_PER_TICK) stopReason = "max_calls_per_tick_reached";

  // ── Phase 2: person/identity escalation (Outscraper business-identity gap
  // + Apollo named-decision-maker gap) ──────────────────────────────────────
  // Deliberately a SEPARATE drain from Phase 1, not nested inside the Serper
  // loop above. Serper, Outscraper, and Apollo are independent providers with
  // independent provider_controls rows (enabled/circuit) and independent
  // gap dimensions (domain vs. business-identity vs. named decision-maker) —
  // an open Serper circuit must never block
  // Outscraper/Apollo from running, and vice versa. Cohort selection here is
  // therefore NOT filtered by serperEligibleNow; any active frozen cohort with
  // members is a candidate, and executeSfpPaidPersonAndIdentityDiscovery
  // itself decides per-business, per-provider whether that business's specific
  // gap is still open before reserving an operation. Each provider's own
  // readiness (enabled/circuit/credential) is checked BEFORE the call
  // so a disabled provider is a quiet, resumable skip — never a
  // wasted reservation attempt or a tick abort. This never touches
  // free_discovery_candidates and reuses the same operation receipt and
  // settlement authority as Serper.
  const waterfallCohortRunIds = new Set<string>();
  let waterfallStopReason = "drain_complete";
  const waterfallExhausted = new Set<string>();
  // Phase 2 gets its OWN call budget, separate from Phase 1's `calls` counter.
  // Sharing MAX_CALLS_PER_TICK between phases would let Phase 1 exhaust the
  // entire tick's call allowance well within its own time budget (each
  // Serper batch call is fast), leaving zero calls for Outscraper/Apollo even
  // though PHASE1_TIME_BUDGET_MS reserved them plenty of time.
  let waterfallCalls = 0;
  if (program.isActive) {
    while (Date.now() < end && waterfallCalls < MAX_CALLS_PER_TICK) {
      const [outscraperReady, apolloReady] = await Promise.all([
        getSfpProviderReadiness("outscraper"),
        getSfpProviderReadiness("apollo"),
      ]);
      if (!outscraperReady.ready && !apolloReady.ready) {
        waterfallStopReason = `provider_paused:outscraper=${outscraperReady.reason}|apollo=${apolloReady.reason}`;
        await auditTick("sfp_continuous_discovery_tick", "person_identity_provider_paused", {
          outscraperReason: outscraperReady.reason, apolloReason: apolloReady.reason,
        });
        break;
      }

      const candidatesAll = rows(await db.execute(sql`
        SELECT id FROM sfp_cohort_runs
         WHERE program_id = ${program.id}::uuid AND cohort_state='frozen'
           AND voided_at IS NULL AND superseded_at IS NULL AND cohort_size > 0
         ORDER BY COALESCE((SELECT MAX(s.last_heartbeat_at) FROM sfp_stage_runs s
                             WHERE s.cohort_run_id=sfp_cohort_runs.id AND s.stage='paid_waterfall'),frozen_at) ASC,
                  frozen_at ASC,id ASC
      `));
      const candidates = candidatesAll.filter((c: any) => !waterfallExhausted.has(String(c.id)));
      if (candidates.length === 0) { waterfallStopReason = "no_cohort_with_person_identity_work"; break; }

      let madeProgressThisPass = false;
      for (const c of candidates) {
        if (Date.now() >= end || waterfallCalls >= MAX_CALLS_PER_TICK) break;
        const cohortRunId = String(c.id);
        try {
          const snapshot = await getSfpCohortGapSnapshot(cohortRunId);
          waterfallCalls++;
          const waterfallResult = await executeSfpPaidPersonAndIdentityDiscovery({
            cohortRunId,
            idempotencyKey: await nextStageAttemptKey(cohortRunId, "paid_waterfall", "waterfall"),
            actorId: "system:sfp-continuous-discovery",
            maxBusinesses: 25,
            previewSnapshotHash: snapshot.snapshotHash,
            includeSerperDiscovery: false,
            enabledProviders: [
              ...(outscraperReady.ready ? ["outscraper" as const] : []),
              ...(apolloReady.ready ? ["apollo" as const] : []),
            ],
          });
          providerRequests += Number(waterfallResult.providerRequests ?? 0);
          waterfallCohortRunIds.add(cohortRunId);
          waterfallProcessed += waterfallResult.processed;
          waterfallSucceeded += waterfallResult.succeeded;
          waterfallFailed += waterfallResult.failed;
          if (waterfallResult.processed > 0) {
            madeProgressThisPass = true;
          } else {
            waterfallExhausted.add(cohortRunId);
          }
        } catch (err: any) {
          if (String(err?.message ?? err) === "SFP_STAGE_ALREADY_RUNNING") {
            // Another concurrent worker already owns this cohort's waterfall
            // stage this tick — not an error, just try the next cohort.
          } else {
            await auditTick("sfp_continuous_discovery_tick", "person_identity_discovery_failed", {
              cohortRunId, error: String(err?.message ?? err),
            });
          }
          waterfallExhausted.add(cohortRunId);
        }
      }
      if (!madeProgressThisPass) { waterfallStopReason = "no_cohort_with_person_identity_work"; break; }
    }
    if (Date.now() >= end) waterfallStopReason = "time_budget_exhausted";
    if (waterfallCalls >= MAX_CALLS_PER_TICK) waterfallStopReason = "max_calls_per_tick_reached";
  } else {
    waterfallStopReason = "program_inactive";
  }
  for (const id of waterfallCohortRunIds) cohortRunIds.add(id);

  const summary = {
    ran: calls > 0 || waterfallCalls > 0 || newlyFrozenCount > 0,
    cohortRunIds: [...cohortRunIds],
    newlyFrozenCount,
    calls, providerRequests, processed, succeeded, failed, noResult,
    waterfallProcessed, waterfallSucceeded, waterfallFailed,
    stopReason, waterfallStopReason,
    elapsedMs: DRAIN_TIME_BUDGET_MS - Math.max(0, end - Date.now()),
  };
  await auditTick("sfp_continuous_discovery_tick", "drain_completed", summary);
  return summary;
}

export interface SfpContinuousValidationTickResult {
  ran: boolean;
  reason?: string;
  cohortRunIds?: string[];
  calls?: number;
  addressesValidated?: number;
  providerRequests?: number;
  validCount?: number;
  stopReason?: string;
  elapsedMs?: number;
}

/** Bounded-time DRAIN of ZeroBounce validation across every frozen cohort
 * with candidates ready to validate. Staging (ready_held) is already fully
 * automated by sfp-campaign-staging-worker.ts once rows reach
 * validated_outreach_eligible — this tick only needs to feed that queue,
 * as fast as provider health and the bounded tick allow. */
export async function processSfpContinuousValidationTick(): Promise<SfpContinuousValidationTickResult> {
  const program = await getProgramReadOnly();
  if (!program || !program.isActive) return { ran: false, reason: "program_inactive" };
  if (!(await isSfpValidationPromotionEnabled())) {
    return { ran: false, reason: "validation_promotion_disabled" };
  }

  const end = deadline();
  const cohortRunIds = new Set<string>();
  let calls = 0, addressesValidated = 0, providerRequests = 0, validCount = 0;
  let stopReason = "drain_complete";
  const exhaustedCohorts = new Set<string>();

  while (Date.now() < end && calls < MAX_CALLS_PER_TICK) {
    const readiness = await getSfpProviderReadiness("zerobounce");
    if (!readiness.ready) {
      stopReason = `provider_paused:${readiness.reason}`;
      await auditTick("sfp_continuous_validation_tick", "provider_paused", { reason: readiness.reason });
      break;
    }

    const candidatesAll = rows(await db.execute(sql`
      SELECT id FROM sfp_cohort_runs
       WHERE program_id = ${program.id}::uuid AND cohort_state='frozen'
         AND voided_at IS NULL AND superseded_at IS NULL AND cohort_size > 0
       ORDER BY COALESCE((SELECT MAX(s.last_heartbeat_at) FROM sfp_stage_runs s
                           WHERE s.cohort_run_id=sfp_cohort_runs.id AND s.stage='validation'),frozen_at) ASC,
                frozen_at ASC,id ASC
    `));
    const candidates = candidatesAll.filter((c: any) => !exhaustedCohorts.has(String(c.id)));
    if (candidates.length === 0) { stopReason = "no_cohort_with_validation_work"; break; }

    let madeProgressThisPass = false;
    for (const c of candidates) {
      if (Date.now() >= end || calls >= MAX_CALLS_PER_TICK) break;
      const cohortRunId = String(c.id);
      try {
        const preview = await previewSfpValidation(cohortRunId);
        if (!preview.gateOpen || preview.selectedCandidates.length === 0) {
          exhaustedCohorts.add(cohortRunId);
          continue;
        }
        calls++;
        const result = await executeSfpValidation(cohortRunId, {
          idempotencyKey: await nextStageAttemptKey(cohortRunId, "validation", "validate"),
          actorId: "system:sfp-continuous-discovery",
          maxValidations: VALIDATION_BATCH_PER_CALL,
          snapshotHash: preview.snapshotHash,
        });
        cohortRunIds.add(cohortRunId);
        addressesValidated += result.addressesValidated;
        providerRequests += result.providerRequests;
        validCount += result.validCount;
        madeProgressThisPass = true;
        await auditTick("sfp_continuous_validation_tick", "validation_batch_completed", {
          cohortRunId, addressesValidated: result.addressesValidated, validCount: result.validCount,
        });
        if (result.addressesValidated === 0) exhaustedCohorts.add(cohortRunId);
      } catch (err: any) {
        await auditTick("sfp_continuous_validation_tick", "validation_failed", { cohortRunId, error: String(err?.message ?? err) });
        exhaustedCohorts.add(cohortRunId);
      }
    }
    if (!madeProgressThisPass) { stopReason = "no_cohort_with_validation_work"; break; }
  }

  if (Date.now() >= end) stopReason = "time_budget_exhausted";
  if (calls >= MAX_CALLS_PER_TICK) stopReason = "max_calls_per_tick_reached";

  const summary = {
    ran: calls > 0,
    cohortRunIds: [...cohortRunIds],
    calls, addressesValidated, providerRequests, validCount,
    stopReason,
    elapsedMs: DRAIN_TIME_BUDGET_MS - Math.max(0, end - Date.now()),
  };
  await auditTick("sfp_continuous_validation_tick", "drain_completed", summary);
  return summary;
}
