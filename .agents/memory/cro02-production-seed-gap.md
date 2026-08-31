---
name: CRO-02 production seed-row gap
description: Publish-managed tables can be missing Drizzle-seeded rows in production; how to repair without replaying migrations.
---

Replit Publish provisions the production schema via schema synchronization,
not by running the app's Drizzle migration runner. A migration that seeds
canonical rows as part of its `CREATE TABLE`/`INSERT` (e.g.
`commercial_purpose_policies` in the CRO-02 purpose-policy work) only
guarantees those rows in the dev path where `migrate()` actually executes
that SQL. Production can end up with the table shape but without the seeded
rows.

**Why:** production schema ownership belongs to Replit Publish (see
`production-schema-ownership.md`); the app must never replay Drizzle
migrations against a published production database. That means any
migration-time seed data needs a separate, idempotent convergence path that
runs at app startup instead of relying on the migration having executed.

**How to apply:** when a migration seeds fixed canonical rows, pair it with
an insert-only, fingerprint-guarded startup initializer (see
`server/services/cro02-purpose-policy-initializer.ts` for the reference
implementation) that:
- verifies the table's expected column shape and fails closed on mismatch
  rather than trying to reconcile schema itself,
- inserts only rows that are missing, matched by identity/fingerprint,
- never updates, deletes, or mutates an existing row, and
- produces no side effect beyond the insert (no mode switches, no
  commercial/outreach/campaign effects).

This pattern generalizes to any future migration that seeds rows into a
Publish-managed table: don't assume the migration ran in production; add a
convergence initializer instead of a repair migration.
