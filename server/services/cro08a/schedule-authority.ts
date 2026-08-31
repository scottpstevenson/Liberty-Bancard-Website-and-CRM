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
import { assertCurrentCro08aCertification, Cro08aCertificationDeniedError } from "./certification-gate";

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
 * Flip a schedule definition's active pointer to true. Requires a durable,
 * current-release-matching CRO-03D certification receipt (Correction 4) —
 * this throws Cro08aCertificationDeniedError until that receipt exists, so
 * no production schedule can ever go live from this code path alone.
 * Deactivates any prior active definition for the same logical key in the
 * same transaction (CAS: partial unique index enforces at most one active
 * row per logical key even under a race).
 */
export async function activateCro08aScheduleDefinition(input: {
  definitionId: string;
  activatedBy: string;
  reason: string;
  expiresAt?: Date;
}): Promise<{ activated: true; certificationReceiptId: string }> {
  const { receiptId } = await assertCurrentCro08aCertification();
  await db.transaction(async (tx) => {
    const def = rows(await tx.execute(sql`
      SELECT id, logical_key FROM cro08a_schedule_definitions WHERE id=${input.definitionId}::uuid FOR UPDATE
    `))[0];
    if (!def) throw new Error("CRO08A_SCHEDULE_DEFINITION_NOT_FOUND");
    await tx.execute(sql`
      UPDATE cro08a_schedule_definitions SET active=false, updated_at=NOW()
       WHERE logical_key=${def.logical_key} AND active=true AND id<>${input.definitionId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro08a_schedule_definitions
         SET active=true, active_version=active_version+1, activation_epoch=EXTRACT(EPOCH FROM NOW())::bigint,
             activated_by=${input.activatedBy}, activation_reason=${input.reason},
             activation_expires_at=${input.expiresAt ? input.expiresAt.toISOString() : null}::timestamptz,
             certification_receipt_id=${receiptId}::uuid, updated_at=NOW()
       WHERE id=${input.definitionId}::uuid
    `);
  });
  return { activated: true, certificationReceiptId: receiptId };
}

export async function deactivateCro08aScheduleDefinition(definitionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE cro08a_schedule_definitions SET active=false, updated_at=NOW() WHERE id=${definitionId}::uuid
  `);
}

export { Cro08aCertificationDeniedError };
