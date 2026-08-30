import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CRO03C_INITIAL_ROLLOUT_KEY,
  CRO03C_MAX_INITIAL_HANDOFFS,
  CRO03C_PROVIDER_CONTRACTS,
  CRO03C_STAGE_DISPOSITIONS,
  assertCro03cApprovalEvidence,
  assertCro03cCanaryTarget,
  assertCro03cLiveContext,
  assertCro03cPriceSchedules,
  assertCro03cRuntimeAttestation,
  effectiveCro03cCap,
} from "../server/services/cro03/live-execution";
import { assertSafeHostname } from "../server/services/cro03/safe-egress";
import {
  canonicalCro03cApprovalPayload,
  CRO03C_APPROVAL_ARTIFACT_VERSION,
  verifyCro03cApprovalArtifact,
  type Cro03cSignedApprovalPayload,
} from "../server/services/cro03/approval-artifact";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";
import {
  canonicalCro03cDeploymentInventory,
  CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  verifyCro03cDeploymentInventory,
  type Cro03cDeploymentInventoryPayload,
} from "../server/services/cro03/deployment-inventory";

function source(path: string): string {
  return readFileSync(path, "utf8");
}
function mustThrow(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: any) => error?.message === code);
}

const testPrivateKey = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAc+oK2y8tsyfO+9Hd4lqNEah6wqmKbpCOwx7v2fiMID
-----END PRIVATE KEY-----`;
const testPublicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmdpjEODwaY43I1XQ6inirYsfZUDTK32G7mFVIu3kv8E=
-----END PUBLIC KEY-----`;
process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS = JSON.stringify({ "test-issuer": testPublicKey });
process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS = JSON.stringify({ "inventory-issuer": testPublicKey });
const artifactNow = new Date("2026-08-30T12:00:00.000Z");
const artifactScope = { exact: "scope", nested: { value: 1 } };
const artifactPayload: Cro03cSignedApprovalPayload = {
  artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
  receiptId: "b3a88698-d6f5-4aaa-8f62-b8fcb57c0201",
  idempotencyKey: "artifact-idempotency-1",
  issuerId: "test-issuer",
  dimension: "legal",
  scope: artifactScope,
  scopeHash: stableCro03RecipeHash(artifactScope),
  issuedAt: "2026-08-30T11:00:00.000Z",
  expiresAt: "2026-08-30T13:00:00.000Z",
};
const signedArtifact = (payload: Cro03cSignedApprovalPayload) => ({
  payload,
  signature: crypto.sign(null, Buffer.from(canonicalCro03cApprovalPayload(payload)), testPrivateKey).toString("base64"),
});
verifyCro03cApprovalArtifact(signedArtifact(artifactPayload), artifactNow);
mustThrow(() => verifyCro03cApprovalArtifact({
  ...signedArtifact(artifactPayload), signature: Buffer.alloc(64).toString("base64"),
}, artifactNow), "CRO03C_APPROVAL_SIGNATURE_INVALID");
mustThrow(() => verifyCro03cApprovalArtifact(signedArtifact({
  ...artifactPayload, issuerId: "unknown-issuer",
}), artifactNow), "CRO03C_APPROVAL_ISSUER_UNKNOWN");
mustThrow(() => verifyCro03cApprovalArtifact({
  ...signedArtifact(artifactPayload), payload: { ...artifactPayload, scope: { exact: "altered" } },
}, artifactNow), "CRO03C_APPROVAL_SCOPE_MISMATCH");
const expiredPayload = {
  ...artifactPayload, issuedAt: "2026-08-30T09:00:00.000Z", expiresAt: "2026-08-30T10:00:00.000Z",
};
mustThrow(() => verifyCro03cApprovalArtifact(signedArtifact(expiredPayload), artifactNow), "CRO03C_APPROVAL_RECEIPT_EXPIRED");

