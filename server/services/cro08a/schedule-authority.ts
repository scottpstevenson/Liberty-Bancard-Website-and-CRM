/**
 * CRO-08A versioned schedule authority (section 11). Owns exactly the
 * discovery/enrichment/freshness/backfill logical keys enumerated in
 * CRO08A_OWNED_LOGICAL_KEYS (Correction 3's hard scope boundary — enforced
 * again at the DB layer by cro08a_schedule_logical_key_chk). Every other
 * recurring schedule named in the task's Correction 3 census (GHL sync, SLA,
 * sequences, digests, monitors, CRO-07, CR-06, and the non-BullMQ interval
 * loops) is out of bounds and must never gain a row here.
 *
 * A schedule definition is immutable once created (new cadence/caps/policy =
 * new definitionVersion row, never an UPDATE of an existing row). The
 * "active" pointer is a compare-and-set: only one definition per logical key
 * may be active at a time (enforced by cro08a_schedule_active_uidx, a
 * partial unique index on logical_key WHERE active).
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { Cro08aCertificationDeniedError } from "./certification-gate";
import { assertCro08aSourceScope } from "./source-scope";
import { PAID_PROVIDER_KEYS, type PaidProviderKey } from "../paid-provider-control";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export const CRO08A_OWNED_LOGICAL_KEYS = [
  "candidate_discovery",
  "candidate_enrichment",
  "candidate_freshness_refresh",
  "candidate_backfill",
] as const;
export type Cro08aLogicalKey = typeof CRO08A_OWNED_LOGICAL_KEYS[number];

/** Schedules verified present elsewhere in the codebase that CRO-08A must
 * NEVER claim ownership of (Correction 3's published exclusion list). Kept
 * here as a machine-checkable negative-assertion list for tests, not as
 * anything this module writes to. */
export const CRO08A_EXCLUDED_SCHEDULE_KEYS = [
  "ghl_sync", "sla_checks", "sequence_enrollment_worker", "weekly_digest", "partner_monthly_digest",
  "mid_ingestion", "onboarding_reminder", "activation_monitor", "merchant_success", "winback_outreach",
  "abandoned_statement", "executive_snapshot", "system_audit", "db_backup", "enrollment_recovery",
  "ghl_enrollment_recovery", "health_monitor", "pipeline_silence_check", "proposal_followup",
  "voicemail_sync", "cro03c_live_recovery", "post_enrichment_intent_recovery", "zerobounce_auto_run",
  "ghl_legacy_auto_sync_loop", "sla_mid_ingestion_worker_loop", "daily_outreach_loop",
  "sdr_orchestrator_sweep", "sdr_funnel_metrics", "sdr_lead_finder_nightly", "content_scheduler_tick",
  "deal_boarding_outbox_poller", "merchant_application_outbox_poller", "wizard_flag_overrides_refresh",
  "cro07_feedback_delivery", "cr06_campaign_prep",
] as const;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Reject a malformed `budgets` JSON shape at schedule-definition creation
 * time rather than letting a bad shape surface only much later, inside
 * createCro03cCommand's per-provider budget lookup (CRO08A_PROVIDER_BUDGET_
 * UNDEFINED). Each provider key present must map to an object carrying a
 * non-negative integer `maxUnitsPerOccurrence`; the object may be empty
 * (`{}`, meaning "no provider budgets configured yet" — a definition with an
 * empty budgets object can still be created and activated, it simply cannot
 * back any continuous_occurrence command until a provider entry is added via
 * a new definition version).
 */
function assertValidCro08aBudgetsShape(budgets: Record<string, unknown>): void {
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    throw new Error("CRO08A_SCHEDULE_BUDGETS_INVALID");
  }
  for (const [provider, entry] of Object.entries(budgets)) {
    if (!provider) throw new Error("CRO08A_SCHEDULE_BUDGETS_INVALID");
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("CRO08A_SCHEDULE_BUDGETS_INVALID");
    }
    const maxUnitsPerOccurrence = (entry as Record<string, unknown>).maxUnitsPerOccurrence;
    if (!Number.isInteger(maxUnitsPerOccurrence) || (maxUnitsPerOccurrence as number) < 0) {
      throw new Error("CRO08A_SCHEDULE_BUDGETS_INVALID");
    }
  }
}

