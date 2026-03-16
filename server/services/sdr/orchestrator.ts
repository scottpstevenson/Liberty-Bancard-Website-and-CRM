import { storage } from "../../storage";
import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrChannelAttempts } from "@shared/schema";
import type { SdrLeadState, InsertSdrLeadEvent, InsertSdrChannelAttempt } from "@shared/schema";
import { eq, lte, and, isNull, sql } from "drizzle-orm";
import { scoreLeadFull } from "./scoring";
import { decideNextAction, getAllowedTransitions } from "./stage-rules";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

const ORCHESTRATOR_SWEEP_MINUTES = 5;
const EMAIL_DAILY_LIMIT = 200;
const SMS_DAILY_LIMIT = 100;
const CALL_DAILY_LIMIT = 50;

interface DailyCounters {
  date: string;
  emailsSent: number;
  smsSent: number;
  callsMade: number;
}

let dailyCounters: DailyCounters = {
  date: new Date().toISOString().slice(0, 10),
  emailsSent: 0,
  smsSent: 0,
  callsMade: 0,
};

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let isSweeping = false;

function getEstDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function resetDailyCountersIfNeeded() {
  const today = getEstDateString();
  if (dailyCounters.date !== today) {
    dailyCounters = { date: today, emailsSent: 0, smsSent: 0, callsMade: 0 };
  }
}

function canSendEmail(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.emailsSent < EMAIL_DAILY_LIMIT;
}

function canSendSms(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.smsSent < SMS_DAILY_LIMIT;
}

function canMakeCall(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.callsMade < CALL_DAILY_LIMIT;
}

function isQuietHours(): boolean {
  const now = new Date();
  const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  return estHour < 8 || estHour >= 21;
}

async function logLeadEvent(leadStateId: number, event: Omit<InsertSdrLeadEvent, "leadStateId">) {
  try {
    await db.insert(sdrLeadEvents).values({ ...event, leadStateId });
  } catch (err) {
    console.error("[SDR Orchestrator] Failed to log event:", err);
  }
}

async function logChannelAttempt(attempt: InsertSdrChannelAttempt) {
  try {
    await db.insert(sdrChannelAttempts).values(attempt);
  } catch (err) {
    console.error("[SDR Orchestrator] Failed to log channel attempt:", err);
  }
}

const EMAIL_TEMPLATES: Record<string, { subject: string; body: string }[]> = {
  default: [
    {
      subject: "Quick question about {{company_name}}'s payment processing",
      body: "Hi {{first_name}},\n\nI noticed {{company_name}} and wanted to reach out. Many {{vertical}} businesses in {{city}} are saving significantly on payment processing fees.\n\nWould you be open to a quick comparison of your current rates? No obligation — just a free analysis.\n\nBest regards,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Following up — {{company_name}} payment savings",
      body: "Hi {{first_name}},\n\nI wanted to follow up on my previous email. We've been helping {{vertical}} businesses reduce their processing costs, and I'd love to show you how {{company_name}} could benefit.\n\nWould you have 10 minutes for a quick call this week?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note — processing savings for {{company_name}}",
      body: "Hi {{first_name}},\n\nJust one more quick note. If you're happy with your current processor, no worries at all. But if you've ever wondered whether you're overpaying, our free statement analysis takes just a few minutes and could save {{company_name}} hundreds each month.\n\nHere when you're ready.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
};

const SMS_TEMPLATES: Record<string, string[]> = {
  default: [
    "Hi {{first_name}}, this is Liberty Bancard. We help {{vertical}} businesses save on payment processing. Interested in a free rate comparison? Reply YES and we'll set it up.",
    "Hi {{first_name}}, following up about payment processing savings for {{company_name}}. Many {{vertical}} businesses save 20-40%. Quick chat? Reply YES or let us know a good time.",
  ],
};

function personalizeTemplate(template: string, lead: SdrLeadState): string {
  const firstName = lead.ownerName?.split(" ")[0] || "there";
  return template
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{company_name\}\}/g, lead.companyName || "your business")
    .replace(/\{\{vertical\}\}/g, lead.vertical || "local")
    .replace(/\{\{city\}\}/g, lead.city || "your area");
}

