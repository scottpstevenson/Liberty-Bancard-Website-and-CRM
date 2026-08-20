import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import { selectBestInbox, recordSend, rollbackSend } from "./inbox-rotation";
import crypto from "crypto";

function generateTrackingId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function initProposalTracking(leadId: number): Promise<string> {
  const trackingId = generateTrackingId();

  await db.update(sdrLeadState).set({
    proposalTrackingId: trackingId,
    proposalViewedAt: null,
    proposalClickedAt: null,
    proposalResendCount: 0,
    updatedAt: new Date(),
  }).where(eq(sdrLeadState.id, leadId));

  await db.insert(sdrLeadEvents).values({
    leadStateId: leadId,
    eventType: "proposal_sent",
    actionType: "send_proposal",
    decisionReason: "Proposal generated and sent with tracking",
    metadata: { trackingId },
  });

  const [leadForEnroll] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
  if (leadForEnroll?.merchantId) {
    const { sdrMerchants } = await import("@shared/schema");
    const { eq: eqDrizzle } = await import("drizzle-orm");
    const [merchant] = await db.select({ ghlContactId: sdrMerchants.ghlContactId }).from(sdrMerchants).where(eqDrizzle(sdrMerchants.id, leadForEnroll.merchantId));
    if (merchant?.ghlContactId) {
      const { enrollInGhlWorkflowCompliant, resolveLocalContactIdForGhlContactId } = await import("../ghl-workflows");
      const contactId = await resolveLocalContactIdForGhlContactId(merchant.ghlContactId);
      if (!contactId) {
        console.warn(`[ProposalTracking] proposal_followup suppressed for lead ${leadId}: no unique local contact`);
      } else {
        enrollInGhlWorkflowCompliant({ workflowKey: "proposal_followup", ghlContactId: merchant.ghlContactId, contactId, metadata: { trackingId, leadId } }).catch(err =>
        console.error(`[ProposalTracking] GHL proposal_followup enrollment error for lead ${leadId}:`, err)
        );
      }
    }
  }

  console.log(`[ProposalTracking] Initialized tracking for lead ${leadId}, trackingId: ${trackingId}`);
  return trackingId;
}

export async function markProposalViewed(leadIdOrMerchantId: number, byMerchantId = false): Promise<boolean> {
  try {
    let lead;
    if (byMerchantId) {
      [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, leadIdOrMerchantId));
    } else {
      [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadIdOrMerchantId));
    }
    if (!lead) return false;

    if (lead.proposalViewedAt) return true;

    await db.update(sdrLeadState).set({
      proposalViewedAt: new Date(),
      nextActionType: "check_proposal_engagement",
      nextActionAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      decisionReason: "Proposal viewed, monitoring for click/reply within 48h",
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, lead.id));

    await db.insert(sdrLeadEvents).values({
      leadStateId: lead.id,
      eventType: "proposal_viewed",
      actionType: "tracking_event",
      decisionReason: "Merchant opened/viewed the proposal",
    });

    console.log(`[ProposalTracking] Proposal viewed for lead ${lead.id}`);
    return true;
  } catch (err) {
    console.error("[ProposalTracking] Error marking viewed:", err);
    return false;
  }
}

export async function markProposalClicked(leadIdOrMerchantId: number, byMerchantId = false): Promise<boolean> {
  try {
    let lead;
    if (byMerchantId) {
      [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, leadIdOrMerchantId));
    } else {
      [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadIdOrMerchantId));
    }
    if (!lead) return false;

    await db.update(sdrLeadState).set({
      proposalClickedAt: new Date(),
      proposalViewedAt: lead.proposalViewedAt || new Date(),
      decisionReason: "Proposal clicked/engaged, awaiting merchant response",
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, lead.id));

    await db.insert(sdrLeadEvents).values({
      leadStateId: lead.id,
      eventType: "proposal_clicked",
      actionType: "tracking_event",
      decisionReason: "Merchant clicked/engaged with proposal content",
    });

    console.log(`[ProposalTracking] Proposal clicked for lead ${lead.id}`);
    return true;
  } catch (err) {
    console.error("[ProposalTracking] Error marking clicked:", err);
    return false;
  }
}

