# Existing-contact enrichment: preflight and build

## Status: not complete

This register reconciles the supplied October 2 audit with the current workspace,
the published build and read-only production results. It distinguishes implemented
workspace repairs from deployed results. No production record was changed during
this investigation. No discovery/validation request was dispatched, outbound was
not released, and provider spending controls were not changed.

Production health reported build `1fe28bc0d1ff9ad86e777c96b67902701f159fd8`,
built `2026-10-02T21:40:33.861Z`, publish build
`a17e3a59-81fe-4ad6-80ab-0b2b27b8ec61`. Workspace baseline was
`bfde26c879deee5afdaf56257d44c8bca7269680` before the changes below.
The supplied audit inspected older builds; its findings were not treated as current
without verification.

## Finding register

| Finding | Reconciliation | Current disposition |
|---|---|---|
| Optional Apollo is unavailable | Read-only production checks on October 2 found 82 failed organization-search operations in the preceding hour, all carrying `APOLLO_HTTP_401` (latest observed at 23:30:23 UTC). The user states Apollo has no credits and must not block other work. The HTTP status does not establish the precise account/key cause. | Apollo is not a prerequisite for this task. Workspace repairs isolate its readiness failures and stop repeated rejected calls while keeping other sources and ZeroBounce independent. No credential or provider-control change was made. |
| Email supply and repeated MX prechecks | Current usable cohorts contain 2,424 distinct businesses, but only 62 have staged, non-quarantined free-email candidates (161 distinct hashes). No paid email/owner-name/owner-title evidence rows were returned. The past-day validation ledger contains 772 no-MX stage items across 11 businesses and 60 address hashes. | Confirmed handoff shortage and repeated small-population prechecks. This does not prove an identical candidate is reselected within the same cohort, nor justify bypassing DNS or employer authority. |
| Existing inventory versus independent employer evidence | A subsequent read-only census found 154,012 non-archived, non-test/demo/synthetic contacts: 153,168 contain email and 152,496 contain website; 153,980 are unlinked. Only 163 have a retained primary-source event in that query. Canonical source links comprise 81,617 Sunbiz links, 17 with raw evidence. | Existing email inventory is substantial; do not attribute the recipient shortfall solely to discovery. These aggregates do not establish employer correctness or complete provenance, and the canonical-source-link census does not cover separate paid/free provider ledgers. The broader authority and highest-yield queue remain original-task scope, not completed work. |
| Manual release/SHA selection blocks routine publishes | The automatic publish-handoff repair predates this build. | Already fixed; not replaced or reverted. |
| High-confidence preview HTTP 500 | The audited request had already recovered; current code chunks location IDs. No new production reproduction was obtained. | Unverified as a current defect. Full-pool ROI/selection pagination remains deferred. |
| Five empty business-vertical rows | Production classification/cohort data includes all five v2 groups. | Earlier zero-row conclusion is stale. Classification counts still do not establish recipients. |
| AI target admission | Structured allowlisted IDs exist, but this investigation did not certify independent AI target-to-recipient conversion. | Unverified; no classifier-admission or frozen-version mutation. |
| Exact-label contact filters return zero | Exact labels Auto Repair, Medical/Dental/Medspa and Gym have no production rows, while their raw-label families are large. | Confirmed. Shared, versioned search/report aliases implemented and tested against real SQL. |
| Contact classification projection | SFP writes classification evidence, not bulk contact verticals. | Raw labels retained. Search can also use current high-admission business classification, but only through a current verified, projection-consistent employer link. |
| Browser must remain open for census pages | The mounted component had a POST-per-page loop. | Removed. Authorized census pages are drained by the recurring server job with transaction-serialized checkpoints and an explicit pause. |
| Suggestion scan requires one click per 100 contacts | Existing reconciliation intentionally stopped at ready after each page. | Server processing added. Suggestions remain suggestions; these counts are not verified links. |
| Empty evidence selector and false server-citation promise | Existing writer required a returned event; the UI's promise was false. | Actual retained, attributable, business-bound events are resolved automatically; missing evidence is an explicit hold. No fabricated citation and no internal-ID selector. |
| Routine automatic linking | Existing system writer has a narrower Sunbiz/name/domain contract than the manually confirmed matcher. | Durable, leased automatic processing now reuses that exact canonical writer and database guard. **Broader filing/address/phone or trusted-employer authority is not implemented by this build.** Name-only matches remain outside automatic authority. |
| Current production guard installation | Review, system-evidence append-only and SFP-evidence append-only functions exist; their observed hashes were retained. | No guard was weakened or replaced. Automatic writes fail closed if the expected guard is absent. |
| Named-email queue repeats eligibility history | Production has 212 contact-source rows for 18 address hashes and 18 businesses. | UI query now selects the current business/address/contact/hash-version/policy decision rather than displaying repeated history. History is retained. |
| CRM status differs from SFP validation | Contact 159462 has a current verified link but unvalidated CRM status. Its latest SFP rows are valid/review-required and have no operation ID. | Separate read-only CRM readiness projection implemented, with current address hash, receipt, employer link, master-lead, intent and enrollment checks. It does not relabel unresolved receipts as validated or overwrite CRM status. |
| No common three-recipient reservation | Global address commitments existed, but no common business-slot gate existed in typed staging. | Transactional slots 1–3 added at typed contact/free/paid staging. The first slot is primary, others alternates. Replays consume no additional slot; cross-business address ownership conflicts are held. |
| Four historical Outscraper tasks waiting | Retained ledger currently contains completed tasks and one submitted task in the inspected latest page. | Historical “four waiting” is not a verified current count. Original task/operation references retained; no polling or resubmission initiated. |
| 28 staging retries | Production retains 27 `SFP_STAGING_RECEIPT_SUBJECT_OR_ADDRESS_CHANGED` and one `SFP_STAGING_SOURCE_REFERENCE_DRIFTED` retries. | Confirmed holds. No source/receipt pin was overwritten to force them through. |
| 72 intents vs 70 consumer completions | Production contains 63 already-bridged completions and seven created completions, plus two held items. | These are processing receipts, not 70 new unique recipients. Holds remain `EMAIL_MATCH_UNCORROBORATED` and `recipient_assignment_not_yet_accepted`. |
| Broad telemetry fails as a unit | The historical UI reported intermittent failures. Individual bounded production reads succeeded here; that does not certify the entire live telemetry endpoint. | Per-query observability and broad-query optimization remain unverified/deferred. |
| ROI order favors coverage before outreach yield | No new global highest-yield selection certification was performed. | Remaining build gap. This build does not claim to deliver a global cost/yield-ranked business queue. |

