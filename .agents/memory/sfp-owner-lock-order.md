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