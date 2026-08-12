import nodemailer from "nodemailer";
import { resolvePolicy, assertNotProhibitedSync, isProhibitedAddress } from "./sender-policy";
import type { MessageCategory } from "./sender-policy";
import { injectCanSpamFooter } from "./can-spam-footer";

let transporter: nodemailer.Transporter | null = null;

export function logSmtpStartupWarning(): void {
  if (!isSmtpConfigured()) {
    console.warn(
      "[SMTP] ⚠️  SMTP is NOT configured. Transactional emails (proposals, merchant welcome, rep alerts) " +
      "will fall back to GHL or be silently skipped. " +
      "Set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable direct email delivery.",
    );
  } else {
    console.log(
      `[SMTP] ✓ SMTP configured — host=${process.env.SMTP_HOST} port=${process.env.SMTP_PORT || 587} user=${process.env.SMTP_USER}`,
    );
  }
}

export function getSmtpStatus(): { configured: boolean; host: string | null; port: number; user: string | null; from: string | null } {
  return {
    configured: isSmtpConfigured(),
    host: process.env.SMTP_HOST || null,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || null,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
  };
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * #1249 — Probe the SMTP connection with a live verify() call (10s timeout).
 * Returns true when the transporter can reach the server, false otherwise.
 * Use before sending critical user-facing emails so we fail gracefully when
 * SMTP is temporarily down rather than queuing silently broken sends.
 */
export async function verifySmtpLive(): Promise<boolean> {
  if (!isSmtpConfigured()) return false;
  const t = getTransporter();
  if (!t) return false;
  try {
    await Promise.race([
      t.verify(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SMTP verify timeout")), 10_000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send an email via SMTP.
 *
 * Sender resolution order (when `category` is supplied):
 *   1. From/Reply-To are resolved from the sender policy registry.
 *   2. The explicit `from` param is ignored — policy is authoritative.
 *
 * When `category` is absent (legacy callers still migrating):
 *   From resolves as: params.from → SMTP_FROM env → SMTP_USER env → "support@libertybancard.com"
 *   A deprecation warning is logged. Callers MUST be updated to pass `category`.
 *
 * Either way, the resolved From address is checked against the prohibition
 * guard — no-reply/noreply on any Liberty Bancard domain throws immediately.
 */
export async function sendSmtpEmail(params: {
  to: string;
  subject: string;
  html: string;
  /** Preferred: supply message category; From/Reply-To are resolved from the policy registry. */
  category?: MessageCategory;
  /**
   * @deprecated Pass `category` instead. Only used when `category` is absent.
   * Will be removed once all callers are updated.
   */
  from?: string;
  /**
   * Reply-To address override. When `category` is supplied, the policy's
   * replyTo is used automatically; this param is ignored. Only effective
   * for legacy callers that do not pass `category`.
   */
  replyTo?: string;
  /**
   * Fully-qualified mailto: and/or https:// unsubscribe URLs for the
   * List-Unsubscribe header (RFC 2369). Providing an https URL also enables
   * one-click unsubscribe (RFC 8058) via List-Unsubscribe-Post.
   */
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
  /**
   * DB contact ID used to generate a signed CAN-SPAM unsubscribe token.
   * When provided, the injected footer contains a functional `/unsubscribe?t=…`
   * link. When absent, a reply-to-unsubscribe instruction is used instead.
   */
  contactId?: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, error: "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)" };
  }

  let fromAddress: string;
  let replyToAddress: string | undefined;

  if (params.category) {
    const policy = resolvePolicy(params.category);
    fromAddress = policy.from;
    replyToAddress = policy.replyTo;
  } else {
    // Legacy path — warn and fall back
    console.warn(
      `[SMTP] sendSmtpEmail called without 'category' for subject="${params.subject}" to=${params.to}. ` +
      "Pass a MessageCategory so From/Reply-To are resolved from the sender policy. " +
      "This fallback will be removed in a future release.",
    );
    fromAddress = params.from || process.env.SMTP_FROM || process.env.SMTP_USER || "support@libertybancard.com";
    replyToAddress = params.replyTo;
  }

  // Prohibition guard — fail closed, never silently substitute
  try {
    assertNotProhibitedSync(fromAddress, `SMTP sendSmtpEmail From (subject="${params.subject}")`);
    if (replyToAddress) {
      assertNotProhibitedSync(replyToAddress, `SMTP sendSmtpEmail Reply-To (subject="${params.subject}")`);
    }
  } catch (prohibitErr: any) {
    console.error(`[SMTP] ${prohibitErr.message}`);
    return { success: false, error: prohibitErr.message };
  }

  const listUnsubscribeParts: string[] = [];
  if (params.unsubscribeMailto) listUnsubscribeParts.push(`<mailto:${params.unsubscribeMailto}>`);
  if (params.unsubscribeUrl) listUnsubscribeParts.push(`<${params.unsubscribeUrl}>`);

  const headers: Record<string, string> = {};
  if (listUnsubscribeParts.length > 0) {
    headers["List-Unsubscribe"] = listUnsubscribeParts.join(", ");
  }
  if (params.unsubscribeUrl) {
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  // Test-mode recipient override — set EMAIL_OVERRIDE_TO to redirect all mail to one address
  const overrideTo = process.env.EMAIL_OVERRIDE_TO?.trim();
  const effectiveTo = overrideTo || params.to;
  const effectiveSubject = overrideTo
    ? `[TEST → ${params.to}] ${params.subject}`
    : params.subject;
  if (overrideTo) {
    console.log(`[SMTP] EMAIL_OVERRIDE_TO active — redirecting to ${overrideTo} (original: ${params.to})`);
  }

  try {
    const info = await transport.sendMail({
      from: fromAddress,
      to: effectiveTo,
      subject: effectiveSubject,
      html: injectCanSpamFooter(params.html, params.contactId),
      ...(replyToAddress ? { replyTo: replyToAddress } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    console.log(`[SMTP] Email sent to ${effectiveTo} from ${fromAddress} — messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[SMTP] Failed to send email to ${params.to}:`, err.message);
    return { success: false, error: err.message };
  }
}
