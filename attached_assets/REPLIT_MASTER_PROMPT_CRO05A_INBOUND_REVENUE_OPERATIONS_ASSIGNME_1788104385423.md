# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

Task: **CRO-05A — Inbound Revenue Operations, Assignment & Sales Handoff**

First verify this task against the current repository, current migration head, and every inbound/request writer. If the task remains materially valid after corrections, continue directly into implementation in the same run. Do not stop after producing another plan unless a genuine blocker prevents the affected portion from being built safely.

Finding one P0, one architectural contradiction, or enough defects to classify the supplied plan unsafe is **not permission to stop auditing**. Continue until the complete affected surface is inventoried. Correct the plan in place, finish every independent safe portion, and identify only genuinely blocked work.

Do not blindly trust the audit SHA, line numbers, paths, counts, form inventory, or historical assumptions. The latest verified drafting reference is `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22` with migration head `0194_cro03b_validation_execution_fence.sql`; capture the actual build baseline before making changes. CRO-03B is merged. CRO-03C Task #1731 is a separate provider-activation dependency and is not a blocker for CRO-05A's inbound, assignment, SLA, statement, proposal, task, and application-handoff work.

Required sequence:

Repository baseline → prerequisite/authority verification → VFC → full intake/effect census → root cause → source-of-truth and lifecycle check → blast radius → schema/auth/concurrency/privacy/external-side-effect checks → preflight verdict → corrected build plan → implementation → disposable certification → post-build census → diff review → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture and report before editing:

- current branch and exact HEAD SHA;
- `git status --short`, including unrelated work that must be preserved;
- origin/main SHA and whether the branch is behind/ahead/diverged;
- current migration high-water mark and journal state;
- current CI suite-manifest count and pre-deploy owners;
- CR-04, CR-05, CR-06, CRO-03A, CRO-03B, and CRO-03C merge status;
- relevant feature flags, queue registrations, and scheduler owners by key name only—never secret values;
- current global/channel pause state from a read-only authority query if runtime access exists.

Do not rebase, reset, overwrite unrelated changes, use `db push`, or mutate production merely to establish the baseline.

## 2. PREREQUISITE AND NON-DUPLICATION GATE

Verify these authorities exist and identify their current APIs/tables before designing anything:

| Domain | Required existing owner | CRO-05A treatment |
|---|---|---|
| Contact/business identity and provenance | Canonical contact/business writer and CRO-02/CRO-03 projection | Consume; do not add a second writer. |
| Consent, suppression, contactability | CRO-02 / CR-04 authority | Read and enforce; never copy mutable eligibility flags. |
| Frozen promotional audience | CR-04 | Produce an eligibility/readiness handoff only. |
| Campaign content and held preparation | CR-06 | Consume through the governed gate; never edit or dispatch. |
| Tasks/tickets/operator work | CR-05 authority | Create all durable work through this authority. |
| Deal-stage transitions | `advanceDealStage()` and its lifecycle side effects | Use exclusively for stage changes. |
| Statement command/analysis | Existing statement command and review authorities | Orchestrate; do not create a parallel analyzer. |
| Proposal generation/storage | Existing proposal authority | Require reviewed, evidence-bound drafts; do not auto-send. |
| Merchant application lifecycle | Existing application service | Create only an invite/handoff; REV-05A owns underwriting/boarding. |

CRO-03B is present at the drafting baseline. Re-verify its frozen canonical projection contracts, but do not make CRO-05A depend on CRO-03C provider activation. If current main has changed those contracts, build all independent inbound-envelope work and record only the exact affected integration as blocked; never invent a competing handoff.

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce a VFC table before implementation:

| ID | Task claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Public intake effects are fragmented/fire-and-forget | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | All intake types use the same durable orchestration | ... | ... | ... |
| VFC-03 | Assignment is deterministic and versioned | ... | ... | ... |
| VFC-04 | All operator work uses CR-05 authority | ... | ... | ... |
| VFC-05 | Promotional routing reaches CR-04 → CR-06 only | ... | ... | ... |
| VFC-06 | Statement/proposal/application handoffs are durable | ... | ... | ... |
| VFC-07 | Every stage writer uses `advanceDealStage()` | ... | ... | ... |
| VFC-08 | Public acknowledgements expose no internal or PII state | ... | ... | ... |
| VFC-09 | Restart/replay reconciles incomplete effects | ... | ... | ... |
| VFC-10 | No request path can send externally during this build | ... | ... | ... |

Inspect surrounding logic and actual database constraints. A grep hit, seeded row, UI toggle, or comment is not proof of runtime ownership.

## 4. COMPLETE INTAKE AND EFFECT CENSUS

Inventory every current request source and every effect it can trigger. At minimum inspect:

- statement upload;
- savings/estimate form;
- get-started form;
- callback request;
- integration request;
- equipment order/request;
- contact/support request;
- newsletter or content conversion forms that create CRM work;
- merchant/partner/referral intake;
- GHL inbound/webhooks and synced leads;
- imports that represent real inbound requests rather than prospect acquisition;
- authenticated manual CRM intake;
- appointment/booking events;
- document upload and statement-review paths.

For each source record:

| Source | Public route/event | Canonical identity action | Deal/action | Current async effects | Consent purpose/channel | Required owner | Retirement/migration |
|---|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... | ... |

Inventory calls to `processNewLead`, `.catch(...)`-launched effects, `enqueuePromotionalEnrollment`, `createSequenceEnrollment`, GHL workflow enrollment/sync, direct confirmation senders, proposal emailers, task/ticket creators, referral tracking, scoring/readiness queues, offer routers, analytics writers, and stage writers.

The census is incomplete if any intake path remains classified as “miscellaneous” or “best effort” without an explicit disposition.

## 5. VERIFIED ROOT CAUSE

Explain the actual cause, not merely the symptom:

- public handlers persist a primary record and launch multiple independent effects;
- retry identities and terminal receipts differ by effect;
- form-specific behavior has drifted;
- assignment and fallback ownership may be hard-coded or derived from mutable state;
- promotional enrollment can bypass the CR-04/CR-06 chain;
- a fast HTTP response is being confused with permission to make downstream work non-durable.

Use:

| Original assumption | Verified reality | Correction |
|---|---|---|
| `processNewLead()` guarantees completion | ... | Persist one request command and replay every required effect. |
| All forms have equivalent lifecycle behavior | ... | Freeze a source-specific orchestration manifest. |
| “Assigned” is a contact field | ... | Make assignment a versioned decision and history. |
| Confirmation equals promotional enrollment | ... | Separate transactional acknowledgement from promotional readiness. |

## 6. SOURCE-OF-TRUTH AND AUTHORITY MAP

Freeze one ownership map. CRO-05A may add a durable orchestration authority but must not absorb the existing domain authorities.

Required authority chain:

```text
raw request receipt
→ canonical request envelope
→ identity/contact/business resolution
→ source-specific durable effects
→ assignment decision
→ CR-05 work/SLA
→ statement/proposal/application-invite state
→ CR-04/CR-06 readiness handoff when eligible
```

The request envelope owns orchestration status, not canonical contact fields, consent truth, campaign membership, task state, proposal truth, application state, or deal-stage semantics.

## 7. CANONICAL INBOUND REQUEST CONTRACT

Implement one durable envelope with, at minimum:

- immutable request ID and source system/type;
- source event/occurrence identity and idempotency key;
- received-at and source-observed-at timestamps;
- normalized identity references, not copied raw PII where avoidable;
- canonical contact/business/deal references once resolved;
- consent evidence references and declared purpose/channel;
- UTM/GCLID/fbclid/msclkid/session/landing-page attribution references;
- source-specific orchestration manifest version/hash;
- request payload hash and protected-payload reference;
- lifecycle status, attempt count, next retry, terminal reason, and reconciliation state;
- actor/service principal and immutable audit receipt.

