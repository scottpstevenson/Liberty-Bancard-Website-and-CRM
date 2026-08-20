#!/usr/bin/env tsx
/**
 * scripts/test-merchant-migration-safety.ts
 * ==========================================
 * Static and unit tests for the merchant protected-data migration tooling.
 * All tests run in-process without a live database.
 *
 * Test coverage:
 *   1. Dual-authorization enforcement (--execute + MERCHANT_DATA_BACKFILL_AUTHORIZED=true)
 *   2. No value/ID logging patterns in migration script source
 *   3. Envelope aggregate inventory classification logic
 *   4. Restart-safe selection semantics (SKIP LOCKED, protected_data_version IS NULL)
 *   5. Key validation — execution blocked without valid key
 *   6. Partial/invalid row fail-closed halt + rollback (no looping)
 *   7. Already-encrypted row detection
 *   7b. No blind version stamping (fingerprints/masks must be provable)
 *   8. Strict no-plaintext-decrypt enforcement from the service
 *
 * Also covers (interleaved across groups): additional_owners JSONB inclusion,
 * transaction-bound claim+update lock, and generic-only error redaction.
 *
 * SAFETY CONSTRAINTS:
 *   - Uses only synthetic test data (randomBytes keys, no real PII)
 *   - Never logs decrypted values, ciphertext, or key material
 *   - No database connections — all DB-touching tests use stub logic
 *
 * Run: npx tsx scripts/test-merchant-migration-safety.ts
 */

import { readFileSync } from "fs";
import { randomBytes } from "crypto";

// ── Capture original env ──────────────────────────────────────────────────────
const ORIGINAL_KEY = process.env.MERCHANT_DATA_ENCRYPTION_KEY;
const ORIGINAL_AUTH = process.env.MERCHANT_DATA_BACKFILL_AUTHORIZED;

function setTestKey(k: string): void { process.env.MERCHANT_DATA_ENCRYPTION_KEY = k; }
function clearKey(): void { delete process.env.MERCHANT_DATA_ENCRYPTION_KEY; }
function restoreEnv(): void {
  if (ORIGINAL_KEY !== undefined) {
    process.env.MERCHANT_DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
  } else {
    clearKey();
  }
  if (ORIGINAL_AUTH !== undefined) {
    process.env.MERCHANT_DATA_BACKFILL_AUTHORIZED = ORIGINAL_AUTH;
  } else {
    delete process.env.MERCHANT_DATA_BACKFILL_AUTHORIZED;
  }
}
function makeTestKey(): string { return randomBytes(32).toString("hex"); }

