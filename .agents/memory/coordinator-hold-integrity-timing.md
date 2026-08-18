---
name: Coordinator hold integrity check timing after teardown
description: assertNonTestHoldsIntact fails when pause-authority holds are temporarily absent after teardown applyPauseMutation — coordinator needs one BullMQ tick to recreate them.
---

## Rule

`assertNonTestHoldsIntact` must NOT treat missing `pause-authority` holds as
a hard failure.  Filter them out of the error set; only non-coordinator holds
(staged-release approval holds) must be present immediately.

## Why

After `cleanup()` calls `applyPauseMutation({ outboundGlobalPaused: true })`
to restore the canonical pause, the OutboundQueueCoordinator must run one
BullMQ tick to call `writeGlobalOutboundHolds()` and recreate the 17
canonical `global_outbound|pause-authority` holds.  That tick fires on the
next BullMQ job completion — which may be seconds or minutes later.
The integrity check runs immediately after `applyPauseMutation`, so the holds
are legitimately absent in the window between the restore and the tick.

The check's comment already acknowledges holds are compared "by shape not
hold_id" because "the test's legitimate pause cycling + final restore
recreates them with new hold_ids."  The timing gap just means the recreation
hasn't happened yet at check-time.

## How to apply

In `assertNonTestHoldsIntact`, split `missing` into:
- `nonCoordMissing` = holds where key does NOT end with `|pause-authority`
  → hard failure (these should never disappear)
- `coordMissing`    = holds where key ends with `|pause-authority`
  → log info message only ("pending recreation on next coordinator tick")

The staged-release safety contract is preserved because staged-release holds
have `source_key` values other than `pause-authority`.
