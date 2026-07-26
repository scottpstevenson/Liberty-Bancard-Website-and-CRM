/**
 * Send a test email showing the upgraded design to scott@libertybancard.com
 */
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import { sendSmtpEmail } from "../server/services/smtp-email.js";

async function main() {
  // Pull a rich step — Payment Stack 101 step 1 (has p, ul, li, strong, button)
  const result = await db.execute(sql`
    SELECT id, subject, body
    FROM sequence_steps
    WHERE id = 12
  `);
  const step = (result.rows as any[])[0];

  // Resolve template variables with realistic preview values
  const resolved = (step.body as string)
    .replace(/\{\{firstName\}\}/g, "Scott")
    .replace(/\{\{contact\.firstName\}\}/g, "Scott")
    .replace(/\{\{companyName\}\}/g, "Liberty Bancard")
    .replace(/\{\{contact\.companyName\}\}/g, "Liberty Bancard")
    .replace(/\{\{agentName\}\}/g, "Scott")
    .replace(/\{\{calendarLink\}\}/g, "https://libertybancard.com/book")
    .replace(/\{\{[^}]+\}\}/g, "");  // strip any remaining vars

  const html = `
    ${resolved}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#999;font-family:Arial,sans-serif;">
      📧 Design upgrade test — Task #1133. Step ID: ${step.id}
    </p>
  `;

  console.log("Sending test email...");
  const res = await sendSmtpEmail({
    to: "scott@libertybancard.com",
    subject: `[Design Test] ${step.subject ?? "Email Design Upgrade Preview"}`,
    html,
    from: process.env.SMTP_FROM || "Scott@mail.libertybancard.com",
  });

  if (res.success) {
    console.log("✅ Test email sent. messageId:", res.messageId);
  } else {
    console.error("❌ Send failed:", res.error);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
