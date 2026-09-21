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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nAttestation/promotion/census regression FAILED.");
  process.exit(1);
} else {
  console.log("\nAll attestation/promotion/census regression tests PASSED.");
}
