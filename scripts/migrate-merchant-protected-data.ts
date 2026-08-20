#!/usr/bin/env tsx
/**
 * scripts/migrate-merchant-protected-data.ts
 * ===========================================
 * Resumable, bounded backfill migration for merchant_applications protected data.
 *
 * SAFETY DESIGN:
 *   - DEFAULT MODE: inventory-only (dry-run). Prints aggregate counts only.
 *   - EXECUTION requires BOTH:
 *       1. CLI flag   --execute
 *       2. Env var    MERCHANT_DATA_BACKFILL_AUTHORIZED=true
 *     Missing either flag → inventory-only mode regardless.
 *   - A valid MERCHANT_DATA_ENCRYPTION_KEY is required for execution.
 *   - Rows are fetched with SKIP LOCKED (pg advisory) so concurrent runs
 *     don't collide and restarts are safe.
 *   - Each row is encrypted, fingerprinted, and masked atomically in one UPDATE.
 *   - Checkpoints log counts only — never row IDs, ciphertext, or values.
 *   - Already-encrypted rows (mpd_v1: prefix) are counted and skipped.
 *   - Partial rows (mixed encrypted/plaintext) fail CLOSED — they are
 *     reported as errors and skipped, never silently processed.
 *   - The legacy credential-helper fallback (CREDENTIAL_ENCRYPTION_KEY) is
 *     never used here. This script uses ONLY the merchant key.
 *
 * USAGE:
 *   # Inventory-only (default — safe, read-only):
 *   npx tsx scripts/migrate-merchant-protected-data.ts
 *
 *   # Execute mode (requires both flags):
 *   MERCHANT_DATA_BACKFILL_AUTHORIZED=true \
 *     npx tsx scripts/migrate-merchant-protected-data.ts --execute
 *
 * OPTIONS:
 *   --execute          Enable write mode (also requires env var above)
 *   --batch-size N     Rows per batch (default 50, max 200)
 *   --max-batches N    Stop after N batches (default: unlimited)
 *   --verify           Recovery verification mode: aggregate counts only,
 *                      no writes, reports post-migration state
 *
 * RECOVERY VERIFICATION:
 *   npx tsx scripts/migrate-merchant-protected-data.ts --verify
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  processProtectedData,
  isEncryptedEnvelope,
  isMerchantEncryptionAvailable,
  getMerchantEncryptionStatus,
  type RawProtectedInput,
} from "../server/services/merchant-protected-data";

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const EXECUTE_FLAG = args.includes("--execute");
const VERIFY_MODE = args.includes("--verify");

function getArg(flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const v = Number(args[idx + 1]);
  return Number.isFinite(v) && v > 0 ? v : defaultVal;
}

const BATCH_SIZE = Math.min(getArg("--batch-size", 50), 200);
const MAX_BATCHES = getArg("--max-batches", 0); // 0 = unlimited

// ── Authorization check ───────────────────────────────────────────────────────

const AUTH_ENV = process.env.MERCHANT_DATA_BACKFILL_AUTHORIZED;
const AUTH_FLAG_OK = EXECUTE_FLAG;
const AUTH_ENV_OK = AUTH_ENV === "true";
const EXECUTE_MODE = AUTH_FLAG_OK && AUTH_ENV_OK;

// ── Helpers ───────────────────────────────────────────────────────────────────

function printBanner(mode: string): void {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Merchant Protected-Data Migration  [${mode}]`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Date      : ${new Date().toISOString()}`);
  console.log(`  Mode      : ${mode}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  if (MAX_BATCHES > 0) console.log(`  Max batches: ${MAX_BATCHES}`);
  console.log();
}

// Protected field column names in merchant_applications.
// NOTE: additional_owners is a JSONB column and is ALSO protected. It is
// included in classification, selection, and update.
const PROTECTED_FIELDS = [
  "ein", "owner_ssn", "owner_dob", "bank_routing_number", "bank_account_number", "additional_owners",
] as const;

// ── Generic error redaction ───────────────────────────────────────────────────
// NEVER print an arbitrary caught error.message — it may embed DB/provider
// values (parameter contents, column data, connection strings). Emit only a
// generic error class/code so no protected value can leak through logs.

function safeErrorLabel(err: unknown): string {
  // Prefer a structured error class name and, if present, a short numeric/string
  // code. Explicitly DO NOT include err.message or err.stack.
  const name = (err as any)?.constructor?.name ?? (err as any)?.name ?? "Error";
  const code = (err as any)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code)) {
    return `${name}[code=${code}]`;
  }
  if (typeof code === "number") {
    return `${name}[code=${code}]`;
  }
  return name;
}

// ── Schema column safety check ────────────────────────────────────────────────

async function checkSchemaColumns(): Promise<boolean> {
  const expected = [
    "ein_fingerprint", "ssn_fingerprint", "bank_account_fingerprint",
    "ein_mask", "ssn_mask", "bank_account_mask", "bank_routing_mask",
    "protected_data_version",
  ];
  const rows = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'merchant_applications'
      AND column_name = ANY(ARRAY[
        'ein_fingerprint', 'ssn_fingerprint', 'bank_account_fingerprint',
        'ein_mask', 'ssn_mask', 'bank_account_mask', 'bank_routing_mask',
        'protected_data_version'
      ])
  `);
  const found = new Set((rows.rows as Array<{ column_name: string }>).map((r) => r.column_name));
  const missing = expected.filter((c) => !found.has(c));
  if (missing.length > 0) {
    console.error("  ✗ SCHEMA NOT DEPLOYED — migration-0142 columns missing:");
    for (const col of missing) console.error(`      missing: ${col}`);
    console.error();
    console.error("  Deploy migration 0142 before running this script:");
    console.error("  migrations/0142_merchant_application_protected_data.sql");
    return false;
  }
  return true;
}

// ── Row classification helpers ────────────────────────────────────────────────

/** A scalar text field is an envelope when it is the mpd_v1 envelope string. */
function isEnvelope(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("mpd_v1:");
}

