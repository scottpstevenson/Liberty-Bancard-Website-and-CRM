import { storage } from "../storage";
import { sendGhlEmail, isGhlConfigured } from "./ghl";
import { advanceDealStage } from "./deal-stage-service";
import { processSequenceEnrollments } from "./sequence-worker";
import { processSendQueue } from "./campaign-engine";
import { processEnrichmentQueue } from "./enrichment";
import { processSunbizEnrichmentQueue } from "./sunbiz-enrichment";
import { runSunbizAutoConvert } from "./sunbiz-cron";
import { featureFlags } from "./feature-flags";
import { scoreContact } from "./lead-scoring";
import { checkCompliance } from "./smart-router";
import { checkAndSendDigests, sendCriticalEmailNotification, createPreferenceAwareNotification } from "./digest-service";
import { checkAbTestWinners } from "./ab-test-worker";

const SLA_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_SLA_RULES = [
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

  // Update the existing audit row in place rather than emitting a new
  // *_collapsed audit per cycle. This keeps audit volume flat across the
  // throttle window so collapse truly silences the alert storm for any
  // downstream metrics/alerting that watch the audit_logs table.
  const { auditLogs } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");
  // Slide the audit row's createdAt forward so the 6h throttle window
  // anchors on the latest occurrence — long-running breaches keep
  // incrementing the counter indefinitely instead of stopping after 6h.
  const nowIso = new Date();
  await db.update(auditLogs).set({
    createdAt: nowIso,
    details: {
      ...prevDetails,
      sla_breach_collapsed: true,
      collapsedCount: nextCount,
      collapsedAt: nowIso.toISOString(),
      firstBreachAt: prevDetails.firstBreachAt || (recent.createdAt ? new Date(recent.createdAt).toISOString() : nowIso.toISOString()),
    },
  }).where(eq(auditLogs.id, recent.id));

  if (existingTaskId) {
    const tasks = await storage.getTasks();
    const t = tasks.find(x => x.id === existingTaskId);
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
    const tasks = await storage.getTasks();
    const pendingSla = tasks.filter(t =>
      t.status === "pending" && t.title?.includes("SLA Alert") && t.dealId && !activeStuckIds.has(t.dealId)
    );
    for (const t of pendingSla) {
      await storage.updateTask(t.id, { status: "completed" });
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
      t => t.dealId === deal.id && t.status === "pending" && t.title?.includes("SLA")
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

    await storage.createTask({
      dealId: deal.id,
      contactId: deal.contactId || undefined,
      title: `SLA Alert: ${rule.name} - Deal #${deal.id} stuck ${hoursStuck}hr`,
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
<p>Happy to walk through everything on a quick 10-minute call at your convenience.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
        });
      }
    }
  }
}

