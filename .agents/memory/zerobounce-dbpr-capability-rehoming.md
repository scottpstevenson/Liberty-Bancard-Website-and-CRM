---
name: ZeroBounce DBPR exclusion & email-validation capability re-homing
description: Two independent ZeroBounce spend paths each needed their own DBPR lineage exclusion; validation-intent jobs moved from the enrichment capability group to email-validation.
---

## What changed (Task #1956, Step 6)

There are two independent ZeroBounce provider-call paths in this codebase, and
each needed the Step 1 DBPR lineage predicate added separately — fixing one
does not fix the other:

1. **Legacy campaign-engine path** (`zerobounce-eligibility.ts`'s
   `buildZbEligibilityWhere`, consumed by `zerobounce-campaign-worker.ts` and
   a few routes) — gated with `DBPR_LINEAGE_EXCLUSION_CLAUSE`.
2. **CRO03C-adjacent path** (`provider-readiness-control.ts`'s
   `processValidationIntent`) — gated with a `businessHasDbprLineageSql`
   check right after the contact-exists lookup, before any budget/circuit
   reservation; sets `terminal_code='dbpr_lineage_excluded'`.

Both join through `contacts.business_id` to `businesses` /
`canonical_source_links`, same as the promotion-boundary check in
`master-leads/pipeline-promotion.ts`.

`enqueueValidationIntent()` was also re-homed from `QUEUE_NAMES.ENRICHMENT`
to `QUEUE_NAMES.ZEROBOUNCE_BATCH`, and its BullMQ job-dispatch handler moved
from the `ENRICHMENT` case to the `ZEROBOUNCE_BATCH` case in
`queue-manager.ts`. `background-profile.ts`'s `WORKER_CAPABILITY_GROUPS`
already mapped `zerobounce-batch-validate` to the `email-validation` group,
so moving the queue name was the only change needed — no new capability
group had to be created.

**Why:** validation-intent processing was previously governed by the
`enrichment` capability group's activation/pause switches, conflating a
data-hygiene concern (email validation) with enrichment. Outbound pause was
deliberately left untouched here — pause continues to gate sends only, not
validation-intent processing.

**How to apply:** if a new ZeroBounce (or other provider) call site is added
in the future, check both paths for DBPR coverage — do not assume fixing
`zerobounce-eligibility.ts` also covers `provider-readiness-control.ts`, or
vice versa. See also
[the SQL correlated-subquery shadowing bug](sql-correlated-subquery-column-shadowing.md)
found while wiring the legacy path's raw-string WHERE clause — every
`buildZbEligibilityWhere` call site must alias contacts as `c`.
