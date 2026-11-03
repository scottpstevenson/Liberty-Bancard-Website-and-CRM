import { db, pool } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import type { SdrLeadState } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { storage } from "../../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import { selectBestInbox, recordSend, rollbackSend } from "./inbox-rotation";
import crypto from "crypto";
import { runFollowupEffect, hasAcceptedEffect } from "../followup-effects";
import { resolveSmsRecipient, smsDenialDetail, parseSmsDenialDetail } from "../sms-recipient-authority";

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

type ChannelResult = {
  channel: "email" | "sms"; state: "accepted" | "refused" | "unknown"; detail?: string;
  /** SMS only: the recipient/number is not permitted (a standing "no"), as opposed to a retryable condition. */
  smsDenied?: boolean;
};

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

/** Statement texts cannot be sent by anything but the canonical SMS recipient authority; the sender and clock are test seams only. */
export async function deliverStatementSms(
  lead: SdrLeadState, effectKey: string, body: string, purpose: string,
  deps: { send?: typeof sendGhlSms; currentTime?: Date } = {},
): Promise<ChannelResult> {
  const send = deps.send ?? sendGhlSms;
  if (!lead.contactId) return { channel: "sms", state: "refused", detail: "no_contact" };
  // Consent, number and purpose come from the canonical authority for the contact and the lead; the legacy lead flags
  // (consentSms, optedOutSms, ownerPhone) are never consulted. Decided before the receipt so a denial claims nothing.
  const recipient = await resolveSmsRecipient({ contactId: lead.contactId, leadStateId: lead.id, purpose, currentTime: deps.currentTime });
  if (!recipient.allowed) {
    return { channel: "sms", state: "refused", detail: smsDenialDetail(recipient), smsDenied: !recipient.transient };
  }
  if (!isGhlConfigured()) return { channel: "sms", state: "refused", detail: "ghl_not_configured" };
  const outcome = await runFollowupEffect(
    { effectKey, ownerKind: "statement", ownerId: String(lead.id), channel: "sms" },
    // The transport re-resolves immediately before dispatch, so a STOP or number change after the check above is honored.
    () => send({ contactId: lead.contactId!, body, purpose, leadStateId: lead.id, boundPhone: recipient.phone }));
  const denial = outcome.state === "refused" ? parseSmsDenialDetail(outcome.detail) : null;
  return { channel: "sms", state: outcome.state, detail: outcome.detail, smsDenied: !!denial && !denial.transient };
}

const describeUndelivered = (results: ChannelResult[]) =>
  results.map(r => `${r.channel}:${r.state}${r.detail ? `(${r.detail.slice(0, 60)})` : ""}`).join(", ") || "no_channel_attempted";

const POST_REQUEST_STAGES = new Set(["STATEMENT_RECEIVED", "PROPOSAL_SENT", "CLOSED_WON", "CLOSED_LOST"]);

/**
 * Atomically establishes the source-bound statement request: ONE upload token and ONE requested-at per lead, however many
 * concurrent callers race. The stored token always wins (COALESCE inside the UPDATE), so two simultaneous requests can
 * never mint different links and overwrite each other. Returns the token that is actually stored.
 */
export async function establishStatementRequest(leadId: number): Promise<{ token: string; created: boolean } | null> {
  const candidate = generateUploadToken();
  const [row] = await db.update(sdrLeadState).set({
    statementUploadToken: sql`COALESCE(${sdrLeadState.statementUploadToken}, ${candidate})`,
    stage: sql`CASE WHEN ${sdrLeadState.statementRequestedAt} IS NULL THEN 'STATEMENT_REQUESTED' ELSE ${sdrLeadState.stage} END`,
    statementReminderCount: sql`CASE WHEN ${sdrLeadState.statementRequestedAt} IS NULL THEN 0 ELSE ${sdrLeadState.statementReminderCount} END`,
    nextActionType: sql`CASE WHEN ${sdrLeadState.statementRequestedAt} IS NULL THEN 'follow_up_statement' ELSE ${sdrLeadState.nextActionType} END`,
    nextActionAt: sql`CASE WHEN ${sdrLeadState.statementRequestedAt} IS NULL THEN now() + interval '1 hour' ELSE ${sdrLeadState.nextActionAt} END`,
    decisionReason: sql`CASE WHEN ${sdrLeadState.statementRequestedAt} IS NULL THEN 'Statement request recorded; delivery pending' ELSE ${sdrLeadState.decisionReason} END`,
    statementRequestedAt: sql`COALESCE(${sdrLeadState.statementRequestedAt}, now())`,
    updatedAt: new Date(),
  }).where(and(
    eq(sdrLeadState.id, leadId),
    // A rep opt-out or a later stage means no request is established at all (the handler and the sender rely on this).
    sql`COALESCE(${sdrLeadState.enrichmentData}->>'suppressStatementAuto', '') <> 'true'`,
    sql`${sdrLeadState.stage} NOT IN ('STATEMENT_RECEIVED','PROPOSAL_SENT','CLOSED_WON','CLOSED_LOST')`,
  )).returning({ token: sdrLeadState.statementUploadToken });
  if (!row?.token) return null;
  return { token: row.token, created: row.token === candidate };
}

