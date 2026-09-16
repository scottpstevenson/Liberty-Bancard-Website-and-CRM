---
name: Bootstrap eligibility column defaults and lifecycle column-name drift
description: Two related production-defect patterns found in the Sunbiz bootstrap / MI-09 pipeline — a materializer that didn't set a downstream-eligibility column, and a raw SQL predicate written against a stale column name.
---

## Materializers must explicitly set every downstream-eligibility column

`resolveOrganization()`'s `create:` object is a passthrough to `db.insert(businesses)`.
A caller that omits a field the DB has a default for gets that default silently —
there is no compile-time or runtime signal that the field was skipped. The Sunbiz
bootstrap omitted `recordClass`, so every newly-created business landed on the
column default `'unknown'` instead of `'canonical'`, making them invisible to every
consumer that filters on `record_class = 'canonical'` (`/api/lead-ops/businesses`,
the free-enrichment cohort, MI-09 eligibility).

**Why:** a table's DB-level default is designed for the common/unprivileged case,
not for a specific privileged writer's intended semantics. Any code path that
materializes rows into a shared table (businesses, contacts, etc.) that other
subsystems gate on must explicitly set every column those subsystems key off of —
never assume the default matches what this writer means.

**How to apply:** when reviewing or writing a bootstrap/backfill/materializer that
inserts into a shared table, diff the columns it sets against the columns every
known downstream consumer filters on (grep for the table name + `WHERE` across the
codebase). A guarded, idempotent preview→confirm→run repair tool (cohort = the
writer's own claim/lineage evidence intersected with "still has the wrong value")
is the safe way to fix already-materialized rows without touching unrelated rows
or global defaults.

## Verify lifecycle/state column names against the actual schema before writing raw SQL

`mi09-pilot-authority.ts`'s preflight check queried `cro03a_qualification_runs.status`,
but migration 0187 and `shared/schema.ts` both define the column as `state`. The
query didn't error — Postgres would have thrown on a genuinely missing column, but
here the mistake was silent at the *result* level in earlier review rounds because
the check was buried in a larger preflight function; it surfaced only when someone
traced actual production preflight failures back to the query.

**Why:** table/column names inside a family of related migrations (CRO03A/CRO03C
here) are not always consistent with what an adjacent table or an earlier draft
used; `status` vs `state` is a common enough drift that it should never be assumed.

**How to apply:** before writing or reviewing a raw SQL predicate against a
lifecycle/state-like column, grep the exact table's Drizzle definition in
`shared/schema.ts` (which reflects live post-migration column names) rather than
inferring the name from convention or from a sibling table.
