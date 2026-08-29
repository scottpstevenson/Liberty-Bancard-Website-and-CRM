# MASTER REPLIT TASK — CR-04 CHANNEL-QUALIFIED COHORT & READY AUTHORITY

**Task type:** mandatory preflight + implementation + isolated verification  
**Planning baseline inspected:** `bd36d65dfa635b0efd20e8c3f702754bdf66f71e`  
**Planning migration head:** `0177_cro03_source_staging_evidence`  
**Planning CI manifest:** 82 classified suites  
**Execution order:** after CRO-00, CRO-01, CRO-02, and CRO-03/#1718  
**Preflight verdict at the inspected baseline:** **BUILD-READY WITH CONTROLLING CORRECTIONS**

## 1. Controlling instruction

Implement CR-04 end to end. Begin with a fresh read-only recapture of current `main`; do not assume the planning SHA, line numbers, migration head, suite count, or a prior task summary is still current. If current `main` moved, map every finding below to its live equivalent before editing.

Do not split task-owned omissions into new tickets. If a defect is required to make the channel-qualified decision, Ready list/count, cohort freeze, enrollment boundary, authorization, or deterministic proof correct, fix it in this task. A follow-up is permitted only for genuinely external operations or later CR-05/CR-06/CR-07 scope.

Do not activate providers, campaigns, sequences, GHL workflows, exports, assignments, outreach, or production cohorts. This task builds and proves the authority while all external execution remains denied.

## 2. Objective

Replace the current generic “phone OR acceptable email” Ready-for-Outreach population with one versioned server authority that answers:

- which canonical subject is qualified;
- for which channel (`email`, `manual_call`, or `sms`);
- for which purpose, ICP, offer, owner/team scope, campaign/content version, and time;
- using which frozen CRO-02/CRO-03/contactability/consent/provider evidence;
- with which stable decision and reason codes;
- and whether it may enter an immutable cohort or enrollment intent.

`READY_EMAIL`, `READY_MANUAL_CALL`, `READY_SMS`, and `BLOCKED` are separate decisions. A phone cannot make a record email-ready. An email cannot make a record call-ready. Enrichment success, completeness, score, stage, or provider confidence cannot grant outreach permission by itself.

## 3. Immutable safety boundary

The build may mutate only disposable test data and task-owned schema/code in the development branch. It must not:

- query, classify, backfill, export, assign, or clean production records;
- create a production cohort or sequence enrollment;
- lift a global/channel pause or change provider budgets/activation;
- call Apollo, Outscraper, Serper, ZeroBounce, SMTP, SMS, voice, GHL, or any paid/external transport;
- deploy, merge, start a campaign, or send outreach;
- weaken CRO-02 shadow-only/legacy-effective classification behavior;
- weaken CRO-03 provider authorization, frozen-subject, lineage, accounting, or transport denial;
- copy contacts into prospects or fabricate source/provenance history.

## 4. Required baseline recapture

Before editing, record and return:

1. current branch, full HEAD SHA, `origin/main` SHA, merge-base, and clean/dirty status;
2. recent merge history proving CRO-00 through CRO-03/#1718 are present or equivalently implemented;
3. current migration journal head and integrity result;
4. current CI manifest count and capability counts;
5. current global/channel/provider/sequence/campaign compile-time defaults from source only;
6. every file already changed by another unmerged task;
7. exact current owners for classification, resolution, source staging, provider observations, contactability, consent/suppression, email validation, sequence eligibility, Ready membership, campaign preview, and enrollment.

If the worktree is dirty, preserve unrelated changes. Stop if task-owned files have overlapping uncommitted work that cannot be safely isolated.

## 5. Prerequisite state and dependency gate

The inspected baseline contains:

- CRO-01 canonical revenue objects and `revenue-read-authority.ts`;
- CRO-02 classification, provenance, identity/resolution, observation, quarantine, and advisory-lock authorities;
- CRO-03 source staging, frozen subjects/plans, provider operations/attempts/observations/candidates/receipts/economics, canonical projection fencing, and provider transport denial;
- BT consent/suppression, contactability, sender, pause, and sequence-eligibility controls;
- durable campaign previews, frozen members, queue runs/items, and removal-only send-time rechecks.