Duplicate submissions must return/reuse the same logical receipt. Same email/phone with a genuinely new occurrence must remain a new request occurrence linked to the same identity—not be erased as a duplicate.

## 8. SOURCE-SPECIFIC ORCHESTRATION MANIFEST

Create a versioned manifest defining required, optional, forbidden, and conditional effects for every intake source. Replit must not infer policy from current scattered calls.

Each effect needs:

- stable effect identity;
- owning authority and input references;
- prerequisites;
- retry/timeout policy;
- terminal success/failure/blocked reason codes;
- whether it is required before the request becomes operationally complete;
- whether it can create external side effects;
- compensation/reconciliation behavior.

A failed optional analytic event must not erase a successfully persisted request. A failed required identity/assignment/task effect must remain visible and retryable rather than being logged and forgotten.

## 9. ASSIGNMENT, TERRITORY, CAPACITY, AND OVERRIDE CONTRACT

Implement a versioned deterministic assignment authority for:

- territory;
- division;
- vertical/group;
- owner/rep;
- backup/escalation owner;
- service hours and SLA calendar;
- capacity/availability constraints;
- assignment reason codes and policy hash.

Requirements:

- no hard-coded personal fallback such as “Scott Stevenson” as hidden policy;
- an explicit configured fallback queue/owner when no eligible rep exists;
- stable tie-breaking and replay behavior;
- immutable assignment history;
- manual override through authorized compare-and-set with actor/reason;
- reassignment preserves prior ownership evidence and open work disposition;
- single-tenant CRM semantics—do not invent tenant isolation;
- agent reads remain limited by current contact/deal/task ownership policy.

## 10. SPEED-TO-LEAD, NEXT-BEST ACTION, AND CR-05 WORK

Create every task/ticket/SLA through CR-05. Required behaviors:

- source- and priority-specific SLA calculation;
- business-hours/calendar support;
- exactly one initial response task per logical request;
- next-best-action reason and prerequisites;
- escalation on breach through CR-05, not a parallel task table;
- task closure/replacement when the request advances;
- no duplicate tasks after replay, restart, reassignment, or concurrent workers;
- bounded operator dashboard queries and truthful blocked states.

AI may recommend an action only from frozen evidence. It may not fabricate facts, mutate commercial state, send, or close work autonomously.

## 11. STATEMENT, PITCH, PROPOSAL, AND APPLICATION-INVITE HANDOFF

Preserve current statement command/analysis and proposal authorities. CRO-05A must:

- make statement receipt/review a durable request effect;
- cancel or terminalize stale statement-chase work when a statement arrives;
- prevent archived/suppressed/advanced deals from receiving incompatible follow-up;
- generate sales-prep/pitch/proposal drafts from cited evidence and approved claims/pricing guardrails;
- identify model/prompt/output hashes for AI-assisted drafts;
- require human review before a proposal or pitch becomes approved;
- never auto-email a proposal during this task;
- create a durable application-invite intent only after the required reviewed sales state;
- hand off to the existing merchant-application service; do not implement underwriting or processor boarding.

“Proposal generated” must not equal “proposal sent,” and an estimate must not be reported as actual savings or revenue.

## 12. PROMOTIONAL AND TRANSACTIONAL COMMUNICATION BOUNDARY

Promotional readiness must follow:

```text
current identity/contactability
→ CR-04 frozen eligible cohort/decision
→ CR-06 approved package and READY_HELD preparation
```

CRO-05A must retire/fence direct promotional sequence enrollment from intake, smart routing, and legacy workflows. It must not release CR-06 intents.

Transactional acknowledgements must be classified separately, tied to the request purpose, rendered from approved content, and persisted as held intents during certification. Existing direct `sendGhlEmail`, SMTP, SMS, workflow enrollment, or other transport calls from an intake handler must not remain reachable for task-owned request effects.

