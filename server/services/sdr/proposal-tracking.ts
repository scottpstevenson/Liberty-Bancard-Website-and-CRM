import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendGhlSms, isGhlConfigured } from "../ghl";
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

/**
 * RETIRED. This export has no caller (the proposal worker does not resend by email) and its body sent through the raw
 * email transport without a durable per-channel receipt or the canonical recipient decision. It is fenced fail-closed:
 * it sends nothing and changes nothing. A future resend must be built on runFollowupEffect with the shared recipient
 * authority before it is exposed. (This is a dormant export, not an active duplicate sender.)
 */
export async function resendProposalEmail(leadId: number): Promise<boolean> {
  console.warn(`[ProposalTracking] resendProposalEmail is retired and fenced; nothing was sent for lead ${leadId}`);
  return false;
}

export async function sendProposalSmsFollowUp(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;
    if (lead.assignedOwnerType === "human") return false;
    if (!lead.contactId || !isGhlConfigured()) return false;

    // Consent and number come from the canonical authority for the contact and the lead, not the legacy lead flags.
    const { resolveSmsRecipient } = await import("../sms-recipient-authority");
    const recipient = await resolveSmsRecipient({ contactId: lead.contactId, leadStateId: lead.id, purpose: "proposal_sms_followup" });
    if (!recipient.allowed) return false;

    // The text refers to a proposal only when that proposal resource actually exists for this contact.
    const { deals } = await import("@shared/schema");
    const { and, inArray, isNotNull } = await import("drizzle-orm");
    const [readyProposal] = await db.select({ id: deals.id }).from(deals).where(and(
      eq(deals.contactId, lead.contactId), isNotNull(deals.proposalToken), isNotNull(deals.savingsProposal),
      inArray(deals.proposalStatus, ["sent", "resent", "viewed"]))).limit(1);
    if (!readyProposal) return false;

    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const smsBody = `Hi ${firstName}, your proposal from Liberty Bancard is ready to review. Reply YES if you would like to schedule a walkthrough. — Liberty Bancard`;
    try {
      const sent = await sendGhlSms({ contactId: lead.contactId, body: smsBody, purpose: "proposal_sms_followup", leadStateId: lead.id, boundPhone: recipient.phone });
      if (!sent.success) return false;
    } catch (err) {
      console.error("[ProposalTracking] SMS follow-up failed:", err);
      return false;
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
