#!/usr/bin/env tsx
/**
 * Task 806 — Cold Email Config Readiness Check
 *
 * Checks all three production gates required before cold email outreach:
 *   1. compliance_mailing_address system setting
 *   2. APP_URL env var
 *   3. UNSUBSCRIBE_TOKEN_SECRET (or SESSION_SECRET fallback)
 *
 * Also performs a live HTTP smoke test of GET /unsubscribe?t=... against the
 * running server on port 5000 (valid token → 200, invalid → 400, no PII leak).
 *
 * Usage:
 *   npx tsx scripts/check-cold-email-config.ts
 *   # (server must be running on localhost:5000 for HTTP tests)
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "../server/services/unsubscribe-token";

const SERVER_URL = "http://localhost:5000";

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  console.log("\n=== Cold Email Config Readiness Check ===\n");

  // ── 1. compliance_mailing_address ─────────────────────────────────────────
  const mailingAddress = (await storage.getSystemSetting("compliance_mailing_address")) as string | null | undefined;
  const mailingOk = !!(mailingAddress && typeof mailingAddress === "string" && mailingAddress.trim().length > 10);
  console.log(`compliance_mailing_address : ${mailingOk ? "✓ PRESENT" : "✗ MISSING"} — ${JSON.stringify(mailingAddress ?? null)}`);

  // ── 2. APP_URL ────────────────────────────────────────────────────────────
  const appUrl = process.env.APP_URL;
  const appUrlOk = !!(appUrl && appUrl.startsWith("https://"));
  console.log(`APP_URL                    : ${appUrlOk ? "✓ PRESENT" : "✗ MISSING/INVALID"} — ${appUrl ?? "(not set)"}`);

  // ── 3. Token secret ───────────────────────────────────────────────────────
  const unsubSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const sessSecret = process.env.SESSION_SECRET;
  const secretOk = !!(unsubSecret || sessSecret);
  console.log(`UNSUBSCRIBE_TOKEN_SECRET   : ${unsubSecret ? "✓ SET (dedicated)" : "(not set)"}`);
  console.log(`SESSION_SECRET             : ${sessSecret ? "✓ SET (fallback)" : "(not set)"}`);
  console.log(`Token secret overall       : ${secretOk ? "✓ PRESENT" : "✗ MISSING — cold email BLOCKED in prod"}`);

  // ── 4. Library-level token round-trip ────────────────────────────────────
  console.log("\n--- Library-level token smoke test ---");
  let tokenSmokePassed = false;
  let testToken = "";
  try {
    testToken = generateUnsubscribeToken(1);
    const valid = verifyUnsubscribeToken(testToken);
    const invalid = verifyUnsubscribeToken("1.aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233");
    const empty = verifyUnsubscribeToken("");
    const roundTrip = valid.valid && valid.contactId === 1;
    const rejectInvalid = !invalid.valid;
    const rejectEmpty = !empty.valid;
    tokenSmokePassed = roundTrip && rejectInvalid && rejectEmpty;
    console.log(`Token round-trip            : ${roundTrip ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`Invalid token rejected      : ${rejectInvalid ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`Empty token rejected        : ${rejectEmpty ? "✓ PASS" : "✗ FAIL"}`);
  } catch (e: any) {
    console.log(`Token smoke test ERROR: ${e.message}`);
  }

  // ── 5. Live HTTP endpoint test ────────────────────────────────────────────
  console.log("\n--- Live HTTP endpoint test (GET /unsubscribe?t=...) ---");
  let httpTestsPassed = false;
  try {
    // Valid token — expect HTTP 200 with unsubscribe confirmation page
    const validUrl = `${SERVER_URL}/unsubscribe?t=${encodeURIComponent(testToken)}`;
    const { status: s200, body: b200 } = await httpGet(validUrl);
    const validOk = s200 === 200 && b200.includes("unsubscribed");
    const noPiiValid = !b200.match(/john@|jane@|test@|password|session/i);
    console.log(`Valid token → HTTP ${s200}       : ${validOk ? "✓ PASS" : "✗ FAIL"} (expected 200, body contains 'unsubscribed')`);
    console.log(`Valid response — no PII     : ${noPiiValid ? "✓ PASS" : "✗ FAIL"}`);

    // Invalid HMAC token — expect HTTP 400 with safe error page
    const invalidUrl = `${SERVER_URL}/unsubscribe?t=1.aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233`;
    const { status: s400, body: b400 } = await httpGet(invalidUrl);
    const invalidOk = s400 === 400 && b400.includes("invalid or has expired");
    // PII check: look for actual data patterns (email addresses, phone numbers)
    // not generic words like "email" or "address" which appear in the error text.
    const noPiiInvalid = !b400.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/);
    console.log(`Invalid token → HTTP ${s400}     : ${invalidOk ? "✓ PASS" : "✗ FAIL"} (expected 400, safe error page)`);
    console.log(`Invalid response — no PII   : ${noPiiInvalid ? "✓ PASS" : "✗ FAIL"}`);

    // Malformed token (no dot separator) — expect HTTP 400
    const malformedUrl = `${SERVER_URL}/unsubscribe?t=notvalid`;
    const { status: s400b } = await httpGet(malformedUrl);
    const malformedOk = s400b === 400;
    console.log(`Malformed token → HTTP ${s400b}  : ${malformedOk ? "✓ PASS" : "✗ FAIL"} (expected 400)`);

    httpTestsPassed = validOk && noPiiValid && invalidOk && noPiiInvalid && malformedOk;
  } catch (e: any) {
    console.log(`HTTP test ERROR (is server running on :5000?): ${e.message}`);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`compliance_mailing_address : ${mailingOk ? "YES" : "NO"}`);
  console.log(`APP_URL present and valid  : ${appUrlOk ? "YES" : "NO"}`);
  console.log(`Token secret present       : ${secretOk ? "YES" : "NO"}`);
  console.log(`Token library round-trip   : ${tokenSmokePassed ? "PASS" : "FAIL"}`);
  console.log(`HTTP endpoint smoke        : ${httpTestsPassed ? "PASS" : "FAIL (server may not be running)"}`);

  const configBlocked = !mailingOk || !appUrlOk || !secretOk;
  if (configBlocked) {
    console.log("\n⚠  Cold email sends would be BLOCKED by missing config:");
    if (!mailingOk) console.log("   → Set compliance_mailing_address (run seed-compliance-mailing-address.ts with COMPLIANCE_MAILING_ADDRESS env var).");
    if (!appUrlOk) console.log("   → Set APP_URL env var to the production HTTPS domain.");
    if (!secretOk) console.log("   → Set UNSUBSCRIBE_TOKEN_SECRET env var (or SESSION_SECRET).");
  } else {
    console.log("\n✅ All cold email config gates are satisfied.");
  }

  if (!tokenSmokePassed || !httpTestsPassed) {
    process.exit(1);
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => pool.end());