## 13. DATA / SCHEMA / MIGRATION CHECK

Use additive migrations after the actual current head. Never reserve or invent a stale migration number.

Preflight must determine whether existing command/outbox/assignment tables can be extended. If new schema is required, include:

- inbound request envelope and occurrence identity;
- orchestration effect/intents and terminal receipts;
- assignment policy/activation pointer/decision/history;
- SLA/next-action linkage to CR-05;
- immutable reconciliation/audit records;
- uniqueness constraints for request/effect/assignment idempotency;
- indexes for worker claims and operator queries;
- database protections against mutation/deletion of terminal evidence.

Migration SQL and `shared/schema.ts` must agree. Prove fresh apply, apply twice, upgrade from predecessor, journal integrity, and recovery from a worker crash. No production backfill may infer consent, assignment, or commercial truth from weak heuristics.

## 14. AUTHORIZATION, IDOR, CSRF, AND PRIVACY

Certify a role matrix for public, agent, manager, admin, service principal, and unauthorized users.

- Public routes can create/replay only their own opaque receipt and may not enumerate CRM state.
- Agents can view/act only within existing ownership policy.
- Managers/admins may review assignment and orchestration according to capabilities.
- Policy activation, override, replay, and bulk reconciliation require explicit capabilities.
- Cross-record IDs return 404-style denial where appropriate.
- Mutating authenticated routes enforce CSRF.
- Public payloads, statements, emails, phones, addresses, raw form bodies, and tokens never appear in logs/audit metadata.
- Protected merchant data remains inside the existing protected-data boundary.

## 15. CONCURRENCY, IDEMPOTENCY, AND RECOVERY

Prove:

- simultaneous duplicate form submissions produce one logical request command;
- distinct occurrences remain distinct;
- only one worker owns an effect lease at a time;
- lease expiry permits safe recovery without duplicate effects;
- assignment is compare-and-set against the frozen policy revision;
- CR-05 task creation is exactly once;
- request replay cannot create a second deal, statement command, proposal, application invite, CR-04 handoff, or CR-06 preparation;
- partial completion resumes from durable receipts;
- cancellation stops only unclaimed work and preserves completed immutable history;
- reconciliation detects missing/orphaned effects without silently repairing ambiguous identity.

## 16. EXTERNAL SIDE-EFFECT ORDERING

Required order:

```text
persist request and protected payload reference
→ resolve canonical identity
→ persist effect intents
→ assign and create CR-05 work
→ complete internal statement/proposal/application handoffs
→ persist any communication intent as HELD
→ return/reconcile terminal request state
```

No external email, SMS, GHL workflow enrollment, cold sequence enrollment, provider dispatch, or application submission is authorized by this build prompt.

## 17. OBSERVABILITY AND OPERATOR UI

Add one coherent Inbound Revenue Operations surface within the existing CRM navigation rather than another redundant top-level console unless preflight proves no suitable owner exists.

Operators must see:

- request source/type/time and canonical links;
- owner/division/group and assignment reason;
- SLA timer/breach state and next-best action;
- required effects with pending/running/blocked/failed/complete status;
- statement/proposal/application-invite progression;
- campaign readiness as CR-04/CR-06 references only;
- reconciliation/retry controls gated by capability;
- redacted error reason codes and audit history.

Use bounded pagination, filters, empty/error/loading states, accessible controls, mobile-safe layouts, and no raw PII in aggregate cards.

## 18. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

If build-ready, implement immediately. Missing external sender/provider authority does not block internal durable orchestration because external sending is out of scope.

## 19. CORRECTED BUILD PLAN

Before editing, state:

- verified What & Why;
- exact Done Looks Like;
- files/tables/routes/workers to change;
- source paths to retire or fence;
- migration plan;
- rollout and rollback plan;
- **BLOCKING CORRECTIONS** required for safe build;
- **FOLLOW-UP HARDENING** that is useful but not required for this task.