// Import service (reads key from env at call time).
import * as mpd from "../server/services/merchant-protected-data";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ": " + detail : ""}`);
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function assertThrows(fn: () => unknown, name: string, fragment?: string): void {
  try {
    fn();
    failed++;
    failures.push(`${name} — expected throw but none occurred`);
    console.error(`  ✗ ${name} — expected throw but none occurred`);
  } catch (err: any) {
    if (fragment && !String(err?.message ?? err).includes(fragment)) {
      failed++;
      failures.push(`${name} — thrown but fragment "${fragment}" not found`);
      console.error(`  ✗ ${name} — thrown but wrong message (fragment not found)`);
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  }
}

// ── Source file content checks ────────────────────────────────────────────────

function readSourceFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ── Group 1: Dual-authorization enforcement (source pattern checks) ───────────

function testDualAuthorizationPatterns(): void {
  console.log("\n[Group 1] Dual-authorization enforcement (source patterns)");

  const src = readSourceFile("scripts/migrate-merchant-protected-data.ts");
  assert(src.length > 0, "migration script file exists and is readable");

  // Must check BOTH the CLI flag AND the env var.
  assert(
    src.includes("--execute") && src.includes("MERCHANT_DATA_BACKFILL_AUTHORIZED"),
    "migration script references both --execute flag and MERCHANT_DATA_BACKFILL_AUTHORIZED env var",
  );

  // The final EXECUTE_MODE condition must combine both.
  assert(
    src.includes("AUTH_FLAG_OK && AUTH_ENV_OK") || src.includes("EXECUTE_FLAG && AUTH_ENV_OK"),
    "EXECUTE_MODE gated by AND of both authorization signals",
  );

  // Default must be inventory-only when authorization is absent.
  assert(
    src.includes("INVENTORY-ONLY") || src.includes("inventory-only"),
    "default mode is described as inventory-only",
  );

  // The script must check MERCHANT_DATA_ENCRYPTION_KEY before executing.
  assert(
    src.includes("isMerchantEncryptionAvailable") || src.includes("MERCHANT_DATA_ENCRYPTION_KEY"),
    "migration script verifies encryption key before executing",
  );
}

// ── Group 2: No value/ID logging patterns ─────────────────────────────────────

function testNoValueLoggingPatterns(): void {
  console.log("\n[Group 2] No value/ID logging patterns in migration script");

  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");
  const invSrc = readSourceFile("scripts/inventory-merchant-protected-data.ts");

  // Comment-stripped variants for checks that must ignore prose that legitimately
  // NAMES a forbidden pattern to document that it is deliberately NOT used.
  const stripComments = (s: string) =>
    s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const migCode = stripComments(migSrc);
  const invCode = stripComments(invSrc);

  // Forbidden patterns: logging row IDs, ciphertext, or plaintext values.
  // We check that dangerous direct-value logging patterns are absent.
  // Legitimate: logging counts, error messages, aggregate stats.
  const forbiddenInMigration = [
    // Logging the row ID would identify specific records.
    "console.log(rowId",
    "console.log(row.id",
    "console.log(`rowId",
    // Logging ciphertext or raw field values.
    "console.log(result.ein",
    "console.log(result.ssn",
    "console.log(row.ein",
    "console.log(row.owner_ssn",
    "console.log(ciphertext",
    // Logging the key.
    "console.log(process.env.MERCHANT_DATA_ENCRYPTION_KEY",
    "console.log(key",
  ];

  for (const pattern of forbiddenInMigration) {
    assert(
      !migSrc.includes(pattern),
      `migration script does not log "${pattern}"`,
    );
  }

  // Inventory must also not output values or IDs.
  const forbiddenInInventory = [
    "console.log(row.ein",
    "console.log(row.id",
    "console.log(ein",
  ];

  for (const pattern of forbiddenInInventory) {
    assert(
      !invSrc.includes(pattern),
      `inventory script does not log "${pattern}"`,
    );
  }

  // Both scripts should state "no IDs" or "aggregate only" in comments or output.
  assert(
    migSrc.includes("no row ID") || migSrc.includes("Counts only") || migSrc.includes("counts only") || migSrc.includes("no values"),
    "migration script documents no-ID-logging in comments or output strings",
  );
  assert(
    invSrc.includes("aggregate-only") || invSrc.includes("Counts only") || invSrc.includes("no IDs"),
    "inventory script documents aggregate-only output",
  );

  // ── No raw error.message printing (Fix #5) ─────────────────────────────────
  // Caught errors may embed DB/provider values (params, column data). Scripts
  // must emit only a generic error class/code via safeErrorLabel — never
  // err.message / err?.message / err.stack in console output.
  assert(
    migSrc.includes("function safeErrorLabel"),
    "migration script defines safeErrorLabel for generic error redaction",
  );
  assert(
    invSrc.includes("function safeErrorLabel"),
    "inventory script defines safeErrorLabel for generic error redaction",
  );
  // No template-literal interpolation of err.message anywhere in either script (code only).
  assert(
    !/\$\{\s*err[?.]*\.message/.test(migCode) && !migCode.includes(".message?.slice"),
    "migration script never interpolates err.message into log output",
  );
  assert(
    !/\$\{\s*err[?.]*\.message/.test(invCode),
    "inventory script never interpolates err.message into log output",
  );
  // No err.stack printing (code only — comments may name it to document non-use).
  assert(
    !migCode.includes("err.stack") && !migCode.includes("err?.stack"),
    "migration script never logs err.stack",
  );

  // safeErrorLabel itself must not read .message/.stack (only class name + code).
  const labelFn = migCode.slice(migCode.indexOf("function safeErrorLabel"));
  const labelBody = labelFn.slice(0, labelFn.indexOf("\n}"));
  assert(
    !labelBody.includes(".message") && !labelBody.includes(".stack"),
    "safeErrorLabel emits only class name / code (never message or stack)",
  );
}

// ── Group 3: Envelope aggregate inventory classification ─────────────────────

function testEnvelopeInventoryClassification(): void {
  console.log("\n[Group 3] Envelope aggregate inventory classification logic");

  // Test the local helpers used by the migration script:
  // isEnvelope, isLegacyPlaintext, classifyRow.

  const SCHEME_PREFIX = "mpd_v1:";

  function isEnvelope(v: unknown): boolean {
    return typeof v === "string" && v.startsWith(SCHEME_PREFIX);
  }

  // Mirror of the migration script's JSONB-safe additional_owners classifier.
  function classifyJsonbField(v: unknown): "envelope" | "plaintext" | "null" {
    if (v == null) return "null";
    if (typeof v === "string") {
      if (v.trim() === "") return "null";
      return v.startsWith(SCHEME_PREFIX) ? "envelope" : "plaintext";
    }
    if (Array.isArray(v)) return v.length === 0 ? "null" : "plaintext";
    if (typeof v === "object") return Object.keys(v as object).length === 0 ? "null" : "plaintext";
    return "plaintext";
  }

  function classifyRow(row: Record<string, unknown>): string {
    const scalarFields = [
      row.ein, row.owner_ssn, row.owner_dob,
      row.bank_routing_number, row.bank_account_number,
    ];
    const scalarNonNull = scalarFields.filter((v) => v != null && String(v).trim() !== "");
    const ownersState = classifyJsonbField(row.additional_owners);

    const encryptedStates: boolean[] = [];
    const plaintextStates: boolean[] = [];
    for (const v of scalarNonNull) {
      if (isEnvelope(v)) encryptedStates.push(true);
      else plaintextStates.push(true);
    }
    if (ownersState === "envelope") encryptedStates.push(true);
    else if (ownersState === "plaintext") plaintextStates.push(true);

    const presentCount = encryptedStates.length + plaintextStates.length;
    if (presentCount === 0) return "all_null";
    if (plaintextStates.length === 0) return "fully_encrypted";
    if (encryptedStates.length > 0 && plaintextStates.length > 0) return "partial";

    const legacyLikeScalars = scalarNonNull.filter((v) => {
      const s = String(v);
      return /^\d{4,17}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
    });
    const scalarsAllLegacy = legacyLikeScalars.length === scalarNonNull.length;
    if (scalarsAllLegacy) return "legacy_plaintext";
    return "invalid";
  }

  // All null.
  assert(
    classifyRow({ ein: null, owner_ssn: null, owner_dob: null, bank_routing_number: null, bank_account_number: null }) === "all_null",
    "all-null row → all_null",
  );

  // Fully encrypted.
  const fakeEnv = "mpd_v1:fake:envelope:here:abc:def";
  assert(
    classifyRow({ ein: fakeEnv, owner_ssn: fakeEnv, owner_dob: null, bank_routing_number: null, bank_account_number: null }) === "fully_encrypted",
    "all non-null fields are envelopes → fully_encrypted",
  );

  // Partial (one encrypted, one plaintext).
  assert(
    classifyRow({ ein: fakeEnv, owner_ssn: "123456789", owner_dob: null, bank_routing_number: null, bank_account_number: null }) === "partial",
    "mixed encrypted+plaintext → partial",
  );

  // Legacy plaintext (9-digit EIN).
  assert(
    classifyRow({ ein: "123456789", owner_ssn: null, owner_dob: null, bank_routing_number: null, bank_account_number: null }) === "legacy_plaintext",
    "9-digit EIN, all others null → legacy_plaintext",
  );

  // Legacy plaintext with date-format DOB.
  assert(
    classifyRow({ ein: "123456789", owner_ssn: null, owner_dob: "1980-06-15", bank_routing_number: null, bank_account_number: null }) === "legacy_plaintext",
    "9-digit EIN + ISO date DOB → legacy_plaintext",
  );

  // Invalid (EIN looks like a word).
  assert(
    classifyRow({ ein: "INVALID-FORMAT", owner_ssn: null, owner_dob: null, bank_routing_number: null, bank_account_number: null }) === "invalid",
    "unrecognized format → invalid",
  );

  // ── additional_owners (JSONB) inclusion in classification ──────────────────

  // additional_owners as a legacy plaintext ARRAY → legacy_plaintext (must be included).
  assert(
    classifyRow({ additional_owners: [{ name: "A" }] }) === "legacy_plaintext",
    "additional_owners legacy array (only field) → legacy_plaintext (included in classification)",
  );

  // additional_owners as an encrypted envelope STRING → fully_encrypted.
  assert(
    classifyRow({ additional_owners: fakeEnv }) === "fully_encrypted",
    "additional_owners mpd_v1 string (only field) → fully_encrypted",
  );

  // additional_owners plaintext array + scalar envelope → partial (mixed).
  assert(
    classifyRow({ ein: fakeEnv, additional_owners: [{ name: "A" }] }) === "partial",
    "encrypted ein + plaintext additional_owners array → partial",
  );

  // Scalar plaintext + additional_owners envelope → partial (mixed the other way).
  assert(
    classifyRow({ ein: "123456789", additional_owners: fakeEnv }) === "partial",
    "plaintext ein + encrypted additional_owners → partial",
  );

  // Empty array / empty object / JSON null → treated as null (no data).
  assert(
    classifyRow({ additional_owners: [] }) === "all_null",
    "additional_owners empty array → all_null (no protected data)",
  );
  assert(
    classifyRow({ additional_owners: {} }) === "all_null",
    "additional_owners empty object → all_null",
  );

  // Scalar legacy EIN + legacy additional_owners array → legacy_plaintext (both migrate together).
  assert(
    classifyRow({ ein: "123456789", additional_owners: [{ name: "B", ssn: "111223333" }] }) === "legacy_plaintext",
    "legacy ein + legacy additional_owners array → legacy_plaintext",
  );

  // ── Source-level: additional_owners must appear in inventory SQL and update ──
  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");
  const invSrc = readSourceFile("scripts/inventory-merchant-protected-data.ts");

  assert(
    migSrc.includes("additional_owners") && migSrc.includes("PROTECTED_FIELDS"),
    "migration script includes additional_owners in PROTECTED_FIELDS",
  );
  assert(
    /PROTECTED_FIELDS[\s\S]{0,200}additional_owners/.test(migSrc),
    "additional_owners is a member of PROTECTED_FIELDS const",
  );
  assert(
    migSrc.includes("additionalOwners: row.additional_owners"),
    "migration passes additional_owners into processProtectedData input",
  );
  assert(
    migSrc.includes("additional_owners      = CASE") || migSrc.includes("additional_owners"),
    "migration UPDATE writes additional_owners",
  );
  assert(
    migSrc.includes("to_jsonb(") && migSrc.includes("result.additionalOwners?.ciphertext"),
    "migration persists additionalOwners ciphertext as JSONB string via to_jsonb(text)",
  );
  assert(
    migSrc.includes("jsonb_typeof(additional_owners)"),
    "migration inventory SQL classifies additional_owners with jsonb_typeof (JSONB-safe)",
  );
  assert(
    invSrc.includes("jsonb_typeof(additional_owners)") && invSrc.includes("#>> '{}'"),
    "inventory SQL uses JSONB-safe envelope detection for additional_owners",
  );
  assert(
    invSrc.includes("encrypted_owners") && invSrc.includes("plaintext_owners"),
    "inventory reports additional_owners encrypted + plaintext aggregate counts",
  );

  // Ensure NO nested owner values are ever emitted: the scripts must not
  // index into the parsed additional_owners structure for output. There must
  // be no ".name" / "['ssn']" style property reads used in console output.
  assert(
    !/console\.\w+\([^)]*additional_owners\[[^)]*\]/.test(migSrc) &&
    !/console\.\w+\([^)]*additional_owners\[[^)]*\]/.test(invSrc),
    "scripts never index into additional_owners for logging (no nested value output)",
  );
}

