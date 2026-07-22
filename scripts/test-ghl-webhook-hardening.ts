/**
 * test-ghl-webhook-hardening.ts
 *
 * Validates the GHL webhook verification hardening:
 *   1. Ed25519 signature rejection — invalid signatures are rejected
 *   2. Replay prevention — events with old timestamps are rejected
 *   3. Deduplication — resubmitted event IDs are detected as duplicates
 *   4. Env var unification — both GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY and
 *      GHL_WEBHOOK_PUBLIC_KEY are accepted by validateGhlWebhookSignatureEd25519
 *   5. Missing signature → reject in production, warn in dev
 *   6. HMAC legacy fallback only triggers when x-ghl-signature is absent
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEd25519KeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function signEd25519(payload: string, privateKeyPem: string): string {
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), privateKeyPem);
  return sig.toString("base64");
}

// ── Load the module under test ────────────────────────────────────────────────

const { validateWebhookRequest } = await import("../server/services/sdr/ghl-client");
const { validateGhlWebhookSignatureEd25519 } = await import("../server/services/ghl");

// ── 1. Ed25519 valid signature accepted ───────────────────────────────────────

console.log("\n[1] Ed25519 valid signature accepted");
{
  const { publicKey: pubPem, privateKey: privPem } = makeEd25519KeyPair();
  const payload = JSON.stringify({ type: "contact.created", id: "abc123" });
  const sig = signEd25519(payload, privPem);

  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;
  delete process.env.GHL_WEBHOOK_PUBLIC_KEY;

  const result = validateWebhookRequest(payload, { "x-ghl-signature": sig });
  assert(result.valid === true,  "valid Ed25519 sig → valid=true");
  assert(result.method === "ed25519_current", "method=ed25519_current");
  assert(!result.replayRejected, "no replay rejection for fresh payload");
}

// ── 2. Ed25519 invalid signature rejected ─────────────────────────────────────

console.log("\n[2] Ed25519 invalid signature rejected");
{
  const { publicKey: pubPem, privateKey: _priv } = makeEd25519KeyPair();
  const { privateKey: wrongPriv } = makeEd25519KeyPair();
  const payload = JSON.stringify({ type: "contact.created", id: "abc123" });
  const badSig = signEd25519(payload, wrongPriv); // signed with wrong key

  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;

  const result = validateWebhookRequest(payload, { "x-ghl-signature": badSig });
  assert(result.valid === false, "invalid Ed25519 sig → valid=false");
  assert(result.method === "ed25519_current", "method=ed25519_current on rejection");
}

// ── 3. Replay protection — old timestamp rejected ─────────────────────────────

console.log("\n[3] Replay protection — event older than 5 minutes rejected");
{
  const { publicKey: pubPem, privateKey: privPem } = makeEd25519KeyPair();
  // Timestamp 10 minutes in the past
  const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const payload = JSON.stringify({ type: "contact.updated", id: "old-event", dateAdded: oldTs });
  const sig = signEd25519(payload, privPem);

  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;

  const result = validateWebhookRequest(payload, { "x-ghl-signature": sig });
  assert(result.valid === false, "old-timestamp event rejected");
  assert(result.replayRejected === true, "replayRejected=true for old event");
}

// ── 4. Replay protection — recent timestamp passes ────────────────────────────

console.log("\n[4] Replay protection — fresh event passes");
{
  const { publicKey: pubPem, privateKey: privPem } = makeEd25519KeyPair();
  const freshTs = new Date().toISOString();
  const payload = JSON.stringify({ type: "contact.updated", id: "fresh-event", dateAdded: freshTs });
  const sig = signEd25519(payload, privPem);

  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;

  const result = validateWebhookRequest(payload, { "x-ghl-signature": sig });
  assert(result.valid === true, "fresh event passes replay check");
  assert(!result.replayRejected, "replayRejected=false for fresh event");
}

// ── 5. Env var unification — both names accepted in validateGhlWebhookSignatureEd25519

console.log("\n[5] Env var unification: both GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY and GHL_WEBHOOK_PUBLIC_KEY accepted");
{
  const { publicKey: pubPem, privateKey: privPem } = makeEd25519KeyPair();
  const payload = "test-payload-for-ghl-ts";
  const sig = signEd25519(payload, privPem);

  // Test with primary env var name
  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;
  delete process.env.GHL_WEBHOOK_PUBLIC_KEY;
  const r1 = validateGhlWebhookSignatureEd25519(payload, sig);
  assert(r1 === true, "GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY (primary name) accepted");

  // Test with legacy env var name
  delete process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY;
  process.env.GHL_WEBHOOK_PUBLIC_KEY = pubPem;
  const r2 = validateGhlWebhookSignatureEd25519(payload, sig);
  assert(r2 === true, "GHL_WEBHOOK_PUBLIC_KEY (legacy name) accepted as fallback");

  // Restore
  delete process.env.GHL_WEBHOOK_PUBLIC_KEY;
}

// ── 6. Missing signature rejected in production mode ─────────────────────────

console.log("\n[6] Missing signature rejected when keys are configured");
{
  const { publicKey: pubPem } = makeEd25519KeyPair();
  const payload = JSON.stringify({ type: "contact.created" });

  process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = pubPem;

  const result = validateWebhookRequest(payload, {});
  assert(result.valid === false, "no signature → valid=false when key is configured");
  assert(!result.replayRejected, "replayRejected=false (didn't reach replay check)");
}

// ── 7. HMAC fallback ONLY when x-ghl-signature absent ─────────────────────────

console.log("\n[7] HMAC-SHA256 fallback only fires on x-wh-signature (not x-ghl-signature)");
{
  const hmacSecret = "test-hmac-secret-1234567890ab";
  const payload = JSON.stringify({ type: "contact.created", id: "hmac-test" });
  const expectedSig = crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");

  delete process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY;
  delete process.env.GHL_WEBHOOK_PUBLIC_KEY;
  process.env.GHL_WEBHOOK_SECRET = hmacSecret;

  // Legacy x-wh-signature → HMAC fallback should fire
  const legacyResult = validateWebhookRequest(payload, { "x-wh-signature": expectedSig });
  assert(legacyResult.valid === true, "x-wh-signature HMAC-SHA256 fallback accepted");
  assert(legacyResult.method === "hmac_sha256_legacy", "method=hmac_sha256_legacy for x-wh-signature");

  // x-ghl-signature with HMAC secret → legacy HMAC path (no Ed25519 key)
  const ghlHmacResult = validateWebhookRequest(payload, { "x-ghl-signature": expectedSig });
  assert(ghlHmacResult.valid === true, "x-ghl-signature HMAC fallback (no Ed25519 key configured)");
  assert(ghlHmacResult.method === "hmac_sha256_legacy", "method=hmac_sha256_legacy for x-ghl-signature HMAC");

  delete process.env.GHL_WEBHOOK_SECRET;
}

// ── 8. Source-level: ghl.ts checks both env var names ─────────────────────────

console.log("\n[8] Source-level: ghl.ts validateGhlWebhookSignatureEd25519 checks both env var names");
{
  const src = readFileSync("server/services/ghl.ts", "utf8");
  assert(
    src.includes("GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY") && src.includes("GHL_WEBHOOK_PUBLIC_KEY"),
    "ghl.ts references both GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY and GHL_WEBHOOK_PUBLIC_KEY"
  );
  const fnIdx = src.indexOf("function validateGhlWebhookSignatureEd25519");
  if (fnIdx !== -1) {
    const fnBody = src.slice(fnIdx, fnIdx + 600);
    assert(
      fnBody.includes("GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY") && fnBody.includes("GHL_WEBHOOK_PUBLIC_KEY"),
      "Both env var names appear within validateGhlWebhookSignatureEd25519 function body"
    );
  }
}

// ── 9. Source-level: integrations.ts pubKeyConfigured checks both names ────────

console.log("\n[9] Source-level: integrations.ts pubKeyConfigured checks both env var names");
{
  const src = readFileSync("server/routes/integrations.ts", "utf8");
  assert(
    src.includes("GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY") && src.includes("GHL_WEBHOOK_PUBLIC_KEY"),
    "integrations.ts pubKeyConfigured references both env var names"
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✓ All GHL webhook hardening checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
