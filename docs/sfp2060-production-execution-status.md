# SFP production continuation — October 2, 2026

## Current contact-link execution correction

Task 2060 remains open. Existing contact-to-business linking is required scope
of this task, not a newly discovered prerequisite or deferred follow-up.

At 12:01 UTC, the published contact-link coverage endpoint returned `idle`,
no current run, and zero processed contacts. The separately operated strict
website-domain linker is not the broader imported-contact backfill.
At 12:03 UTC, starting the broader coverage run returned HTTP 500 after
30.6 seconds. A subsequent production-replica query found no persisted
coverage checkpoints; the failed transaction did not leave a resumable run.
No new verified links were produced by that failed start.

### Actual enrichment-worker candidate collision

The published worker also logged
`COMMERCIAL_LINK_CANDIDATE_DIVERGENT_REPLAY` while materializing existing
contacts. Its old candidate key included the source, shared batch label,
and business ID, but not the contact ID. Different contacts resolving to
the same business were incorrectly replaying the first contact's proposal.
A read-only production join of retained candidate and lead-source records
confirmed 1,061 other contacts across 725 businesses sharing this key scope,
including all 16 sampled contacts with that logged failure.

The workspace correction scopes new proposals to the exact source/label/
contact/business tuple using a deterministic digest. Existing legacy
proposals for the same contact retain their original key and unchanged
immutable replay checks. Existing rows are not overwritten. A legitimate
proposal for a different contact no longer reuses another contact's key.
This repairs candidate materialization only: it does not establish a
verified relationship, update the contact's business projection, authorize
email validation, or bypass independent evidence/review.

The disposable PostgreSQL integration certification now passes through the
actual contact-ingest function. It proves distinct contacts can retain
separate proposals for one business; retries are idempotent; valid legacy
proposals retain their keys; divergent same-contact legacy confidence still
fails without a scoped fallback; and all tested contact business projections
and decision records remain untouched. No providers are called by this test.

### Broad coverage-query correction

The actual broad coverage query was measured through read-only production
queries, returning only counts, evidence byte totals, and elapsed time:

| Query | Contacts evaluated | Elapsed |
| --- | ---: | ---: |
| Previous query | 25 | 53.039 seconds |
| Corrected query | 500 | 8.613 seconds |

The previous DBA branch omitted the `dba IS NOT NULL` predicate required by
the existing partial DBA-key index. Its production plan scanned the Sunbiz
table for that branch. A redundant page join also enabled expensive
contact-by-business intermediate plans. The correction restores index use
and joins business data directly to the already bounded candidate pairs.
It does not weaken identity, source, suppression, or review predicates,
change financial caps, add DDL, or validate/send addresses.

Starting coverage now commits its frozen denominator and ready checkpoint
without synchronously processing the first page. Subsequent steps retain the
existing bounded 500-contact capacity, cursor, transaction ownership, and
candidate audit behavior. Tests cover initialization, continuation, completion,
failure, query shape, route/role/CSRF behavior, and disposable SQL source
recovery; the project typecheck also passes.

The repairs were published and independently checked against publisher
metadata, artifact-loaded logs and live health. This is not proof that the
contact-link or recipient acceptance requirements are complete.

### Post-publication execution — October 2, 2026, full pass completed at 13:45 UTC

- Published SHA: `53ef7bdc5c48b1821adc92153e56c88b69ac6cfe`; per-Publish build:
  `1df21193-ae7e-46aa-b2d2-db1ff46d39bb`.
- Transferred SFP runtime selection through the audited CAS endpoint from
  selection version 4 to 5, after verifying the actual published artifact.
  The selected release and live owner matched the published build.
- Coverage run `ed5e34df-78b3-4aaf-8b17-56f273f2044c` froze 154,417 contacts
  at watermark 159,475. A first-page request failed after approximately
  30 seconds, but a subsequent bounded step committed successfully. This
  does not establish the failed query's SQLSTATE. The serialized runner
  completed all 154,417 contacts at cursor/watermark 159,475 without losing
  its run ownership. Its final status is `completed`, `complete=true`,
  `lastError=null`.
