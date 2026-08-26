import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { dealStageToLifecycleState, LifecycleService } from "./lifecycle-service";
import { triggerClosedWonOnboarding } from "./deal-stage-service";

const MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 120;

type ClaimedIntent = { id: string; deal_id: number; effect_type: string; lease_token: string; attempts: number };
type Receipt = { id: string; state: string; provider_idempotency_key: string };

async function claimOne(): Promise<ClaimedIntent | null> {
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id FROM deal_stage_effect_intents
      WHERE (state IN ('pending','retryable') AND next_attempt_at <= now())
         OR (state = 'processing' AND lease_expires_at < now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE deal_stage_effect_intents i
    SET state='processing', attempts=i.attempts+1, lease_token=gen_random_uuid(),
        lease_expires_at=now() + (${LEASE_SECONDS} * interval '1 second'), updated_at=now()
    FROM candidate WHERE i.id=candidate.id
    RETURNING i.id, i.deal_id, i.effect_type, i.lease_token, i.attempts
  `);
  return ((result.rows ?? result)[0] as ClaimedIntent | undefined) ?? null;
}

async function complete(intent: ClaimedIntent, result: Record<string, unknown>) {
  await db.execute(sql`
    UPDATE deal_stage_effect_intents SET state='succeeded', result=${JSON.stringify(result)}::jsonb,
      completed_at=now(), lease_token=NULL, lease_expires_at=NULL, updated_at=now()
    WHERE id=${intent.id}::uuid AND state='processing' AND lease_token=${intent.lease_token}::uuid
  `);
}

async function fail(intent: ClaimedIntent, error: unknown) {
  const terminal = intent.attempts >= MAX_ATTEMPTS;
  const reconciliationRequired = error instanceof Error && error.message.startsWith("effect_reconcile_required:");
  await db.execute(sql`
    UPDATE deal_stage_effect_intents
    SET state=${reconciliationRequired ? "reconcile_required" : (terminal ? "terminal_failed" : "retryable")},
        last_error=${error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)},
        next_attempt_at=now() + (LEAST(3600, 2 ^ LEAST(attempts, 10)) * interval '1 second'),
        lease_token=NULL, lease_expires_at=NULL, updated_at=now()
    WHERE id=${intent.id}::uuid AND state='processing' AND lease_token=${intent.lease_token}::uuid
  `);
}

async function beginReceipt(intent: ClaimedIntent): Promise<Receipt | null> {
  const targetKey = `${intent.effect_type}:deal:${intent.deal_id}`;
  const inserted = await db.execute(sql`
    INSERT INTO deal_stage_effect_receipts
      (effect_intent_id, target_key, state, provider_idempotency_key)
    VALUES (${intent.id}::uuid, ${targetKey}, 'processing', ${`stage-effect:${intent.id}:${targetKey}`})
    ON CONFLICT (effect_intent_id, target_key) DO NOTHING
    RETURNING id, state, provider_idempotency_key
  `);
  const created = (inserted.rows ?? inserted)[0] as Receipt | undefined;
  if (created) return created;
  const existing = await db.execute(sql`
    SELECT id, state, provider_idempotency_key FROM deal_stage_effect_receipts
    WHERE effect_intent_id=${intent.id}::uuid AND target_key=${targetKey}
  `);
  const receipt = (existing.rows ?? existing)[0] as Receipt | undefined;
  if (receipt?.state === "succeeded") return null; // immutable completed receipt
  // A previous owner passed the side-effect boundary and did not finish. It
  // must reconcile rather than blindly perform a possibly-duplicated effect.
  throw new Error(`effect_reconcile_required:${receipt?.id ?? "missing"}`);
}

async function completeReceipt(receipt: Receipt, result: Record<string, unknown>) {
  await db.execute(sql`
    UPDATE deal_stage_effect_receipts
    SET state='succeeded', result=${JSON.stringify(result)}::jsonb, completed_at=now(), updated_at=now()
    WHERE id=${receipt.id}::uuid AND state='processing'
  `);
}

async function execute(intent: ClaimedIntent) {
  const deal = await storage.getDeal(intent.deal_id);
  if (!deal) throw new Error("deal_not_found");
  const receipt = await beginReceipt(intent);
  if (!receipt) return { disposition: "idempotent_receipt_replay" };
  let result: Record<string, unknown>;
  switch (intent.effect_type) {
    case "lifecycle_projection": {
      if (deal.contactId) {
        const state = dealStageToLifecycleState(deal.stage, deal.pipeline);
        if (state) await LifecycleService.transition(deal.contactId, state, {
          trigger: "deal_stage_effect_dispatch", source: "deal-stage-effect-worker", metadata: { dealId: deal.id },
        });
      }
      result = { disposition: "applied" }; break;
    }
    case "ghl_projection": {
      const { isGhlConfigured } = await import("./ghl");
      if (!isGhlConfigured()) { result = { disposition: "not_configured" }; break; }
      const { syncDealToGhl } = await import("./ghl-sync");
      const r = await syncDealToGhl(deal.id);
      if (!r.success) throw new Error(r.error ?? "ghl_sync_failed");
      result = { disposition: "applied", opportunityId: r.ghlOpportunityId ?? null }; break;
    }
    case "onboarding_kickoff":
      await triggerClosedWonOnboarding(deal);
      result = { disposition: "applied" }; break;
    case "portal_invitation": {
      const { sendMerchantPortalInvite } = await import("./merchant-portal-invite");
      const r = await sendMerchantPortalInvite(deal.id);
      if (!r.sent && r.reason !== "already_activated") throw new Error(r.reason ?? "portal_invite_failed");
      result = { disposition: r.sent ? "applied" : "already_activated" }; break;
    }
    case "underwriting_initialization": {
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const { initUnderwritingChecklist, initUnderwritingConditions } = await import("./underwriting-checklist-service");
      await initUnderwritingChecklist(deal.id, contact?.vertical ?? null);
      await initUnderwritingConditions(deal.id, contact?.email ?? null,
        [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || null, deal.contactId ?? null);
      result = { disposition: "applied" }; break;
    }
    case "proposal_followup_task": {
      if (!deal.owner || !deal.contactId) { result = { disposition: "not_applicable" }; break; }
      await storage.createTask({
        contactId: deal.contactId, dealId: deal.id,
        title: `Follow up on proposal — Deal #${deal.id}`,
        description: "Check if the merchant has reviewed the proposal and address any questions.",
        dueDate: new Date(Date.now() + 7 * 86_400_000), priority: "normal",
      });
      result = { disposition: "applied" }; break;
    }
    default:
      throw new Error(`unknown_stage_effect:${intent.effect_type}`);
  }
  await completeReceipt(receipt, result!);
  return result!;
}

/** Queue-owned sweep. Claim/fencing makes concurrent replicas safe. */
export async function dispatchDealStageEffectIntents(limit = 25): Promise<{ processed: number; failed: number }> {
  let processed = 0; let failed = 0;
  for (let i = 0; i < limit; i++) {
    const intent = await claimOne();
    if (!intent) break;
    try { await complete(intent, await execute(intent)); processed++; }
    catch (error) { await fail(intent, error); failed++; }
  }
  return { processed, failed };
}