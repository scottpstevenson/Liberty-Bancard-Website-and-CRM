# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify current revenue/application/deal/financial paths, correct the task and implement safe repository-owned work in the same run. Stop only for a false finding, wrong owner, missing prerequisite, materially different architecture, unavailable evidence necessary for financial correctness, required split or kill line.

Do not send real outreach, use real banking/SSN values, call real processors in tests, invent commercial metrics, optimize on synthetic/unvalidated cohorts, use `db push`, weaken tests or refactor unrelated revenue features.

Required sequence: baseline → VFC → searches → root cause → ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → build → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture branch, HEAD SHA, working tree and migration head. Identify current feature flags and fake-provider/test harnesses without exposing secrets. Preserve unrelated modifications.

## 2. VERIFIED FROM CODE — PREFLIGHT

Create:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Verify every deal-stage writer, application/underwriting/boarding transition, statement request/upload/archive flow, merchant activation, chargeback/residual source/import/calculation/report, message/template renderer, sequence enrollment, CTA/unsubscribe/sender handling, funnel/experiment query and classification/readiness prerequisite. Trace all callers/writers/consumers and existing protections.

## 3. REQUIRED SEARCH / GREP CHECKS

Search and inspect:

- deal stage/status enums, direct updates and transition services;
- application, underwriting, boarding, activation and processor/GHL effects;
- statement follow-up/chase/upload/archive/completion and external-stage changes;
- chargeback, residual, MID, payout, import/batch/reconciliation and amount calculations;
- templates, subjects, rendering, sender identity, CTA, unsubscribe and deliverability;
- campaign/sequence/enrollment and outbound authority/contactability;
- funnel, attribution, experiment/A-B and conversion queries;
- `record_class`, validation, identity, provenance, readiness and lead score prerequisites;
- auth, idempotency, audit, queue and tests.

Inspect implementation and data flow; status names do not prove a state machine.

## 4. VERIFIED ROOT CAUSE

State which direct writers/competing owners remain, which edge cases are code gaps versus runtime-only evidence, whether financial reports reconcile to source facts, whether templates are fully governed and whether cohorts are trustworthy. Correct outdated assumptions in the standard table.

## 5. SOURCE-OF-TRUTH CHECK

Identify canonical deal transition owner, encrypted application state owner (BT-02), statement workflow owner, boarding/provider owner, merchant/MID authority, chargeback/residual calculation and reporting owners, message/template owner, enrollment/send owner and funnel/experiment owner. Do not create parallel state machines or reporting facts.

## 6. BLAST RADIUS

### In scope

- single-owner deal-stage transitions;
- statement edge-case correctness;
- isolated application → underwriting → boarding → activation path;
- chargeback/residual count/amount reconciliation;
- volume-ranked template/content/rendering/compliance audit and fixes;
- production-only trustworthy funnel/experiment gates;
- tests and runtime evidence instructions.

### Out of scope

- real provider onboarding, real sends or financial settlement;
- changing encryption, consent, classification, identity, provenance or readiness ownership;
- speculative growth experiments before cohort gates;
- unrelated CRM UI redesign;
- destructive historical financial correction without approved reconciliation.

List exact expected/untouched files after preflight.

## 7. DATA / SCHEMA CHECK

Verify statuses, transitions, constraints, unique keys, FKs, amounts/currency/precision, source/batch lineage, effective dates, archive behavior and all readers/writers for deals, applications, statements, merchants, MIDs, chargebacks, residuals, payouts and funnel events. Ensure classification is present and production-default.

If migration is required, use next valid Drizzle migration/journal and prove replay. Do not rewrite financial history without an explicit reversible reconciliation plan. No `db push`.

## 8. AUTHORIZATION CHECK

