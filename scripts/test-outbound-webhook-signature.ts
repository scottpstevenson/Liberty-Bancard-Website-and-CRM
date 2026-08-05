/**
 * test-outbound-webhook-signature.ts
 *
 * Validates that POST /api/outbound/webhook verifies HMAC-SHA256 signatures
 * using GHL_WEBHOOK_SECRET via the shared validateGhlWebhookSignature helper.
 *
 * Tests:
 *   1. Valid HMAC-SHA256 signature (x-wh-signature)         → accepted
 *   2. Valid HMAC-SHA256 signature (x-hub-signature-256)    → accepted
 *   3. Invalid signature with secret configured             → rejected (401)
 *   4. Missing signature with secret configured             → rejected (401)
 *   5. Secret not set + non-localhost env                   → rejected (401)
 *   6. Secret not set + localhost env                       → allowed (dev bypass)
 *   7. Source-level: campaigns.ts calls validateGhlWebhookSignature
 *
 * Exit 0 = all checks pass. Exit 1 = at least one failure.
 */

import crypto from "crypto";
import { readFileSync } from "fs";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures++;
  }
}

function makeHmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// ── Load module under test ────────────────────────────────────────────────────

const { validateGhlWebhookSignature } = await import("../server/services/ghl");

// ── 1. Valid x-wh-signature accepted ─────────────────────────────────────────

console.log("\n[1] Valid x-wh-signature accepted");
{
  const secret = "test-secret-abc123";
  const payload = JSON.stringify({ messageId: 42, event: "opened" });
  const sig = makeHmac(secret, payload);

  process.env.GHL_WEBHOOK_SECRET = secret;
  delete process.env.APP_URL;
  delete process.env.HOST;

  const result = validateGhlWebhookSignature(payload, sig);
  assert(result === true, "valid HMAC (bare hex) → accepted");

  const resultPrefixed = validateGhlWebhookSignature(payload, "sha256=" + sig);
  assert(resultPrefixed === true, "valid HMAC (sha256= prefix) → accepted");
}

// ── 2. Valid x-hub-signature-256 (sha256= prefix) accepted ───────────────────

console.log("\n[2] Valid sha256= prefixed signature accepted");
{
  const secret = "test-secret-xyz789";
  const payload = JSON.stringify({ messageId: 7, event: "replied" });
  const sig = "sha256=" + makeHmac(secret, payload);

  process.env.GHL_WEBHOOK_SECRET = secret;

  const result = validateGhlWebhookSignature(payload, sig);
  assert(result === true, "sha256= prefixed HMAC → accepted");
}

// ── 3. Invalid signature with secret configured → rejected ────────────────────

console.log("\n[3] Invalid signature with secret configured → rejected (401)");
{
  const secret = "test-secret-for-rejection";
  const payload = JSON.stringify({ messageId: 1, event: "bounced" });

  process.env.GHL_WEBHOOK_SECRET = secret;

  const badSig = "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const result = validateGhlWebhookSignature(payload, badSig);
  assert(result === false, "wrong HMAC → rejected");
}

// ── 4. Missing signature with secret configured → rejected ────────────────────

console.log("\n[4] Missing signature with secret configured → rejected (401)");
{
  const secret = "test-secret-for-missing";
  const payload = JSON.stringify({ messageId: 2, event: "unsubscribed" });

  process.env.GHL_WEBHOOK_SECRET = secret;

  // Empty string simulates no sig header — length mismatch → false
  const result = validateGhlWebhookSignature(payload, "");
  assert(result === false, "empty sig with secret set → rejected");
}

// ── 5. No secret + non-localhost env → rejected ───────────────────────────────

console.log("\n[5] GHL_WEBHOOK_SECRET not set in non-localhost env → rejected");
{
  delete process.env.GHL_WEBHOOK_SECRET;
  process.env.APP_URL = "https://myapp.replit.dev";
  delete process.env.HOST;

  const result = validateGhlWebhookSignature("any-payload", "any-sig");
  assert(result === false, "no secret + non-localhost → rejected");
}

// ── 6. No secret + localhost env → allowed (dev bypass) ──────────────────────

console.log("\n[6] GHL_WEBHOOK_SECRET not set in localhost env → allowed (dev bypass)");
{
  delete process.env.GHL_WEBHOOK_SECRET;
  process.env.APP_URL = "http://localhost:5000";
  delete process.env.HOST;

  const result = validateGhlWebhookSignature("any-payload", "any-sig");
  assert(result === true, "no secret + localhost APP_URL → allowed");

  // Cleanup
  delete process.env.APP_URL;
}

// ── 7. Source-level: campaigns.ts imports and calls validateGhlWebhookSignature ─

console.log("\n[7] Source-level: campaigns.ts uses validateGhlWebhookSignature");
{
  const src = readFileSync("server/routes/campaigns.ts", "utf8");
  assert(
    src.includes("validateGhlWebhookSignature"),
    "campaigns.ts imports validateGhlWebhookSignature"
  );
  // The import must come from ghl service
  assert(
    src.includes('from "../services/ghl"') && src.includes("validateGhlWebhookSignature"),
    "validateGhlWebhookSignature imported from ../services/ghl"
  );
  // NODE_ENV must NOT be used for the bypass decision (that's the ghl helper's job)
  const webhookSection = src.slice(
    src.indexOf("OUTBOUND WEBHOOK"),
    src.indexOf("FOLLOW-UP SEQUENCES")
  );
  assert(
    !webhookSection.includes('NODE_ENV === "production"'),
    "outbound webhook handler does not bypass via NODE_ENV check"
  );
  assert(
    webhookSection.includes("validateGhlWebhookSignature(rawBody, sig)"),
    "handler calls validateGhlWebhookSignature(rawBody, sig) unconditionally"
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✓ All outbound webhook signature checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