async function checkTicketSla() {
  const breachedTickets = await storage.getTicketsBreachingSla();

  for (const ticket of breachedTickets) {
    const existingTasks = (await storage.getTasks()).filter(
      t => t.ticketId === ticket.id && t.status === "pending" && t.title?.includes("SLA")
    );
    const existingTaskId = existingTasks[0]?.id ?? null;
    if (existingTaskId || await findRecentBreachAudit("ticket", ticket.id, "ticket_sla_breach", SLA_THROTTLE_HOURS)) {
      await collapseBreachIfRecent("ticket", ticket.id, "ticket_sla_breach", existingTaskId);
      continue;
    }

    const minutesPastSla = ticket.slaDeadline
      ? Math.round((Date.now() - new Date(ticket.slaDeadline).getTime()) / 60000)
      : 0;

    await storage.createTask({
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
  }
}

async function runSlaCheck() {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.SLA_WORKER);
  if (!acquired) return;
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
    await releaseJobLock(JOB_NAMES.SLA_WORKER, true);
  } catch (err: any) {
    console.error("SLA check error:", err);
    await releaseJobLock(JOB_NAMES.SLA_WORKER, false, err?.message ?? String(err));
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

      await storage.createTask({
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
<p>You can reply to this email with the documents or give us a call and we'll walk you through it.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
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

async function runScheduledAiOps() {
  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const allTasks = await storage.getTasks();
    const { data: allTickets } = await storage.getTickets({ limit: 500 });
    const { data: allContacts } = await storage.getContacts({ limit: 500 });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const existingTaskTitles = new Set(allTasks.map(t => t.title));

    const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
    let tasksGenerated = 0;

    for (const deal of salesDeals) {
      if (deal.updatedAt && new Date(deal.updatedAt) < sevenDaysAgo) {
        const title = `Follow up on stalling Deal #${deal.id}`;
        if (!existingTaskTitles.has(title)) {
          await storage.createTask({ title, description: `Deal #${deal.id} (${deal.stage}) has had no activity for 7+ days.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
          existingTaskTitles.add(title);
          tasksGenerated++;
          if (tasksGenerated >= 5) break;
        }
      }
    }

    const newLeads = allContacts.filter(c => c.status === "new" && c.createdAt && new Date(c.createdAt) < threeDaysAgo);
    for (const lead of newLeads.slice(0, 3)) {
      const title = `Contact new lead: ${lead.firstName} ${lead.lastName}`;
      if (!existingTaskTitles.has(title)) {
        await storage.createTask({ title, description: `${lead.firstName} ${lead.lastName} has been a new lead for 3+ days.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
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

    if (tasksGenerated > 0 || dealsProgressed > 0) {
      await storage.createAuditLog({ action: "scheduled_ai_ops", entityType: "system", details: { tasksGenerated, dealsProgressed, timestamp: now.toISOString() } });
      console.log(`Scheduled AI ops: ${tasksGenerated} tasks generated, ${dealsProgressed} deals progressed`);
    }
  } catch (err) {
    console.error("Scheduled AI operations error:", err);
  }
}

async function checkChargebackDeadlines() {
  try {
    const overdue = await storage.getOverdueChargebacks();
    for (const cb of overdue) {
      const existingTasks = (await storage.getTasks()).filter(
        t => t.title?.includes(`Chargeback #${cb.id}`) && t.status === "pending"
      );
      if (existingTasks.length > 0) continue;

      const deadlineDays = cb.responseDeadline
        ? Math.round((Date.now() - new Date(cb.responseDeadline).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      await storage.createTask({
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
    const deals = await storage.getDeals();
    const now = Date.now();
    for (const deal of deals) {
      if (!deal.contactId) continue;
      const goLiveDate = (deal as any).goLiveDate;
      if (!goLiveDate) continue;
      const daysSinceLive = Math.floor((now - new Date(goLiveDate).getTime()) / 86400000);

      const triggerDays = [30, 90];
      for (const dayTrigger of triggerDays) {
        if (daysSinceLive < dayTrigger || daysSinceLive > dayTrigger + 3) continue;

        const existingNps = await storage.getNpsResponsesByContact(deal.contactId);
        const alreadySent = existingNps.some(n => n.dayTrigger === dayTrigger);
        if (alreadySent) continue;

        const { randomBytes } = await import("crypto");
        const token = randomBytes(16).toString("hex");
        await storage.createNpsResponse({
          token,
          contactId: deal.contactId,
          dealId: deal.id,
          dayTrigger,
          emailSentAt: new Date(),
        });
        console.log(`[NPS] Day-${dayTrigger} survey created for deal #${deal.id} (contact ${deal.contactId})`);
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
          const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "Merchant";
          message = message.replace(/\{\{merchant_name\}\}/g, name);
        }
      }

      await storage.createTask({
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
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.MID_INGESTION);
  if (!acquired) return;
  try {
    const { ingestMidDataForActiveMids } = await import("./processor-api");
    const result = await ingestMidDataForActiveMids();
    if (result.processed > 0 || result.errors > 0) {
      console.log(`[MID Ingestion] Nightly run complete: ${result.processed} processed, ${result.errors} errors`);
    }
    await releaseJobLock(JOB_NAMES.MID_INGESTION, true);
  } catch (err: any) {
    console.error("[MID Ingestion] Nightly run error:", err);
    await releaseJobLock(JOB_NAMES.MID_INGESTION, false, err?.message ?? String(err));
  }
}

export function startSlaWorker() {
  if (slaInterval) return;
  console.log("SLA Worker started - checking every 5 minutes");
  slaInterval = setInterval(async () => {
    await runSlaCheck();
    await storage.setSystemSetting("sla_worker_last_tick", { at: new Date().toISOString(), cycle: cycleCount + 1 }).catch(() => {});
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
      }).catch(() => {});
      await processSendQueue().catch(err => console.error("Campaign send queue error:", err));
      await runSunbizAutoConvert().catch(err => console.error("Sunbiz auto-convert error:", err));
    } else {
      await storage.setSystemSetting("sequence_runner_last_tick", {
        at: new Date().toISOString(),
        processed: 0,
        sent: 0,
        enabled: false,
        note: "LEGACY_OUTREACH_ENABLED is off",
      }).catch(() => {});
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
    }
    await processEnrichmentQueue().catch(err => console.error("Enrichment queue error:", err));
    await processSunbizEnrichmentQueue(5).catch(err => console.error("Sunbiz enrichment queue error:", err));
    await checkDocumentReadiness().catch(err => console.error("Doc readiness check error:", err));
    await periodicLeadScoring().catch(err => console.error("Periodic scoring error:", err));
    await checkAndSendDigests().catch(err => console.error("Digest check error:", err));
    await checkApplicationReminders().catch(err => console.error("Application reminder error:", err));
    await checkChargebackDeadlines().catch(err => console.error("Chargeback deadline check error:", err));
    await checkNpsTriggers().catch(err => console.error("NPS trigger check error:", err));
    await checkRetentionCampaigns().catch(err => console.error("Retention campaign check error:", err));
    await checkAbTestWinners().catch(err => console.error("A/B test winner check error:", err));
    cycleCount++;
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
