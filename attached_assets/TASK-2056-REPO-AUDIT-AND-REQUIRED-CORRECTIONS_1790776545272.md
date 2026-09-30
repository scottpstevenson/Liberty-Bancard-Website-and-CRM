# Task 2056 repository audit and required corrections

## Verdict

**APPROVED FOR BUILD — CORRECTIONS INCORPORATED.** Use Task #2056 together with the amendment below as the corrected build contract. The original task alone is insufficient for full enrichment closeout: it describes the desired chain, but omits several demonstrated failures inside that chain. These belong in #2056, not additional follow-up tasks.

The task's existing identity-review, no-send, production-change and provider-spend boundaries remain applicable. Build and offline certification can proceed. Production enrichment completion requires the later production acceptance gate; publishing alone is not completion.

## Audited baseline and limits

- Repository: `scottpstevenson/Liberty-Bancard-Website-and-CRM`.
- GitHub `main`: `1376f0719d82a195233c15eee5478d0c1f7aeaeb`, matching the task's proposed build baseline.
- Production `/api/health` still reported `cca699122c90985b0c5c7827d2e71ccee9ed103e` during this audit. GitHub main is five commits ahead, with that production release as the merge base. The intervening diff does not change the SFP services audited here; it includes public intake/client request handling and outbound credit-alert/Slack fencing. Preserve those changes.
- Repository migration journal: 313 entries; final index 312, tag `0308_sfp_ready_held_review_status`. Production-applied migration head was not re-queried in this pass. Do not claim repository journal and production journal are interchangeable.
- Open PR #8, `codex/sfp-end-to-end-enrichment`, head `90952ab29e7bef8b202c2048967dfcf773a04751`, overlaps the feature area. It may contain already-integrated or stale work. Compare it with main before reuse; do not blindly merge it or reuse its migration allocations.
- Runtime contract in package.json: Node `>=22.22.0 <23`, npm `10.9.4`.
- Current source was retrieved at the exact main SHA, rather than relying on the old local checkout. Reviewed the contact authority, candidate readers/opening, validation, provider reservation/settlement, shared budget, cohort selection/freezing, Sunbiz resolver/bootstrap, staging, enrollment, API/UI, schema, relevant migrations and certification sources.
- This was a read-only repository audit plus production release check. No code or production settings were changed, no paid calls were triggered, and no deployment was performed. Existing TypeScript, disposable-DB and full pre-deploy suites were not run from the downloaded source snapshot. The source checks described below establish defects, not production certification.
- Earlier production counts and budget headroom remain timestamped historical observations. Recapture them before rollout; do not treat the earlier $0.01884 as current available spend.

## What the task already gets right

Keep the NBA contract repair, truthful candidate display, evidence-backed Sunbiz projection, resumable contact reconciliation, bulk identity review, distinct-business cohort fairness, late-evidence reconsideration, provider independence, bounded aggregate reads, v2 packages and no-send acceptance tests.

Keep the existing commercial-link authority. `recordContactBusinessLinkCandidate()` produces suggestions; `decideContactBusinessLink()` requires an admin reviewer, subject evidence, independence and revision fencing, then projects `contacts.business_id` in its transaction. A domain match is not permission to bypass this authority. The reported 16,042 contacts with emails and potential domain matches are an opportunity pool, not 16,042 verified South Florida prospects.

## Consolidated required amendment to Task 2056

### C1 Complete the contact source through opening, schema, validation and staging

**Confirmed blockers:**

1. `openSfpCandidatePlaintext()` in `server/services/cro03/sfp-paid-evidence-writer.ts:266–364` resolves a contact row, but its envelope query has only free and paid branches. A contact falls into `sfp_paid_candidate_evidence WHERE id=<integer contact id>::uuid`. It cannot open that contact's real email through this path.
2. Migration `0306_sfp_contact_eligibility_reference.sql` adds a contact FK/index only. The eligibility source CHECK from migration 0289 still accepts only legacy-null/free/paid variants. `sfp-validation.ts` writes `source_kind='contact'`, which that CHECK rejects. `shared/schema.ts` also lacks the eligibility `contactId` field and contact CHECK variant.
3. `sfp-campaign-staging-v2.ts` restricts sourceKind to free/paid, maps every non-paid row to free, selects no contact_id, and requires a free candidate ID for that branch. The staging source CHECK from migration 0290 also accepts only free/paid. Adding contact candidates to a query did not implement the complete contact path.

