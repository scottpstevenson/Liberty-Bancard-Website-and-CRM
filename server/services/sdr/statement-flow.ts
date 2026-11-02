import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import type { SdrLeadState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import { selectBestInbox, recordSend, rollbackSend } from "./inbox-rotation";
import crypto from "crypto";
import { runFollowupEffect, hasAcceptedEffect } from "../followup-effects";

function generateUploadToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function getUploadUrl(token: string): string {
  const baseUrl = process.env.APP_URL
    || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null)
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
    || "https://libertybancard.com";
  return `${baseUrl}/statement-upload/${token}`;
}

type ChannelResult = { channel: "email" | "sms"; state: "accepted" | "refused" | "unknown"; detail?: string };

/** One statement email through the rotating inbox, as a durable per-channel effect (receipt written before the send). */
async function deliverStatementEmail(
  lead: SdrLeadState, effectKey: string, subject: string, body: string,
): Promise<ChannelResult> {
  if (!isGhlConfigured() || !lead.contactId) return { channel: "email", state: "refused", detail: !lead.contactId ? "no_contact" : "ghl_not_configured" };
  const outcome = await runFollowupEffect(
    { effectKey, ownerKind: "statement", ownerId: String(lead.id), channel: "email" },
    async () => {
      const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
      if (!selectedInbox) return { success: false, error: "no_inbox_available" };
      const reserved = await recordSend(selectedInbox.id, lead.merchantId);
      if (!reserved) {
        storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: lead.id, details: `StatementFlow inbox ${selectedInbox.emailAddress} at daily cap — statement email not sent` }).catch(() => {});
        return { success: false, error: "daily_cap_reached" };
      }
      try {
        const result = await sendGhlEmail({ contactId: lead.contactId!, subject, body, fromEmail: selectedInbox.emailAddress, fromName: selectedInbox.label });
        if (!result.success) await rollbackSend(selectedInbox.id);
        return result;
      } catch (sendErr) {
        await rollbackSend(selectedInbox.id);
        throw sendErr;
      }
    });
  return { channel: "email", state: outcome.state, detail: outcome.detail };
}

async function deliverStatementSms(lead: SdrLeadState, effectKey: string, body: string): Promise<ChannelResult> {
  if (!isGhlConfigured() || !lead.contactId) return { channel: "sms", state: "refused", detail: !lead.contactId ? "no_contact" : "ghl_not_configured" };
  if (!(lead.consentSms && !lead.optedOutSms && (lead.ownerPhone || lead.phone))) return { channel: "sms", state: "refused", detail: "sms_not_permitted" };
  const outcome = await runFollowupEffect(
    { effectKey, ownerKind: "statement", ownerId: String(lead.id), channel: "sms" },
    () => sendGhlSms({ contactId: lead.contactId!, body }));
  return { channel: "sms", state: outcome.state, detail: outcome.detail };
}

const describeUndelivered = (results: ChannelResult[]) =>
  results.map(r => `${r.channel}:${r.state}${r.detail ? `(${r.detail.slice(0, 60)})` : ""}`).join(", ") || "no_channel_attempted";

/**
 * Statement request. The requested INTENT (token, requested time, stage) is recorded first and kept separately from
 * delivered facts: only an accepted per-channel receipt makes the request "sent". A refused or paused attempt leaves the
 * intent in place and the request owed (retried by the follow-up action), never an irreversible "already requested".
 * The upload token is never logged.
 */
export async function sendStatementRequest(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;

    // Wave C1: Removed blanket human-owned bypass — only skip when rep has explicitly set
    // suppressStatementAuto=true in enrichmentData (opt-out per contact, not per category).
    const suppressFlag = (lead.enrichmentData as any)?.suppressStatementAuto === true;
    if (suppressFlag) {
      console.log(`[StatementFlow] Lead ${leadId} has suppressStatementAuto flag — skipping auto request`);
      return false;
    }

    if (lead.statementRequestedAt && await hasAcceptedEffect("statement", String(leadId))) {
      console.log(`[StatementFlow] Lead ${leadId} already has a delivered statement request — skipping duplicate`);
      return false;
    }

    const token = lead.statementUploadToken || generateUploadToken();
    const uploadUrl = getUploadUrl(token);
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const companyName = lead.companyName || "your business";

    if (!lead.statementRequestedAt) {
      await db.update(sdrLeadState).set({
        statementUploadToken: token,
        statementRequestedAt: new Date(),
        statementReminderCount: 0,
        stage: "STATEMENT_REQUESTED",
        nextActionType: "follow_up_statement",
        nextActionAt: new Date(Date.now() + 60 * 60 * 1000),
        decisionReason: "Statement request recorded; delivery pending",
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, leadId));
    }

    const emailSubject = `Your free statement analysis is ready — upload here`;
    const emailBody = `Hi ${firstName},\n\nGreat meeting! As discussed, we'd love to review ${companyName}'s processing statement to identify savings opportunities.\n\nUpload your latest statement here (secure link, takes 30 seconds):\n${uploadUrl}\n\nOnce uploaded, we'll review it and follow up with your options.\n\nIf you have any questions, just reply to this email.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`;
    const smsBody = `Hi ${firstName}, here's your secure statement upload link: ${uploadUrl} — Liberty Bancard`;

    const results = [
      await deliverStatementEmail(lead, `statement_request:${leadId}:email`, emailSubject, emailBody),
      await deliverStatementSms(lead, `statement_request:${leadId}:sms`, smsBody),
    ];
    const delivered = results.some(r => r.state === "accepted");

    if (delivered) {
      await db.update(sdrLeadState).set({
        nextActionType: "follow_up_statement",
        nextActionAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        decisionReason: "Statement requested, upload link delivered",
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, leadId));
    } else {
      await db.update(sdrLeadState).set({
        nextActionType: "follow_up_statement",
        nextActionAt: new Date(Date.now() + 60 * 60 * 1000),
        decisionReason: `Statement request not delivered (${describeUndelivered(results)}); still owed`,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, leadId));
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: delivered ? "statement_requested" : "statement_request_held",
      fromStage: "MEETING_SET",
      toStage: "STATEMENT_REQUESTED",
      actionType: "send_statement_request",
      channel: "email",
      decisionReason: delivered ? "Auto statement request after meeting completion" : `Statement request not delivered (${describeUndelivered(results)})`,
    });

    console.log(`[StatementFlow] Statement request ${delivered ? "delivered" : "held"} for lead ${leadId}`);
    return delivered;
  } catch (err) {
    console.error("[StatementFlow] Error:", err);
    return false;
  }
}

