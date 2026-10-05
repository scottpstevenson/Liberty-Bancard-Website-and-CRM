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

Dispatch renewal must pin the selected release before its direct owner UPDATE.
A later selector-first job-lease recheck does not repair an earlier owner-first
write. Do not take an owner SHARE lock before renewal: concurrent dispatchers
would both need to upgrade it.

**Why:** Primary evidence identified a recovery/classification deadlock; a native
disposable reproduction confirmed dispatch's owner UPDATE followed by the
job-lease selector pin forms that cycle. Selector-first dispatch committed under
the identical schedule and allowed concurrent renewals without lock upgrades.

**How to apply:** Follow selector SHARE → fenced owner UPDATE → job/effect locks.
Retain exact owner epoch/token, release matching, revocation, wall-clock expiry,
claim-token checks and final dispatch guards. Test both the historical cycle and
the corrected transaction schedule with actual PostgreSQL locks.

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

Dispatch follows this same split: renew the owner in a short transaction, then
SHARE-pin it before policy/graph/budget work in the separate effect transaction.
Job-lease renewal must not update the owner again.

**Why:** After repairing the lock-order cycle, primary evidence still showed
recovery waiting behind dispatch's exclusive owner lock across job/operation
checks and commit. A native held-budget test reproduces that convoy; separating
upkeep lets recovery pin the same owner while dispatch waits.

**How to apply:** Recheck epoch/token, selected release, revocation and wall-clock
expiry between the committed upkeep and effect transaction. Test drift in that
gap, no budget/dispatch effect after denial, and committed operational upkeep
after effect rollback. Do not claim this removes waits behind every shared pin
or fixes database/network latency.

Never acquire a second global pooled connection from a helper invoked inside
an authority-pinned, caller-owned transaction. Thread the existing transaction
through live admission reads; persist denial receipts after rollback/release.

**Why:** A native one-connection certification exposed the nested-checkout
self-wait in contact admission. This explains a concrete local contention
mechanism, not the sole cause or exact caller of every production timeout.

**How to apply:** Audit transitive helpers, not just the outer transaction body.
Keep contact/provenance/consent writes atomic at a bounded mailbox-sized unit,
retain final live authority/lease checks, and prove recovery reuses records
committed before a crash.

Protocol connection IDs are not necessarily native PostgreSQL backend PIDs.
Obtain real PIDs and blocker relationships from the primary, and correlate them
with non-sensitive transaction trace identities. Do not use replica lock views
or concurrent worker activity as proof of the blocking caller.

**Why:** Published connection logs contained negative protocol IDs while primary
lock attribution was needed; the same renewal SQL also has multiple callers.

**How to apply:** Distinguish heartbeat from queue-watch phases, preserve named
prepared SQL, and keep observation independent of authority-pinned transactions.
Parse deadlock details into numeric edges only: full details can include source
SQL/PII. Log the original and cleanup errors separately before diagnosing recovery.

Native activity-query fingerprints can differ from the complete application
fingerprint when PostgreSQL truncates tracked SQL; trace comments consume part
of that limit. Correlate checkout identity first, not hash equality alone.

**Why:** Primary diagnostics showed a shared-pin query truncated to 1,023 bytes;
rendering the complete template with its trace prefix reproduced the differing
native hash exactly. PostgreSQL deadlock details independently confirmed the
classification/recovery PID cycle.

**How to apply:** Compare native activity text against the same trace-prefixed
template at the tracking limit before declaring a different statement or caller.
Do not treat an observer's later failure as invalidating previously captured
primary edges, or as proof that the entire observation window completed.