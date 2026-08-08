---
name: Migration statement timeout bypass
description: Why migrate() must use a dedicated pg.Client, not the shared pool, in this project
---

# Migration statement timeout bypass

## The rule
`runDrizzleMigrations()` in `server/db-migrate.ts` MUST call `migrate()` on a `drizzle(pgClient)` instance — NOT `drizzle(pool)`.

## Why
`server/db.ts` registers `pool.on("connect", client => client.query("SET statement_timeout = 30000"))`. Every connection acquired from the pool inherits a 30-second wall-clock limit. Drizzle's `migrate()` runs each migration inside a transaction using pool connections, so DDL operations (CREATE INDEX on the 154K-row contacts table) time out with PostgreSQL error 57014 "canceling statement due to statement timeout" — crashing the server before it can serve the health probe and failing every Cloud Run promote step.

## How to apply
Before calling `migrate(migrationDb, { migrationsFolder })`:
1. Create a `new PgClient({ connectionString: process.env.DATABASE_URL })`
2. `await client.connect()`
3. `await client.query("SET statement_timeout = 0")`
4. `const migrationDb = drizzle(client)`
5. `await migrate(migrationDb, ...)`
6. `await client.end()` in a finally block

This bypasses the pool's `on("connect")` handler entirely.

The fix is already in place in `server/db-migrate.ts`. Do not replace it with `migrate(db, ...)` where `db = drizzle(pool)`.