Do not split ordinary task-owned corrections into new tasks.

## 20. IMPLEMENTATION PHASES

1. Freeze full intake/effect/writer census and orchestration manifest.
2. Add additive schema and database constraints.
3. Build the pure request planner and deterministic assignment evaluator.
4. Build envelope/effect persistence, worker leases, receipts, and reconciliation.
5. Migrate each intake adapter to the envelope one source at a time.
6. Route tasks/SLA through CR-05 and stages through existing authority.
7. Implement statement/proposal/application-invite and held communication handoffs.
8. Fence legacy promotional enrollment and direct transport paths.
9. Build the operator UI and authorization controls.
10. Register disposable certification and pre-deploy/CI gates.

## 21. KILL LINES

- KILL LINE: If any in-scope request can still launch a required effect only through fire-and-forget `.catch(...)`, the task has FAILED.
- KILL LINE: If intake can create an active promotional enrollment outside CR-04 → CR-06, the task has FAILED.
- KILL LINE: If replay can duplicate a contact, deal, task, statement command, proposal, application invite, or campaign handoff, the task has FAILED.
- KILL LINE: If assignment silently falls back to a hard-coded person or mutable unversioned rules, the task has FAILED.
- KILL LINE: If a proposal/estimate is auto-sent or represented as actual savings/revenue, the task has FAILED.
- KILL LINE: If any external message or provider call occurs during certification, the task has FAILED.
- STOP if the build invents a second contact, consent, task, stage, statement, proposal, application, CR-04, or CR-06 authority.
- STOP if logs/tests expose raw PII, protected merchant data, tokens, credentials, or document contents.

## 22. IMPLEMENTATION RULES

Use the smallest coherent diff and current repository patterns. No broad refactors, dependency churn, formatting sweeps, production data cleanup, `db push`, unrelated UI consolidation, or campaign-content rewrite. Preserve immutable CR-06 history. Use stable reason codes and canonical serialization/hashes. All new timers/jobs must have one durable owner and restart-safe identity.

## 23. TEST REQUIREMENTS

Cover happy, negative, boundary, race, replay, restart, authorization, privacy, and regression cases, including:

- every inventoried intake source;
- same occurrence replay and distinct occurrence behavior;
- identity ambiguity and contact/business conflict;
- missing assignment policy/owner/capacity;
- manual override/reassignment race;
- business-hours SLA and breach escalation;
- statement arrives during chase;
- contact archived/suppressed or deal advanced mid-workflow;
- reviewed versus unreviewed proposal/application invite;
- CR-04/CR-06 handoff eligibility and denial;
- legacy promotional path denial;
- queue unavailable, worker crash, lease expiry, and reconciliation;
- public/agent/manager/admin/service-principal authorization;
- log/audit redaction.

## 24. DISPOSABLE INTEGRATION CERTIFICATION

Run on fresh disposable PostgreSQL and isolated Redis with network denied and every mail/SMS/GHL/provider transport replaced by a throwing fake.

Certify the full matrix:

```text
public/GHL/partner/manual request
→ canonical envelope
→ contact/business/deal linkage
→ deterministic assignment
→ CR-05 task and SLA
→ source-specific next step
→ held transactional intent or CR-04/CR-06 readiness reference
→ restart/replay reconciliation
```

Assert zero provider attempts, zero external messages, zero live sequence enrollments, zero CR-06 releases, and no mutation of frozen cohorts/packages. Destroy the disposable environment rather than deleting immutable fixture history.

## 25. POST-BUILD SEARCHES AND REQUIRED GATES

Re-run the complete census and prove:

- in-scope intake routes use the envelope;
- no direct promotional enrollment remains reachable;
- no stage writer bypass is introduced;
- no direct task creation bypasses CR-05;
- no direct send occurs from task-owned paths;
- no hard-coded owner fallback remains;
- all suites are registered in `scripts/ci-suite-manifest.ts` and the required pre-deploy owner.

