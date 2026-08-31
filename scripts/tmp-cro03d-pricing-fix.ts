import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

const RELEASE_SHA = "db92fd7f053aa72f3cf4dea881cfd057f74e47ce"; // confirmed live production release
const KEY_DIR = "cro03d-keys";
const ISSUER_ID = "cro03d-operator";

// Replica of the private cro03cApprovalScope() in live-execution.ts (not exported).
function cro03cApprovalScope(pricing: Record<string, unknown>): Record<string, unknown> {
  return {
    policyKey: "cro03c_live_activation", recipeVersion: CRO03C_RECIPE_VERSION,
    recipeHash: CRO03C_RECIPE_HASH, stagePlanHash: cro03cStagePlanHash(),
    migrationHead: CRO03C_MIGRATION_HEAD, releaseSha: RELEASE_SHA,
    priceSchedules: pricing,
  };
}

// Owner-approved pricing (per chat 2026-08-31). OpenAI collapses input/output/model
// rates into one conservative flat per-token rate (Sol output, the highest given
// figure) since the schema supports only one amount per provider and this is a
// hard spend-cap input: it must never understate real cost.
const pricing: Record<string, { version: number; unitType: string; currency: string; amountMicros: number; billingSemantics: string }> = {
  internal_source: { version: 1, unitType: "none", currency: "USD", amountMicros: 0, billingSemantics: "not_billable" },
  jsonld: { version: 1, unitType: "parse", currency: "USD", amountMicros: 0, billingSemantics: "not_billable" },
  first_party_web: { version: 1, unitType: "page", currency: "USD", amountMicros: 1, billingSemantics: "per_unit_no_result_free" },
  rdap: { version: 1, unitType: "request", currency: "USD", amountMicros: 1, billingSemantics: "per_unit_no_result_free" },
  serper: { version: 1, unitType: "request", currency: "USD", amountMicros: 1000, billingSemantics: "per_unit_no_result_billable" },
  outscraper: { version: 1, unitType: "result", currency: "USD", amountMicros: 3000, billingSemantics: "per_unit_no_result_free" },
  apollo: { version: 1, unitType: "result", currency: "USD", amountMicros: 350000, billingSemantics: "per_unit_no_result_free" }, // provisional estimate, not a published rate
  openai: { version: 1, unitType: "token", currency: "USD", amountMicros: 30, billingSemantics: "per_unit_no_result_billable" }, // conservative flat rate = Sol output (highest given), see note above
  zerobounce: { version: 1, unitType: "request", currency: "USD", amountMicros: 8000, billingSemantics: "per_unit_no_result_billable" },
};

// Sanity: matches contract shape exactly (unitType/currency/billingSemantics per provider).
for (const [provider, contract] of Object.entries(CRO03C_PROVIDER_CONTRACTS)) {
  const p = pricing[provider];
  if (!p) throw new Error(`missing pricing for ${provider}`);
  if (p.unitType !== contract.unitType || p.billingSemantics !== contract.billingSemantics) {
    throw new Error(`pricing/contract mismatch for ${provider}`);
  }
}
assertCro03cPriceSchedules(pricing as any);
console.log("Price schedule validated against CRO03C_PROVIDER_CONTRACTS OK.");

const scope = cro03cApprovalScope(pricing);
const scopeHash = stableCro03RecipeHash(scope);
const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);

const signed: Record<string, unknown> = {};
const privPath = `${KEY_DIR}/cro03d-ephemeral-ed25519.pem`;
if (!existsSync(privPath)) throw new Error("CRO03D_SIGNING_KEY_MISSING");
const privateKey = readFileSync(privPath, "utf8");

for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
  const payload = {
    artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
    receiptId: randomUUID(),
    idempotencyKey: `cro03d-pricing-${dimension}-${RELEASE_SHA}`,
    issuerId: ISSUER_ID,
    dimension,
    scope,
    scopeHash,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const signature = ed25519Sign(null, Buffer.from(canonicalCro03cApprovalPayload(payload as any), "utf8"), privateKey);
  signed[dimension] = { payload, signature: signature.toString("base64") };
}

writeFileSync("signed-pricing.json", JSON.stringify(signed, null, 2));
console.log("Signed 4 approval artifacts with real price schedules -> signed-pricing.json");
for (const [dim, v] of Object.entries(signed)) {
  console.log(dim, (v as any).payload.receiptId, (v as any).payload.idempotencyKey);
}