async function personalizeWithAI(template: string, lead: SdrLeadState, channel: string): Promise<string> {
  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Personalize this ${channel} template for a ${lead.vertical || "business"} called "${lead.companyName || "the business"}" in ${lead.city || "their area"}. Keep compliance line intact. Keep it under ${channel === "sms" ? 160 : 200} ${channel === "sms" ? "characters" : "words"}. Do not use emojis.\n\nTemplate:\n${template}\n\nReturn only the personalized text, nothing else.`,
      }],
      temperature: 0.7,
      max_tokens: channel === "sms" ? 100 : 300,
    });
    return response.choices[0]?.message?.content || template;
  } catch (err) {
    console.error("[SDR Orchestrator] AI personalization failed:", err);
    return template;
  }
}

async function executeEmailAction(lead: SdrLeadState, strongerCta?: boolean): Promise<boolean> {
  if (!canSendEmail()) {
    console.log(`[SDR Orchestrator] Email daily limit reached (${dailyCounters.emailsSent}/${EMAIL_DAILY_LIMIT})`);
    return false;
  }

  if (!isGhlConfigured()) {
    console.log("[SDR Orchestrator] GHL not configured, skipping email send");
    return false;
  }

  const toEmail = lead.ownerEmail || lead.email;
  if (!toEmail) return false;

  const attemptNumber = (lead.emailAttempts || 0) + 1;
  const templateIndex = Math.min(attemptNumber - 1, 2);
  const templates = EMAIL_TEMPLATES[lead.vertical || ""] || EMAIL_TEMPLATES.default;
  const template = templates[templateIndex] || templates[templates.length - 1];

  let subject = personalizeTemplate(template.subject, lead);
  let body = personalizeTemplate(template.body, lead);

  try {
    body = await personalizeWithAI(body, lead, "email");
  } catch {}

  if (!lead.contactId) {
    console.log(`[SDR Orchestrator] Lead ${lead.id} has no contactId, cannot send GHL email`);
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: "failed",
      subject,
      body,
      error: "No contactId for GHL",
      sentAt: new Date(),
    });
    return false;
  }

  try {
    const result = await sendGhlEmail({
      contactId: lead.contactId,
      subject,
      body,
    });

    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: result.success ? "sent" : "failed",
      ghlMessageId: result.messageId || null,
      subject,
      body,
      error: result.error || null,
      sentAt: new Date(),
    });

    if (result.success) {
      dailyCounters.emailsSent++;
      await db.update(sdrLeadState).set({
        emailAttempts: attemptNumber,
        lastEmailAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
    }

    return result.success;
  } catch (err: any) {
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: "failed",
      subject,
      body,
      error: err.message,
      sentAt: new Date(),
    });
    return false;
  }
}

async function executeSmsAction(lead: SdrLeadState): Promise<boolean> {
  if (!canSendSms()) {
    console.log(`[SDR Orchestrator] SMS daily limit reached (${dailyCounters.smsSent}/${SMS_DAILY_LIMIT})`);
    return false;
  }

  if (isQuietHours()) {
    console.log("[SDR Orchestrator] Quiet hours, deferring SMS");
    return false;
  }

  if (!isGhlConfigured()) {
    console.log("[SDR Orchestrator] GHL not configured, skipping SMS send");
    return false;
  }

  if (lead.optedOutSms || !lead.consentSms) {
    console.log(`[SDR Orchestrator] Lead ${lead.id} has not consented to SMS or opted out`);
    return false;
  }

  const toPhone = lead.ownerPhone || lead.phone;
  if (!toPhone) return false;

  const attemptNumber = (lead.smsAttempts || 0) + 1;
  const templateIndex = Math.min(attemptNumber - 1, 1);
  const templates = SMS_TEMPLATES[lead.vertical || ""] || SMS_TEMPLATES.default;
  const template = templates[templateIndex] || templates[templates.length - 1];

  let body = personalizeTemplate(template, lead);

  if (!lead.contactId) {
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: "failed",
      body,
      error: "No contactId for GHL",
      sentAt: new Date(),
    });
    return false;
  }

  try {
    const result = await sendGhlSms({
      contactId: lead.contactId,
      body,
    });

    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: result.success ? "sent" : "failed",
      ghlMessageId: result.messageId || null,
      body,
      error: result.error || null,
      sentAt: new Date(),
    });

    if (result.success) {
      dailyCounters.smsSent++;
      await db.update(sdrLeadState).set({
        smsAttempts: attemptNumber,
        lastSmsAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
    }

    return result.success;
  } catch (err: any) {
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: "failed",
      body,
      error: err.message,
      sentAt: new Date(),
    });
    return false;
  }
}

async function executeAction(lead: SdrLeadState, actionType: string, actionParams?: Record<string, any>): Promise<boolean> {
  switch (actionType) {
    case "send_email":
      return executeEmailAction(lead, actionParams?.strongerCta);

    case "send_sms":
      return executeSmsAction(lead);

    case "schedule_call":
      if (!canMakeCall()) {
        console.log(`[SDR Orchestrator] Call daily limit reached (${dailyCounters.callsMade}/${CALL_DAILY_LIMIT})`);
        return false;
      }
      dailyCounters.callsMade++;
      await logLeadEvent(lead.id, {
        eventType: "call_scheduled",
        actionType: "schedule_call",
        channel: "call",
        decisionReason: `Call scheduled (attempt ${(lead.callAttempts || 0) + 1})`,
      });
      await db.update(sdrLeadState).set({
        callAttempts: (lead.callAttempts || 0) + 1,
        lastCallAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
      return true;

    case "enrich":
    case "score":
    case "classify_intent":
    case "generate_proposal":
    case "send_reminder":
    case "follow_up_statement":
    case "nurture_email":
      return true;

    default:
      console.log(`[SDR Orchestrator] Unknown action type: ${actionType}`);
      return true;
  }
}

const INBOUND_EVENT_TYPES = ["reply_received", "email_opened", "call_interested", "call_booked", "sms_reply_received"];

async function getLatestInboundEvent(leadId: number): Promise<{ eventType: string; metadata?: any } | undefined> {
  const events = await db.select()
    .from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.leadStateId, leadId),
      sql`${sdrLeadEvents.eventType} IN (${sql.join(INBOUND_EVENT_TYPES.map(e => sql`${e}`), sql`, `)})`
    ))
    .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
    .limit(1);
  return events[0] || undefined;
}

function isImmediateAction(actionType: string): boolean {
  return ["send_email", "send_sms", "schedule_call"].includes(actionType);
}

async function processLead(lead: SdrLeadState): Promise<void> {
  try {
    if (lead.stage === "DISCOVERED" || lead.stage === "ENRICHED" || lead.stage === "DEDUPED" || lead.stage === "CLASSIFIED") {
      const scores = scoreLeadFull(lead);
      await db.update(sdrLeadState).set({
        fitScore: scores.fitScore,
        revenueScore: scores.revenueScore,
        reachabilityScore: scores.reachabilityScore,
        priorityScore: scores.priorityScore,
        priorityBucket: scores.priorityBucket,
        scoreBreakdown: scores.breakdown,
        lastScoredAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      lead = {
        ...lead,
        fitScore: scores.fitScore,
        revenueScore: scores.revenueScore,
        reachabilityScore: scores.reachabilityScore,
        priorityScore: scores.priorityScore,
        priorityBucket: scores.priorityBucket,
      };
    }

    const latestInboundEvent = await getLatestInboundEvent(lead.id);

    const decision = decideNextAction(lead, latestInboundEvent);
    if (!decision) {
      await db.update(sdrLeadState).set({
        nextActionType: null,
        nextActionAt: null,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
      return;
    }

    const allowedTransitions = getAllowedTransitions(lead.stage);
    const stageChanging = decision.nextStage !== lead.stage;

    if (stageChanging && !allowedTransitions.includes(decision.nextStage)) {
      console.warn(`[SDR Orchestrator] Invalid transition ${lead.stage} → ${decision.nextStage} for lead ${lead.id}`);
      return;
    }

    const shouldExecuteNow = isImmediateAction(decision.nextActionType) && decision.nextActionAt.getTime() <= Date.now();

    if (isImmediateAction(decision.nextActionType) && !shouldExecuteNow) {
      await db.update(sdrLeadState).set({
        stage: decision.nextStage,
        nextActionType: decision.nextActionType,
        nextActionAt: decision.nextActionAt,
        decisionReason: decision.decisionReason,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      await logLeadEvent(lead.id, {
        eventType: stageChanging ? "stage_changed" : "action_scheduled",
        fromStage: lead.stage,
        toStage: decision.nextStage,
        actionType: decision.nextActionType,
        decisionReason: `${decision.decisionReason} (scheduled for ${decision.nextActionAt.toISOString()})`,
      });
      return;
    }

    if (shouldExecuteNow) {
      const actionSuccess = await executeAction(lead, decision.nextActionType, decision.actionParams);

      if (!actionSuccess) {
        const deferTime = new Date(Date.now() + 60 * 60 * 1000);
        await db.update(sdrLeadState).set({
          nextActionAt: deferTime,
          decisionReason: `Action deferred: ${decision.decisionReason} (limit reached or failed)`,
          updatedAt: new Date(),
        }).where(eq(sdrLeadState.id, lead.id));
        return;
      }
    }

    const nextDecision = shouldExecuteNow ? decideNextAction({ ...lead, stage: decision.nextStage, emailAttempts: (lead.emailAttempts || 0) + (decision.nextActionType === "send_email" ? 1 : 0), smsAttempts: (lead.smsAttempts || 0) + (decision.nextActionType === "send_sms" ? 1 : 0), callAttempts: (lead.callAttempts || 0) + (decision.nextActionType === "schedule_call" ? 1 : 0) }) : null;

    await db.update(sdrLeadState).set({
      stage: decision.nextStage,
      nextActionType: nextDecision?.nextActionType || decision.nextActionType,
      nextActionAt: nextDecision?.nextActionAt || decision.nextActionAt,
      decisionReason: decision.decisionReason,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, lead.id));

    await logLeadEvent(lead.id, {
      eventType: stageChanging ? "stage_changed" : "action_executed",
      fromStage: lead.stage,
      toStage: decision.nextStage,
      actionType: decision.nextActionType,
      decisionReason: decision.decisionReason,
    });

  } catch (err) {
    console.error(`[SDR Orchestrator] Error processing lead ${lead.id}:`, err);
    await logLeadEvent(lead.id, {
      eventType: "processing_error",
      decisionReason: `Error: ${(err as Error).message}`,
    });
  }
}

export async function sweepLeads(): Promise<{ processed: number; errors: number }> {
  if (isSweeping) {
    console.log("[SDR Orchestrator] Sweep already in progress, skipping");
    return { processed: 0, errors: 0 };
  }

  isSweeping = true;
  let processed = 0;
  let errors = 0;

  try {
    resetDailyCountersIfNeeded();

    const now = new Date();
    const dueLeads = await db.select()
      .from(sdrLeadState)
      .where(
        and(
          lte(sdrLeadState.nextActionAt, now),
          sql`${sdrLeadState.stage} NOT IN ('DEAD', 'CONVERTED')`,
        )
      )
      .limit(100);

    console.log(`[SDR Orchestrator] Found ${dueLeads.length} leads due for processing`);

    for (const lead of dueLeads) {
      try {
        if (lead.pausedUntil && new Date(lead.pausedUntil) > now) {
          continue;
        }
        await processLead(lead);
        processed++;
      } catch (err) {
        errors++;
        console.error(`[SDR Orchestrator] Failed to process lead ${lead.id}:`, err);
      }
    }

    console.log(`[SDR Orchestrator] Sweep complete: ${processed} processed, ${errors} errors`);
  } catch (err) {
    console.error("[SDR Orchestrator] Sweep failed:", err);
  } finally {
    isSweeping = false;
  }

  return { processed, errors };
}

export function startOrchestrator() {
  if (sweepInterval) {
    console.log("[SDR Orchestrator] Already running");
    return;
  }

  console.log(`[SDR Orchestrator] Starting sweep every ${ORCHESTRATOR_SWEEP_MINUTES} minutes`);
  sweepInterval = setInterval(async () => {
    try {
      await sweepLeads();
    } catch (err) {
      console.error("[SDR Orchestrator] Sweep error:", err);
    }
  }, ORCHESTRATOR_SWEEP_MINUTES * 60 * 1000);

  setTimeout(() => sweepLeads().catch(err => console.error("[SDR Orchestrator] Initial sweep error:", err)), 10000);
}

export function stopOrchestrator() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log("[SDR Orchestrator] Stopped");
  }
}

export function isOrchestratorRunning(): boolean {
  return sweepInterval !== null;
}

export function getDailyLimits() {
  resetDailyCountersIfNeeded();
  return {
    email: { sent: dailyCounters.emailsSent, limit: EMAIL_DAILY_LIMIT },
    sms: { sent: dailyCounters.smsSent, limit: SMS_DAILY_LIMIT },
    call: { made: dailyCounters.callsMade, limit: CALL_DAILY_LIMIT },
    date: dailyCounters.date,
  };
}

export async function bridgeContactsToSdr(options?: { limit?: number; contactIds?: number[] }): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0;
  let skipped = 0;
  let errorCount = 0;

  try {
    const allContacts = await storage.getContacts();
    let contactsToProcess = allContacts;

    if (options?.contactIds && options.contactIds.length > 0) {
      contactsToProcess = allContacts.filter(c => options.contactIds!.includes(c.id));
    }

    if (options?.limit) {
      contactsToProcess = contactsToProcess.slice(0, options.limit);
    }

    const existingLeads = await db.select({ contactId: sdrLeadState.contactId })
      .from(sdrLeadState)
      .where(sql`${sdrLeadState.contactId} IS NOT NULL`);
    const existingContactIds = new Set(existingLeads.map(l => l.contactId));

    for (const contact of contactsToProcess) {
      if (existingContactIds.has(contact.id)) {
        skipped++;
        continue;
      }

      try {
        const deals = await storage.getDealsByContact(contact.id);
        const primaryDeal = deals[0] || null;

        const fitScore = contact.revPotentialScore || 0;
        const revenueScore = contact.switchabilityScore || 0;
        const reachabilityScore = contact.uwConfidenceScore || 0;
        const totalOldScore = contact.leadScore || 0;

        let priorityBucket: "A" | "B" | "C" | "nurture" = "C";
        if (totalOldScore >= 70) priorityBucket = "A";
        else if (totalOldScore >= 45) priorityBucket = "B";
        else if (totalOldScore >= 20) priorityBucket = "C";
        else priorityBucket = "nurture";

        const stage = contact.doNotContact ? "DEAD" :
          totalOldScore >= 45 ? "QUALIFIED" :
          totalOldScore >= 20 ? "CLASSIFIED" : "DISCOVERED";

        await db.insert(sdrLeadState).values({
          contactId: contact.id,
          companyName: contact.companyName || null,
          email: contact.email || null,
          phone: contact.phone || null,
          website: contact.website || null,
          vertical: contact.vertical || null,
          city: contact.city || null,
          state: contact.state || null,
          stage,
          fitScore: Math.min(100, fitScore * 3),
          revenueScore: Math.min(100, revenueScore * 3),
          reachabilityScore: Math.min(100, reachabilityScore * 3),
          priorityScore: totalOldScore,
          priorityBucket,
          consentEmail: contact.consentEmail ?? true,
          consentSms: contact.consentSms ?? false,
          consentCall: false,
          optedOutEmail: false,
          optedOutSms: false,
          ghlContactId: contact.ghlContactId || null,
          ownerName: contact.firstName && contact.lastName ? `${contact.firstName} ${contact.lastName}` : null,
          ownerEmail: contact.email || null,
          ownerPhone: contact.phone || null,
          locationCount: contact.locationCount || 1,
          estimatedVolume: contact.monthlyVolume || contact.estimatedProcessingVolume || null,
          estimatedTicketSize: contact.avgTicket || null,
          sourceType: "import",
          sourceId: `contact_${contact.id}`,
          nextActionType: stage === "DEAD" ? null : "score",
          nextActionAt: stage === "DEAD" ? null : new Date(),
        });

        imported++;
      } catch (err) {
        errorCount++;
        console.error(`[SDR Bridge] Failed to import contact ${contact.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[SDR Bridge] Fatal error:", err);
  }

  return { imported, skipped, errors: errorCount };
}

export async function getSdrDashboardStats() {
  try {
    const allLeads = await db.select().from(sdrLeadState);

    const stageCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    let totalLeads = 0;

    for (const lead of allLeads) {
      totalLeads++;
      stageCounts[lead.stage] = (stageCounts[lead.stage] || 0) + 1;
      const bucket = lead.priorityBucket || "C";
      priorityCounts[bucket] = (priorityCounts[bucket] || 0) + 1;
    }

    return {
      totalLeads,
      stageCounts,
      priorityCounts,
      dailyLimits: getDailyLimits(),
      orchestratorRunning: isOrchestratorRunning(),
    };
  } catch (err) {
    console.error("[SDR Dashboard] Error:", err);
    return {
      totalLeads: 0,
      stageCounts: {},
      priorityCounts: {},
      dailyLimits: getDailyLimits(),
      orchestratorRunning: isOrchestratorRunning(),
    };
  }
}