export async function markProposalViewedByTrackingId(trackingId: string): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.proposalTrackingId, trackingId));
    if (!lead) return false;
    return markProposalViewed(lead.id, false);
  } catch (err) {
    console.error("[ProposalTracking] Error marking viewed by tracking ID:", err);
    return false;
  }
}

export async function markProposalClickedByTrackingId(trackingId: string): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.proposalTrackingId, trackingId));
    if (!lead) return false;
    return markProposalClicked(lead.id, false);
  } catch (err) {
    console.error("[ProposalTracking] Error marking clicked by tracking ID:", err);
    return false;
  }
}

const ALTERNATE_SUBJECTS = [
  "{{company_name}} — 3 pricing options, pick one",
  "Your effective rate vs. what we'd charge",
  "One question about your proposal",
  "{{company_name}}: the switching question answered",
];

export async function resendProposalEmail(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;
    if (lead.assignedOwnerType === "human") return false;

    const resendCount = (lead.proposalResendCount || 0) + 1;
    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const companyName = lead.companyName || "your business";
    const subjectTemplate = ALTERNATE_SUBJECTS[(resendCount - 1) % ALTERNATE_SUBJECTS.length];
    const subject = subjectTemplate.replace(/\{\{company_name\}\}/g, companyName);

    if (isGhlConfigured() && lead.contactId) {
      const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
      if (selectedInbox) {
        const body = `Hi ${firstName},\n\nThe savings analysis for ${companyName} is done — three pricing options with a line-by-line cost comparison against what you're paying now.\n\nThe most popular option eliminates the interchange markup entirely and moves you to true cost-plus pricing.\n\nReply YES and we'll schedule a 10-minute walkthrough this week.\n\nLiberty Bancard\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`;

        try {
          const reserved = await recordSend(selectedInbox.id, lead.merchantId);
          if (!reserved) {
            console.warn(`[ProposalTracking] Inbox at daily cap for lead ${leadId} — proposal resend skipped`);
            storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: leadId, details: `ProposalTracking inbox ${selectedInbox.emailAddress} at daily cap — proposal resend not sent` }).catch(() => {});
          } else {
            try {
              await sendGhlEmail({
                contactId: lead.contactId,
                subject,
                body,
                fromEmail: selectedInbox.emailAddress,
                fromName: selectedInbox.label,
              });
            } catch (sendErr) {
              await rollbackSend(selectedInbox.id);
              throw sendErr;
            }
          }
        } catch (err) {
          console.error("[ProposalTracking] Resend email failed:", err);
          return false;
        }
      }
    }

    await db.update(sdrLeadState).set({
      proposalResendCount: resendCount,
      lastEmailAt: new Date(),
      nextActionType: "check_proposal_engagement",
      nextActionAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      decisionReason: `Proposal resent (#${resendCount}) with alternate subject`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "proposal_resent",
      actionType: "resend_proposal_email",
      channel: "email",
      decisionReason: `Resent proposal email #${resendCount} (not viewed)`,
      metadata: { subject, resendCount },
    });

    console.log(`[ProposalTracking] Proposal resent for lead ${leadId} (attempt #${resendCount})`);
    return true;
  } catch (err) {
    console.error("[ProposalTracking] Resend error:", err);
    return false;
  }
}

export async function sendProposalSmsFollowUp(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;
    if (lead.assignedOwnerType === "human") return false;
    if (!lead.consentSms || lead.optedOutSms) return false;

    const firstName = lead.ownerName?.split(" ")[0] || "there";

    if (isGhlConfigured() && lead.contactId) {
      const smsBody = `Hi ${firstName}, your processing analysis is ready — found real savings on interchange markup and fees. Reply YES for a 10-min walkthrough. — Liberty Bancard`;
      try {
        await sendGhlSms({ contactId: lead.contactId, body: smsBody });
      } catch (err) {
        console.error("[ProposalTracking] SMS follow-up failed:", err);
        return false;
      }
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "proposal_sms_followup",
      actionType: "send_sms",
      channel: "sms",
      decisionReason: "Proposal viewed but no reply, SMS follow-up sent",
    });

    console.log(`[ProposalTracking] SMS follow-up sent for lead ${leadId}`);
    return true;
  } catch (err) {
    console.error("[ProposalTracking] SMS follow-up error:", err);
    return false;
  }
}