/** Re-read immediately before provider I/O: an upload, a rep takeover or an opt-out stops the send, whatever was decided earlier. */
async function statementStopReason(leadId: number): Promise<string | null> {
  const [current] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
  if (!current) return "lead_missing";
  if (POST_REQUEST_STAGES.has(current.stage)) return `stage_${current.stage.toLowerCase()}`;
  if ((current.enrichmentData as any)?.suppressStatementAuto === true) return "suppressed_by_rep";
  return null;
}

/**
 * Per-channel owed state of the statement request, read from each channel's own durable receipt:
 *  - delivered: accepted (replayed, never re-sent, and never erased by another channel's outcome);
 *  - owed_temporary: refused for a condition that clears (quiet hours, pause, inbox cap): still owed, retried;
 *  - permanent_refusal: a standing "no" (STOP, no consent, suppression, bounce): not retried, and never blocks the other channel;
 *  - unknown: sent-or-not could not be determined (started, never settled) or the refusal cause is unclassified: never re-sent;
 *  - not_attempted: no receipt yet.
 */
export type StatementChannelState = "delivered" | "owed_temporary" | "permanent_refusal" | "unknown" | "not_attempted";

const EMAIL_PERMANENT = /unsubscrib|suppress|opt.?out|do.?not|invalid|bounc|no_contact|consent/i;
const EMAIL_TEMPORARY = /cap|no_inbox|paus|hold|quiet|rate|timeout|temporar|unavailable|ghl_not_configured/i;

export function classifyStatementChannelReceipt(
  channel: "email" | "sms", row: { state: string; detail?: string | null } | undefined,
): StatementChannelState {
  if (!row) return "not_attempted";
  if (row.state === "accepted") return "delivered";
  if (row.state !== "refused") return "unknown";
  if (channel === "sms") {
    const denial = parseSmsDenialDetail(row.detail ?? undefined);
    if (!denial) return "unknown";
    return denial.transient ? "owed_temporary" : "permanent_refusal";
  }
  const detail = row.detail ?? "";
  if (EMAIL_PERMANENT.test(detail)) return "permanent_refusal";
  if (EMAIL_TEMPORARY.test(detail)) return "owed_temporary";
  return "unknown";
}

export async function statementRequestChannelStates(leadId: number): Promise<Record<"email" | "sms", StatementChannelState>> {
  const rows = (await pool.query(
    `SELECT channel, state, detail FROM followup_effect_receipts WHERE effect_key = ANY($1::text[])`,
    [[`statement_request:${leadId}:email`, `statement_request:${leadId}:sms`]])).rows as Array<{ channel: string; state: string; detail: string | null }>;
  const byChannel = (c: "email" | "sms") => rows.find(r => r.channel === c);
  return { email: classifyStatementChannelReceipt("email", byChannel("email")), sms: classifyStatementChannelReceipt("sms", byChannel("sms")) };
}

