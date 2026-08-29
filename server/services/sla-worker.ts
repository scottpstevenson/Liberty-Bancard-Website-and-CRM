import { storage } from "../storage";
import { normalizeTaskCompletionState } from "./task-normalization";
import { db } from "../db";
import { tasks, contacts } from "@shared/schema";
import { isNull, isNotNull, inArray, eq, or, and, lt, gte, sql as drizzleSql } from "drizzle-orm";
import { LEAD_SLA_SCORE_THRESHOLD, LEAD_SLA_MINUTES } from "./process-new-lead";
import { sendGhlEmail, isGhlConfigured, createGhlTask } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";
import { advanceDealStage } from "./deal-stage-service";
import { processSequenceEnrollments } from "./sequence-worker";
import { processSendQueue } from "./campaign-engine";
import { runSunbizAutoConvert } from "./sunbiz-cron";
import { featureFlags } from "./feature-flags";
import { scoreContact } from "./lead-scoring";
import { checkCompliance } from "./smart-router";
import { checkAndSendDigests, sendCriticalEmailNotification, createPreferenceAwareNotification } from "./digest-service";
import { checkAbTestWinners } from "./ab-test-worker";
import { runNightlyChurnScoring } from "./churn-score";

const SLA_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// #1326 — In-memory heartbeat failure counter. Incremented each time a
// setSystemSetting("*_last_tick") write fails. Health monitor reads this to
// distinguish "running but heartbeat broken" from "genuinely stalled worker".
// Reset to 0 on process restart (acceptable — stale counts don't persist).
export let _slaHeartbeatFailureCount = 0;

// ── Phase gate: runtime check for Phase 3 partial unique index ────────────────
// The worker switches to conflict-safe createStallingDealFollowUpTask() only
// when the partial unique index (migration 0054) is confirmed present in the DB.
// Cache semantics: only cache TRUE (index confirmed present — DDL is durable).
// FALSE/errors are NOT cached so the worker automatically transitions to the
// Phase 4 path once the index is applied without requiring a process restart.
let _phase3IndexConfirmed = false;
async function isPhase3IndexPresent(): Promise<boolean> {
  if (_phase3IndexConfirmed) return true; // once confirmed, index is durable
  try {
    const result = await db.execute(drizzleSql`
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'tasks_sla_stalling_active_unique'
      LIMIT 1
    `);
    const rows = (result as any).rows ?? result;
    const found = Array.isArray(rows) && rows.length > 0;
    if (found) _phase3IndexConfirmed = true; // memoize only on success
    return found;
  } catch {
    return false; // transient error: retry next cycle
  }
}

const DEFAULT_SLA_RULES = [
  {
    name: "Speed-to-Lead 60min",
    entityType: "deal",
    stage: "New Lead",
    maxDurationMinutes: 60,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "Statement Review 2hr SLA",
    entityType: "deal",
    stage: "Statement Received",
    maxDurationMinutes: 120,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "New Lead 24hr Follow-up",
    entityType: "deal",
    stage: "New Lead",
    maxDurationMinutes: 1440,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "Statement Requested 48hr Chase",
    entityType: "deal",
    stage: "Statement Requested",
    maxDurationMinutes: 2880,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "Proposal Follow-up 48hr",
    entityType: "deal",
    stage: "Proposal Sent",
    maxDurationMinutes: 2880,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "Call Booked No Update 24hr",
    entityType: "deal",
    stage: "Call Booked",
    maxDurationMinutes: 1440,
    escalationAction: "create_task_and_notify",
  },
  {
    name: "Support Ticket SLA Breach",
    entityType: "ticket",
    stage: null,
    maxDurationMinutes: 0,
    escalationAction: "escalate_ticket",
  },
];

const SLA_THROTTLE_HOURS = 6;

/**
 * Find the most recent matching breach audit row inside the throttle window.
 * Returns the row (so the caller can collapse into it) or null.
 */
async function findRecentBreachAudit(entityType: string, entityId: number, action: string, hours: number) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const logs = await storage.getAuditLogs();
  const matches = logs.filter((l: any) =>
    l.entityType === entityType &&
    l.entityId === entityId &&
    l.action === action &&
    l.createdAt && new Date(l.createdAt).getTime() > cutoff
  );
  if (matches.length === 0) return null;
  matches.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return matches[0];
}

/**
 * Collapse a repeat breach: bump the counter on the most recent audit row in
 * the throttle window, and refresh the existing pending task description.
 * Returns true when a collapse happened (caller should skip creating new noise).
 */
async function collapseBreachIfRecent(
  entityType: string,
  entityId: number,
  action: string,
  existingTaskId: number | null,
): Promise<boolean> {
  let recent = await findRecentBreachAudit(entityType, entityId, action, SLA_THROTTLE_HOURS);
  // If a stale pending task exists but the audit row has aged out of the
  // throttle window, anchor a fresh audit row so the counter keeps advancing
  // for long-running breaches instead of going silent.
  if (!recent && existingTaskId) {
    recent = await storage.createAuditLog({
      action,
      entityType,
      entityId,
      details: { sla_breach_collapsed: false, collapsedCount: 1, anchoredFromStaleTask: true, taskId: existingTaskId },
    });
  }
  if (!recent) return false;

  const prevDetails = (recent.details as Record<string, unknown>) || {};
  const prevCount = typeof prevDetails.collapsedCount === "number" ? prevDetails.collapsedCount : 1;
  const nextCount = prevCount + 1;
  const firstBreachAt = prevDetails.firstBreachAt || (recent.createdAt ? new Date(recent.createdAt).toISOString() : new Date().toISOString());

  // Append a new collapsed-breach audit row (audit log is append-only).
  // The throttle window check in findRecentBreachAudit ensures this still
  // silences alert storms — we emit at most one collapse row per throttle window.
  await storage.createAuditLog({
    action: `${action}_collapsed`,
    entityType,
    entityId,
    details: {
      sla_breach_collapsed: true,
      collapsedCount: nextCount,
      collapsedAt: new Date().toISOString(),
      firstBreachAt,
      originalAuditId: recent.id,
    },
  });

  if (existingTaskId) {
    const tasks = await storage.getTasks();
    const t = tasks.find((x: any) => x.id === existingTaskId);
    if (t) {
      const baseDesc = (t.description || "").replace(/\s*\(\+\d+ repeat breaches.*\)$/, "");
      await storage.updateTask(existingTaskId, {
        description: `${baseDesc} (+${nextCount - 1} repeat breaches in last ${SLA_THROTTLE_HOURS}h)`,
      });
    }
  }
  return true;
}

