---
name: SQL correlated-subquery column shadowing
description: A bare/unqualified outer-column reference inside a correlated EXISTS subquery silently binds to the subquery's own same-named column instead of the outer row, when building raw string WHERE fragments.
---

## The bug

When building a WHERE clause as a **plain string** (not drizzle's `sql` tag with
real parameter binding) that contains a correlated subquery, e.g.:

```sql
NOT EXISTS (SELECT 1 FROM some_child_table csl WHERE csl.business_id = business_id AND csl.source_system ~* 'dbpr')
```

the *unqualified* `business_id` on the right of `csl.business_id =` does **not**
reliably refer to the outer row. If `some_child_table` (aliased `csl` here) also
has a column literally named `business_id`, Postgres resolves the unqualified
reference against the **innermost** FROM-list first — i.e. `csl.business_id =
csl.business_id`, which is always true. The exclusion then silently ignores the
outer row's actual business entirely and instead reports true/false based on
whether *any* row anywhere in the child table matches the rest of the
predicate.

Verified empirically in this codebase with a minimal two-table repro
(`outer_t(business_id)`, `inner_t(business_id, flag)`): a bare `business_id`
inside a correlated `NOT EXISTS` against `inner_t` resolved to `inner_t`'s own
column for every outer row, not the outer table's column.

**Why:** drizzle's `sql` tag interpolates real values as bound parameters, so
this class of bug does not occur there. It appears specifically in the
handful of call sites in this codebase (e.g. `zerobounce-eligibility.ts`)
that build WHERE clauses as raw strings consumed via node-postgres
`pool.query`, because a column *name* has to be spliced in literally.

**How to apply:** any time you write a correlated subquery as a raw SQL
string fragment meant to be reused across multiple outer queries, never
reference the outer table's column bare. Require the fragment's caller to
pass a fully qualified reference (e.g. `c.business_id`), and standardize
every embedding call site to alias the outer table consistently (e.g. always
`FROM contacts c`) so the qualified reference is valid everywhere the
fragment is used. Test with a fixture where an *unrelated* row elsewhere in
the child table would match the predicate — that is the only way this bug
surfaces, since same-row/no-other-rows fixtures pass by coincidence.
