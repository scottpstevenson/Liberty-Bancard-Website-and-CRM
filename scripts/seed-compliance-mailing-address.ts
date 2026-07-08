#!/usr/bin/env tsx
/**
 * Task 806 — Seed compliance_mailing_address system setting.
 *
 * Sets the CAN-SPAM §7(a)(5) required physical mailing address used by the
 * sequence worker to build the compliance footer on every cold outreach email.
 * Without this setting, all cold email sends are blocked with
 * `sequence_send_blocked_no_mailing_address`.
 *
 * Usage:
 *   # Initial set (fails with error if COMPLIANCE_MAILING_ADDRESS is not provided)
 *   COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \
 *     npx tsx scripts/seed-compliance-mailing-address.ts
 *
 *   # Overwrite existing value (COMPLIANCE_MAILING_ADDRESS always wins)
 *   COMPLIANCE_MAILING_ADDRESS="5678 New St, Suite 200, Fort Lauderdale, FL 33308" \
 *     npx tsx scripts/seed-compliance-mailing-address.ts
 *
 *   # Check current value without changes (omit env var)
 *   npx tsx scripts/seed-compliance-mailing-address.ts
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";

async function main() {
  const existing = (await storage.getSystemSetting("compliance_mailing_address")) as string | null | undefined;
  const incoming = process.env.COMPLIANCE_MAILING_ADDRESS?.trim();

  console.log("Current compliance_mailing_address:", JSON.stringify(existing ?? null));

  // When COMPLIANCE_MAILING_ADDRESS env var is explicitly set, always write it
  // (overrides any existing value including a previously seeded placeholder).
  if (incoming) {
    if (incoming.length < 15) {
      console.error("ERROR: COMPLIANCE_MAILING_ADDRESS is too short to be a valid postal address.");
      process.exit(1);
    }
    await storage.setSystemSetting("compliance_mailing_address", incoming);
    const after = await storage.getSystemSetting("compliance_mailing_address");
    console.log("→ Updated to:", JSON.stringify(after));
    return;
  }

  // No env var provided.
  if (existing && typeof existing === "string" && existing.trim().length > 10) {
    console.log("→ Already set — no COMPLIANCE_MAILING_ADDRESS env var provided, skipping update.");
    console.log(
      "\n⚠  If the current value is a placeholder, update it by running:\n" +
      '   COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \\\n' +
      "     npx tsx scripts/seed-compliance-mailing-address.ts"
    );
    return;
  }

  // No env var and no existing value — require explicit operator input.
  console.error(
    "ERROR: compliance_mailing_address is not set and no COMPLIANCE_MAILING_ADDRESS env var was provided.\n" +
    "Set the env var to the full registered business mailing address and re-run:\n\n" +
    '  COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \\\n' +
    "    npx tsx scripts/seed-compliance-mailing-address.ts"
  );
  process.exit(1);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => pool.end());
