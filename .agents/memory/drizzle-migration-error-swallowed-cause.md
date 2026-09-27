---
name: Drizzle migration errors swallow the real Postgres cause
description: scripts/migrate.ts and server/db-migrate.ts only logged err.message, which drizzle-orm sets to "Failed query: <sql text>" — the actual Postgres error lives on err.cause and was invisible in deploy logs.
---

drizzle-orm's node-postgres migrator wraps every failed statement in a `DrizzleQueryError` whose own `.message` is just `"Failed query: <sql text>"`. The real Postgres failure (code, detail, hint, position, constraint) lives on `.cause` and was previously dropped by catch blocks that only logged `err.message`.

**Why:** A production publish's promote step failed at `npm run db:migrate` on migration 0301 (a SFP release). The deployment log dumped the offending SQL text five times (once per autoscale restart) but never the actual Postgres error, so the true cause could not be determined even with full log access, `getDeploymentBuild()`, and a from-scratch local reproduction of the exact same schema state (which succeeded cleanly, meaning the failure was likely transient/environmental — e.g. a Neon connection hiccup — not a real SQL defect).

**How to apply:** `server/db-migrate.ts` exports `logUnderlyingDbError(error)`, which prints `error.cause`'s message plus code/detail/hint/position/table/column/constraint fields. Both `scripts/migrate.ts` and `server/db-migrate.ts`'s catch blocks now call it. Any future migration failure will show the real Postgres reason in the deployment log, not just the query text.