Produce role matrix for stage transitions, statement actions, underwriting/boarding approvals, activation, financial import/reconciliation/override, template publishing, campaign/pilot creation and experiment activation. Server-side role gates and immutable audits are required; separation of duties must be preserved where present.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Check simultaneous stage changes, duplicate uploads/imports, repeated webhooks, boarding retries, activation races, duplicate chargeback/residual files, payout recalculation, template publication and enrollment replay. Require legal transition checks, version/locking, stable idempotency, deterministic reconciliation and durable external intents. Prevent duplicate deals, applications, payouts and sends.

## 10. EXTERNAL SIDE-EFFECT CHECK

Document local validation/authorization → durable transition/intent → GHL/processor/email provider → result/reconciliation/audit ordering. Cover external success/DB failure, DB intent/external failure, webhook replay, timeout and duplicate execution. Use encrypted synthetic fixtures and fake providers only. Never claim external and DB atomicity.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK or WATCH. Continue immediately for build-ready work. If production financial source evidence or operational provider credentials are required, complete the state machine/tooling/tests and reserve actual reconciliation/E2E evidence for VG-04.

## 12. CORRECTED BUILD PLAN

State corrected root cause, exact outcomes and file-specific steps. Separate code-owned transitions, isolated E2E, read-only reconciliation, approved data correction and later experiments. Identify dependencies that are not actually merged.

## 13. KILL LINES

- KILL LINE: If a deal, application, merchant activation or financial state can still be materially changed through a competing/direct writer outside the canonical audited transition owner, the task has FAILED.
- STOP if duplicate/replayed execution can create multiple deals, applications, boarding effects, payouts or sends.
- STOP if synthetic/test/unknown data appears in production revenue or experiment metrics.
- STOP if financial counts or amounts cannot reconcile to classified source/batch facts.
- STOP if templates omit required unsubscribe/sender/CTA or bypass contactability/outbound authority.
- STOP if tests reach a real provider or persist real sensitive data.
- STOP if optimization begins before cohort gates pass.

## 14. IMPLEMENTATION RULES

Use existing state-machine, queue, audit, encryption and fake-provider patterns. Smallest safe diff, no unrelated cleanup, broad rename, formatting sweep, dependency/config change or production activation. Preserve legal transition semantics and financial precision.

## 15. TEST REQUIREMENTS

Cover valid/invalid stage transitions, authorization, concurrency, stale state, replay, statement mid-chase upload/archive/completion/external changes, application/underwriting/boarding/activation happy and partial failures, fake provider retries, chargeback/residual duplicate imports and amount reconciliation, template rendering/escaping/claims/CTA/unsubscribe/sender, production-only funnel gates and adjacent regression behavior.

## 16. SMOKE / INTEGRATION TEST

Extend canonical revenue suites or add `scripts/test-bt12-revenue-state-reconciliation.ts`. Prove:

1. only canonical transition services mutate stages;
2. illegal/unauthorized/replayed transitions cause no forbidden effect;
3. statement edge cases converge correctly;
4. isolated encrypted application → activation works with fake providers;
5. provider/DB partial failure remains recoverable/idempotent;
6. chargeback/residual counts and amounts reconcile by classified batch;
7. highest-volume templates render compliant content;
8. only approved production-class, validated, identity-clean cohorts reach experiment enrollment;
9. no real provider call/send occurs.

## 17. POST-BUILD GREP CHECKS

Prove direct stage writers are gone/justified, all side effects follow durable canonical transitions, financial reports use classified source facts, template send paths use canonical enrollment/contactability, funnel queries are production-only and no stale status/API consumer remains.

## 18. REQUIRED GATES

