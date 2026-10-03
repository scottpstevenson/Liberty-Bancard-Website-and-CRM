---
name: Development startup mutation scope
description: Worker-disabled preview startup can still perform database reconciliations outside a no-mutation task's scope
---

Do not treat background profile `off` as a read-only application startup. Before
restarting the full development app for work that forbids data changes, consider
startup reconciliation side effects separately from worker/transport activation.

**Why:** A worker-disabled development preview restart still ran the existing
contact classification backfill, changing unknown record classes. Disabled jobs
did not prevent that startup reconciliation.

**How to apply:** Prefer the isolated guarded handler/component harness for
restricted verification. If a full preview restart is needed, inspect which
startup reconciliations run and disclose observed unintended dev-data changes;
never infer that development startup is production verification or silently undo
records without their original identities/state.