Stop if any prerequisite is absent or if CR-04 would need to recreate it. Extend those owners; do not replace them.

## 6. Verified current-state findings

| ID | Finding at `bd36d65…` | Evidence | Required disposition |
|---|---|---|---|
| VFC-P01 | Ready is still a generic phone-or-email population. | `server/services/outreach-queue-membership.ts:6-15` | Replace with channel-specific decisions. |
| VFC-P02 | Ready lacks CRO-02 class/provenance/identity and CRO-03 evidence requirements. | same predicate; CRO-02/CRO-03 services | Compose existing authorities. |
| VFC-P03 | List/count share the predicate, but assignees duplicates its SQL. | `server/routes/outreach-queue.ts:43-192` | One query/decision authority for all projections. |
| VFC-P04 | Start repeats archived/DNC/reachability checks and directly creates sequence enrollment. | `server/routes/outreach-queue.ts:195-376` | Route through one fenced orchestration authority. |
| VFC-P05 | The current UI exposes one undifferentiated Ready queue and bulk start. | `client/src/pages/dashboard/OutreachQueue.tsx:110-194` | Show channel, decision, policy, expiry, and blockers. |
| VFC-P06 | Contact readiness measures completeness, not legal/channel permission. | `server/services/contact-readiness.ts` | Preserve as a prerequisite signal only. |
| VFC-P07 | Sequence eligibility owns family/lifecycle/consent compatibility. | `server/services/sequence-eligibility.ts` | Compose it; do not duplicate or replace it. |
| VFC-P08 | Campaign preview/frozen membership is durable but campaign-specific and incomplete as a universal qualification decision. | `shared/schema.ts:1631-1794`; `server/services/campaign-engine.ts:481-1007` | Adapt it to consume CR-04 decisions. |
| VFC-P09 | A legacy prospect campaign path still exists alongside canonical contact-mode preview/queueing. | `server/services/campaign-engine.ts:221-313` | Retire or hard-disable it for promotional selection. |
| VFC-P10 | Send-time provider/contactability checks already remove members when evidence changes. | `server/services/campaign-engine.ts:888-988` | Preserve removal-only semantics. |
| VFC-P11 | Direct enrollment writers exist across promotional and transactional flows. | repository-wide `sequence_enrollments`/`createSequenceEnrollment` census | Cut over promotional entry points; document narrow transactional exceptions. |
| VFC-P12 | Production readiness counts remain unverified. | no production query authorized | Report only isolated fixture reconciliation. |

These findings are planning evidence, not permission to skip live verification.

## 7. Mandatory preflight searches

Search and classify every occurrence of:

- `ready`, `eligible`, `qualified`, `hot`, `warm`, `cold`, `readiness`, `outreach`, `audience`, `cohort`;
- `readyForOutreachPredicate`, `/api/outreach-queue`, `OutreachQueue`;
- `sequence_enrollments`, `createSequenceEnrollment`, `enqueuePromotionalEnrollment`, `canEnrollContactInSequence`;
- campaign `targetVerticals`, `targetScores`, `filterCriteria`, `readinessThreshold`, preview, targeting hash, frozen members, queue runs/items;
- `evaluateContactability`, consent/suppression, current email validation/generation/token checks;
- CRO-02 classification/resolution/quarantine and CRO-03 observations/candidates/projection evidence;
- every list, count, badge, assignee, export, assignment, enrollment, campaign, and send consumer.

Produce a consumer matrix with owner, subject, channel, purpose, read/write behavior, role scope, and CR-04 disposition. Do not rely on filename inference.

## 8. Verified root cause

The platform has strong lower-layer authorities but no single composition authority. Different features evolved separate meanings of “ready”: completeness, lead score, a reachable field, lifecycle, campaign filters, consent-family eligibility, and provider validation. They agree only accidentally.

