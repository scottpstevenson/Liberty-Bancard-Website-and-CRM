---
name: Inbound default owner
description: Admin-recorded default owner rule for new inbound requests; why Scott-as-admin cannot use the sales-rep election and what the rule must never do.
---

New inbound requests get an automatic owner only from an administrator-recorded setting (`inbound_default_owner`, an active admin/manager). No setting means the old held-for-review behavior, unchanged.

**Why:** the existing election resolves candidates with `requireSalesRep=true`, so an admin account can never be elected by the env policy. The owner decision (the owner chose the default assignee) overrides the earlier "do not invent a default rep" rule only as a recorded, audited, deterministic policy.

**How to apply:** a production contact/deal that is unowned (or already the owner's) is handed to the owner in the same transaction as the `assigned` decision; a record owned by anyone else is never taken over. A still-unclassified contact keeps its `review_required` class-review decision (no rep assignee, no handoff, no classification) but its unlinked review task goes to the owner. Support tickets from the public form are created assigned to the owner. Contact/deal handoff uses a no-key-update lock taken up front (share-then-upgrade deadlocks between requests for one contact). Replays of an accepted default-owner decision must resolve the owner as management, not as a sales rep. Backfilling old `review_required` rows means re-running the scoped continuation per request only AFTER the rule is published, because continuing earlier would blank task owners. Production needs Publish plus recording the owner via the admin route.

**Backfill limit (observed after rollout):** a request's contact can become production while its deal stays `unknown` (deals are classified only by the commercial classification authority). The scoped continuation then blocks with DEAL_NOT_CLASSIFIED_PRODUCTION and the decision row stays `review_required` — only requests with no deal, or a production deal, could be re-run. A task created before the owner was recorded stays unassigned until reassigned through the task command route.