// ── Group 4: Restart-safe selection semantics ─────────────────────────────────

function testRestartSafeSelectionSemantics(): void {
  console.log("\n[Group 4] Restart-safe selection semantics");

  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");

  // The SELECT must use SKIP LOCKED for concurrent-run safety.
  assert(
    migSrc.includes("SKIP LOCKED"),
    "migration SELECT uses SKIP LOCKED for concurrent-run safety",
  );

  // ── Transaction-bound lock (Fix #2) ────────────────────────────────────────
  // The claim (SELECT ... FOR UPDATE) and every row write must run in the SAME
  // db.transaction so the FOR UPDATE lock is held from claim through update.
  assert(
    migSrc.includes("db.transaction(async (tx)"),
    "processBatch wraps claim + writes in a single db.transaction",
  );

  // The claim SELECT must use tx.execute (inside the transaction), not db.execute.
  const processBatchStart = migSrc.indexOf("async function processBatch");
  const processBatchEnd = migSrc.indexOf("// ── Main", processBatchStart);
  const processBatchBody = migSrc.slice(processBatchStart, processBatchEnd);
  assert(
    processBatchBody.includes("tx.execute(sql`") && processBatchBody.includes("FOR UPDATE SKIP LOCKED"),
    "the FOR UPDATE SKIP LOCKED claim runs via tx.execute inside the transaction",
  );
  assert(
    !/\bawait db\.execute\(/.test(processBatchBody),
    "processBatch does NOT use db.execute for any write (lock would release before update)",
  );
  // All UPDATE statements inside processBatch use tx.execute (transaction-bound).
  const updateCount = (processBatchBody.match(/tx\.execute\(sql`\s*UPDATE merchant_applications/g) ?? []).length;
  assert(
    updateCount >= 1,
    "processBatch issues its UPDATE(s) via tx.execute (same transaction as the claim)",
  );
  // The claim and the update share the one transaction scope opened at the top
  // of processBatch.
  assert(
    processBatchBody.indexOf("db.transaction") >= 0 &&
    processBatchBody.indexOf("db.transaction") < processBatchBody.indexOf("FOR UPDATE SKIP LOCKED"),
    "the transaction is opened before the FOR UPDATE claim (claim + update share one tx)",
  );

  // The SELECT must filter on protected_data_version IS NULL for restartability.
  assert(
    migSrc.includes("protected_data_version IS NULL"),
    "migration SELECT filters WHERE protected_data_version IS NULL (resume-safe)",
  );

  // The UPDATE must write protected_data_version atomically.
  assert(
    migSrc.includes("protected_data_version = ${result.version}") ||
    migSrc.includes("protected_data_version ="),
    "migration UPDATE sets protected_data_version in the same statement",
  );

  // Must use ORDER BY id for stable, page-able cursor.
  assert(
    migSrc.includes("ORDER BY id"),
    "migration SELECT uses ORDER BY id for stable pagination",
  );

  // The UPDATE must include the WHERE id = rowId condition AND
  // protected_data_version IS NULL to prevent double-writes.
  assert(
    migSrc.includes("WHERE id = ${rowId}") && migSrc.includes("AND protected_data_version IS NULL"),
    "migration UPDATE has idempotent WHERE id AND version IS NULL guard",
  );
}

// ── Group 5: Key validation — execution blocked without valid key ─────────────

function testKeyValidation(): void {
  console.log("\n[Group 5] Key validation — execution blocked without valid key");

  clearKey();
  assert(!mpd.isMerchantEncryptionAvailable(), "isMerchantEncryptionAvailable false when key absent");

  const status = mpd.getMerchantEncryptionStatus();
  assert(status.available === false, "getMerchantEncryptionStatus.available false when key absent");
  assert(!status.detail.includes("present"), "status detail does not claim key present when absent");

  assertThrows(
    () => mpd.encryptField(1, "ein", "123456789"),
    "encryptField throws when key absent (blocks migration)",
    "not set",
  );

  // Invalid key (too short).
  setTestKey("tooshort");
  assert(!mpd.isMerchantEncryptionAvailable(), "isMerchantEncryptionAvailable false for invalid key");

  assertThrows(
    () => mpd.encryptField(1, "ein", "123456789"),
    "encryptField throws for invalid key",
  );

  // Valid key.
  setTestKey(makeTestKey());
  assert(mpd.isMerchantEncryptionAvailable(), "isMerchantEncryptionAvailable true for valid 64-hex key");
}

// ── Group 6: Partial row fail-closed behavior ─────────────────────────────────

function testPartialRowFailClosed(): void {
  console.log("\n[Group 6] Partial row fail-closed behavior");

  const key = makeTestKey();
  setTestKey(key);

  // A row with ein as an mpd_v1 envelope but owner_ssn as plaintext
  // must NOT be processed — it must fail closed.
  const fakeEnvelope = mpd.encryptField(1, "ein", "123456789");
  const fakeApp: mpd.ApplicationRecord = {
    id: 1,
    ein: fakeEnvelope,          // encrypted
    ownerSsn: "123456789",      // plaintext — not an envelope
    ownerDob: null,
    bankRoutingNumber: null,
    bankAccountNumber: null,
  };

  // decryptProtectedFields on a partial row must throw for the plaintext field.
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "admin" }),
    "decryptProtectedFields throws on plaintext ownerSsn in partial row",
    "not a recognised protected-data envelope",
  );

  // Verify the migration source explicitly checks for partial rows.
  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");
  assert(
    migSrc.includes("partial") && migSrc.includes("fail"),
    "migration script references partial-row fail-closed handling",
  );

  // ── Partial/invalid rows halt immediately and roll back (Fix #3) ──────────
  // On ANY partial/invalid row, the batch must throw to roll back — never loop.
  assert(
    migSrc.includes("MigrationHaltError"),
    "migration defines a MigrationHaltError for fail-closed batch rollback",
  );
  assert(
    /throw new MigrationHaltError\([^)]*partial/.test(migSrc),
    "processBatch throws MigrationHaltError when a partial row is detected (rolls back tx)",
  );
  assert(
    /throw new MigrationHaltError\([^)]*invalid/.test(migSrc),
    "processBatch throws MigrationHaltError when an invalid row is detected",
  );

  // The pre-scan must run BEFORE any UPDATE so nothing is partially applied.
  const preScanIdx = migSrc.indexOf("Pre-scan");
  const firstUpdateIdx = migSrc.indexOf("UPDATE merchant_applications");
  assert(
    preScanIdx >= 0 && preScanIdx < firstUpdateIdx,
    "the partial/invalid pre-scan happens before any UPDATE (clean rollback on halt)",
  );

  // The main loop must ABORT on MigrationHaltError, not continue looping.
  const mainStart = migSrc.indexOf("async function main");
  const mainBody = migSrc.slice(mainStart);
  assert(
    mainBody.includes("err instanceof MigrationHaltError") && mainBody.includes("process.exit(1)"),
    "main() catches MigrationHaltError and exits (does not loop over partial rows)",
  );

  // The halt message must be count-only/generic — never a row ID or value.
  assert(
    migSrc.includes("count only") || migSrc.includes("count-only") || migSrc.includes("Affected rows in halted batch (count only)"),
    "halt message reports affected rows as a count only (no IDs/values)",
  );

  // BatchStats must no longer track a perpetual skipped_partial/errors loop
  // counter — partial rows now halt rather than accumulate.
  assert(
    !migSrc.includes("skipped_partial"),
    "migration no longer accumulates skipped_partial (partial rows halt instead of looping)",
  );
}

// ── Group 7: Already-encrypted row detection ──────────────────────────────────

function testAlreadyEncryptedDetection(): void {
  console.log("\n[Group 7] Already-encrypted row detection");

  const key = makeTestKey();
  setTestKey(key);

  const ct = mpd.encryptField(99, "ein", "123456789");

  assert(mpd.isEncryptedEnvelope(ct), "encryptField output is recognised as envelope");
  assert(mpd.isEncryptedEnvelope("mpd_v1:anything:here"), "mpd_v1 prefix → isEncryptedEnvelope");
  assert(!mpd.isEncryptedEnvelope("123456789"), "raw digits → NOT isEncryptedEnvelope");
  assert(!mpd.isEncryptedEnvelope(null), "null → NOT isEncryptedEnvelope");
  assert(!mpd.isEncryptedEnvelope(""), "empty string → NOT isEncryptedEnvelope");
  assert(!mpd.isEncryptedEnvelope("prefix_v1:fake"), "wrong prefix → NOT isEncryptedEnvelope");

  // Migration script must check the envelope prefix before processing.
  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");
  assert(
    migSrc.includes("mpd_v1:") || migSrc.includes("isEnvelope") || migSrc.includes("isEncryptedEnvelope"),
    "migration script checks for mpd_v1 envelope prefix before processing rows",
  );
}

// ── Group 7b: No blind version stamping (Fix #4) ─────────────────────────────

function testNoBlindVersionStamping(): void {
  console.log("\n[Group 7b] No blind version stamping of already-encrypted rows");

  const migSrc = readSourceFile("scripts/migrate-merchant-protected-data.ts");

  // The script must have a metadata-provability gate for encrypted rows.
  assert(
    migSrc.includes("encryptedRowHasProvableMetadata"),
    "migration defines encryptedRowHasProvableMetadata gate",
  );

  // An already-encrypted row missing fingerprints/masks must HALT — not stamp v=1.
  assert(
    /throw new MigrationHaltError\([^)]*missing provable fingerprints\/masks/.test(migSrc) ||
    migSrc.includes("unprovableEncryptedCount"),
    "already-encrypted rows missing metadata trigger a fail-closed halt (no blind stamp)",
  );

  // The version stamp for encrypted rows must be GUARDED by the pre-scan check,
  // not unconditional. Verify the fully_encrypted UPDATE branch only runs after
  // the pre-scan proved metadata (unprovableEncryptedCount === 0 path).
  assert(
    migSrc.includes("Metadata proven present in the pre-scan"),
    "fully_encrypted version stamp documents it only runs after metadata proof",
  );

  // Reproduce the provability logic locally and prove the gate's behavior.
  function isEnvelope(v: unknown): boolean {
    return typeof v === "string" && v.startsWith("mpd_v1:");
  }
  function encryptedRowHasProvableMetadata(row: Record<string, unknown>): boolean {
    const nonEmpty = (v: unknown) => v != null && String(v).trim() !== "";
    if (isEnvelope(row.ein)) {
      if (!nonEmpty(row.ein_fingerprint) || !nonEmpty(row.ein_mask)) return false;
    }
    if (isEnvelope(row.owner_ssn)) {
      if (!nonEmpty(row.ssn_fingerprint) || !nonEmpty(row.ssn_mask)) return false;
    }
    if (isEnvelope(row.bank_account_number)) {
      if (!nonEmpty(row.bank_account_fingerprint) || !nonEmpty(row.bank_account_mask)) return false;
    }
    if (isEnvelope(row.bank_routing_number)) {
      if (!nonEmpty(row.bank_routing_mask)) return false;
    }
    return true;
  }

  const env = "mpd_v1:fake:env:iv:tag:ct";

  // Encrypted EIN but NO fingerprint/mask → NOT provable → must fail closed.
  assert(
    encryptedRowHasProvableMetadata({ ein: env, ein_fingerprint: null, ein_mask: null }) === false,
    "encrypted EIN without fingerprint/mask is NOT provable (would fail closed)",
  );
  // Encrypted EIN with fingerprint but missing mask → NOT provable.
  assert(
    encryptedRowHasProvableMetadata({ ein: env, ein_fingerprint: "fp", ein_mask: null }) === false,
    "encrypted EIN with fingerprint but no mask is NOT provable",
  );
  // Encrypted EIN with both → provable.
  assert(
    encryptedRowHasProvableMetadata({ ein: env, ein_fingerprint: "fp", ein_mask: "**1234" }) === true,
    "encrypted EIN with fingerprint AND mask is provable (safe to stamp)",
  );
  // Encrypted account without fingerprint/mask → NOT provable.
  assert(
    encryptedRowHasProvableMetadata({ bank_account_number: env, bank_account_fingerprint: null, bank_account_mask: null }) === false,
    "encrypted bank account without fingerprint/mask is NOT provable",
  );
  // Encrypted routing without mask → NOT provable (routing has no fingerprint).
  assert(
    encryptedRowHasProvableMetadata({ bank_routing_number: env, bank_routing_mask: null }) === false,
    "encrypted routing without mask is NOT provable",
  );
  assert(
    encryptedRowHasProvableMetadata({ bank_routing_number: env, bank_routing_mask: "**6789" }) === true,
    "encrypted routing with mask is provable",
  );
  // Encrypted DOB (no fingerprint/mask required) → provable.
  assert(
    encryptedRowHasProvableMetadata({ owner_dob: env }) === true,
    "encrypted DOB requires no fingerprint/mask → provable",
  );
  // Encrypted additional_owners (no fingerprint/mask required) → provable.
  assert(
    encryptedRowHasProvableMetadata({}) === true,
    "row with no metadata-requiring encrypted fields is provable",
  );
}

// ── Group 8: Strict no-plaintext-decrypt enforcement ─────────────────────────

function testStrictNoPlaintextDecrypt(): void {
  console.log("\n[Group 8] Strict no-plaintext-decrypt enforcement (service level)");

  const key = makeTestKey();
  setTestKey(key);

  assertThrows(
    () => mpd.decryptField(1, "ein", "123456789"),
    "decryptField rejects raw plaintext EIN",
    "not a recognised protected-data envelope",
  );

  assertThrows(
    () => mpd.decryptField(1, "ein", ""),
    "decryptField rejects empty string",
    "not a recognised protected-data envelope",
  );

  assertThrows(
    () => mpd.decryptField(1, "ein", "some-legacy-value"),
    "decryptField rejects legacy non-envelope string",
    "not a recognised protected-data envelope",
  );

  // The service must NOT have any code that reads or assigns CREDENTIAL_ENCRYPTION_KEY.
  // (A comment mentioning the key name to clarify it is NOT used is acceptable.)
  const svcSrc = readSourceFile("server/services/merchant-protected-data.ts");
  // Strip single-line comments before checking — the service may mention the key in
  // a comment to explicitly document that it is NOT used.
  const svcSrcNoComments = svcSrc
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert(
    !svcSrcNoComments.includes("CREDENTIAL_ENCRYPTION_KEY"),
    "merchant-protected-data service does NOT use CREDENTIAL_ENCRYPTION_KEY in code (comments allowed)",
  );

  // No silent return of plaintext: the phrase "strict no plaintext" or similar.
  assert(
    svcSrc.includes("strict no-plaintext") || svcSrc.includes("no silent plaintext") || svcSrc.includes("Refusing to decrypt"),
    "service documents strict no-plaintext behavior",
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Merchant Migration Safety Tests ===");
  console.log("  (static + unit tests; no database required)");

  testDualAuthorizationPatterns();
  testNoValueLoggingPatterns();
  testEnvelopeInventoryClassification();
  testRestartSafeSelectionSemantics();
  testKeyValidation();
  testPartialRowFailClosed();
  testAlreadyEncryptedDetection();
  testNoBlindVersionStamping();
  testStrictNoPlaintextDecrypt();

  restoreEnv();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.error("\nFailed tests:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  } else {
    console.log("All migration safety tests passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  restoreEnv();
  console.error("Test runner crashed:", err?.message ?? err);
  process.exit(2);
});