const inventoryPayload: Cro03cDeploymentInventoryPayload = {
  artifactVersion: CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  inventoryId: "1f63df7c-fc42-4f93-a689-ee3c2683f2ee",
  issuerId: "inventory-issuer",
  deploymentIdentity: "deployment-1",
  environmentIdentity: "production",
  releaseSha: "a".repeat(40),
  queueTopologyHash: "b".repeat(64),
  identityKind: "worker",
  workerIdentities: ["worker-a", "worker-b"],
  expectedCount: 2,
  issuedAt: "2026-08-30T11:00:00.000Z",
  expiresAt: "2026-08-30T13:00:00.000Z",
};
const signedInventory = (payload: Cro03cDeploymentInventoryPayload) => ({
  payload,
  signature: crypto.sign(null, Buffer.from(canonicalCro03cDeploymentInventory(payload)), testPrivateKey).toString("base64"),
});
verifyCro03cDeploymentInventory(signedInventory(inventoryPayload), artifactNow);
mustThrow(() => verifyCro03cDeploymentInventory({
  ...signedInventory(inventoryPayload), signature: Buffer.alloc(64).toString("base64"),
}, artifactNow), "CRO03C_DEPLOYMENT_INVENTORY_SIGNATURE_INVALID");
mustThrow(() => verifyCro03cDeploymentInventory(signedInventory({
  ...inventoryPayload, workerIdentities: ["worker-a"], expectedCount: 2,
}), artifactNow), "CRO03C_DEPLOYMENT_INVENTORY_INVALID");
mustThrow(() => verifyCro03cDeploymentInventory(signedInventory({
  ...inventoryPayload, workerIdentities: ["worker-a", "worker-a"],
}), artifactNow), "CRO03C_DEPLOYMENT_INVENTORY_INVALID");
mustThrow(() => verifyCro03cDeploymentInventory(signedInventory({
  ...inventoryPayload, issuedAt: "2026-08-30T09:00:00.000Z", expiresAt: "2026-08-30T10:00:00.000Z",
}), artifactNow), "CRO03C_DEPLOYMENT_INVENTORY_EXPIRED");

assert.equal(CRO03C_INITIAL_ROLLOUT_KEY, "cro03c_initial_v1");
assert.equal(CRO03C_MAX_INITIAL_HANDOFFS, 100);
assert.deepEqual(CRO03C_STAGE_DISPOSITIONS, [
  "eligible", "skipped_sufficient_evidence", "skipped_missing_anchor",
  "skipped_not_applicable", "blocked_control", "blocked_budget",
  "blocked_authority", "review_required",
]);
assert.equal(CRO03C_PROVIDER_CONTRACTS.first_party_web.maxCanaryUnits, 50);
assert.equal(CRO03C_PROVIDER_CONTRACTS.apollo.minimumSample, 5);
assert.equal(CRO03C_PROVIDER_CONTRACTS.zerobounce.minimumSample, 10);
assert.equal(effectiveCro03cCap(10, 7), 7);
mustThrow(() => effectiveCro03cCap(-1, 7), "CRO03C_CAP_INVALID");
const approval = (approvalId: string) => ({
  approvalId, version: 1, approvedBy: "historical-authority",
  approvedAt: "2026-08-30T12:00:00.000Z", scopeHash: "d".repeat(64),
});
assertCro03cApprovalEvidence({
  operator: approval("operator-1"), data: approval("data-1"),
  finance: approval("finance-1"), legal: approval("legal-1"),
});
mustThrow(
  () => assertCro03cApprovalEvidence({ operator: approval("operator-1"), data: approval("data-1"), finance: approval("finance-1") }),
  "CRO03C_APPROVALS_INCOMPLETE",
);
const pricing = Object.fromEntries(Object.entries(CRO03C_PROVIDER_CONTRACTS).map(([provider, contract]) => [
  provider, {
    version: 1, unitType: contract.unitType, currency: contract.currency,
    amountMicros: contract.billingSemantics === "not_billable" ? 0 : 1,
    billingSemantics: contract.billingSemantics,
  },
]));
assertCro03cPriceSchedules(pricing);
mustThrow(() => assertCro03cPriceSchedules({ ...pricing, unknown: pricing.apollo }), "CRO03C_PRICE_SCHEDULE_UNKNOWN");
mustThrow(() => assertCro03cPriceSchedules({ ...pricing, apollo: { ...pricing.apollo, unitType: "request" } }), "CRO03C_PRICE_SCHEDULE_INVALID");
assertCro03cCanaryTarget("apollo", 5, 5);
mustThrow(() => assertCro03cCanaryTarget("apollo", 6, 6), "CRO03C_CANARY_SCOPE_INVALID");

