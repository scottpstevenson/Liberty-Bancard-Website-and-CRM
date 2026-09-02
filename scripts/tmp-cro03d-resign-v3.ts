#!/usr/bin/env npx tsx
/**
 * tmp-cro03d-resign-v3.ts
 *
 * Full re-ceremony for deployed SHA 183d31ccd32f6435a0f7e86baf717d1b4f8289ae.
 *
 * Steps (run once, idempotent):
 *   1. Sign 4 approval artifacts (operator/data/finance/legal)
 *   2. Import each via importCro03cApprovalArtifact
 *   3. Create a runtime attestation (captures RELEASE_SHA from env)
 *   4. Create activation policy revision (binds receipts + attestation)
 */

// Must be set before any live-execution import reads process.env.RELEASE_SHA
process.env.RELEASE_SHA = "183d31ccd32f6435a0f7e86baf717d1b4f8289ae";

import { readFileSync } from "node:fs";
import { randomUUID, sign as ed25519Sign } from "node:crypto";
import {
  CRO03C_APPROVAL_ARTIFACT_VERSION, CRO03C_APPROVAL_DIMENSIONS,
  canonicalCro03cApprovalPayload,
} from "../server/services/cro03/approval-artifact";
import {
  CRO03C_RECIPE_VERSION, CRO03C_RECIPE_HASH, CRO03C_MIGRATION_HEAD,
  CRO03C_PROVIDER_CONTRACTS, assertCro03cPriceSchedules, cro03cStagePlanHash,
} from "../server/services/cro03/live-execution";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";
import { importCro03cApprovalArtifact } from "../server/services/cro03/approval-receipt";
import { createCro03cRuntimeAttestation } from "../server/services/cro03/runtime-attestation";
import { createCro03cActivationPolicy } from "../server/services/cro03/activation-policy";

const RELEASE_SHA = "183d31ccd32f6435a0f7e86baf717d1b4f8289ae";
const KEY_DIR = "/tmp/cro03d-signing";
const ISSUER_ID = "cro03d-operator";
const ACTOR_ID = "cro03d-operator";

