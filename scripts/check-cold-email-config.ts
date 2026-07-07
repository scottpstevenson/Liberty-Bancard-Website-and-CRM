#!/usr/bin/env tsx
/**
 * Task 806 — Cold Email Config Readiness Check
 * Checks: compliance_mailing_address, APP_URL, UNSUBSCRIBE_TOKEN_SECRET/SESSION_SECRET
 * Generates a test unsubscribe token and prints the verification results.
 * No real sends. Safe to run in any environment.
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { getUnsubscribeTokenSecret, generateUnsubscribeToken, verifyUnsubscribeToken } from "../server/services/unsubscribe-token";

async function main() {
  console.log("\n=== Cold Email Config Readiness Check ===\n");

  // 1. compliance_mailing_address
  const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
  const mailingOk = !!(mailingAddress && typeof mailingAddress === "string" && mailingAddress.trim().length > 10);
  console.log(`compliance_mailing_address : ${mailingOk ? "✓ PRESENT" : "✗ MISSING"} — ${JSON.stringify(mailingAddress ?? null)}`);

  // 2. APP_URL
  const appUrl = process.env.APP_URL;
  const appUrlOk = !!(appUrl && appUrl.startsWith("https://"));
  console.log(`APP_URL                    : ${appUrlOk ? "✓ PRESENT" : "✗ MISSING/INVALID"} — ${appUrl ?? "(not set)"}`);

  // 3. UNSUBSCRIBE_TOKEN_SECRET / SESSION_SECRET
  const unsub = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const sess = process.env.SESSION_SECRET;
  const secretPresent = !!(unsub || sess);
  console.log(`UNSUBSCRIBE_TOKEN_SECRET   : ${unsub ? "✓ SET" : "(not set)"}`);
  console.log(`SESSION_SECRET             : ${sess ? "✓ SET (fallback)" : "(not set)"}`);
  const secretOk = secretPresent;
  console.log(`Token secret overall       : ${secretOk ? "✓ PRESENT" : "✗ MISSING — cold email BLOCKED in prod"}`);

  // 4. Test token generation + verification (TEST_MODE)
  process.env.TEST_MODE = "true";
  console.log("\n--- Unsubscribe token smoke test (TEST_MODE) ---");
  try {
    const testContactId = 1;
    const token = generateUnsubscribeToken(testContactId);
    const valid = verifyUnsubscribeToken(token);
    console.log(`generateUnsubscribeToken(1) : ${token.slice(0, 12)}...`);
    console.log(`verifyUnsubscribeToken valid: ${JSON.stringify(valid)}`);
    console.log(`Token round-trip            : ${valid.valid && valid.contactId === testContactId ? "✓ PASS" : "✗ FAIL"}`);

    const invalid = verifyUnsubscribeToken("1.badhmacbadhmacbadhmacbadhmacbadhmacbadhmacbadhmacbadhmacbadhmac0");
    console.log(`Invalid token rejected      : ${!invalid.valid ? "✓ PASS" : "✗ FAIL"}`);
    const empty = verifyUnsubscribeToken("");
    console.log(`Empty token rejected        : ${!empty.valid ? "✓ PASS" : "✗ FAIL"}`);
  } catch (e: any) {
    console.log(`Token test ERROR: ${e.message}`);
  }

  // 5. Summary
  console.log("\n=== Summary ===");
  console.log(`compliance_mailing_address : ${mailingOk ? "YES" : "NO"}`);
  console.log(`APP_URL present and valid  : ${appUrlOk ? "YES" : "NO"}`);
  console.log(`Token secret present       : ${secretOk ? "YES" : "NO"}`);

  const blocked = !mailingOk || !appUrlOk || !secretOk;
  if (blocked) {
    console.log("\n⚠  Cold email sends would be BLOCKED by missing config.");
    if (!mailingOk) console.log("   → Set compliance_mailing_address system setting.");
    if (!appUrlOk) console.log("   → Set APP_URL env var to the production HTTPS domain.");
    if (!secretOk) console.log("   → Set UNSUBSCRIBE_TOKEN_SECRET env var.");
  } else {
    console.log("\n✅ All cold email config gates are satisfied.");
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => pool.end());
