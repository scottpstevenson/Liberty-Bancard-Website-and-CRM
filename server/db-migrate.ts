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
 *
 * Guarded Phase 3 migration (0054):
 *   Migration 0054 (tasks_sla_stalling_active_unique partial unique index) is NOT in
 *   the Drizzle journal. It is applied by applyPhase3IndexIfReady() ONLY after verifying
 *   zero active+incomplete SLA task conflicts exist. If conflicts remain (Phase 2 backfill
 *   not yet run), the migration is deferred with a startup warning and the SLA worker
 *   continues on its pre-Phase-4 path. This enforces the deployment order requirement:
 *     Phase 1 (0053) → Phase 2 (backfill) → Phase 3 (0054) → Phase 4 (ON CONFLICT).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "./db";

const db = drizzle(pool);

const MIGRATIONS_FOLDER = path.join(process.cwd(), "migrations");
// Guarded migrations are SQL files intentionally kept outside the Drizzle journal
// because they have runtime precondition checks. drizzle-kit does not scan
// subdirectories, so files here are invisible to automatic migration generation.
const GUARDED_MIGRATIONS_FOLDER = path.join(MIGRATIONS_FOLDER, "guarded");

const DRIZZLE_SCHEMA = "drizzle";
const DRIZZLE_TABLE = "__drizzle_migrations";

/**
 * The maximum `when` value among all journal entries that already exist in the
 * database (i.e., all entries except `0014_startup_sql_consolidation`).
 * The consolidation migration's `when` = BASELINE_WHEN + 1 in the journal.
 */
const BASELINE_WHEN = 1777739833710;

// Synthetic `when` value used to record 0054 in drizzle_migrations when we
// apply it manually. Must be higher than 0053's `when` (1784600000000).
const PHASE3_INDEX_WHEN = 1784700000000;

const PHASE3_INDEX_TAG = "0054_sla_task_stalling_unique_index";
const PHASE3_INDEX_NAME = "tasks_sla_stalling_active_unique";

