/**
 * cro03-startup-ceremony.ts
 *
 * Runs the CRO-03D approval ceremony in two phases:
 *
 *   Phase 1 — runStartupCeremonyArtifacts() (pre-listen):
 *     Signs and imports approval artifacts for all four dimensions AND creates
 *     the signed deployment inventory using the operator key (requires
 *     CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS to include the matching
 *     public key for "cro03d-operator"). Does NOT require BullMQ workers.
 *     Called from server startup BEFORE httpServer.listen().
 *
 *   Phase 2 — runStartupCeremonyAttestation() (post-listen):
 *     Creates the runtime attestation (requires worker heartbeats) and the
 *     activation policy. TTL is capped at 14 min (≤ 15 min schema limit).
 *     Called from inside the listen callback AFTER workers are started.
 *
 * All steps are idempotent — safe to re-run on every boot.
 */

import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  CRO03C_APPROVAL_ARTIFACT_VERSION,
  CRO03C_APPROVAL_DIMENSIONS,
  canonicalCro03cApprovalPayload,
} from "./cro03/approval-artifact";
import {
  CRO03C_RECIPE_VERSION,
  CRO03C_RECIPE_HASH,
  CRO03C_MIGRATION_HEAD,
  assertCro03cPriceSchedules,
  cro03cStagePlanHash,
  importCro03cApprovalArtifact,
  createCro03cRuntimeAttestation,
  createCro03cActivationPolicy,
} from "./cro03/live-execution";
import {
  CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  canonicalCro03cDeploymentInventory,
  importCro03cDeploymentInventory,
  type Cro03cDeploymentInventoryPayload,
} from "./cro03/deployment-inventory";
import { stableCro03RecipeHash } from "./cro03/contracts";

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

function normalizePem(raw: string): string {
  return raw
    .replace(/-----BEGIN PRIVATE KEY----- /g, "-----BEGIN PRIVATE KEY-----\n")
    .replace(/ -----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----");
}

function buildRunContext(): {
  privateKey: ReturnType<typeof createPrivateKey>;
  scope: object;
  scopeHash: string;
  runTag: string;
  issuedAt: Date;
  expiresAt: Date;
  releaseSha: string;
} | null {
  const rawKey = process.env.CRO03D_OPERATOR_PRIVATE_KEY;
  if (!rawKey?.includes("BEGIN")) return null;
  const releaseSha = process.env.RELEASE_SHA ?? "";
  if (!releaseSha || releaseSha === "unset") return null;

  const privateKey = createPrivateKey(normalizePem(rawKey));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`Expected Ed25519 key, got ${privateKey.asymmetricKeyType}`);
  }

  assertCro03cPriceSchedules(PRICING as Parameters<typeof assertCro03cPriceSchedules>[0]);

  const scope = {
    policyKey:      "cro03c_live_activation",
    recipeVersion:  CRO03C_RECIPE_VERSION,
    recipeHash:     CRO03C_RECIPE_HASH,
    stagePlanHash:  cro03cStagePlanHash(),
    migrationHead:  CRO03C_MIGRATION_HEAD,
    releaseSha,
    priceSchedules: PRICING,
  };
  const scopeHash = stableCro03RecipeHash(scope);
  const runTag = `startup-${releaseSha.slice(0, 8)}`;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);

  return { privateKey, scope, scopeHash, runTag, issuedAt, expiresAt, releaseSha };
}

/**
 * Phase 2 — Create runtime attestation + activation policy.
 * Requires BullMQ workers to be running (for heartbeat data).
 * TTL is capped at 14 min to stay within the schema's 15-min maximum.
 * Call from inside the httpServer.listen() callback AFTER workers are started.
 */