**Required correction:** implement a typed free/paid/contact reference consistently in resolution, audited opening, snapshot, validation, eligibility, preview, transaction, intent lineage, API and UI. Use the canonical contact-email read behavior inside the audited callback, with the supplied transaction executor and no plaintext escape. Do not cast a contact ID to UUID or fabricate a free/paid evidence row to satisfy old constraints.

Use a new additive migration after the recaptured journal head to align schema and CHECKs. Define exactly one source reference per nonlegacy source, retaining validated legacy-null rows deliberately. Add contact reference/provenance to staging or an equivalent explicitly typed immutable source snapshot. Decide deletion behavior so retained staging evidence cannot silently disappear or violate its CHECK after `ON DELETE SET NULL`.

Normalize email identity consistently across sources. The current unified reader explicitly uses different contact and free/paid hash algorithms, so identical addresses can survive as separate winners. Preserve every source observation but deduplicate paid validation work by the same normalized real address, business identity and validation generation. Preserve immutable historical hashes; add a versioned mapping where needed. Define admission/disposition counters truthfully: SFP can validate staged candidates today, so zero validation_admitted is not by itself proof that its provider invocation is blocked. Contact email_status=valid alone must not produce a misleading admission claim without the required receipt/policy checks.

**Acceptance:** a real contact fixture with initially null business_id is proposed, independently reviewed, verified, selected, opened, freshly validated, staged into the correct master lead/held intent and bridged manually into one paused enrollment. Execute actual database constraints and canonical functions; a selector-only mock cannot pass this gate.

### C2 Enforce verified link truth at every contact-use boundary

**Confirmed gap:** `getUnifiedSfpCandidates()`, contact reference resolution/opening and several selectors rely on the populated `contacts.business_id` projection. `getAuthoritativeVerifiedContactLinks()` already defines stronger truth: a current verified decision plus a consistent projection. The gap-vector reuse path uses that stronger authority while candidate opening does not consistently enforce it.

**Required correction:** reuse the current verified decision and consistent projection when listing, selecting and opening a contact candidate, and recheck inside the staging transaction. Capture decision ID/revision and normalized email identity in the snapshot. A rejected, conflicted, superseded, moved or manually populated FK must not authorize reuse. Recheck archived/test/customer/suppression state where appropriate.

Build resumable candidate generation for existing and new data with indexed normalized identity keys. Bulk review must show corroboration, ambiguity, independent reviewer requirements and each item's revision. Do not set business_id directly or fabricate a reviewer. Rank in-scope contacts with existing email evidence for review before purchasing equivalent discovery.

**Acceptance:** bare FK without a verified decision is excluded; revoked/superseded links fail before transport and staging; shared domains and changed contact emails cannot silently switch the identity approved in preview. Concurrent/replayed review produces one current decision and matching projection.

### C3 Route packages using the admitted v2 classification evidence

**Confirmed blocker:** staging preview reads `businesses.vertical`, rejects it when blank and uses exact `getCurrentPackageForVertical(String(row.vertical))`. That package lookup compares the exact stored vertical. Cohort admission can instead resolve through classification evidence while raw vertical remains NULL, empty, or a legacy label such as Auto.

**Required correction:** carry the admitted resolved v2 target ID and taxonomy/classifier/evidence pin from the existing cohort manifest/classification contract into validation, staging, master lead display and package selection. The frozen membership already stores `classifier_matched_target` and classification evidence fields; use the existing authority rather than adding an unrelated classifier or rewriting raw source labels.

