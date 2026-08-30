# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD + CONDITIONALLY AUTHORIZED PROCESSOR SANDBOX CANARY

Task: **REV-05A — Merchant Application, Underwriting & Processor Boarding Authority**

Verify this task against current main and the processor environment actually contracted for Liberty. Continue directly into implementation after correcting the plan. Do not stop at a new plan unless a protected-data, processor-contract, credential, or external-authorization blocker prevents that exact portion.

Finding the known P0 simulation or MID disconnect is not permission to stop auditing. Continue through every application/status/stage/boarding/MID/portal/activation writer and consumer, every adapter method, every scheduled/manual refresh, and every protected-data handoff.

The latest verified drafting reference is `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22`, migration head `0194`. The verified audit baseline showed Payarc enabled by default, simulation fallback without credentials, optional mock enablement in production, approval written to `deals.mid`, and downstream lifecycle reading `merchant_mids`. Re-verify current reality. CRO-05A's final application-invite/sales-handoff contract is the prerequisite; CRO-03C and CRO-08A are not processor-boarding authorities.

This prompt does not itself authorize a live production processor submission. A sandbox or live canary may run only with explicit processor environment, credential, merchant fixture, cost, and owner authorization captured during preflight. Complete all denied/fake-provider work regardless.

## 1. REPOSITORY BASELINE

Capture:

- branch, HEAD, origin/main, and working-tree state;
- migration head/journal and CI/pre-deploy suite count;
- merchant application, protected-data, stage, boarding outbox, processor registry/adapter, MID, portal invite, activation monitor, and onboarding checklist owners;
- processor names, configured/readiness booleans, endpoint/environment identity, and activation state without secrets;
- worker/scheduler owners and latest safe heartbeats;
- current production/sandbox runtime classification and release SHA;
- CRO-05A and CR-05 integration status.

Never print application data, SSN/EIN/bank data, documents, credentials, provider payloads, MIDs/TIDs in logs, or invitation tokens.

## 2. PREREQUISITE AND NON-DUPLICATION GATE

Verify:

| Domain | Existing authority | REV-05A treatment |
|---|---|---|
| Sales/application-invite handoff | CRO-05A/current sales lifecycle | Consume approved handoff; do not redefine lead assignment. |
| Contact/business/deal identity | Canonical writers | Reference/validate; no parallel merchant identity. |
| Deal stage | `advanceDealStage()` | Exclusive stage transition owner. |
| Application lifecycle/protected data | Merchant application service/outbox/protected-data boundary | Extend and preserve. |
| Tasks/tickets/RFIs | CR-05 and current RFI authority | Use; do not create competing work queues. |
| Processor provider operations | Existing adapter/outbox foundation | Make fail-closed, explicit, durable, and reconciled. |
| MID state | `merchant_mids` and merchant MID service | Sole canonical MID authority. |
| Post-MID success/revenue | REV-06A | Produce activation handoff only. |

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce:

| ID | Claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Production processor registry fails closed without credentials/activation | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | Mock/simulation cannot report production success | ... | ... | ... |
| VFC-03 | Processor submission is durable/idempotent before I/O | ... | ... | ... |
| VFC-04 | Status polling/webhooks share one event authority | ... | ... | ... |
| VFC-05 | Approval atomically/recoverably creates canonical `merchant_mids` | ... | ... | ... |
| VFC-06 | Deal/application/MID statuses cannot drift silently | ... | ... | ... |
| VFC-07 | All stage writers use `advanceDealStage()` | ... | ... | ... |
| VFC-08 | RFI/decline/resubmit is versioned and replay-safe | ... | ... | ... |
| VFC-09 | Portal/equipment/go-live handoffs are durable | ... | ... | ... |
| VFC-10 | Protected data is encrypted/redacted/least-privilege end to end | ... | ... | ... |

## 4. COMPLETE APPLICATION, STAGE, BOARDING, AND MID WRITER CENSUS

Inventory all create/update/transition paths for:

- merchant application invite, draft, finalize, submit, review, RFI, approve, decline, withdraw, resubmit;
- protected-field and document/e-sign handling;
- deal pipeline/stage/boarding status/application ID/MID fields;
- boarding outbox commands and workers;
- processor submit/status/update methods;
- manual and bulk status-refresh routes;
- processor webhooks;
- `merchant_mids` create/update/status/activation;
- manual MID assignment;
- onboarding checklist, equipment/terminal, portal invite, and activation handoff.

Produce:

| Writer | Fields/table | Authority used | Idempotency/lock | External side effect | REV-05A disposition |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | preserve / migrate / fence / retire |

Explicitly verify `PATCH /api/my-day/deals/:id/stage` and every generic `storage.updateDeal(...stage...)` path.

## 5. COMPLETE PROCESSOR ADAPTER CENSUS

For every registered adapter and method inventory:

- environment/endpoint identity;
- credential requirements;
- activation mechanism;
- submit/status/update/transactions/daily stats/chargeback support;
- provider idempotency capability;
- timeout/retry/reconciliation semantics;
- simulation/mock/fallback behavior;
- request/response validation;
- logging/redaction;
- sandbox versus production behavior.

At minimum inspect Payarc, NMI, mock, registry fallback/default selection, health/ping status, and any test scripts that accept simulation as success.

## 6. VERIFIED ROOT CAUSE

Document:

- registry enablement is not the same as credentialed production activation;
- adapters can synthesize successful submissions/status/MIDs/data;
- processor approval currently updates deal fields rather than canonical MID state;
- status progression is manually polled and can drift;
- best-effort portal/task side effects are not a lifecycle authority;
- deal/application/boarding/MID states have overlapping writers.

Provide assumption/reality/correction evidence.

## 7. SOURCE-OF-TRUTH AND LIFECYCLE MAP

Freeze one lifecycle:

```text
approved application invite
→ draft/finalized application generation
→ internal review/document/e-sign readiness
→ underwriting review/RFI/decision
→ durable processor submission command
→ processor application identity
→ authenticated status events or governed polling
→ RFI/decline/resubmit/approval authority
→ canonical merchant MID projection
→ equipment/portal/go-live checklist
→ activation handoff to REV-06A
```

The application service owns application status. `advanceDealStage()` owns deal stages. The boarding authority owns provider submission/status receipts. `merchant_mids` owns MID assignment/status. Cross-authority updates must use durable commands/events, not shared-field guesses.

## 8. FAIL-CLOSED PROCESSOR ACTIVATION AUTHORITY

Create an explicit versioned activation record per adapter/environment containing:

- adapter and contract version;
- sandbox/production endpoint identity and allowed-host fingerprint;
- required credential key names and non-secret fingerprints/readiness;
- provider account/merchant-program identity;
- supported capabilities;
- idempotency/reconciliation contract;
- rate/cap/budget and timeout policy;
- webhook configuration/readiness;
- last bounded canary receipt and expiry;
- activated/disabled epoch, actor, reason, and reviewed SHA.

Production rules:

- adapter unavailable unless exact production activation record is open and current;
- missing credentials/endpoints/readiness fail closed;
- mock adapter and all simulated/fabricated success paths are impossible in production even if environment variables request them;
- sandbox evidence is labeled sandbox and cannot create production-class commercial/MID/revenue truth;
- key presence alone never activates the adapter.

## 9. APPLICATION AND PROTECTED-DATA CONTRACT

Preserve the existing strict intake/protected-data authority. Certify:

- opaque invite/token lifecycle, expiry, replay, and revocation;
- draft ownership and version compare-and-set;
- finalize freezes the exact application generation and required disclosures/consents;
- sensitive fields use encryption/tokenization and are absent from ordinary tables/logs/audits;
- document/e-sign references are immutable and access-controlled;
- protected-data reads are purpose-bound, audited, time-limited, and minimized;
- processor payload is generated from the exact finalized generation;
- application edits after finalization create a new generation/review, not silent mutation;
- retention/deletion follows existing legal policy and never destroys required evidence.

## 10. UNDERWRITING, RFI, DECLINE, AND RESUBMIT STATE MACHINE

Freeze legal application/underwriting transitions and reason codes. Required states must cover draft/finalized/submitted/review, RFI requested/responded/accepted/rejected, approved, declined, withdrawn, expired, and resubmission where current business policy permits.