/**
 * JSONB-safe envelope detection for additional_owners.
 *
 * When additional_owners is ENCRYPTED, the JSONB column holds a JSON *string*
 * whose value is the mpd_v1 envelope (persisted via to_jsonb(text)). The pg
 * driver parses that back to a JS string "mpd_v1:...".
 *
 * When additional_owners is LEGACY PLAINTEXT, the JSONB column holds an ARRAY
 * or OBJECT (the raw owner records), which the driver parses to a JS
 * array/object — never a string starting with mpd_v1.
 *
 * @returns "envelope" | "plaintext" | "null"
 */
function classifyJsonbField(v: unknown): "envelope" | "plaintext" | "null" {
  if (v == null) return "null";
  if (typeof v === "string") {
    if (v.trim() === "") return "null";
    return v.startsWith("mpd_v1:") ? "envelope" : "plaintext";
  }
  // Array or object → legacy plaintext structure.
  if (Array.isArray(v)) {
    return v.length === 0 ? "null" : "plaintext";
  }
  if (typeof v === "object") {
    return Object.keys(v as object).length === 0 ? "null" : "plaintext";
  }
  return "plaintext";
}

function isLegacyPlaintext(v: unknown): boolean {
  return typeof v === "string" && /^\d{9}$/.test(v);
}

type RowState = "all_null" | "fully_encrypted" | "legacy_plaintext" | "partial" | "invalid";

function classifyRow(row: Record<string, unknown>): RowState {
  // Scalar text protected fields.
  const scalarFields = [
    row.ein, row.owner_ssn, row.owner_dob,
    row.bank_routing_number, row.bank_account_number,
  ];
  const scalarNonNull = scalarFields.filter((v) => v != null && String(v).trim() !== "");

  // additional_owners is a JSONB field — classify separately.
  const ownersState = classifyJsonbField(row.additional_owners);

  // Build a unified view of present-field encryption states.
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

  // All present fields are plaintext. Determine legacy-vs-invalid using the
  // scalar fields' shape (additional_owners as an array/object is always a
  // legitimate legacy structure and does not disqualify a row).
  const legacyLikeScalars = scalarNonNull.filter((v) => {
    const s = String(v);
    // Crude check: 4-17 digit numeric (EIN/SSN/routing/account) or ISO date DOB.
    return /^\d{4,17}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
  });
  // A plaintext additional_owners that is an object/array is always legacy-eligible.
  const ownersLegacyEligible = ownersState === "plaintext";
  const scalarsAllLegacy = legacyLikeScalars.length === scalarNonNull.length;

  if (scalarsAllLegacy && (ownersState !== "plaintext" || ownersLegacyEligible)) {
    return "legacy_plaintext";
  }
  return "invalid";
}

