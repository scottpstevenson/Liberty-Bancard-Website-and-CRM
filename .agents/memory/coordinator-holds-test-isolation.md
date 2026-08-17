---
name: Coordinator holds test isolation
description: Coordinator hold ledger rules for tests — correlation-scoped teardown only; never TRUNCATE/bulk-deactivate; inactive rows must never be deleted.
---

# Coordinator Holds — Test Isolation Principles

**Rule 1:** Tests may only deactivate hold-ledger rows tagged with their own
run-scoped correlation ID, using coordinator protocol (advisory lock, MAX+1
ledger epoch, released event). Never bulk `UPDATE active=false`, never
`TRUNCATE`.
**Why:** The ledger carries real production-safety holds (global pause,
staged-release approval, incident, maintenance, channel). Broad clears bypass
the staged-release admin approval and silently release outbound work.

**Rule 2:** Never delete inactive tombstone rows. The coordinator derives its
monotonic epoch from `MAX(ledger_epoch)` across ALL rows; deleting tombstones
can lower the max and cause epoch reuse. Compaction requires migrating to a
separate durable epoch counter first.

**Rule 3:** Unpausing leaves active staged-release holds that keep the worker
gate closed; tests that need the gate open must clear their own (tagged) holds
after unpausing, and an uncorrelated staged-release hold must fail those tests
safe (deferred), not be cleared.

**How to apply:** The sequence-compliance test suite implements this pattern —
run-scoped correlation UUID on every pause mutation, correlation-only teardown,
shape-keyed pre/post snapshot of non-test holds, an uncorrelated-hold survival
probe, and an untagged final pause restore so restored canonical holds outlive
teardown. Follow the same pattern in any new test touching pause/hold state.
