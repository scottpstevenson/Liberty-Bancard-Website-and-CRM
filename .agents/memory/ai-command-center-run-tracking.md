---
name: AI Command Center run tracking requires audit logs on every branch
description: Run-count/last-run display for "Run Now" automation buttons reads audit_logs by action string; any code path that doesn't write one looks like the button never ran.
---

The AI Command Center (`/api/ai/command-center`) computes `totalRuns` /
`lastRun` per action purely by filtering `storage.getAuditLogs()` for a
specific `action` string (e.g. `ai_tasks_generated`, `deal_auto_progressed`,
`prospect_routed`, `ai_insights_generated`). It does not track invocations
any other way.

**Why:** Several of the underlying routes (`/api/ai/generate-tasks`,
`/api/ai/route-prospects-bulk`, `/api/ai/insights`) previously never wrote an
audit log at all, so the dashboard always showed 0 runs / "Never" even though
the routes executed and had real side effects. Separately,
`/api/ai/auto-progress-deals` only wrote `deal_auto_progressed` inside the
per-deal "advance" branch — a genuine no-op run (nothing qualified to
progress) produced zero audit rows, so a real, successful "nothing to do"
run was indistinguishable from the button never having been clicked.

**How to apply:** When adding or auditing a "Run Now"-style automation
action: (1) always write an audit log row for every invocation, including
the no-op path, using `entityType: "system", entityId: 0` and a
`details.resultState` of `success` / `partial_success` / `no_op_with_reason`
/ `failed_with_reason` plus a human-readable `reason` when not a full
success; (2) real per-entity audit rows (e.g. `entityType: "deal"`) can
coexist with the system-level tracking row — the command-center reader
just counts by `action` string regardless of `entityType`, so this is safe;
(3) surface `reason` in the route's JSON response so the frontend can show a
"no action taken" toast instead of implying success.
