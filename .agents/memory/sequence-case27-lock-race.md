---
name: sequence-compliance Case 27 lock race
description: Case 27 (global-pause dedup) in test-sequence-compliance.ts fails intermittently because the live BullMQ sequence worker races for the job lock
---

## Rule
Case 27 of test-sequence-compliance.ts tests global-pause dedup in the sequence
worker. It fails when the live BullMQ sequence worker (running every 30s in the
background server process) acquires the `sequence_worker` job lock milliseconds
before the test's `processSequenceEnrollments()` call. The test tick returns
`{processed: 0}` immediately, zero audit logs are written, and both assertions fail.

**Why:** `acquireJobLock` uses a single DB row: UPDATE only fires WHERE status ≠ 'running'.
If the background worker holds 'running' at the exact moment the test tick fires, the
test's acquire returns false and the function returns early.

**How to apply:** If Case 27 flaps in CI, either:
1. Stop the background sequence-worker queue before running the compliance test script, or
2. Wrap Case 27's test ticks with a retry loop (retry if processed === 0), or
3. Release+force-reset the job lock row before the test tick.

This is a test isolation issue, not a sequence-worker logic bug. The dedup code itself
(lines 46-73 in sequence-worker.ts) is correct.
