/**
 * cro03-startup-ceremony.ts
 *
 * Runs the CRO-03D approval ceremony automatically on every server startup.
 * Reads the durable signing key from CRO03D_OPERATOR_PRIVATE_KEY (env secret).
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

export async function runStartupCeremony(): Promise<void> {
  const rawKey = process.env.CRO03D_OPERATOR_PRIVATE_KEY;
  if (!rawKey?.includes("BEGIN")) {
    console.log("[CRO03D] CRO03D_OPERATOR_PRIVATE_KEY not set — skipping ceremony");
    return;
  }
  const releaseSha = process.env.RELEASE_SHA ?? "";
  if (!releaseSha || releaseSha === "unset") {
    console.log("[CRO03D] RELEASE_SHA not set — skipping ceremony (dev environment)");
    return;
  }

  console.log(`[CRO03D] Running startup ceremony for SHA ${releaseSha.slice(0, 8)}...`);
  try {
    const privateKey = createPrivateKey(normalizePem(rawKey));
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error(`Expected Ed25519, got ${privateKey.asymmetricKeyType}`);
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

    const receiptIds: string[] = [];
    for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
      const payload = {
        artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
        receiptId:       randomUUID(),
        idempotencyKey:  `${runTag}-${dimension}`,
        issuerId:        "cro03d-operator",
        dimension,
        scope:           scope as unknown as Record<string, unknown>,
        scopeHash,
        issuedAt:        issuedAt.toISOString(),
        expiresAt:       expiresAt.toISOString(),
      };
      const sig = ed25519Sign(
        null,
        Buffer.from(
          canonicalCro03cApprovalPayload(payload as Parameters<typeof canonicalCro03cApprovalPayload>[0]),
          "utf8",
        ),
        privateKey,
      );
      const result = await importCro03cApprovalArtifact({
        artifact: { payload, signature: sig.toString("base64") } as any,
        idempotencyKey: `${runTag}-import-${dimension}`,
        actorId: "cro03d-startup",
      });
      receiptIds.push(result.receiptId);
      console.log(`[CRO03D]   ${result.replayed ? "~" : "+"} ${dimension}: ${result.receiptId}`);
    }

    const att = await createCro03cRuntimeAttestation({
      idempotencyKey: `${runTag}-attestation`,
      actorId: "cro03d-startup",
      ttlMs: 24 * 3600 * 1000,
    });
    console.log(`[CRO03D]   ${att.replayed ? "~" : "+"} attestation: ${att.attestationId}`);

    const pol = await createCro03cActivationPolicy({
      idempotencyKey: `${runTag}-policy`,
      reason: `Auto-ceremony on startup for SHA ${releaseSha}`,
      actorId: "cro03d-startup",
      receiptIds,
    });
    console.log(`[CRO03D]   ${pol.replayed ? "~" : "+"} policy revision=${pol.revision}`);
    console.log("[CRO03D] Ceremony complete.");
  } catch (err: unknown) {
    // Non-fatal — ceremony failure must never crash the server
    console.error("[CRO03D] Startup ceremony failed (non-fatal):", (err as Error).message);
  }
}
