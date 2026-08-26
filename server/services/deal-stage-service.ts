import { storage } from "../storage";
import type { Deal } from "@shared/schema";
import { isGhlConfigured } from "./ghl";
import { syncDealToGhl } from "./ghl-sync";
import { recordAnalyticsEvent } from "./analytics-events";
import { CALL_BOOKED, PROPOSAL_SENT, CLOSED_WON, DEAL_STAGE_CHANGED, PROPOSAL_CONVERTED } from "@shared/analytics-events";
import { db } from "../db";
import { deals, tasks, dealStageEffectIntents } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { GO_LIVE_GATE_STAGES, evaluateReadinessFromRawRows, GoLiveGateError } from "./go-live-gate";
import { LifecycleService, dealStageToLifecycleState } from "./lifecycle-service";
import { sanitizeAuditPayload } from "./audit-sanitizer";

/** Stage names that map to dedicated funnel analytics events */
const STAGE_EVENT_MAP: Record<string, string> = {
  "Call Booked": CALL_BOOKED,
  "Proposal Sent": PROPOSAL_SENT,
  "Closed Won": CLOSED_WON,
};

const SALES_STAGE_ORDER = [
  "New", "New Lead", "Warm Lead", "Discovery", "Appointment Set",
  "Appointment Completed", "Follow-Up", "Enriched", "Statement Requested",
  "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent",
  "Negotiation", "Negotiation / Follow-Up", "Verbal Commit", "Promise to Submit",
  "Closed Won", "Closed Lost", "Nurture / Not Now",
] as const;
const ONBOARDING_STAGE_ORDER = [
  // Application Submitted is the creation-time onboarding checkpoint used by
  // Closed Won conversion; it must be a legal source for every later
  // canonical onboarding move.
  "Application Submitted", "Contract Sent", "Application Started", "Underwriting Submitted", "Approved",
  "Terminal Ordered", "Go-Live Scheduled", "Live (First Batch)", "Active (7 Days)",
  "Active (30 Days)",
] as const;

export class DealStageConflictError extends Error {
  readonly code = "DEAL_STAGE_STALE";
  constructor(readonly dealId: number, readonly expected: string, readonly actual: string) {
    super(`Deal ${dealId} is at "${actual}", not expected "${expected}"`);
  }
}
export class DealStageIllegalTransitionError extends Error {
  readonly code = "DEAL_STAGE_ILLEGAL";
  constructor(readonly dealId: number, readonly from: string, readonly to: string) {
    super(`Illegal deal-stage transition ${from} → ${to} for deal ${dealId}`);
  }
}

function isLegalTransition(pipeline: string, from: string, to: string): boolean {
  if (from === to) return true;
  if (to === "Closed Lost" || to === "Nurture / Not Now") return true;
  // Manual underwriting correction is a deliberate, audited backwards edge.
  if (from === "Proposal Sent" && to === "Review In Progress") return true;
  // A newly received statement may legitimately move an early/manual review
  // record into the canonical statement-received checkpoint.
  if (from === "Review In Progress" && to === "Statement Received") return true;
  const order = pipeline === "onboarding" ? ONBOARDING_STAGE_ORDER : SALES_STAGE_ORDER;
  const fromIndex = order.indexOf(from as never);
  const toIndex = order.indexOf(to as never);
  return fromIndex >= 0 && toIndex >= 0 && toIndex > fromIndex;
}

function materialEffectTypes(stage: string, contactId: number | null): string[] {
  const effects: string[] = [];
  if (contactId) effects.push("lifecycle_projection");
  effects.push("ghl_projection");
  if (stage === "Closed Won") effects.push("onboarding_kickoff");
  if (stage === "Approved" || stage === "Go-Live Scheduled") effects.push("portal_invitation");
  if (stage.toLowerCase().includes("underwriting")) effects.push("underwriting_initialization");
  if (stage === "Proposal Sent") effects.push("proposal_followup_task");
  return effects;
}

/**
 * Central deal stage transition service.
 *
 * ALL stage mutations in the app must go through this function so that:
 *   - GHL opportunity stage sync is always guaranteed after a local update
 *   - Analytics funnel events are recorded for key stages
 *   - Closed Won side-effects (onboarding deal, SLA tasks, welcome email) fire
 *     for every code path — pipeline drag, bulk-stage, AI auto-progress, and
 *     merchant application approval
 *   - Go-Live gate is enforced for onboarding pipeline deals
 *
 * Usage:
 *   await advanceDealStage(dealId, "Underwriting Submitted", "document_auto_advance");
 *
 * @param overrideContext  Admin/manager override context — only supply when the caller
 *                         has already validated the actor's role and captured a reason.
 *                         When absent, automated/system triggers are blocked (logged + thrown)
 *                         rather than silently succeeding.
 */
