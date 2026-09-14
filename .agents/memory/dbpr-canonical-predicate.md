---
name: Canonical DBPR-family predicate (task #1956)
description: Single TS+SQL DBPR exclusion module; where it is enforced and where DBPR is still deliberately allowed.
---

`server/services/dbpr.ts` is the one canonical DBPR-family predicate for this codebase (task #1956, Step 1). It exports:
- `isDbprSourceSystem(sourceSystem)` — TS predicate, case/delimiter-agnostic substring test for "dbpr".
- `DBPR_SQL_REGEX` — the raw Postgres `~*` pattern used by every SQL-side check.
- `dbprSourceSystemSql(column)` / `notDbprSourceSystemSql(column)` — same-row `source_system`-shaped column checks.
- `businessHasDbprLineageSql(businessIdExpr)` / `businessLacksDbprLineageSql(businessIdExpr)` — EXISTS/NOT EXISTS against `canonical_source_links` for a business id, used for the "full-family" exclusion (any DBPR link taints the business for these boundaries).

**Why a single module:** the codebase previously had one correct-but-duplicated regex in `cro08a/source-scope.ts` and at least one narrower, exact-string check (`source_system = 'dbpr_hr'`) in MI-09 cohort selection that missed `dbpr-abt`/`dbpr-cos`/`dbpr-bar` and casing variants. Centralizing prevents silent re-divergence.

**Load-bearing policy:** DBPR ingestion, storage, source-lineage linkage, and canonical-business materialization are explicitly ALLOWED and must keep working. Only specific downstream boundaries exclude DBPR: free-enrichment selection, MI-09 paid-provider cohort selection, provider-command creation, provider execution (defense in depth), outreach-purpose ZeroBounce validation, master-lead promotion/readiness, sequence/campaign/GHL eligibility, final outreach execution, and CRO-08A recurring enumeration.

**How to apply:** any new code that needs to know whether a source/business is DBPR-derived must import from `server/services/dbpr.ts` — never hand-write a new `/dbpr/i` or `~* 'dbpr'` check. `cro08a/source-scope.ts`'s `isDbprSourceSystem` is now a thin re-export for backward compatibility. Parity between TS and SQL forms is asserted in `scripts/test-dbpr-predicate-parity.ts`.
