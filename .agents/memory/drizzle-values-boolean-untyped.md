---
name: Drizzle raw VALUES boolean columns return as text
description: db.execute(sql`... VALUES (...)`) boolean columns can come back as the strings "true"/"false" instead of JS booleans, and Boolean("false") is truthy — a classic silent test-script bug.
---

When building an ad hoc `VALUES (...)` table via `db.execute(sql\`...\`)` (e.g. to batch-test many cases against a live SQL predicate), an untyped or loosely-typed boolean literal parameter can come back from node-postgres as the string `"true"`/`"false"` rather than a JS boolean, depending on how Postgres infers the column type across the VALUES rows.

**Why:** `Boolean(x)` treats any non-empty string — including the string `"false"` — as `true`. A comparison written as `Boolean(row.expected) === Boolean(row.sql_result)` will silently report every "false" row as truthy, making a broken test look like it fails uniformly on one side (e.g. every expected-false case reports as expected-true) even though the underlying SQL predicate is correct.

**How to apply:** When comparing a JS boolean literal against a raw-SQL-returned value in a Node test/debug script:
1. Explicitly cast the literal in the VALUES row itself, e.g. `sql\`(${val}::text, ${expected}::boolean)\`` — do NOT try to type it via the outer `AS v(col, col2 boolean)` alias list; Postgres VALUES/table aliases only accept column names, not types, causing a syntax error.
2. Still don't trust `Boolean(x)` on the result — compare defensively against `x === true || x === "t" || x === "true"` in case the driver still returns text.
3. When a batch parity test reports 100% of one expected-value group failing (all-false or all-true), suspect this coercion bug in the harness before assuming the SQL logic itself is wrong.
