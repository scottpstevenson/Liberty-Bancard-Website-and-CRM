import { storage } from "../storage";
import type { Deal } from "@shared/schema";
import { isGhlConfigured } from "./ghl";
import { syncDealToGhl } from "./ghl-sync";
import { recordAnalyticsEvent } from "./analytics-events";
import { CALL_BOOKED, PROPOSAL_SENT, CLOSED_WON, DEAL_STAGE_CHANGED } from "@shared/analytics-events";
import { db } from "../db";
import { deals, tasks } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

/** Stage names that map to dedicated funnel analytics events */
const STAGE_EVENT_MAP: Record<string, string> = {
  "Call Booked": CALL_BOOKED,
  "Proposal Sent": PROPOSAL_SENT,
  "Closed Won": CLOSED_WON,
};

/**
 * Central deal stage transition service.
 *
 * ALL stage mutations in the app must go through this function so that:
 *   - GHL opportunity stage sync is always guaranteed after a local update
 *   - Analytics funnel events are recorded for key stages
 *   - Closed Won side-effects (onboarding deal, SLA tasks, welcome email) fire
 *     for every code path — pipeline drag, bulk-stage, AI auto-progress, and
 *     merchant application approval
 *
 * Usage:
 *   await advanceDealStage(dealId, "Underwriting Submitted", "document_auto_advance");
 */
export async function advanceDealStage(
  dealId: number,
  newStage: string,
  trigger: string
): Promise<Deal | null> {
  const updated = await storage.updateDeal(dealId, { stage: newStage });
  if (!updated) return null;

  console.log(`[DealStage] Deal ${dealId} → "${newStage}" (trigger: ${trigger})`);

  if (isGhlConfigured()) {
    syncDealToGhl(dealId).then((ghlResult) => {
      if (!ghlResult.success) {
        console.warn(
          `[DealStage] GHL sync failed for deal ${dealId} after stage change to "${newStage}":`,
          ghlResult.error,
        );
        storage.createAuditLog({
          action: "ghl_opportunity_sync_failed",
          entityType: "deal",
          entityId: dealId,
          details: { error: ghlResult.error, stage: newStage, trigger },
        }).catch(() => {});
      } else {
        console.log(
          `[DealStage] Deal ${dealId} stage "${newStage}" pushed to GHL opportunity ${ghlResult.ghlOpportunityId}`,
        );
      }
    }).catch((err: Error) => {
      console.warn(
        `[DealStage] GHL sync exception for deal ${dealId} after stage change to "${newStage}":`,
        err.message,
      );
    });
  }

  // Record dedicated funnel event for key stages, plus generic stage-changed
  const funnelEvent = STAGE_EVENT_MAP[newStage];
  if (funnelEvent) {
    recordAnalyticsEvent({
      eventName: funnelEvent,
      dealId,
      dealStage: newStage,
      contactId: updated.contactId ?? undefined,
      metadata: { trigger },
    }).catch(() => {});
  }

  recordAnalyticsEvent({
    eventName: DEAL_STAGE_CHANGED,
    dealId,
    dealStage: newStage,
    contactId: updated.contactId ?? undefined,
    metadata: { trigger, newStage },
  }).catch(() => {});

  // Closed Won → fire onboarding kickoff (idempotent, concurrency-safe)
  if (newStage === "Closed Won") {
    triggerClosedWonOnboarding(updated).catch((err: Error) =>
      console.error(`[DealStage] Onboarding kickoff error for deal ${dealId}:`, err.message),
    );
  }

  return updated;
}

/**
 * Batch stage transition — updates multiple deals in one pass with GHL sync for each.
 */
export async function advanceDealsStageBatch(
  dealIds: number[],
  newStage: string,
  trigger: string
): Promise<number> {
  let count = 0;
  for (const dealId of dealIds) {
    const result = await advanceDealStage(dealId, newStage, trigger);
    if (result) count++;
  }
  return count;
}

