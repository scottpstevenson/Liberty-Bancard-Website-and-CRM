import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import type { SdrLeadState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import { selectBestInbox, recordSend, rollbackSend } from "./inbox-rotation";
import crypto from "crypto";

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

export async function sendStatementRequest(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;

    if (lead.assignedOwnerType === "human") {
      console.log(`[StatementFlow] Lead ${leadId} is human-owned, skipping auto request`);
      return false;
    }

    const token = generateUploadToken();
    const uploadUrl = getUploadUrl(token);
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const companyName = lead.companyName || "your business";

    await db.update(sdrLeadState).set({
      statementUploadToken: token,
      statementRequestedAt: new Date(),
      statementReminderCount: 0,
      stage: "STATEMENT_REQUESTED",
      nextActionType: "follow_up_statement",
      nextActionAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      decisionReason: "Statement requested, upload link sent",
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    const emailSubject = `Your free statement analysis is ready — upload here`;
    const emailBody = `Hi ${firstName},\n\nGreat meeting! As discussed, we'd love to review ${companyName}'s processing statement to identify savings opportunities.\n\nUpload your latest statement here (secure link, takes 30 seconds):\n${uploadUrl}\n\nOnce uploaded, we'll have your personalized savings analysis ready within 24 hours — typically showing 3 different options to reduce your processing costs.\n\nIf you have any questions, just reply to this email.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`;

    if (isGhlConfigured() && lead.contactId) {
      const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
      if (selectedInbox) {
        try {
          const reserved = await recordSend(selectedInbox.id, lead.merchantId);
          if (!reserved) {
            console.warn(`[StatementFlow] Inbox at daily cap for lead ${lead.id} — statement email skipped`);
            storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: lead.id, details: `StatementFlow inbox ${selectedInbox.emailAddress} at daily cap — statement email not sent` }).catch(() => {});
          } else {
            try {
              await sendGhlEmail({
                contactId: lead.contactId,
                subject: emailSubject,
                body: emailBody,
                fromEmail: selectedInbox.emailAddress,
                fromName: selectedInbox.label,
              });
            } catch (sendErr) {
              await rollbackSend(selectedInbox.id);
              throw sendErr;
            }
          }
        } catch (err) {
          console.error("[StatementFlow] Email send failed:", err);
        }
      }

      if (lead.consentSms && !lead.optedOutSms && (lead.ownerPhone || lead.phone)) {
        const smsBody = `Hi ${firstName}, here's your secure statement upload link for the free savings analysis: ${uploadUrl} — Liberty Bancard`;
        try {
          await sendGhlSms({ contactId: lead.contactId, body: smsBody });
        } catch (err) {
          console.error("[StatementFlow] SMS send failed:", err);
        }
      }
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "statement_requested",
      fromStage: "MEETING_SET",
      toStage: "STATEMENT_REQUESTED",
      actionType: "send_statement_request",
      channel: "email",
      decisionReason: "Auto statement request after meeting completion",
    });

    console.log(`[StatementFlow] Statement request sent for lead ${leadId}, token: ${token}`);
    return true;
  } catch (err) {
    console.error("[StatementFlow] Error:", err);
    return false;
  }
}

export async function sendStatementReminder(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;
    if (lead.stage !== "STATEMENT_REQUESTED") return false;
    if (lead.assignedOwnerType === "human") return false;

    const reminderCount = (lead.statementReminderCount || 0) + 1;
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const uploadUrl = lead.statementUploadToken ? getUploadUrl(lead.statementUploadToken) : "";

    let nextActionType = "follow_up_statement";
    let nextActionAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    let channel = "sms";

    if (reminderCount === 1) {
      if (isGhlConfigured() && lead.contactId && lead.consentSms && !lead.optedOutSms) {
        const smsBody = `Hi ${firstName}, still waiting on your processing statement for the savings analysis. Upload here anytime: ${uploadUrl} — Liberty Bancard`;
        try {
          await sendGhlSms({ contactId: lead.contactId, body: smsBody });
        } catch {}
      }
      nextActionAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    } else if (reminderCount === 2) {
      channel = "email";
      if (isGhlConfigured() && lead.contactId) {
        const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
        if (selectedInbox) {
          try {
            const reserved = await recordSend(selectedInbox.id, lead.merchantId);
            if (!reserved) {
              console.warn(`[StatementFlow] Inbox at daily cap for lead ${lead.id} — reminder email skipped`);
              storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: lead.id, details: `StatementFlow inbox ${selectedInbox.emailAddress} at daily cap — reminder email not sent` }).catch(() => {});
            } else {
              try {
                await sendGhlEmail({
                  contactId: lead.contactId,
                  subject: `Quick reminder — your free savings analysis for ${lead.companyName || "your business"}`,
                  body: `Hi ${firstName},\n\nJust a friendly reminder — we're ready to analyze your processing statement and show you where ${lead.companyName || "your business"} can save.\n\nMost businesses we review find 15-30% in unnecessary fees. The analysis takes us about 24 hours once we have your statement.\n\nUpload here (secure, 30 seconds): ${uploadUrl}\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`,
                  fromEmail: selectedInbox.emailAddress,
                  fromName: selectedInbox.label,
                });
              } catch (sendErr) {
                await rollbackSend(selectedInbox.id);
                throw sendErr;
              }
            }
          } catch (err) {
            console.error("[StatementFlow] Reminder email send failed:", err);
          }
        }
      }
      nextActionAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    } else if (reminderCount >= 3) {
      channel = "call";
      nextActionType = "schedule_call";
      nextActionAt = new Date(Date.now() + 0);
    }

    await db.update(sdrLeadState).set({
      statementReminderCount: reminderCount,
      nextActionType,
      nextActionAt,
      decisionReason: `Statement reminder #${reminderCount} sent via ${channel}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "statement_reminder_sent",
      actionType: `statement_reminder_${reminderCount}`,
      channel,
      decisionReason: `Day ${reminderCount === 1 ? 2 : reminderCount === 2 ? 5 : 7} statement reminder`,
    });

    console.log(`[StatementFlow] Reminder #${reminderCount} sent for lead ${leadId}`);
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
