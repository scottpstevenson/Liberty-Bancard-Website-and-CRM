import { sendEmailReply } from "./sdr/ghl-client";
import { getEmailSignatureHtml } from "./email-signatures";
import { createContactGhlFirst } from "./contact-writer";
import { storage } from "../storage";
import type { MerchantApplication } from "@shared/schema";

const ONBOARDING_SIG = {
  name: "Scott Stevenson",
  title: "Liberty Bancard",
  phone: "954-266-8214",
  email: "scott@libertybancard.com",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildApprovalEmail(firstName: string, businessName: string): string {
  const displayName = escapeHtml(firstName || "there");
  const displayBiz = escapeHtml(businessName || "your business");
  const signature = getEmailSignatureHtml("onboarding", ONBOARDING_SIG, null);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${displayName},</p>

  <p>Great news — your merchant application for <strong>${displayBiz}</strong> has been <strong style="color:#1e7d3a;">approved</strong>.</p>

  <p>Here's what happens next:</p>
  <ol>
    <li>You'll receive your merchant account details and MID shortly.</li>
    <li>If you ordered a terminal, we'll ship it and walk you through setup.</li>
    <li>Your dedicated onboarding contact will reach out within one business day to coordinate go-live and your first batch.</li>
  </ol>

  <p>If you have any questions in the meantime, just reply to this email or call 954-266-8214.</p>

  <p>Welcome to Liberty Bancard — we're glad to have you on board.</p>

  ${signature}
</div>
`;
}

function buildDeclineEmail(firstName: string, businessName: string, reason: string | null): string {
  const displayName = escapeHtml(firstName || "there");
  const displayBiz = escapeHtml(businessName || "your business");
  const signature = getEmailSignatureHtml("onboarding", ONBOARDING_SIG, null);

  const reasonBlock = reason && reason.trim()
    ? `<p><strong>Reason provided by underwriting:</strong><br/>${escapeHtml(reason.trim()).replace(/\n/g, "<br/>")}</p>`
    : `<p>Unfortunately we're unable to share specific underwriting details, but our team is happy to discuss next steps.</p>`;

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${displayName},</p>

  <p>Thank you for applying with Liberty Bancard. After reviewing the application for <strong>${displayBiz}</strong>, we're unable to approve it at this time.</p>

  ${reasonBlock}

  <p>If you'd like to discuss this decision, provide additional information, or explore alternative options, please reply to this email or call 954-266-8214.</p>

  <p>We appreciate the opportunity to review your business and wish you the best.</p>

  ${signature}
</div>
`;
}

async function resolveGhlContactId(application: MerchantApplication): Promise<string | null> {
  if (application.contactId) {
    try {
      const contact = await storage.getContact(application.contactId);
      if (contact?.ghlContactId) return contact.ghlContactId;
    } catch (err) {
      console.error("[Application Status Email] Failed to load contact:", err);
    }
  }

  const email = application.ownerEmail || application.businessEmail;
  if (!email) return null;

  try {
    const contact = await createContactGhlFirst({
      firstName: application.ownerFirstName || "",
      lastName: application.ownerLastName || "",
      email,
      phone: application.businessPhone || application.ownerPhone || "",
      companyName: application.legalBusinessName || application.dba || "",
      vertical: application.vertical || undefined,
      status: "Active",
      tags: ["merchant_application"],
    });
    return contact?.ghlContactId || null;
  } catch (err) {
    console.error("[Application Status Email] Failed to create GHL contact:", err);
    return null;
  }
}

export async function sendApplicationApprovedEmail(application: MerchantApplication): Promise<void> {
  const recipient = application.ownerEmail || application.businessEmail;
  if (!recipient) {
    console.warn(`[Application Approval Email] Skipped — application #${application.id} has no email`);
    return;
  }

  const ghlContactId = await resolveGhlContactId(application);
  if (!ghlContactId) {
    console.warn(`[Application Approval Email] Skipped — no GHL contact for application #${application.id}`);
    return;
  }

  const firstName = application.ownerFirstName || "";
  const businessName = application.legalBusinessName || application.dba || "";
  const subject = `Your Liberty Bancard application has been approved`;

  try {
    await sendEmailReply({
      contactId: ghlContactId,
      subject,
      htmlBody: buildApprovalEmail(firstName, businessName),
    });
    console.log(`[Application Approval Email] Sent for application #${application.id} to ${recipient}`);

    await storage.createAuditLog({
      action: "merchant_application_approved_email_sent",
      entityType: "merchant_application",
      entityId: application.id,
      details: { recipient, ghlContactId },
    });
  } catch (err) {
    console.error(`[Application Approval Email] Failed for application #${application.id}:`, err);
  }
}

export async function sendApplicationDeclinedEmail(application: MerchantApplication): Promise<void> {
  const recipient = application.ownerEmail || application.businessEmail;
  if (!recipient) {
    console.warn(`[Application Decline Email] Skipped — application #${application.id} has no email`);
    return;
  }

  const ghlContactId = await resolveGhlContactId(application);
  if (!ghlContactId) {
    console.warn(`[Application Decline Email] Skipped — no GHL contact for application #${application.id}`);
    return;
  }

  const firstName = application.ownerFirstName || "";
  const businessName = application.legalBusinessName || application.dba || "";
  const subject = `Update on your Liberty Bancard application`;

  try {
    await sendEmailReply({
      contactId: ghlContactId,
      subject,
      htmlBody: buildDeclineEmail(firstName, businessName, application.declineReason ?? null),
    });
    console.log(`[Application Decline Email] Sent for application #${application.id} to ${recipient}`);

    await storage.createAuditLog({
      action: "merchant_application_declined_email_sent",
      entityType: "merchant_application",
      entityId: application.id,
      details: { recipient, ghlContactId, hasReason: !!application.declineReason },
    });
  } catch (err) {
    console.error(`[Application Decline Email] Failed for application #${application.id}:`, err);
  }
}