Requirements:

- every transition compare-and-set against current version;
- one immutable decision/event per occurrence;
- CR-05 task/SLA for internal review and RFI;
- merchant-facing communication intent held unless its transactional channel is separately activated;
- decline reasons protected and role-scoped;
- resubmit creates a new provider attempt/generation, never overwrites prior truth;
- terminal provider reversal/change creates an explicit event and escalation.

## 11. DURABLE PROCESSOR SUBMISSION

Within one transaction:

1. lock exact application/deal/underwriting generations;
2. validate finalization, documents, consent, protected-data access, stage, and processor activation snapshot;
3. derive stable provider idempotency key;
4. create immutable boarding command/operation/attempt before I/O;
5. mark the command claim with lease/fencing token;
6. commit before transport.

After I/O terminalize atomically. Timeout/crash becomes unknown/reconcile-required, not a fresh submit. Same client idempotency key replays the original receipt; a changed application generation requires a new authorized command.

## 12. STATUS POLLING AND WEBHOOK AUTHORITY

Implement one canonical processor-status event path used by both:

- authenticated provider webhooks; and
- durable scheduled polling where webhooks are absent/incomplete.

Every event must authenticate/source-validate, dedupe, correlate to exact processor application and command/attempt, preserve provider event time, validate legal transitions, write immutable evidence, update application/boarding state through owners, create RFI/decline tasks, and reconcile unknown attempts.

Polling requires one registry-owned schedule, durable occurrences, lease/fencing tokens, bounded concurrency, backoff/rate limits, dead letters, and operator escalation. Manual refresh must enqueue/reuse the same authority—not call the adapter directly.

## 13. CANONICAL MID PROJECTION

On an approved processor event with a valid MID:

- validate contact/deal/application/provider linkage;
- normalize MID only according to provider contract;
- lock application/deal and existing MID candidates;
- create/replay exactly one `merchant_mids` record via the merchant MID authority;
- bind processor name/account/application/evidence and source event;
- detect conflicting MID-to-contact/deal/provider links and require review;
- update deal-facing projection only as a derived compatibility view after canonical MID commit;
- write immutable projection receipt;
- enqueue activation monitoring only from canonical MID state.

Approval is not complete until MID projection is terminal. Missing MID, ambiguous linkage, or conflicting existing MID must be visible `approved_pending_mid_review`, not silently “approved.”

## 14. DEAL-STAGE, ONBOARDING CHECKLIST, PORTAL, AND ACTIVATION HANDOFF

Repair every task-owned stage bypass, including the My Day route, to use `advanceDealStage()` with authorization, expected stage, reason, go-live gate, audit, and existing side effects.

Create durable, idempotent checklist/work items for equipment/terminal/configuration, required documents, go-live readiness, and portal invite. Portal invitation must be an intent with token generation and send outcome—not a best-effort import chain. External invitation remains held unless its transactional channel is active.

REV-05A ends with a canonical MID in the correct assigned/ready state and an immutable activation-handoff receipt. REV-06A owns first-transaction activation, ongoing data, support, health, and revenue.

## 15. DATA / SCHEMA / MIGRATION CHECK

Prefer existing application outbox, boarding outbox, protected outbox, RFI, checklist, and MID tables. Add only minimal authorities for processor activation snapshots, status events/poll occurrences, MID projection receipts, and recovery if missing.

Require additive migrations, SQL/schema parity, legal-state constraints, unique idempotency/provider-event/MID-link fences, indexes, immutable terminal evidence, fresh/apply-twice/upgrade/recovery tests, and no `db push`.

Do not backfill existing `deals.mid` rows into canonical MIDs without strong provider/application/contact evidence. Classify ambiguous historical rows for review; do not manufacture merchant truth.

## 16. AUTHORIZATION, IDOR, CSRF, AND PRIVACY

Certify public merchant, agent, manager, admin, underwriter/service principal, processor webhook, and unauthorized matrices for invitation, draft, protected read, finalize, review, RFI, approval/decline, submit, refresh, MID detail, override, checklist, and portal actions.