## Contact vertical proof

Mapping version: `contact-read-sfp-v2-1`. It is a read taxonomy, not employer proof,
business classification admission or outreach permission.

These are production raw-label family totals, computed read-only with the same
mapping used by search. Active email excludes archived, null and blank addresses.
The verified column requires a current verified decision consistent with
`contacts.business_id`; it is not an independent-identity or receipt certification.

| Canonical group | Production contacts | Active email contacts | Current verified links |
|---|---:|---:|---:|
| Automotive | 45,740 | 45,098 | 1 |
| Healthcare | 22,719 | 22,668 | 3 |
| Beauty/Spa | 3,916 | 3,914 | 3 |
| Construction/Trades/Home Services | 5,725 | 5,717 | 24 |
| Fitness/Recreation | 10,342 | 10,335 | 1 |
| Unmapped / other production labels | 65,574 | 65,436 | 0 |
| Unmapped test records, excluded from Production scope | 402 | 398 | 0 |

Before: exact legacy filters Auto Repair and Medical/Dental/Medspa have zero
production rows. After the **workspace** mapping: those selections retrieve the
Automotive and Healthcare families respectively. The actual read query, including
verified-business projection SQL, was executed against a migrated disposable
database with positive Auto and medical fixtures. Production API/UI after-publish
counts are still pending; the table is not presented as a deployed-after screenshot.

Unmapped includes legitimate non-target industries, not just blank values. Mapping
does not resolve a conflicting employer or qualify all 87,732 target-family active
emails. Business/contact conflicts still require source-level review.

## Before/after recipient funnel

There was no production mutation, so the production recipient delta from this
build is **zero**. Workspace repairs and test fixtures are not production yield.

| Measure | Production baseline | Production after these workspace changes |
|---|---:|---:|
| Frozen census processed | 50,500 / 154,418 | Not advanced by this investigation |
| Partial-census strict-auto eligible | 0 | Not certified after publish |
| Partial-census review | 17,684 | Not converted into verified recipients |
| Current verified contact links | 32 contacts / 29 businesses | Unchanged |
| Contact-source eligibility history | 212 rows / 18 addresses / 18 businesses | Unchanged; review display deduplicated in workspace |
| Free-source stored eligible decisions | 69 rows / 29 hashes / 25 businesses | These are stored decisions, not a fresh independent chain count |
| Ready-held staging intents | 72 rows, 32 address hashes, 28 businesses; zero contact-source intents | Unchanged |
| Global recipient commitments | 32 reserved, 31 committed, 28 committed businesses | Unchanged |
| Current-link + paused-enrollment chains | 31 | Not a full receipt/source-quality certification |
| Committed chains with operation ID on eligibility | 23 / 31 | Eight lack that original pin |
| New automatic commits from this investigation | 0 | No production activation |

Business capacity distribution, including the reserved commitment: 24 businesses
have one address and four have two. None has three or more in this snapshot.

A join through projected `contacts.email_token_hash` returned zero matching
observations. That result is **not proof that the 23 original-operation-pinned
records lack valid receipts**: the projection itself may be absent/stale. The
new CRM projection calculates the canonical current-address hashes and checks
actual retained operation/receipt pins rather than treating this field as authority.

## Real retained chains, not newly generated test records

Read-only samples below already existed in production. Each sampled committed row
has a master lead, current link and paused enrollment. Missing operation pins remain
unresolved; a valid stored outcome or future TTL alone does not settle them.

