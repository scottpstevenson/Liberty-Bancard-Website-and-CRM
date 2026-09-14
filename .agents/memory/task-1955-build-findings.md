---
name: Task #1955 BUILD verification findings
description: Stale audit claims that did not reproduce against live state, plus real unrelated schema drift found while building bounded tooling.
---

Two "confirmed" audit claims turned out to be false when checked against live state, reinforcing the project's "verify, don't trust" rule for any inherited audit/task description:

- **A claimed drifted CHECK constraint can already be fixed.** `businesses.record_class` missing `'canonical'` and `cro03_source_subjects.subject_type` missing `'business'` were both already repaired by existing migrations (0240, 0250) — live `psql` confirmed both constraints already include the values. Writing a "fix" migration anyway would have been a redundant, unjustified schema change. Always re-query the live constraint definition before writing a repair migration, even when a task description states the drift as fact.
- **A claimed "N consecutive failures" can be stale.** sla-worker's audit-cited 184 consecutive failures did not match live `background_jobs.consecutive_failures` (was 0), and its query (`getSlaConfigs()`) ran cleanly in isolation against live data. The job simply wasn't ticking (excluded from the active `BACKGROUND_JOB_PROFILE=selective:*` group) — a stale/inactive worker is not evidence of an active code defect. Check `background_jobs` (consecutive_failures, last run time) and reproduce the exact call in isolation before trusting a failure-count claim or writing a fix for it.

`scripts/check-bounded-schema-drift.ts` (a bounded Drizzle-vs-live-DB column diff for a specific short table list) found real, unrelated drift on `contacts` and `businesses` columns. This was fixed: see [contacts/businesses NOT NULL convergence](contacts-notnull-convergence.md).