- Public merchant sees only its token-bound application and permitted RFI/document fields.
- Agents cannot read protected underwriting data unless explicitly authorized.
- Processor activation/config/canary and final approval require explicit capabilities.
- Webhooks authenticate and reject replay.
- 404-style IDOR and CSRF apply.
- Logs/audits are fully redacted and structured.

## 17. CONCURRENCY, IDEMPOTENCY, AND RECOVERY

Prove races for invite, draft update, finalize, underwriting decision, RFI response, processor submit, poll/webhook same event, duplicate approval, MID projection, manual MID assignment, stage transition, portal invite, and checklist completion.

Crash/restart tests must cover before I/O, after provider acceptance before local commit, approval before MID projection, MID projection before deal compatibility update, and portal/checklist handoff. Recovery must converge without duplicate provider submissions or MIDs.

## 18. EXTERNAL SIDE-EFFECT ORDERING

Required ordering:

```text
internal application/underwriting commit
→ activation/readiness snapshot
→ provider operation + attempt persisted
→ processor I/O
→ provider receipt/status event
→ canonical MID projection
→ activation/checklist/portal intents
```

No mock/simulation can satisfy a production gate. No sandbox/live call may occur without explicit authorization and a maximum-one canary plan. No external portal/RFI/application email is authorized unless the relevant transactional transport is already separately active.

## 19. OPERATOR UI AND OBSERVABILITY

Use existing Applications, Underwriting, Boarding, Onboarding, Support/RFI, Pipeline/My Day, and Contact Detail lifecycle surfaces. Avoid a new redundant top-level page.

Operators need truthful views of application generation/status, protected access state, underwriting/RFI SLA, boarding command/attempt/reconciliation, processor readiness/environment, canonical MID projection, checklist, portal-invite intent, blocked reason, and immutable history. Never display simulation as production or deal-only MID as canonical.

## 20. PREFLIGHT VERDICT AND CORRECTED PLAN

Use exactly one: BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH.

Then state verified What & Why, Done Looks Like, affected files/tables, migration plan, rollout/rollback, blocking corrections, follow-up hardening, and exact external canary blocker/authority. Complete safe code even when credentials or provider authorization are absent.

## 21. IMPLEMENTATION PHASES

1. Freeze writer/adapter/consumer census and legal lifecycle.
2. Make registry/adapters fail closed; remove production simulation.
3. Add activation/status/MID-projection authority schema.
4. Harden application generation/protected-data/review/RFI transitions.
5. Harden durable submission/attempt/reconciliation.
6. Implement unified webhook/poll status authority.
7. Implement canonical MID projection and conflict review.
8. Repair stage writers and durable checklist/portal/activation handoff.
9. Build operator UI/authorization/redaction.
10. Register disposable E2E and conditional bounded provider canary.

## 22. KILL LINES

- KILL LINE: If any production adapter can return simulated/fabricated success, MID, transaction, or daily data, the task has FAILED.
- KILL LINE: If key presence or `ENABLED_PROCESSORS` alone activates production boarding, the task has FAILED.
- KILL LINE: If provider I/O occurs before a durable operation/attempt or unknown outcomes blind-retry, the task has FAILED.
- KILL LINE: If approval can complete without canonical `merchant_mids` projection or explicit review-required status, the task has FAILED.
- KILL LINE: If deal stage changes bypass `advanceDealStage()`, the task has FAILED.
- KILL LINE: If protected data, documents, credentials, payloads, tokens, MID/TID, or decline details leak into logs/audits, the task has FAILED.
- KILL LINE: If sandbox/mock evidence is labeled production verification, the task has FAILED.

## 23. IMPLEMENTATION AND TEST RULES

Use current authorities and minimal coherent changes. No broad UI redesign, contact/enrichment schema changes, production-data cleanup, unrelated refactor, or live config mutation.

Tests must cover lifecycle transitions, stale versions, missing documents/consent/protected data, RFI loops, decline/resubmit, activation drift, adapter simulation denial, host/environment mismatch, submit concurrency, timeouts/reconciliation, webhook signatures/replay, poll/webhook races, MID conflict/duplication, stage authority, portal/checklist idempotency, role/IDOR/CSRF, and redaction.

## 24. DISPOSABLE END-TO-END CERTIFICATION

