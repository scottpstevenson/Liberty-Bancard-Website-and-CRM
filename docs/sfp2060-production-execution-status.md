# SFP production continuation — October 1, 2026

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

## Blocker 1: omitted database authority contracts

Production has the tables, but **six required triggers are absent**:

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

## Blocker 2: no verifiable published deployment identity

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