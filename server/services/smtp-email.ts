import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

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
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, error: "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)" };
  }

  const fromAddress = params.from || process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@libertybancard.com";

  try {
    const info = await transport.sendMail({
      from: fromAddress,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    console.log(`[SMTP] Email sent to ${params.to} — messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[SMTP] Failed to send email to ${params.to}:`, err.message);
    return { success: false, error: err.message };
  }
}
