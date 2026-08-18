---
name: Drizzle execute timestamp strings
description: db/tx.execute(sql``) returns timestamptz as raw strings while pg Pool returns Date objects; audit_logs is append-only.
---

- `db.execute()` / `tx.execute(sql\`... RETURNING *\`)` (drizzle node-postgres) returns timestamptz columns as **strings** ("2026-09-01 00:00:00+00"), while a direct `pool.query()` returns JS `Date` objects.
- **Why:** comparing rows from the two paths with `String(a) === String(b)` flaps even when values are identical.
- **How to apply:** normalize with `new Date(v).getTime()` before comparing timestamps across drizzle-execute and pg-pool results.

Also: `audit_logs` has a `audit_logs_append_only()` trigger — UPDATE/DELETE raise P0001. Tests must never plan to clean up audit rows; instead leave referenced entities in a "resolved"/benign state and reuse a persistent marker test row across runs.
