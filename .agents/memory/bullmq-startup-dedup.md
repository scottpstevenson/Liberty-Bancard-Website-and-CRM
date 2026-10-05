---
name: BullMQ job ID deduplication
description: Retained and active IDs silently deduplicate startup jobs and self-scheduled batch continuations.
---

# BullMQ Job ID Deduplication

## The Rule
Never use a static `jobId` on one-off startup jobs added via `queue.add()`. BullMQ deduplicates by jobId — if a job with that ID exists in Redis (completed, failed, or delayed), the new `queue.add()` call is silently ignored.

**Why:** A retained failed startup job silently prevented later restarts from scheduling immediate work.

**How to apply:** For one-off startup jobs that need to fire on every restart, omit the `jobId` entirely — BullMQ assigns a unique random ID and never deduplicates. Only use static `jobId` when deduplication IS desired (e.g., preventing the same job from being queued twice by concurrent API calls).

Never schedule a batch's successor with the currently active job's ID.
`removeOnComplete` does not help: removal happens after the handler returns.

**Why:** A self-enqueued continuation can be silently deduplicated, stopping a
draining backlog even though the handler reported success.

**How to apply:** Use alternating bounded continuation slots or another ID
distinct from the active job. Verify at least three real BullMQ batches, not
just that the first continuation was added.