- Final checkpoints report 85 recoverable identities, 41,965 review cases,
  111,929 needing business discovery, 31 already-verified relationships,
  406 out-of-scope contacts and one suppressed contact.
  **Zero strict-auto-eligible imported contacts were reported.**
  These are as-observed classifications, not newly verified relationships.
  The subsequent diagnostic below shows why this narrow rule's result must
  not be interpreted as absence of useful imported-contact identity evidence.
- Source recovery has actually materialized **17 retained Sunbiz-to-canonical
  business relationships** through snapshot-pinned admin preview/apply.
  Two preview items retained terminal bootstrap holds. All 17 contact
  rechecks remained ineligible for the strict system linker. No review
  decision was fabricated or submitted; source recovery is not a contact FK.
- The final production-replica check contains 32 current verified contact
  decisions with matching projections and 31 native SFP bridge receipts
  across 28 businesses and 31 addresses. All 31 native enrollments are paused,
  linked to their current verified decision/revision and a non-null master
  lead, and their intents remain ready-held.
- **One verified SFP contact was newly created after this Publish.**
  Contact 159,476 was created at 13:15:06 UTC, above the frozen imported-contact
  watermark. It is `created_new`, not a repaired imported contact.
  Its free-source eligibility records a valid, unsuppressed role inbox,
  validation at 13:06:20 UTC, expiry November 1, and no reused operation.
  The linked ZeroBounce operation is completed with one attempt and a retained
  `sfp-dispatch-receipt-v1` marking dispatch and one settled unit. The resulting
  verified link, master lead, ready-held construction intent and paused
  native enrollment are persisted. This is real downstream pipeline progress,
  **not completion of the broader imported-contact linkage requirement**.
- Of the native receipts, 28 across 25 businesses satisfy the stored fresh-valid
  eligibility, not-suppressed, current verified-link/revision and paused
  enrollment checks: Automotive 1, Beauty/Spa 3,
  Construction/Trades/Home Services 23, Fitness/Recreation 0, Healthcare 1.
  Their distinct-business counts are respectively 1, 3, 20, 0 and 1.
  Three have invalid current eligibility and are not counted as qualified.
  This aggregate is not a substitute for the complete receipt/policy chain
  certification required by the task.
- Refreshed actual runtime observations through the guarded CRO-03C
  collector, without issuing approvals or changing provider/budget controls.
  Diagnostics confirmed the observed fleet/inventory and an open readiness
  gate. The observation is ephemeral; it is not permanent operating authority.
- A genuine Serper replenishment run processed 25 businesses, made 49
  provider requests, returned no results for all 25 and confirmed zero
  outreach. A free-discovery replenishment processed nine businesses without
  failures. Two explicit validation runs consumed cached invalid outcomes
  for three candidates and made **zero** provider requests; they are not
  counted as new genuine ZeroBounce validations.
- An Outscraper/Apollo person-discovery request exceeded the local HTTP
  client's four-minute wait. Read-only production verification subsequently
  found its persisted stage `partial`, completed at 13:23:02 UTC, with 25
  selected/processed and zero counted successes/failures. Its Outscraper items
  include seven `completed`, eight `no_result` and four retryable
  `outscraper_task_submitted` records. Neither a caller timeout nor an item
  labelled completed is proof of a qualified email. No blind resubmission
  was performed. The current HTTP waterfall is not poll-only and a changed
  preview may invalidate same-key replay; respect those boundaries.
- Retained BullMQ job hashes in the namespace derived from the **published**
  environment, execution identity, SHA and topology prove scheduled staging
  ticks at 13:00, 13:15 and 13:30 UTC. Their repeat cadence is 900,000 ms and
  completion times are 13:00:01.757, 13:15:14.493 and 13:30:01.490 UTC.
  The 13:15 completion exactly matches the published queue API's retained
  timestamp. The unscoped `bull:` namespace contained September 29 jobs and
  was not used as current production evidence. These jobs return `null`;
  their completed metadata proves actual scheduled fires, **not positive
  qualified-recipient yield at each fire**.