/**
 * Canonical SLA tasks created on every Closed Won → Onboarding kickoff.
 * Titles must stay stable — they are used as idempotency keys and are covered
 * by the DB unique partial index `tasks_onboarding_sla_title_unique`.
 */
const CLOSED_WON_SLA_TASKS = [
  { title: "Submit application to processor",  dueDays: 1,  priority: "high"   },
  { title: "Collect KYC documents",            dueDays: 3,  priority: "high"   },
  { title: "Order terminal/equipment",         dueDays: 5,  priority: "medium" },
  { title: "Schedule merchant training",       dueDays: 10, priority: "medium" },
  { title: "Confirm first-batch live date",    dueDays: 21, priority: "medium" },
] as const;

/**
 * Writes the 5 canonical onboarding SLA tasks to the given deal.
 *
 * Concurrency-safe: a DB partial unique index on (deal_id, title) for the 5
 * canonical titles means concurrent inserts for the same task are silently
 * ignored (error code 23505 is caught and treated as a no-op).
 */
async function ensureOnboardingSLATasks(
  onboardingDealId: number,
  contactId: number | null | undefined,
  owner: string | null | undefined,
  baseDate: Date,
): Promise<void> {
  // Pre-fetch existing titles to skip obvious no-ops (performance shortcut —
  // the unique index is the authoritative guard for concurrent writes).
  const existing = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.dealId, onboardingDealId), isNull(tasks.deletedAt)));
  const existingTitles = new Set(existing.map((t) => t.title));

  for (const slaTask of CLOSED_WON_SLA_TASKS) {
    if (existingTitles.has(slaTask.title)) continue;
    try {
      await storage.createTask({
        title: slaTask.title,
        priority: slaTask.priority,
        dueDate: new Date(baseDate.getTime() + slaTask.dueDays * 86_400_000),
        dealId: onboardingDealId,
        contactId: contactId ?? undefined,
        assignedTo: owner || "Unassigned",
      });
    } catch (taskErr: any) {
      // 23505 = unique_violation: concurrent invocation already inserted this task
      if (taskErr?.code === "23505") {
        console.log(
          `[Onboarding] Task "${slaTask.title}" already created concurrently for deal #${onboardingDealId} — skipping`,
        );
      } else {
        throw taskErr;
      }
    }
  }
}

/** Staleness window: a claimed-but-undelivered welcome may be retried after this many ms. */
const WELCOME_CLAIM_STALE_MS = 15 * 60 * 1_000; // 15 minutes

/**
 * Two-state atomic welcome-dispatch gate for a sales deal.
 *
 * States written to `audit_logs`:
 *   - `merchant_welcome_claimed`  — written here BEFORE dispatch, acts as an
 *     in-flight reservation.  If the process dies or GHL/SMTP both fail, the
 *     claim becomes stale after WELCOME_CLAIM_STALE_MS and the next Closed Won
 *     invocation will retry.
 *   - `merchant_welcome_sent`     — written by `sendMerchantWelcomeEmail` AFTER
 *     confirmed delivery.  Presence of this record permanently blocks retries.
 *
 * Concurrency: a transaction-scoped advisory lock (released on commit/rollback)
 * ensures only one concurrent caller advances past the check.
 *
 * Returns `true` when this caller should dispatch the welcome, `false` otherwise.
 */
