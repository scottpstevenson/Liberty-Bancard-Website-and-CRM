# P7-01–P7-48 acceptance dispositions

These rows distinguish implemented code, exercised local evidence and externally blocked acceptance. No row is passed merely because UI exists or a source string matches. See evidence files and the authority map for scope.

| ID | Requirement | Disposition | Evidence / remaining control |
|---|---|---|---|
| P7-01 | Baseline source and serving identity | PARTIAL: fixed source baseline; fresh serving readback unavailable | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-02 | Schema and applied-object census | LOCAL VERIFIED; production catalog unavailable | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-03 | Writer, route, worker and reader authority census | IMPLEMENTED; owner map retained | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-04 | Server-owned experiment fields | LOCAL TESTED | 47 pure behavior checks; strict editable schema at routes and storage |
| P7-05 | Immutable design/content and semantic hashes | LOCAL TESTED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-06 | Canonical experiment binding | LOCAL TESTED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-07 | Stable business allocation and overlap exclusion | LOCAL TESTED | Private PostgreSQL concurrent workers keep one business arm |
| P7-08 | Approved subject-only arms | LOCAL TESTED; live review pending | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-09 | Final dispatch safety and content identity | LOCAL TESTED; no real transport call | Real SFP rendering check plus immutable final SMTP envelope binding |
| P7-10 | Definitive receipt-backed exposure | LOCAL TESTED | Failed-first/successful-retry produces one exposure; foreign provider ID refused |
| P7-11 | Verified separate outcomes and qualification | LOCAL TESTED; live reader/subscription coverage unavailable | Authenticated mailbox/account/message relation, automated exclusion and one human qualification |
| P7-12 | Deduplication and replay repair | LOCAL TESTED; no historical-message replay | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-13 | Frozen planning, horizon and statistics | LOCAL TESTED with independent arithmetic fixture | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-14 | Lease/revision fencing | LOCAL TESTED, including expired evaluator recovery | An expired evaluator resumes after a successor and cannot persist a snapshot |
| P7-15 | Human new-draft handoff | LOCAL TESTED draft-family owner; no promotion/publish | Seven new draft artifacts; approved-family hashes/documents unchanged |
| P7-16 | Frozen guardrail stop and cancellation | LOCAL TESTED | Typed provider complaint crosses the frozen threshold and atomically stops dispatch |
| P7-17 | Role, account and ownership privacy | LOCAL TESTED | Real session API checks for admin/manager/agent/merchant/affiliate/partner/anonymous |
| P7-18 | Existing send, consent and release gates | PRESERVED; production unchanged | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-19 | Installed-copy inventory and review screen | IMPLEMENTED: bounded inventory and shared automated checks; fresh live full-copy audit unavailable | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-20 | Ranked three-vertical refresh | PARTIAL: three complete provisional drafts; eligible-volume ranking held | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-21 | Branded previews, tokens and CTA safety | IMPLEMENTED: shared final preview and missing-data personas; live footer evidence pending | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-22 | Three draft subject tests | REVIEW CANDIDATES: no invented production approval IDs or live activation | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-23 | Real eligibility dry run and insufficiency | IMPLEMENTED READ-ONLY OWNER; live execution held by authentication | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-24 | Business journey/cohort definition | LOCAL TESTED; historical coverage explicitly partial | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-25 | Authoritative seven-stage writer bridges | IMPLEMENTED; live historical source reconciliation not run | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-26 | Durable atomic evidence and source corrections | LOCAL TESTED | Immutable ledger and business-transaction rollback negative control |
| P7-27 | Unknown, unlinked, late and excluded facts | IMPLEMENTED; unmatched/ambiguous/late are not promoted to success | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-28 | Canonical dimensions and attribution provenance | IMPLEMENTED; unavailable chains remain unknown | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-29 | Eastern/DST boundaries and atomic SDR replacement | LOCAL TESTED: 25-hour DST day, exact grain, numeric counts and rollback | Database fixture at both ends of the Eastern DST fall-back day; forced insert fault preserves prior snapshot |
| P7-30 | Versioned bounded cohort API | LOCAL TESTED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-31 | Matching chart, breakdown, drilldown and CSV | LOCAL TESTED; full cursor export, fixture scale | Same cohort SQL, one observation cutoff and full cursor CSV |
| P7-32 | Retained reader terminology and compatibility | IMPLEMENTED; existing reporting guards pass | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-33 | Protected scope and snapshot consistency | LOCAL TESTED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-34 | Reports and Sequences reconciliation | LOCAL TESTED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-35 | Responsive, accessibility and retained URL state | LOCAL TESTED at five widths and both system themes; phone/WebKit unexercised | Mounted actual funnel, explicit desktop-layout selection after phone notice, no document overflow |
| P7-36 | Distinct loading/error/conflict/stopped states | LOCAL TESTED for empty/unavailable/invalid/permission flows; populated mature-winner UI not certified | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-37 | Public mobile matrix | LOCAL MATRIX: 72 routes × five widths × two themes; stricter tap/font rerun pending | Compiled local matrix and native 200% Chromium zoom; no form submitted |
| P7-38 | Image and claim provenance and budgets | NO IMAGE REBUILD: derivatives/provenance retained; lazy images verified; no production performance-budget claim | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-39 | Deployed artifact/source-bound readback | NOT PUBLISHED | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-40 | Bounded queries and performance | BOUNDED SQL/EXPORT; fixture-scale timings only, no production-scale load certification | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-41 | One non-sending job owner | IMPLEMENTED, bounded/replayable and non-sending | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-42 | Concurrency, restart, failure and recovery | LOCAL TESTED: concurrent allocation/native replicas, expired lease, rollback and guardrail stop | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-43 | Fresh/upgrade/native-object migration integrity | LOCAL VERIFIED: fresh/0386-upgrade parity, validated checks, replay, drift and missing prerequisites | Socket-only private PostgreSQL baseline and upgraded catalogs compare equal |
| P7-44 | CI and pre-deploy registration | REGISTERED IN BOTH MANIFESTS; selected suite passes are not full-roster approval | scripts/ci-suite-manifest.ts --check; new suites are mandatory and capability classified |
| P7-45 | Release and rollback evidence | CONCRETE HANDOFF; no publish/rollback performed | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-46 | Phase 6 dependency state | BASELINE HOLDS: 41 existing TypeScript errors and legacy CRO07 provider-evidence fixture failure reproduced unchanged | baseline-types.log vs candidate log: 41 identical error headers; baseline CRO07 assertion identical |
| P7-47 | Separate engineering/live/device acceptance | SEPARATE STATES RETAINED; no live observation or device claim | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
| P7-48 | Roadmap and owner handoff | LOCAL BRANCH HANDOFF; unresolved acceptance is explicit | Relevant canonical owner is named in authority-and-metrics.md; remaining live/candidate checks retain their real status. |
