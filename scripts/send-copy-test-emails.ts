/**
 * Task #1134 — Send test emails for rewritten sequence steps
 * Sends one test per batch family to scott@libertybancard.com.
 * All template variables resolved with realistic preview values.
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import { sendSmtpEmail } from "../server/services/smtp-email.js";

const TO = "scott@libertybancard.com";
const FROM = process.env.SMTP_FROM || "Scott@mail.libertybancard.com";

function resolve(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/\{\{firstName\}\}|{{contact\.firstName}}/g, "Scott")
    .replace(/\{\{lastName\}\}/g, "Stevenson")
    .replace(/\{\{companyName\}\}|{{contact\.companyName}}/g, "Coastal Auto Repair")
    .replace(/\{\{agentName\}\}/g, "Scott Stevenson")
    .replace(/\{\{agentEmail\}\}/g, "Scott@mail.libertybancard.com")
    .replace(/\{\{agentPhone\}\}/g, "954-266-8214")
    .replace(/\{\{businessName\}\}/g, "Coastal Auto Repair")
    .replace(/\{\{calendarLink\}\}/g, "https://libertybancard.com/book")
    .replace(/\{\{industry\}\}|{{vertical}}/g, "auto repair")
    .replace(/\{\{[^}]+\}\}/g, "");
}

async function send(label: string, stepId: number) {
  const r = await db.execute(sql`SELECT subject, body FROM sequence_steps WHERE id = ${stepId}`);
  const row = (r.rows as any[])[0];
  if (!row) { console.error(`Step ${stepId} not found`); return; }

  const res = await sendSmtpEmail({
    to: TO,
    subject: `[Copy Test — ${label}] ${resolve(row.subject)}`,
    html: resolve(row.body),
    from: FROM,
  });
  if (res.success) {
    console.log(`  ✅ ${label} → messageId: ${res.messageId}`);
  } else {
    console.error(`  ❌ ${label} FAILED: ${res.error}`);
  }
}

async function main() {
  console.log(`\n📧 Sending copy test emails to ${TO}...\n`);

  await send("Batch A — Inbound Confirmation", 19001);          // seq 82, step 1
  await send("Thin seq — New Lead Drip step 1", 1);             // seq 2, step 1
  await send("Thin seq — Statement Review step 1", 4);          // seq 3, step 1
  await send("Claims fix — V-Med Spa SDR step 1", 15698);       // active, was 20-35% claim
  await send("Claims fix — V-Construction SDR step 1", 15868);  // active, was 20-35% claim

  console.log("\n✅ Test sends complete.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
