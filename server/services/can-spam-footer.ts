/**
 * CAN-SPAM compliant email footer injection.
 *
 * Automatically appended to every outbound email sent via SMTP or GHL transport
 * so individual call sites never have to manage it manually.
 *
 * Required elements (15 U.S.C. § 7704):
 *  - Physical postal address of the sender
 *  - Clear and conspicuous opt-out mechanism
 *
 * When a `contactId` is provided, a signed HMAC token is embedded in the
 * unsubscribe link so the `/unsubscribe?t=...` endpoint can authenticate the
 * request and update the contact's opt-out status.
 *
 * When no `contactId` is available (e.g. admin digest / email-only GHL sends),
 * a reply-to-unsubscribe instruction is shown instead of a token link.
 */

import { generateUnsubscribeToken } from "./unsubscribe-token";

function getCompanyAddress(): string {
  return process.env.COMPANY_ADDRESS || "Liberty Bancard | 1 SE 3rd Ave, Suite 2600, Miami, FL 33131";
}

function getAppUrl(): string {
  return process.env.APP_URL || "https://libertybancard.com";
}

/**
 * Build a signed unsubscribe URL for a known CRM contact.
 * Falls back to null if the token secret is not configured.
 */
function buildSignedUnsubscribeUrl(contactId: number): string | null {
  try {
    const token = generateUnsubscribeToken(contactId);
    return `${getAppUrl()}/unsubscribe?t=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

/**
 * Returns true when the HTML body already contains a CAN-SPAM footer block,
 * so we never double-inject on templates that build their own.
 */
function hasExistingFooter(html: string): boolean {
  // Only suppress injection when the body already contains our own injected
  // marker.  URL-substring checks (e.g. /unsubscribe?t=) cannot be trusted
  // because they match unfilled template literals, invalid tokens, and other
  // non-functional opt-out links without verifying the HMAC.  The marker is
  // only present when injectCanSpamFooter() has already run successfully.
  return html.includes("data-can-spam-footer");
}

/**
 * Inject a CAN-SPAM compliant footer into an HTML email body.
 *
 * @param html       The full HTML body to inject into.
 * @param contactId  DB contact ID used to generate a signed one-click
 *                   unsubscribe URL.  When omitted or when the token secret
 *                   is not configured, a "reply to opt out" instruction is
 *                   shown instead of a link.
 */
export function injectCanSpamFooter(html: string, contactId?: number): string {
  if (hasExistingFooter(html)) return html;

  const address = getCompanyAddress();

  const signedUrl = contactId ? buildSignedUnsubscribeUrl(contactId) : null;

  const unsubscribeLine = signedUrl
    ? `To stop receiving these emails, <a href="${signedUrl}" style="color:#888;">click here to unsubscribe</a>.`
    : `To stop receiving these emails, reply with "UNSUBSCRIBE" in the subject line.`;

  const footer = `
<div data-can-spam-footer="1" style="margin-top:32px;padding-top:16px;border-top:1px solid #e0e0e0;font-size:11px;color:#888;text-align:center;font-family:Arial,sans-serif;">
  <p style="margin:4px 0;">${address}</p>
  <p style="margin:4px 0;">${unsubscribeLine}</p>
</div>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${footer}\n</body>`);
  }
  return html + footer;
}
