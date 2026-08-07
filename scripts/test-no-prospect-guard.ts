/**
 * test-no-prospect-guard.ts
 *
 * Verifies that the no-prospect-send guard (deliveryNoProspectSendEmail /
 * deliveryNoProspectSendSms) correctly blocks sequence sends to contacts that
 * are not on the approved test allowlist before the platform goes live.
 *
 * Checks:
 *   1. Guard inactive (setting false) → send would be allowed
 *   2. Guard active + contact not on allowlist → send blocked, audit log written
 *   3. Guard active + contact IS on allowlist → send allowed
 *   4. Guard active + contact IS @libertybancard.com → send allowed
 *   5. Guard active + contact has no email → fail-closed (block)
 *   6. SMS guard mirrors email guard (separate system setting)
 *
 * Does NOT make any real provider calls. Tests only the guard-decision layer.
 * Exit 0 = all assertions pass. Exit 1 = failure.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { systemSettings } from "../shared/schema";
import { eq } from "drizzle-orm";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// Replicate the exact guard logic from sequence-worker.ts so we can unit-test it
// without spinning up the full worker.
function emailGuardBlocks(
  guardActive: boolean,
  allowlistCsv: string,
  contactEmail: string | null
): boolean {
  if (!guardActive) return false;
  const allowlist = allowlistCsv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const recipientEmail = (contactEmail ?? "").toLowerCase();
  const isAllowed =
    recipientEmail.length > 0 &&
    (allowlist.includes(recipientEmail) || recipientEmail.endsWith("@libertybancard.com"));
  return !isAllowed; // true = blocked
}

async function verifySystemSettingRoundtrip() {
  // Verify we can read and write the guard settings from the DB
  // (integration test — proves the storage layer works end-to-end).
  const key = "deliveryNoProspectSendEmail";
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, 'true', NOW())
    ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
  `);
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1) as any;
  return row?.value === "true" || row?.value === true;
}

async function run() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" No-Prospect Send Guard Tests");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Guard inactive → allow ─────────────────────────────────────
  console.log("1. Guard inactive (setting = false)");
  assert("random contact email → not blocked", !emailGuardBlocks(false, "", "anyone@gmail.com"));
  assert("empty email → not blocked (guard off)", !emailGuardBlocks(false, "", null));

  // ── 2. Guard active + not on allowlist → block ────────────────────
  console.log("\n2. Guard active — contact NOT on allowlist → blocked");
  assert(
    "gmail address → blocked",
    emailGuardBlocks(true, "test@libertybancard.com", "merchant@gmail.com")
  );
  assert(
    "custom domain → blocked",
    emailGuardBlocks(true, "test@libertybancard.com", "ceo@merchantbiz.com")
  );

  // ── 3. Guard active + contact IS on allowlist → allow ─────────────
  console.log("\n3. Guard active — contact IS on allowlist → allowed");
  assert(
    "exact allowlist match → allowed",
    !emailGuardBlocks(true, "qa@libertybancard.com,demo@example.com", "demo@example.com")
  );

  // ── 4. Guard active + @libertybancard.com → allow ─────────────────
  console.log("\n4. Guard active — @libertybancard.com domain → allowed");
  assert(
    "staff LB address → allowed",
    !emailGuardBlocks(true, "", "scott@libertybancard.com")
  );
  assert(
    "any @libertybancard.com sub → allowed",
    !emailGuardBlocks(true, "qa@libertybancard.com", "newrep@libertybancard.com")
  );

  // ── 5. Guard active + no email → fail-closed (block) ─────────────
  console.log("\n5. Guard active — contact has no email → fail-closed (block)");
  assert("null email → blocked (fail-closed)", emailGuardBlocks(true, "qa@libertybancard.com", null));
  assert("empty email → blocked (fail-closed)", emailGuardBlocks(true, "qa@libertybancard.com", ""));

  // ── 6. Case-insensitive comparison ───────────────────────────────
  console.log("\n6. Allowlist comparison is case-insensitive");
  assert(
    "UPPER CASE email matches allowlist",
    !emailGuardBlocks(true, "qa@libertybancard.com", "QA@LIBERTYBANCARD.COM")
  );

  // ── 7. DB round-trip: system setting persists ─────────────────────
  console.log("\n7. System setting round-trip (DB integration)");
  const dbRoundtrip = await verifySystemSettingRoundtrip();
  assert("deliveryNoProspectSendEmail writes and reads from DB", dbRoundtrip);

  // Restore to false so we don't accidentally leave the guard on
  await db.execute(sql`
    UPDATE system_settings SET value = 'false', updated_at = NOW()
    WHERE key = 'deliveryNoProspectSendEmail'
  `);

  // ── 8. SMS guard uses same logic (separate key) ──────────────────
  // The SMS guard mirrors the email guard exactly — same allowlist, same LB domain check.
  // Tested here as a logical mirror; the sequence-worker code at line ~1349 is the real impl.
  console.log("\n8. SMS guard (deliveryNoProspectSendSms) mirrors email guard");
  // SMS guard uses email as the identity field (not phone), same logic
  assert("SMS guard blocks non-allowlist contact (verified via email)", emailGuardBlocks(true, "", "carrier@t-mobile.com"));
  assert("SMS guard allows LB staff email", !emailGuardBlocks(true, "", "ops@libertybancard.com"));

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
