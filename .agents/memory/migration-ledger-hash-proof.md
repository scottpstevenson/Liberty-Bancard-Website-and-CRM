---
name: Migration ledger hash-only proof
description: Why row-count/position checks against drizzle.__drizzle_migrations are unsound, and what the correct proof looks like.
---

This repo's migrator (server/db-migrate.ts) baselines a consolidated snapshot migration and records some guarded migrations' hashes directly into `drizzle.__drizzle_migrations` without ever adding a `migrations/meta/_journal.json` entry (see scripts/check-migration-integrity.ts for the full baselining/guarded rules). That means:

- The ledger's row count does not correspond to the journal's entry count or position.
- "applied row count >= N" is not proof that any *specific* migration (e.g. a release's expected head) was applied — unrelated, duplicate, baseline, or manually recorded rows can satisfy any count threshold while the actual required migration is absent.

**Why:** A code-review rejection on Task 1738 (CRO-03D) caught this exact flaw: an operator preflight tool used journal-position vs. applied-count as an "unsound" proof that a specific migration head had landed.

**How to apply:** To prove a specific migration is applied, compute the migrator's own hash algorithm — `sha256(fileContentsAsUtf8)` of the migration's `.sql` file (checking `migrations/guarded/<tag>.sql` first, falling back to `migrations/<tag>.sql`, exactly as `computeMigrationHash()` in server/db-migrate.ts does) — and check for that exact hash as a row in `drizzle.__drizzle_migrations`. Nothing else (row count, journal position, "newer than") is a sound substitute.
