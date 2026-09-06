#!/usr/bin/env npx tsx
/**
 * cro03d-run-ceremony.ts
 *
 * Durable CRO-03D ceremony runner. Reads the signing key from the
 * CRO03D_OPERATOR_PRIVATE_KEY environment secret — no /tmp dependency.
 *
 * Usage:
 *   npx tsx scripts/cro03d-run-ceremony.ts [--target-sha <sha>]
 *
 * --target-sha defaults to the current production /api/health sha.
 * The script signs 4 approval artifacts, imports them, creates a runtime
 * attestation, and creates an activation policy revision. All steps are
 * idempotent — safe to re-run.
 */

import { createPrivateKey, createPublicKey, sign as ed25519Sign } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  CRO03C_APPROVAL_ARTIFACT_VERSION,
  CRO03C_APPROVAL_DIMENSIONS,
  canonicalCro03cApprovalPayload,
} from "../server/services/cro03/approval-artifact";
import {
  CRO03C_RECIPE_VERSION,
  CRO03C_RECIPE_HASH,
  CRO03C_MIGRATION_HEAD,
  CRO03C_PROVIDER_CONTRACTS,
  assertCro03cPriceSchedules,
  cro03cStagePlanHash,
} from "../server/services/cro03/live-execution";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";
import {
  CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  canonicalCro03cDeploymentInventory,
} from "../server/services/cro03/deployment-inventory";

// ── Config ────────────────────────────────────────────────────────────────

const PROD_BASE = "https://libertybancard.com";
const ISSUER_ID = "cro03d-operator";

