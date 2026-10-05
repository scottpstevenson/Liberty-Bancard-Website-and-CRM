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

Reducing owner-fence round trips must preserve lock order and evaluate lease
expiry after lock acquisition, never cache authority across write boundaries.

**Why:** A lease may expire while a statement waits for the selector or owner.
An expiry predicate evaluated before that wait can admit stale authority.

**How to apply:** When combining lock statements, use explicit materialized,
correlated dependencies and check wall-clock expiry after the locked result.
Prove both actual selector blocking and rejection after expiry in a native test.

Preparing a repeated SQL contract query is not caching its authority result.
Keep every live catalog and lease evaluation; only the execution plan may be reused.

**Why:** Local profiling found repeated catalog-query planning cost greater than
execution cost. Caching returned permission facts would hide revocation or schema
drift, whereas a prepared query still evaluates the actual catalog on every call.

**How to apply:** Prove that a warmed prepared guard rejects a contract disabled
inside the same transaction, then accepts again after rollback. Never memoize
the returned guard booleans or lease authority.

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

Operational owner acquisition/renewal can commit independently of a subsequent
provider reservation that rolls back. Keep this separation; do not move acquisition
back inside the larger effect transaction merely to make its lease renewal atomic
with the effect.

**Why:** Holding the singleton acquisition advisory lock across quarantine/work
checks creates a reproducible convoy. Lease renewal is operational authority,
not provider budget reservation, spend approval or outbound permission; the
heartbeat already renews that authority independently.

**How to apply:** The effect transaction must still pin selector then live owner
and compare the exact acquired epoch/token. A transfer between acquisition and
pinning must fail closed. Retain the final effect fences and owner row pins:
legitimate renewal can still wait on those pins, so removal of the acquisition
convoy is not proof that every production latency or lease-expiry cause is fixed.