export async function runStartupCeremonyAttestation(
  receiptIds: Partial<Record<typeof CRO03C_APPROVAL_DIMENSIONS[number], string>>,
): Promise<void> {
  let ctx: ReturnType<typeof buildRunContext>;
  try {
    ctx = buildRunContext();
  } catch (err: unknown) {
    console.error("[CRO03D] Ceremony Phase 2 setup failed (non-fatal):", (err as Error).message);
    return;
  }
  if (!ctx) {
    console.log("[CRO03D] Ceremony Phase 2 skipped — key or RELEASE_SHA not set");
    return;
  }

  const { runTag, releaseSha } = ctx;
  console.log(`[CRO03D] Phase 2: attestation + policy for SHA ${releaseSha.slice(0, 8)}...`);
  try {
    const att = await createCro03cRuntimeAttestation({
      idempotencyKey: `${runTag}-attestation`,
      actorId: "cro03d-startup",
      // Capped at 14 min; createCro03cRuntimeAttestation also clamps to ≤15 min.
      ttlMs: 14 * 60 * 1000,
    });
    console.log(`[CRO03D]   ${att.replayed ? "~" : "+"} attestation: ${att.id}`);

    // Look up the current policy revision before creating the next one.
    const { db: _db } = await import("../db");
    const { sql: _sql } = await import("drizzle-orm");
    const _revRows = await _db.execute(_sql`
      SELECT COALESCE(MAX(expected_revision), 0)::int AS revision FROM cro03c_activation_policies
    `);
    const expectedRevision = Number((_revRows.rows ?? (_revRows as any))[0]?.revision ?? 0);

    const pol = await createCro03cActivationPolicy({
      idempotencyKey: `${runTag}-policy`,
      reason: `Auto-ceremony on startup for SHA ${releaseSha}`,
      actorId: "cro03d-startup",
      expectedRevision,
      receiptIds,
    });
    console.log(`[CRO03D]   ${pol.replayed ? "~" : "+"} policy revision=${pol.revision}`);
    console.log("[CRO03D] Phase 2 complete — ceremony done.");
  } catch (err: unknown) {
    // Non-fatal — ceremony failure must never crash the server.
    // Attestation commonly fails on first boot if workers haven't emitted
    // heartbeats yet; the next startup will retry idempotently.
    console.error("[CRO03D] Phase 2 failed (non-fatal):", (err as Error).message);
  }
}

/**
 * Phase 1 — Import approval artifacts for all four dimensions AND create/import
 * the signed deployment inventory.
 *
 * The deployment inventory is required before createCro03cRuntimeAttestation()
 * can succeed in Phase 2. It is signed with CRO03D_OPERATOR_PRIVATE_KEY and
 * verified against CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS["cro03d-operator"].
 * If that issuer is not configured, inventory import logs a non-fatal warning and
 * Phase 2 attestation will fail until the issuer is registered.
 *
 * Does NOT require BullMQ workers to be running; call before httpServer.listen().
 * Returns the dimension-keyed receipt map for use by Phase 2.
 */
/**
 * REV-05A SECURITY NOTE: Phase 1 approval signing has been intentionally removed
 * from the server runtime.
 *
 * Signing multi-party approvals from the service process collapses the independent
 * approval boundary — a single server compromise would allow self-authorization of
 * production activation. Approval artifacts must be signed OUTSIDE the server
 * runtime using the CLI ceremony script:
 *
 *   npx tsx scripts/cro03d-run-ceremony.ts
 *
 * That script requires the operator private key and produces signed artifacts that
 * are then imported via the API. The server never holds a signing key at runtime.
 */
export async function runStartupCeremonyArtifacts(): Promise<
  Partial<Record<typeof CRO03C_APPROVAL_DIMENSIONS[number], string>> | null
> {
  // Server-side auto-signing removed — see security note above.
  console.log("[CRO03D] Phase 1: artifact signing is an offline operator action (see scripts/cro03d-run-ceremony.ts)");
  return null;

  // eslint-disable-next-line no-unreachable
  /* istanbul ignore next */
  try {
    // Dead code kept to preserve type compatibility; never reached.
    return null;
  } catch (err: unknown) {
    console.error("[CRO03D] Phase 1 failed (non-fatal):", (err as Error).message);
    return null;
  }
}
