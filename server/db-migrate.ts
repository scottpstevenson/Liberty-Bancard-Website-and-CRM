/**
 * db-migrate.ts
 *
 * Drizzle-kit native migration runner with baseline support for existing databases.
 *
 * How the drizzle migrator works:
 *   It reads the most recent row from `drizzle.__drizzle_migrations` (by created_at DESC).
 *   For each migration in the journal, it applies the migration only if
 *   `migration.folderMillis > lastApplied.created_at`.
 *
 * Baseline strategy (for databases that pre-date the drizzle migration system):
 *   All journal entries with `when <= BASELINE_WHEN` represent migrations that were
 *   already applied to the database via the old raw-SQL startup runner. We insert
 *   their SHA-256 hashes into `drizzle.__drizzle_migrations` so the migrator treats
 *   them as already applied.
 *
 *   The highest `when` value among pre-existing migrations is BASELINE_WHEN
 *   (1777739833710, from journal entry 0005_shallow_stepford_cuckoos). The
 *   consolidation migration `0014_startup_sql_consolidation` has `when =
 *   BASELINE_WHEN + 1` so it is the only migration that runs on an existing DB.
 *
 *   The consolidation migration itself uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 *   throughout, including coverage for `user_sessions` and `ai_audit_logs` extensions
 *   from journal entries 0012_user_sessions and 0013_ai_audit_observability, so schema
 *   convergence is guaranteed regardless of which individual pre-drizzle migrations
 *   were applied.
 *
 *   On a fresh database (no contacts table), all migrations run in order — no
 *   baselining occurs.
 *
 *   On subsequent runs after the baseline is established, no new rows are inserted
 *   and the migrator finds `lastApplied.created_at >= BASELINE_WHEN`, so nothing runs
 *   until a genuinely new migration file is added to the journal.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "./db";

const db = drizzle(pool);

const MIGRATIONS_FOLDER = path.join(process.cwd(), "migrations");

const DRIZZLE_SCHEMA = "drizzle";
const DRIZZLE_TABLE = "__drizzle_migrations";

/**
 * The maximum `when` value among all journal entries that already exist in the
 * database (i.e., all entries except `0014_startup_sql_consolidation`).
 * The consolidation migration's `when` = BASELINE_WHEN + 1 in the journal.
 */
const BASELINE_WHEN = 1777739833710;

function computeMigrationHash(tag: string): string | null {
  const filePath = path.join(MIGRATIONS_FOLDER, `${tag}.sql`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function runDrizzleMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the drizzle schema and migrations tracking table exist.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${DRIZZLE_SCHEMA}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);

    // Check if this is an existing database that predates the drizzle migration system.
    const { rows: contactsCheck } = await client.query<{ exists: string | null }>(`
      SELECT to_regclass('public.contacts') AS exists
    `);
    const isExistingDatabase = !!contactsCheck[0]?.exists;

    if (isExistingDatabase) {
      // Read the journal and baseline all entries with when <= BASELINE_WHEN.
      // These represent migrations applied by the old raw-SQL runner — we record
      // their hashes so the drizzle migrator treats them as already applied.
      const journalPath = path.join(MIGRATIONS_FOLDER, "meta/_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
        entries: Array<{ idx: number; tag: string; when: number }>;
      };

      const entriesToBaseline = journal.entries.filter(e => e.when <= BASELINE_WHEN);

      // Fetch all hashes already recorded so we can skip duplicates.
      const { rows: existing } = await client.query<{ hash: string }>(
        `SELECT hash FROM "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}"`
      );
      const existingHashes = new Set(existing.map(r => r.hash));

      let inserted = 0;
      for (const entry of entriesToBaseline) {
        const hash = computeMigrationHash(entry.tag);
        if (!hash || existingHashes.has(hash)) continue;

        await client.query(
          `INSERT INTO "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when]
        );
        existingHashes.add(hash);
        inserted++;
      }

      if (inserted > 0) {
        console.log(`[DB Migrate] Baselined ${inserted} pre-existing migration(s) — only new migrations will be applied.`);
      }

      // Safety net: ensure the high-water mark is at BASELINE_WHEN so migrations
      // 0000–0005 (which have timestamps larger than 0006–0013) cannot slip through.
      const { rows: latestRow } = await client.query<{ created_at: string }>(
        `SELECT created_at FROM "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" ORDER BY created_at DESC LIMIT 1`
      );
      const latestWhen = latestRow[0]?.created_at ? Number(latestRow[0].created_at) : 0;

      if (latestWhen < BASELINE_WHEN) {
        // This happens when entriesToBaseline doesn't include an entry at BASELINE_WHEN
        // (e.g., the 0005 file is missing). Insert a synthetic sentinel so the migrator
        // does not attempt to apply any pre-consolidation migration.
        await client.query(
          `INSERT INTO "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (hash, created_at) VALUES ($1, $2)`,
          [`baseline-sentinel-${BASELINE_WHEN}`, BASELINE_WHEN]
        );
        console.log(`[DB Migrate] Inserted baseline sentinel at ${BASELINE_WHEN}.`);
      }
    }
  } finally {
    client.release();
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[DB Migrate] All migrations up to date.");
}