Validate the frozen classification/policy pin and any required current safety rechecks. Conflicting, stale or unresolved evidence must block with a visible reason. Select the package by the canonical v2 ID and pin its version/content hash.

**Acceptance:** a roofing fixture with raw vertical NULL and high-confidence v2 Construction/Trades/Home Services evidence reaches that v2 package. A raw Auto alias admitted as Automotive reaches the automotive v2 package. Restaurant/DBPR, conflicting evidence and old taxonomy pins remain excluded. Neither UI nor master lead may hide the admitted vertical behind a blank raw value.

### C4 Repair validation work identity, replay and non-positive retry behavior

**Confirmed defects:**

- `getUndecidedCohortBizIds()` excludes every non-pending eligibility decision, including discovery_required. A later candidate cannot reopen that work without an evidence-aware rule.
- Execution recomputes the changing undecided winner set before it loads an existing stage receipt. Completed work changes that set, so an identical request key can conflict with its original payload on replay. Worker keys based on hour and loop position also repeat across ticks without identifying a stable candidate batch.
- The snapshot pins candidate IDs but not a mutable contact email hash or verified link revision. It labels `SFP_VALIDATION_MAX` (25) as aggregateCapMicros.
- `findFreshProviderObservation()` reuses every outcome within the general TTL. An unknown result becomes validation_pending under the seeded policy; subsequent ticks can reuse the same unknown without new validation. Eligibility expiry is reset from now instead of anchored to the original observation time.

**Required correction:** freeze/claim stable candidate work with source type, normalized email identity, link/evidence revision, cohort/policy and pricing pins. Load/replay the stored immutable work identity before comparing it to a newly computed backlog. Retain real changed-payload conflicts. Use durable attempt/retry generation identities, leases and claims rather than loop position as the only work identity.

Make decision terminality candidate/version-specific. New email evidence must reopen a discovery_required or prior invalid/no-candidate decision when warranted. Validated or definitively rejected unchanged candidates must not be repeatedly charged across cohorts.

Separate observation freshness from retry scheduling. Policy-retryable unknown/DNS/transport outcomes need bounded attempts, nextAttemptAt/backoff and exhaustion/review disposition. A cached unknown may suppress a premature call, but cannot count as new progress or be renewed forever. Preserve original observedAt and expiry when reusing receipts, and preserve exact raw catch-all/unsafe outcomes. Remove the mislabeled 25-micro cap and pin the authoritative actual cap/price version.

**Acceptance:** identical replay returns the original receipt with no new call; changed email/policy/input fails or creates a new authorized generation; unknown respects backoff and eventually retries or reaches review; reused receipts do not extend validity; late evidence reopens eligible work. Two workers cannot validate the same address generation concurrently.

### C5 Make discovery and validation fair across distinct businesses and candidates

**Confirmed gap:** person/identity discovery orders the same cohort by ROI and takes the top maxBusinesses without a durable cross-pass target cursor. Continuous workers scan the newest 25 frozen cohorts. Validation selects one winner per business and can repeatedly prefer a failed higher-confidence candidate. New freezes and hourly keys do not themselves establish new coverage.

**Required correction:** persist progress and provider/candidate retry eligibility across cohorts, with deterministic ROI priority plus starvation protection. Page beyond the newest 25 cohorts; bounded pages are acceptable but permanent exclusion is not. Exclude unchanged completed work, respect provider-specific no-result cooldowns and move to another safe candidate/provider when justified. Scope retries to the business, source identity and provider gap, not a newly frozen membership.

Treat budget/control/attestation blocks as durable resumable pauses before repeated per-item failures. Count actual provider requests, not just executor batch invocations, when enforcing throughput/spend limits. Preserve independent provider readiness and free work when a paid provider is paused.

**Acceptance:** more than 25 cohorts and more than one batch advance without starving older/high-quality work; replay/restart does not repay completed no-results; invalid/unknown winners do not indefinitely block a viable alternate address. Report distinct businesses, address identities, new validations and new eligible results separately.

