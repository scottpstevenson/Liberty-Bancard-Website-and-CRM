---
name: Slow dashboard page causes
description: Why Outreach Queue, SFP status and Lead Ops health were slow, and what is deliberately cached or pre-filtered
---
- Outreach Queue: the projection evaluates up to 250-500 candidates at ~25 queries each. Unowned contacts always carry OWNER_REQUIRED and can never qualify, so they are excluded in SQL (the "unassigned" filter still lists them). The assignee list is one distinct read, not a projection run.
- Parallel evaluation barely helps (DB-bound); pre-filtering candidates is what removed the wait (22s to 2s on dev).
- SFP status-overview: only the table-scan counts are snapshotted for 60s; pause state, provider controls, spend and Serper state stay live. Lead Ops health serves its expired snapshot while refreshing in the background.
**Why:** prod timings were 27s (assignees), 9s (status-overview every load), 15s cold (health).
**How to apply:** do not cache safety-state fields; any new heavy count belongs in the snapshot, not the live part. Still slow and unfixed: /api/lead-ops/entities (~3.7s, full-table count plus CASE sort; needs an expression index migration) and cold /api/sunbiz/stats full scan.

## Bounded read patterns (Stage 4B closure)
- Correlated per-row subqueries/laterals over small tables were the real cost of the backlog aggregate (businesses 20s, contacts 6s on the production replica); pre-aggregated joins / a materialized DISTINCT ON CTE fixed it with identical output md5. Measure on the replica, never the warm dev DB.
- Every deadline-bound read must cancel its exact transaction (pid + xact_start) both on timer expiry and on LATE backend registration, and must refuse to start value queries once expired.
- Launch-inventory cost is per-row contact policy (~35 queries/row), not the recorded-facts SQL. A per-run memo (inventory flight only, never mutation boundaries) lets retries converge; production completion time was never measured.
- UPDATE ... FROM cannot reference the target table inside LATERAL (42P10): use a CTE.
- sfp_campaign_staging_intents live states are staged/operator_selected/ready_held/promoted (not just staged/promoted).
- Reclaimed staging runs must settle expired `claimed` items of older claim generations (skipped+recovery lineage or released); recovery-settled rows must not be overwritten by a late completion.
