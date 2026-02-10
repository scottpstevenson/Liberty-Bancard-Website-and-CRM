import { storage } from "../storage";
import { sendGhlEmail, isGhlConfigured } from "./ghl";
import { processSequenceEnrollments } from "./sequence-worker";
import { processSendQueue } from "./campaign-engine";
import { processEnrichmentQueue } from "./enrichment";
import { processSunbizEnrichmentQueue } from "./sunbiz-enrichment";
import { scoreContact } from "./lead-scoring";
import { checkCompliance } from "./smart-router";

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

async function checkDealSla(rule: typeof DEFAULT_SLA_RULES[0]) {
  if (!rule.stage) return;

  const stuckDeals = await storage.getDealsStuckInStage(rule.stage, rule.maxDurationMinutes);

  for (const deal of stuckDeals) {
    const existingTasks = (await storage.getTasks()).filter(
      t => t.dealId === deal.id && t.status === "pending" && t.title?.includes("SLA")
    );
    if (existingTasks.length > 0) continue;

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

    await storage.createNotification({
      channel: "internal",
      title: `SLA Breach: ${rule.name}`,
      message: `Deal #${deal.id} has been in "${rule.stage}" for ${hoursStuck} hours. Immediate action required.`,
      type: "urgent",
      metadata: { dealId: deal.id, slaRule: rule.name, minutesStuck },
    });

    await storage.createAuditLog({
      action: "sla_breach",
      entityType: "deal",
      entityId: deal.id,
      details: { rule: rule.name, minutesStuck, stage: rule.stage },
    });

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
    if (existingTasks.length > 0) continue;

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

    await storage.createNotification({
      channel: "internal",
      title: "Ticket SLA Breached",
      message: `Ticket #${ticket.id} "${ticket.subject}" has breached SLA by ${minutesPastSla} minutes. Priority: ${ticket.priority}`,
      type: "urgent",
      metadata: { ticketId: ticket.id, minutesPastSla },
    });

    await storage.createAuditLog({
      action: "ticket_sla_breach",
      entityType: "ticket",
      entityId: ticket.id,
      details: { minutesPastSla, priority: ticket.priority, category: ticket.category },
    });
  }
}

async function runSlaCheck() {
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

    for (const rule of rules) {
      if (rule.entityType === "deal") {
        await checkDealSla(rule);
      } else if (rule.entityType === "ticket") {
        await checkTicketSla();
      }
    }
  } catch (err) {
    console.error("SLA check error:", err);
  }
}

async function checkWaitingWorkflows() {
  try {
    const allRuns = await storage.getWorkflowRuns();
    const waitingRuns = allRuns.filter(r => r.status === "waiting" && r.nextRunAt && new Date(r.nextRunAt) <= new Date());

    for (const run of waitingRuns) {
      const workflow = run.workflowId ? await storage.getWorkflow(run.workflowId) : null;
      if (!workflow) continue;

      const actions = (workflow.actions as any[]) || [];
      const currentStep = run.currentStep || 0;
      const logEntries: any[] = [...((run.log as any[]) || [])];

      let contactId: number | undefined;
      let dealId: number | undefined;
      if (run.entityType === "deal" && run.entityId) {
        dealId = run.entityId;
        const deal = await storage.getDeal(dealId);
        contactId = deal?.contactId || undefined;
      } else if (run.entityType === "contact" && run.entityId) {
        contactId = run.entityId;
      }

      for (let i = currentStep; i < actions.length; i++) {
        const action = actions[i];
        try {
          if (action.type === "wait") {
            const waitMinutes = action.minutes || (action.hours || 1) * 60;
            logEntries.push({ step: i + 1, action: "wait_resumed", timestamp: new Date().toISOString() });
            continue;
          }

          if (action.type === "create_task") {
            await storage.createTask({
              title: action.title || `Auto-task from ${workflow.name}`,
              assignedTo: action.assignedTo || "Unassigned",
              priority: action.priority || "medium",
              dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 60 * 60 * 1000) : undefined,
              dealId, contactId,
            });
            logEntries.push({ step: i + 1, action: "create_task", title: action.title, status: "completed", timestamp: new Date().toISOString() });
          } else if (action.type === "send_notification") {
            await storage.createNotification({
              channel: action.channel || "internal",
              title: action.title || `Workflow: ${workflow.name}`,
              message: action.message || "Automated workflow notification",
              type: action.notificationType || "info",
            });
            logEntries.push({ step: i + 1, action: "send_notification", status: "completed", timestamp: new Date().toISOString() });
          } else if (action.type === "send_ghl_email" && contactId) {
            const { sendGhlEmail: sendEmail, sendTemplatedMessage: sendTemplate } = await import("./ghl");
            if (action.templateId) {
              await sendTemplate({ templateId: action.templateId, contactId, dealId });
            } else {
              await sendEmail({ contactId, dealId, subject: action.subject || "", body: action.body || "" });
            }
            logEntries.push({ step: i + 1, action: "send_ghl_email", status: "completed", timestamp: new Date().toISOString() });
          } else if (action.type === "send_ghl_sms" && contactId) {
            const { sendGhlSms: sendSms, sendTemplatedMessage: sendTemplate } = await import("./ghl");
            if (action.templateId) {
              await sendTemplate({ templateId: action.templateId, contactId, dealId });
            } else {
              await sendSms({ contactId, dealId, body: action.body || "" });
            }
            logEntries.push({ step: i + 1, action: "send_ghl_sms", status: "completed", timestamp: new Date().toISOString() });
          }

          if (i + 1 < actions.length && actions[i + 1]?.type === "wait") {
            const nextWait = actions[i + 1];
            const waitMinutes = nextWait.minutes || (nextWait.hours || 1) * 60;
            await storage.updateWorkflowRun(run.id, {
              status: "waiting",
              currentStep: i + 2,
              nextRunAt: new Date(Date.now() + waitMinutes * 60 * 1000),
              log: logEntries,
            });
            break;
          }
        } catch (stepErr: any) {
          logEntries.push({ step: i + 1, action: action.type, status: "failed", error: stepErr.message, timestamp: new Date().toISOString() });
        }
      }

      const lastLog = logEntries[logEntries.length - 1];
      if (lastLog?.action !== "wait" && lastLog?.status !== "waiting") {
        await storage.updateWorkflowRun(run.id, {
          status: "completed",
          completedAt: new Date(),
          currentStep: actions.length,
          log: logEntries,
        });
      }
    }
  } catch (err) {
    console.error("Waiting workflow check error:", err);
  }
}