const now = new Date("2026-08-30T12:00:00.000Z");
assertCro03cRuntimeAttestation({
  artifactSha: "a".repeat(40),
  migrationHead: "0196_cro03c_dispatch_reconciliation",
  deploymentIdentity: "prod",
  environmentIdentity: "production",
  webBootIdentity: "web-1",
  workerBootIdentity: "worker-1",
  queueTopologyHash: "b".repeat(64),
  workerHeartbeatAt: now,
  dbHealthy: true,
  redisHealthy: true,
  expiresAt: new Date(now.getTime() + 60_000),
}, now);
const captureTime = new Date(now.getTime() - 61_000);
const historicalHeartbeatAttestation = {
  artifactSha: "a".repeat(40),
  migrationHead: "0196_cro03c_dispatch_reconciliation",
  deploymentIdentity: "prod",
  environmentIdentity: "production",
  webBootIdentity: "web-1",
  workerBootIdentity: "worker-1",
  queueTopologyHash: "b".repeat(64),
  workerHeartbeatAt: captureTime,
  capturedAt: now,
  dbHealthy: true,
  redisHealthy: true,
  expiresAt: new Date(now.getTime() + 60_000),
};
// A persisted heartbeat is capture evidence, not a second 60-second lease.
assertCro03cRuntimeAttestation(historicalHeartbeatAttestation, now, "later");
mustThrow(
  () => assertCro03cRuntimeAttestation(historicalHeartbeatAttestation, now, "capture"),
  "CRO03C_WORKER_HEARTBEAT_STALE",
);
mustThrow(() => assertCro03cRuntimeAttestation({
  artifactSha: "a".repeat(40), migrationHead: "0195", deploymentIdentity: "prod",
  environmentIdentity: "production", webBootIdentity: "web", workerBootIdentity: "worker",
  queueTopologyHash: "b".repeat(64), workerHeartbeatAt: now, dbHealthy: false,
  redisHealthy: true, expiresAt: new Date(now.getTime() + 60_000),
}, now), "CRO03C_RUNTIME_UNHEALTHY");

assertSafeHostname("example.com", ["93.184.216.34"]);
for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"]) {
  mustThrow(() => assertSafeHostname("example.com", [address]), "CRO03_EGRESS_ADDRESS_DENIED");
}

assertCro03cLiveContext({
  kind: "cro03c_live", provider: "apollo", activationRevision: 1,
  generationId: "generation", commandId: "command", runId: "run",
  stageKey: "apollo", claimToken: "claim", executionFence: 1,
  runtimeAttestationId: "attestation", expiresAt: new Date(Date.now() + 60_000),
  noOutboundSnapshotHash: "c".repeat(64),
  caller: "server/services/cro03/live-execution.ts",
});