// ── Inventory-only aggregate report ──────────────────────────────────────────

async function runInventory(): Promise<void> {
  // JSONB-safe envelope detection for additional_owners:
  //   ENVELOPE  : jsonb scalar string that starts with mpd_v1:
  //   PLAINTEXT : jsonb array / object / non-envelope string that is non-empty
  //   NULL      : SQL NULL, JSON null, empty string, [] or {}
  // Expressed inline below so all categories include additional_owners.
  const result = await db.execute(sql`
    WITH classified AS (
      SELECT
        protected_data_version,
        -- scalar-field encryption booleans
        (ein IS NOT NULL AND ein LIKE 'mpd_v1:%')                     AS ein_enc,
        (ein IS NOT NULL AND ein NOT LIKE 'mpd_v1:%')                 AS ein_pt,
        (owner_ssn IS NOT NULL AND owner_ssn LIKE 'mpd_v1:%')         AS ssn_enc,
        (owner_ssn IS NOT NULL AND owner_ssn NOT LIKE 'mpd_v1:%')     AS ssn_pt,
        (owner_dob IS NOT NULL AND owner_dob LIKE 'mpd_v1:%')         AS dob_enc,
        (owner_dob IS NOT NULL AND owner_dob NOT LIKE 'mpd_v1:%')     AS dob_pt,
        (bank_routing_number IS NOT NULL AND bank_routing_number LIKE 'mpd_v1:%')     AS rout_enc,
        (bank_routing_number IS NOT NULL AND bank_routing_number NOT LIKE 'mpd_v1:%') AS rout_pt,
        (bank_account_number IS NOT NULL AND bank_account_number LIKE 'mpd_v1:%')     AS acct_enc,
        (bank_account_number IS NOT NULL AND bank_account_number NOT LIKE 'mpd_v1:%') AS acct_pt,
        -- additional_owners JSONB-safe classification
        (
          additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) = 'string'
          AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'
        )                                                             AS owners_enc,
        (
          additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) <> 'null'
          AND NOT (
            jsonb_typeof(additional_owners) = 'string'
            AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'
          )
          AND NOT (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
          AND NOT (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') = '')
          AND NOT (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb)
        )                                                             AS owners_pt
      FROM merchant_applications
    ),
    agg AS (
      SELECT
        protected_data_version,
        (ein_enc::int + ssn_enc::int + dob_enc::int + rout_enc::int + acct_enc::int + owners_enc::int) AS enc_count,
        (ein_pt::int  + ssn_pt::int  + dob_pt::int  + rout_pt::int  + acct_pt::int  + owners_pt::int)  AS pt_count
      FROM classified
    )
    SELECT
      COUNT(*)::int                                                   AS total,
      COUNT(*) FILTER (WHERE enc_count = 0 AND pt_count = 0)::int      AS all_null,
      COUNT(*) FILTER (WHERE enc_count > 0 AND pt_count = 0)::int      AS fully_encrypted,
      COUNT(*) FILTER (WHERE enc_count > 0 AND pt_count > 0)::int      AS partial,
      COUNT(*) FILTER (WHERE enc_count = 0 AND pt_count > 0)::int      AS legacy_plaintext,
      COUNT(*) FILTER (WHERE protected_data_version IS NOT NULL)::int  AS version_set
    FROM agg
  `);

  const row = (result.rows as any[])[0] ?? {};
  console.log("  Aggregate row classification (includes additional_owners JSONB):");
  console.log(`    Total rows            : ${row.total ?? 0}`);
  console.log(`    All-null rows         : ${row.all_null ?? 0}  (no protected data)`);
  console.log(`    Fully encrypted rows  : ${row.fully_encrypted ?? 0}  (migration complete)`);
  console.log(`    Partial rows (mixed)  : ${row.partial ?? 0}  ⚠  needs remediation`);
  console.log(`    Legacy plaintext rows : ${row.legacy_plaintext ?? 0}  (legacy)`);
  console.log(`    Protected-data version set: ${row.version_set ?? 0}`);

  const needsWork = Number(row.partial ?? 0) + Number(row.legacy_plaintext ?? 0);
  const total = Number(row.total ?? 0);
  const encrypted = Number(row.fully_encrypted ?? 0);
  const progress = total > 0 ? Math.round((encrypted / total) * 100) : 100;

  console.log();
  console.log(`  Migration progress: ~${progress}% of rows with data are fully encrypted`);
  console.log(`  Rows needing migration: ${needsWork}`);
}

