---
name: Application-to-MID lifecycle patterns
description: Durable design rules from the application → underwriting → processor → MID repair; check before touching boarding, applications, underwriting conditions or overrides.
---
- Provider dispatch writes a durable DISPATCH_STARTED marker before I/O; a stale claim that already dispatched is held (never re-sent). Unknown provider outcomes are ambiguous/held, never auto-retried; pause leaves work owed without burning an attempt.
- Status observations apply as one versioned, locked transaction (older observation cannot overwrite newer state).
- Readiness is one shared contract; document and e-sign requirements are explicit `native_policy_required` gates. Internal approval is never relabelled as processor approval.
- Outbox workers in selective mode belong to the `critical-commands` group; read routes must not insert defaults (rules GET is pure).
- Submission completeness is validated server-side by merging the stored draft; prefill is a durable hashed capability, not an in-memory map; consent evidence binds to the contact's current phone; ambiguous mailbox/contact matches are held, not first-match linked.
- Underwriting conditions: supersede instead of delete; waive = admin/manager + reason; chase rows are durable "owed" rows and a `sending` row with unknown outcome is held, not re-sent.
- Manual underwriting override = decision CAS + stage move + effect intents + audit in ONE transaction (deal row locked first, then latest decision); illegal stage transition rolls everything back. Optional GHL task / notification run after commit. Stage core is `advanceDealStageInTx`; telemetry is `advanceDealStageAfterCommit`.
- Underwriting readers: KPI "now" counts and queue list share one latest-decision-per-deal cohort (ties broken by id); event counts (today, history) are labelled as events. Lists are paged with an uncapped SQL total.
- E-sign status GET is a pure read; provider refresh is a separate governed POST that reports unavailable honestly.

**Why:** each was a real defect class found in the lifecycle audit (double-send, half-applied state, counts disagreeing with drill-through, silent defaults).
**How to apply:** reuse these shapes for any new boarding/application/underwriting command.

Journal edit lesson: never re-serialize migrations/meta/_journal.json (json.dump reformats everything and drops `"breakpoints": false`); append the new entry as text only.