| Business / contact | Link decision | Master lead | Intent | Paused enrollment | Operation / receipt |
|---|---|---|---|---:|---|
| 14817 / 159476 | e100e65b-93ff-418a-aadb-9440dd38dca4 | 103dd837-2af7-48e3-a58f-c706eb32dfe2 | 35ba015d-88fe-4be6-b754-552673042e38 | 30895 | c9910de3-1115-4abd-91e4-0021298e5ef4 / e25a39ce-8ec8-46ef-a42d-2f7c3f41ca74 |
| 14440 / 159475 | 2b405255-7574-47ba-ba0b-b425479df7da | 2e737bf2-d81d-4873-b0f9-ae5fc497bafe | 5e6a367f-18e1-4391-ac5b-dfdfe0d854da | 30894 | Missing original operation/receipt pin |
| 12933 / 159474 | 9d8b3c46-0392-4a40-b22e-acc126457536 | 5673f495-5c3a-43e9-84cd-49f31b06b967 | 41262dc1-7d1c-4338-a88e-95e7482b0461 | 30893 | Missing original operation/receipt pin |
| 11433 / 159473 | 899aed94-03f3-4495-9c50-a9a8d77cb1de | c864d786-45cc-43ea-b0d9-c2c9c40d31de | d7cbea7e-2b83-4b51-adb0-98cd632a7878 | 30892 | Missing original operation/receipt pin |
| 38896 / 159472 | 2f39ec20-3adb-47fa-842c-cf70fe858fb8 | 811343ef-f3a2-4266-927d-16a93b69f0ce | 2420cfc8-b48e-4dfd-ad68-c76d2d034258 | 30891 | 8848b349-356b-42df-ace8-d73517b49e92 / bb61a0aa-79f8-436d-ba98-10ee635be9c2 |

These samples prove retained transitions, not that this unpublished build moved
new real contacts end to end.

## False-link review

Contact 159462 currently links to business 11009 with decision
`ad9e5b64-978b-4941-852c-79cdad07ab66`, revision 1. The audit's “no associated
company” conclusion is therefore stale as database state, but its Roofing versus
`plazaconstruction.com` concern is **not resolved by this link row**.

The row remains named-review-held, with 21 eligibility-history records and no
operation ID on the latest sampled decisions. No approval was issued. Business
80935's prior high-confidence classification does not certify an address or person.

The five retained-chain samples establish linkage/state consistency only. They are
not an independent external employer-verification sample, so no zero-false-link
rate or confusion matrix is claimed. That acceptance item remains open.

## Verification and remaining acceptance

Passed:

- TypeScript check and production build.
- Optional-provider isolation unit tests and a focused disposable-PostgreSQL
  certification with 17 assertions. A recent Apollo rejection leaves
  Outscraper and ZeroBounce ready; later success clears the hint, and disabled
  Apollo remains local to that provider. The real validator records a no-MX
  rejection without a provider call, selects a different address next, and
  dispatches it to the fake ZeroBounce transport with Apollo disabled. No
  external provider calls or production writes occurred.
- Validation drainage now treats persisted precheck/reuse decisions as progress,
  rather than exhausting a cohort solely because no paid call occurred.
- Existing census execution and exact-source receipt-projection recovery tests.
- New disposable-PostgreSQL certification: 52 SQL/UI aliases; positive Auto and
  medical search fixtures; simultaneous four-address contention admits exactly
  three slots; replay does not consume capacity; cross-business address conflict
  is rejected; real incremental/readiness SQL parses and executes; an uninitialized
  program performs no automatic writes.
- Signed-in Contacts UI rendered through the normal auth flow in a private,
  disposable offline fixture. It was **not the deployed production UI**.

Remaining:

The older validation-handoff certification currently stops at its legacy
attestation-refresh TTL assertion (`FIX1-a`), before validation executes.
That check was not bypassed and the retired startup-signing flow was not
restored. The focused certification above verifies this repair separately;
it does not establish that the older full suite passes.

1. Publish the repairs and verify the authenticated deployed filters, holds,
   controls and CRM projection; demonstrate new real transitions.
2. Implement/certify the broader independently corroborated identity authority
   against the real database guard; the existing narrow rule is still insufficient
   for this population. Do not replace it with automatic name-only confirmation.
3. Resolve current receipt/source drift and named-policy holds using genuine
   retained evidence, including the eight unpinned committed-chain rows and the
   18 contact-source addresses without operation pins. Do not manufacture receipts.
4. Supply the global highest-qualified-yield business queue and safe deterministic
   named-recipient route, with current policy authority and cheap-evidence-first
   prioritization. These are not certified by the new cursor worker.
5. Independently sample employer correctness, certify a real 100-business pilot
   with 20 businesses per vertical, then scale to 5,000 globally unique qualified
   recipients. With three slots per business, 5,000 needs at least 1,667 businesses.

The task remains open. Census completion, available candidates, successful tests,
existing commitments and provider-result totals are not substitutes for these
acceptance conditions.