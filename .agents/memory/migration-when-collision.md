---
name: Migration timestamp vs PHASE3_INDEX_WHEN collision
description: New Drizzle journal entries must have a `when` value strictly above PHASE3_INDEX_WHEN or migrate() silently skips them.
---

# Migration journal `when` must exceed PHASE3_INDEX_WHEN

## The rule
Any new migration added to `migrations/meta/_journal.json` must have a `when` value **strictly greater than** `PHASE3_INDEX_WHEN = 1784700000000` (defined in `server/db-migrate.ts`).

Use `1784800000000` for the next migration, then increment by `100000000` per subsequent migration.

## Why
`server/db-migrate.ts` applies migration 0054 manually (not via Drizzle journal) and records its hash in `drizzle.__drizzle_migrations` with `created_at = PHASE3_INDEX_WHEN = 1784700000000`.

Drizzle's `migrate()` function uses the `created_at` high-water mark: it only applies a migration if `migration.folderMillis > lastApplied.created_at`. Since `1784700000000 > 1784700000000` is FALSE, any journal entry with `when = 1784700000000` is silently skipped — the runner says "All Drizzle journal migrations up to date" even though the migration never ran.

## How to apply
When writing a new migration:
1. Set `when` in `_journal.json` to the previous highest `when` + 100000000, **always checking it exceeds 1784700000000**.
2. If the column already got applied before the journal was fixed (e.g., via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), still record the migration hash manually:
   ```js
   const hash = crypto.createHash('sha256').update(fs.readFileSync('migrations/NNNN_xxx.sql', 'utf8')).digest('hex');
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($hash, $when) ON CONFLICT DO NOTHING;
   ```
3. The Drizzle hash is computed from raw file content (no normalization). Use Node's `crypto.createHash('sha256').update(content).digest('hex')`.

## Symptom to watch for
- `[DB Migrate] All Drizzle journal migrations up to date.` in startup logs
- But `column "new_col" does not exist` errors appear immediately from BullMQ workers
- Direct `pg.Client` query confirms column IS in the DB (already applied via IF NOT EXISTS)
- This combination means the journal `when` collided with PHASE3_INDEX_WHEN