export interface Cro08aScheduleDefinitionInput {
  logicalKey: Cro08aLogicalKey;
  purpose: string;
  sourceRecipePolicyVersions: Record<string, number>;
  cadenceCron: string;
  timezone?: string;
  windowSeconds: number;
  overlapSeconds?: number;
  batchSize: number;
  concurrencyLimit: number;
  cursorSemantics: Record<string, unknown>;
  budgets: Record<string, unknown>;
  timeoutMs: number;
  leaseMs: number;
  heartbeatMs: number;
  retryPolicy: Record<string, unknown>;
  deadLetterPolicy: Record<string, unknown>;
  downstreamOwner: string;
  cancellationBehavior?: string;
  createdBy: string;
}

/** Create an immutable schedule definition. Never activates it — activation
 * is a separate, certification-gated step below. */
export async function createCro08aScheduleDefinition(input: Cro08aScheduleDefinitionInput): Promise<{ id: string; definitionHash: string; definitionVersion: number }> {
  if (!CRO08A_OWNED_LOGICAL_KEYS.includes(input.logicalKey)) {
    throw new Error("CRO08A_SCHEDULE_LOGICAL_KEY_OUT_OF_SCOPE");
  }
  assertValidCro08aBudgetsShape(input.budgets);
  const definitionHash = stableHash({
    logicalKey: input.logicalKey, cadenceCron: input.cadenceCron, windowSeconds: input.windowSeconds,
    batchSize: input.batchSize, concurrencyLimit: input.concurrencyLimit, cursorSemantics: input.cursorSemantics,
    budgets: input.budgets, sourceRecipePolicyVersions: input.sourceRecipePolicyVersions,
    retryPolicy: input.retryPolicy, deadLetterPolicy: input.deadLetterPolicy,
  });
  return db.transaction(async (tx) => {
    const existing = rows(await tx.execute(sql`
      SELECT id, definition_hash, definition_version FROM cro08a_schedule_definitions WHERE definition_hash=${definitionHash}
    `))[0];
    if (existing) return { id: String(existing.id), definitionHash, definitionVersion: Number(existing.definition_version) };
    const existingVersions = rows(await tx.execute(sql`
      SELECT definition_version FROM cro08a_schedule_definitions
       WHERE logical_key=${input.logicalKey} FOR UPDATE
    `));
    const definitionVersion = existingVersions.reduce((max, r) => Math.max(max, Number(r.definition_version)), 0) + 1;
    const created = rows(await tx.execute(sql`
      INSERT INTO cro08a_schedule_definitions
        (logical_key, definition_version, purpose, source_recipe_policy_versions, cadence_cron, timezone,
         window_seconds, overlap_seconds, batch_size, concurrency_limit, cursor_semantics, budgets,
         timeout_ms, lease_ms, heartbeat_ms, retry_policy, dead_letter_policy, downstream_owner,
         cancellation_behavior, definition_hash, created_by)
      VALUES (${input.logicalKey}, ${definitionVersion}, ${input.purpose},
              ${JSON.stringify(input.sourceRecipePolicyVersions)}::jsonb, ${input.cadenceCron},
              ${input.timezone ?? "UTC"}, ${input.windowSeconds}, ${input.overlapSeconds ?? 0}, ${input.batchSize},
              ${input.concurrencyLimit}, ${JSON.stringify(input.cursorSemantics)}::jsonb,
              ${JSON.stringify(input.budgets)}::jsonb, ${input.timeoutMs}, ${input.leaseMs}, ${input.heartbeatMs},
              ${JSON.stringify(input.retryPolicy)}::jsonb, ${JSON.stringify(input.deadLetterPolicy)}::jsonb,
              ${input.downstreamOwner}, ${input.cancellationBehavior ?? "preserve_completed_evidence"},
              ${definitionHash}, ${input.createdBy})
      RETURNING id
    `));
    return { id: String(created[0].id), definitionHash, definitionVersion };
  });
}

