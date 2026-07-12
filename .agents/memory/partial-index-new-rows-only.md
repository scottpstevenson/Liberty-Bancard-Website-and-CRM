---
name: Partial index scope for zero-migration uniqueness
description: Scope a new UNIQUE index to a discriminator column that is NULL in all existing rows, so the index builds instantly without any dedup or FK surgery.
---

## The Rule
When you need a DB-level uniqueness constraint on a column that may have duplicates in existing data, scope the index to `WHERE <discriminator_col> IS NOT NULL` using a column that was added in a *prior* migration and defaults to NULL. All pre-existing rows have NULL in that column and are excluded from the index. Only new rows written after the current migration are covered.

## Why
- Adding `CREATE UNIQUE INDEX ON table (col)` against a large table with existing duplicates requires: (a) a full table dedup DELETE, (b) FK re-pointing across all referencing tables, and (c) `CREATE UNIQUE INDEX`. Steps (a)+(b) can timeout on tables with millions of FK referencing rows.
- Scoping to `WHERE new_col IS NOT NULL` means 0 existing rows match the condition → the index is built against an empty set and completes instantly.
- New imports written through the new code path set `new_col` to a non-NULL value, so they ARE covered by the backstop.

## How to Apply
1. Identify a column added in a recent prior migration (so existing rows are all NULL).
2. Write the migration as:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS my_unique_idx
     ON my_table (email)
     WHERE email IS NOT NULL AND new_discriminator_col IS NOT NULL;
   ```
3. In `shared/schema.ts` reflect the index:
   ```ts
   uniqueIndex("my_unique_idx")
     .on(table.email)
     .where(sql`email IS NOT NULL AND new_discriminator_col IS NOT NULL`)
   ```
4. In `INSERT` code, use `ON CONFLICT DO NOTHING` (no target) — Postgres checks all constraints including this partial index.

## Applied In
Migration 0064: `prospects_email_import_unique_idx` scoped to `import_execution_id IS NOT NULL` (column added in migration 0062). Zero existing rows matched; index built in <1 second on a 10,881-row table.
