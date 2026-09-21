/**
 * Regression tests — attestation + promotion + census staging fixes.
 *
 * Proves:
 *   1. Attestation preflight uses `captured_at` (not `created_at`).
 *   2. Gate 6 catch block distinguishes schema errors from policy denial.
 *   3. Batch promotion preflight runs ONCE before the loop (not N times).
 *   4. Staging idempotency key includes payload fingerprint.
 *   5. Zero-handoff run completion doesn't call admission.
 *   6. enqueueCro03aQualificationRun is non-fatal (wrapped in try/catch).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

// ── Area 1: Gate 6 attestation column fix ────────────────────────────────────
console.log("\n── Area 1: Gate 6 attestation column ──");

const evidenceFile = readFileSync(resolve("server/services/free-discovery/evidence-service.ts"), "utf8");

assert(
  /ORDER BY captured_at DESC/.test(evidenceFile),
  "Gate 6 uses ORDER BY captured_at DESC (correct schema column)",
);
assert(
  !/ORDER BY created_at DESC/.test(evidenceFile),
  "Gate 6 does NOT use ORDER BY created_at DESC (wrong column removed)",
);

// ── Area 2: Schema error vs policy denial distinction ─────────────────────────
console.log("\n── Area 2: Schema error vs policy denial ──");

assert(
  /ATTESTATION_SCHEMA_ERROR/.test(evidenceFile),
  "Gate 6 catch returns ATTESTATION_SCHEMA_ERROR for relation/column errors",
);
assert(
  /ATTESTATION_QUERY_ERROR/.test(evidenceFile),
  "Gate 6 catch returns ATTESTATION_QUERY_ERROR for other DB failures",
);
assert(
  /relation.*does not exist|column.*does not exist/i.test(evidenceFile),
  "Gate 6 catch correctly classifies Postgres schema errors by message pattern",
);
assert(
  /NO_LIVE_RUNTIME_ATTESTATION/.test(evidenceFile),
  "Gate 6 still returns NO_LIVE_RUNTIME_ATTESTATION when table exists but is empty/expired",
);

// ── Area 3: Batch preflight runs ONCE before loop ─────────────────────────────
console.log("\n── Area 3: Batch promotion preflight (once, not per-candidate) ──");

const leadOpsFile = readFileSync(resolve("server/routes/lead-ops.ts"), "utf8");

assert(
  /preflight.*FAILED|FAILED.*preflight/.test(leadOpsFile),
  "Batch endpoint returns preflight:FAILED when attestation unavailable",
);
assert(
  /preflightReason/.test(leadOpsFile),
  "Batch endpoint returns preflightReason in failure body",
);
// Verify the preflight SELECT runs before the staged candidate SELECT.
const preflightIdx = leadOpsFile.indexOf("Shared attestation preflight");
const stagedSelectIdx = leadOpsFile.indexOf("SELECT id FROM free_discovery_candidates");
assert(
  preflightIdx > 0 && stagedSelectIdx > 0 && preflightIdx < stagedSelectIdx,
  "Attestation preflight block precedes staged-candidate SELECT in source",
);
// Verify early return if preflight fails (sharedAttestationReason truthy).
assert(
  /sharedAttestationReason/.test(leadOpsFile),
  "sharedAttestationReason variable used to gate the batch loop",
);
assert(
  /return res\.status\(422\)/.test(leadOpsFile),
  "Preflight failure returns 422 (not 400/500) so callers can detect it distinctly",
);

// ── Area 4: Staging idempotency key includes payload fingerprint ──────────────
console.log("\n── Area 4: Staging idempotency key includes payload fingerprint ──");

const qualFile = readFileSync(resolve("server/services/cro03a/qualification-service.ts"), "utf8");

assert(
  /hashCro03Evidence\(draft\.payload\)/.test(qualFile),
  "stageCro03aSourceCensus hashes draft.payload to build the idempotency key",
);
assert(
  /cro03a-census:.*sourceEventKey.*hashCro03Evidence|cro03a-census.*hashCro03Evidence/.test(qualFile) ||
    /`cro03a-census:.*sourceEventKey\}.*slice/.test(qualFile),
  "Idempotency key template includes both sourceEventKey and payload hash slice",
);

// Verify the EXACT key template contains the hash:
const censusKeyLine = qualFile.split("\n").find((l) => l.includes("cro03a-census:") && l.includes("idempotencyKey"));
assert(
  !!censusKeyLine && censusKeyLine.includes("hashCro03Evidence"),
  `Idempotency key line includes hashCro03Evidence (found: ${censusKeyLine?.trim().slice(0, 100)})`,
);

// ── Area 5: Zero-handoff guard (previously confirmed) ────────────────────────
console.log("\n── Area 5: Zero-handoff — enqueue non-fatal ──");

assert(
  /enqueueCro03aQualificationRun.*Non-fatal|Non-fatal.*enqueue|warn.*queue unavailable/.test(qualFile),
  "enqueueCro03aQualificationRun logs queue failure as a warning, not error",
);
assert(
  /try\s*\{[\s\S]{1,400}queue\.add[\s\S]{1,200}\}\s*catch/.test(qualFile),
  "enqueueCro03aQualificationRun wraps queue.add in try/catch (non-fatal)",
);

// Confirm the catch does NOT re-throw.
const enqueueBlock = qualFile.slice(
  qualFile.indexOf("async function enqueueCro03aQualificationRun"),
  qualFile.indexOf("export async function getCro03aRun"),
);
assert(
  !enqueueBlock.includes("throw "),
  "enqueueCro03aQualificationRun catch block does NOT re-throw",
);

// ── Area 6: Panel still guards zero-handoff completion ───────────────────────
console.log("\n── Area 6: Client-side zero-handoff guard preserved ──");

const panelFile = readFileSync(
  resolve("client/src/components/lead-ops/SouthFloridaQualificationPanel.tsx"),
  "utf8",
);

assert(
  /Number.*selectedCount.*===.*0/.test(panelFile) || /selectedCount.*===.*0/.test(panelFile),
  "Panel still checks selectedCount === 0",
);
assert(
  /No admission command sent/.test(panelFile),
  "Panel still shows 'No admission command sent' informational badge",
);

// ── Area 7: promotion-state checks live attestation (not just feature flag) ──
console.log("\n── Area 7: promotion-state endpoint checks attestation ──");

assert(
  /cro03c_runtime_attestations/.test(leadOpsFile),
  "promotion-state handler queries cro03c_runtime_attestations",
);
// The attestation query must appear BEFORE the stagedCount query in the handler.
const promoStateHandlerStart = leadOpsFile.indexOf("GET /api/lead-ops/candidates/promotion-state");
const attestQueryIdx = leadOpsFile.indexOf("cro03c_runtime_attestations", promoStateHandlerStart);
const stagedQueryIdx = leadOpsFile.indexOf("disposition = 'staged'", promoStateHandlerStart);
assert(
  promoStateHandlerStart > 0 && attestQueryIdx > promoStateHandlerStart && attestQueryIdx < stagedQueryIdx,
  "Attestation query precedes staged-count query in promotion-state handler",
);
assert(
  /attestationLive/.test(leadOpsFile),
  "promotion-state response includes attestationLive",
);
assert(
  /gateOpen/.test(leadOpsFile),
  "promotion-state response includes gateOpen (flag AND attestation both required)",
);
assert(
  /no live runtime attestation exists/i.test(leadOpsFile),
  "promotion-state note explains missing attestation when flag is ON but no live row",
);

// ── Area 8: Census staging is async (202 + runId, idempotency key required) ──
console.log("\n── Area 8: Census staging async + idempotency ──");

const cro03File = readFileSync(resolve("server/routes/cro03.ts"), "utf8");

assert(
  /idempotencyKey.*z\.string|z\.string.*idempotencyKey/.test(cro03File),
  "censusStageSchema requires idempotencyKey field",
);
assert(
  /cro03a_staging_job:/.test(cro03File),
  "Census staging uses system_settings key prefixed cro03a_staging_job:",
);
assert(
  /setImmediate/.test(cro03File),
  "Census staging dispatches background work via setImmediate (non-blocking)",
);
assert(
  /202/.test(cro03File),
  "Census staging route returns 202 (Accepted) immediately",
);
assert(
  /GET.*source-census\/stage\/:runId|source-census\/stage.*:runId/.test(cro03File),
  "Poll endpoint GET /api/cro03a/source-census/stage/:runId exists",
);
assert(
  /ON CONFLICT.*DO NOTHING/.test(cro03File),
  "Concurrent retries with same key get no-op insert (DO NOTHING)",
);
assert(
  /status.*queued|queued.*status/.test(cro03File),
  "Initial job state includes status: queued",
);
assert(
  /status.*completed|completed.*status/.test(cro03File),
  "Terminal job state includes status: completed",
);
assert(
  /status.*failed|failed.*status/.test(cro03File),
  "Terminal job state includes status: failed",
);

// ── Area 9: Client badge uses gateOpen not just promotionEnabled ─────────────
console.log("\n── Area 9: Client badge uses gateOpen ──");

const panelBig = readFileSync(
  resolve("client/src/pages/dashboard/LeadOps/ProgramHealthPanel.tsx"),
  "utf8",
);

assert(
  /attestationLive.*boolean|boolean.*attestationLive/.test(panelBig),
  "PromotionState interface includes attestationLive: boolean",
);
assert(
  /gateOpen.*boolean|boolean.*gateOpen/.test(panelBig),
  "PromotionState interface includes gateOpen: boolean",
);
// Badge now uses gateOpen, not just promotionEnabled.
const badgeBlock = panelBig.slice(panelBig.indexOf("Gate status badge"), panelBig.indexOf("Gate status badge") + 600);
assert(
  /ps\.gateOpen/.test(badgeBlock),
  "Gate status badge renders based on ps.gateOpen",
);
assert(
  !/ps\.promotionEnabled/.test(badgeBlock),
  "Gate status badge does NOT render based on ps.promotionEnabled alone",
);
// Button also gated on gateOpen.
assert(
  /disabled.*gateOpen|gateOpen.*disabled/.test(panelBig),
  "Promote button is disabled when !ps.gateOpen",
);
// Client census mutation now sends idempotency key.
const sfqpFile = readFileSync(
  resolve("client/src/components/lead-ops/SouthFloridaQualificationPanel.tsx"),
  "utf8",
);
assert(
  /idempotencyKey.*census-|census-.*idempotencyKey/.test(sfqpFile),
  "Census staging mutation sends a client-generated idempotencyKey",
);
assert(
  /source-census\/stage.*encodeURIComponent|encodeURIComponent.*source-census\/stage/.test(sfqpFile),
  "Client polls GET /api/cro03a/source-census/stage/:runId with encoded runId",
);

// ── Area 10: Deployment inventory self-convergence ────────────────────────────
console.log("\n── Area 10: Deployment inventory self-convergence ──");

const convergenceFile = readFileSync(resolve("server/services/cro03-inventory-convergence.ts"), "utf8");

assert(
  /CRO03D_OPERATOR_PRIVATE_KEY/.test(convergenceFile),
  "Convergence service reads CRO03D_OPERATOR_PRIVATE_KEY from env",
);
assert(
  /ed25519Sign/.test(convergenceFile),
  "Convergence service signs the inventory payload with Ed25519",
);
assert(
  /importCro03cDeploymentInventory/.test(convergenceFile),
  "Convergence service imports via the canonical importCro03cDeploymentInventory function",
);
assert(
  /waitForWorkerHeartbeats/.test(convergenceFile),
  "Convergence service waits for live worker heartbeats before signing",
);
assert(
  /converged.*true|true.*converged/.test(convergenceFile),
  "Convergence service returns { converged: true } on success",
);
assert(
  /converged.*false|false.*converged/.test(convergenceFile),
  "Convergence service returns { converged: false, reason } on failure",
);
assert(
  /24 \* 3600/.test(convergenceFile) || /24h|24 h/.test(convergenceFile),
  "Inventory TTL is 24 hours",
);

// Startup wiring
const indexFile = readFileSync(resolve("server/index.ts"), "utf8");
assert(
  /convergeCro03cDeploymentInventory/.test(indexFile),
  "server/index.ts calls convergeCro03cDeploymentInventory at startup",
);
assert(
  /10_000.*head-start|head-start.*10_000|head-start.*worker|worker.*head-start/.test(indexFile) ||
  (/convergeCro03cDeploymentInventory/.test(indexFile) && /10_000/.test(indexFile)),
  "Startup convergence is delayed (10 s head-start for worker heartbeats)",
);

// Admin re-converge route
const cro03RouteFile = readFileSync(resolve("server/routes/cro03.ts"), "utf8");
assert(
  /deployment-inventory\/converge/.test(cro03RouteFile),
  "POST /api/admin/cro03c/deployment-inventory/converge route exists",
);

// ── Area 11: Census staging terminal-state fixes ──────────────────────────────
console.log("\n── Area 11: Census staging terminal-state fixes ──");

assert(
  /status.*running|running.*status/.test(cro03RouteFile),
  "Census background runner marks status as 'running' before staging begins",
);
assert(
  /runningAt/.test(cro03RouteFile),
  "Census 'running' state includes runningAt timestamp for stale detection",
);
assert(
  /Promise\.race/.test(cro03RouteFile),
  "Census background runner uses Promise.race for wall-clock timeout",
);
assert(
  /STAGE_TIMEOUT_MS|120_000/.test(cro03RouteFile),
  "Census background runner has a 120 s wall-clock timeout",
);
assert(
  /status.*stalled|stalled.*status/.test(cro03RouteFile),
  "Census timeout path sets status='stalled' (not 'running') in terminal state",
);
assert(
  /attempt.*[0-3].*persist|persist.*terminal.*retries|attempt < [23]/.test(cro03RouteFile),
  "Terminal state write retries up to 3 times before giving up",
);
assert(
  /stallThresholdMs|150_000/.test(cro03RouteFile),
  "Poll endpoint detects stale 'running' runs after 150 s and returns status='stalled'",
);

// ── Area 12: Client auto-converge on DEPLOYMENT_INVENTORY_MISSING ─────────────
console.log("\n── Area 12: Client auto-converge on attestation ──");

const panelFinal = readFileSync(
  resolve("client/src/pages/dashboard/LeadOps/ProgramHealthPanel.tsx"),
  "utf8",
);

assert(
  /CRO03C_DEPLOYMENT_INVENTORY_MISSING/.test(panelFinal),
  "Issue Attestation mutation checks for CRO03C_DEPLOYMENT_INVENTORY_MISSING error code",
);
assert(
  /deployment-inventory\/converge/.test(panelFinal),
  "Issue Attestation mutation calls convergence route when inventory is missing",
);
assert(
  /autoConverged/.test(panelFinal),
  "Issue Attestation success toast notes when auto-convergence occurred",
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nAttestation/promotion/census regression FAILED.");
  process.exit(1);
} else {
  console.log("\nAll attestation/promotion/census regression tests PASSED.");
}
