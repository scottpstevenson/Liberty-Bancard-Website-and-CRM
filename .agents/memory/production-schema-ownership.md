---
name: Production schema ownership
description: Why production application startup must not execute the development Drizzle migration journal on Replit.
---

Replit Publish is the sole owner of production schema reconciliation. Application startup must skip Drizzle migrations when `NODE_ENV=production`; development and disposable tests may continue applying the migration journal.

**Why:** Publish can provision development tables in production without advancing the application's `drizzle.__drizzle_migrations` journal. Replaying that older journal during container startup then collides with already-provisioned relations and prevents the readiness probe from succeeding.

**How to apply:** Put the environment gate at the application entrypoint before invoking the migration runner. Keep schema changes in development sources, validate them there, and let Publish apply the development-to-production diff.

**Corollary — Publish diffs `shared/schema.ts`, not `migrations/*.sql`:** writing a new, correct, idempotent migration file does **not** get it applied to production. Publish introspects live production and diffs it against `shared/schema.ts`; it never executes files under `migrations/`. If a schema element (e.g. a CHECK constraint) exists only in a raw migration file and isn't declared in `shared/schema.ts` (via `check()`, etc.), Publish's diff has nothing to compare it against and will never generate DDL for it — no matter how many times you publish. Confirmed on this project: two CHECK constraints existed in migration files (0240, 0250) and were live in development, but were never declared in `schema.ts`, so repeated publishes never pushed them to production. Fix: declare the constraint in `schema.ts` to match what the migration already established in dev, then publish — don't write another migration file expecting it to run.