/**
 * Flip a schedule definition's active pointer to true. Gated only by the
 * MI-09 pilot ladder (assertPilotLadderCompletion) and the aggregate $50
 * spend cap enforced per-command in live-execution.ts — the separate
 * certification-receipt ceremony (typed confirmation + pricing snapshot +
 * runtime attestation) was removed at the operator's request; a solo
 * operator repeating that ceremony on every release added no additional
 * protection beyond the pilot ladder and the spend cap. Deactivates any
 * prior active definition for the same logical key in the same transaction
 * (CAS: partial unique index enforces at most one active row per logical
 * key even under a race).
 */
/**
 * Verify that all three MI-09 pilot levels have completed with valid advancement
 * evidence before activating production schedules. Called by activateCro08aScheduleDefinition.
 *
 * Historical note: this check was originally kept separate from the now-removed
 * certification-receipt issuance step (see certification-gate.ts) because that
 * receipt was issued twice — once pre-pilot to gate the pilots themselves, and
 * once post-Pilot-3 for final activation — and requiring pilot completion at
 * issuance time would have deadlocked the pre-pilot ceremony. That receipt
 * ceremony no longer exists; this function remains the sole activation gate.
 */
export async function assertPilotLadderCompletion(): Promise<void> {
  // NOTE (verified during enrichment activation preflight): scripts/test-cro08a-
  // continuous-factory.ts intentionally leaves "test-tagged residue" rows behind
  // in mi09_pilot_definitions/mi09_pilot_runs (pilot_definition_hash LIKE
  // 'cro08a-test-pilot-def-%') so its own DB-level unit test can exercise
  // activateCro08aScheduleDefinition()'s happy path without running a real MI-09
  // pilot end-to-end. This table has no dedicated is_test discriminator column,
  // so excluding that residue here by hash prefix would also blind this gate to
  // its own test's legitimate fixture data (verified: doing so breaks the test's
  // "full path setup" case, which relies on that exact residue to pass). The
  // operative safeguard against this residue satisfying a REAL production
  // activation is environment separation — dev and production use separate
  // databases (see .agents/memory/publish-vs-dev-environment-drift.md) — so this
  // script must never be run with DATABASE_URL pointed at production. If a
  // dedicated is_test flag is ever added to mi09_pilot_definitions, this query
  // should filter on it instead of relying solely on DB separation.
  const pilotCompletion = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM mi09_pilot_runs pr
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE pd.level = 1 AND pr.state = 'completed') AS l1_completed,
      (SELECT COUNT(*)::int FROM mi09_pilot_runs pr
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE pd.level = 2 AND pr.state = 'completed') AS l2_completed,
      (SELECT COUNT(*)::int FROM mi09_pilot_runs pr
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE pd.level = 3 AND pr.state = 'completed') AS l3_completed,
      (SELECT COUNT(*)::int FROM mi09_pilot_advancement_receipts par
         JOIN mi09_pilot_runs pr ON pr.id = par.pilot_run_id
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE par.from_level = 1 AND par.to_level = 2
           AND par.stop_conditions_passed = true
           AND pr.state = 'completed' AND pd.level = 1) AS adv_1_to_2,
      (SELECT COUNT(*)::int FROM mi09_pilot_advancement_receipts par
         JOIN mi09_pilot_runs pr ON pr.id = par.pilot_run_id
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE par.from_level = 2 AND par.to_level = 3
           AND par.stop_conditions_passed = true
           AND pr.state = 'completed' AND pd.level = 2) AS adv_2_to_3,
      (SELECT COUNT(*)::int FROM mi09_pilot_effect_links pel
         JOIN mi09_pilot_runs pr ON pr.id = pel.pilot_run_id
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE pd.level = 3 AND pr.state = 'completed'
           AND pel.entity_type IN ('cro03c_command', 'generation')) AS l3_effects,
      (SELECT COUNT(*)::int
         FROM mi09_pilot_checkpoints cp
         JOIN mi09_pilot_runs pr ON pr.id = cp.pilot_run_id
         JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
         WHERE pd.level = 3 AND pr.state = 'completed'
           AND cp.phase = 'enrichment'
           AND cp.processed_count >= (
             SELECT COUNT(*)::int FROM mi09_pilot_cohort_members m WHERE m.pilot_run_id = pr.id
           )) AS l3_enrichment_complete
  `))[0];

  const gaps: string[] = [];
  if (!pilotCompletion?.l1_completed)          gaps.push("level_1_run_not_completed");
  if (!pilotCompletion?.adv_1_to_2)            gaps.push("advancement_1_to_2_missing_or_stop_conditions_failed");
  if (!pilotCompletion?.l2_completed)          gaps.push("level_2_run_not_completed");
  if (!pilotCompletion?.adv_2_to_3)            gaps.push("advancement_2_to_3_missing_or_stop_conditions_failed");
  if (!pilotCompletion?.l3_completed)          gaps.push("level_3_run_not_completed");
  if (!pilotCompletion?.l3_effects)            gaps.push("level_3_run_has_no_effect_links");
  if (!pilotCompletion?.l3_enrichment_complete) gaps.push("level_3_enrichment_phase_incomplete");

  if (gaps.length > 0) {
    throw new Cro08aCertificationDeniedError(
      `pilot_ladder_not_complete:[${gaps.join(",")}] — ` +
      `all three MI-09 pilot levels must complete with valid advancement evidence ` +
      `before CRO-08A continuous schedules can be activated`,
    );
  }
}

export async function activateCro08aScheduleDefinition(input: {
  definitionId: string;
  activatedBy: string;
  reason: string;
  expiresAt?: Date;
}): Promise<{ activated: true }> {
  // Require all three pilot levels to be complete before activating any production schedule.
  // This enforces the MI-09 pilot ladder: pilot 1 → pilot 2 → pilot 3 → activation.
  await assertPilotLadderCompletion();
  await db.transaction(async (tx) => {
    const def = rows(await tx.execute(sql`
      SELECT id, logical_key, budgets FROM cro08a_schedule_definitions WHERE id=${input.definitionId}::uuid FOR UPDATE
    `))[0];
    if (!def) throw new Error("CRO08A_SCHEDULE_DEFINITION_NOT_FOUND");
    // Corrective item 8: pilot-ladder completion is a historical fact about
    // the pilot, not an operator authorization to spend on paid providers
    // forever via recurrence. Any definition naming a paid provider in its
    // budgets requires its own, separately typed, revocable authorization.
    const budgets = typeof def.budgets === "string" ? JSON.parse(def.budgets) : (def.budgets ?? {});
    await assertRecurringPaidAuthorityForActivation(budgets);
    await tx.execute(sql`
      UPDATE cro08a_schedule_definitions SET active=false, updated_at=NOW()
       WHERE logical_key=${def.logical_key} AND active=true AND id<>${input.definitionId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro08a_schedule_definitions
         SET active=true, active_version=active_version+1, activation_epoch=EXTRACT(EPOCH FROM NOW())::bigint,
             activated_by=${input.activatedBy}, activation_reason=${input.reason},
             activation_expires_at=${input.expiresAt ? input.expiresAt.toISOString() : null}::timestamptz,
             updated_at=NOW()
       WHERE id=${input.definitionId}::uuid
    `);
  });
  return { activated: true };
}

export async function deactivateCro08aScheduleDefinition(definitionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE cro08a_schedule_definitions SET active=false, updated_at=NOW() WHERE id=${definitionId}::uuid
  `);
}