// ── Verification mode ─────────────────────────────────────────────────────────

async function runVerification(): Promise<void> {
  console.log("── Recovery Verification (aggregate-only, no writes) ───────────");
  await runInventory();

  // Fingerprint / mask / envelope coverage (counts only — never nested values).
  const fpResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ein_fingerprint IS NOT NULL)::int   AS ein_fp,
      COUNT(*) FILTER (WHERE ssn_fingerprint IS NOT NULL)::int   AS ssn_fp,
      COUNT(*) FILTER (WHERE bank_account_fingerprint IS NOT NULL)::int AS acct_fp,
      COUNT(*) FILTER (WHERE ein_mask IS NOT NULL)::int          AS ein_mask,
      COUNT(*) FILTER (WHERE ssn_mask IS NOT NULL)::int          AS ssn_mask,
      -- additional_owners encrypted-envelope count (JSONB scalar string mpd_v1)
      COUNT(*) FILTER (
        WHERE additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) = 'string'
          AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'
      )::int                                                     AS owners_env,
      -- additional_owners still-plaintext count (array/object/non-envelope string)
      COUNT(*) FILTER (
        WHERE additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) <> 'null'
          AND NOT (
            jsonb_typeof(additional_owners) = 'string'
            AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'
          )
          AND NOT (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
          AND NOT (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb)
      )::int                                                     AS owners_pt
    FROM merchant_applications
  `);
  const fp = (fpResult.rows as any[])[0] ?? {};
  console.log();
  console.log("  Fingerprint/mask/envelope column population (counts only):");
  console.log(`    ein_fingerprint populated         : ${fp.ein_fp ?? 0}`);
  console.log(`    ssn_fingerprint populated         : ${fp.ssn_fp ?? 0}`);
  console.log(`    bank_account_fingerprint populated: ${fp.acct_fp ?? 0}`);
  console.log(`    ein_mask populated                : ${fp.ein_mask ?? 0}`);
  console.log(`    ssn_mask populated                : ${fp.ssn_mask ?? 0}`);
  console.log(`    additional_owners encrypted       : ${fp.owners_env ?? 0}`);
  console.log(`    additional_owners still plaintext : ${fp.owners_pt ?? 0}  ${Number(fp.owners_pt ?? 0) > 0 ? "⚠  needs migration" : ""}`);

  console.log();
  console.log("  Verification complete. No row IDs or nested values were output.");
}

// ── Batch execution ───────────────────────────────────────────────────────────

interface BatchStats {
  processed: number;
  skipped_encrypted: number;
  skipped_null: number;
}

/**
 * Fatal, fail-closed migration abort. Thrown when a partial or invalid row is
 * encountered, or when an already-encrypted row is missing provable metadata.
 * Carries ONLY a generic reason code and a count — never a row ID or value.
 * The transaction that throws this rolls back; the process must NOT loop.
 */
class MigrationHaltError extends Error {
  reason: string;
  count: number;
  constructor(reason: string, count: number) {
    super(`Migration halted: ${reason} (${count} row(s) in this batch)`);
    this.name = "MigrationHaltError";
    this.reason = reason;
    this.count = count;
  }
}

/**
 * Determine whether an already-encrypted row has PROVABLY populated
 * fingerprints and masks for every encrypted field that requires them.
 * If not, we must NOT blindly stamp version=1 — decrypt might still work but
 * equality/dedup (fingerprints) and display (masks) would silently break.
 *
 * Rules (only checked for fields that ARE encrypted envelopes):
 *   ein  → requires ein_fingerprint AND ein_mask
 *   ssn  → requires ssn_fingerprint AND ssn_mask
 *   acct → requires bank_account_fingerprint AND bank_account_mask
 *   routing → requires bank_routing_mask (no fingerprint by design)
 *   dob  → no fingerprint/mask required
 *   additional_owners → no fingerprint/mask required
 */
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

/**
 * Process a single bounded batch INSIDE ONE TRANSACTION.
 *
 * Fix #2: The claim (SELECT ... FOR UPDATE SKIP LOCKED) and every row UPDATE
 *         run in the SAME db.transaction, so row locks are held from claim
 *         through write. Locks are never released between claim and update.
 *
 * Fix #3: If ANY partial or invalid row is encountered, throw MigrationHaltError
 *         to roll the whole batch back. The caller does NOT loop after a halt.
 *
 * Fix #4: An already-encrypted row is only version-stamped when fingerprints
 *         and masks are provably populated; otherwise the batch fails closed.
 *
 * Fix #5: No arbitrary error.message is logged — only generic class/code labels.
 */
async function processBatch(batchNum: number): Promise<{ stats: BatchStats; done: boolean }> {
  return db.transaction(async (tx) => {
    const stats: BatchStats = {
      processed: 0,
      skipped_encrypted: 0,
      skipped_null: 0,
    };

    // Claim a batch: rows with protected_data_version NULL that have at least
    // one non-null protected field (INCLUDING additional_owners). SKIP LOCKED
    // for concurrency; the lock is held for the whole transaction body.
    const rows = await tx.execute(sql`
      SELECT id, ein, owner_ssn, owner_dob, bank_routing_number, bank_account_number,
             additional_owners,
             ein_fingerprint, ssn_fingerprint, bank_account_fingerprint,
             ein_mask, ssn_mask, bank_account_mask, bank_routing_mask
      FROM merchant_applications
      WHERE protected_data_version IS NULL
        AND (
          ein IS NOT NULL
          OR owner_ssn IS NOT NULL
          OR owner_dob IS NOT NULL
          OR bank_routing_number IS NOT NULL
          OR bank_account_number IS NOT NULL
          OR (additional_owners IS NOT NULL AND jsonb_typeof(additional_owners) <> 'null')
        )
      ORDER BY id
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `);

    const batch = rows.rows as Array<Record<string, unknown>>;
    if (batch.length === 0) return { stats, done: true };

    // ── Pre-scan: fail closed on ANY partial or invalid row (Fix #3). ────────
    // We scan the whole claimed batch first so a halt rolls back cleanly before
    // any write occurs. Counts only — no row IDs, no values.
    let partialCount = 0;
    let invalidCount = 0;
    let unprovableEncryptedCount = 0;
    for (const row of batch) {
      const state = classifyRow(row);
      if (state === "partial") partialCount++;
      else if (state === "invalid") invalidCount++;
      else if (state === "fully_encrypted" && !encryptedRowHasProvableMetadata(row)) {
        unprovableEncryptedCount++;
      }
    }
    if (partialCount > 0) {
      throw new MigrationHaltError("partial rows detected (mixed encrypted/plaintext protected fields)", partialCount);
    }
    if (invalidCount > 0) {
      throw new MigrationHaltError("invalid rows detected (unrecognized protected-field format)", invalidCount);
    }
    if (unprovableEncryptedCount > 0) {
      throw new MigrationHaltError(
        "already-encrypted rows missing provable fingerprints/masks (cannot safely stamp version)",
        unprovableEncryptedCount,
      );
    }

    // ── Apply: only all_null, fully_encrypted (provable), legacy_plaintext. ──
    for (const row of batch) {
      const rowId = row.id as number;
      const state = classifyRow(row);

      if (state === "all_null") {
        stats.skipped_null++;
        continue;
      }

      if (state === "fully_encrypted") {
        // Metadata proven present in the pre-scan — safe to stamp version.
        await tx.execute(sql`
          UPDATE merchant_applications
          SET protected_data_version = 1
          WHERE id = ${rowId}
            AND protected_data_version IS NULL
        `);
        stats.processed++;
        stats.skipped_encrypted++;
        continue;
      }

      // state === "legacy_plaintext" — encrypt and persist.
      const input: RawProtectedInput = {
        ein: row.ein != null ? String(row.ein) : null,
        ssn: row.owner_ssn != null ? String(row.owner_ssn) : null,
        dob: row.owner_dob != null ? String(row.owner_dob) : null,
        routing: row.bank_routing_number != null ? String(row.bank_routing_number) : null,
        account: row.bank_account_number != null ? String(row.bank_account_number) : null,
        // Pass the legacy JSONB structure straight through; the service
        // normalizes and encrypts the full object as one envelope.
        additionalOwners: row.additional_owners ?? undefined,
      };

      // Encrypt via merchant-protected-data service, bound to row id.
      // additionalOwners ciphertext is an mpd_v1 string; it is persisted as a
      // JSONB *string* via to_jsonb(text) so the read path parses it back to
      // the same mpd_v1 string it expects.
      const result = processProtectedData(rowId, input);

      await tx.execute(sql`
        UPDATE merchant_applications
        SET
          ein                    = ${result.ein?.ciphertext ?? (row.ein as string | null)},
          owner_ssn              = ${result.ssn?.ciphertext ?? (row.owner_ssn as string | null)},
          owner_dob              = ${result.dob?.ciphertext ?? (row.owner_dob as string | null)},
          bank_routing_number    = ${result.routing?.ciphertext ?? (row.bank_routing_number as string | null)},
          bank_account_number    = ${result.account?.ciphertext ?? (row.bank_account_number as string | null)},
          additional_owners      = CASE
                                     WHEN ${result.additionalOwners?.ciphertext ?? null}::text IS NOT NULL
                                     THEN to_jsonb(${result.additionalOwners?.ciphertext ?? null}::text)
                                     ELSE additional_owners
                                   END,
          ein_fingerprint        = ${result.ein?.fingerprint ?? null},
          ssn_fingerprint        = ${result.ssn?.fingerprint ?? null},
          bank_account_fingerprint = ${result.account?.fingerprint ?? null},
          ein_mask               = ${result.ein?.mask ?? null},
          ssn_mask               = ${result.ssn?.mask ?? null},
          bank_account_mask      = ${result.account?.mask ?? null},
          bank_routing_mask      = ${result.routing?.mask ?? null},
          protected_data_version = ${result.version}
        WHERE id = ${rowId}
          AND protected_data_version IS NULL
      `);

      stats.processed++;
    }

    return { stats, done: batch.length < BATCH_SIZE };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (VERIFY_MODE) {
    printBanner("VERIFY");
    const schemaOk = await checkSchemaColumns();
    if (!schemaOk) { process.exit(1); }
    await runVerification();
    process.exit(0);
  }

  if (!EXECUTE_MODE) {
    printBanner("INVENTORY-ONLY (default)");

    // Show authorization requirements.
    if (EXECUTE_FLAG && !AUTH_ENV_OK) {
      console.warn("  ⚠  --execute flag provided but MERCHANT_DATA_BACKFILL_AUTHORIZED is not 'true'.");
      console.warn("     Set MERCHANT_DATA_BACKFILL_AUTHORIZED=true to authorize execution.");
      console.warn();
    } else if (!EXECUTE_FLAG) {
      console.log("  To execute: add --execute AND set MERCHANT_DATA_BACKFILL_AUTHORIZED=true");
      console.log();
    }

    const schemaOk = await checkSchemaColumns();
    if (!schemaOk) {
      console.error("  Schema check failed — inventory cannot proceed.");
      process.exit(1);
    }

    console.log("── Aggregate inventory ──────────────────────────────────────────");
    await runInventory();
    console.log();
    console.log("  Inventory-only complete. No writes were performed.");
    process.exit(0);
  }

  // ── EXECUTE MODE ───────────────────────────────────────────────────────────
  printBanner("EXECUTE");

  // Verify key.
  if (!isMerchantEncryptionAvailable()) {
    const status = getMerchantEncryptionStatus();
    console.error("  ✗ MERCHANT_DATA_ENCRYPTION_KEY is not set or invalid.");
    console.error(`    ${status.detail}`);
    console.error("    Add the key to Secrets and restart before running with --execute.");
    process.exit(1);
  }
  console.log("  ✓ MERCHANT_DATA_ENCRYPTION_KEY present and valid");

  // Schema check.
  const schemaOk = await checkSchemaColumns();
  if (!schemaOk) { process.exit(1); }
  console.log("  ✓ Migration-0142 schema columns present");
  console.log();

  // Pre-run inventory.
  console.log("── Pre-run inventory ────────────────────────────────────────────");
  await runInventory();
  console.log();

  // Batch loop.
  console.log("── Executing migration ──────────────────────────────────────────");
  const totalStats: BatchStats = {
    processed: 0,
    skipped_encrypted: 0,
    skipped_null: 0,
  };
  let batchNum = 0;
  let done = false;

  while (!done) {
    batchNum++;
    if (MAX_BATCHES > 0 && batchNum > MAX_BATCHES) {
      console.log(`  Reached max-batches limit (${MAX_BATCHES}). Stopping.`);
      break;
    }

    let stats: BatchStats;
    let batchDone: boolean;
    try {
      const res = await processBatch(batchNum);
      stats = res.stats;
      batchDone = res.done;
    } catch (err: unknown) {
      // ── Fail-closed halt (Fix #3): a partial/invalid/unprovable row was seen.
      // The transaction already rolled back. Do NOT loop — abort immediately.
      if (err instanceof MigrationHaltError) {
        console.error();
        console.error("  ✗ MIGRATION HALTED (fail-closed) — batch rolled back.");
        // Count-only, generic reason. No row IDs, no values.
        console.error(`    Reason: ${err.reason}`);
        console.error(`    Affected rows in halted batch (count only): ${err.count}`);
        console.error("    These rows must be investigated by an authorized operator.");
        console.error("    Re-run after remediation; the batch was NOT partially applied.");
        process.exit(1);
      }
      // ── Any other error: generic label only (Fix #5), then abort.
      console.error();
      console.error(`  ✗ MIGRATION ABORTED — batch transaction failed: ${safeErrorLabel(err)}`);
      console.error("    (Error detail suppressed to avoid leaking DB/provider values.)");
      process.exit(2);
    }

    done = batchDone;
    totalStats.processed += stats.processed;
    totalStats.skipped_encrypted += stats.skipped_encrypted;
    totalStats.skipped_null += stats.skipped_null;

    // Checkpoint log — counts only, no values or IDs.
    if (batchNum % 10 === 0 || done) {
      console.log(
        `  Checkpoint batch=${batchNum}: ` +
        `processed=${totalStats.processed} ` +
        `skipped_encrypted=${totalStats.skipped_encrypted} ` +
        `skipped_null=${totalStats.skipped_null}`,
      );
    }

    if (stats.processed === 0) {
      // Nothing left to do in this batch.
      break;
    }
  }

  console.log();
  console.log("── Migration complete ────────────────────────────────────────────");
  console.log(`  Total processed       : ${totalStats.processed}`);
  console.log(`  Of which (encrypted-stamped): ${totalStats.skipped_encrypted}`);
  console.log(`  Skipped (all-null)    : ${totalStats.skipped_null}`);
  console.log();

  // Post-run verification.
  console.log("── Post-run verification (aggregate only) ───────────────────────");
  await runVerification();

  console.log();
  console.log("  ✓ Migration completed successfully.");
  process.exit(0);
}

main().catch((err: unknown) => {
  // Generic label only — never print an arbitrary error.message (Fix #5).
  console.error(`Migration script crashed: ${safeErrorLabel(err)}`);
  process.exit(2);
});