### C6 Keep named-email review and enrollment identity explicit

**Confirmed policy boundary:** every contact candidate is currently labeled person. The seeded outreach policy requires named/unclassified addresses to be reviewed. In validation, even the branch describing named_contact:policy_eligible assigns validated_review_required because the status expression depends only on roleOk. Linking and validating contacts alone therefore cannot be promised to produce automatic eligible staging.

**Required correction:** honor the active policy exactly, including accurate person/role provenance and status/reason consistency. Provide a working review path for valid but policy-held records through the existing eligibility authority. Never relabel a person address as a role inbox merely to admit it, change policy silently or treat catch-all/unknown as valid. Distinguish identity review, outreach eligibility review, held-intent review and send authorization in the UI.

For contact-sourced staging, preserve the verified source contact ID. The enrollment bridge currently searches contacts by email and takes the first corroborated phone/company match; do not let it substitute a different contact when a source contact is pinned. Recheck link conflict, suppression and the exact validated address. New contacts still use canonical writeContact and the existing transaction rollback boundary. Creation must not pretend a verified commercial link exists; use the authority or expose the required review.

**Acceptance:** named-email valid→review and approved policy-eligible→held behavior are both tested. The pinned contact is reused without duplicates; multiple corroborated contacts create a visible conflict rather than arbitrary selection. Stale validation/revocation before bridging leaves held safely, with no active enrollment or send. Replay and both injected rollback points preserve existing #2029 guarantees.

### C7 Reconcile the budget calculation rather than only its display

**Confirmed accounting overlap:** `computeLadderCommittedMicros()` counts SFP plus all CRO-03C operations under the shared lock. `reserveSfpAggregateBudgetInTransaction()` adds externalSpendMicros from getAggregatePilotSpend to the requested reservation, although pilot-linked CRO-03C operations are already in that shared total. Nonzero pilot spend can therefore be counted twice. The preview and overview also use narrower/different summaries.

**Required correction:** reuse one canonical read/lock/reservation denominator, counting each economic operation once. Preserve the existing shared advisory lock and transaction. Make preview, readiness, UI and all reservations agree on settled, reserved, released and remaining amounts. Include billed/no-result cost even if a containing run becomes failed/cancelled; confirm those terminal-state semantics instead of deleting cost by status filtering.

Reconcile expired reservations using dispatch/receipt evidence. Unknown external outcomes remain reserved/ambiguous until safely resolved; do not reset counters or blindly replay. Surface provider pricing version, unit meaning, estimated versus settled amounts and billing uncertainty. Application receipts are not external invoice reconciliation.

The current code has a fixed `MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS=50_000_000` and a typed $50 authorization. Provide one clearly labeled admin budget-control/read contract. If adjustable cap support is included to satisfy the original request, extend this same authority and all consumers, preserve $50 as the current default, require authenticated audited changes and reject a cap below committed spend. Building the control is not permission to raise/reset production accounting. Document any unresolved cap-configuration limitation explicitly.

**Acceptance:** concurrent SFP/MI-09/pre-cohort reservations with nonzero spend each count once and cannot overspend; read summaries reconcile with operation-level receipts; expired pre-dispatch and ambiguous post-dispatch cases differ; configured cap changes propagate consistently in isolated tests without changing production.

### C8 Deliver safe reconciliation and the complete operator workflow

Extend existing CRM surfaces with proposed/verified contact links, masked source email evidence, email validation/policy disposition, package pin, master lead and held/enrollment navigation. Fix the NBA camelCase mismatch with a shared typed contract and null-safe rendering. Keep role-scoped PII protections and show unavailable errors distinctly from zero results.

Provide audited preview/start/pause/resume/progress controls for contact reconciliation and missing-field projection. Cover existing rows as well as future Sunbiz/contact additions, with keyset checkpoints, leases/fencing, graph locks, rollback/conflict review and no direct truth writes. Batch review must be usable at the reported 16k potential-match scale; it cannot require clicking each row or hide independent-review failures.