async function autoResolveClearedSlaTasks(activeStuckIds: Set<number>) {
  try {
    const allTasks = await storage.getTasks();
    const pendingSla = allTasks.filter((t: any) =>
      t.status === "pending" && t.title?.includes("SLA Alert") && t.dealId && !activeStuckIds.has(t.dealId)
    );
    for (const t of pendingSla) {
      const normalized = normalizeTaskCompletionState({ status: "completed" }, t);
      await storage.updateTask(t.id, normalized);
      await storage.createAuditLog({
        action: "sla_breach_resolved",
        entityType: "deal",
        entityId: t.dealId!,
        details: { taskId: t.id, resolvedAt: new Date().toISOString(), reason: "Deal moved out of breached stage" },
      });
    }
    if (pendingSla.length > 0) {
      console.log(`[SLA] Auto-resolved ${pendingSla.length} cleared SLA breaches`);
    }
  } catch (err) {
    console.error("[SLA] Auto-resolve error:", err);
  }
}

async function checkDealSla(rule: typeof DEFAULT_SLA_RULES[0]) {
  if (!rule.stage) return;

  const stuckDeals = await storage.getDealsStuckInStage(rule.stage, rule.maxDurationMinutes);

  for (const deal of stuckDeals) {
    const existingTasks = (await storage.getTasks()).filter(
      (t: any) => t.dealId === deal.id && t.status === "pending" && t.title?.includes("SLA")
    );
    const existingTaskId = existingTasks[0]?.id ?? null;

    // Collapse: if this same breach already happened within the throttle
    // window, bump the counter on the existing audit/task instead of creating
    // a new alert.
    if (existingTaskId || await findRecentBreachAudit("deal", deal.id, "sla_breach", SLA_THROTTLE_HOURS)) {
      await collapseBreachIfRecent("deal", deal.id, "sla_breach", existingTaskId);
      continue;
    }

    const minutesStuck = Math.round((Date.now() - new Date(deal.updatedAt!).getTime()) / 60000);
    const hoursStuck = Math.round(minutesStuck / 60);

    // Skip SLA alerts for leads that have no reachable contact channel — there
    // is nothing a rep can do until enrichment populates email/phone. The check
    // re-runs each SLA cycle so alerts resume automatically once data arrives.
    if (rule.stage === "New Lead" && deal.contactId) {
      try {
        const contact = await storage.getContact(deal.contactId);
        if (contact && !contact.email && !contact.phone) {
          await storage.createAuditLog({
            action: "sla_skipped_no_contact",
            entityType: "deal",
            entityId: deal.id,
            details: { rule: rule.name, minutesStuck, stage: rule.stage, reason: "no_email_no_phone" },
          });
          continue;
        }
      } catch { /* non-critical — fall through to create task */ }
    }

    await storage.createAuthorityTask({
      dealId: deal.id,
      contactId: deal.contactId || undefined,
      title: `SLA: ${rule.name} — Deal #${deal.id} (${hoursStuck}hr overdue)`,
      assignedTo: deal.owner || "Scott Stevenson",
      priority: "high",
      dueDate: new Date(Date.now() + 60 * 60 * 1000),
    });

    await createPreferenceAwareNotification({
      channel: "internal",
      title: `SLA Breach: ${rule.name}`,
      message: `Deal #${deal.id} has been in "${rule.stage}" for ${hoursStuck} hours. Immediate action required.`,
      type: "urgent",
      metadata: { dealId: deal.id, slaRule: rule.name, minutesStuck, eventType: "sla_breach" },
    }, "sla_breach");

    await storage.createAuditLog({
      action: "sla_breach",
      entityType: "deal",
      entityId: deal.id,
      details: { rule: rule.name, minutesStuck, stage: rule.stage, sla_breach_collapsed: false },
    });

    sendCriticalEmailNotification({
      eventType: "sla_breach",
      subject: `SLA Breach: ${rule.name} — Deal #${deal.id}`,
      body: `<h3>SLA Breach Alert</h3><p>Deal #${deal.id} has been in "${rule.stage}" for <strong>${hoursStuck} hours</strong>.</p><p>Rule: ${rule.name}</p><p>Owner: ${deal.owner || "Unassigned"}</p><p>Immediate action required.</p>`,
      ownerName: deal.owner,
    }).catch(err => console.error("SLA breach email error:", err));

    if (isGhlConfigured() && deal.contactId) {
      const contact = await storage.getContact(deal.contactId);
      if (contact && rule.stage === "Proposal Sent") {
        await sendGhlEmail({
          contactId: deal.contactId,
          dealId: deal.id,
          subject: `Following up on your processing review - ${contact.companyName || contact.firstName}`,
          body: `<p>Hi ${contact.firstName},</p>
<p>Just wanted to check in regarding the processing analysis we sent over. Did you have a chance to review the numbers?</p>
<p>Happy to walk through everything on a quick 10-minute call at your convenience.</p>${getEmailSignatureHtml("accounts")}`,
          fromEmail: "accounts@libertybancard.com",
          fromName: "Your Liberty Bancard Account Team",
        });
      }
      if (contact?.ghlContactId) {
        createGhlTask({
          contactId: contact.ghlContactId,
          title: `SLA Breach: ${rule.name} — ${contact.companyName || contact.firstName || "Deal #" + deal.id}`,
          description: `Deal has been in "${rule.stage}" for ${hoursStuck} hours. Immediate action required.`,
          taskType: "FOLLOW_UP",
          assignedTo: deal.owner || undefined,
          dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        }).catch(err => console.warn("[SLA] createGhlTask failed (non-critical):", err.message));
      }
    }
  }
}

// #399 — Auto-close tickets that have been in "Resolved" status for 7+ days
async function autoCloseResolvedTickets() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ticketResult = await storage.getTickets();
    const allTickets = Array.isArray(ticketResult) ? ticketResult : (ticketResult as any).data ?? [];
    const toClose = allTickets.filter((t: any) => t.status === "Resolved" && t.updatedAt && new Date(t.updatedAt) < cutoff);
    for (const ticket of toClose) {
      await storage.updateTicket(ticket.id, { status: "Closed" });
      await storage.createAuditLog({
        action: "ticket_auto_closed",
        entityType: "ticket",
        entityId: ticket.id,
        details: { reason: "Resolved for 7+ days", resolvedAt: ticket.updatedAt },
      });
    }
    if (toClose.length > 0) {
      console.log(`[SLA] Auto-closed ${toClose.length} resolved ticket(s) older than 7 days`);
    }
  } catch (err: any) {
    console.error("[SLA] autoCloseResolvedTickets error:", err.message);
  }
}