const PRICING = {
  internal_source: { version: 1, unitType: "none",    currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  jsonld:          { version: 1, unitType: "parse",   currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  first_party_web: { version: 1, unitType: "page",    currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  rdap:            { version: 1, unitType: "request", currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  serper:          { version: 1, unitType: "request", currency: "USD", amountMicros: 1000,   billingSemantics: "per_unit_no_result_billable" },
  outscraper:      { version: 1, unitType: "result",  currency: "USD", amountMicros: 3000,   billingSemantics: "per_unit_no_result_free" },
  apollo:          { version: 1, unitType: "result",  currency: "USD", amountMicros: 350000, billingSemantics: "per_unit_no_result_free" },
  openai:          { version: 1, unitType: "token",   currency: "USD", amountMicros: 30,     billingSemantics: "per_unit_no_result_billable" },
  zerobounce:      { version: 1, unitType: "request", currency: "USD", amountMicros: 8000,   billingSemantics: "per_unit_no_result_billable" },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

async function prodFetch(
  sessionCookie: string,
  csrfToken: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${PROD_BASE}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      "x-csrf-token": csrfToken,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  return json;
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set");

  const res = await fetch(`${PROD_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const sessionPart = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!sessionPart) throw new Error("No session cookie returned");

  // Get CSRF token
  const csrfRes = await fetch(`${PROD_BASE}/api/csrf-token`, {
    headers: { Cookie: sessionPart },
  });
  const { token } = (await csrfRes.json()) as { token: string };
  return { cookie: sessionPart, csrf: token };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load and validate the durable private key
  const rawKey = process.env.CRO03D_OPERATOR_PRIVATE_KEY;
  if (!rawKey?.includes("BEGIN")) {
    throw new Error("CRO03D_OPERATOR_PRIVATE_KEY must be a PEM-encoded Ed25519 private key");
  }
  // Replit secrets UI can collapse newlines to spaces — normalize back to PEM line breaks.
  const privKeyPem = rawKey
    .replace(/-----BEGIN PRIVATE KEY----- /g, "-----BEGIN PRIVATE KEY-----\n")
    .replace(/ -----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----")
    .replace(/-----BEGIN PRIVATE KEY-----\n(\S+)\n-----END PRIVATE KEY-----/g,
      (_m, b64) => `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`);
  const privateKey = createPrivateKey(privKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`Expected Ed25519 key, got: ${privateKey.asymmetricKeyType}`);
  }
  const publicKey = createPublicKey(privateKey);
  const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  console.log("✓ Private key loaded (Ed25519)");
  console.log("  Public key:", pubPem.replace(/\n/g, "\\n").slice(0, 80) + "...");

  // 2. Determine target SHA
  const args = process.argv.slice(2);
  let targetSha: string;
  const shaIdx = args.indexOf("--target-sha");
  if (shaIdx !== -1 && args[shaIdx + 1]) {
    targetSha = args[shaIdx + 1];
  } else {
    const health = await (await fetch(`${PROD_BASE}/api/health`)).json() as { sha?: string };
    targetSha = health.sha ?? "";
    if (!targetSha || targetSha === "unset") throw new Error("Could not determine production SHA from /api/health");
  }
  console.log(`✓ Target SHA: ${targetSha}`);

  // 3. Validate pricing
  assertCro03cPriceSchedules(PRICING as Parameters<typeof assertCro03cPriceSchedules>[0]);
  for (const [provider, contract] of Object.entries(CRO03C_PROVIDER_CONTRACTS)) {
    const p = (PRICING as Record<string, { unitType: string; billingSemantics: string }>)[provider];
    if (!p) throw new Error(`Missing pricing for provider: ${provider}`);
    if (p.unitType !== contract.unitType || p.billingSemantics !== contract.billingSemantics) {
      throw new Error(`Pricing/contract mismatch for ${provider}`);
    }
  }
  console.log("✓ Price schedule validated");

  // 4. Build scope
  const scope = {
    policyKey:      "cro03c_live_activation",
    recipeVersion:  CRO03C_RECIPE_VERSION,
    recipeHash:     CRO03C_RECIPE_HASH,
    stagePlanHash:  cro03cStagePlanHash(),
    migrationHead:  CRO03C_MIGRATION_HEAD,
    releaseSha:     targetSha,
    priceSchedules: PRICING,
  };
  const scopeHash = stableCro03RecipeHash(scope);
  console.log(`✓ Scope hash: ${scopeHash}`);

  // 5. Sign 4 approval artifacts
  console.log("\n── Signing approval artifacts ──");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);
  const runTag = `cro03d-durable-${targetSha.slice(0, 8)}`;

  const signedArtifacts: Array<{ dimension: string; artifact: unknown }> = [];
  for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
    const payload = {
      artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
      receiptId:       randomUUID(),
      idempotencyKey:  `${runTag}-${dimension}`,
      issuerId:        ISSUER_ID,
      dimension,
      scope:           scope as unknown as Record<string, unknown>,
      scopeHash,
      issuedAt:        issuedAt.toISOString(),
      expiresAt:       expiresAt.toISOString(),
    };
    const sig = ed25519Sign(
      null,
      Buffer.from(canonicalCro03cApprovalPayload(payload as Parameters<typeof canonicalCro03cApprovalPayload>[0]), "utf8"),
      privateKey,
    );
    signedArtifacts.push({
      dimension,
      artifact: { payload, signature: sig.toString("base64") },
    });
    console.log(`  Signed ${dimension}: ${payload.receiptId}`);
  }

  // 6. Login to production
  console.log("\n── Logging in to production ──");
  const { cookie, csrf } = await login();
  console.log("  ✓ Session established");

  // 7. Import approval receipts
  console.log("\n── Importing approval receipts ──");
  const receiptIds: string[] = [];
  for (const { dimension, artifact } of signedArtifacts) {
    const result = await prodFetch(cookie, csrf, "/api/cro03c/approval-artifacts/import", {
      idempotencyKey: `${runTag}-${dimension}`,
      reason:         `Durable-key ceremony for SHA ${targetSha}`,
      artifact,
    }) as { receiptId?: string; replayed?: boolean };
    receiptIds.push(result.receiptId!);
    console.log(`  ${result.replayed ? "replayed" : "created"} ${dimension}: ${result.receiptId}`);
  }

  // 8. Deployment inventory — must exist before runtime attestation can proceed.
  // The attestation endpoint calls currentCro03cDeploymentInventory() which looks
  // up a signed row in cro03c_deployment_inventories matching the live deployment
  // identity, environment, release SHA, and queue topology hash.  These values are
  // only knowable inside the running server, so we fetch them first, sign an
  // inventory with the same operator key, and import it.
  //
  // PREREQUISITE: CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS must be set to a
  // JSON object containing the operator public key:
  //   {"cro03d-operator": "<PEM public key single-line>"}
  // The ceremony prints the public key above — use it to populate that secret.
  console.log("\n── Fetching deployment context ──");
  const deployCtx = await prodFetch(cookie, csrf, "/api/admin/cro03c/runtime-identity", undefined) as {
    deploymentIdentity: string | null;
    environmentIdentity: string | null;
    releaseSha: string | null;
    queueTopologyHash: string | null;
    workerIdentities: string[];
    workerFleetComplete: boolean;
  };
  if (!deployCtx.deploymentIdentity || !deployCtx.environmentIdentity ||
      !deployCtx.releaseSha || !deployCtx.queueTopologyHash) {
    throw new Error(`Deployment context incomplete: ${JSON.stringify(deployCtx)}`);
  }
  if (!deployCtx.workerFleetComplete || deployCtx.workerIdentities.length === 0) {
    throw new Error(
      `Worker fleet scan incomplete or empty (complete=${deployCtx.workerFleetComplete}, ` +
      `count=${deployCtx.workerIdentities.length}). ` +
      `Ensure CRO03_PROVIDER_TRANSPORT_ENABLED=true, the app is running, and BullMQ workers ` +
      `are heartbeating. Wait ~30 s and retry.`
    );
  }
  console.log(`  deploymentIdentity: ${deployCtx.deploymentIdentity}`);
  console.log(`  environmentIdentity: ${deployCtx.environmentIdentity}`);
  console.log(`  releaseSha: ${deployCtx.releaseSha}`);
  console.log(`  queueTopologyHash: ${deployCtx.queueTopologyHash.slice(0, 16)}…`);
  console.log(`  workerIdentities (${deployCtx.workerIdentities.length}): ${deployCtx.workerIdentities.join(", ")}`);

  console.log("\n── Signing deployment inventory ──");
  const inventoryIssuedAt = new Date();
  // Inventory TTL matches operator approval window (24 h).
  const inventoryExpiresAt = new Date(inventoryIssuedAt.getTime() + 24 * 3600 * 1000);
  const inventoryPayload = {
    artifactVersion: CRO03C_DEPLOYMENT_INVENTORY_VERSION,
    inventoryId:        randomUUID(),
    issuerId:           ISSUER_ID,
    deploymentIdentity: deployCtx.deploymentIdentity,
    environmentIdentity: deployCtx.environmentIdentity,
    releaseSha:          deployCtx.releaseSha,
    queueTopologyHash:   deployCtx.queueTopologyHash,
    identityKind:        "worker" as const,
    workerIdentities:    [...deployCtx.workerIdentities].sort(),
    expectedCount:       deployCtx.workerIdentities.length,
    issuedAt:            inventoryIssuedAt.toISOString(),
    expiresAt:           inventoryExpiresAt.toISOString(),
  };
  const inventorySig = ed25519Sign(
    null,
    Buffer.from(canonicalCro03cDeploymentInventory(inventoryPayload), "utf8"),
    privateKey,
  );
  const inventoryArtifact = { payload: inventoryPayload, signature: inventorySig.toString("base64") };
  console.log(`  inventoryId: ${inventoryPayload.inventoryId}`);

  console.log("\n── Importing deployment inventory ──");
  const inventory = await prodFetch(cookie, csrf, "/api/cro03c/deployment-inventories/import", {
    reason: `Durable-key ceremony for SHA ${targetSha}`,
    artifact: inventoryArtifact,
  }) as { inventoryId?: string; replayed?: boolean };
  console.log(`  ${inventory.replayed ? "replayed" : "created"}: ${inventory.inventoryId}`);

  // 9. Runtime attestation
  console.log("\n── Creating runtime attestation ──");
  // REV-05A: TTL capped at 14 min (schema enforces ≤15 min maximum).
  const attestation = await prodFetch(cookie, csrf, "/api/cro03c/runtime-attestations", {
    idempotencyKey: `${runTag}-attestation`,
    ttlMs:          14 * 60 * 1000,
  }) as { attestationId?: string; replayed?: boolean };
  console.log(`  ${attestation.replayed ? "replayed" : "created"}: ${attestation.attestationId}`);

  // 10. Activation policy
  console.log("\n── Creating activation policy ──");
  const policy = await prodFetch(cookie, csrf, "/api/cro03c/activation-policies", {
    idempotencyKey: `${runTag}-policy`,
    reason:         `Durable-key ceremony for SHA ${targetSha} (geography-v2 + batch-processor release)`,
    receiptIds,
  }) as { policyId?: string; revision?: number; replayed?: boolean };
  console.log(`  ${policy.replayed ? "replayed" : "created"}: revision=${policy.revision} id=${policy.policyId}`);

  // 11. Summary
  console.log("\n=== CRO-03D Ceremony Complete ===");
  console.log(`  Production SHA:  ${targetSha}`);
  console.log(`  Scope hash:      ${scopeHash}`);
  console.log(`  Attestation ID:  ${attestation.attestationId}`);
  console.log(`  Policy:          revision=${policy.revision}, id=${policy.policyId}`);
  console.log(`  Receipts:        ${receiptIds.join(", ")}`);
  console.log("\n  Outreach remains PAUSED. Enable from the dashboard when ready.");
}

main().catch((e) => {
  console.error("\n✗ Ceremony failed:", e.message);
  process.exit(1);
});