Use fresh disposable PostgreSQL/Redis and a deterministic fake processor injected through the real adapter contract. Network denied.

Certify:

```text
application invite
→ draft/finalize/protected generation
→ review/RFI/response/approval
→ durable boarding submit
→ fake provider accepted/status events
→ canonical MID projection
→ checklist/portal held intent
→ activation handoff
```

Run restart/recovery at every boundary, migration fresh/apply-twice/upgrade, authorization/privacy checks, and assert no external messages/calls. Simulation code must remain unreachable in production mode even inside the test.

## 25. CONDITIONALLY AUTHORIZED PROCESSOR CANARY

Only if explicit authority and credentials are available:

- verify exact sandbox/live endpoint and account;
- use one clearly classified non-production/sandbox merchant fixture or specifically authorized live fixture;
- approve maximum one submission/status cycle and cost;
- persist operation/attempt before I/O;
- reconcile response/webhook/poll;
- prove no duplicate submission and no production KPI contamination;
- redact evidence.

If unavailable, mark production connection pending—do not block safe merge or invent evidence.

## 26. POST-BUILD CENSUS, GATES, FINAL VFC, AND RESPONSE

Re-run all writer/adapter/status/MID/consumer searches. Prove simulation cannot execute in production, manual refresh uses the authority, stage bypasses are closed, approval projects canonical MID, and downstream activation reads `merchant_mids`.

Run migrations, application-security, processor-adapter, boarding, stage, MID, portal, authorization/CSRF/API, typecheck/build, CI/pre-deploy manifest, and `git diff --check`. Review full diff.

Return verdict, SHA/migration state, full census, authority/lifecycle map, changed files, migration receipts, disposable totals, provider canary receipt or exact blocker, zero-leak/zero-unapproved-I/O proof, authorization matrix, and code-complete/production-connected/activation status. Map every kill line in the final VFC.

---

# TASK TO PREFLIGHT + BUILD

## REV-05A — Merchant Application, Underwriting & Processor Boarding Authority

### What & Why

Liberty has substantial application, underwriting, boarding, portal, and MID code, but production adapters can simulate success and processor approval can remain trapped on the deal instead of becoming canonical MID truth. REV-05A creates one fail-closed, durable, replay-safe lifecycle from approved sales handoff through application, RFI, processor decision, canonical MID assignment, and activation handoff.

### Done Looks Like

- Production adapters require explicit current activation and cannot simulate.
- Application/protected-data generations and underwriting/RFI transitions are authoritative and immutable.
- Processor submissions and status events are durable, idempotent, authenticated, and reconcilable.
- Polling/webhooks share one authority.
- Approval creates/replays exactly one canonical `merchant_mids` record or enters visible review.
- Deal/application/MID stages remain consistent through their owners.
- My Day and every stage path use `advanceDealStage()`.
- Checklist/portal/activation handoffs are durable and held where transport is not active.
- Disposable E2E passes; bounded real sandbox/live canary is reported only if explicitly authorized.

### Out of Scope

- lead generation, enrichment, campaign content, cold outreach release;
- active-merchant daily data, health, residuals, retention, and revenue truth—REV-06A owns them;
- creating processor contracts/accounts/credentials or inventing underwriting policy;
- production submission without explicit approval.

### Relevant Files and Areas to Verify

- merchant application service/routes/outbox/protected-data/document/e-sign paths
- underwriting and RFI routes/services
- `server/routes/boarding.ts`, boarding outbox worker
- processor interface, registry, Payarc/NMI/mock adapters and tests
- deal stage service, deal storage/routes, My Day route
- merchant MID service/routes/table and activation monitor
- portal invite, onboarding/checklist/equipment/go-live services and UI
- `shared/schema.ts`, migrations, pre-deploy and CI manifests

### Existing Kill Line

KILL LINE: A processor-approved application is not terminal until it is reconciled into one canonical, evidence-linked MID or a visible conflict/review state; no production adapter may fabricate success.

## FINAL DIRECTIVE

Verify and build the complete task in place. Close the full writer/adapter/status/MID surface, preserve protected-data boundaries, use disposable certification, and run only an explicitly authorized processor canary. Do not claim production readiness from simulation or a deal-only MID.