Task 2060 remains open. The 5,000 qualified-recipient target and 100-business,
20-per-vertical acceptance proof have not been achieved. Keep outbound paused,
sends at zero, and all original exclusion, review, deduplication and ownership
guards in force. The completed coverage pass produced no automatically
verifiable imported relationships. Further imported-contact linkage remains
unresolved under the currently implemented narrow website-based rule.
The broader matching/authority path and source-domain quality require correction
within this task; absence of strict eligibility does not establish that every
imported relationship needs human review. Retained source materialization alone
still cannot substitute for contact-side relationship evidence.
Authenticated post-pass health matches the published SHA/build and outbound
pause remains confirmed at epoch 1. No sends were released by this continuation.

### Diagnostic correction — October 2, 2026

The user challenged the zero result. Read-only production checks confirmed:

- All 80,584 retained `sunbiz` / `sunbiz_entity` relationships resolve to
  trusted-ingestion registry rows. Only 988 have a registry website; 79,596
  do not. All eleven separately inspected recovered pairs have their exact
  recovered relationship persisted, but none has a registry website.
  Missing registry website is not missing registry identity.
- The strict policy requires matching contact/business/registry domains,
  a matching corporate-email domain, and exact normalized company names.
  Broader coverage recognizes filing, phone, address, legal-name and DBA
  signals, but classifies recoverable cases rather than automatically writing
  contact links. Its result therefore measures a narrow implemented rule,
  not general automatic relationship feasibility.
- A diagnostic funnel over contacts at or below the frozen watermark finds
  16,644 contacts with canonical website-domain candidates; 1,341 with retained
  registry links; 1,254 with matching registry websites; and 1,199 also matching
  corporate email domains. Only one satisfies the database-style three-name
  equality, and that contact is already verified/projected. These are lookup
  diagnostics, not validated recipients or target-county cohort certification.
- The 1,199 are not all safe matches. For example, a Publix contact's domain
  selects a canonical business named El Marinero Fish Market & Restaurant;
  a Goodwill contact's domain selects Medical Service Organization of Davie.
  In each example, both the canonical business and linked source entity carry
  the same questionable website. The source entity was enriched before the
  canonical business was created. This proves the bad association is present
  in source data too; identifying the exact historical setter needs further
  provenance investigation. Repeating a value in two tables is not independent
  company/domain corroboration.
- Other pairs may be real legal-name/trade-name relationships, such as
  FEAM Aero / F & E Aircraft Maintenance Corporation. That possibility requires
  evidence, not blanket acceptance. Removing legal suffixes alone matches
  only two of the 1,199 contact/registry name pairs, so suffix normalization
  is not the general explanation.
- Null source IDs in ineligible system previews are intentional presentation:
  the service exposes a chosen source only for a uniquely eligible tuple.
  They do not prove the recovered source was absent from the lookup.

Corrective direction: repair source-domain/alias evidence and distinguish
business-relationship verification from email hygiene and outreach eligibility.
Do not disable name/conflict safeguards, treat domain overlap as ownership,
fabricate review, or attribute the entire zero result to missing human review.
This remains part of Task 2060, which is not complete.

## Historical October 1 observations

Task 2060 remains **in progress, blocked on production authority contracts**.
Publication did not complete the requested lead production or replenishment.
This report supersedes earlier production snapshots for the observations below;
it does not claim a successful production execution.

## Fresh observations

The authenticated inventory was captured at 21:39:26 UTC. The downstream
production-replica aggregate was captured at 21:45:50 UTC. Subsequent catalog,
configuration and evidence queries were independent snapshots, not one atomic
measurement.