/**
 * Statement reminder. The reminder count is consumed only by an accepted delivery; a refused/paused reminder leaves the
 * count and the owed reminder in place. When the original request was never delivered, the request is retried instead.
 */
export async function sendStatementReminder(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;
    if (lead.stage !== "STATEMENT_REQUESTED") return false;
    if (lead.assignedOwnerType === "human") return false;
    if (!(await hasAcceptedEffect("statement", String(leadId)))) return sendStatementRequest(leadId);

    const reminderCount = (lead.statementReminderCount || 0) + 1;
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const uploadUrl = lead.statementUploadToken ? getUploadUrl(lead.statementUploadToken) : "";

    let nextActionType = "follow_up_statement";
    let nextActionAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    let channel = "sms";
    const results: ChannelResult[] = [];

    if (reminderCount === 1) {
      results.push(await deliverStatementSms(lead, `statement_reminder:${leadId}:1:sms`,
        `Hi ${firstName}, still waiting on your processing statement. Upload here anytime: ${uploadUrl} — Liberty Bancard`));
      nextActionAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    } else if (reminderCount === 2) {
      channel = "email";
      results.push(await deliverStatementEmail(lead, `statement_reminder:${leadId}:2:email`,
        `Quick reminder — your statement review for ${lead.companyName || "your business"}`,
        `Hi ${firstName},\n\nJust a friendly reminder — we're ready to review your processing statement once you upload it.\n\nUpload here (secure, 30 seconds): ${uploadUrl}\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`));
      nextActionAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    } else if (reminderCount >= 3) {
      // A rep call task, not an automated send: nothing to deliver, the milestone is the scheduled call.
      channel = "call";
      nextActionType = "schedule_call";
      nextActionAt = new Date(Date.now() + 0);
      results.push({ channel: "email", state: "accepted" });
    }

    const delivered = results.some(r => r.state === "accepted");
    if (!delivered) {
      await db.update(sdrLeadState).set({
        nextActionType: "follow_up_statement", nextActionAt: new Date(Date.now() + 60 * 60 * 1000),
        decisionReason: `Statement reminder #${reminderCount} not delivered (${describeUndelivered(results)}); still owed`,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, leadId));
      await db.insert(sdrLeadEvents).values({
        leadStateId: leadId, eventType: "statement_reminder_held", actionType: `statement_reminder_${reminderCount}`, channel,
        decisionReason: `Statement reminder #${reminderCount} not delivered (${describeUndelivered(results)})`,
      });
      return false;
    }

    await db.update(sdrLeadState).set({
      statementReminderCount: reminderCount,
      nextActionType,
      nextActionAt,
      decisionReason: `Statement reminder #${reminderCount} delivered via ${channel}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "statement_reminder_sent",
      actionType: `statement_reminder_${reminderCount}`,
      channel,
      decisionReason: `Day ${reminderCount === 1 ? 2 : reminderCount === 2 ? 5 : 7} statement reminder`,
    });

    console.log(`[StatementFlow] Reminder #${reminderCount} delivered for lead ${leadId}`);
    return true;
  } catch (err) {
    console.error("[StatementFlow] Reminder error:", err);
    return false;
  }
}

export async function handleStatementReceived(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;

    await db.update(sdrLeadState).set({
      stage: "STATEMENT_RECEIVED",
      nextActionType: "generate_proposal",
      nextActionAt: new Date(),
      decisionReason: "Statement received, generating proposal",
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "statement_received",
      fromStage: "STATEMENT_REQUESTED",
      toStage: "STATEMENT_RECEIVED",
      actionType: "statement_upload",
      decisionReason: "Merchant uploaded processing statement",
    });

    console.log(`[StatementFlow] Statement received for lead ${leadId}`);
    return true;
  } catch (err) {
    console.error("[StatementFlow] Error handling statement receipt:", err);
    return false;
  }
}

export async function findLeadByUploadToken(token: string): Promise<SdrLeadState | null> {
  const [lead] = await db.select()
    .from(sdrLeadState)
    .where(eq(sdrLeadState.statementUploadToken, token));
  return lead || null;
}