/** Any channel of the request still owed for a clearing condition (an accepted channel never hides a held one). */
async function requestChannelRetryOwed(leadId: number): Promise<boolean> {
  const states = await statementRequestChannelStates(leadId);
  return states.email === "owed_temporary" || states.sms === "owed_temporary";
}

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

    const wasRequested = !!lead.statementRequestedAt;
    const established = await establishStatementRequest(leadId);
    if (!established) return false;
    const uploadUrl = getUploadUrl(established.token);
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const companyName = lead.companyName || "your business";
    // Re-entry: a channel that was accepted replays its receipt (nothing is re-sent); only held channels are retried.
    if (wasRequested && await hasAcceptedEffect("statement", String(leadId)) && !(await requestChannelRetryOwed(leadId))) {
      console.log(`[StatementFlow] Lead ${leadId} already has a delivered statement request and no owed channel — skipping duplicate`);
      return false;
    }

    const emailSubject = `Your secure statement upload link — Liberty Bancard`;
    const emailBody = `Hi ${firstName},\n\nThanks for speaking with us. As discussed, here is the secure link to upload a recent processing statement for ${companyName}.\n\nUpload your latest statement here (secure link, takes 30 seconds):\n${uploadUrl}\n\nOnce it is uploaded, we'll review it and follow up with what we find.\n\nIf you have any questions, just reply to this email.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`;
    const smsBody = `Hi ${firstName}, here's your secure statement upload link: ${uploadUrl} — Liberty Bancard`;

    // Each channel is its own durable effect and is stop-checked immediately before its own I/O.
    const stopped = (channel: "email" | "sms", reason: string): ChannelResult => ({ channel, state: "refused", detail: `stopped_before_dispatch:${reason}` });
    const emailStop = await statementStopReason(leadId);
    const emailResult = emailStop ? stopped("email", emailStop)
      : await deliverStatementEmail(lead, `statement_request:${leadId}:email`, emailSubject, emailBody);
    const smsStop = await statementStopReason(leadId);
    const smsResult = smsStop ? stopped("sms", smsStop)
      : await deliverStatementSms(lead, `statement_request:${leadId}:sms`, smsBody, "statement_request");
    const results = [emailResult, smsResult];
    const delivered = results.some(r => r.state === "accepted");
    const retryOwed = delivered && (
      classifyStatementChannelReceipt("sms", smsResult.state === "refused" ? { state: "refused", detail: smsResult.detail } : undefined) === "owed_temporary"
      || classifyStatementChannelReceipt("email", emailResult.state === "refused" ? { state: "refused", detail: emailResult.detail } : undefined) === "owed_temporary");

    if (delivered) {
      await db.update(sdrLeadState).set({
        nextActionType: "follow_up_statement",
        nextActionAt: new Date(Date.now() + (retryOwed ? 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000)),
        decisionReason: retryOwed
          ? `Statement request accepted in part (${describeUndelivered(results)}); held channel still owed`
          : `Statement requested, upload link delivered (${describeUndelivered(results)})`,
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
    if (!(await hasAcceptedEffect("statement", String(leadId))) || await requestChannelRetryOwed(leadId)) return sendStatementRequest(leadId);

    const reminderCount = (lead.statementReminderCount || 0) + 1;
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const uploadUrl = lead.statementUploadToken ? getUploadUrl(lead.statementUploadToken) : "";

    let nextActionType = "follow_up_statement";
    let nextActionAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    let channel = "sms";
    const results: ChannelResult[] = [];

    const reminderStop = await statementStopReason(leadId);
    if (reminderStop) return false;
    if (reminderCount === 1) {
      const sms = await deliverStatementSms(lead, `statement_reminder:${leadId}:1:sms`,
        `Hi ${firstName}, still waiting on your processing statement. Upload here anytime: ${uploadUrl} — Liberty Bancard`,
        "statement_reminder");
      results.push(sms);
      // A standing SMS denial (STOP, no consent for this number, suppression) must not strand the reminder: the same
      // reminder goes by email, which has its own consent and receipt. A retryable condition (quiet hours) waits instead.
      if (sms.state === "refused" && sms.smsDenied) {
        channel = "email";
        results.push(await deliverStatementEmail(lead, `statement_reminder:${leadId}:1:email`,
          `Quick reminder — your statement review for ${lead.companyName || "your business"}`,
          `Hi ${firstName},\n\nJust a friendly reminder — we're ready to review your processing statement once you upload it.\n\nUpload here (secure, 30 seconds): ${uploadUrl}\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`));
      }
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