| Check | Observed result |
| --- | --- |
| Published health | HTTP 200, `ok`, SHA `119079c9b52e06c36e8b7a7666ba0aec5791fa23` |
| Public production | `https://dev.libertybancard.com`; successful autoscale build |
| Publish schema diff | `hasDiff=false`, no statements |
| Outbound authority | Paused, epoch 1 |
| Program | Active, taxonomy 2, program policy 2 |
| Five current v2 packages | Authenticated verification: `ok=true`, no issues |
| Recurrence | Disabled |
| Campaign staging schedule | Zero |
| Runtime selection | `currentRelease=null`, `selectedRelease=null`, `ready=false` |
| Runtime hold | `deployment_identity_unverified` |
| Paid email evidence rows | 0 |
| Ready-held intents | 0 |
| Committed recipient identities | 0 |
| Bridge receipts | 0 |
| Paused SFP enrollments joined to bridge receipts | 0 |
| Active SFP enrollments joined to bridge receipts | 0 |

No provider execution, release selection, recurrence activation, staging, bridge
write, production DDL or publication was performed during this continuation.
Admin authentication and local checkpoint/report writes are not lead output.

## Historical blocker 1: omitted database authority contracts

**Superseded by production read-only verification on October 2, 2026:** all six
triggers listed below are now present. The three function-body hashes match the
development hashes listed below. Do not reuse this historical missing-contract
diagnosis as a current blocker.

At the earlier snapshot, production had the tables, but six required triggers
were absent:

| Table | Required trigger | Definition source |
| --- | --- | --- |
| `contact_business_sfp_link_evidence` | `contact_business_sfp_link_evidence_append_only` | `migrations/0314_sfp_verified_recipient_link_commitments.sql` |
| `sfp_recipient_address_commitments` | `sfp_recipient_commitment_transition` | Same |
| `sfp_recipient_commitment_aliases` | `sfp_recipient_commitment_aliases_append_only` | Same |
| `sfp_enrollment_bridge_holds` | `sfp_enrollment_bridge_holds_append_only` | Same |
| `sfp_runtime_release_selectors` | `sfp_runtime_release_selector_mutation_guard` | `migrations/0319_sfp_runtime_release_selector.sql` |
| `sfp_runtime_release_selection_events` | `sfp_runtime_release_selection_events_immutable` | Same |

The existing `contact_business_link_review_contract` trigger is enabled, but its
`enforce_reviewed_contact_business_link()` function retains the older body,
without the SFP evidence branch. This is an outdated seventh authority contract,
not a seventh absent trigger.

Read-only `md5(prosrc)` comparison:

| Function | Development | Production |
| --- | --- | --- |
| `enforce_reviewed_contact_business_link` | `30910090e380e90ea27bff572d2c5847` | `08832cf0204fbdd3207ff815d10fb9c7` |
| `guard_sfp_runtime_release_selector_mutation` | `b5695b275e00ea8a3dc9be710bdd6a96` | Absent |
| `reject_sfp_runtime_release_selection_event_mutation` | `2a8eed74b0ed97b190811fcbc4b7c3f1` | Absent |

The full runtime bridge guard checks database contracts and function-body
fingerprints. Table presence, successful publication and an empty Publish diff
do not satisfy it. Restoring only tables or only trigger names is insufficient.

**Required resolution:** supported platform/database-operator restoration of
the omitted reviewed function/trigger definitions, followed by independent
read-only catalog and full guard verification. The migration files identify the
reviewed definitions; they are **not instructions to replay either complete
migration** over a partially reconciled production database.

Managed Publish remains the production schema owner. No startup DDL, deployment
build migration, custom production migration executor, fake ledger entries or
direct Agent production DDL is authorized. An identical Publish currently has
no outstanding statements and cannot be presented as a fix for these objects.

Official documentation confirms a human-accessible production Database/My Data
SQL runner:
https://docs.replit.com/features/data-and-storage/work-with-your-data.
That UI's existence does not expand Agent's production mutation permissions or
establish that these missing contracts have been restored.