async function checkTicketSla() {
  await autoCloseResolvedTickets();
  const breachedTickets = await storage.getTicketsBreachingSla();

  for (const ticket of breachedTickets) {
    const existingTasks = (await storage.getTasks()).filter(
      (t: any) => t.ticketId === ticket.id && t.status === "pending" && t.title?.includes("SLA")
    );
    const existingTaskId = existingTasks[0]?.id ?? null;
    if (existingTaskId || await findRecentBreachAudit("ticket", ticket.id, "ticket_sla_breach", SLA_THROTTLE_HOURS)) {
      await collapseBreachIfRecent("ticket", ticket.id, "ticket_sla_breach", existingTaskId);
      continue;
    }

    const minutesPastSla = ticket.slaDeadline
      ? Math.round((Date.now() - new Date(ticket.slaDeadline).getTime()) / 60000)
      : 0;

    await storage.createAuthorityTask({
      ticketId: ticket.id,
      contactId: ticket.contactId || undefined,
      title: `SLA Breach: Ticket #${ticket.id} - "${ticket.subject}" past SLA by ${minutesPastSla}min`,
      assignedTo: ticket.assignedTo || "Support Team",
      priority: "high",
      dueDate: new Date(Date.now() + 30 * 60 * 1000),
    });

    await createPreferenceAwareNotification({
      channel: "internal",
      title: "Ticket SLA Breached",
      message: `Ticket #${ticket.id} "${ticket.subject}" has breached SLA by ${minutesPastSla} minutes. Priority: ${ticket.priority}`,
      type: "urgent",
      metadata: { ticketId: ticket.id, minutesPastSla, eventType: "sla_breach" },
    }, "sla_breach");

    await storage.createAuditLog({
      action: "ticket_sla_breach",
      entityType: "ticket",
      entityId: ticket.id,
      details: { minutesPastSla, priority: ticket.priority, category: ticket.category },
    });

    sendCriticalEmailNotification({
      eventType: "sla_breach",
      subject: `Ticket SLA Breach: #${ticket.id} — "${ticket.subject}"`,
      body: `<h3>Ticket SLA Breach</h3><p>Ticket #${ticket.id} "<strong>${ticket.subject}</strong>" has breached SLA by <strong>${minutesPastSla} minutes</strong>.</p><p>Priority: ${ticket.priority}<br/>Category: ${ticket.category}<br/>Assigned: ${ticket.assignedTo || "Unassigned"}</p>`,
      ownerName: ticket.assignedTo,
    }).catch(err => console.error("Ticket SLA breach email error:", err));

    if (isGhlConfigured() && ticket.contactId) {
      storage.getContact(ticket.contactId).then(ticketContact => {
        if (ticketContact?.ghlContactId) {
          createGhlTask({
            contactId: ticketContact.ghlContactId,
            title: `Ticket SLA Breach: #${ticket.id} — ${ticket.subject}`,
            description: `Ticket has breached SLA by ${minutesPastSla} minutes. Priority: ${ticket.priority}.`,
            taskType: "FOLLOW_UP",
            assignedTo: ticket.assignedTo || undefined,
            dueDate: new Date(Date.now() + 30 * 60 * 1000),
          }).catch(err => console.warn("[SLA] createGhlTask for ticket failed (non-critical):", err.message));
        }
      }).catch(() => {});
    }
  }
}

/**
 * Stalling-deal follow-up task generation scoped to a specific set of deal IDs.
 *
 * Called by runSlaCheck() with the full list of stalling deal IDs each cycle.
 * Also exported for targeted integration tests that need to exercise the
 * stalling-deal block in isolation without triggering the full SLA loop.
 *
 * Re-applies all five stalling predicates internally so that callers from tests
 * can safely pass any deal ID set without relying on the caller to pre-filter.
 */
export async function runSlaCheckForDeals(dealIds: number[]): Promise<{ tasksGenerated: number }> {
  if (dealIds.length === 0) return { tasksGenerated: 0 };

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Compute which deal IDs already have an active+incomplete canonical SLA task.
  // Dual-match during Phase 1–2 transitional window (canonical + legacy title).
  const blockedDealIds = new Set<number>();
  const candidateRows = await db
    .select({ dealId: tasks.dealId, source: tasks.source, automationKey: tasks.automationKey, title: tasks.title })
    .from(tasks)
    .where(
      and(
        inArray(tasks.dealId, dealIds),
        isNull(tasks.deletedAt),
        isNull(tasks.completedAt),
      )
    );
  for (const row of candidateRows) {
    if (!row.dealId) continue;
    const isCanonical = row.source === 'sla' && row.automationKey === 'stalling-deal-follow-up';
    const isLegacy = row.source === null && row.title === `Follow up on stalling Deal #${row.dealId}`;
    if (isCanonical || isLegacy) blockedDealIds.add(row.dealId);
  }

  // Fetch deal records and re-apply all five stalling predicates.
  const dealRows = await storage.getDealsByIds(dealIds);
  const stallingDeals = dealRows.filter(d =>
    d.pipeline === 'sales' &&
    d.stage !== 'Closed Won' &&
    d.stage !== 'Closed Lost' &&
    d.updatedAt != null &&
    new Date(d.updatedAt) < sevenDaysAgo
  );

  const phase4Ready = await isPhase3IndexPresent();

  let tasksGenerated = 0;
  for (const deal of stallingDeals) {
    if (blockedDealIds.has(deal.id)) continue;

    if (phase4Ready) {
      const { created } = await storage.createStallingDealFollowUpTask({
        title: `Follow up on stalling Deal #${deal.id}`,
        description: `Deal #${deal.id} (${deal.stage}) has had no activity for 7+ days.`,
        priority: "high",
        dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        dealId: deal.id,
      });
      if (created) {
        tasksGenerated++;
        if (tasksGenerated >= 5) break;
      }
    } else {
      const legacyTitle = `Follow up on stalling Deal #${deal.id}`;
      if (!blockedDealIds.has(deal.id)) {
        await db.insert(tasks).values({
          title: legacyTitle,
          description: `Deal #${deal.id} (${deal.stage}) has had no activity for 7+ days.`,
          priority: "high",
          dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          dealId: deal.id,
          source: 'sla' as any,
          automationKey: 'stalling-deal-follow-up' as any,
        });
        tasksGenerated++;
        if (tasksGenerated >= 5) break;
      }
    }
  }
  return { tasksGenerated };
}

export async function runSlaCheckDirect() {
  return runSlaCheck();
}

let fullLoopCycleCount = 0;
const FULL_LOOP_AI_OPS_EVERY_N = 2;
const FULL_LOOP_STAGE_PROGRESSION_EVERY_N = 12;

/**
 * Full SLA worker loop — intended for BullMQ sla-checks queue processor.
 * Runs every check the legacy setInterval did EXCEPT those that have their
 * own dedicated BullMQ queues (enrichment, sequences, digests, mid-ingestion).
 */
