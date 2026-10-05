---
name: SFP runtime owner lock ordering
description: Concurrent worker claims can deadlock with joined owner/release-selector row locks.
---

Runtime-owner readers must explicitly lock the release selector before locking
the owner row, matching publish/claim ordering. A joined `FOR SHARE OF owner,selector`
is not an ordering guarantee: PostgreSQL can lock owner first.

**Why:** Disposable concurrent registry-worker certification exposed a real
cycle: one worker held the owner share lock while waiting for selector; a claimant
held selector while waiting to update owner. Earlier passing concurrency runs
did not exclude this timing-dependent failure.

**How to apply:** Reuse the ordered owner-fence helper for worker transactions.
When adding owner/selector locks or changing publish/claim flows, check the order
across all participating transactions, not only each individual SQL statement.

Automatic writers must also acquire deployment-owner authority before commercial
graph/domain locks, retaining the final evidence/authority recheck afterward.

**Why:** A native concurrent test proved a graph-blocked writer can hold owner
authority while actual renewal queues. A graph-first writer that requests owner
authority afterward introduces the opposite order relative to preparation and
renewal. Local ordering proof is not identification of an earlier production cycle.

**How to apply:** Check the complete owner → graph ordering when composing
automatic writers with an authority callback; a final-only callback is not enough.
Keep read-only holds cheap, and do not remove the final snapshot recheck to fix ordering.

A passing isolated registry concurrency test does not establish that the full
published heartbeat, preparation and provider lock graph is deadlock-free.

**Why:** A published selector-first build still produced a native PostgreSQL
deadlock during preparation. The SQLSTATE confirmed the failure class, not
which locks formed the cycle.

**How to apply:** Keep the exact conflicting lock graph unproved until traced.
Distinguish bounded retries of known-aborted transactions from a lock-order
repair; never retry an uncertain connection failure as though rollback were proved.