## Historical blocker 2: no verifiable published deployment identity

**Superseded in part by the October 2 live publisher logs:** the deployed app
now loads a real per-Publish build identity. The current problem is a selected
release mismatch, not an absent build identity. See
[`sfp-enrichment-current-diagnosis.md`](sfp-enrichment-current-diagnosis.md) for
the observed tuples and expired owner lease. Independent publisher verification
and an audited selector transfer remain required; do not auto-select a build.

Routine SFP execution explicitly requires a nonempty `REPL_DEPLOYMENT_ID`; it
rejects the workspace `REPL_ID` fallback because it cannot distinguish
same-SHA redeployments. The production environment inventory contains no
configured `REPL_DEPLOYMENT_ID`. Live admin status independently returns
`deployment_identity_unverified`, with no current or selected release.

Health has a valid artifact SHA and production environment. Queue topology
construction produces a hash. Those facts do not substitute for the missing
deployment identity or independently publisher-verified selection evidence.
The available deployment metadata reports deployment status and domains but
does not expose a deployment identifier.

**Source repair prepared after this snapshot:** the build now generates and
embeds a unique, SHA-bound per-Publish artifact identity. See
[`runbooks/sfp-publish-build-identity.md`](runbooks/sfp-publish-build-identity.md).
This removes the manual dependency on an undocumented platform deployment
variable without falling back to workspace/SHA identity. It is not yet a claim
that production has the corrected artifact. Publish and independent publisher
verification, followed by the audited selector and database prerequisite
checks, remain required.

Do not make up an identifier, relabel the workspace ID as a deployment, replace
publisher proof with health alone, weaken owner fencing or write selector rows
directly. Existing paid-work authorization remains in force; this is not a
request for another microbatch/spending approval.

## Evidence-count limitations

Production still contains 175 rows marked `validated_outreach_eligible`,
representing 12 candidate value hashes, all free-source. All 175 match the
active policy document and have an unexpired decision timestamp. These are
status/evidence-input counts, **not 12 freshly certified qualified recipients**.

An attempted direct join to `provider_observations` matched only 11 eligibility
rows by operation and business subject. No observation token hash equalled the
candidate value hash. Therefore that aggregate is not an adequate reproduction
of canonical validation authority, and its empty strict result must not be
reported as proof of zero genuine valid addresses. Reuse must follow the real
validation/attempt/operation authority and exact hash contracts.

Historical cohort membership has blank vertical fields: county membership
includes 159 distinct businesses in Broward, 252 in Miami-Dade and 114 in Palm
Beach. These are historical membership denominators, not qualified operating
businesses, five-vertical coverage, a global distinct total or achieved output.
The requested 15-pair qualification matrix cannot be inferred from them.

## Resume this same task after prerequisite repair

1. Verify every required function, enabled trigger, CHECK, FK and uniqueness
   contract in production; preserve existing data and repaired Sunbiz indexes.
2. Verify the real published release/deployment and perform audited owner
   selection with genuine publisher evidence.
3. Re-evaluate retained free/contact evidence through canonical validation and
   policy authority; hold genuine source, identity, location, vertical and
   independent-review failures rather than forcing them.
4. Run the already authorized provider retrieval/validation pipeline through
   ordinary reserve/dispatch/settle boundaries. Do not reinstate financial caps.
5. Enable bounded positive staging and the paused native bridge through audited
   controls once their prerequisites pass.
6. Produce and measure the requested 20 distinct businesses per vertical,
   progressing toward 5,000 globally unique qualified recipients.
7. Capture at least two real scheduled replenishment measurements with new
   full-chain receipts. Keep outbound paused and verify zero sends or
   unauthorized GHL dispatch.

The production-output target, source/account compatibility, exact outstanding
qualification holds and replenishment yield remain unverified. No completion,
production certification or positive output rate is claimed.