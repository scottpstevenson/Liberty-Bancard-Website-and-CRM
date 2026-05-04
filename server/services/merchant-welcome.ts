import { sendEmailReply, triggerWorkflow } from "./sdr/ghl-client";
import { getEmailSignatureHtml } from "./email-signatures";
import { syncFormSubmissionToGhl } from "./ghl-form-sync";
import { storage } from "../storage";
import type { Contact, Deal, MerchantProfile } from "@shared/schema";

const APPLICATION_SEQUENCE_NAME = "3. Fast Approval — Application Completion";

function buildMerchantWelcomeEmail(firstName: string, companyName: string): string {
  const displayName = firstName || "there";
  const displayBiz = companyName || "your business";
  const signature = getEmailSignatureHtml("onboarding", {
    name: "Scott Stevenson",
    title: "Liberty Bancard",
    phone: "954-266-8214",
    email: "scott@libertybancard.com",
  }, null);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${displayName},</p>

  <p>Welcome to Liberty Bancard. We're glad to have <strong>${displayBiz}</strong> on board.</p>

  <p>Here's what happens in the next 48 hours:</p>

  <p><strong>Step 1 — Complete your merchant application (5 minutes)</strong><br/>
  <a href="https://libertybancard.com/apply" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;margin-top:8px;">Start Your Application &rarr;</a></p>

  <p><strong>Step 2 — Upload required documents</strong><br/>
  We'll need:</p>
  <ul>
    <li>Your most recent processing statement</li>
    <li>Voided check or bank letter</li>
    <li>Government-issued photo ID</li>
  </ul>
  <p>You can upload these through your merchant portal or reply to this email with them attached.</p>

  <p><strong>What happens next:</strong></p>
  <ol>
    <li>Complete the application (5 min)</li>
    <li>Upload documents</li>
    <li>Underwriting review (24–48 hours)</li>
    <li>Terminal setup and configuration (if applicable)</li>
    <li>Go-live and first batch</li>
  </ol>

  <p>You'll have a dedicated contact throughout this process. Questions? Reply to this email or call 954-266-8214 / <a href="mailto:support@libertybancard.com">support@libertybancard.com</a>.</p>

  <p>Looking forward to saving you money on processing.</p>

  ${signature}
</div>
`;
}

async function enrollInApplicationSequence(contact: Contact, deal: Deal): Promise<void> {
  try {
    const allSequences = await storage.getFollowUpSequences();
    const appSequence = allSequences.find(s => s.name === APPLICATION_SEQUENCE_NAME && s.status === "active");
    if (!appSequence) {
      console.warn(`[Closed Won] Sequence "${APPLICATION_SEQUENCE_NAME}" not found or inactive — skipping enrollment`);
      return;
    }

    const existingEnrollments = await storage.getContactEnrollments(contact.id);
    const alreadyEnrolled = existingEnrollments.some(
      e => e.sequenceId === appSequence.id && (e.status === "active" || e.status === "completed")
    );
    if (alreadyEnrolled) {
      console.log(`[Closed Won] Contact #${contact.id} already enrolled in "${APPLICATION_SEQUENCE_NAME}" — skipping`);
      return;
    }

    await storage.createSequenceEnrollment({
      sequenceId: appSequence.id,
      contactId: contact.id,
      dealId: deal.id,
      status: "active",
      nextActionAt: new Date(),
      currentStep: 0,
    });

    console.log(`[Closed Won] Contact #${contact.id} enrolled in sequence "${APPLICATION_SEQUENCE_NAME}"`);
  } catch (err) {
    console.error(`[Closed Won] Failed to enroll contact #${contact.id} in application sequence:`, err);
  }
}