async function claimWelcomeDispatch(salesDealId: number, contactId: number): Promise<boolean> {
  let shouldDispatch = false;
  try {
    await db.transaction(async (tx) => {
      // Lock key namespaced to welcome dispatches; auto-released when txn ends.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${salesDealId + 50_000_000})`);

      // Already successfully delivered — nothing to do.
      const sent = await tx.execute(sql`
        SELECT id FROM audit_logs
        WHERE action      = 'merchant_welcome_sent'
          AND entity_type = 'deal'
          AND entity_id   = ${salesDealId}
        LIMIT 1
      `);
      if (sent.rows.length > 0) {
        console.log(`[Onboarding] Welcome already delivered for deal #${salesDealId} — skipping`);
        return;
      }

      // Check for an existing claim that is still in-flight (not yet stale).
      const claim = await tx.execute(sql`
        SELECT id, created_at FROM audit_logs
        WHERE action      = 'merchant_welcome_claimed'
          AND entity_type = 'deal'
          AND entity_id   = ${salesDealId}
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (claim.rows.length > 0) {
        const claimedAt = new Date((claim.rows[0] as any).created_at).getTime();
        const ageMs = Date.now() - claimedAt;
        if (ageMs < WELCOME_CLAIM_STALE_MS) {
          console.log(
            `[Onboarding] Welcome in-flight for deal #${salesDealId} (claimed ${Math.round(ageMs / 1000)}s ago) — skipping`,
          );
          return;
        }
        // Stale claim (delivery likely failed) — proceed to retry
        console.log(
          `[Onboarding] Stale welcome claim for deal #${salesDealId} (${Math.round(ageMs / 60_000)}m old) — retrying`,
        );
      }

      // Write a new pending claim record before we dispatch.
      // `sendMerchantWelcomeEmail` will write `merchant_welcome_sent` on success.
      await tx.execute(sql`
        INSERT INTO audit_logs
          (action, entity_type, entity_id, actor_type, details, created_at)
        VALUES (
          'merchant_welcome_claimed', 'deal', ${salesDealId}, 'system',
          ${JSON.stringify({ contactId, channel: "pending" })},
          NOW()
        )
      `);
      shouldDispatch = true;
    });
  } catch (lockErr: any) {
    console.warn(
      `[Onboarding] Welcome claim transaction failed for deal #${salesDealId}:`,
      lockErr?.message,
    );
  }
  return shouldDispatch;
}

/**
 * Fires the full Closed Won → Onboarding sequence:
 *   1. Creates (or reuses) an onboarding pipeline deal linked by salesDealId.
 *   2. Writes the 5 canonical SLA tasks (idempotent: unique partial index + conflict catch).
 *   3. Sends the merchant welcome via GHL workflow → GHL direct → SMTP fallback.
 *      The helper owns GHL upsert for contacts that have no pre-existing GHL ID,
 *      so it is called whenever a contact exists — not gated on ghlContactId.
 *
 * Concurrency-safe for all three phases.
 */