A newly projected safe Sunbiz domain must schedule/become eligible for free recrawl despite the existing freshness window where necessary. A newly approved link/email must schedule/become eligible for validation; it cannot wait forever behind an old no-candidate decision. Retain source evidence and never overwrite conflicting business fields. Index normalized match keys and avoid contact×1.9M-source cross products.

Keep the original production-scale stats/backfill/lifecycle repair requirements, with explicit latency/query-plan evidence and truthful cached freshness. No unsolicited rewrite of unrelated old failing suites.

**Acceptance:** admin can review a batch, see durable links, follow the exact email into validation/master lead/held state, inspect blocked reasons and pause/resume recurrence. Non-admin users cannot mutate the controls. Projected domains and later evidence advance through the recurring fake-provider workflow after restart.

### C9 Replace the completion rule with separate build and production gates

Keep development/disposable tests denied from live transports. Keep production mutations and paid calls outside this audit/build authorization. Keep the same task open through deployment and production acceptance rather than filing another task for predictable handoffs.

**Build gate:** exact release SHA, additive migrations, passing meaningful disposable end-to-end certification and complete admin workflows/runbook. This permits “code complete and offline certified”; it does not permit “enrichment fully working in production.”

**Production gate after user publish and the authorized operator actions:**

1. Confirm exact deployment/schema/pricing/policy and current budget; inspect the actual production CRM rather than development fixtures.
2. Preview reconciliation, review safe in-scope links using real admin authority, and execute only the explicitly approved backfill/settings changes. Enable intended staging recurrence using existing audited controls while outbound stays paused.
3. Trace both a real existing-email contact path and a newly discovered/free-email path through exact candidate identity, fresh or legitimately reused valid ZeroBounce receipt, policy decision, master lead and v2 package-pinned ready_held. Demonstrate one manual idempotent paused enrollment.
4. Capture a second measurement after a real scheduled run/restart showing distinct new work and durable continuation, including free work and late evidence. Publish counts for linked contacts, candidates, provider outcomes, policy-held/eligible, master leads, held intents and paused enrollments by county/vertical/source.
5. Reconcile spend/reservations and prove zero sends/GHL dispatch. Do not call a reused unknown, heartbeat or repeated membership a new prospect.

If current cap headroom cannot fund a real validation, report the exact blocked gate and required operator budget decision. Do not raise/reset it or mark the production gate passed. Historical near-exhaustion must not be misrepresented as a new code defect or full $50 remaining. The code/CRM should still support free reconciliation and show precisely what is paused.

## Verification matrix to add to the task

| Area | Required execution and observable result |
| --- | --- |
| Contact path | Canonical functions + real PostgreSQL CHECKs, initially unlinked contact through review/open/ZB/eligibility/master lead/held/manual paused enrollment |
| Authority | Bare FK, superseded/rejected link, stale revision, email edit and concurrent revocation rejected at the final boundary |
| Sources/schema | Free/paid/contact source one-of references; no integer→UUID cast; additive migration upgrade/fresh DB/parity; retained historical evidence |
| Taxonomy | Raw NULL and legacy Auto admitted by v2 evidence route to exact correct pinned v2 packages; conflict/v1/DBPR excluded |
| Validation | Completed replay, real changed-payload conflict, frozen identity, unknown backoff/exhaustion, original observation expiry, late evidence and alternate winner |
| Continuous work | >25 cohorts, multiple batches, restart, duplicate delivery, independent provider outage, durable pause/resume; distinct new output |
| Review/bridge | Named and role policies, held-review versus send distinction, source-contact reuse, ambiguity, current safety gates and injected rollback |
| Budget | Nonzero pilot + SFP/pre-cohort concurrent spend counted once; cap respected; stale/ambiguous operation reconciliation |
| CRM/API | BLOCKED NBA during pause, candidate provenance, all controls, loading/empty/stale/error states, role/CSRF/IDOR boundaries |
| Scale | Indexed normalized joins and production-shaped plans; bounded reads without fabricated zero or timeout increases |