Run targeted tests, migration integrity, manifest validation, authorization/CSRF scans, typecheck/build as affected, and `git diff --check`. Separate unchanged baseline failures from task-owned failures; all task-owned gates must pass.

## 26. DIFF REVIEW, FINAL VFC, AND RESPONSE

Review `git status`, `git diff --stat`, and the full diff. Confirm no secrets, PII, generated junk, unrelated formatting, lockfile drift, production config mutation, or unapproved external activation.

Final VFC table:

| ID | Requirement/kill line | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` / receipt | command | PASS / FAIL |

Final response must include:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE;
- starting and ending SHA, working tree, and migration head;
- corrected root cause and full source/effect census;
- authority map and changed-file inventory;
- migration apply/replay/upgrade evidence;
- test/gate commands and totals;
- disposable end-to-end receipt IDs and zero-side-effect evidence;
- authorization matrix;
- retired/fenced path inventory;
- runtime versus code-only evidence;
- remaining external decisions or blockers;
- **FINAL STATUS:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE.

Do not call local/mock evidence production verification.

---

# TASK TO PREFLIGHT + BUILD

## CRO-05A — Inbound Revenue Operations, Assignment & Sales Handoff

### What & Why

Liberty already captures public, GHL, partner, referral, document, and manual requests, but important downstream effects are fragmented across route-local asynchronous calls. CRO-05A creates one durable, observable request lifecycle so every real inbound request becomes an owned, SLA-bound, recoverable sales action without duplicating identity, consent, task, stage, statement, proposal, application, CR-04, or CR-06 authorities.

### Done Looks Like

- Every in-scope intake persists/replays one canonical request envelope.
- Source-specific effects are versioned, durable, retryable, and reconciled.
- Territory/division/group/owner assignment is deterministic, versioned, capacity-aware, and override-audited.
- CR-05 owns every task/ticket/SLA and escalation.
- Statements, reviewed pitches/proposals, and application invites have durable handoffs.
- Promotional readiness reaches CR-04/CR-06 only; CR-06 release remains unavailable.
- Transactional confirmations are classified and held during certification.
- Operators can see truthful state, ownership, blockers, and retry history.
- Disposable certification proves restart/replay safety and zero external side effects.

### Out of Scope

- CRO-03 provider activation or continuous enrichment scheduling;
- rewriting approved CR-06 content;
- final email/SMS dispatch;
- underwriting, processor submission, boarding, MID activation, merchant success, or residual revenue;
- inventing business assignment policy inputs that the owner has not supplied.

### Relevant Files and Areas to Verify

- `server/routes/public.ts`, GHL/webhook routes, partner/referral/manual intake routes
- `server/services/process-new-lead.ts`, `server/services/smart-router.ts`
- contact/business/provenance writers and CRO-02/CRO-03 authorities
- `server/services/cr05-*`, task/ticket storage and SLA workers
- `server/services/deal-stage-service.ts`, deal routes and writers
- statement command, acquisition, upload-chain, analysis, and proposal services
- CR-04 and CR-06 handoff services/routes/tables
- `server/services/queue-manager.ts`, job registry, dead-letter/reconciliation UI
- `shared/schema.ts`, migrations, `scripts/pre-deploy.ts`, `scripts/ci-suite-manifest.ts`
- existing Lead Ops, My Day, Pipeline, Statement Review, and Contact Detail surfaces

### Existing Kill Line

KILL LINE: Every required request effect must be durable and replay-safe, and no in-scope intake may create promotional enrollment or external delivery outside the CR-04/CR-06 and later CRO-07 release authorities.

## FINAL DIRECTIVE

Do not merely plan CRO-05A. Verify the current repository, correct this contract only where current code proves it necessary, then build the complete safe scope in the same task. Keep external communication held. Do not create follow-up tasks for ordinary task-owned corrections, and do not claim completion until the final census, disposable certification, zero-side-effect proof, and strict review are green.
