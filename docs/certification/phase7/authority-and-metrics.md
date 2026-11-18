# Authority and measurement contract

The implementation branch is `codex/phase7-conversion-optimization`, created in its own worktree from `361886ebde082c1d5e16a5cea7a13b54ce7b99c7`. The original checkout is untouched. No production mutation, publication, enrollment, provider call, send, historical replay or website revision 7–10 change is part of this work.

## One experiment and content path

| Concern | Owner and behavior |
|---|---|
| Design, commands, evaluator, human decision | `server/services/cro07-experiments.ts`; current database actor/account, immutable semantic digest, optimistic revision and durable command receipt |
| Copy artifacts and approval | Existing `cr06-premium-campaigns.ts`, seven-artifact review-only family and normal CR06 approval snapshots; approved records are never edited |
| Paired campaign/sequence identity | Existing `cro03/sfp-campaign-packages.ts` live content hash; Phase 7 validates the current pair through `phase7-content-binding.ts` |
| Allocation | Existing `sequence-ab-authority.ts`, extended with immutable canonical-business assignments and overlap exclusion; no mutable winner branch |
| Dispatch | Existing sequence worker, contact/reply/eligibility/release/capacity owners and SMTP; a design grants no transport permission |
| Final content | Binding validates real SFP subject/body rendering; SMTP records the final HTML, text, sender, recipient, reply address and unsubscribe-header envelope hash immediately before I/O |
| Exposure | Definitive outbound accepted/sent receipt with provider message ID and final envelope; assignment, skip, failure and unknown dispatch do not count |
| Reply observation | Existing authenticated Gmail reader; exact RFC reference, recipient and pinned reply mailbox required. Automated, ambiguous, unmatched and invalid-time observations are retained separately |
| Qualification | Versioned admin review of an actual correlated human-reply receipt. No arbitrary success boolean, sample counter, or caller-chosen attribution key |
| Provider diagnostics/safety | Existing CRO07 signature verifier with a distinct typed SMTP sequence lineage. Explicit source/account configuration and exact final-envelope/message ownership; no alias to the denied CRO07 transport's attempt IDs |
| Suppression/reachability | Existing consent authority, never a new suppression table |
| Scheduled work | Existing A/B scheduler entrance calls one bounded projector/reconciler/evaluator. No post-send evaluator and no automatic adoption |

Initial support is subject-only SFP plain-text email through the existing SMTP path. Bodies, cadence, sender policy, audience and CTA are shared. Legacy SMS/body tests are retained as unsupported, unverified history. Generic editor and storage allowlists reject experimental result/config/approval/actor fields.

## Statistical contract

Allocation is 50/50 by canonical business and immutable design hash. Collection and outcome maturity are fixed before starting. The supported analysis is two-sided Fisher exact, Bonferroni-adjusted for the frozen family size, with Wilson arm intervals, a difference interval and sample-ratio imbalance hold. The design records a baseline/MDE/power rationale and enforces a conservative normal-approximation planning floor; planning assumptions are never represented as observed performance.

The primary numerator is distinct exposed businesses with a verified, human-qualified reply inside the exposure's maturity window and the fixed experiment horizon. The denominator is distinct exposed businesses. Accepted/sent is not a claim of confirmed delivery. Opens and clicks remain provider observations, not human intent. Missing feedback coverage or pending qualifications hold evaluation. The telemetry checkpoint defaults to unavailable and requires separate real integration/coverage certification; configuration alone is not evidence of complete historical coverage.

Every evaluator result write uses current lease token, experiment revision and PostgreSQL `clock_timestamp()`. An expired evaluator cannot write a snapshot or clear a successor's lease. Stops are durable, audited and revoke new experimental dispatch. A recommendation requires human acceptance and creates a NEW complete CR06 draft family; publication and release remain separate.

## Business journey report

The version is `business-sales-journey-v1`, unit one canonical business and sales deal. Repeat deals are separate journeys; reopening a deal does not create another journey for that same deal. Ordered stages are Lead → Engaged → Statement Requested → Statement Received → Proposal Sent → Application → Closed Won. A later valid milestone can follow an earlier out-of-order observation; missing prior stages are never inferred.

Lead comes from a retained accepted acquisition occurrence, not contact discovery/import. Engagement requires verified qualified interaction, not delivery/open/OOO/bounce/opt-out. Saved request, protected document, definitive proposal-send timestamp, canonical application transition and Closed Won transition have same-transaction evidence bridges. The ledger contains IDs and classification/dimensions, not statement contents or financial revenue.

Corrections append source versions. Reads select the latest correction known at the ingestion cutoff and retain acquisition dimensions. Unknown/unlinked/test facts remain separate. The non-sending repair reads the source's explicit contact/deal relation; it never picks a nearest deal by email, name or time. Historical reconstruction is not run by this branch and coverage remains partial.

Chart, breakdown, evidence and CSV use the same cohort SQL and observation cutoff. Reads are repeatable-read, with bounded ranges, parameters and five-second statement deadlines. Export uses a server cursor over every matching row, stable order, a sixty-second deadline and formula escaping; it is not the visible page. Admin/manager access is server enforced. No earned-revenue source is introduced.

Today/Overview and Operator legacy panels are labelled independent Website & CRM event activity, not cohort conversion. Growth counts production contact creation and keeps unknown attribution; 1,000/week versus 1,000/month remains an unapproved planning conflict. Retained SDR snapshots use Eastern half-open windows, explicit UTC serialization for timestamp-without-zone columns, numeric counts, matching vertical/state/source grain and atomic replacement. Deal totals without an SDR source chain occupy an explicit unknown group.
