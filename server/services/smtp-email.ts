import crypto from "crypto";
import nodemailer from "nodemailer";
import { resolvePolicy, assertNotProhibitedSync, isProhibitedAddress } from "./sender-policy";
import type { MessageCategory } from "./sender-policy";
import { getCommercialComplianceConfig, renderEmailPartsForPurpose } from "./can-spam-footer";
import { redactToken } from "./audit-sanitizer";

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
    disableFileAccess: true,
    disableUrlAccess: true,
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
  text?: string;
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
  commercialPurpose?: "marketing_outreach" | "transactional_response";
  inboundRequestId?: string;
  intendedRecipientContactId?: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const isCommercial = params.category === "cold_outreach" || params.commercialPurpose === "marketing_outreach";
  let rendered;
  try {
    rendered = await renderEmailPartsForPurpose({
      html: params.html,
      text: params.text,
      purpose: isCommercial ? "marketing_outreach" : "transactional_response",
      contactId: params.contactId,
    });
  } catch (error: any) {
    return { success: false, error: error.message ?? "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
  }
  // Final commercial classification boundary. No-contact exceptions are limited
  // to server-owned operational/security sender categories, never marketing.
  const serverOwnedNoContactCategories = new Set<MessageCategory>([
    "internal_ops", "security", "onboarding", "support", "partners",
  ]);
  if (params.contactId) {
    try {
      const { authorizeCommercialUse } = await import("./commercial-resolution");
      const trustedTransactionalCategories = new Set<MessageCategory>([
        "security", "onboarding", "support", "partners",
      ]);
      const purpose = params.commercialPurpose ??
          (params.category && trustedTransactionalCategories.has(params.category)
            ? "transactional_response"
            : "marketing_outreach");
      const hasInboundBinding = purpose === "transactional_response"
        && !!params.inboundRequestId?.trim()
        && params.intendedRecipientContactId === params.contactId;
      const decision = await authorizeCommercialUse({
        subjectType: "contact",
        subjectId: params.contactId,
        effect: purpose === "marketing_outreach"
          ? "marketing_outreach"
          : hasInboundBinding ? "inbound_transactional_acknowledgement" : "account_transactional",
        inboundRequestId: hasInboundBinding ? params.inboundRequestId : undefined,
        intendedRecipientId: hasInboundBinding ? params.intendedRecipientContactId : undefined,
      });
      if (!decision.effectiveDecision.allowed) {
        return { success: false, error: decision.effectiveDecision.reasonCode };
      }
    } catch {
      return { success: false, error: "COMMERCIAL_CLASS_UNKNOWN" };
    }
  } else if (!params.category || !serverOwnedNoContactCategories.has(params.category)) {
    return { success: false, error: "COMMERCIAL_CLASS_UNKNOWN" };
  }
  // ── Unavoidable pause authority gate (transport boundary) ────────────────
  // Every SMTP send must clear the canonical pause authority BEFORE any
  // network I/O. This is the final enforcement boundary.
  try {
    const { authorize, recheckEpoch } = await import("./outbound-pause-authority");
    const { registerInflight, deregisterInflight } = await import("./outbound-control-service");
    const decision = await authorize({});
    if (!decision.allowed) {
      // C-16 (#1626): redact recipient and subject in operational logs
      console.warn(
        `[SMTP] Blocked by pause authority: ${decision.reasonCode} ` +
        `(subject=${redactToken(params.subject)}, to=${redactToken(params.to)})`,
      );
      return { success: false, error: `Outbound paused: ${decision.reasonCode}` };
    }
    const token = crypto.randomUUID();
    await registerInflight(token, decision.epoch);
    try {
      const epochOk = await recheckEpoch(decision.epoch);
      if (!epochOk) {
        return { success: false, error: "Outbound paused: epoch changed before send" };
      }
      return await _sendSmtpEmailInner({ ...params, html: rendered.html, text: rendered.text }, rendered.complianceConfig);
    } finally {
      deregisterInflight(token);
    }
  } catch (gateErr: any) {
    console.error(`[SMTP] Pause authority gate error — fail closed: ${gateErr.message}`);
    return { success: false, error: `Pause gate error: ${gateErr.message}` };
  }
}

async function _sendSmtpEmailInner(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  category?: import("./sender-policy").MessageCategory;
  from?: string;
  replyTo?: string;
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
  contactId?: number;
  commercialPurpose?: "marketing_outreach" | "transactional_response";
}, complianceConfig?: Awaited<ReturnType<typeof getCommercialComplianceConfig>>): Promise<{ success: boolean; messageId?: string; error?: string }> {
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
      `[SMTP] sendSmtpEmail called without 'category' for subject=${redactToken(params.subject)} to=${redactToken(params.to)}. ` +
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

  const isCommercial = params.category === "cold_outreach" || params.commercialPurpose === "marketing_outreach";
  const listUnsubscribeParts: string[] = [];
  if (isCommercial && complianceConfig?.ok) {
    listUnsubscribeParts.push(`<${complianceConfig.unsubscribeUrl}>`);
  } else {
    if (params.unsubscribeMailto) listUnsubscribeParts.push(`<mailto:${params.unsubscribeMailto}>`);
    if (params.unsubscribeUrl) listUnsubscribeParts.push(`<${params.unsubscribeUrl}>`);
  }

  const headers: Record<string, string> = {};
  if (listUnsubscribeParts.length > 0) {
    headers["List-Unsubscribe"] = listUnsubscribeParts.join(", ");
  }
  if ((isCommercial && complianceConfig?.ok) || params.unsubscribeUrl) {
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  // Test-mode recipient override — set EMAIL_OVERRIDE_TO to redirect all mail to one address
  const overrideTo = process.env.EMAIL_OVERRIDE_TO?.trim();
  const effectiveTo = overrideTo || params.to;
  const effectiveSubject = overrideTo
    ? `[TEST → ${params.to}] ${params.subject}`
    : params.subject;
  if (overrideTo) {
    console.log(`[SMTP] EMAIL_OVERRIDE_TO active — redirecting to ${redactToken(overrideTo)} (original: ${redactToken(params.to)})`);
  }

  try {
    const info = await transport.sendMail({
      from: fromAddress,
      to: effectiveTo,
      subject: effectiveSubject,
      html: params.html,
      text: params.text,
      ...(replyToAddress ? { replyTo: replyToAddress } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    console.log(`[SMTP] Email sent to ${redactToken(effectiveTo)} from ${fromAddress} — messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[SMTP] Failed to send email to ${redactToken(params.to)}:`, err.message);
    return { success: false, error: err.message };
  }
}