The fix is not another score. The fix is a versioned, deterministic decision contract that records the exact inputs and delegates each prerequisite to its existing owner.

## 9. Canonical authority model

Preserve this ownership hierarchy:

| Concern | Canonical owner |
|---|---|
| Contact/business identity, classification, provenance, quarantine | CRO-02 authorities |
| Provider operation, immutable observations, candidates, receipts, economics | CRO-03 authorities |
| Canonical contact/business writes | existing canonical writers/projection command |
| Data completeness | `contact-readiness.ts` |
| Consent/suppression and present channel permission | consent/contactability authorities |
| Final email validation generation/currentness | provider-readiness/ZeroBounce authority |
| Sequence-family/lifecycle compatibility | `sequence-eligibility.ts` |
| Channel/ICP/offer/campaign composition | new CR-04 qualification authority |
| Frozen cohort membership | CR-04 cohort service/ledger |
| Delivery-time removal/block | existing current send-time enforcement |

No CR-04 code may write classification, provenance, identity, provider evidence, consent, email validation, deal stage, or contact fields directly.

## 10. Qualification decision contract

Every decision must contain, at minimum:

- decision ID and deterministic dependency fingerprint;
- canonical subject type/ID and subject generation;
- channel and purpose;
- decision: `READY_EMAIL`, `READY_MANUAL_CALL`, `READY_SMS`, or `BLOCKED`;
- stable ordered reason codes and human-safe summaries;
- policy version, ICP version, offer version, and, when applicable, campaign/content/sender/reply-route versions;
- class/provenance/identity/quarantine snapshot references;
- CRO-03 observation/candidate/projection references needed for the decision;
- email/phone token or generation without exposing the value;
- contactability/consent/validation snapshot references;
- owner/team/shared-pool scope;
- `evaluatedAt`, `validUntil`, and invalidation fingerprint;
- evaluator version and actor/system context;
- no PII in list/count/reconciliation reason buckets.

The evaluator must be deterministic for a fixed dependency vector.

## 11. Channel rules

Implement explicit, testable rules:

### Email

Require canonical production identity, acceptable provenance/classification, no quarantine, approved purpose/offer/ICP, current final-email generation, current positive provider validation, current email contactability, monitored reply route, approved sender/content version when campaign-scoped, ownership scope, and no conflicting active enrollment/contact window.

### Manual call

Require canonical production identity, current usable phone evidence, applicable phone/manual-call consent and suppression policy, approved purpose/offer/ICP, ownership, and no hold/conflict. Manual call eligibility must not imply automated phone or SMS permission.

### SMS

Require canonical identity, current usable phone, explicit SMS eligibility/consent, suppression clearance, approved program/number/location evidence, ownership, and CR-06 sender/channel readiness. Until those prerequisites are affirmatively certified, return `BLOCKED` with a stable readiness reason; do not infer permission from phone presence.

### Universal blockers

Archived, non-production, test/demo/unknown, quarantined, unresolved duplicate, invalid provenance, DNC, applicable opt-out/suppression, stale evidence, missing owner/reply route when required, active hold, or version conflict must block.

## 12. Cohort contract

Add the smallest additive durable model necessary for:

- immutable policy versions;
- reusable qualification decisions;
- cohort definitions and versioned criteria;
- cohort runs with fixed evaluation cutoffs;
- immutable ordered members with decision/evidence fingerprints;
- exact eligible/blocked totals and stable reason buckets;
- expiration/invalidation metadata;
- idempotent freeze/consume semantics.

Names may follow repository conventions, but the database must enforce uniqueness and immutability. Do not use mutable JSON alone as the authority. Do not backfill production rows.

A frozen cohort may only lose members at execution time. It may never silently add a subject that was absent from the accepted freeze.

## 13. API and projection contract

Provide one server service used by all CR-04 projections. At minimum:

- channel-specific Ready list;
- matching total independent of page size;
- counts grouped by channel and decision reason;
- assignees/owners derived from the same scoped population;
- single-subject explain endpoint with authorized, redacted evidence references;
- cohort dry-run/freeze endpoints that remain side-effect-free with respect to enrollment/export/send;
- a fenced local enrollment-intent/orchestration boundary for future use.

Every response must include documented filters, policy version, `asOf`, and scope. Errors must use a stable privacy-safe envelope with status, code, correlation ID, and no SQL, table, constraint, provider payload, email, phone, or raw evidence.

## 14. Ready UI contract

Replace the undifferentiated Ready view with:

- channel tabs or filters for Email, Manual Call, SMS, and Blocked/Needs Review;
- authoritative server totals and pagination;
- decision/policy version, evaluated time, expiry, owner, ICP/offer, and stable reason labels;
- a clear distinction between “data complete,” “qualified,” “frozen,” and “currently sendable”;
- truthful unavailable/error/forbidden states that never look like zero;
- no bulk start action unless the server returns an authorized CR-04 orchestration capability;
- preserved deep links, refresh, pagination, back/forward, and role scope;
- no raw provider evidence or PII in aggregate diagnostics.

The sidebar badge must use the same server decision and scope as the default Ready view.

## 15. Enrollment and promotional cutover

Create one orchestration authority for promotional enrollment intents. It must:

1. authorize actor/object/scope;
2. resolve canonical contact and sequence/campaign purpose;
3. load one unexpired matching CR-04 decision/cohort membership;
4. call `canEnrollContactInSequence` and current contactability/provider checks;
5. acquire an idempotency/claim fence;
6. create or reuse one local intent/enrollment only when the global task configuration permits it;
7. preserve current pause/coordinator/provider denial;
8. return canonical IDs, disposition, and stable reason code.

Cut over the Outreach Queue start path and every promotional entry point found in the census. Keep explicitly classified transactional/onboarding/security/merchant-success sequences outside the promotional cohort rule only when their existing authority and purpose are documented and tested.

Do not make real enrollment possible from human HTTP while current safety flags deny it. Isolated tests may exercise the service against disposable fixtures with all transports denied.

## 16. Authorization and indirect-object scope

Test anonymous, merchant, Agent A, Agent B, manager, and admin:

- agents may see and explain only owned/shared-pool subjects permitted by the existing single-tenant policy;
- Agent A cannot enumerate Agent B through lists, totals, assignees, reasons, explain, cohort membership, or substituted IDs;
- managers receive the repository’s current team/owned-object scope, not invented tenant semantics;
- admins receive authorized global views;
- policy authoring/approval and cohort freeze are admin-only unless current governance explicitly grants managers a narrower owned-object capability;
- denials are privacy-safe 403/404 according to current conventions;
- every mutation requires CSRF and strict body allowlists.

Client hiding is not authorization.

## 17. Concurrency, replay, and invalidation

Prove:

- repeated evaluation with the same dependency vector converges on one effective decision;
- concurrent cohort freezes reuse one cohort/version or conflict safely;
- duplicate members cannot enter a cohort;
- concurrent enrollment intent creation produces at most one active intended enrollment;
- stale decisions fail closed after class, identity, source, field generation, validation, consent, owner, sender, reply route, campaign, content, or policy changes;
- crash recovery cannot add members after freeze or reuse an expired decision;
- send-time checks may exclude but never admit new members;
- cancellation/retirement fences all later recovery attempts.

Use database constraints and transaction/claim fencing, not process-local maps.

## 18. External and runtime boundary

All CR-04 tests must deny:

- paid-provider and web-search transport;
- ZeroBounce live calls;
- SMTP, SMS, voice, voicemail, and GHL;
- queue delivery outside an isolated Redis namespace;
- campaign/sequence activation and production enrollment;
- production database URLs.

Credential presence must not turn a test into a live call. Fail the suite if a transport is attempted.

## 19. Scope and file-ownership fence

Expected task-owned areas include:

- a focused CR-04 qualification/cohort service and additive schema/migration if required;
- `server/services/outreach-queue-membership.ts` or its replacement;
- `server/routes/outreach-queue.ts`;
- `client/src/pages/dashboard/OutreachQueue.tsx` and badge projection;
- campaign preview/frozen-member adapters in `campaign-engine.ts`;
- promotional enrollment adapters and direct entry points identified by the census;
- focused scripts/tests and CI manifest registration.

Do not redesign the full CRM journey (CR-05), campaign catalog/content/sender readiness (CR-06), or controlled pilot execution (CR-07).

## 20. Priority register

### P0 — must close in this task

1. One channel-specific decision authority and contract.
2. CRO-02/CRO-03/contactability/consent/provider evidence composition.
3. List/count/assignee/badge query parity.
4. Outreach Queue direct-enrollment bypass removal.
5. Promotional-entry-point census and cutover.
6. Immutable cohort freeze with no execution-time additions.
7. Role/ownership/IDOR and CSRF enforcement.
8. Stale-evidence invalidation and concurrency fencing.
9. Legacy prospect promotional campaign path retired or hard-disabled.
10. Disposable PostgreSQL/Redis integration proof.

### P1 — required for complete acceptance

1. Explain/reason-code contract.
2. UI channel separation and truthful state handling.
3. Campaign preview adapter and targeting fingerprint completeness.
4. Aggregate-only reconciliation and mismatch buckets.
5. Recovery/cancellation proofs.
6. Documentation of transactional sequence exceptions.

### P2 — bounded hardening, not a reason to invent a new task

1. Performance indexes justified by query plans.
2. Operator copy polish and accessible reason labels.
3. Policy-version retention/retirement tooling.

## 21. Preflight verdict

At `bd36d65…`, CR-04 is **BUILD-READY WITH CONTROLLING CORRECTIONS**. The lower-layer prerequisites exist. The implementation must extend them and close every P0/P1 item above. If live recapture contradicts this, return `DO NOT START` with exact evidence before writing.

## 22. Corrected build plan

1. Recapture current baseline, dependencies, consumers, direct enrollment writers, and CI capabilities.
2. Freeze the authority matrix and channel decision/reason taxonomy.
3. Add additive policy/decision/cohort persistence and constraints.
4. Implement deterministic evaluation by composing existing authorities.
5. Replace Ready list/count/assignee/badge queries.
6. Replace Outreach Queue start with the fenced orchestration boundary.
7. Cut over campaign preview/freeze and promotional entry points.
8. Retire/hard-disable legacy prospect promotional selection.
9. Implement the channel-aware UI and safe explain/reconciliation surfaces.
10. Add isolated static, DB/Redis, HTTP authorization, concurrency, recovery, and jsdom tests.
11. Run all required gates and post-build searches.
12. Review full diff and return the final VFC/kill-line verdict.

## 23. Done looks like

- Ready means a versioned channel decision, never phone-or-email shorthand.
- Email, manual call, and SMS have independent permissions and reason codes.
- All Ready lists, totals, assignees, badges, campaign previews, and frozen memberships use the same authority.
- Classification/provenance/identity/provider evidence remain owned by CRO-02/CRO-03.
- Contact readiness remains completeness only.
- Sequence eligibility and contactability remain authoritative lower-layer gates.
- Promotional enrollment cannot bypass the CR-04 decision/cohort and shared sequence gate.
- Frozen cohorts are immutable and execution-time rechecks are removal-only.
- Role scope is identical across direct and aggregate APIs.
- Isolated replay/concurrency/recovery tests pass with transports denied.
- No production row, provider, campaign, GHL object, sequence, or outreach is mutated.

## 24. Kill lines

Stop and return `DO NOT MERGE` if:

- a prerequisite authority is duplicated or weakened;
- one Ready definition remains outside the shared authority;
- phone/email presence, score, completeness, lifecycle, or enrichment success can grant another channel;
- a direct promotional enrollment bypass remains;
- a cohort can gain members after freeze;
- stale/changed evidence remains effective;
- Agent A can infer Agent B through rows, counts, reasons, assignees, or IDs;
- production/test/unknown/quarantined records can qualify;
- a provider, GHL, send, campaign, sequence activation, production cohort, export, assignment, or deployment occurs;
- a migration edits history, uses `db push`, or performs an unapproved production backfill;
- any task-owned required suite is skipped because local disposable infrastructure was not configured—use the repository CI service environment or configure a disposable local equivalent.

## 25. Implementation rules

- Use parameterized queries, current transaction helpers, advisory-lock ordering, and canonical actor/object policies.
- Add new migrations only at the live journal head; never preselect a migration number from this prompt.
- Make migrations bootstrap-safe and idempotent under the repository’s migration runner.
- Prefer shared predicates/services over copied SQL.
- Counts must be server-derived and page-size independent.
- Reason taxonomies and fingerprints must be stable and versioned.
- Avoid raw PII in logs, errors, analytics, fixture output, and audit summaries.
- Preserve the current single-tenant role model; do not invent workspaces.
- Preserve all external pause/compile-time denial defaults.

## 26. Test requirements

Add non-empty isolated fixtures covering:

- each channel decision and every universal blocker;
- positive and negative CRO-02 class/provenance/identity/quarantine cases;
- CRO-03 final-candidate/projection evidence, stale field generations, and mismatched subjects;
- current/expired/missing email validation;
- consent, DNC, suppression, complaint, bounce, and hold states by channel;
- decision-maker, ICP, offer, owner, sender/reply/content versions;
- totals greater than page size and list/count/assignee/badge parity;
- first evaluation, replay, concurrency, expiry, invalidation, cancellation, and crash recovery;
- frozen cohort no-add semantics and removal-only send-time checks;
- campaign preview compilation and legacy prospect-path denial;
- direct/bulk/automatic promotional enrollment entry points;
- anonymous, merchant, Agent A, Agent B, manager, admin, CSRF, malformed input, and substituted IDs;
- loading, empty, blocked, unavailable, forbidden, error, deep-link, pagination, refresh, and back/forward UI states.

Tests must fail if fixtures are empty, skipped, or connected to production/shared Redis.

## 27. Smoke and integration plan

Use disposable PostgreSQL and an isolated Redis prefix/database. Deny all transports. Prove this synthetic chain:

`CRO-02 resolved production subject → CRO-03 final evidence → channel decision → Ready projection → frozen cohort → enrollment intent → current removal-only recheck`

Use current repository `tsx`/jsdom/HTTP patterns unless the project has adopted another test runner on live `main`. Do not add Playwright/Cypress merely to satisfy wording; add the smallest deterministic UI contract tests consistent with the repository.

## 28. Required gates

Run and report exact command, exit code, and result:

- focused CR-04 static suite;
- focused CR-04 disposable PostgreSQL/Redis suite;
- focused CR-04 server-required role/CSRF suite with providers denied;
- focused UI/jsdom contract suite;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-static`;
- migration bootstrap and rerun through the live head;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-integration`;
- provider-denied server plus `npx tsx scripts/run-ci-suites.ts --capability server-required`;
- route guards, API coverage, commercial-classification/CRO-03 authority guards, provider/paid-transport scans, contact-writer/intake scans;
- `npx tsx scripts/check-migration-integrity.ts` whether or not a migration is added;
- `npm run check` and `npm run build`;
- `git diff --check`.

Do not claim COMPLETE if a task-owned gate is unrun or red. Current CI already provisions disposable PostgreSQL 16 and Redis 7; “no local `TEST_DATABASE_URL`” is not a completion waiver.

## 29. Post-build search verification

Prove with repository searches that:

- no changed Ready consumer uses phone-or-email shorthand;
- list/count/assignee/badge/campaign consumers import the shared authority;
- no promotional entry point directly inserts an enrollment;
- no contact-readiness or lead-score check impersonates channel permission;
- no legacy prospect campaign path can queue or send;
- no execution path adds a frozen member after acceptance;
- no new raw contact/business/deal writer exists;
- no secrets, provider payloads, PII logs, live provider calls, GHL mutations, unpause, campaign activation, exports, assignments, or outreach were added;
- CR-05 operator-journey and CR-06 campaign-content work did not leak into scope.

## 30. Diff review

Before the final verdict, run status, stat, and full diff. Confirm:

- only task-owned files changed;
- no attached assets, dumps, generated evidence, debug output, lockfile drift, secrets, or unrelated formatting entered the diff;
- migration SQL, schema, journal, and tests agree;
- no production data or external response was captured;
- all new tests are registered in the live manifest with correct capabilities;
- safety flags remain denied.

## 31. Final VFC table

Expand this table until every Done/Kill item has evidence:

| ID | Requirement | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | One versioned channel decision authority | file/contract | static + DB | PASS/FAIL |
| VFC-F02 | CRO-02/CRO-03 evidence composed, not duplicated | authority map | contract tests | PASS/FAIL |
| VFC-F03 | Independent Email/Call/SMS decisions | service/reasons | matrix tests | PASS/FAIL |
| VFC-F04 | Ready list/count/assignee/badge parity | query service | multi-page tests | PASS/FAIL |
| VFC-F05 | Immutable cohort and no-add execution | schema/service | concurrency/recovery | PASS/FAIL |
| VFC-F06 | Promotional enrollment uses one fence | service/call sites | bypass scan + integration | PASS/FAIL |
| VFC-F07 | Campaign preview consumes CR-04 decision | adapter/hash | preview tests | PASS/FAIL |
| VFC-F08 | Role/object/aggregate scope preserved | routes/queries | role/CSRF matrix | PASS/FAIL |
| VFC-F09 | Truthful UI and safe error contract | UI/API | jsdom/HTTP | PASS/FAIL |
| VFC-F10 | No external/production mutation | diff/search/log | denial tests | PASS/FAIL |

## 32. Final response format

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE;
- starting and ending SHA, branch, worktree, migration head, manifest count;
- exact prerequisite evidence;
- verified root cause and live preflight corrections;
- canonical authority, decision, reason, cohort, and enrollment contracts;
- implementation file/line evidence;
- isolated before/after reconciliation using synthetic IDs and aggregate buckets only;
- every test/gate command, exit code, and result;
- post-build searches and kill-line mapping;
- explicit separation of isolated proof from production/runtime truth;
- remaining risks assigned only to CR-05, CR-06, CR-07, or external operations;
- **FINAL STATUS:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE;
- branch/PR URL, without merging or deploying unless explicitly authorized.

## 33. Liberty safety and practical merge standard

Block for any realistic risk of wrong-channel permission, unauthorized cohort visibility, stale evidence, duplicate enrollment, mutable frozen membership, competing authority, test-data inclusion, or external execution. Do not block a correct local authority merely because production calibration, sender certification, or a controlled pilot remains pending.

No `db push`, production migration execution, backfill, cleanup, provider activation, GHL mutation, campaign activation, sequence activation, export, assignment, deployment, or outreach is authorized.

## 34. Relevant live files

- `server/services/outreach-queue-membership.ts`
- `server/routes/outreach-queue.ts`
- `client/src/pages/dashboard/OutreachQueue.tsx`
- `client/src/pages/DashboardLayout.tsx`
- `server/services/contact-readiness.ts`
- `server/services/contactability.ts`
- `server/services/sequence-eligibility.ts`
- `server/services/promotional-enrollment-eligibility.ts`
- `server/services/campaign-engine.ts`
- `server/routes/campaigns.ts`
- `server/services/commercial-classification-authority.ts`
- `server/services/commercial-resolution.ts`
- `server/services/cro03-source-intake.ts`
- `server/services/provider-readiness-control.ts`
- `shared/schema.ts`
- `server/routes.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/pre-deploy.ts`
- `.github/workflows/ci.yml`
- `migrations/meta/_journal.json`