/**
 * checkLeadFreshnessSla — escalates high-score leads whose SLA timer expired.
 *
 * Fired every SLA_CHECKS tick (prod: every 5 min, dev: every 15 min).
 * Creates one task + notification per overdue lead, throttled by a 6-hour
 * collapse window so re-scans don't create duplicate alerts.
 */
async function checkLeadFreshnessSla(): Promise<{ escalated: number }> {
  let escalated = 0;
  const now = new Date();
  const FRESHNESS_THROTTLE_HOURS = 6;

  try {
    // Find all contacts with an expired SLA timer and sufficient lead score
    const overdueContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        leadScore: contacts.leadScore,
        assignedTo: contacts.assignedTo,
        nextSlaDueAt: contacts.nextSlaDueAt,
      })
      .from(contacts)
      .where(
        and(
          isNotNull(contacts.nextSlaDueAt),
          lt(contacts.nextSlaDueAt, now),
          gte(contacts.leadScore, LEAD_SLA_SCORE_THRESHOLD),
          isNull(contacts.archivedAt),
        ),
      )
      .limit(50); // cap per cycle to avoid thundering herd on backlog

    for (const contact of overdueContacts) {
      try {
        // Throttle: skip if we already escalated within the collapse window
        const alreadyEscalated = await findRecentBreachAudit(
          "contact",
          contact.id,
          "lead_freshness_sla_breach",
          FRESHNESS_THROTTLE_HOURS,
        );
        if (alreadyEscalated) continue;

        const minutesOverdue = Math.round(
          (now.getTime() - (contact.nextSlaDueAt?.getTime() ?? now.getTime())) / 60000,
        );
        const contactName =
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;
        const assignee = contact.assignedTo || "Scott Stevenson";

        // Create in-app task for the assigned rep
        await storage.createAuthorityTask({
          contactId: contact.id,
          title: `Speed-to-Lead SLA Breach: ${contactName} overdue ${minutesOverdue}m`,
          assignedTo: assignee,
          priority: "high",
          dueDate: new Date(Date.now() + 30 * 60 * 1000), // due in 30 min
          source: "sla",
          automationKey: `lead-freshness-sla-${contact.id}`,
        });

        // Internal notification
        await createPreferenceAwareNotification({
          channel: "internal",
          title: "Speed-to-Lead SLA Breach",
          message: `High-score lead ${contactName} (score ${contact.leadScore}) has not been contacted within ${LEAD_SLA_MINUTES} minutes. Assigned to: ${assignee}`,
          type: "urgent",
          metadata: {
            contactId: contact.id,
            leadScore: contact.leadScore,
            minutesOverdue,
            eventType: "lead_freshness_sla_breach",
          },
        }, "lead_freshness_sla_breach");

        // Audit log (also serves as the throttle sentinel)
        await storage.createAuditLog({
          action: "lead_freshness_sla_breach",
          entityType: "contact",
          entityId: contact.id,
          actorType: "system",
          details: {
            contactName,
            leadScore: contact.leadScore,
            minutesOverdue,
            assignedTo: assignee,
            nextSlaDueAt: contact.nextSlaDueAt?.toISOString(),
          },
        });

        // Email escalation (non-critical — fire-and-forget)
        sendCriticalEmailNotification({
          eventType: "lead_freshness_sla_breach",
          subject: `Speed-to-Lead SLA Breach: ${contactName} — ${minutesOverdue}m overdue`,
          body: `<h3>Lead Freshness SLA Breach</h3>
<p>High-score lead <strong>${contactName}</strong> (score: ${contact.leadScore}) has not received a human touch within the required <strong>${LEAD_SLA_MINUTES} minutes</strong>.</p>
<p>Now <strong>${minutesOverdue} minutes overdue</strong>.</p>
<p>Assigned to: ${assignee}</p>
<p>Please reach out immediately at <a href="/dashboard/contacts/${contact.id}">/dashboard/contacts/${contact.id}</a></p>`,
          ownerName: contact.assignedTo,
        }).catch(err => console.error("[LeadFreshnessSla] Email error:", err));

        escalated++;
        console.log(
          `[LeadFreshnessSla] Escalated #${contact.id} ${contactName} — score=${contact.leadScore} overdue=${minutesOverdue}m`,
        );
      } catch (err: any) {
        console.error(`[LeadFreshnessSla] Error escalating contact #${contact.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[LeadFreshnessSla] Query error:", err.message);
  }

  return { escalated };
}

export async function runFullSlaLoop(): Promise<void> {
  try {
    await runSlaCheck();
  } catch (err) {
    console.error("[SlaLoop] runSlaCheck error:", err);
  }

  try {
    await storage.setSystemSetting("sla_worker_last_tick", {
      at: new Date().toISOString(),
      cycle: fullLoopCycleCount + 1,
      driver: "bullmq",
    });
  } catch { /* non-critical */ }

  try {
    await checkWaitingWorkflows();
  } catch (err) {
    console.error("[SlaLoop] checkWaitingWorkflows error:", err);
  }

  try {
    await checkDocumentReadiness();
  } catch (err) {
    console.error("[SlaLoop] checkDocumentReadiness error:", err);
  }

  try {
    await periodicLeadScoring();
  } catch (err) {
    console.error("[SlaLoop] periodicLeadScoring error:", err);
  }

  try {
    await checkApplicationReminders();
  } catch (err) {
    console.error("[SlaLoop] checkApplicationReminders error:", err);
  }

  try {
    await checkChargebackDeadlines();
  } catch (err) {
    console.error("[SlaLoop] checkChargebackDeadlines error:", err);
  }

  try {
    await checkNpsTriggers();
  } catch (err) {
    console.error("[SlaLoop] checkNpsTriggers error:", err);
  }

  try {
    await checkRetentionCampaigns();
  } catch (err) {
    console.error("[SlaLoop] checkRetentionCampaigns error:", err);
  }

  try {
    await checkAbTestWinners();
  } catch (err) {
    console.error("[SlaLoop] checkAbTestWinners error:", err);
  }

  try {
    const result = await checkLeadFreshnessSla();
    if (result.escalated > 0) {
      console.log(`[SlaLoop:LeadFreshnessSla] Escalated ${result.escalated} overdue high-score leads`);
    }
  } catch (err) {
    console.error("[SlaLoop] checkLeadFreshnessSla error:", err);
  }

  try {
    const { checkStatementAcquisitionStalls } = await import("./statement-acquisition");
    const stallResult = await checkStatementAcquisitionStalls();
    if (stallResult.escalated > 0) {
      console.log(`[SlaLoop:StatementAcquisition] Escalated ${stallResult.escalated} stalled statement requests`);
    }
  } catch (err) {
    console.error("[SlaLoop] checkStatementAcquisitionStalls error:", err);
  }

  try {
    const { runBounceFeedbackWriteback } = await import("./bounce-feedback");
    const result = await runBounceFeedbackWriteback();
    if (result.updated > 0) {
      console.log(`[SlaLoop:BounceFeedback] Marked ${result.updated} contacts as bounced`);
    }
  } catch (err) {
    console.error("[SlaLoop] runBounceFeedbackWriteback error:", err);
  }

  if (fullLoopCycleCount % FULL_LOOP_STAGE_PROGRESSION_EVERY_N === 0) {
    try {
      const { runStageProgressionSweep } = await import("./stage-progression");
      const result = await runStageProgressionSweep({ limit: 1000 });
      if (result.progressed > 0) {
        console.log(`[SlaLoop:StageProgression] Auto-advanced ${result.progressed}/${result.evaluated} deals`);
      }
    } catch (err) {
      console.error("[SlaLoop] runStageProgressionSweep error:", err);
    }
  }

  fullLoopCycleCount++;

  if (fullLoopCycleCount % FULL_LOOP_AI_OPS_EVERY_N === 0) {
    try {
      await runScheduledAiOps();
    } catch (err) {
      console.error("[SlaLoop] runScheduledAiOps error:", err);
    }
  }
}

async function runSlaCheck() {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat, JOB_NAMES } = await import("./job-registry");
  const lease = await acquireJobLock(JOB_NAMES.SLA_WORKER);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;
  const heartbeat = startJobLockHeartbeat(JOB_NAMES.SLA_WORKER, lockToken);
  try {
    const slaConfigs = await storage.getSlaConfigs();
    const rules = slaConfigs.length > 0
      ? slaConfigs.filter(c => c.isActive).map(c => ({
          name: c.name,
          entityType: c.entityType,
          stage: c.stage,
          maxDurationMinutes: c.maxDurationMinutes,
          escalationAction: c.escalationAction,
        }))
      : DEFAULT_SLA_RULES;

    const activeStuckDealIds = new Set<number>();
    for (const rule of rules) {
      heartbeat.assertOwned();
      if (rule.entityType === "deal") {
        await checkDealSla(rule);
        if (rule.stage) {
          const stuck = await storage.getDealsStuckInStage(rule.stage, rule.maxDurationMinutes);
          stuck.forEach((d: any) => activeStuckDealIds.add(d.id));
        }
      } else if (rule.entityType === "ticket") {
        await checkTicketSla();
      }
    }
    await autoResolveClearedSlaTasks(activeStuckDealIds);
    // #1403 — Alert on overdue underwriting conditions (merchant hasn't submitted docs)
    await checkUnderwritingConditionSlas().catch((err: Error) =>
      console.error("[SlaLoop] underwriting conditions SLA error:", err.message),
    );
    await releaseJobLock(JOB_NAMES.SLA_WORKER, true, undefined, lockToken);
  } catch (err: any) {
    console.error("SLA check error:", err);
    await releaseJobLock(JOB_NAMES.SLA_WORKER, false, err?.message ?? String(err), lockToken);
  } finally {
    heartbeat.stop();
  }
}

/**
 * #1403 — Check for pending underwriting conditions that are past their due date.
 * Creates a high-priority internal task for each deal with overdue conditions,
 * deduplicated so only one SLA task exists per deal at a time.
 */
async function checkUnderwritingConditionSlas(): Promise<void> {
  const result = await db.execute(drizzleSql`
    SELECT
      uc.deal_id,
      STRING_AGG(uc.condition_type, ', ' ORDER BY uc.condition_type) AS overdue_conditions,
      COUNT(*)::int AS overdue_count
    FROM underwriting_conditions uc
    WHERE uc.status = 'pending'
      AND uc.submitted_at IS NULL
      AND uc.due_date IS NOT NULL
      AND uc.due_date < NOW()
      AND uc.merchant_visible = true
    GROUP BY uc.deal_id
    LIMIT 100
  `);

  const rows: Array<{ deal_id: number; overdue_conditions: string; overdue_count: number }> =
    (result as any).rows ?? (result as any);
  if (!Array.isArray(rows) || rows.length === 0) return;

  let flagged = 0;
  for (const row of rows) {
    const automationKey = `uw_condition_sla_overdue_${row.deal_id}`;
    await db.execute(drizzleSql`
      INSERT INTO tasks (deal_id, title, description, status, priority, source, automation_key)
      SELECT
        ${row.deal_id},
        ${"Overdue: merchant has not submitted underwriting documents"},
        ${`${row.overdue_count} condition(s) past due: ${row.overdue_conditions}. Follow up immediately.`},
        ${"pending"},
        ${"high"},
        ${"underwriting_sla"},
        ${automationKey}
      WHERE NOT EXISTS (
        SELECT 1 FROM tasks WHERE automation_key = ${automationKey} AND status != 'completed'
      )
    `);
    flagged++;
  }

  if (flagged > 0) {
    console.log(`[Underwriting SLA] Flagged ${flagged} deal(s) with overdue conditions`);
  }
}

async function checkWaitingWorkflows() {
  try {
    const { executeWorkflowActions } = await import("./workflow-executor");
    const allRuns = await storage.getWorkflowRuns();
    const waitingRuns = allRuns.filter(r => r.status === "waiting" && r.nextRunAt && new Date(r.nextRunAt) <= new Date());

    for (const run of waitingRuns) {
      const workflow = run.workflowId ? await storage.getWorkflow(run.workflowId) : null;
      if (!workflow) continue;

      const actions = (workflow.actions as any[]) || [];
      const currentStep = run.currentStep || 0;

      await executeWorkflowActions(workflow.id, actions, {
        entityType: run.entityType || undefined,
        entityId: run.entityId || undefined,
      }, run.id, currentStep);

      console.log(`[Workflow] Resumed waiting workflow "${workflow.name}" from step ${currentStep}`);
    }
  } catch (err) {
    console.error("Waiting workflow check error:", err);
  }
}

async function checkDocumentReadiness() {
  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const activeSalesDeals = allDeals.filter(
      d => d.pipeline === "sales" &&
        d.stage !== "Closed Won" && d.stage !== "Closed Lost" && d.stage !== "New Lead" &&
        d.contactId
    );

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let nudgesCreated = 0;

    for (const deal of activeSalesDeals) {
      if (nudgesCreated >= 5) break;

      const docs = {
        statement: deal.statementReceived || false,
        app: deal.appCompleted || false,
        voidedCheck: deal.voidedCheckReceived || false,
        id: deal.idReceived || false,
      };
      const completed = Object.values(docs).filter(Boolean).length;

      if (completed >= 4) continue;
      if (completed === 0 && deal.stage === "Statement Received") continue;

      if (deal.lastNudgeAt && new Date(deal.lastNudgeAt) > twentyFourHoursAgo) continue;

      const missing: string[] = [];
      if (!docs.statement) missing.push("processing statement");
      if (!docs.app) missing.push("merchant application");
      if (!docs.voidedCheck) missing.push("voided check");
      if (!docs.id) missing.push("owner ID");

      if (missing.length === 0) continue;

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      if (!contact) continue;

      await storage.createAuthorityTask({
        dealId: deal.id,
        contactId: deal.contactId || undefined,
        title: `Doc Nudge: ${contact.firstName} ${contact.lastName} missing ${missing.join(", ")}`,
        assignedTo: deal.owner || "Scott Stevenson",
        priority: completed >= 2 ? "high" : "medium",
        dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });

      if (isGhlConfigured() && completed >= 1) {
        const compliance = checkCompliance(contact);
        if (compliance.channelsAllowed.includes("email")) {
          try {
            await sendGhlEmail({
              contactId: deal.contactId!,
              dealId: deal.id,
              subject: `Quick update needed - ${contact.companyName || "your account"}`,
              body: `<p>Hi ${contact.firstName},</p>
<p>We're making great progress on your processing setup! To keep things moving, we just need a few more items:</p>
<ul>${missing.map(m => `<li>${m.charAt(0).toUpperCase() + m.slice(1)}</li>`).join("")}</ul>
<p>You can reply to this email with the documents or give us a call and we'll walk you through it.</p>${getEmailSignatureHtml("accounts")}`,
              fromEmail: "accounts@libertybancard.com",
              fromName: "Your Liberty Bancard Account Team",
            });
          } catch (emailErr) {
            console.error(`Doc nudge email failed for deal ${deal.id}:`, emailErr);
          }
        }
      }

      await storage.updateDeal(deal.id, {
        lastNudgeAt: now,
        nextNudgeAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        docReadinessScore: completed,
      });

      nudgesCreated++;
    }

    if (nudgesCreated > 0) {
      console.log(`Doc readiness: ${nudgesCreated} nudges created`);
    }
  } catch (err) {
    console.error("Document readiness check error:", err);
  }
}

