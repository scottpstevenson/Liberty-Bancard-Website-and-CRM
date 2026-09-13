---
name: Free-enrichment queue UNION ALL indexing
description: How to index and test a 3-branch OR eligibility predicate on businesses (null / retryable-failed / stale-enriched) without a full table scan.
---

An eligibility predicate with an OR across mutually-exclusive status branches (`status IS NULL OR (status='failed' AND attempt<3) OR (status='enriched' AND completed_at < NOW()-90d)`) cannot use a single partial index efficiently. Rewrite as `UNION ALL` of one `SELECT` per branch — each branch gets its own partial index and the planner picks it up independently (verified via `EXPLAIN (ANALYZE, BUFFERS)`, no `Seq Scan`).

**Why:** Postgres won't automatically split an OR into per-branch index scans when the branches reference different columns/conditions; a single compound partial index can't serve all three shapes at once. UNION ALL is safe here specifically because the branches are mutually exclusive on `status`, so there's no duplicate-row risk.

**How to apply:**
- Never put `NOW()` / `CURRENT_TIMESTAMP` in an index predicate (time-varying predicates can't be used for a static partial index) — keep the runtime `< NOW() - INTERVAL 'N days'` comparison in the query, not the index.
- Any two consumers of the same eligibility rule (e.g. a worker's batch-select and a health/depth-count endpoint) must share the exact same three-branch logic or they will drift; there's no shared code path today, only duplicated SQL blocks (see also task-1906 follow-up tasks proposing a shared source-of-truth).
- Testing day-boundary logic (e.g. "89 days excluded, 91 days included"): don't test at exactly N days — real wall-clock time elapses between INSERT and the SELECT running, so a row seeded at "exactly 90 days ago" will already read as *more* than 90 days old by query time and gets included. Treat the exact boundary as "included" rather than trying to pin it as excluded.
- To prove `EXPLAIN` shows index scans (not seq scans) you need a representative row count — a table with only hundreds of rows will always favor Seq Scan regardless of indexing; seed tens of thousands of filler rows temporarily.
- When seeding/cleaning up large synthetic datasets (tens of thousands of rows) via a script using the shared pg pool: batch DELETE by a per-run tag, not a per-row loop (looping is drastically slower); a 60K-row DELETE can exceed the pool's default ~30s `statement_timeout` — wrap cleanup in a transaction with `SET LOCAL statement_timeout = 0`.