function computeMigrationHash(tag: string): string | null {
  // Check the guarded subfolder first (for intentionally-gated migrations like 0054).
  const guardedPath = path.join(GUARDED_MIGRATIONS_FOLDER, `${tag}.sql`);
  const filePath = fs.existsSync(guardedPath)
    ? guardedPath
    : path.join(MIGRATIONS_FOLDER, `${tag}.sql`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Guarded Phase 3 migration: apply the partial unique index on tasks only when
 * Phase 2 backfill preconditions are verified (zero active+incomplete SLA conflicts).
 *
 * Precondition check (KILL LINE):
 *   SELECT deal_id, COUNT(*) FROM tasks
 *   WHERE source='sla' AND automation_key='stalling-deal-follow-up'
 *     AND deleted_at IS NULL AND completed_at IS NULL AND deal_id IS NOT NULL
 *   GROUP BY deal_id HAVING COUNT(*) > 1
 *   must return zero rows before 0054 is applied.
 *
 * Behaviour:
 *   - Index already present → logs confirmation, no-op.
 *   - Not present, zero conflicts → applies 0054 SQL, records hash in drizzle_migrations.
 *   - Not present, conflicts remain → logs STARTUP WARNING, defers; SLA worker stays
 *     on pre-Phase-4 path (isPhase3IndexPresent() returns false).
 */
async function applyPhase3IndexIfReady(): Promise<void> {
  const client = await connectWithRetry() as any;
  try {
    // 1. Check if the index already exists (idempotent).
    const { rows: indexRows } = await client.query(`
      SELECT 1 AS exists FROM pg_indexes
      WHERE indexname = $1 LIMIT 1
    `, [PHASE3_INDEX_NAME]);

    if (indexRows.length > 0) {
      console.log(`[DB Migrate] Phase 3 index '${PHASE3_INDEX_NAME}' already present.`);
      return;
    }

    // 2. Check precondition: zero active+incomplete SLA stalling conflicts.
    const { rows: conflictRows } = await client.query(`
      SELECT deal_id, COUNT(*) AS cnt
      FROM tasks
      WHERE source = 'sla'
        AND automation_key = 'stalling-deal-follow-up'
        AND deleted_at IS NULL
        AND completed_at IS NULL
        AND deal_id IS NOT NULL
      GROUP BY deal_id
      HAVING COUNT(*) > 1
    `);

    if (conflictRows.length > 0) {
      // KILL LINE: do not apply 0054 while conflicts exist.
      console.warn(
        `[DB Migrate] PHASE 3 DEFERRED: ${conflictRows.length} deal(s) have multiple active+incomplete SLA stalling tasks. ` +
        `Migration 0054 (${PHASE3_INDEX_NAME}) will NOT be applied until conflicts are resolved. ` +
        `Run: npx tsx scripts/backfill-sla-task-identity.ts — then restart the application.`
      );
      console.warn(`[DB Migrate] Conflicting deal_id(s): ${conflictRows.map((r: any) => r.deal_id).join(", ")}`);
      return;
    }

    // Also check for legacy unclean rows (unstamped SLA tasks that would violate the index).
    const { rows: legacyRows } = await client.query(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE title ~ '^Follow up on stalling Deal #[0-9]+$'
        AND source IS NULL
        AND deleted_at IS NULL
        AND completed_at IS NULL
    `);
    const legacyCount = parseInt(legacyRows[0]?.cnt ?? "0", 10);
    if (legacyCount > 0) {
      console.warn(
        `[DB Migrate] PHASE 3 DEFERRED: ${legacyCount} legacy SLA task(s) lack source/automation_key stamps. ` +
        `Run: npx tsx scripts/backfill-sla-task-identity.ts — then restart.`
      );
      return;
    }

    // 3. Precondition met: apply 0054 SQL directly (file lives in guarded/ subfolder).
    const sqlPath = path.join(GUARDED_MIGRATIONS_FOLDER, `${PHASE3_INDEX_TAG}.sql`);
    if (!fs.existsSync(sqlPath)) {
      console.error(`[DB Migrate] PHASE 3 ERROR: SQL file not found at ${sqlPath}`);
      return;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log(`[DB Migrate] Phase 3 preconditions verified (0 conflicts, 0 legacy rows). Applying ${PHASE3_INDEX_TAG}...`);
    await client.query(sql);

    // 4. Record the hash in drizzle_migrations so the migrator treats it as applied.
    const hash = computeMigrationHash(PHASE3_INDEX_TAG);
    if (hash) {
      await client.query(
        `INSERT INTO "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (hash, created_at) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [hash, PHASE3_INDEX_WHEN]
      );
    }

    console.log(`[DB Migrate] Phase 3 index '${PHASE3_INDEX_NAME}' applied successfully. SLA worker will use conflict-safe ON CONFLICT path.`);
  } finally {
    client.release();
  }
}

/**
 * Attempt pool.connect() up to maxAttempts times, sleeping retryDelayMs between
 * tries. ETIMEDOUT / ECONNRESET / ECONNREFUSED are treated as transient — common
 * on Neon serverless where the first connection after an idle period can time out.
 */
async function connectWithRetry(
  maxAttempts = 4,
  retryDelayMs = 5000,
): Promise<any> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await pool.connect();
    } catch (err: any) {
      lastErr = err as Error;
      const msg: string = (err?.message ?? "").toLowerCase();
      const isTransient =
        msg.includes("etimedout") ||
        msg.includes("econnreset") ||
        msg.includes("econnrefused") ||
        msg.includes("connection terminated") ||
        msg.includes("timeout");
      if (!isTransient || attempt === maxAttempts) throw err;
      console.warn(
        `[DB Migrate] pool.connect() transient error on attempt ${attempt}/${maxAttempts}: ${err.message}. ` +
        `Retrying in ${retryDelayMs / 1000}s…`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastErr;
}

export async function runDrizzleMigrations(): Promise<void> {
  const client = await connectWithRetry();
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
    const { rows: contactsCheck } = await client.query(`
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
      const { rows: existing } = await client.query(
        `SELECT hash FROM "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}"`
      );
      const existingHashes = new Set(existing.map((r: any) => r.hash));

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
      const { rows: latestRow } = await client.query(
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

  // Apply all journal-registered migrations (0000–0053).
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[DB Migrate] All Drizzle journal migrations up to date.");

  // Apply Phase 3 (0054) only after verifying Phase 2 backfill preconditions.
  // This call is a no-op if the index already exists or if conflicts remain.
  await applyPhase3IndexIfReady();

  // Seed the AI assistant knowledge base (idempotent — skips if data exists).
  try {
    const { seedKnowledgeBase } = await import("./services/knowledge-seed");
    await seedKnowledgeBase();
  } catch (e: any) {
    // Non-fatal — assistant still works with keyword fallback
    console.warn("[DB Migrate] Knowledge base seed skipped:", e.message);
  }
}
