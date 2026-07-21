import nodemailer from "nodemailer";

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

export async function sendSmtpEmail(params: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  /**
   * Reply-To address. When set, recipient replies go to this address instead
   * of the From address. Use for department/rep routing (e.g., the assigned
   * sales rep's email so replies reach them directly, not the shared SMTP user).
   */
  replyTo?: string;
  /**
   * Fully-qualified mailto: and/or https:// unsubscribe URLs for the
   * List-Unsubscribe header (RFC 2369). Providing an https URL also enables
   * one-click unsubscribe (RFC 8058) via List-Unsubscribe-Post, which Gmail
   * and Yahoo require for bulk senders as of 2024.
   */
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, error: "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)" };
  }

  const fromAddress = params.from || process.env.SMTP_FROM || process.env.SMTP_USER || "support@libertybancard.com";

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

  try {
    const info = await transport.sendMail({
      from: fromAddress,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    console.log(`[SMTP] Email sent to ${params.to} — messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[SMTP] Failed to send email to ${params.to}:`, err.message);
    return { success: false, error: err.message };
  }
}
