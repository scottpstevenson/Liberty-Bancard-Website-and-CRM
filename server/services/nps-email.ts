/**
 * NPS Survey Email Service
 *
 * Sends survey emails to merchants at lifecycle moments.
 * Uses SMTP with category "onboarding" (From: onboarding@libertybancard.com).
 *
 * Concurrency safety:
 *  - A partial unique index on (contact_id, day_trigger WHERE contact_id IS NOT NULL)
 *    prevents duplicate rows across concurrent workers (migration 0095).
 *  - A send lease (send_attempted_at) is set atomically before calling SMTP so
 *    two workers cannot both claim the same pending record within 1 hour.
 *  - emailSentAt is written only after confirmed SMTP handoff; a failed write
 *    leaves the lease to expire (~1 hour), after which the record is retried.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { sendSmtpEmail } from "./smtp-email";
import { getEmailSignatureHtmlAsync } from "./email-signatures";
import { storage } from "../storage";

const BASE_URL = process.env.APP_URL || "https://libertybancard.com";
const SURVEY_EXPIRY_DAYS = 14;
/** A worker holds a send-lease for this long; after expiry, the record is retryable. */
const LEASE_HOURS = 1;

export interface NpsSurveyEmailParams {
  toEmail: string;
  toName: string;
  token: string;
  dayTrigger: number;
  contactId: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildNpsSurveyEmailHtml(params: {
  toName: string;
  surveyUrl: string;
  dayTrigger: number;
  signatureHtml: string;
}): string {
  const { toName, surveyUrl, dayTrigger, signatureHtml } = params;
  const safeName = escapeHtml(toName);
  const safeUrl = escapeHtml(surveyUrl);

  const intro =
    dayTrigger <= 1
      ? "Congratulations on processing your first batch! We're thrilled to have you live with Liberty Bancard."
      : dayTrigger <= 30
      ? "You've been live with Liberty Bancard for about a month now and we'd love to hear how things are going."
      : "You've been processing with Liberty Bancard for over 90 days — your experience matters deeply to us.";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#1e3a5f;padding:24px 32px;">
              <img src="${escapeHtml(BASE_URL)}/logo-blue.png" alt="Liberty Bancard" width="140" style="max-width:140px;width:100%;height:auto;display:block;" onerror="this.style.display='none'" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Hi ${safeName},</p>
              <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
              <p style="margin:0 0 24px;">We'd love to hear your thoughts — our short survey takes less than 30 seconds to complete:</p>

              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${safeUrl}"
                       style="display:inline-block;background:#1e3a5f;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.3px;">
                      Share Your Feedback
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#666;">
                Or copy and paste this link into your browser:<br/>
                <a href="${safeUrl}" style="color:#1e3a5f;word-break:break-all;">${safeUrl}</a>
              </p>
              <p style="margin:16px 0 0;font-size:12px;color:#999;">
                This link expires in ${SURVEY_EXPIRY_DAYS} days. Your response is confidential and helps us improve our service.
              </p>
            </td>
          </tr>
          <!-- Signature -->
          <tr>
            <td style="padding:0 32px 32px;">
              ${signatureHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #eee;font-size:11px;color:#aaa;line-height:1.5;">
              Liberty Bancard | 1200 N Federal Hwy Suite 200, Boca Raton, FL 33432<br/>
              You are receiving this because you are an active Liberty Bancard merchant.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an NPS survey email to a merchant.
 * Returns true on SMTP handoff success, false on failure.
 */
export async function sendNpsSurveyEmail(params: NpsSurveyEmailParams): Promise<boolean> {
  const { toEmail, toName, token, dayTrigger, contactId } = params;
  const surveyUrl = `${BASE_URL}/nps/${token}`;

  const signatureHtml = await getEmailSignatureHtmlAsync("onboarding", undefined, null);

  const subjectLine =
    dayTrigger <= 1
      ? "How's your first batch going? Quick question from Liberty Bancard"
      : `Your Liberty Bancard Day-${dayTrigger} check-in — 30 seconds`;

  const html = buildNpsSurveyEmailHtml({ toName, surveyUrl, dayTrigger, signatureHtml });

  const result = await sendSmtpEmail({
    to: toEmail,
    subject: subjectLine,
    html,
    category: "onboarding",
    contactId,
  });

  if (result.success) {
    console.log(`[NPS] Survey email sent to ${toEmail} (day ${dayTrigger}, token ${token.slice(0, 8)}…)`);
  } else {
    console.error(`[NPS] Failed to send survey email to ${toEmail}: ${result.error}`);
  }

  return result.success;
}

/**
 * Create-or-retry an NPS survey record and dispatch the email.
 *
 * Flow:
 *  1. INSERT INTO nps_responses … ON CONFLICT (contact_id, day_trigger) DO NOTHING RETURNING *
 *     → If inserted: new record (emailSentAt = null, sendAttemptedAt = null).
 *     → If conflict: fetch the existing record to check its send state.
 *  2. Skip if emailSentAt IS NOT NULL (already successfully sent).
 *  3. Skip if sendAttemptedAt IS NOT NULL and < 1 hour ago (another worker is
 *     actively sending or just sent; lease not yet expired).
 *  4. Claim the record by setting sendAttemptedAt = now() atomically using an
 *     UPDATE … WHERE … RETURNING check so only one worker proceeds.
 *  5. Send email. On success write emailSentAt = now().
 *
 * Returns the record ID on success, or null when skipped/no-email.
 */
export async function createAndSendNpsSurvey(params: {
  contactId: number;
  dealId?: number;
  dayTrigger: number;
}): Promise<number | null> {
  const { contactId, dealId, dayTrigger } = params;

  const contact = await storage.getContact(contactId);
  if (!contact?.email) {
    console.warn(`[NPS] No email for contact ${contactId} — cannot send survey`);
    return null;
  }

  const { randomBytes } = await import("crypto");
  const token = randomBytes(16).toString("hex");

  // ── Step 1: Atomic insert — conflict-safe via partial unique index ─────────
  const insertRows = await db.execute<{ id: number; token: string; email_sent_at: Date | null; send_attempted_at: Date | null }>(sql`
    INSERT INTO nps_responses (token, contact_id, deal_id, day_trigger, email_sent_at, send_attempted_at, created_at)
    VALUES (${token}, ${contactId}, ${dealId ?? null}, ${dayTrigger}, NULL, NULL, NOW())
    ON CONFLICT (contact_id, day_trigger) WHERE contact_id IS NOT NULL
    DO NOTHING
    RETURNING id, token, email_sent_at, send_attempted_at
  `);

  let recordId: number;
  let recordToken: string;
  let emailSentAt: Date | null;
  let sendAttemptedAt: Date | null;

  if (insertRows.rows.length > 0) {
    // New record created
    const row = insertRows.rows[0];
    recordId = row.id;
    recordToken = row.token;
    emailSentAt = row.email_sent_at;
    sendAttemptedAt = row.send_attempted_at;
  } else {
    // Conflict — fetch the existing record
    const existing = await db.execute<{ id: number; token: string; email_sent_at: Date | null; send_attempted_at: Date | null }>(sql`
      SELECT id, token, email_sent_at, send_attempted_at
      FROM nps_responses
      WHERE contact_id = ${contactId} AND day_trigger = ${dayTrigger}
      LIMIT 1
    `);
    if (existing.rows.length === 0) {
      console.warn(`[NPS] Conflict insert but no existing row found for contact ${contactId} day ${dayTrigger} — skipping`);
      return null;
    }
    const row = existing.rows[0];
    recordId = row.id;
    recordToken = row.token;
    emailSentAt = row.email_sent_at;
    sendAttemptedAt = row.send_attempted_at;
  }

  // ── Step 2: Already delivered — nothing to do ─────────────────────────────
  if (emailSentAt) {
    console.log(`[NPS] Day-${dayTrigger} survey already delivered for contact ${contactId} — skipping`);
    return null;
  }

  // ── Step 3: Another worker holds an unexpired lease — back off ────────────
  const leaseExpiryMs = LEASE_HOURS * 60 * 60 * 1000;
  if (sendAttemptedAt && Date.now() - new Date(sendAttemptedAt).getTime() < leaseExpiryMs) {
    console.log(`[NPS] Day-${dayTrigger} send lease active for contact ${contactId} — backing off`);
    return null;
  }

  // ── Step 4: Claim the send lease atomically ───────────────────────────────
  const claimed = await db.execute<{ id: number }>(sql`
    UPDATE nps_responses
    SET send_attempted_at = NOW()
    WHERE id = ${recordId}
      AND email_sent_at IS NULL
      AND (send_attempted_at IS NULL OR send_attempted_at < NOW() - INTERVAL '${sql.raw(String(LEASE_HOURS))} hour')
    RETURNING id
  `);
  if (claimed.rows.length === 0) {
    console.log(`[NPS] Day-${dayTrigger} lease claimed by another worker for contact ${contactId} — skipping`);
    return null;
  }

  // ── Step 5: Send the email ────────────────────────────────────────────────
  const sent = await sendNpsSurveyEmail({
    toEmail: contact.email,
    toName: contact.firstName || contact.companyName || "Merchant",
    token: recordToken,
    dayTrigger,
    contactId,
  });

  if (sent) {
    // Mark as delivered — if this write fails the lease will expire and the
    // record becomes retryable after LEASE_HOURS, bounding the retry window.
    await db.execute(sql`
      UPDATE nps_responses SET email_sent_at = NOW() WHERE id = ${recordId}
    `);
  }

  return recordId;
}
