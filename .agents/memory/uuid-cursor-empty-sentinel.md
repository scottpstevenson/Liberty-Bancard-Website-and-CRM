---
name: uuid cursor empty-string sentinel bug
description: Cursor/pagination code using '' as a uuid sentinel crashes on empty tables
---
A cursor-based pagination pattern computed a high-water mark via
`SELECT COALESCE(MAX(id::text),'') AS high_water` for a uuid-keyed table, then used that value
(possibly `''`) directly in a `gt(col, value)` / `lte(col, value)` comparison against the uuid
column.

**Why:** Postgres has no implicit cast from `''` to `uuid` — comparing a uuid column against the
empty-string literal throws `invalid input syntax for type uuid`, not "zero rows returned" the
way the equivalent numeric-cursor code path behaves (numeric `0` is a valid comparison value, so
the numeric-cursor sibling code has no equivalent bug). This is easy to miss because the numeric
and uuid cursor code paths look symmetric but are not.

**How to apply:** when a cursor/pagination helper is genericized across integer- and uuid-keyed
tables, treat the uuid branch specially: skip the range query entirely when the high-water
sentinel is empty (table had zero rows at snapshot time), and omit the lower-bound clause
entirely (rather than comparing against '') when the cursor hasn't started scanning yet.