export async function advanceDealStage(
  dealId: number,
  newStage: string,
  trigger: string,
  overrideContext?: { reason: string; actor: string; expectedStage?: string },
): Promise<Deal | null> {
  let stagedDeal: Deal | null = null;
  let applied = false;
  let gateBlocked = false;
  let blockedMissing: string[] = [];

  await db.transaction(async (tx) => {
    const dealResult = await tx.execute(sql`
      SELECT id, pipeline, stage, contact_id, mid, terminal_status
      FROM deals WHERE id = ${dealId} FOR UPDATE
    `);
    const dealRow = (dealResult.rows ?? dealResult)[0] as {
      id: number; pipeline: string; stage: string; contact_id: number | null;
      mid: string | null; terminal_status: string | null;
    } | undefined;
    if (!dealRow) return;
    if (overrideContext?.expectedStage && dealRow.stage !== overrideContext.expectedStage) {
      throw new DealStageConflictError(dealId, overrideContext.expectedStage, dealRow.stage);
    }
    if (dealRow.stage === newStage) {
      stagedDeal = (await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1))[0] ?? null;
      return;
    }
    if (!isLegalTransition(dealRow.pipeline, dealRow.stage, newStage)) {
      throw new DealStageIllegalTransitionError(dealId, dealRow.stage, newStage);
    }

    if ((GO_LIVE_GATE_STAGES as readonly string[]).includes(newStage) && dealRow.pipeline === "onboarding") {
      const clResult = await tx.execute(sql`
        SELECT item_key, status FROM onboarding_checklist_items WHERE deal_id = ${dealId} FOR UPDATE
      `);
      const readiness = evaluateReadinessFromRawRows(dealRow, (clResult.rows ?? clResult) as Array<{ item_key: string; status: string | null }>);
      if (!readiness.ready && !overrideContext) {
        gateBlocked = true;
        blockedMissing = readiness.missing;
        await tx.execute(sql`
          INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
          VALUES ('go_live_gate_blocked', 'deal', ${dealId}, 'system',
            ${JSON.stringify(sanitizeAuditPayload({
              attemptedStage: newStage,
              missingItems: readiness.missing,
              trigger,
            }))}::jsonb, NOW())
        `);
        return;
      }
    }

    const transitioned = await tx.execute(sql`
      UPDATE deals SET stage = ${newStage}, updated_at = NOW()
      WHERE id = ${dealId} AND stage = ${dealRow.stage}
      RETURNING *
    `);
    stagedDeal = ((transitioned.rows ?? transitioned)[0] as Deal | undefined) ?? null;
    if (!stagedDeal) throw new DealStageConflictError(dealId, dealRow.stage, "changed concurrently");
    applied = true;
    const transitionKey = `${dealId}:${dealRow.stage}:${newStage}`;
    for (const effectType of materialEffectTypes(newStage, dealRow.contact_id)) {
      await tx.insert(dealStageEffectIntents).values({
        dealId, transitionKey, effectType,
        idempotencyKey: `deal-stage:${transitionKey}:${effectType}`,
      }).onConflictDoNothing();
    }
    await tx.execute(sql`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
      VALUES ('deal_stage_transitioned', 'deal', ${dealId}, 'system',
        ${JSON.stringify(sanitizeAuditPayload({
          from: dealRow.stage,
          to: newStage,
          trigger,
          transitionKey,
        }))}::jsonb, NOW())
    `);
  });

  if (gateBlocked) throw new GoLiveGateError(dealId, newStage, blockedMissing, trigger);

  const updated = stagedDeal as Deal | null;
  if (!updated) return null;
  // Same-stage retries are a successful no-op.  Critically, do not create
  // telemetry, tasks, invitations, or provider work a second time.
  if (!applied) return updated;

  console.log(`[DealStage] Deal ${dealId} → "${newStage}" (trigger: ${trigger})`);

  // Material follow-ons are deliberately dispatched only from the durable
  // intent ledger by deal-stage-effect-worker. Analytics below stays best-effort.

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

  // Closed-Won notification/conversion telemetry is informational; onboarding
  // itself is a durable stage-effect intent.
  if (newStage === "Closed Won") {

    // #577 — Notify the assigned agent when their deal closes
    if (updated.owner) {
      import("../storage").then(async ({ storage: st }) => {
        const agentList = await st.getAgents().catch(() => []);
        const agent = agentList.find(a => a.email === updated.owner);
        if (agent?.email) {
          const { createNotification } = await import("../storage").then(m => m.storage);
          await createNotification({
            channel: "internal",
            title: `🎉 Deal Closed Won — ${updated.notes ? updated.notes.slice(0, 40) : `Deal #${dealId}`}`,
            message: `Your deal #${dealId} has been marked Closed Won (trigger: ${trigger}). Time to kick off onboarding!`,
            type: "info",
            metadata: { dealId, newStage, assignedAgent: updated.owner, link: `/dashboard/pipeline?id=${dealId}`, eventType: "closed_won_agent_alert" },
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    // #proposal-conversion — if a proposal was previously sent, record conversion
    if (updated.proposalEmailSentAt) {
      const daysToClosed = updated.proposalEmailSentAt
        ? Math.round((Date.now() - new Date(updated.proposalEmailSentAt).getTime()) / 86_400_000)
        : undefined;
      recordAnalyticsEvent({
        eventName: PROPOSAL_CONVERTED,
        dealId,
        dealStage: "Closed Won",
        contactId: updated.contactId ?? undefined,
        metadata: {
          trigger,
          proposalEmailSentAt: updated.proposalEmailSentAt?.toISOString?.() ?? null,
          daysToClosed,
        },
      }).catch(() => {});
    }
  }

  return updated;
}

/**
 * Batch stage transition — updates multiple deals in one pass with GHL sync for each.
 *
 * Returns `{ advanced, blocked }` so callers can distinguish successful transitions
 * from go-live gate blocks. Go-live gate blocks are logged inside advanceDealStage
 * and are NOT counted as successes.
 */
export async function advanceDealsStageBatch(
  dealIds: number[],
  newStage: string,
  trigger: string,
): Promise<{ advanced: number; blocked: number }> {
  let advanced = 0;
  let blocked = 0;
  for (const dealId of dealIds) {
    try {
      const result = await advanceDealStage(dealId, newStage, trigger);
      if (result) advanced++;
    } catch (err) {
      if (err instanceof GoLiveGateError) {
        blocked++;
        // Already logged + audited inside advanceDealStage — no further action needed
      } else {
        throw err; // Re-throw unexpected errors
      }
    }
  }
  return { advanced, blocked };
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
          ${JSON.stringify((await import("./audit-sanitizer")).sanitizeAuditPayload({ contactId, channel: "pending" }))},
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

    // ── 2. Auto-initialize onboarding checklist (idempotent via onConflictDoNothing) ──
    try {
      await storage.initializeOnboardingChecklist(onboardingDealId);
      await storage.createAuditLog({
        action: "onboarding_checklist_initialized",
        entityType: "deal",
        entityId: onboardingDealId,
        details: { sourceDealId: salesDeal.id },
      });
      console.log(`[Onboarding] Checklist initialized for onboarding deal #${onboardingDealId}`);
    } catch (checklistErr: any) {
      console.error(`[Onboarding] Checklist init failed for deal #${onboardingDealId}:`, checklistErr?.message);
      throw checklistErr;
    }

    // ── 3. Ensure SLA tasks (concurrency-safe via unique partial index) ───
    await ensureOnboardingSLATasks(
      onboardingDealId,
      salesDeal.contactId,
      salesDeal.owner,
      closedWonAt,
    );

    // ── 4. Merchant welcome — atomic claim-then-dispatch ──────────────────
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
          await sendMerchantWelcomeEmail(contact, salesDeal);
        }
      }
    }
    // Note: 30/60/90-day merchant success sequence enrollment is handled by the
    // daily merchant-success-sequences BullMQ job which fires at the correct milestone
    // relative to merchantMids.activatedAt — not at Closed Won stage.
  } catch (err) {
    console.error("[Onboarding] triggerClosedWonOnboarding error:", err);
    // Called only by the durable stage-effect dispatcher. Propagate so the
    // intent remains recoverable instead of being marked falsely complete.
    throw err;
  }
}
