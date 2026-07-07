---
name: Drizzle out-of-order journal when timestamp
description: Drizzle migrator silently skips journal entries whose `when` timestamp is below the current high-water mark in drizzle.__drizzle_migrations
---

## Rule
Drizzle's `migrate()` applies a journal entry only if `entry.when > lastApplied.created_at`.
If a new migration file is added with a `when` value that is lower than any already-applied
migration, it will be permanently skipped — and `migrate.ts` will still report "All migrations
up to date."

**Why:** Migration 0047_contacts_opted_out_email was created with `when: 1751896200000`
(a stale epoch), while 0046 had `when: 1783400000000`. Every migrate.ts run silently skipped
0047 because it was below the high-water mark.

**How to fix:**
1. Apply the SQL directly: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` (idempotent).
2. Fix the journal `when` to be above all existing entries:
   `migrations/meta/_journal.json` → set `when` to e.g. `previousMax + 50000000`
3. Insert the migration's SHA-256 hash into `drizzle.__drizzle_migrations` with the corrected
   `created_at` value so future runs don't re-execute it:
   ```sql
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('<sha256 of .sql file>', <corrected_when>)
   ON CONFLICT DO NOTHING;
   ```
4. Verify with `npx tsx scripts/migrate.ts` → "All migrations up to date".

**How to apply:** Any time a migration is added manually (not via `drizzle-kit generate`),
double-check that its `when` value in `_journal.json` is strictly greater than all existing
entries. The canonical safe value is `Date.now()` at the moment of writing.
