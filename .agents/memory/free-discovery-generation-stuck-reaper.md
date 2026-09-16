---
name: Free-discovery generation stuck-in-progress reaper
description: Why the free_discovery_generations envelope needed a periodic reaper, not just in-process try/finally, to avoid permanently-stuck 'running' rows.
---

The durable per-batch run envelope (`free_discovery_generations`, `state` column) is only ever transitioned to a terminal state from inside the same process that created it (`enrichContactBatch`'s try/catch/finally). That protects against a caught JS exception, but not against a hard process crash (kill, OOM, deploy restart) mid-batch — nothing runs in that case, so the row is stuck in `state='running'` forever, along with any telemetry/UI counters keyed off it.

**Why:** a code reviewer caught this as a real acceptance-criteria gap on a task ("stuck business processing rows recover automatically", "automatic stuck-lease recovery with an auditable manual reconcile control") after the generation-envelope + concurrency-safety work had already landed and been reviewed twice — the in-process completion path looked sufficient until asked "what if the process itself dies".

**How to apply:** any batch/run envelope row with a non-terminal "in progress" state needs an out-of-process reaper (a periodic tick sweep, not just the owning code path's own cleanup) that:
- finds rows stuck past a stale-after threshold in the non-terminal state,
- transitions them to a distinct terminal state that means "abandoned/unknown outcome" (e.g. `stalled`) — never silently reuse the normal "completed" state, since the true final counts past the crash point are unknowable,
- recomputes whatever counters it can from what was actually persisted,
- writes one audit-log row per reclaimed row so the auto-recovery itself is inspectable,
- is idempotent — never touches an already-terminal row twice.

Also: when scoping a task, "do not create follow-up tasks, close complete scope in this task" is meant literally — a follow-up that turns out to satisfy the task's own acceptance criteria (e.g. "stuck records recover automatically") is a scope violation, not a legitimate deferral, even if it looks like a natural admin-UI/reliability nice-to-have. When proposing follow-ups from a task with that kind of binding constraint, re-check each candidate follow-up against the task's literal acceptance-criteria list before proposing it.
