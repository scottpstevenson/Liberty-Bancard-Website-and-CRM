#!/usr/bin/env npx tsx
/**
 * cro03d-run-ceremony.ts
 *
 * Durable CRO-03D ceremony runner. Reads the signing key from the
 * CRO03D_OPERATOR_PRIVATE_KEY environment secret — no /tmp dependency.
 *
 * Usage:
 *   npx tsx scripts/cro03d-run-ceremony.ts --expected-workers <N> [--target-sha <sha>]
 *   npx tsx scripts/cro03d-run-ceremony.ts --preflight-only [--expected-workers <N>]
 *
 * --expected-workers N  REQUIRED for the apply path. The independently configured
 *                       number of workers that must be observed. This value must
 *                       come from the operator's deployment configuration (not
 *                       from the observed fleet itself — W07). Ceremony aborts if
 *                       the live observed count ≠ N.
 *
 * --preflight-only  Perform ONLY read-only checks (key load, pricing, SHA, login,
 *                   runtime-identity, worker count). Exits before importing any
 *                   artifacts, inventory, attestation, or policy. Zero writes.
 *
 * --target-sha      Defaults to the current production /api/health sha.
 *
 * ### Read-only vs. write phase
 *
 *   READ-ONLY (runs in both --preflight-only and apply):
 *     1.  Load and validate private key (local)
 *     2.  Parse CLI arguments (local)
 *     3.  Fetch target SHA from /api/health (GET — anonymous)
 *     4.  Validate pricing against CRO03C_PROVIDER_CONTRACTS (local)
 *     5.  Build scope and compute scope hash (local)
 *     6.  Sign 4 approval artifacts (local Ed25519 — no network writes)
 *     7.  Login + CSRF token (session only, no data writes)
 *     8.  GET /api/admin/cro03c/runtime-identity (read-only)
 *     9.  Verify worker count against --expected-workers (local)
 *     10. [PREFLIGHT EXIT] — if --preflight-only, print diagnostics and return here
 *
 *   WRITE PHASE (apply only):
 *     11. Import 4 approval receipts
 *     12. Sign deployment inventory (local)
 *     13. Import deployment inventory
 *     14. Create runtime attestation
 *     15. Create activation policy
 *
 * W07: expectedCount in signed inventory uses operator-supplied --expected-workers N,
 *      not the observed fleet size.
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

export async function prodFetch(
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

export async function login(): Promise<{ cookie: string; csrf: string }> {
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
  // ════════════════════════════════════════════════════════════════════════
  //   READ-ONLY PHASE — all steps here must be zero-write.
  //   --preflight-only exits at the end of this phase (step 10).
  // ════════════════════════════════════════════════════════════════════════

  // STEP 1: Load and validate the durable private key (local only)
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

  // STEP 2: Parse CLI arguments (local only)
  const args = process.argv.slice(2);

  // --preflight-only: perform read-only checks and exit before any writes.
  // This flag is checked at step 10 (after all reads) to print diagnostics
  // and return before the write phase begins.
  const preflightOnly = args.includes("--preflight-only");
  if (preflightOnly) {
    console.log("ℹ  --preflight-only: will exit before importing any artifacts (zero writes)");
  }

  // W07: --expected-workers N.
  // Must be a strict positive integer (e.g. "1", "4") — not a float or exponent.
  // Rejects "1.5", "1e2", "", " 1", etc.
  const expectedWorkersIdx = args.indexOf("--expected-workers");
  let requiredWorkerCount: number | null = null;
  if (expectedWorkersIdx !== -1 && args[expectedWorkersIdx + 1] !== undefined) {
    const rawN = args[expectedWorkersIdx + 1];
    // Strict: must be a decimal integer string with no decimal point or exponent
    if (!/^\d+$/.test(rawN)) {
      throw new Error(
        `--expected-workers must be a strict positive integer like "1" or "4", got: "${rawN}"`
      );
    }
    requiredWorkerCount = Number(rawN);
    if (!Number.isFinite(requiredWorkerCount) || requiredWorkerCount < 1) {
      throw new Error("--expected-workers must be a positive integer (the number of workers in the deployment)");
    }
  }
  if (!preflightOnly && requiredWorkerCount === null) {
    throw new Error(
      "--expected-workers <N> is required for the apply path.\n" +
      "Supply the configured number of workers in the target deployment.\n" +
      "Example: npx tsx scripts/cro03d-run-ceremony.ts --expected-workers 1\n" +
      "Use --preflight-only to inspect worker state without writing artifacts."
    );
  }

  // STEP 3: Fetch target SHA from /api/health (GET — anonymous, read-only)
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

  // STEP 4: Validate pricing against approved contracts (local only)
  assertCro03cPriceSchedules(PRICING as Parameters<typeof assertCro03cPriceSchedules>[0]);
  for (const [provider, contract] of Object.entries(CRO03C_PROVIDER_CONTRACTS)) {
    const p = (PRICING as Record<string, { unitType: string; billingSemantics: string }>)[provider];
    if (!p) throw new Error(`Missing pricing for provider: ${provider}`);
    if (p.unitType !== contract.unitType || p.billingSemantics !== contract.billingSemantics) {
      throw new Error(`Pricing/contract mismatch for ${provider}`);
    }
  }
  console.log("✓ Price schedule validated");

  // STEP 5: Build scope and compute scope hash (local only)
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

  // STEP 6: Sign 4 approval artifacts (local Ed25519 — no network writes)
  // These payloads are fully constructed locally. No data is sent to the server
  // in this step; imports happen in the write phase (step 11).
  console.log("\n── Signing approval artifacts (local) ──");
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

  // STEP 7: Login + CSRF token (session only, no data writes)
  console.log("\n── Logging in to production ──");
  const { cookie, csrf } = await login();
  console.log("  ✓ Session established");

  // STEP 8: GET /api/admin/cro03c/runtime-identity (read-only GET)
  // This endpoint requires authentication but performs no writes.
  console.log("\n── Fetching deployment context ──");
  const deployCtx = await prodFetch(cookie, csrf, "/api/admin/cro03c/runtime-identity", undefined) as {
    deploymentIdentity: string | null;
    environmentIdentity: string | null;
    releaseSha: string | null;
    queueTopologyHash: string | null;
    workerIdentities: string[];
    workerFleetComplete: boolean;
    discoveryComplete: boolean;
    discoveryErrorCode: string | null;
    activeProfile: string;
  };
  if (!deployCtx.deploymentIdentity || !deployCtx.environmentIdentity ||
      !deployCtx.releaseSha || !deployCtx.queueTopologyHash) {
    throw new Error(`Deployment context incomplete: ${JSON.stringify(deployCtx)}`);
  }
  if (!deployCtx.workerFleetComplete || deployCtx.workerIdentities.length === 0) {
    throw new Error(
      `Worker fleet scan incomplete or empty (complete=${deployCtx.workerFleetComplete}, ` +
      `count=${deployCtx.workerIdentities.length}, errorCode=${deployCtx.discoveryErrorCode ?? "none"}). ` +
      `Ensure BACKGROUND_JOB_PROFILE is not "off", the app is running, and BullMQ workers ` +
      `are heartbeating. Wait ~30 s and retry. Use --preflight-only to inspect without writing.`
    );
  }
  console.log(`  deploymentIdentity: ${deployCtx.deploymentIdentity}`);
  console.log(`  environmentIdentity: ${deployCtx.environmentIdentity}`);
  console.log(`  releaseSha: ${deployCtx.releaseSha}`);
  console.log(`  queueTopologyHash: ${deployCtx.queueTopologyHash.slice(0, 16)}…`);
  console.log(`  activeProfile: ${deployCtx.activeProfile}`);
  console.log(`  workerIdentities (${deployCtx.workerIdentities.length}): ${deployCtx.workerIdentities.join(", ")}`);

  // STEP 9a: Verify --target-sha matches the server's reported releaseSha.
  // This guard is in the READ-ONLY phase so a mismatch is caught before any
  // import. An explicit --target-sha that differs from the live server means
  // the approval receipts would be scoped to a SHA the server no longer runs,
  // and the activation authority check would reject them immediately.
  if (targetSha !== deployCtx.releaseSha) {
    throw new Error(
      `SHA mismatch: --target-sha=${targetSha} but server reports releaseSha=${deployCtx.releaseSha}.\n` +
      `The approval receipts would be signed for the wrong SHA and activation would reject them.\n` +
      `Run without --target-sha to auto-detect the live SHA, or update --target-sha to match.`
    );
  }
  console.log(`✓ Target SHA matches server releaseSha: ${targetSha}`);

  // STEP 9b: Verify worker count against independently supplied --expected-workers (local)
  // W07: Using the observed count as the expected count would allow the ceremony to certify
  // an incomplete or degraded fleet simply by lowering expectations to match reality.
  if (requiredWorkerCount !== null) {
    if (deployCtx.workerIdentities.length !== requiredWorkerCount) {
      throw new Error(
        `Worker fleet count mismatch: observed ${deployCtx.workerIdentities.length} but --expected-workers=${requiredWorkerCount}.\n` +
        `Observed identities: ${deployCtx.workerIdentities.join(", ") || "(none)"}\n` +
        `Resolve the fleet discrepancy before signing the deployment inventory.`
      );
    }
    console.log(`✓ Fleet count verified: ${deployCtx.workerIdentities.length} === --expected-workers ${requiredWorkerCount}`);
  }

  // STEP 10: PREFLIGHT EXIT — no writes have occurred up to this point.
  // If --preflight-only is set, print diagnostics and return here.
  // The write phase (steps 11–15) is never reached.
  if (preflightOnly) {
    console.log("\n=== Preflight Complete — Zero Writes ===");
    console.log(`  Target SHA:        ${targetSha}`);
    console.log(`  Scope hash:        ${scopeHash}`);
    console.log(`  Deployment:        ${deployCtx.deploymentIdentity}`);
    console.log(`  Environment:       ${deployCtx.environmentIdentity}`);
    console.log(`  Observed workers:  ${deployCtx.workerIdentities.length}`);
    console.log(`  Active profile:    ${deployCtx.activeProfile}`);
    if (requiredWorkerCount !== null) {
      const match = deployCtx.workerIdentities.length === requiredWorkerCount;
      console.log(`  Expected workers:  ${requiredWorkerCount} (--expected-workers)`);
      console.log(`  Fleet match:       ${match ? "✓ YES" : "✗ NO — mismatch will abort apply"}`);
    } else {
      console.log(`  Expected workers:  (not specified — add --expected-workers N to verify before apply)`);
    }
    console.log("\nRun without --preflight-only to import artifacts and complete the ceremony.");
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  //   WRITE PHASE — starts here. Never reached by --preflight-only.
  // ════════════════════════════════════════════════════════════════════════

  // STEP 11: Import 4 approval receipts
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

  // STEP 12: Sign deployment inventory (local Ed25519 — no network write)
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
    // W07: expectedCount comes from the independently supplied --expected-workers,
    // not from the observed count (which would self-certify any fleet size).
    expectedCount:       requiredWorkerCount!,
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

  // STEP 13: Import deployment inventory
  console.log("\n── Importing deployment inventory ──");
  const inventory = await prodFetch(cookie, csrf, "/api/cro03c/deployment-inventories/import", {
    reason: `Durable-key ceremony for SHA ${targetSha}`,
    artifact: inventoryArtifact,
  }) as { inventoryId?: string; replayed?: boolean };
  console.log(`  ${inventory.replayed ? "replayed" : "created"}: ${inventory.inventoryId}`);

  // STEP 14: Runtime attestation
  console.log("\n── Creating runtime attestation ──");
  // REV-05A: TTL capped at 14 min (schema enforces ≤15 min maximum).
  const attestation = await prodFetch(cookie, csrf, "/api/cro03c/runtime-attestations", {
    idempotencyKey: `${runTag}-attestation`,
    ttlMs:          14 * 60 * 1000,
  }) as { attestationId?: string; replayed?: boolean };
  console.log(`  ${attestation.replayed ? "replayed" : "created"}: ${attestation.attestationId}`);

  // STEP 15: Activation policy
  console.log("\n── Creating activation policy ──");
  const policy = await prodFetch(cookie, csrf, "/api/cro03c/activation-policies", {
    idempotencyKey: `${runTag}-policy`,
    reason:         `Durable-key ceremony for SHA ${targetSha} (geography-v2 + batch-processor release)`,
    receiptIds,
  }) as { policyId?: string; revision?: number; replayed?: boolean };
  console.log(`  ${policy.replayed ? "replayed" : "created"}: revision=${policy.revision} id=${policy.policyId}`);

  // Summary
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