async function checkDocumentReadiness() {
  try {
    const allDeals = await storage.getDeals();
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
        if (compliance.canEmail) {
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
    const contacts = await storage.getContacts();
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
      } catch (err) {}
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
const AI_OPS_EVERY_N_CYCLES = 6;

async function runScheduledAiOps() {
  try {
    const allDeals = await storage.getDeals();
    const allTasks = await storage.getTasks();
    const allTickets = await storage.getTickets();
    const allContacts = await storage.getContacts();

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

    const stageOrder = ["New Lead", "Statement Collected", "Under Review", "Proposal Sent", "Negotiation", "Verbal Commit", "Closed Won"];
    let dealsProgressed = 0;
    for (const deal of salesDeals) {
      const currentIndex = stageOrder.indexOf(deal.stage);
      if (currentIndex < 0) continue;
      let shouldAdvance = false;
      let reason = "";
      if (deal.stage === "New Lead" && deal.lastStatementReviewDate) { shouldAdvance = true; reason = "Statement received"; }
      if (deal.stage === "Statement Collected" && deal.recommendedPath) { shouldAdvance = true; reason = "Review completed"; }
      if (deal.stage === "Under Review" && deal.effectiveRate) { shouldAdvance = true; reason = "Analysis complete"; }

      if (shouldAdvance && currentIndex + 1 < stageOrder.length) {
        const nextStage = stageOrder[currentIndex + 1];
        await storage.updateDeal(deal.id, { stage: nextStage });
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

export function startSlaWorker() {
  if (slaInterval) return;
  console.log("SLA Worker started - checking every 5 minutes");
  slaInterval = setInterval(async () => {
    await runSlaCheck();
    await checkWaitingWorkflows();
    await processSequenceEnrollments();
    await processSendQueue().catch(err => console.error("Campaign send queue error:", err));
    await processEnrichmentQueue().catch(err => console.error("Enrichment queue error:", err));
    await processSunbizEnrichmentQueue(5).catch(err => console.error("Sunbiz enrichment queue error:", err));
    await checkDocumentReadiness().catch(err => console.error("Doc readiness check error:", err));
    await periodicLeadScoring().catch(err => console.error("Periodic scoring error:", err));
    cycleCount++;
    if (cycleCount % AI_OPS_EVERY_N_CYCLES === 0) {
      await runScheduledAiOps();
    }
  }, SLA_CHECK_INTERVAL_MS);

  setTimeout(async () => {
    await runSlaCheck();
    await checkWaitingWorkflows();
    await processSequenceEnrollments();
  }, 30000);
}

export function stopSlaWorker() {
  if (slaInterval) {
    clearInterval(slaInterval);
    slaInterval = null;
  }
}