Use fake provider transports at the normal reservation/attempt/settlement boundary. Keep real production authorization fences intact; do not prove the chain only by passing zbTransport and manually inserting eligibility/staging rows. Tests must demonstrate failing-before/passing-after behavior for the confirmed defects. Register applicable tests in the repository's existing certification/CI manifests.

Run typecheck, focused UI/API/role tests, schema/migration checks and the affected disposable certifications. Classify unrelated baseline failures with comparative evidence; no broad cleanup of historical failures is required for this task. Report exact commands and results, including unavailable gates.

## Source ownership and evidence map

| Concern | Canonical owner and inspected evidence |
| --- | --- |
| Link suggestion and verified truth | commercial-link-authority.ts; current decision + consistent FK, independent admin/evidence/revision checks |
| Candidate references/opening/deduplication | sfp-paid-evidence-writer.ts; contact envelope fall-through and incompatible cross-source hash keys |
| Validation/replay/outcomes | sfp-validation.ts; sfp-outreach-policy.ts; stable work, observation age and policy evaluation |
| Cohort/classification | roi-cohort-selector.ts; south-florida-prospecting.ts; frozen classifier_matched_target and policy/taxonomy evidence |
| Provider discovery | sfp-paid-waterfall.ts; sfp-continuous-discovery.ts; ROI top slice/newest-25 and per-provider work progress |
| Shared spend authority | shared-paid-budget-ledger.ts; sfp-provider-operations.ts; mi09-pilot-authority.ts; sfp-cost-preview.ts |
| Staging/master lead | sfp-campaign-staging-v2.ts and worker; raw vertical and free/paid-only assumptions |
| Enrollment/contact transaction | sfp-enrollment-bridge.ts; canonical writeContact and injected rollback boundaries; source-contact pin needed |
| Sunbiz materialization | sunbiz-bootstrap.ts; sunbiz-full-backfill.ts; organization-resolver.ts |
| CRM reads | ContactDetail.tsx; Lead Ops routes/detail; analytics.ts; source/status and query contracts |

## Audit checks and remaining evidence boundaries

- GitHub recursive tree inventory: 3,524 entries, not truncated. Exact-SHA source and migration files were fetched read-only.
- GitHub code-search censuses: openSfpCandidatePlaintext in 10 files; decideContactBusinessLink in 9; computeLadderCommittedMicros in 2; findFreshProviderObservation in 4; reserveSfpAggregateBudgetInTransaction in 4. These counts include tests/history where present; they are file matches, not counts of production calls. Candidate opening's active service consumers are validation and staging.
- Local read-only source checks confirmed 9/9 targeted defect signatures: contact envelope paid-table fall-through; eligibility model missing contact field; eligibility CHECK missing contact variant; 0306 not updating that CHECK; staging missing contact variant; non-paid→free mapping; raw-vertical package routing; snapshot missing mutable email/link pins; snapshot cap labeled as 25.
- Reviewed migration 0289/0290 SQL and 0306 against shared schema. The contact source is not added to either source CHECK by 0306. New migration allocation must be rechecked at build time; do not edit these applied migrations.
- Reviewed current certification sources. Existing free/paid selector and injected-validation tests do not establish contact-sourced DB constraints, full receipt settlement or evidence-based package routing. This audit did not execute them or assert they passed.
- No fresh production SQL/count remeasurement was performed during this task-specification audit. The prior live audit and Replit's independent report are timestamped evidence, not newly measured current counts.

## Build Mode handoff

Apply this amendment to Task #2056 before implementing. Preserve the original task's sound requirements and correct its VFC/schema/path claims using C1–C9 above. Implement the full correction set on one coherent branch/release, certify it through canonical paths, and deliver one release receipt. Do not stop after the contact crash, query fix, FK join, worker heartbeat or first successful fake validation. Distinguish code-complete/offline-certified from production-accepted, and retain the production acceptance gate until real traceable output is proven. No follow-up task is needed for any requirement in this amendment.