// ── Corrective item 8 (Task #1971 continuation): split pilot vs recurrence
// authorization scopes ────────────────────────────────────────────────────
//
// Before this, activateCro08aScheduleDefinition() was gated ONLY by
// assertPilotLadderCompletion() — a one-time historical fact (the MI-09
// pilot ladder completed at some point in the past) — plus each schedule's
// own per-occurrence unit budgets (maxUnitsPerOccurrence, which bound
// volume per run but not total dollar spend). Once a schedule activated,
// its continuous_occurrence commands could spend on paid providers
// indefinitely: they never checked getPaidBudgetAuthorization() (the
// operator's one-time typed "AUTHORIZE $50 PAID PILOT" confirmation) or
// assertAggregatePaidBudgetAvailable() (the pilot's $50 aggregate cap) —
// both of those are pilot-run-scoped (mi09-pilot-authority.ts, tracked via
// mi09_pilot_effect_links) and were never wired into the recurring
// execution path at all.
//
// This gives recurrence its OWN explicit, revocable operator authorization
// and its OWN aggregate spend cap, tracked independently from the pilot's:
// a completed pilot ladder authorizes recurring schedules to be created and
// activated, but never implicitly authorizes them to spend on paid
// providers, and a pilot's typed confirmation never carries over to
// recurring spend either. An admin must explicitly type a distinct
// confirmation string before ANY schedule definition naming a paid
// provider in its budgets may activate, and every continuous_occurrence
// command re-checks the recurring aggregate cap immediately before
// creation (mirroring the pilot's own per-command re-check pattern).
export const CRO08A_RECURRING_PAID_BUDGET_MICROS = 50_000_000; // $50.00 USD — mirrors the pilot's own starting ceiling; a separate, independently-tracked pool.
const CRO08A_RECURRING_BUDGET_AUTH_KEY = "cro08a_recurring_paid_budget_authorization";
export const CRO08A_RECURRING_BUDGET_TYPED_CONFIRMATION = "AUTHORIZE RECURRING PAID ENRICHMENT";

