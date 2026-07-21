---
name: Drizzle-kit orphaned file deploy hang
description: SQL files in migrations/ root without journal entries cause drizzle-kit generate to hang; use migrations/guarded/ for intentionally-gated migrations.
---

# Drizzle-kit Orphaned File Deploy Hang

## The rule
Every `.sql` file in the `migrations/` root MUST have a matching entry in `migrations/meta/_journal.json`. Orphaned files (present on disk, absent from journal) cause Replit's provision-step `drizzle-kit generate` to hang indefinitely.

**Why:** drizzle-kit scans the root of the `out` directory for `.sql` files, then cross-references `_journal.json`. When it finds files not in the journal it cannot determine migration state and enters an irreconcilable comparison loop.

**How to apply:** Any time a raw SQL migration file is created manually (not via `drizzle-kit generate`), immediately add it to `_journal.json` with a `when` value above the current maximum. Use `scripts/check-migration-integrity.ts` as a preflight gate before publishing.

## Intentionally-gated migrations
Migrations with runtime precondition checks (e.g. `0054_sla_task_stalling_unique_index` which requires Phase 2 backfill before applying) must NOT be in the journal AND must NOT be in the `migrations/` root. Place them in `migrations/guarded/` instead.

- drizzle-kit only scans the root of `out`, not subdirectories (the existing `meta/` subdirectory demonstrates this — drizzle-kit reads `meta/_journal.json` but ignores any `.sql` files in subdirectories).
- `server/db-migrate.ts` uses `GUARDED_MIGRATIONS_FOLDER = path.join(MIGRATIONS_FOLDER, "guarded")` to load these files.
- `computeMigrationHash(tag)` checks `guarded/` first before falling back to the root.
- `KNOWN_GUARDED_TAGS` in `scripts/check-migration-integrity.ts` must list every file in `migrations/guarded/`.

## Preflight script
`scripts/check-migration-integrity.ts` — run before any publish. Enforces all five rules and exits 1 with clear messages if violated. The 3 historical out-of-order `when` timestamps (idx 6, 16, 25) produce WARNs not FAILs because the app's baseline strategy handles them; drizzle-kit mis-orders are accepted as historical debt.
