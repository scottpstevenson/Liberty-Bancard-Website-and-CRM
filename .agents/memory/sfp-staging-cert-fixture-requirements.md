---
name: SFP campaign-staging certification fixture requirements
description: what a disposable-DB cert needs seeded before processSfpCampaignStagingTick can produce ready_held rows, and correct table/column names for staging output.
---

`processSfpCampaignStagingTick()` silently dead-letters every eligible business with
`outcome_code='no_current_package_for_vertical'` unless a `sfp_campaign_package_versions`
row with `lifecycle_state='current'` exists for that business's vertical. A cert that seeds
`validated_outreach_eligible` rows but no package version will see the tick report
`succeeded:0` with no thrown error — always inspect `sfp_stage_items.outcome_code` when a
staging cert reports zero movement, not just the tick's returned counts.

**`package_key` is constrained** to a fixed enum (`sfp.<vertical>.v1`, e.g. `sfp.med_spa.v1`)
by `sfp_campaign_package_versions_package_key_check` — a per-run unique key (e.g. suffixed
with a run id) violates the check constraint. Reuse the exact enum value.

The staging **output table is `sfp_campaign_staging_intents`** (join through
`sfp_outreach_eligibility.eligibility_id` for cohort scoping), not a `sfp_ready_held` table
(that name doesn't exist). Terminal state column is `state = 'ready_held'`.

`computeLivePackageContentHash` lives in `server/services/cro03/sfp-campaign-packages.ts`
(not a `-versions` suffixed file).

**Why:** cost real debugging time twice in one session finding the right table/column names
and the missing-fixture cause for an apparently-successful-but-zero-movement tick.

**How to apply:** when writing or debugging any SFP campaign-staging certification, seed a
package version first and query `sfp_stage_items.outcome_code` before assuming a bug in the
worker itself.