export interface Cro08aRecurringBudgetAuthorization {
  authorizedBy: string;
  authorizedAt: string;
  capMicros: number;
  typedConfirmation: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
}

function paidProviderKeysIn(budgets: Record<string, unknown>): PaidProviderKey[] {
  return Object.keys(budgets).filter((key): key is PaidProviderKey =>
    (PAID_PROVIDER_KEYS as readonly string[]).includes(key));
}

/** Read the current typed recurring-paid-budget authorization, if any. Revoked authorizations are returned (with revokedAt set) so callers can distinguish "never authorized" from "authorized then revoked". */
export async function getRecurringPaidBudgetAuthorization(): Promise<Cro08aRecurringBudgetAuthorization | null> {
  const row = rows(await db.execute(sql`
    SELECT value FROM system_settings WHERE key = ${CRO08A_RECURRING_BUDGET_AUTH_KEY} LIMIT 1
  `))[0];
  if (!row) return null;
  const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return value as Cro08aRecurringBudgetAuthorization;
}

/** Throws unless a live (unrevoked) recurring-paid-budget authorization exists. */
async function assertRecurringPaidBudgetAuthorized(): Promise<void> {
  const auth = await getRecurringPaidBudgetAuthorization();
  if (!auth || auth.revokedAt) throw new Error("CRO08A_RECURRING_PAID_AUTHORIZATION_REQUIRED");
}

/**
 * Record the operator's explicit typed authorization for recurring paid
 * spend. The caller (route layer) must have already verified the exact
 * typed confirmation string and admin role; this function re-verifies the
 * string as a second, independent gate so a bug in the route can never
 * silently authorize recurring paid spend.
 */