const migration = source("migrations/0195_cro03c_live_activation_authority.sql");
for (const table of [
  "cro03c_activation_policies", "cro03c_runtime_attestations", "cro03c_commands",
  "cro03c_runs", "cro03c_generations", "cro03c_stage_dispositions",
  "cro03c_stage_operations", "cro03c_receipts", "cro03c_request_hop_receipts",
  "cro03c_no_outbound_snapshots", "cro03c_forbidden_effects",
  "cro03c_validation_authorizations", "cro03c_validation_revocations",
  "cro03c_initial_rollouts", "cro03c_initial_memberships",
]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
assert.match(migration, /CHECK \(rollout_key = 'cro03c_initial_v1'\)/);
assert.match(migration, /ordinal BETWEEN 0 AND 99/);
assert.match(migration, /cro03c_stage_disposition_immutable/);
assert.match(migration, /cro03c_validation_authorization_immutable/);
const additiveMigration = source("migrations/0196_cro03c_dispatch_reconciliation.sql");
for (const table of ["cro03c_approval_receipts", "cro03c_approval_receipt_revocations"]) {
  assert.match(additiveMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(additiveMigration, /cro03c_approval_receipt_immutable/);
assert.match(additiveMigration, /dimension IN \('operator','data','finance','legal'\)/);
const continuationMigration = source("migrations/0198_cro03c_initial_continuation.sql");
const validationCapMigration = source("migrations/0201_cro03c_validation_command_caps.sql");
for (const table of [
  "cro03c_initial_subjects", "cro03c_projection_receipts",
  "cro03c_finalization_receipts", "cro03c_terminal_hooks",
]) assert.match(continuationMigration, new RegExp(`CREATE TABLE ${table}`));
assert.match(continuationMigration, /generation_id UUID NOT NULL UNIQUE REFERENCES cro03c_initial_subjects/);
assert.match(continuationMigration, /cro03c_projection_receipt_immutable/);
assert.match(validationCapMigration, /validationMaxUnits/);
assert.match(validationCapMigration, /validationMaxAmountMicros/);
assert.match(validationCapMigration, /UNIQUE INDEX cro03c_validation_authorization_generation_uidx/);
const continuation = source("server/services/cro03/initial-continuation.ts");
assert.match(continuation, /CRO03C_MICRO_CONTINUATION_DENIED/);
assert.match(continuation, /purpose: "cro03_winning_email"/);
assert.match(continuation, /authorizeCro03cValidation/);
assert.doesNotMatch(continuation, /cro03b_recipe_items|cro03b_step_executions|cro03b_finalization_receipts/);

const factory = source("server/services/cro03/enrichment-factory.ts");
assert.match(factory, /CRO03_PROVIDER_TRANSPORT_ENABLED = false as const/);
assert.doesNotMatch(factory, /cro03c_live_v1/);
const admission = source("server/services/cro03/admission-service.ts");
assert.doesNotMatch(admission, /cro03c_generations|cro03c_live_v1/);

const readiness = source("server/services/provider-readiness-control.ts");
assert.equal((readiness.match(/hasCurrentCro03cValidationAuthority\(/g) ?? []).length, 4);
assert.match(readiness, /c\.command_type='initial_batch'/);
assert.match(readiness, /a\.normalized_email_hash/);
assert.match(readiness, /expected_provider_control_revision/);
assert.match(readiness, /t\.artifact_sha=/);
assert.match(readiness, /c\.id AS command_id,r\.id AS run_id,g\.id AS generation_id/);
assert.match(readiness, /assertCro03cCommandAuthorityBeforeIo/);
assert.match(readiness, /cro03_winning_email" : "marketing_outreach"/);

const egress = source("server/services/cro03/safe-egress.ts");
assert.match(egress, /createPinnedHttpsTransport/);
assert.match(egress, /lookup:/);
assert.match(egress, /servername: connection\.hostname/);
assert.doesNotMatch(egress, /fetch\(/);

const routes = source("server/routes/cro03.ts");
for (const route of [
  "/api/cro03c/status", "/api/cro03c/activation-policies",
  "/api/cro03c/runtime-attestations", "/api/cro03c/commands",
  "/api/cro03c/commands/:id/cancel", "/api/cro03c/approval-receipts/:id/revoke",
  "/api/cro03c/approval-artifacts/import",
]) assert.ok(routes.includes(route), `missing ${route}`);
assert.match(routes, /isDashboardUser, requireRole\("admin"\)/);
assert.match(routes, /I UNDERSTAND THIS MAY USE LIVE PROVIDERS/);
assert.match(routes, /ACTIVATE CRO03C LIVE POLICY/);
assert.doesNotMatch(routes, /CRO03C_LIVE_AUTHORITY_CONFIGURATION/);
assert.match(routes, /receiptIds/);
assert.match(routes, /idempotencyKey: parsed\.data\.idempotencyKey/);
assert.match(routes, /expectedRevision: parsed\.data\.expectedRevision/);
assert.match(routes, /const cro03cAttestationSchema = z\.object\(\{\s*idempotencyKey:[\s\S]*?ttlMs:[\s\S]*?\}\)\.strict\(\);/);
assert.doesNotMatch(
  routes.match(/const cro03cAttestationSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\);/)?.[0] ?? "",
  /expectedRevision|reason/,
);

const live = source("server/services/cro03/live-execution.ts");
assert.match(live, /transportEnabled: false/);
assert.match(live, /outreach: "PAUSED \/ NOT AUTHORIZED"/);
assert.match(live, /CRO03C_HANDOFF_ALREADY_CONSUMED/);
assert.match(live, /CRO03C_INITIAL_ROLLOUT_ALREADY_CONSUMED/);
assert.match(live, /CRO03C_PRICE_SCHEDULE_UNKNOWN/);
assert.match(live, /billingSemantics/);
assert.match(live, /settled_provider_units/);
assert.match(live, /CRO03C_CANARY_CAP_INVALID/);
assert.match(live, /CRO03C_SETTLEMENT_EXCEEDS_RESERVATION/);
assert.match(live, /inconclusive_pending_reconciliation/);
assert.match(live, /INSERT INTO audit_logs/g);
assert.match(live, /cro03c\.activation_policy\.created/);
assert.match(live, /cro03c\.runtime_attestation\.created/);
assert.match(live, /cro03c\.command\.created/);
assert.match(live, /cro03c\.command\.cancelled/);
assert.match(live, /FOR UPDATE/);
assert.match(live, /CRO03C_CANCELLATION_REVISION_CONFLICT/);
assert.match(live, /cro03c_approval_receipts/);
assert.match(live, /cro03c_approval_receipt_revocations/);
assert.match(live, /CRO03C_APPROVAL_SCOPE_MISMATCH/);
assert.match(live, /export async function assertCro03cCommandAuthorityBeforeIo/);
assert.match(live, /generation_runtime_attestation_id/);
assert.match(live, /assertCro03cDeploymentAuthorityBeforeIo\(\{/);
assert.match(live, /pause\.state !== "paused"/);
assert.doesNotMatch(live, /reason=\$\{reason\.trim\(\)\}/);

console.log("CRO-03C governed live activation static certification: PASS");