---
name: Package-pinned ready_held staging pattern
description: Reusable shape for a "prepare but never send/enroll" boundary with exact idempotent replay.
---

When a system needs to prepare records for a downstream action (send,
enroll, activate) but must never itself trigger that action, the following
shape holds up well:

- A **preview** call is a zero-write, snapshot-bound read: it returns an
  exact ordered candidate set, per-row disposition, a snapshot hash (derived
  from every input that could invalidate the preview — policy version,
  target-mapping version, row states), and a server-issued command key.
- An **execute** call requires the exact `commandKey` + `snapshotHash` from a
  prior preview. Same key + same payload replays the stored result verbatim
  (read the stored receipt, do not redo the work). Same key + different
  payload fails closed with HTTP 409. A stale/drifted snapshot (something
  changed since preview) also fails closed with 409 and forces a fresh
  preview — never silent overwrite or best-effort proceed.
- Each row is processed in its own `db.transaction`: lock the source row,
  re-check every safety gate fresh (do not trust the preview's disposition
  for anything beyond routing), and write all resulting rows atomically. The
  command receipt itself is written in a separate statement after all rows
  commit, so a mid-batch crash never leaves an ambiguous "was this already
  run" state.
- The terminal state name should be an inert, clearly-non-executing word
  (e.g. `ready_held`) — never reuse or approximate an existing execution
  authority's own vocabulary (e.g. "approved"), since that misleads whoever
  reads the state later about what already happened.

**Why:** this mirrors an existing precedent already in this codebase — CR-06's
premium campaign preparation flow also terminates at `ready_held` without
creating a send-capable row. Reuse this pattern rather than inventing a new
"paused enrollment"-style hybrid object; enrollment/campaign-activation
records are not partially-safe versions of themselves, they are a different
kind of object with their own guards that a staging boundary must not try to
satisfy half way.

**How to apply:** any time a task's contract says "prepare but do not send,"
model it as preview/execute with a real command-key idempotency table,
not as a status flag on the eventual execution-capable table.

## Three failure modes to guard against in this pattern
- **Cross-entity evidence binding**: a plaintext-opening callback that resolves a reference to "some member of the batch" is not the same as resolving it to the exact row being processed. Always compare the resolver's returned entity ID against the row's own entity ID inside the callback, or a mismatched/stale foreign key can silently project one entity's private data onto another's record.
- **Content hash must be recomputed live, in-transaction, from the real content rows** (not from a stored hash column, and not from a hash of just IDs/names) at the moment a pinned artifact is used. A stored hash proves nothing if the underlying content can still be edited after pinning.
- **Command-key idempotency needs a resume path, not just a replay-after-commit path**: if the row-level write commits before the outer command receipt, a retried/concurrent call must recognize "this exact command already produced this exact row's terminal state" and return success — not throw a conflict — or a crash between those two writes becomes unrecoverable.