function buildPortalWelcomeEmail(
  firstName: string,
  companyName: string,
  mid: string | null,
  portalUrl: string,
): string {
  const displayName = firstName || "there";
  const displayBiz = companyName || "your business";
  const midLine = mid ? `<p><strong>Your Merchant ID (MID):</strong> ${mid}</p>` : "";
  const signature = getEmailSignatureHtml("onboarding", {
    name: "Scott Stevenson",
    title: "Liberty Bancard",
    phone: "954-266-8214",
    email: "scott@libertybancard.com",
  }, null);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${displayName},</p>

  <p>Great news — <strong>${displayBiz}</strong> has been approved and your merchant account is now active!</p>

  ${midLine}

  <p><strong>Log in to your merchant portal to get started:</strong><br/>
  <a href="${portalUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;margin-top:8px;">Access Your Portal &rarr;</a></p>

  <p><strong>What you can do in the portal:</strong></p>
  <ul>
    <li>View your account status and processing details</li>
    <li>Upload bank statements and documents</li>
    <li>Track equipment orders and go-live progress</li>
    <li>Review your program type and rate schedule</li>
  </ul>

  <p><strong>Your next steps:</strong></p>
  <ol>
    <li>Log in to the portal using the link above</li>
    <li>Confirm your banking and business details are correct</li>
    <li>Watch for terminal setup instructions (if applicable)</li>
    <li>Process your first batch — we'll be with you every step</li>
  </ol>

  <p>Questions? Reply to this email, call us at 954-266-8214, or email <a href="mailto:support@libertybancard.com">support@libertybancard.com</a>.</p>

  <p>Welcome aboard — we're excited to help you save on processing.</p>

  ${signature}
</div>
`;
}

export async function sendMerchantPortalWelcomeEmail(profile: MerchantProfile): Promise<void> {
  const TAG = "[Merchant Approved]";
  try {
    let contact: Contact | undefined;
    if (profile.contactId) {
      contact = await storage.getContact(profile.contactId);
    }

    if (!contact?.ghlContactId) {
      console.warn(`${TAG} Skipped portal welcome email for profile #${profile.id} — no GHL contact ID`);
      return;
    }

    const appUrl = process.env.APP_URL || "https://libertybancard.com";
    const portalUrl = `${appUrl}/merchant-portal`;
    const firstName = contact.firstName || "there";
    const companyName = contact.companyName || "";
    const mid = profile.merchantMid || null;

    const ghlWorkflowId = process.env.GHL_WORKFLOW_MERCHANT_APPROVED;
    let method: "ghl_workflow" | "direct_email" = "direct_email";

    if (ghlWorkflowId) {
      await triggerWorkflow({
        workflowId: ghlWorkflowId,
        contactId: contact.ghlContactId,
        metadata: {
          profileId: profile.id,
          contactId: contact.id,
          merchantMid: mid,
          portalUrl,
          source: "merchant_approved",
          approvedAt: new Date().toISOString(),
        },
      });
      method = "ghl_workflow";
      console.log(`${TAG} Portal welcome email sent to contact #${contact.id} via ghl_workflow`);
    } else {
      const subject = `Your Liberty Bancard merchant account is approved — here's how to log in`;
      const htmlBody = buildPortalWelcomeEmail(firstName, companyName, mid, portalUrl);

      await sendEmailReply({
        contactId: contact.ghlContactId,
        subject,
        htmlBody,
      });
      method = "direct_email";
      console.log(`${TAG} Portal welcome email sent to contact #${contact.id} via direct_email`);
    }

    await storage.createAuditLog({
      action: "merchant_portal_welcome_sent",
      entityType: "merchant_profile",
      entityId: profile.id,
      details: { contactId: contact.id, mid, method },
    });
  } catch (err) {
    console.error(`${TAG} Portal welcome email error for profile #${profile.id}:`, err);
  }
}

export async function sendMerchantWelcomeEmail(contact: Contact, deal: Deal): Promise<void> {
  if (!contact.ghlContactId) {
    console.warn(`[Closed Won] Merchant welcome email skipped — contact #${contact.id} has no GHL contact ID`);
    return;
  }

  const ghlWorkflowId = process.env.GHL_WORKFLOW_MERCHANT_APP;
  let method: "ghl_workflow" | "direct_email" = "direct_email";

  try {
    if (ghlWorkflowId) {
      await triggerWorkflow({
        workflowId: ghlWorkflowId,
        contactId: contact.ghlContactId,
        metadata: {
          dealId: deal.id,
          contactId: contact.id,
          firstName: contact.firstName,
          companyName: contact.companyName,
          source: "closed_won",
          enrolledAt: new Date().toISOString(),
        },
      });
      method = "ghl_workflow";
      console.log(`[Closed Won] Merchant welcome email sent to contact #${contact.id} via ghl_workflow`);
    } else {
      const firstName = contact.firstName || "there";
      const companyName = contact.companyName || "your business";
      const subject = `Welcome to Liberty Bancard, ${firstName} — here's what happens next`;
      const htmlBody = buildMerchantWelcomeEmail(firstName, companyName);

      await sendEmailReply({
        contactId: contact.ghlContactId,
        subject,
        htmlBody,
      });
      method = "direct_email";
      console.log(`[Closed Won] Merchant welcome email sent to contact #${contact.id} via direct_email`);

      syncFormSubmissionToGhl({
        contactId: contact.id,
        dealId: deal.id,
        leadSource: "merchant_application",
        sequenceName: APPLICATION_SEQUENCE_NAME,
        formData: { lb_sequence_name: APPLICATION_SEQUENCE_NAME },
      }).catch(err => console.error("[Closed Won] GHL form sync error:", err));
    }

    await storage.createAuditLog({
      action: "merchant_welcome_sent",
      entityType: "deal",
      entityId: deal.id,
      details: { contactId: contact.id, method },
    });

    enrollInApplicationSequence(contact, deal).catch(err =>
      console.error("[Closed Won] Application sequence enrollment error:", err)
    );
  } catch (err) {
    console.error(`[Closed Won] Merchant welcome email error for contact #${contact.id}:`, err);
  }
}