Run targeted revenue/statement/application/financial/template tests, outbound/contactability/classification/identity/provider regressions, typecheck, build, migration replay, RBAC/contracts/pre-deploy/invariants and `git diff --check`. Report actual commands and reserve isolated-production/runtime evidence for VG-04.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat` and `git diff`. Confirm intended files only, no secrets, real PII/bank data, live provider endpoints, production cohort activation, debug artifacts, unrelated formatting/lockfile/config changes or irreversible financial mutation.

## 20. FINAL VFC TABLE

Produce:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | test | PASS |

Map every Done Looks Like requirement and kill line; distinguish fake-provider E2E from live boarding and read-only reconciliation from approved data correction.

## 21. FINAL RESPONSE FORMAT

Return: VERDICT (COMPLETE / VERIFIED, PARTIALLY COMPLETE or DO NOT MERGE); Repository State (starting SHA, ending SHA/working tree, migration head); Verified Root Cause; Preflight Corrections; Implementation (`file:line`); Tests/Gates; Grep Verification; Kill-Line Verification; Runtime Verification; Remaining Risks; and Final Status (SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING or DO NOT MERGE). State precisely what still requires exact-release VG-04 production verification.

## LIBERTY-SPECIFIC SAFETY RULES

- Applications use encrypted/tokenized sensitive data and one state owner.
- Consent, contactability and outbound authority remain unavoidable before enrollment/send.
- Commercial reporting and experiments are production-class only.
- Revenue jobs are durable and replay-safe.
- External provider and DB state are distributed.
- No `db push`.

## PRACTICAL REVIEW STANDARD

Block duplicate sends/effects, unauthorized or competing stage mutation, data/financial loss, unreconciled amounts, synthetic metric contamination or unrecoverable job state. Do not delay safe state-machine and test work merely because live merchant/provider evidence belongs to the verification gate.

# TASK TO PREFLIGHT + BUILD

## BT-12 — Revenue State Machines, Reconciliation & Optimization

**Primary findings:** `OUT-08`, `REV-02`, `REV-04`, `REV-05`, `REV-06`, `REV-07`

**Dependencies:** BT-02, BT-04 and BT-06 through BT-11

### What & Why

Deal stages and downstream revenue workflows have competing or insufficiently proven owners; statement, onboarding and financial edge cases lack complete production-path evidence; template compliance needs volume-ranked review; and funnel experiments cannot be trusted until cohorts are classified, identity-clean, validated and eligible.

### Done Looks Like

- One audited owner controls deal-stage transitions.
- Statement acquisition handles mid-chase upload, archive, completion and external-stage changes.
- Encrypted application → underwriting → boarding → activation passes isolated E2E with fake providers.
- Chargeback/residual source, import and report counts/amounts reconcile by classified merchant/batch.
- Highest-volume templates pass rendering, claim, CTA, unsubscribe, sender and deliverability requirements.
- Funnel analytics/experiments accept only approved production-class, validated, identity-clean cohorts.
- No duplicate or real provider effects occur in tests.

### Out of Scope

- Live sends, live processor boarding, speculative experiments and destructive financial corrections without separate operational approval.

### Proposed Implementation Steps

1. Inventory transition writers, financial facts, templates and cohort gates.
2. Consolidate deal/revenue transitions behind canonical services.
3. Correct statement edge cases and durable recovery.
4. Build isolated encrypted onboarding E2E with fake providers.
5. Add deterministic chargeback/residual reconciliation.
6. Audit/fix volume-ranked template rendering and compliance.
7. Enforce trustworthy production cohort gates for analytics/experiments.
8. Add production-path tests and VG-04 evidence instructions.

### Relevant Files and Areas to Verify

- deal/application/statement/merchant/MID transition services and routes
- underwriting/boarding/activation workers and provider adapters
- chargeback/residual/payout imports, schema, calculations and reports
- templates/renderers/campaign/sequence/enrollment services
- funnel/analytics/experiment selectors
- auth/audit/queue/fake-provider infrastructure
- relevant migrations and tests

### Existing Kill Line

KILL LINE: No competing writer, replay, synthetic data or incomplete eligibility path may create a material revenue transition, financial metric, experiment enrollment or external effect.

## FINAL DIRECTIVE

Verify all owners and prerequisites first, then build the safe state-machine, reconciliation and test work now. Never use live providers or unapproved cohorts, and reserve exact-release production evidence for VG-04.
