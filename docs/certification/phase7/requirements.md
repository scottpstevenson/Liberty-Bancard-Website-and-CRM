# P7-01–P7-48 acceptance dispositions

These rows distinguish implemented code, exercised local evidence and externally blocked acceptance. No row is passed merely because UI exists or a source string matches. See evidence files and the authority map for scope.

| ID | Requirement | Disposition | Evidence / remaining control |
|---|---|---|---|
| P7-01 | Baseline source and serving identity | PARTIAL: fixed source baseline; fresh serving readback unavailable | `evidence/baseline-source-census.json`; code baseline and recorded serving identity are separate. |
| P7-02 | Schema and applied-object census | LOCAL VERIFIED; production catalog unavailable | `phase7-schema-status.ts`, `test-phase7-upgrade.ts`; exact native routines and guards checked locally. |
| P7-03 | Writer, route, worker and reader authority census | IMPLEMENTED; owner map retained | `authority-and-metrics.md`; canonical command, allocation, receipt, feedback and reporting owners. |
| P7-04 | Server-owned experiment fields | LOCAL TESTED | 64 pure behavior checks; strict editable schema at routes and storage |
| P7-05 | Immutable design/content and semantic hashes | LOCAL TESTED | `cro07-experiments.ts`, `phase7-content-binding.ts`; approved hashes and immutable native guard. |
| P7-06 | Canonical experiment binding | LOCAL TESTED | `sequence-ab-authority.ts`; current paired SFP content and CR06 approved artifacts required. |
| P7-07 | Stable business allocation and overlap exclusion | LOCAL TESTED | Private PostgreSQL concurrent workers keep one business arm |
| P7-08 | Approved subject-only arms | LOCAL TESTED; live review pending | `phase7DesignSchema` rejects body/cadence/sender changes and blank/equivalent subjects. |
| P7-09 | Final dispatch safety and content identity | LOCAL TESTED; no real transport call | Real SFP rendering check plus immutable final SMTP envelope binding |
| P7-10 | Definitive receipt-backed exposure | LOCAL TESTED | Failed-first/successful-retry produces one exposure; foreign provider ID refused |
| P7-11 | Verified separate outcomes and qualification | LOCAL TESTED: SendGrid signature/account/message lineage and forward coverage owner; actual provider/mailbox continuity unavailable | Authenticated mailbox/account/message relation, automated exclusion and one human qualification |
| P7-12 | Deduplication and replay repair | LOCAL TESTED; no historical-message replay | Unique receipt/assignment/provider identities; `projectPhase7Exposures` repairs retained definitive receipts only. |
| P7-13 | Frozen planning, horizon and statistics | LOCAL TESTED with independent arithmetic fixture | `shared/phase7-experiment.ts`; Fisher exact, confidence interval, planning floor and SRM behavior checks. |
| P7-14 | Lease/revision fencing | LOCAL TESTED, including expired evaluator recovery | An expired evaluator resumes after a successor and cannot persist a snapshot |
| P7-15 | Human new-draft handoff | LOCAL TESTED draft-family owner; no promotion/publish | Seven new draft artifacts; approved-family hashes/documents unchanged |
| P7-16 | Frozen guardrail stop and cancellation | LOCAL TESTED | Typed provider complaint crosses the frozen threshold and atomically stops dispatch |
| P7-17 | Role, account and ownership privacy | LOCAL TESTED | Real session API checks for admin/manager/agent/merchant/affiliate/partner/anonymous |
| P7-18 | Existing send, consent and release gates | PRESERVED; production unchanged | `sequence-worker.ts`, `smtp-email.ts`; existing contactability, pause, capacity and release owners remain authoritative. |
| P7-19 | Installed-copy inventory and review screen | IMPLEMENTED: bounded inventory and shared automated checks; fresh live full-copy audit unavailable | `phase7-draft-workspace.ts`, `Phase7CopyInventory.tsx`; installed sequences/campaigns/templates/workflow inventory. |
| P7-20 | Ranked three-vertical refresh | PARTIAL: three complete provisional drafts; eligible-volume ranking held | `copy-review-drafts.json`; current eligibility endpoint ranks distinct ready businesses; signed-in selection unavailable. |
| P7-21 | Branded previews, tokens and CTA safety | IMPLEMENTED: shared final preview and missing-data personas; live footer evidence pending | `message-final-preview.ts`, `FinalEmailPreview`; actual renderer, missing-persona cases and existing copy/token/link lint. |
| P7-22 | Three draft subject tests | REVIEW CANDIDATES: no invented production approval IDs or live activation | `copy-review-drafts.json`, `phase7-draft-workspace.ts`; review designs require actual CR06 approval before freeze. |
| P7-23 | Real eligibility dry run and insufficiency | IMPLEMENTED READ-ONLY OWNER; live execution held by authentication | `phase7-draft-workspace.ts`; review drafts retain current cadence, pins and readiness holds. |
| P7-24 | Business journey/cohort definition | LOCAL TESTED; historical coverage explicitly partial | `shared/conversion-funnel.ts`; seven ordered stages, explicit filters and IANA Eastern boundaries. |
| P7-25 | Authoritative seven-stage writer bridges | IMPLEMENTED; live historical source reconciliation not run | Migration 0387 canonical milestone triggers plus verified qualification bridge; no nearest-record matching. |
| P7-26 | Durable atomic evidence and source corrections | LOCAL TESTED | Immutable ledger and business-transaction rollback negative control |
| P7-27 | Unknown, unlinked, late and excluded facts | IMPLEMENTED; unmatched/ambiguous/late are not promoted to success | `phase7-feedback.ts`, `phase7-sendgrid.ts`, `phase7-evidence-reconciliation.ts`; retained exact links, signed crosswalk and explicit unknown reasons. |
| P7-28 | Canonical dimensions and attribution provenance | IMPLEMENTED; unavailable chains remain unknown | Migration 0387 freezes acquisition dimensions; latest source version is chosen at the report ingestion cutoff. |
| P7-29 | Eastern/DST boundaries and atomic SDR replacement | LOCAL TESTED: 25-hour DST day, exact grain, numeric counts and rollback | Database fixture at both ends of the Eastern DST fall-back day; forced insert fault preserves prior snapshot |
| P7-30 | Versioned bounded cohort API | LOCAL TESTED | `conversion-funnel.ts`, analytics routes; strict versioned query contract, repeatable-read, bounded range and deadlines. |
| P7-31 | Matching chart, breakdown, drilldown and CSV | LOCAL TESTED; full cursor export, fixture scale | Same cohort SQL, one observation cutoff and full cursor CSV |
| P7-32 | Retained reader terminology and compatibility | IMPLEMENTED; existing reporting guards pass | `GrowthAnalytics`, `SDRAnalytics`, Today and Operator summaries; independent activity is labelled separately. |
| P7-33 | Protected scope and snapshot consistency | LOCAL TESTED | `test-phase7-browser.ts`; real persisted role sessions and unauthorized aggregate/export controls. |
| P7-34 | Reports and Sequences reconciliation | LOCAL TESTED | `GovernedExperiments.tsx`, `ConversionFunnel.tsx`; Reports codec and workspace identity preserve canonical URL state. |
| P7-35 | Responsive, accessibility and retained URL state | LOCAL TESTED at five widths and both system themes; phone/WebKit unexercised | Mounted actual funnel, explicit desktop-layout selection after phone notice, no document overflow |
| P7-36 | Distinct loading/error/conflict/stopped states | LOCAL TESTED for empty/unavailable/invalid/permission flows; populated mature-winner UI not certified | `test-phase7-browser.ts`; actual mounted empty/error/permission/invalid URL controls; no false zero on failure. |
| P7-37 | Public mobile matrix | LOCAL VERIFIED: 72 routes × five widths × two themes; visible mobile controls and form text pass | Compiled local matrix and native 200% Chromium zoom; no form submitted |
| P7-38 | Image and claim provenance and budgets | NO IMAGE REBUILD: derivatives/provenance retained; lazy images verified; no production performance-budget claim | `test-phase7-public-mobile.ts`; lazy scroll precedes image checks; derivatives/provenance unchanged. |
| P7-39 | Deployed artifact/source-bound readback | NOT PUBLISHED | Local build receipt records the code SHA/build ID. Production serving readback requires the reviewed deployment. |
| P7-40 | Bounded queries and performance | BOUNDED SQL/EXPORT; fixture-scale timings only, no production-scale load certification | `conversion-funnel.ts`; five-second statement timeout, sixty-second export deadline and maximum 366-day cohort. |
| P7-41 | One non-sending job owner | IMPLEMENTED, bounded/replayable and non-sending | `ab-test-worker.ts`; bounded durable continuation cursor; no transport or automatic content adoption. |
| P7-42 | Concurrency, restart, failure and recovery | LOCAL TESTED: concurrent allocation/native replicas, expired lease, rollback and guardrail stop | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-43 | Fresh/upgrade/native-object migration integrity | LOCAL VERIFIED: fresh/0386-upgrade parity, validated checks, replay, drift and missing prerequisites | Socket-only private PostgreSQL baseline and upgraded catalogs compare equal |
| P7-44 | CI and pre-deploy registration | REGISTERED IN BOTH MANIFESTS; selected suite passes are not full-roster approval | scripts/ci-suite-manifest.ts --check; new suites are mandatory and capability classified |
| P7-45 | Release and rollback evidence | CONCRETE HANDOFF; no publish/rollback performed | `release-and-rollback.md`; read-only schema command, candidate review and evidence-preserving rollback. |
| P7-46 | Phase 6 dependency state | BASELINE HOLDS: 41 existing TypeScript errors and legacy CRO07 provider-evidence fixture failure reproduced unchanged | baseline-types.log vs candidate log: 41 identical error headers; baseline CRO07 assertion identical |
| P7-47 | Separate engineering/live/device acceptance | SEPARATE STATES RETAINED; no live observation or device claim | `device-checklist.md`; local Chromium, deployed readback, real device and elapsed observation are distinct. |
| P7-48 | Roadmap and owner handoff | LOCAL BRANCH HANDOFF; unresolved acceptance is explicit | This ledger, `roadmap-status.md` and `release-and-rollback.md` identify concrete remaining work. |