// ── Pricing (unchanged from prior ceremonies) ──────────────────────────────
const pricing: Record<string, { version: number; unitType: string; currency: string; amountMicros: number; billingSemantics: string }> = {
  internal_source: { version: 1, unitType: "none",    currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  jsonld:          { version: 1, unitType: "parse",   currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  first_party_web: { version: 1, unitType: "page",    currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  rdap:            { version: 1, unitType: "request", currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  serper:          { version: 1, unitType: "request", currency: "USD", amountMicros: 1000,   billingSemantics: "per_unit_no_result_billable" },
  outscraper:      { version: 1, unitType: "result",  currency: "USD", amountMicros: 3000,   billingSemantics: "per_unit_no_result_free" },
  apollo:          { version: 1, unitType: "result",  currency: "USD", amountMicros: 350000, billingSemantics: "per_unit_no_result_free" },
  openai:          { version: 1, unitType: "token",   currency: "USD", amountMicros: 30,     billingSemantics: "per_unit_no_result_billable" },
  zerobounce:      { version: 1, unitType: "request", currency: "USD", amountMicros: 8000,   billingSemantics: "per_unit_no_result_billable" },
};

// Validate pricing vs contracts
for (const [provider, contract] of Object.entries(CRO03C_PROVIDER_CONTRACTS)) {
  const p = pricing[provider];
  if (!p) throw new Error(`Missing pricing for provider: ${provider}`);
  if (p.unitType !== contract.unitType || p.billingSemantics !== contract.billingSemantics)
    throw new Error(`Pricing/contract mismatch for ${provider}: unitType=${p.unitType} vs ${contract.unitType}, billingSemantics=${p.billingSemantics} vs ${contract.billingSemantics}`);
}
assertCro03cPriceSchedules(pricing as any);
console.log("✓ Price schedule validated against CRO03C_PROVIDER_CONTRACTS");
console.log(`  recipeVersion:  ${CRO03C_RECIPE_VERSION}`);
console.log(`  recipeHash:     ${CRO03C_RECIPE_HASH}`);
console.log(`  migrationHead:  ${CRO03C_MIGRATION_HEAD}`);
console.log(`  stagePlanHash:  ${cro03cStagePlanHash()}`);

// ── Scope ──────────────────────────────────────────────────────────────────
const scope = {
  policyKey:       "cro03c_live_activation",
  recipeVersion:   CRO03C_RECIPE_VERSION,
  recipeHash:      CRO03C_RECIPE_HASH,
  stagePlanHash:   cro03cStagePlanHash(),
  migrationHead:   CRO03C_MIGRATION_HEAD,
  releaseSha:      RELEASE_SHA,
  priceSchedules:  pricing,
};
const scopeHashVal = stableCro03RecipeHash(scope);
console.log(`  scopeHash:      ${scopeHashVal}`);
console.log(`  releaseSha:     ${RELEASE_SHA}`);

// ── Step 1: Sign 4 approval artifacts ────────────────────────────────────
console.log("\n── Step 1: Signing approval artifacts ──");
const privPath = `${KEY_DIR}/cro03d-ephemeral-ed25519.pem`;
const privateKey = readFileSync(privPath, "utf8");

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000); // 24h TTL

const signedArtifacts: Record<string, { payload: Record<string, unknown>; signature: string }> = {};
for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
  const payload = {
    artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
    receiptId:       randomUUID(),
    idempotencyKey:  `cro03d-resign-v3-${dimension}-${RELEASE_SHA}`,
    issuerId:        ISSUER_ID,
    dimension,
    scope:           scope as unknown as Record<string, unknown>,
    scopeHash:       scopeHashVal,
    issuedAt:        issuedAt.toISOString(),
    expiresAt:       expiresAt.toISOString(),
  };
  const sig = ed25519Sign(null, Buffer.from(canonicalCro03cApprovalPayload(payload as any), "utf8"), privateKey);
  signedArtifacts[dimension] = { payload: payload as Record<string, unknown>, signature: sig.toString("base64") };
  console.log(`  Signed ${dimension}: receiptId=${payload.receiptId}`);
}

// ── Step 2: Import approval receipts ─────────────────────────────────────
console.log("\n── Step 2: Importing approval receipts ──");
const receiptIds: string[] = [];
for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
  const artifact = signedArtifacts[dimension];
  const result = await importCro03cApprovalArtifact({
    artifact: artifact as any,
    idempotencyKey: `cro03d-resign-v3-import-${dimension}-${RELEASE_SHA}`,
    actorId: ACTOR_ID,
  });
  receiptIds.push(result.receiptId);
  console.log(`  ${result.replayed ? "replayed" : "created"} ${dimension}: receiptId=${result.receiptId}`);
}
console.log(`  Total receipts: ${receiptIds.length}`);

// ── Step 3: Runtime attestation ───────────────────────────────────────────
console.log("\n── Step 3: Creating runtime attestation ──");
const attestation = await createCro03cRuntimeAttestation({
  idempotencyKey: `cro03d-resign-v3-attestation-${RELEASE_SHA}`,
  actorId: ACTOR_ID,
  ttlMs: 24 * 3600 * 1000,
});
console.log(`  ${attestation.replayed ? "replayed" : "created"}: id=${attestation.attestationId}`);
console.log(`  artifact_sha: ${RELEASE_SHA}`);

// ── Step 4: Activation policy ─────────────────────────────────────────────
console.log("\n── Step 4: Creating activation policy revision ──");
const policy = await createCro03cActivationPolicy({
  idempotencyKey: `cro03d-resign-v3-policy-${RELEASE_SHA}`,
  expectedRevision: 4, // next revision after the last (4 prior revisions were created; this is revision 5)
  reason: `Re-ceremony for deployed SHA ${RELEASE_SHA} (geography-v2 + batch-processor release)`,
  actorId: ACTOR_ID,
  receiptIds,
});
console.log(`  ${policy.replayed ? "replayed" : "created"}: revision=${policy.revision} id=${policy.policyId}`);

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n=== CRO-03D Re-Ceremony Complete ===");
console.log(`  Production SHA:       ${RELEASE_SHA}`);
console.log(`  Scope hash:           ${scopeHashVal}`);
console.log(`  Attestation ID:       ${attestation.attestationId}`);
console.log(`  Policy revision:      ${policy.revision}`);
console.log(`  Policy ID:            ${policy.policyId}`);
console.log(`  Receipt IDs:          ${receiptIds.join(", ")}`);
console.log("\n  Outreach remains PAUSED — no provider calls activated.");
console.log("  Activation policy must be advanced via the dashboard to enable outreach.");
