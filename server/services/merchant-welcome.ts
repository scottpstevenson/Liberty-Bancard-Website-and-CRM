import { sendEmailReply, triggerWorkflow, upsertContact, isSdrGhlConfigured } from "./sdr/ghl-client";
import { getEmailSignatureHtml } from "./email-signatures";
import { syncFormSubmissionToGhl } from "./ghl-form-sync";
import { sendSmtpEmail, isSmtpConfigured } from "./smtp-email";
import { storage } from "../storage";
import type { Contact, Deal, MerchantProfile } from "@shared/schema";

const APPLICATION_SEQUENCE_NAME = "3. Fast Approval — Application Completion";

function buildMerchantWelcomeEmail(firstName: string, companyName: string): string {
  const displayName = firstName || "there";
  const displayBiz = companyName || "your business";
  const signature = getEmailSignatureHtml("onboarding", undefined, null);

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
  const signature = getEmailSignatureHtml("onboarding", undefined, null);

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
  let contact: Contact | undefined;
  if (profile.contactId) {
    contact = await storage.getContact(profile.contactId);
  }

  if (!contact) {
    const msg = `No linked contact found for profile #${profile.id}`;
    console.warn(`${TAG} Skipped portal welcome email — ${msg}`);
    throw new Error(msg);
  }

  if (!contact.email) {
    const msg = `Contact #${contact.id} has no email address for profile #${profile.id}`;
    console.warn(`${TAG} Skipped portal welcome email — ${msg}`);
    throw new Error(msg);
  }

  const appUrl = process.env.APP_URL || "https://libertybancard.com";
  const portalUrl = `${appUrl}/merchant-portal`;
  const firstName = contact.firstName || "there";
  const companyName = contact.companyName || "";
  const mid = profile.merchantMid || null;

  let ghlContactId = contact.ghlContactId;

  if (!ghlContactId && isSdrGhlConfigured()) {
    console.log(`${TAG} Contact #${contact.id} has no GHL contact ID — attempting upsert via email`);
    try {
      ghlContactId = await upsertContact({
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        email: contact.email,
        phone: contact.phone || undefined,
        companyName: contact.companyName || undefined,
        tags: ["merchant", "approved"],
      });

      if (ghlContactId) {
        await storage.updateContact(contact.id, { ghlContactId });
        console.log(`${TAG} GHL contact created/found for contact #${contact.id}: ${ghlContactId}`);
      }
    } catch (upsertErr) {
      console.error(`${TAG} Failed to upsert GHL contact for contact #${contact.id}:`, upsertErr);
    }
  }

  const ghlWorkflowId = process.env.GHL_WORKFLOW_MERCHANT_APPROVED;
  const portalSubject = `Your Liberty Bancard merchant account is approved — here's how to log in`;
  const portalHtml = buildPortalWelcomeEmail(firstName, companyName, mid, portalUrl);
  let method: "ghl_workflow" | "ghl_direct_email" | "smtp" | null = null;

  // GHL-Workflow: try first when workflow ID and contact ID are both available
  if (ghlWorkflowId && ghlContactId) {
    try {
      await triggerWorkflow({
        workflowId: ghlWorkflowId,
        contactId: ghlContactId,
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
    } catch (ghlErr) {
      console.warn(`${TAG} GHL workflow failed for contact #${contact.id}, falling through to direct email:`, ghlErr);
    }
  }

  // GHL-Direct: direct email via GHL contact ID
  if (!method && ghlContactId) {
    try {
      await sendEmailReply({ contactId: ghlContactId, subject: portalSubject, htmlBody: portalHtml, fromEmail: "onboarding@libertybancard.com", fromName: "Liberty Bancard Onboarding", dbContactId: contact.id });
      method = "ghl_direct_email";
      console.log(`${TAG} Portal welcome email sent to contact #${contact.id} via ghl_direct_email`);
    } catch (ghlErr) {
      console.warn(`${TAG} GHL direct email failed for contact #${contact.id}, falling through to SMTP:`, ghlErr);
    }
  }

  // SMTP-Fallback: used when GHL is unavailable or unconfigured
  if (!method) {
    if (isSmtpConfigured()) {
      const result = await sendSmtpEmail({ to: contact.email, subject: portalSubject, html: portalHtml, category: "onboarding", contactId: contact.id });
      if (!result.success) {
        throw new Error(`SMTP fallback failed for contact #${contact.id}: ${result.error}`);
      }
      method = "smtp";
      console.log(`${TAG} Portal welcome email sent to contact #${contact.id} via SMTP-Fallback`);
    } else {
      throw new Error(`Cannot send portal welcome email for profile #${profile.id} — no delivery path configured`);
    }
  }

  await storage.createAuditLog({
    action: "merchant_portal_welcome_sent",
    entityType: "merchant_profile",
    entityId: profile.id,
    details: { contactId: contact.id, mid, channel: method },
  });
}

export async function sendMerchantWelcomeEmail(contact: Contact, deal: Deal): Promise<void> {
  const TAG = "[Closed Won]";
  let ghlContactId = contact.ghlContactId;

  if (!ghlContactId && isSdrGhlConfigured()) {
    console.log(`${TAG} Contact #${contact.id} has no GHL contact ID — attempting upsert via email`);
    try {
      ghlContactId = await upsertContact({
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        email: contact.email || "",
        phone: contact.phone || undefined,
        companyName: contact.companyName || undefined,
        tags: ["merchant", "closed-won"],
      });
      if (ghlContactId) {
        await storage.updateContact(contact.id, { ghlContactId });
        console.log(`${TAG} GHL contact created/found for contact #${contact.id}: ${ghlContactId}`);
      }
    } catch (upsertErr) {
      console.error(`${TAG} Failed to upsert GHL contact for contact #${contact.id}:`, upsertErr);
    }
  }

  if (!ghlContactId) {
    if (contact.email && isSmtpConfigured()) {
      const firstName = contact.firstName || "there";
      const companyName = contact.companyName || "your business";
      const subject = `Welcome to Liberty Bancard, ${firstName} — here's what happens next`;
      const htmlBody = buildMerchantWelcomeEmail(firstName, companyName);
      const result = await sendSmtpEmail({ to: contact.email, subject, html: htmlBody, category: "onboarding", contactId: contact.id });
      if (result.success) {
        console.log(`${TAG} Merchant welcome sent via SMTP fallback for contact #${contact.id}`);
        await storage.createAuditLog({
          action: "merchant_welcome_sent",
          entityType: "deal",
          entityId: deal.id,
          details: { contactId: contact.id, method: "smtp_fallback" },
        });
        enrollInApplicationSequence(contact, deal).catch(err =>
          console.error("[Closed Won] Application sequence enrollment error:", err)
        );
      } else {
        console.error(`${TAG} SMTP fallback failed for contact #${contact.id}: ${result.error}`);
      }
    } else {
      console.warn(`${TAG} Merchant welcome skipped — no GHL contact ID and SMTP not configured for contact #${contact.id}`);
    }
    return;
  }

  const ghlWorkflowId = process.env.GHL_WORKFLOW_MERCHANT_APPROVED;
  const welcomeFirstName = contact.firstName || "there";
  const welcomeCompany = contact.companyName || "your business";
  const welcomeSubject = `Welcome to Liberty Bancard, ${welcomeFirstName} — here's what happens next`;
  const welcomeHtml = buildMerchantWelcomeEmail(welcomeFirstName, welcomeCompany);
  let method: "ghl_workflow" | "smtp_fallback" | null = null;

  // GHL workflow is the required primary path for merchant welcome
  if (ghlWorkflowId && ghlContactId) {
    try {
      await triggerWorkflow({
        workflowId: ghlWorkflowId,
        contactId: ghlContactId,
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
    } catch (err) {
      console.error(`[Closed Won] GHL workflow failed for contact #${contact.id}, trying SMTP-Fallback:`, err);
    }
  } else {
    console.log(`[Closed Won] GHL workflow not available for contact #${contact.id} (workflowId=${ghlWorkflowId || "unset"}, contactId=${ghlContactId || "unset"}) — using SMTP-Fallback`);
  }

  // SMTP-Fallback: used when GHL fails
  if (!method && contact.email && isSmtpConfigured()) {
    const smtpResult = await sendSmtpEmail({ to: contact.email, subject: welcomeSubject, html: welcomeHtml, category: "onboarding", contactId: contact.id });
    if (smtpResult.success) {
      method = "smtp_fallback";
      console.log(`[Closed Won] Merchant welcome sent via SMTP-Fallback for contact #${contact.id}`);
    } else {
      console.error(`[Closed Won] SMTP-Fallback also failed for contact #${contact.id}: ${smtpResult.error}`);
    }
  }

  if (method) {
    await storage.createAuditLog({
      action: "merchant_welcome_sent",
      entityType: "deal",
      entityId: deal.id,
      details: { contactId: contact.id, channel: method },
    });
    enrollInApplicationSequence(contact, deal).catch(err =>
      console.error("[Closed Won] Application sequence enrollment error:", err)
    );
  }
}