async function periodicLeadScoring() {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const staleContacts = contacts.filter(c => {
      if (!c.lastScoredAt) return true;
      return new Date(c.lastScoredAt) < sixHoursAgo;
    });

    const toScore = staleContacts.slice(0, 10);
    let scored = 0;

    for (const contact of toScore) {
      try {
        await scoreContact(contact.id);
        scored++;
      } catch (err) {
        console.warn(`Periodic scoring failed for contact ${contact.id}:`, err instanceof Error ? err.message : err);
      }
    }

    if (scored > 0) {
      console.log(`Periodic scoring: ${scored} contacts re-scored`);
    }
  } catch (err) {
    console.error("Periodic lead scoring error:", err);
  }
}

let slaInterval: NodeJS.Timeout | null = null;
let cycleCount = 0;
const AI_OPS_EVERY_N_CYCLES = 2;
const STAGE_PROGRESSION_EVERY_N_CYCLES = 12; // ~1 hour at 5-min cycle

// Single-process re-entrancy guard. This deployment runs in a single Replit
// process (no pm2 cluster, no multi-dyno). If the deployment model changes to
// multi-process or multi-instance, replace this flag with a distributed
// advisory lock (e.g. a Redis SET NX with a short TTL).
let _aiOpsRunning = false;

async function runScheduledAiOps() {
  if (_aiOpsRunning) {
    console.log("[SLA] runScheduledAiOps already in progress — skipping concurrent invocation");
    return;
  }
  _aiOpsRunning = true;
  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const allTasks = await storage.getTasks();
    const { data: allTickets } = await storage.getTickets({ limit: 500 });
    const { data: allContacts } = await storage.getContacts({ limit: 500 });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const existingTaskTitles = new Set(allTasks.map((t: any) => t.title));

    const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
    const stallingDeals = salesDeals.filter(d => d.updatedAt && new Date(d.updatedAt) < sevenDaysAgo);

    let tasksGenerated = 0;

    // Delegate to scoped helper — handles blockedDealIds computation, phase gate,
    // and the insert loop (lines extracted to runSlaCheckForDeals above).
    const slaResult = await runSlaCheckForDeals(stallingDeals.map(d => d.id));
    tasksGenerated += slaResult.tasksGenerated;

    const newLeads = allContacts.filter(c => c.status === "new" && c.createdAt && new Date(c.createdAt) < threeDaysAgo);
    for (const lead of newLeads.slice(0, 3)) {
      const title = `Contact new lead: ${lead.firstName} ${lead.lastName}`;
      if (!existingTaskTitles.has(title)) {
        await storage.createAuthorityTask({ title, description: `${lead.firstName} ${lead.lastName} has been a new lead for 3+ days.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
        tasksGenerated++;
      }
    }

    const stageOrder = ["New Lead", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Closed Won"];
    let dealsProgressed = 0;
    for (const deal of salesDeals) {
      const currentIndex = stageOrder.indexOf(deal.stage);
      if (currentIndex < 0) continue;
      let shouldAdvance = false;
      let reason = "";
      if (deal.stage === "New Lead" && deal.lastStatementReviewDate) { shouldAdvance = true; reason = "Statement received"; }
      if (deal.stage === "Statement Received" && deal.recommendedPath) { shouldAdvance = true; reason = "Review completed"; }
      if (deal.stage === "Review In Progress" && deal.effectiveRate) { shouldAdvance = true; reason = "Analysis complete"; }

      if (shouldAdvance && currentIndex + 1 < stageOrder.length) {
        const nextStage = stageOrder[currentIndex + 1];
        await advanceDealStage(deal.id, nextStage, "sla_scheduled");
        await storage.createAuditLog({ action: "deal_auto_progressed", entityType: "deal", entityId: deal.id, details: { from: deal.stage, to: nextStage, reason, source: "scheduled" } });
        dealsProgressed++;
      }
    }

    // Always log the cycle — even zero-task runs — so SLA cycle health is observable
    // and two-cycle post-deploy verification can be confirmed from audit_logs.
    await storage.createAuditLog({ action: "scheduled_ai_ops", entityType: "system", details: { tasksGenerated, dealsProgressed, timestamp: now.toISOString() } });
    console.log(`[SLA] AI ops cycle complete: ${tasksGenerated} tasks generated, ${dealsProgressed} deals progressed`);
  } catch (err) {
    console.error("Scheduled AI operations error:", err);
  } finally {
    _aiOpsRunning = false;
  }
}

async function checkChargebackDeadlines() {
  try {
    const overdue = await storage.getOverdueChargebacks();
    for (const cb of overdue) {
      const existingTasks = (await storage.getTasks()).filter(
        (t: any) => t.title?.includes(`Chargeback #${cb.id}`) && t.status === "pending"
      );
      if (existingTasks.length > 0) continue;

      const deadlineDays = cb.responseDeadline
        ? Math.round((Date.now() - new Date(cb.responseDeadline).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      await storage.createAuthorityTask({
        contactId: cb.contactId || undefined,
        dealId: cb.dealId || undefined,
        title: `OVERDUE Chargeback #${cb.id} — $${cb.amount.toFixed(2)} (${cb.cardBrand}) past deadline by ${deadlineDays}d`,
        assignedTo: "Scott Stevenson",
        priority: "high",
        dueDate: new Date(),
      });

      await createPreferenceAwareNotification({
        channel: "internal",
        title: "Chargeback Deadline Overdue",
        message: `Chargeback #${cb.id} ($${cb.amount.toFixed(2)}, ${cb.cardBrand}) is ${deadlineDays} day(s) past its response deadline. Status: ${cb.status}.`,
        type: "urgent",
        metadata: { chargebackId: cb.id, eventType: "chargeback_overdue" },
      }, "sla_breach").catch(() => {});

      console.log(`[Chargeback] Overdue alert created for chargeback #${cb.id}`);
    }
  } catch (err) {
    console.error("Chargeback deadline check error:", err);
  }
}

async function checkApplicationReminders() {
  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const onboardingDeals = allDeals.filter(
      d => d.pipeline === "onboarding" &&
        (d.stage === "Contract Sent" || d.stage === "Application Started") &&
        !d.appCompleted
    );

    if (onboardingDeals.length === 0) return;

    const auditLogs = await storage.getAuditLogs();
    const now = Date.now();

    for (const deal of onboardingDeals) {
      const onboardingEntries = auditLogs.filter(
        (log: any) =>
          log.entityId === deal.id &&
          log.entityType === "deal" &&
          (log.action === "closed_won_onboarding_workflow" ||
            (log.action === "deal_stage_changed" && (log.details as any)?.to === "Contract Sent"))
      );
      const onboardingEntry = onboardingEntries.length > 0
        ? onboardingEntries.reduce((earliest: any, log: any) =>
            new Date(log.createdAt).getTime() < new Date(earliest.createdAt).getTime() ? log : earliest
          )
        : null;

      const onboardingStartTime = onboardingEntry?.createdAt
        ? new Date(onboardingEntry.createdAt).getTime()
        : (deal.updatedAt ? new Date(deal.updatedAt).getTime() : (deal.createdAt ? new Date(deal.createdAt).getTime() : now));

      const daysSinceOnboarding = Math.floor((now - onboardingStartTime) / (1000 * 60 * 60 * 24));

      const reminderDays = [1, 3, 7];
      const sentReminders = auditLogs.filter(
        (log: any) => log.entityId === deal.id && /^application_reminder_day\d+_sent$/.test(log.action)
      );

      const lastSentTime = sentReminders.length > 0
        ? Math.max(...sentReminders.map((log: any) => new Date(log.createdAt).getTime()))
        : 0;
      const hoursSinceLastReminder = lastSentTime > 0
        ? (now - lastSentTime) / (1000 * 60 * 60)
        : Infinity;

      const MIN_HOURS_BETWEEN_REMINDERS = 36;

      if (hoursSinceLastReminder < MIN_HOURS_BETWEEN_REMINDERS) continue;

      for (const dayNumber of reminderDays) {
        if (daysSinceOnboarding >= dayNumber) {
          const alreadySent = sentReminders.some(
            (log: any) => log.action === `application_reminder_day${dayNumber}_sent`
          );
          if (alreadySent) continue;

          const { triggerWorkflowsByEvent } = await import("./workflow-executor");
          const results = await triggerWorkflowsByEvent("application_reminder", {
            entityType: "deal",
            entityId: deal.id,
            contactId: deal.contactId || undefined,
            dealId: deal.id,
          }, { dayNumber });

          const anyExecuted = results.length > 0 && results.some(r => r.status === "completed" || r.status === "waiting");
          if (anyExecuted) {
            await storage.createAuditLog({
              action: `application_reminder_day${dayNumber}_sent`,
              entityType: "deal",
              entityId: deal.id,
              details: { dayNumber, daysSinceOnboarding, onboardingStartTime: new Date(onboardingStartTime).toISOString() },
            });
            console.log(`[Reminder] Day ${dayNumber} application reminder sent for deal #${deal.id}`);
          } else {
            console.log(`[Reminder] Day ${dayNumber} reminder triggered but no workflows executed for deal #${deal.id}`);
          }
          break;
        }
      }
    }
  } catch (err) {
    console.error("Application reminder check error:", err);
  }
}

async function checkNpsTriggers() {
  try {
    const { createAndSendNpsSurvey } = await import("./nps-email");
    const { data: deals } = await storage.getDeals();
    const now = Date.now();
    for (const deal of deals) {
      if (!deal.contactId) continue;
      const goLiveDate = (deal as any).goLiveDate;
      if (!goLiveDate) continue;
      const daysSinceLive = Math.floor((now - new Date(goLiveDate).getTime()) / 86400000);

      const triggerDays = [30, 90];
      for (const dayTrigger of triggerDays) {
        if (daysSinceLive < dayTrigger || daysSinceLive > dayTrigger + 3) continue;

        await createAndSendNpsSurvey({
          contactId: deal.contactId,
          dealId: deal.id,
          dayTrigger,
        });
      }
    }
  } catch (err) {
    console.error("NPS trigger check error:", err);
  }
}

async function checkRetentionCampaigns() {
  try {
    const alerts = await storage.getActiveHealthAlerts();
    for (const alert of alerts) {
      if ((alert as any).retentionTaskCreated) continue;
      const config = await storage.getRetentionCampaignConfigByAlertType(alert.alertType);
      if (!config) continue;

      const dueDays = config.taskDueDays || 1;
      const dueDate = new Date(Date.now() + dueDays * 86400000);

      let message = config.suggestedMessage || "";
      if (alert.contactId) {
        const contact = await storage.getContact(alert.contactId);
        if (contact) {
          const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || "Merchant";
          message = message.replace(/\{\{merchant_name\}\}/g, name);
        }
      }

      await storage.createAuthorityTask({
        contactId: alert.contactId || undefined,
        dealId: alert.dealId || undefined,
        title: `[Retention] ${config.campaignName} — ${alert.title}`,
        description: message || `Follow up with merchant regarding: ${alert.title}`,
        assignedTo: "Scott Stevenson",
        priority: config.taskPriority || "high",
        dueDate,
        status: "pending",
      });

      await storage.updateHealthAlert(alert.id, { retentionTaskCreated: true } as any);
      console.log(`[Retention] Task created for alert #${alert.id} (${alert.alertType}) using campaign "${config.campaignName}"`);
    }
  } catch (err) {
    console.error("Retention campaign check error:", err);
  }
}

const MID_INGESTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
let midIngestionInterval: NodeJS.Timeout | null = null;

async function runMidIngestion() {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat, JOB_NAMES } = await import("./job-registry");
  const lease = await acquireJobLock(JOB_NAMES.MID_INGESTION);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;
  const heartbeat = startJobLockHeartbeat(JOB_NAMES.MID_INGESTION, lockToken);
  try {
    heartbeat.assertOwned();
    const { ingestMidDataForActiveMids } = await import("./processors/registry");
    const result = await ingestMidDataForActiveMids();
    if (result.processed > 0 || result.errors > 0) {
      console.log(`[MID Ingestion] Nightly run complete: ${result.processed} processed, ${result.errors} errors`);
    }
    await releaseJobLock(JOB_NAMES.MID_INGESTION, true, undefined, lockToken);
  } catch (err: any) {
    console.error("[MID Ingestion] Nightly run error:", err);
    await releaseJobLock(JOB_NAMES.MID_INGESTION, false, err?.message ?? String(err), lockToken);
  } finally {
    heartbeat.stop();
  }
}

export function startSlaWorker() {
  if (slaInterval) return;
  console.log("SLA Worker started - checking every 5 minutes");
  slaInterval = setInterval(async () => {
    await runSlaCheck();
    // #1325/#1326 — Surface heartbeat write failures; count them so operators can
    // distinguish "healthy worker, broken heartbeat" from "worker stalled".
    await storage.setSystemSetting("sla_worker_last_tick", { at: new Date().toISOString(), cycle: cycleCount + 1 }).catch((err: Error) => {
      console.error("[SLA Worker] heartbeat write failed (sla_worker_last_tick):", err.message);
      _slaHeartbeatFailureCount++;
    });
    await checkWaitingWorkflows();
    if (featureFlags.LEGACY_OUTREACH_ENABLED) {
      let processed = 0, sent = 0;
      try {
        const result = await processSequenceEnrollments();
        if (result && typeof result === "object") {
          processed = (result as any).processed ?? 0;
          sent = (result as any).sent ?? 0;
        }
      } catch (err) {
        console.error("Sequence enrollment processing error:", err);
      }
      await storage.setSystemSetting("sequence_runner_last_tick", {
        at: new Date().toISOString(),
        processed,
        sent,
        enabled: true,
      }).catch((err: Error) => {
        console.error("[SLA Worker] heartbeat write failed (sequence_runner_last_tick/enabled):", err.message);
        _slaHeartbeatFailureCount++;
      });
      await processSendQueue().catch(err => console.error("Campaign send queue error:", err));
      await runSunbizAutoConvert().catch(err => console.error("Sunbiz auto-convert error:", err));
    } else {
      await storage.setSystemSetting("sequence_runner_last_tick", {
        at: new Date().toISOString(),
        processed: 0,
        sent: 0,
        enabled: false,
        note: "LEGACY_OUTREACH_ENABLED is off",
      }).catch((err: Error) => {
        console.error("[SLA Worker] heartbeat write failed (sequence_runner_last_tick/disabled):", err.message);
        _slaHeartbeatFailureCount++;
      });
    }

    // Auto-advance sales deals based on derived signals once per hour
    // (cycleCount increments at the bottom of this interval).
    if (cycleCount % STAGE_PROGRESSION_EVERY_N_CYCLES === 0) {
      try {
        const { runStageProgressionSweep } = await import("./stage-progression");
        const result = await runStageProgressionSweep({ limit: 1000 });
        if (result.progressed > 0) {
          console.log(`[StageProgression] Auto-advanced ${result.progressed}/${result.evaluated} active sales deals`);
        }
      } catch (err) {
        console.error("[StageProgression] Worker sweep error:", err);
      }

      // New-lead auto-enrollment check — runs at the same ~hourly cadence.
      // When autoEnrollNewLeadDeals=false (default): writes candidate audit entries only.
      // When autoEnrollNewLeadDeals=true: creates enrollments for eligible deal contacts.
      try {
        const { runNewLeadAutoEnrollCheck } = await import("./new-lead-enrollment-job");
        await runNewLeadAutoEnrollCheck();
      } catch (err) {
        console.error("[NewLeadAutoEnroll] Worker check error:", err);
      }
    }
    await checkDocumentReadiness().catch(err => console.error("Doc readiness check error:", err));
    await periodicLeadScoring().catch(err => console.error("Periodic scoring error:", err));
    await checkAndSendDigests().catch(err => console.error("Digest check error:", err));
    await checkApplicationReminders().catch(err => console.error("Application reminder error:", err));
    await checkChargebackDeadlines().catch(err => console.error("Chargeback deadline check error:", err));
    await checkNpsTriggers().catch(err => console.error("NPS trigger check error:", err));
    await checkRetentionCampaigns().catch(err => console.error("Retention campaign check error:", err));
    await checkAbTestWinners().catch(err => console.error("A/B test winner check error:", err));
    cycleCount++;
    // Nightly churn scoring — runs once every 288 cycles (~24h at 5-min intervals)
    const CHURN_SCORE_EVERY_N_CYCLES = 288;
    if (cycleCount % CHURN_SCORE_EVERY_N_CYCLES === 1) {
      runNightlyChurnScoring().catch(err => console.error("Churn scoring error:", err));
    }
    if (cycleCount % AI_OPS_EVERY_N_CYCLES === 0) {
      await runScheduledAiOps();
    }
  }, SLA_CHECK_INTERVAL_MS);

  if (!midIngestionInterval) {
    midIngestionInterval = setInterval(runMidIngestion, MID_INGESTION_INTERVAL_MS);
    setTimeout(runMidIngestion, 60 * 1000);
  }

  setTimeout(async () => {
    await runSlaCheck();
    await checkWaitingWorkflows();
    if (featureFlags.LEGACY_OUTREACH_ENABLED) {
      await processSequenceEnrollments().catch(err => console.error("Sequence enrollment processing error:", err));
    }
  }, 30000);
}

export function stopSlaWorker() {
  if (slaInterval) {
    clearInterval(slaInterval);
    slaInterval = null;
  }
  if (midIngestionInterval) {
    clearInterval(midIngestionInterval);
    midIngestionInterval = null;
  }
}
