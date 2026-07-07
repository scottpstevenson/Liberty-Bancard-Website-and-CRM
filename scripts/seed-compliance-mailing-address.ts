#!/usr/bin/env tsx
/**
 * Task 806 — Seed compliance_mailing_address system setting.
 *
 * Sets the CAN-SPAM required physical mailing address for cold email footers.
 * The system setting is used by the sequence worker to build the compliance
 * footer on every cold outreach email. Without it, all cold email sends are
 * blocked with `sequence_send_blocked_no_mailing_address`.
 *
 * OPERATOR ACTION REQUIRED:
 *   Update the MAILING_ADDRESS constant below with the real registered
 *   business mailing address before enabling cold email outreach.
 *
 * Usage:
 *   npx tsx scripts/seed-compliance-mailing-address.ts
 *   COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \
 *     npx tsx scripts/seed-compliance-mailing-address.ts
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";

// Override via env var so CI / deploy scripts can pass the real address without
// editing this file.
const MAILING_ADDRESS =
  process.env.COMPLIANCE_MAILING_ADDRESS ||
  "Liberty Bancard | Fort Lauderdale, FL 33309";

async function main() {
  const existing = await storage.getSystemSetting("compliance_mailing_address");
  console.log("Current compliance_mailing_address:", JSON.stringify(existing));

  if (existing && typeof existing === "string" && existing.trim().length > 10) {
    console.log("→ Already set — skipping (no change).");
    return;
  }

  await storage.setSystemSetting("compliance_mailing_address", MAILING_ADDRESS);
  const after = await storage.getSystemSetting("compliance_mailing_address");
  console.log("→ Set to:", JSON.stringify(after));
  console.log(
    "\n⚠  OPERATOR ACTION REQUIRED: Update compliance_mailing_address to the\n" +
    "   real registered business mailing address before enabling cold email.\n" +
    "   Edit via Admin → System Settings or re-run with:\n" +
    '   COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \\\n' +
    "     npx tsx scripts/seed-compliance-mailing-address.ts"
  );
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => pool.end());
