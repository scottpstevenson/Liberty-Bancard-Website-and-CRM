---
name: Drizzle partial-index ON CONFLICT
description: onConflictDoNothing({ targetWhere }) does not emit the WHERE clause for partial unique indexes in PostgreSQL. Use raw SQL instead.
---

## Rule
Do NOT use `db.insert(...).onConflictDoNothing({ target: [...], targetWhere: sql\`...\` })` when targeting a partial unique index. Drizzle silently omits the WHERE clause, causing PostgreSQL to throw "there is no unique or exclusion constraint matching the ON CONFLICT specification".

## What to use instead
Use `db.execute(sql\`INSERT ... ON CONFLICT (col1, col2) WHERE <partial-predicate> DO NOTHING RETURNING *\`)` with explicit raw SQL.

```ts
const result = await db.execute(sql`
  INSERT INTO tasks (deal_id, ..., source, automation_key)
  VALUES (${dealId}, ..., 'sla', 'stalling-deal-follow-up')
  ON CONFLICT (deal_id, automation_key)
  WHERE deleted_at IS NULL
    AND completed_at IS NULL
    AND deal_id IS NOT NULL
    AND source = 'sla'
    AND automation_key = 'stalling-deal-follow-up'
  DO NOTHING
  RETURNING *
`);
const rows = (result as any).rows ?? result;
const task = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
```

**Why:** Drizzle's ORM builder does not support partial index conflict targets. The `targetWhere` option exists in the type signature but does not generate correct SQL for PostgreSQL partial indexes.

**How to apply:** Whenever you need `ON CONFLICT (cols) WHERE predicate DO NOTHING` against a partial unique index, bypass Drizzle's builder and use raw SQL via `db.execute(sql\`...\`)`. Parse the returned `rows` field from the result.
