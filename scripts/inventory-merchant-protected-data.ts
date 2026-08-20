#!/usr/bin/env tsx
/**
 * scripts/inventory-merchant-protected-data.ts
 * =============================================
 * Aggregate-only inventory of merchant_applications protected-data rows.
 *
 * SAFETY CONSTRAINTS (strict):
 *   - NEVER outputs row IDs, ciphertext, plaintext, fingerprints, or any
 *     identifying value. Counts and aggregate statistics ONLY.
 *   - Safely detects missing migration-0142 columns and explains that the
 *     schema must be deployed before running the migration.
 *   - No writes to the database — read-only, aggregate SELECT queries only.
 *   - Safe to run at any time without authorization flags.
 *
 * OUTPUT:
 *   Counts per category:
 *     null_rows         — ein IS NULL (no protected data present)
 *     encrypted_rows    — ein starts with "mpd_v1:" (valid envelope)
 *     legacy_plaintext  — ein looks like raw digits (legacy unencrypted)
 *     invalid_rows      — ein present but neither null/envelope/plaintext
 *     partial_rows      — at least one protected field encrypted, at least one
 *                         non-null field is NOT an envelope (mixed state)
 *
 *   Also reports duplicate EIN fingerprint groups (using normalized legacy
 *   EIN values for grouping when available) WITHOUT outputting the EIN values
 *   or row IDs — only the count of groups with >1 member and the max group size.
 *
 * USAGE:
 *   npx tsx scripts/inventory-merchant-protected-data.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const SCHEME_PREFIX = "mpd_v1:";

// ── Generic error redaction ───────────────────────────────────────────────────
// NEVER print an arbitrary caught error.message — it may embed DB/provider
// values (parameter contents, column data, connection strings). Emit only a
// generic error class name and, if safe, a short code.
function safeErrorLabel(err: unknown): string {
  const name = (err as any)?.constructor?.name ?? (err as any)?.name ?? "Error";
  const code = (err as any)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code)) return `${name}[code=${code}]`;
  if (typeof code === "number") return `${name}[code=${code}]`;
  return name;
}

// ── Schema column safety check ────────────────────────────────────────────────

async function checkSchemaColumns(): Promise<{ ok: boolean; missing: string[] }> {
  // Query information_schema to detect which migration-0142 columns exist.
  const expected = [
    "ein_fingerprint",
    "ssn_fingerprint",
    "bank_account_fingerprint",
    "ein_mask",
    "ssn_mask",
    "bank_account_mask",
    "bank_routing_mask",
    "protected_data_version",
  ];

  const rows = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'merchant_applications'
      AND column_name = ANY(ARRAY[
        'ein_fingerprint', 'ssn_fingerprint', 'bank_account_fingerprint',
        'ein_mask', 'ssn_mask', 'bank_account_mask', 'bank_routing_mask',
        'protected_data_version'
      ])
  `);

  const found = new Set((rows.rows as Array<{ column_name: string }>).map((r) => r.column_name));
  const missing = expected.filter((c) => !found.has(c));
  return { ok: missing.length === 0, missing };
}

// ── Aggregate counts ──────────────────────────────────────────────────────────

interface InventoryCounts {
  total: number;
  null_ein: number;
  encrypted_ein: number;
  legacy_plaintext_ein: number;
  invalid_ein: number;
  encrypted_owners: number;
  plaintext_owners: number;
  partial_rows: number;
  fully_encrypted: number;
  all_null: number;
}

async function gatherCounts(): Promise<InventoryCounts> {
  // Single aggregate query — no individual rows returned.
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                         AS total,
      COUNT(*) FILTER (WHERE ein IS NULL)::int                             AS null_ein,
      COUNT(*) FILTER (WHERE ein LIKE 'mpd_v1:%')::int                     AS encrypted_ein,
      COUNT(*) FILTER (
        WHERE ein IS NOT NULL
          AND ein NOT LIKE 'mpd_v1:%'
          AND ein ~ '^[0-9]{9}$'
      )::int                                                                AS legacy_plaintext_ein,
      COUNT(*) FILTER (
        WHERE ein IS NOT NULL
          AND ein NOT LIKE 'mpd_v1:%'
          AND ein !~ '^[0-9]{9}$'
      )::int                                                                AS invalid_ein,
      -- additional_owners (JSONB) protected-field counts.
      -- ENCRYPTED  : jsonb scalar string starting with mpd_v1:
      -- PLAINTEXT  : any non-null, non-empty jsonb that is NOT an mpd_v1 string
      COUNT(*) FILTER (
        WHERE additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) = 'string'
          AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'
      )::int                                                                AS encrypted_owners,
      COUNT(*) FILTER (
        WHERE additional_owners IS NOT NULL
          AND jsonb_typeof(additional_owners) <> 'null'
          AND NOT (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') LIKE 'mpd_v1:%')
          AND NOT (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
          AND NOT (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') = '')
          AND NOT (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb)
      )::int                                                                AS plaintext_owners,
      -- partial: at least one protected field is an envelope AND at least one
      -- non-null protected field is NOT an envelope (INCLUDING additional_owners)
      COUNT(*) FILTER (
        WHERE (
          (ein LIKE 'mpd_v1:%' OR owner_ssn LIKE 'mpd_v1:%' OR owner_dob LIKE 'mpd_v1:%'
           OR bank_routing_number LIKE 'mpd_v1:%' OR bank_account_number LIKE 'mpd_v1:%'
           OR (additional_owners IS NOT NULL AND jsonb_typeof(additional_owners) = 'string'
               AND (additional_owners #>> '{}') LIKE 'mpd_v1:%'))
          AND (
            (ein IS NOT NULL AND ein NOT LIKE 'mpd_v1:%')
            OR (owner_ssn IS NOT NULL AND owner_ssn NOT LIKE 'mpd_v1:%')
            OR (owner_dob IS NOT NULL AND owner_dob NOT LIKE 'mpd_v1:%')
            OR (bank_routing_number IS NOT NULL AND bank_routing_number NOT LIKE 'mpd_v1:%')
            OR (bank_account_number IS NOT NULL AND bank_account_number NOT LIKE 'mpd_v1:%')
            OR (additional_owners IS NOT NULL
                AND jsonb_typeof(additional_owners) <> 'null'
                AND NOT (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') LIKE 'mpd_v1:%')
                AND NOT (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
                AND NOT (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb))
          )
        )
      )::int                                                                AS partial_rows,
      -- fully_encrypted: every non-null protected field is an envelope
      -- (INCLUDING additional_owners), and at least one field IS an envelope.
      COUNT(*) FILTER (
        WHERE (ein IS NULL OR ein LIKE 'mpd_v1:%')
          AND (owner_ssn IS NULL OR owner_ssn LIKE 'mpd_v1:%')
          AND (owner_dob IS NULL OR owner_dob LIKE 'mpd_v1:%')
          AND (bank_routing_number IS NULL OR bank_routing_number LIKE 'mpd_v1:%')
          AND (bank_account_number IS NULL OR bank_account_number LIKE 'mpd_v1:%')
          -- additional_owners is null/empty OR an mpd_v1 envelope string
          AND (
            additional_owners IS NULL
            OR jsonb_typeof(additional_owners) = 'null'
            OR (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
            OR (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb)
            OR (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') = '')
            OR (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') LIKE 'mpd_v1:%')
          )
          -- at least one field is an envelope (otherwise it's "all null")
          AND (
            ein LIKE 'mpd_v1:%'
            OR owner_ssn LIKE 'mpd_v1:%'
            OR owner_dob LIKE 'mpd_v1:%'
            OR bank_routing_number LIKE 'mpd_v1:%'
            OR bank_account_number LIKE 'mpd_v1:%'
            OR (additional_owners IS NOT NULL AND jsonb_typeof(additional_owners) = 'string'
                AND (additional_owners #>> '{}') LIKE 'mpd_v1:%')
          )
      )::int                                                                AS fully_encrypted,
      -- all_null: every protected field is null/empty (INCLUDING additional_owners)
      COUNT(*) FILTER (
        WHERE ein IS NULL
          AND owner_ssn IS NULL
          AND owner_dob IS NULL
          AND bank_routing_number IS NULL
          AND bank_account_number IS NULL
          AND (
            additional_owners IS NULL
            OR jsonb_typeof(additional_owners) = 'null'
            OR (jsonb_typeof(additional_owners) = 'array'  AND jsonb_array_length(additional_owners) = 0)
            OR (jsonb_typeof(additional_owners) = 'object' AND additional_owners = '{}'::jsonb)
            OR (jsonb_typeof(additional_owners) = 'string' AND (additional_owners #>> '{}') = '')
          )
      )::int                                                                AS all_null
    FROM merchant_applications
  `);

  const row = (result.rows as any[])[0] ?? {};
  return {
    total: Number(row.total ?? 0),
    null_ein: Number(row.null_ein ?? 0),
    encrypted_ein: Number(row.encrypted_ein ?? 0),
    legacy_plaintext_ein: Number(row.legacy_plaintext_ein ?? 0),
    invalid_ein: Number(row.invalid_ein ?? 0),
    encrypted_owners: Number(row.encrypted_owners ?? 0),
    plaintext_owners: Number(row.plaintext_owners ?? 0),
    partial_rows: Number(row.partial_rows ?? 0),
    fully_encrypted: Number(row.fully_encrypted ?? 0),
    all_null: Number(row.all_null ?? 0),
  };
}

// ── Duplicate legacy EIN groups ───────────────────────────────────────────────
// Uses normalized legacy plaintext EIN values for grouping.
// Reports ONLY: count of duplicate groups and max group size.
// Does NOT output any EIN values, row IDs, or other identifying data.

interface DupEinReport {
  groups_with_duplicates: number;
  max_group_size: number;
  total_rows_in_dup_groups: number;
}

async function gatherDupEinGroups(): Promise<DupEinReport> {
  // Groups legacy plaintext EINs (9-digit strings) by normalized value.
  // Returns only the count of groups with >1 member and the max group size.
  const result = await db.execute(sql`
    WITH dup_groups AS (
      SELECT
        COUNT(*)::int AS group_size
      FROM merchant_applications
      WHERE ein IS NOT NULL
        AND ein NOT LIKE 'mpd_v1:%'
        AND ein ~ '^[0-9]{9}$'
      GROUP BY ein
      HAVING COUNT(*) > 1
    )
    SELECT
      COUNT(*)::int                              AS groups_with_duplicates,
      COALESCE(MAX(group_size), 0)::int          AS max_group_size,
      COALESCE(SUM(group_size), 0)::int          AS total_rows_in_dup_groups
    FROM dup_groups
  `);

  const row = (result.rows as any[])[0] ?? {};
  return {
    groups_with_duplicates: Number(row.groups_with_duplicates ?? 0),
    max_group_size: Number(row.max_group_size ?? 0),
    total_rows_in_dup_groups: Number(row.total_rows_in_dup_groups ?? 0),
  };
}

// ── Fingerprint-column stats (post-migration-0142) ───────────────────────────

async function gatherFingerprintStats(): Promise<{
  ein_fp_populated: number;
  ssn_fp_populated: number;
  account_fp_populated: number;
  protected_data_version_populated: number;
}> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ein_fingerprint IS NOT NULL)::int            AS ein_fp_populated,
      COUNT(*) FILTER (WHERE ssn_fingerprint IS NOT NULL)::int            AS ssn_fp_populated,
      COUNT(*) FILTER (WHERE bank_account_fingerprint IS NOT NULL)::int   AS account_fp_populated,
      COUNT(*) FILTER (WHERE protected_data_version IS NOT NULL)::int     AS protected_data_version_populated
    FROM merchant_applications
  `);

  const row = (result.rows as any[])[0] ?? {};
  return {
    ein_fp_populated: Number(row.ein_fp_populated ?? 0),
    ssn_fp_populated: Number(row.ssn_fp_populated ?? 0),
    account_fp_populated: Number(row.account_fp_populated ?? 0),
    protected_data_version_populated: Number(row.protected_data_version_populated ?? 0),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Merchant Protected-Data Inventory  (aggregate-only, no IDs)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log();

  // ── Step 1: Schema column safety check ─────────────────────────────────────
  console.log("── Step 1: Migration-0142 schema column check ─────────────────");
  let schemaOk = true;
  try {
    const { ok, missing } = await checkSchemaColumns();
    if (!ok) {
      schemaOk = false;
      console.error("  ✗ SCHEMA NOT DEPLOYED — migration 0142 columns are missing:");
      for (const col of missing) {
        console.error(`      missing column: ${col}`);
      }
      console.error();
      console.error("  ACTION REQUIRED:");
      console.error("    The merchant-protected-data migration (0142) must be deployed");
      console.error("    before running the backfill migration script.");
      console.error();
      console.error("    To deploy: run migrations against the target database.");
      console.error("    Migration file: migrations/0142_merchant_application_protected_data.sql");
      console.error();
      console.error("  Inventory will continue with limited reporting (no fingerprint stats).");
      console.error();
    } else {
      console.log("  ✓ All migration-0142 columns present");
    }
  } catch (err: any) {
    console.error(`  ✗ Could not check schema columns: ${safeErrorLabel(err)}`);
    schemaOk = false;
  }

  // ── Step 2: Aggregate row counts ───────────────────────────────────────────
  console.log("── Step 2: Protected-field row counts ──────────────────────────");
  let counts: InventoryCounts | null = null;
  try {
    counts = await gatherCounts();
    console.log(`  Total merchant_applications rows : ${counts.total}`);
    console.log();
    console.log("  EIN field classification:");
    console.log(`    null (no EIN provided)    : ${counts.null_ein}`);
    console.log(`    encrypted (mpd_v1: prefix): ${counts.encrypted_ein}`);
    console.log(`    legacy plaintext (9-digit): ${counts.legacy_plaintext_ein}`);
    console.log(`    invalid (other format)    : ${counts.invalid_ein}`);
    console.log();
    console.log("  additional_owners (JSONB) field classification:");
    console.log(`    encrypted (mpd_v1: string): ${counts.encrypted_owners}`);
    console.log(`    legacy plaintext (array/obj): ${counts.plaintext_owners}`);
    console.log();
    console.log("  Cross-field classification (includes additional_owners):");
    console.log(`    fully encrypted rows      : ${counts.fully_encrypted}`);
    console.log(`    partial rows (mixed state): ${counts.partial_rows}`);
    console.log(`    all-null rows             : ${counts.all_null}`);
    if (counts.partial_rows > 0) {
      console.warn();
      console.warn("  ⚠  PARTIAL ROWS DETECTED — some rows have mixed encrypted/plaintext");
      console.warn("     protected fields. These rows must be remediated before release.");
      console.warn("     Run the backfill migration script with --execute to complete them.");
    }
    if (counts.invalid_ein > 0) {
      console.warn();
      console.warn("  ⚠  INVALID EIN FORMAT ROWS — some rows have an EIN value that is");
      console.warn("     neither null, an mpd_v1 envelope, nor a 9-digit plaintext string.");
      console.warn("     Investigate these rows before running the backfill migration.");
    }
  } catch (err: any) {
    console.error(`  ✗ Could not query row counts: ${safeErrorLabel(err)}`);
  }

  // ── Step 3: Duplicate legacy EIN groups ────────────────────────────────────
  console.log("── Step 3: Duplicate legacy EIN groups (aggregate only) ────────");
  try {
    const dups = await gatherDupEinGroups();
    if (dups.groups_with_duplicates === 0) {
      console.log("  ✓ No duplicate legacy EIN groups found");
    } else {
      console.warn(`  ⚠  Duplicate legacy EIN groups : ${dups.groups_with_duplicates}`);
      console.warn(`     Max group size               : ${dups.max_group_size}`);
      console.warn(`     Total rows in dup groups     : ${dups.total_rows_in_dup_groups}`);
      console.warn();
      console.warn("  NOTE: EIN values and row IDs are NOT reported here (aggregate only).");
      console.warn("  Duplicate groups must be reviewed by an authorized operator before");
      console.warn("  the backfill migration assigns fingerprints — duplicates cause the");
      console.warn("  dedup index to collide.");
    }
  } catch (err: any) {
    console.error(`  ✗ Could not query duplicate EIN groups: ${safeErrorLabel(err)}`);
  }

  // ── Step 4: Fingerprint column stats (only when schema is deployed) ─────────
  if (schemaOk) {
    console.log("── Step 4: Fingerprint/metadata column population ──────────────");
    try {
      const fps = await gatherFingerprintStats();
      console.log(`  ein_fingerprint populated         : ${fps.ein_fp_populated}`);
      console.log(`  ssn_fingerprint populated         : ${fps.ssn_fp_populated}`);
      console.log(`  bank_account_fingerprint populated: ${fps.account_fp_populated}`);
      console.log(`  protected_data_version populated  : ${fps.protected_data_version_populated}`);

      if (counts && fps.ein_fp_populated < counts.encrypted_ein) {
        const missing = counts.encrypted_ein - fps.ein_fp_populated;
        console.warn();
        console.warn(`  ⚠  ${missing} rows have encrypted EIN but no ein_fingerprint.`);
        console.warn("     These rows need backfill to populate the fingerprint columns.");
      }
    } catch (err: any) {
      console.error(`  ✗ Could not query fingerprint stats: ${safeErrorLabel(err)}`);
    }
  } else {
    console.log("── Step 4: Skipped — migration-0142 columns not yet deployed ────");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Inventory complete.  No row IDs or values were output.");
  console.log("═══════════════════════════════════════════════════════════════");

  const needsMigration =
    (counts?.legacy_plaintext_ein ?? 0) > 0 ||
    (counts?.partial_rows ?? 0) > 0 ||
    (counts?.invalid_ein ?? 0) > 0;

  if (needsMigration) {
    console.log();
    console.log("  → Migration is needed. Run the backfill script:");
    console.log("    npx tsx scripts/migrate-merchant-protected-data.ts");
    console.log("    (default: inventory-only; add --execute to perform writes)");
    process.exit(0); // inventory is informational; caller decides what to do
  } else if (!schemaOk) {
    process.exit(1); // schema not deployed — caller should fail
  } else {
    console.log();
    console.log("  ✓ All protected rows are either encrypted or null.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`Inventory script crashed: ${safeErrorLabel(err)}`);
  process.exit(2);
});
