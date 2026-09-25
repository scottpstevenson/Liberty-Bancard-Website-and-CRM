---
name: Legacy-value CHECK-constraint migrations
description: How to prove a narrowed state/enum CHECK constraint doesn't break existing legacy rows.
---

When a migration narrows or changes a `CHECK` constraint on a state/enum
column, a census showing "zero legacy rows use value X in the current
database" is evidence for *this* database at *this* moment — it is not
proof the migration is safe for every environment that might apply it
(disposable certification DBs, other deployments, future synthetic replay).

**Why:** a certification test that hand-reconstructs its own copy of the
"old" constraint to simulate the pre-migration world tests the wrong thing —
it proves nothing about the migration file that will actually run. The only
trustworthy assertion is inserting a row with the legacy value directly
against the real, currently-applied constraint (post-migration) and
confirming it is accepted, not silently reinterpreted as a different state,
and not rejected.

**How to apply:** when narrowing a CHECK constraint, either (a) retain every
historically-possible value as a legal legacy-only value with a code comment
explaining new code must never write it again, or (b) migrate each affected
row through an explicit, individually-justified procedure. Write the
certification test to INSERT against the actual applied schema, not a
reconstructed copy of an old or new constraint definition.