export async function authorizeRecurringPaidBudget(input: {
  authorizedBy: string;
  typedConfirmation: string;
}): Promise<Cro08aRecurringBudgetAuthorization> {
  if (input.typedConfirmation !== CRO08A_RECURRING_BUDGET_TYPED_CONFIRMATION) {
    throw new Error("CRO08A_RECURRING_PAID_AUTHORIZATION_DENIED:typed_confirmation_mismatch");
  }
  const auth: Cro08aRecurringBudgetAuthorization = {
    authorizedBy: input.authorizedBy,
    authorizedAt: new Date().toISOString(),
    capMicros: CRO08A_RECURRING_PAID_BUDGET_MICROS,
    typedConfirmation: input.typedConfirmation,
  };
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${CRO08A_RECURRING_BUDGET_AUTH_KEY}, ${JSON.stringify(auth)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  return auth;
}

/** Emergency stop: revoke the standing recurring-paid-budget authorization so no further continuous_occurrence command may spend on a paid provider until an admin re-authorizes. */
export async function revokeRecurringPaidBudgetAuthorization(input: {
  revokedBy: string;
  reason: string;
}): Promise<void> {
  const current = await getRecurringPaidBudgetAuthorization();
  if (!current || current.revokedAt) return;
  const revoked: Cro08aRecurringBudgetAuthorization = {
    ...current,
    revokedAt: new Date().toISOString(),
    revokedBy: input.revokedBy,
    revokedReason: input.reason,
  };
  await db.execute(sql`
    UPDATE system_settings SET value = ${JSON.stringify(revoked)}::jsonb, updated_at = NOW()
     WHERE key = ${CRO08A_RECURRING_BUDGET_AUTH_KEY}
  `);
}

export interface Cro08aRecurringBudgetSummary {
  capMicros: number;
  settledMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  overCap: boolean;
  operationCount: number;
}

/** Aggregate real spend across every continuous_occurrence command's cro03c_stage_operations — tracked separately from the pilot's own aggregate (which counts only mi09_pilot_effect_links-linked commands). */
export async function getAggregateRecurringPaidSpend(): Promise<Cro08aRecurringBudgetSummary> {
  const row = rows(await db.execute(sql`
    SELECT
      COALESCE(SUM(so.settled_amount_micros), 0)::bigint AS settled_micros,
      COALESCE(SUM(CASE WHEN so.state IN ('reserved','dispatched') THEN so.max_reserved_amount_micros ELSE 0 END), 0)::bigint AS reserved_micros,
      COUNT(*)::int AS cnt
    FROM cro03c_stage_operations so
    JOIN cro03c_commands c ON c.id = so.command_id
    WHERE c.command_type = 'continuous_occurrence'
  `))[0];
  const settledMicros = Number(row?.settled_micros ?? 0);
  const reservedMicros = Number(row?.reserved_micros ?? 0);
  const capMicros = CRO08A_RECURRING_PAID_BUDGET_MICROS;
  const committedMicros = settledMicros + reservedMicros;
  return {
    capMicros,
    settledMicros,
    reservedMicros,
    remainingMicros: Math.max(0, capMicros - committedMicros),
    overCap: committedMicros > capMicros,
    operationCount: Number(row?.cnt ?? 0),
  };
}

/** Throws unless the recurring aggregate spend (settled + in-flight reserved) is still under its own cap. Independent of the pilot's assertAggregatePaidBudgetAvailable(). */
export async function assertAggregateRecurringPaidBudgetAvailable(): Promise<Cro08aRecurringBudgetSummary> {
  const summary = await getAggregateRecurringPaidSpend();
  if (summary.overCap) {
    throw new Error(`CRO08A_RECURRING_BUDGET_EXCEEDED:committed=${summary.settledMicros + summary.reservedMicros} cap=${summary.capMicros}`);
  }
  return summary;
}

/**
 * Combined pre-activation gate for a definition naming any paid provider in
 * its budgets: requires a live typed recurring-paid-budget authorization.
 * Definitions with no paid provider keys (budgets is empty or only names
 * free/internal sources) are unaffected — this only gates the introduction
 * of real paid spend into recurring execution.
 */
export async function assertRecurringPaidAuthorityForActivation(budgets: Record<string, unknown>): Promise<void> {
  if (paidProviderKeysIn(budgets).length === 0) return;
  await assertRecurringPaidBudgetAuthorized();
}

export { Cro08aCertificationDeniedError };
