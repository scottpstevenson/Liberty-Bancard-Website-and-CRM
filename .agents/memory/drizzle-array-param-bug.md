---
name: drizzle-orm array parameter bug
description: ${jsArray}::type[] inside ANY(...) silently breaks with drizzle-orm's node-postgres driver — how to detect it and the working fix.
---

## The bug

drizzle-orm's node-postgres driver does NOT serialize an interpolated JS array
as a Postgres array literal when you write `sql`ANY(${arr}::text[])``. Instead
it renders a parenthesized tuple of scalar bound parameters:

- 2+ elements: `ANY(($1, $2)::text[])` → throws `malformed array literal` at
  runtime (visible, at least it fails loudly).
- 1 element: `ANY(($1)::text[])` with `params: <scalar>` → binds a plain
  scalar, not an array — this can silently produce wrong results depending on
  what Postgres does with the cast, so it does not always throw.
- 0 elements (empty array): drizzle renders a bare `()` literal with no bound
  parameter at all — invalid syntax inside `::type[]`, throws a syntax error
  even when the containing boolean expression would have short-circuited it
  away at runtime (SQL parses the whole statement before evaluating).

**Why:** confirmed by direct reproduction (`sql`SELECT ${['a']}::text[]``` and
`sql`SELECT ${['a','b']}::text[]``` both threw `malformed array literal`).
This is despite an existing pattern already in the codebase
(`server/services/field-sales-rollback.ts`,
`server/services/sales-rep-ops-readiness.ts`,
`server/services/revenue-read-authority.ts`) that uses exactly this
`${arr}::type[]` form with `ANY(...)` — those call sites were not verified
against a real 2+-element array during this investigation and may have the
same latent bug (see follow-up task: find and fix other silent array-filter
failures caused by the Postgres array parameter bug).

**Confirmed live occurrence:** `server/services/cro03/candidate-selector.ts`
had three `ANY(${jsArray}::uuid[])` call sites hit this exact bug in
production code (found while building a certification script that exercised
a real multi-row candidate-selection path). Fixed with a local
`toUuidArraySql()` helper identical in shape to `toTextArraySql`. Treat any
new `ANY(${arr}::...[])` sighting in this codebase as a bug until proven
otherwise — grep for the literal pattern `ANY(${` when auditing a file.

## How to apply

Never write `ANY(${jsArray}::type[])` directly. Build a real
`ARRAY[...]::type[]` expression by hand:

```ts
const toArraySql = (arr: string[]) =>
  arr.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(arr.map((v) => sql`${v}`), sql`, `)}]::text[]`;

// usage: sql`... WHERE col = ANY(${toArraySql(myArray)})`
```

This form was verified to work correctly for 0, 1, and 2+ element arrays
(see `server/services/mi09-pilot-authority.ts` — `toTextArraySql`).

When a filter should be a no-op for an empty scope, still route the empty
case through the same `ARRAY[]::type[]` builder (never leave a raw
interpolated empty array in the template) — a boolean `OR` guard around the
`ANY(...)` does not save you, because Postgres parses the full statement
before any runtime short-circuiting happens.