export async function triggerClosedWonOnboarding(salesDeal: Deal): Promise<void> {
  try {
    const closedWonAt = salesDeal.updatedAt ? new Date(salesDeal.updatedAt) : new Date();

    // ── 1. Find or create the onboarding deal ─────────────────────────────
    const [existingOnboardingDeal] = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.salesDealId, salesDeal.id),
          eq(deals.pipeline, "onboarding"),
          isNull(deals.archivedAt),
        ),
      )
      .limit(1);

    let onboardingDealId: number;

    if (existingOnboardingDeal) {
      console.log(
        `[Onboarding] Reusing existing onboarding deal #${existingOnboardingDeal.id} for sales deal #${salesDeal.id}`,
      );
      onboardingDealId = existingOnboardingDeal.id;
    } else {
      // Also check legacy linkage by contactId to avoid duplicates on pre-migration deals
      let legacyDealId: number | null = null;
      if (salesDeal.contactId) {
        const contactDeals = await storage.getDealsByContact(salesDeal.contactId);
        const legacy = contactDeals.find(
          (d) => d.pipeline === "onboarding" && !d.archivedAt && !d.salesDealId,
        );
        if (legacy) {
          legacyDealId = legacy.id;
          console.log(
            `[Onboarding] Reusing legacy onboarding deal #${legacy.id} (no salesDealId) for sales deal #${salesDeal.id}`,
          );
        }
      }

      if (legacyDealId !== null) {
        onboardingDealId = legacyDealId;
      } else {
        const closedContact = salesDeal.contactId
          ? await storage.getContact(salesDeal.contactId)
          : null;

        try {
          const onboardingDeal = await storage.createDeal({
            contactId: salesDeal.contactId ?? undefined,
            pipeline: "onboarding",
            stage: "Application Submitted",
            offerPath: salesDeal.offerPath ?? undefined,
            owner: salesDeal.owner ?? undefined,
            leadSource: "closed_won",
            salesDealId: salesDeal.id,
            notes: `Onboarding started from Closed Won deal #${salesDeal.id}${
              closedContact
                ? ` — ${closedContact.companyName || [closedContact.firstName, closedContact.lastName].filter(Boolean).join(" ")}`
                : ""
            }`,
          } as any); // salesDealId is a new column; cast until Drizzle types refresh

          onboardingDealId = onboardingDeal.id;

          await storage.createAuditLog({
            action: "onboarding_deal_created",
            entityType: "deal",
            entityId: onboardingDeal.id,
            details: { sourceDealId: salesDeal.id, contactId: salesDeal.contactId },
          });

          const { createPreferenceAwareNotification } = await import("./digest-service");
          await createPreferenceAwareNotification(
            {
              channel: "internal",
              title: "Onboarding Deal Created",
              message: `Onboarding pipeline deal #${onboardingDeal.id} created for ${
                closedContact
                  ? closedContact.companyName || closedContact.firstName
                  : "merchant"
              }.`,
              type: "info",
              metadata: { dealId: onboardingDeal.id, eventType: "onboarding_started" },
            },
            "onboarding_started",
          );

          console.log(
            `[Onboarding] Created onboarding deal #${onboardingDeal.id} for sales deal #${salesDeal.id}`,
          );
        } catch (createErr: any) {
          // 23505 = unique_violation from deals_onboarding_sales_deal_unique:
          // a concurrent request already created the deal — SELECT and reuse it.
          if (createErr?.code === "23505" || createErr?.message?.includes("deals_onboarding_sales_deal_unique")) {
            const [raceWinner] = await db
              .select()
              .from(deals)
              .where(
                and(
                  eq(deals.salesDealId, salesDeal.id),
                  eq(deals.pipeline, "onboarding"),
                  isNull(deals.archivedAt),
                ),
              )
              .limit(1);
            if (raceWinner) {
              onboardingDealId = raceWinner.id;
              console.log(
                `[Onboarding] Race condition resolved — reusing deal #${raceWinner.id} for sales deal #${salesDeal.id}`,
              );
            } else {
              throw createErr;
            }
          } else {
            throw createErr;
          }
        }
      }
    }

    // ── 2. Ensure SLA tasks (concurrency-safe via unique partial index) ───
    await ensureOnboardingSLATasks(
      onboardingDealId,
      salesDeal.contactId,
      salesDeal.owner,
      closedWonAt,
    );

    // ── 3. Merchant welcome — atomic claim-then-dispatch ──────────────────
    // sendMerchantWelcomeEmail handles GHL contact upsert and SMTP fallback
    // internally; do NOT gate on contact.ghlContactId — call it for any contact.
    if (salesDeal.contactId) {
      const contact = await storage.getContact(salesDeal.contactId);
      if (contact) {
        // claimWelcomeDispatch acquires a per-deal advisory lock and writes a
        // claim audit record inside a transaction; only the first caller proceeds.
        const claimed = await claimWelcomeDispatch(salesDeal.id, contact.id);
        if (claimed) {
          const { sendMerchantWelcomeEmail } = await import("./merchant-welcome");
          sendMerchantWelcomeEmail(contact, salesDeal).catch((err: Error) =>
            console.error("[Onboarding] Merchant welcome email error:", err.message),
          );
        }
      }
    }
  } catch (err) {
    console.error("[Onboarding] triggerClosedWonOnboarding error:", err);
    // Non-fatal — log and continue; caller's response is already committed
  }
}
