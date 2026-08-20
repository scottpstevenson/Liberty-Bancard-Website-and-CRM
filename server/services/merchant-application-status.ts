import { sendEmailReply } from "./sdr/ghl-client";
import { getEmailSignatureHtml } from "./email-signatures";
import { createContactGhlFirst } from "./contact-writer";
import { storage } from "../storage";

const ONBOARDING_SIG = {
  name: "Scott Stevenson",
  title: "Liberty Bancard",
  phone: "954-266-8214",
  email: "scott@libertybancard.com",
};

/**
 * Least-privilege email DTO. Callers must pass ONLY the explicit non-sensitive
 * fields required to build and route a status email. A full MerchantApplication
 * row (which carries protected ciphertext, fingerprints, tokens, etc.) must
 * NEVER be passed to these helpers.
 */
export interface ApplicationStatusEmailInput {
  applicationId: number;
  /** DB contact id, if the application is already linked to a contact. */
  contactId?: number | null;
  ownerEmail?: string | null;
  businessEmail?: string | null;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  legalBusinessName?: string | null;
  dba?: string | null;
  businessPhone?: string | null;
  ownerPhone?: string | null;
  vertical?: string | null;
  /** Decline emails only — free-text reason from underwriting. */
  declineReason?: string | null;
}

/**
 * Truthful discriminated result. The helper NEVER swallows transient
 * contact/GHL/send failures — those propagate to the caller so the work stays
 * retryable. A returned value describes ONLY the deterministic, non-transient
 * outcomes: the email was sent, or was skipped for a stated (data) reason.
 */
export type ApplicationEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "no_recipient" | "no_ghl_contact" };

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

/**
 * Resolve (or create) the GHL contact id for this application.
 * Transient failures propagate (never swallowed); returns null ONLY when there
 * is genuinely no recipient email to build a contact from.
 * Never logs recipient email, contact ids, or arbitrary error objects.
 */
async function resolveGhlContactId(input: ApplicationStatusEmailInput): Promise<string | null> {
  if (input.contactId) {
    // Transient load failures must propagate — do not swallow.
    const contact = await storage.getContact(input.contactId);
    if (contact?.ghlContactId) return contact.ghlContactId;
  }

  const email = input.ownerEmail || input.businessEmail;
  if (!email) return null;

  // Transient GHL/contact-create failures propagate to the caller.
  const contact = await createContactGhlFirst({
    firstName: input.ownerFirstName || "",
    lastName: input.ownerLastName || "",
    email,
    phone: input.businessPhone || input.ownerPhone || "",
    companyName: input.legalBusinessName || input.dba || "",
    vertical: input.vertical || undefined,
    status: "Active",
    tags: ["merchant_application"],
  });
  return contact?.ghlContactId || null;
}

/**
 * Send the "application approved" email.
 * - Accepts only a least-privilege DTO (never a full MerchantApplication row).
 * - Returns a truthful discriminated result: sent, or skipped with a stated
 *   non-transient (data) reason.
 * - Propagates transient contact/GHL/send failures (does NOT swallow).
 * - Performs NO audit writes and logs NO recipient/provider ids or error bodies.
 */
export async function sendApplicationApprovedEmail(
  input: ApplicationStatusEmailInput,
): Promise<ApplicationEmailResult> {
  const recipient = input.ownerEmail || input.businessEmail;
  if (!recipient) return { status: "skipped", reason: "no_recipient" };

  const ghlContactId = await resolveGhlContactId(input);
  if (!ghlContactId) return { status: "skipped", reason: "no_ghl_contact" };

  const firstName = input.ownerFirstName || "";
  const businessName = input.legalBusinessName || input.dba || "";
  const subject = `Your Liberty Bancard application has been approved`;

  await sendEmailReply({
    contactId: ghlContactId,
    subject,
    htmlBody: buildApprovalEmail(firstName, businessName),
    dbContactId: input.contactId ?? undefined,
  });

  return { status: "sent" };
}

/**
 * Send the "application declined" email. Same contract as the approval helper.
 */
export async function sendApplicationDeclinedEmail(
  input: ApplicationStatusEmailInput,
): Promise<ApplicationEmailResult> {
  const recipient = input.ownerEmail || input.businessEmail;
  if (!recipient) return { status: "skipped", reason: "no_recipient" };

  const ghlContactId = await resolveGhlContactId(input);
  if (!ghlContactId) return { status: "skipped", reason: "no_ghl_contact" };

  const firstName = input.ownerFirstName || "";
  const businessName = input.legalBusinessName || input.dba || "";
  const subject = `Update on your Liberty Bancard application`;

  await sendEmailReply({
    contactId: ghlContactId,
    subject,
    htmlBody: buildDeclineEmail(firstName, businessName, input.declineReason ?? null),
    dbContactId: input.contactId ?? undefined,
  });

  return { status: "sent" };
}
