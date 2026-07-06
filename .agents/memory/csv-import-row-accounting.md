---
name: CSV import row accounting
description: How to keep totalRows fully reconciled (no invisible dropped rows) when Drizzle's onConflictDoNothing() is in the insert path.
---

`db.insert(...).values(batch).onConflictDoNothing().returning()` can silently
skip rows on a DB-level conflict without throwing — those rows are neither
inserted, app-level duplicates, nor caught exceptions. If nothing counts
them, they vanish from any totalRows reconciliation.

**Why:** the CSV import endpoint tracked `newRecords`, `duplicatesSkipped`,
and `invalidRows`, but `invalidRows` was computed and never persisted, and
there was no counter at all for DB-level `onConflictDoNothing` skips — so
`totalRows` could not be reconciled against the other counters, and some
rows were invisible in the UI even though they were counted in `totalRows`.

**How to apply:** whenever using `onConflictDoNothing()` (batch insert or
per-row fallback), diff `batch.length` against `result.length` (or check for
an undefined/falsy per-row result) and add the difference to an explicit
`skippedRows` counter. Persist every bucket (created/duplicate/invalid/
skipped/error) to the DB record, not just some of them, and assert
`total === sum(buckets)` with a `console.error` on mismatch so future
schema/logic changes can't silently reintroduce the same class of bug.

Dev-DB note: contact rows created for reconciliation testing can be hard to
clean up afterward — `contacts` is referenced by `lead_sources`,
`ghl_activity_log`, and likely other tables with FK constraints, so a plain
`DELETE FROM contacts WHERE ...` fails. Either delete dependents first in FK
order or just leave harmless test rows in dev.

**Related trap — NOT NULL + unique-indexed columns fed by `field || ""`:**
if a column is `NOT NULL` with a (possibly partial) unique index, and the
insert path falls back to `""` for a missing value (e.g. `email: email ||
""`), every row missing that value collides with each other on the unique
index after the first one inserts — `onConflictDoNothing()` then silently
drops all subsequent legitimate rows, not just true duplicates. Fix by
generating a guaranteed-unique placeholder (e.g. `randomUUID()`-based) for
the missing value instead of a constant fallback, and make sure the
app-level dedupe logic only keys off the *real* (truthy) field so the
placeholder never falsely matches. Reconciliation counters alone (see above)
will surface this as `skippedRows` but won't fix the dropped data — check
*why* rows are being DB-conflict-skipped, not just that they're accounted
for.
