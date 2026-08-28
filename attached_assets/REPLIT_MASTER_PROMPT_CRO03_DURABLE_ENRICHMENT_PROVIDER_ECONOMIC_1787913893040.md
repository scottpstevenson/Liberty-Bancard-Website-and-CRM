# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK

**CRO-03 — Durable Enrichment Factory & Provider Economics**

**Primary findings:** `CAR-015`, `CAR-016`, `CAR-017`, `CAR-018`, `CAR-019`, `CAR-020`

## MODE

PREFLIGHT + BUILD

First verify the task against the exact current repository. This task may build only after CRO-02’s classification, provenance, identity, and quarantine authority is merged or current `main` contains verified equivalent behavior. If the prerequisite is present, continue directly through implementation, tests, and diff review in the same run. If it is absent, complete the entire preflight/audit and stop only the implementation portion with an exact prerequisite delta.

Do not confuse an API secret with permission, readiness, budget, or production approval. Outscraper’s key may now be configured, but current live code explicitly denies its call path. Do not enable or call Outscraper, Apollo, Proxycurl, Serper, ZeroBounce, AI, Sunbiz, GHL, or any other external provider merely because credentials exist.

Extend the current BT-10 provider controls, operations, attempts, observations, validation intents, and ZeroBounce generation/freshness model. Do not build a competing provider authority. Do not let provider or AI output overwrite canonical facts directly.

Complete the audit end to end even if a P0 or kill-line failure is found. Return the full P0/P1/P2 correction register, exact Verified-From-Code findings, post-build grep proof, and merge verdict.

Required sequence:

Repository baseline → prerequisite VFC → provider/source inventory → targeted searches → verified root cause → source/field authority check → blast radius → data/auth/concurrency/billing/external checks → P0/P1/P2 register → preflight verdict → corrected build plan → kill lines → implementation → isolated provider-denied tests/gates → post-build searches → diff review → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Recapture:

- branch, HEAD, `origin/main`, ancestry, and commit subjects;
- staged/unstaged/untracked state and unrelated changes;
- origin/visibility/protection evidence available locally;
- migration SQL/journal head;
- current CI workflow and suite manifest;
- provider manifest, approved adapters/callers, durable controls, and any operator configuration—names/status only, never secret values.

Verified planning baseline on 2026-08-27:

- remote: `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git`;
- live `origin/main`: `2f463398029fdc5adcd992ac4f068f81a2dfe640`;
- Task 1699/CRO-01 is merged at that commit;
- CRO-02 is **not** present on this baseline;
- migration head: `0165_outbound_send_claim_lease.sql` / journal index `169`, tag `0165_outbound_send_claim_lease`, `when=1794900000000`;
- the clean detached inspection worktree had no diff or `git diff --check` output.

Independently recapture. Never reset, clean, or overwrite unrelated work.

## 2. PREREQUISITE CHECK

Required prerequisites:

1. CRO-01 canonical revenue objects/counts merged.
2. CRO-02 commercial class, primary provenance, identity-resolution, and quarantine contract merged.
3. Existing BT-10 provider-readiness controls remain intact.

**Current finding: CRO-01 satisfied; CRO-02 missing.** Therefore implementation is not build-ready on the planning baseline. The executor may perform full preflight and produce exact corrections now, but must not implement CRO-03 until CRO-02 is merged/equivalent. Recheck at execution time; if satisfied, proceed directly into build.

## 3. VERIFIED FROM CODE — PREFLIGHT

Recapture and update this table:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | No durable provider authority exists | OUTDATED | BT-10 already defines provider controls, operations, attempts, observations, and validation intents with idempotency keys, claims, leases, budgets, billing state, and subject generation. | `shared/schema.ts:355-463`; `migrations/0158_provider_health_readiness_controls.sql` |
| VFC-02 | ZeroBounce validation is only an ad hoc API call | OUTDATED | ZeroBounce uses durable enablement/circuit/budget reservation, operation ownership, validation intents, current email token/generation, and terminal reconciliation. | `server/services/provider-readiness-control.ts:284-480`; `server/services/zerobounce-campaign-worker.ts:446-625` |
| VFC-03 | Generic enrichment is resumable per item | FALSE | `enrichment_jobs` stores aggregate status/count/result/error only, and `enrichment_runs` stores mutable input/output payloads without item claims, leases, fencing, cursors, or terminal item ledger. | `shared/schema.ts:1371-1385,3477-3489` |
| VFC-04 | Generic enrichment has crash-safe work ownership | FALSE | `runEnrichmentJob` marks one job running and loops through an in-memory selection; progress is aggregate and a process failure does not provide durable per-item recovery. | `server/services/enrichment.ts:234-290` |
| VFC-05 | Provider results are universally observations/candidates before canonical mutation | FALSE | Serper/AI enrichment can assign prospect fields and scores directly; SDR Serper and Sunbiz paths also have direct projection writes. No universal field-candidate/arbitration/mutation-event owner was found. | `server/services/enrichment.ts:126-147,150-223`; `server/services/sdr/serper-enrichment.ts:307-324`; `server/services/sunbiz-enrichment.ts` |
| VFC-06 | Serper has no budget or circuit control | OUTDATED | `SerperGateway` has durable control state, atomic window budget claims, bounded timeout, outcome classification, and zero-result-as-success semantics. | `server/services/serper-gateway.ts:195-315` |
| VFC-07 | Serper already uses the generic BT-10 operation/observation ledger for each subject | PARTIAL / FALSE | It uses `serper_control` and gateway counters; it does not uniformly create generic provider operations, attempts, observations, field candidates, and cost receipts tied to the enriched subject. | `server/services/serper-gateway.ts:195-315`; `shared/schema.ts:378-439` |
| VFC-08 | Outscraper is operational because its key exists | FALSE | The adapter calls `assertProviderActivation` with caller `unapproved` and `explicitPaidApproval:false`, so it is denied before transport. Key presence proves only configuration. | `server/services/sdr/outscraper.ts:136-149`; `server/services/provider-manifest.ts:310-327` |
| VFC-09 | Outscraper is ready for durable paid execution once enabled | FALSE | It uses process-local rate limiting, a mutable aggregate system-setting cost estimate, raw-result retention, raw error logging, and collapses failure/no-result to an empty array. | `server/services/sdr/outscraper.ts:31-96,118-200` |
| VFC-10 | Paid-provider approval is uniform | PARTIAL | The manifest requires explicit activation and budget metadata, but accounting varies (`control_row` versus `usage_setting`) and not every adapter is tied to durable per-operation receipts. | `server/services/provider-manifest.ts:145-200,305-327` |
| VFC-11 | Static paid-provider scanning proves runtime safety | PARTIAL | The scanner restricts hosts/imports to approved adapters; it cannot prove operator approval, budget reservation, idempotency, billing ambiguity, or evidence arbitration at runtime. | `scripts/scan-paid-provider-adapters.ts:17-73` |
| VFC-12 | Enriched/hot/warm means channel-qualified | FALSE | Generic enrichment writes status/score and contact data-readiness measures completeness only. Commercial class, primary provenance, identity, consent, suppression, provider freshness, ICP/offer fit, and campaign readiness remain separate decisions. | `server/services/enrichment.ts:194-212`; `server/services/contact-readiness.ts:1-55` |
| VFC-13 | Production provider readiness and positive coverage are proven | UNVERIFIED | Code controls exist, but no authorized production query/provider call was run. Runtime configuration, budget, current positive validation coverage, yield, and cost remain operations evidence. | code versus runtime boundary |
| VFC-14 | Historical Lead Ops counts prove current queue health | OUTDATED / UNVERIFIED | The old queue-size/worker observations are audit snapshots. Recapture aggregate-only runtime evidence separately; do not hard-code them into implementation or tests. | historical audit versus current repo/runtime |

Inspect full callers and side-effect boundaries; grep hits are not proof.

## 4. REQUIRED SEARCH / GREP CHECKS

Inventory at minimum:

- every provider in `provider-manifest.ts`, its billing model, activation policy, adapter, caller, timeout, retry, outcomes, candidate fields, and redaction rules;
- provider secrets by **name only**, readiness rows, circuit/budget state fields, operations, attempts, observations, validation intents, receipts, and cost counters;
- every provider network host/import and every direct `fetch`, SDK call, AI call, registry scraper, browser/crawler, or email validation call;
- every `enrichmentJobs`, `enrichmentRuns`, worker/scheduler, queue, Redis key, process timer, request-detached job, claim/lease/cursor, retry, cancellation, and terminal status;
- every provider/AI field write to contacts, prospects, businesses, SDR merchants/leads, scores, tags, decision-maker fields, email, phone, website, vertical, category, address, and notes;
- contact field authority and provenance/source-event writers;
- ZeroBounce email generation/token/freshness invalidation and send-time enforcement;
- Serper, Outscraper, Apollo, Proxycurl, Apify, Sunbiz, AI, internal deterministic enrichment, and unavailable/excluded sources;
- current provider/operator UI and role guards;
- tests, static scanners, CI capabilities, runtime register items, and deployment/provider-deny controls.

Report only code/config metadata and aggregate counts. Never print provider keys, queries containing PII, raw responses, contact values, payload bodies, or billable account details.

## 5. VERIFIED ROOT CAUSE

| Original Assumption | Verified Reality | Required Correction |
|---|---|---|
| Build all provider controls from scratch | BT-10 and specialized ZeroBounce/Serper controls already exist | Extend and converge them through one operation/evidence/economics contract |
| A configured Outscraper key makes it usable | Current adapter is deliberately denied; configuration is not approval | Require explicit operator enablement, budget, template/purpose approval, durable operation, and canary evidence |
| Enrichment jobs are durable because they have status rows | Job/run rows lack per-item ownership and recovery | Add snapshot, item ledger, claim, lease, fencing, cursor, attempts, and terminal disposition |
| Provider results may update empty fields directly | Direct write still loses conflict/provenance/arbitration semantics | Store observations/candidates first; one authority decides canonical mutations |
| Hot/warm/enriched identifies a usable campaign record | It measures activity/score, not channel permission or offer fit | Produce evidence for CRO-04; never substitute a score for qualification |
| A provider error can be represented as no result | That destroys economics and retry truth | Normalize explicit terminal/transient outcomes and billing state |

Root cause: the platform contains strong provider-specific safety controls and a broad provider manifest, but generic enrichment still operates as mutable job/run status plus direct canonical writes. Provider economics, subject evidence, field arbitration, and crash recovery are not unified. The result is neither safely scalable nor auditable enough to feed one qualified cohort authority.

## 6. SOURCE / FIELD AUTHORITY CHECK

Preserve these owners:

- **Commercial class/provenance/identity gate:** merged CRO-02 authority.
- **Provider activation catalog:** `provider-manifest.ts`.
- **Provider health/operation primitives:** BT-10 provider controls/operations/attempts/observations.
- **Email validation intent and currentness:** `provider-readiness-control.ts` plus current ZeroBounce worker.
- **Serper transport/circuit:** `SerperGateway`, adapted rather than bypassed.
- **Canonical contact writes:** `writeContact` and existing contact-field authority.
- **Canonical business writes:** existing business-ingest authority.
- **AI:** candidate/explanation producer only; never final identity, consent, class, or canonical fact authority.
- **Qualification:** CRO-04 consumes evidence; CRO-03 does not declare `READY_*`.

Add one enrichment contract:

`batch snapshot → durable item → pre-spend gate → provider operation/attempt → immutable observation → field candidate → arbitration decision → canonical mutation event → validation intent/currentness → terminal/cost reconciliation`

## 7. BLAST RADIUS

### In scope

- Durable enrichment batch/item/run ledger with snapshot boundary, claims, leases, fencing, attempts, cursors, cancellation, and terminal dispositions.
- Reuse/extend generic provider operations, attempts, observations, controls, and validation intents.
- Provider field candidates, arbitration decisions, canonical mutation events, and source linkage.
- Exact reservation/consumption/refund/ambiguous-billing/cost/receipt/yield reconciliation.
- Pre-spend class/provenance/identity/duplicate gates.
- Deterministic/free evidence first; selective paid sources only after approval.
- Safe Outscraper template/query registry and dry-run cost/yield projection; no activation or call.
- Current ZeroBounce generation/freshness after the final email mutation.
- Aggregate provider/yield/terminal-reason views with no PII.
- Dry-run, 100-record canary plan, 1,000-record validation plan, and bounded production runbook without execution.

### Out of scope

- Production enrichment, provider calls, paid-provider activation, budget changes, or canary execution.
- Production classification/provenance reconstruction or merges.
- Declaring channel/campaign readiness, enrolling a cohort, activating campaigns, or sending outreach.
- Redesigning Lead Ops or provider UIs beyond minimum truthful controls/evidence.
- New contact/business writers, GHL mutations, deployment, or production data cleanup.
- Scraping excluded or unauthorized sources.

List exact expected and excluded files before editing.

## 8. PROVIDER STRATEGY / ECONOMICS CONTRACT

Implement provider ordering as policy, not hard-coded uncontrolled fallbacks:

1. Reuse existing canonical/source evidence.
2. Normalize deterministic fields and resolve identity without network spend.
3. Use approved free registry/website evidence within policy.
4. Use Serper selectively for gaps where predicted value exceeds cost.
5. Use Outscraper only for approved business-discovery templates with bounded location/vertical scope and dedupe-before-spend.
6. Use Apollo/Proxycurl only if separately provisioned and approved; never probe them.
7. Run ZeroBounce only after the final email candidate wins arbitration and mutation generation is current.
8. Let AI summarize/classify evidence and propose candidates; never let it silently overwrite canonical identity or eligibility.

Every operation must record provider, purpose, template/version, subject fingerprint, idempotency key, requested/reserved/consumed/refunded units, billing state, attempt outcome, safe request/receipt reference, latency, yield, observation hash, and terminal reason—without raw PII or payloads.

Normalized outcomes must distinguish at least:

- `success`;
- `no_result`;
- `conflict`;
- `failure`;
- `unavailable` / `not_configured` / `disabled`;
- `timeout`;
- `rate_limited`;
- `circuit_open`;
- `budget_blocked`;
- `ambiguous_billing`;
- `cancelled`;
- `superseded`.

## 9. DATA / SCHEMA CHECK

**Migration expected: YES, after CRO-02 and exact preflight proof.**

The current generic enrichment rows lack durable item ownership and universal candidate/arbitration/economics tables. Prefer extending the BT-10 operation model and adding the smallest batch/item/candidate/mutation/receipt structures. Do not duplicate ZeroBounce-specific evidence unnecessarily.

At execution time, use the next legal migration after the actual head. On the current planning baseline that would be `0166_*` / journal index `170`, but CRO-02 is expected to consume that slot; therefore do not preassign a final migration number now.

No `db push`, migration-history edits, production migration, or production backfill. Bootstrap empty disposable PostgreSQL and apply twice.

## 10. AUTHORIZATION CHECK

| Action | Agent | Manager | Admin | Operations/Finance Owner |
|---|---:|---:|---:|---:|
| View own aggregate enrichment state | Scoped | Team aggregate | Global aggregate | As authorized |
| Create dry-run batch | No by default | Optional policy | Yes | Approved purpose |
| Enable free provider | No | No | No by code access alone | Explicit operator approval |
| Enable paid provider | No | No | No by secret/admin access alone | Explicit operator + budget approval |
| Approve provider template/purpose | No | Review | Admin review | Data/finance/legal owner |
| Run production canary | No | No | No by local access alone | Separate execution approval |
| Apply canonical field mutation | System authority only | Review conflicts | Review conflicts | Policy owner |

Secret presence, provider dashboard access, Replit access, or Git access is not authorization.

## 11. CONCURRENCY / IDEMPOTENCY / BILLING CHECK

Verify:

- one immutable batch population snapshot;
- one durable item per subject/stage/template/version;
- atomic claim/lease/fencing and stale-worker denial;
- heartbeat, cancellation, retry schedule, max attempts, and terminal state;
- exact replay returns the same operation/observation/mutation IDs;
- divergent replay conflicts;
- provider transport is never retried after ambiguous billing without explicit reconciliation;
- budget reservation and operation ownership commit atomically;
- consumption/refund/release is exactly once;
- zero-result is a completed provider outcome, not failure;
- field candidates never overwrite a newer canonical generation;
- arbitration replays safely and preserves rejected/conflicting candidates;
- email validation binds to the winning token hash and mutation generation;
- crash recovery is tested before/after every durable side-effect boundary;
- terminal item equation equals input snapshot and cost equation equals receipts/reservations.

## 12. EXTERNAL SIDE-EFFECT CHECK

All automated tests and smoke runs must deny network/provider/GHL/outbound transports. Build a fake provider transport that returns deterministic safe fixtures and simulated 2xx-zero, 4xx, 429, 5xx, timeout, parse, circuit, budget, and ambiguous-billing outcomes.

Do not claim configuration, provider health, credits, yield, current validation coverage, or production economics without direct authorized runtime evidence.

## 13. P0 / P1 / P2 CORRECTION REGISTER

### P0 — required before merge

- Enforce CRO-02 class/provenance/identity gates before any provider reservation or call.
- Replace process-local generic enrichment work with durable per-item ownership and replay safety.
- Route every paid/provider call through approved adapter/caller plus atomic operation/budget control.
- Stop direct provider/AI canonical overwrites; require observation → candidate → arbitration → mutation event.
- Preserve current email generation/freshness and enforce ZeroBounce only after final email mutation.
- Keep Outscraper and other paid providers disabled during build/tests.

### P1 — required for task completion unless proven unrelated

- Unify Serper subject evidence/economics with generic operations without discarding its circuit owner.
- Normalize provider outcomes and ambiguous billing semantics.
- Add exact batch, item, provider, receipt, mutation, and yield reconciliation.
- Add cost/yield dashboards or aggregate APIs with safe reason codes and `asOf`.
- Add dry-run, 100-record, and 1,000-record plans with stop thresholds and owner approvals.

### P2 — follow-up hardening

- Predictive source selection, per-vertical marginal ROI, and automated provider-mix optimization after measured canaries.
- Operator UI polish and long-term cohort economics.
- Additional providers only after manifest, legal/purpose, adapter, budget, and evidence reviews.

## 14. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

**Current verdict: NOT BUILD-READY.** CRO-02 is not merged on the verified baseline. Full preflight is allowed; implementation must wait. Once CRO-02 is merged/equivalent and recaptured, expected verdict is `BUILD-READY WITH CORRECTIONS` unless new evidence changes the root cause.

## 15. CORRECTED BUILD PLAN

1. Recapture baseline and prove CRO-01/CRO-02 prerequisites.
2. Inventory provider callers, job/run schedulers, field writers, and budget/evidence owners.
3. Define the batch/item/operation/observation/candidate/arbitration/mutation/receipt contract.
4. Add the smallest additive durable schema and repository services.
5. Put class/provenance/identity and duplicate gates before reservation/spend.
6. Adapt Serper and deterministic/free sources into the shared operation/evidence model while retaining specialized circuits.
7. Contain Outscraper behind disabled config, approved templates, dry-run estimates, durable budget/receipt semantics, redaction, and safe outcomes.
8. Route provider and AI outputs to candidates; apply winners through existing contact/business field authorities.
9. Bind ZeroBounce to the final email mutation generation and current validation evidence.
10. Add aggregate reconciliation/yield views and operator runbooks.
11. Add provider-denied static, migration, integration, concurrency, billing, recovery, authorization, and privacy tests.
12. Run gates, post-build searches, diff review, and final VFC.

## 16. DONE LOOKS LIKE

- Every enrichment batch has an immutable input snapshot and every item reaches one terminal disposition.
- Claims, leases, fencing, retries, cancellation, and recovery are durable.
- Every provider call has an approved adapter/caller, purpose, template/version, budget reservation, operation, attempts, observations, and billing disposition.
- Provider/AI results become evidence/candidates before canonical mutation.
- Arbitration is deterministic, versioned, replay-safe, and preserves conflicts.
- No current field is overwritten by stale evidence.
- ZeroBounce positive validation matches the final email token/generation and is current.
- Exact input/terminal and reservation/consumption/refund/receipt equations reconcile.
- Outscraper remains disabled until separate approval, but its safe high-ROI template registry and canary controls are ready.
- Dry-run, 100-record enrichment canary, and 1,000-record validation plans are documented with measurable stop/go thresholds.
- No production/provider/GHL/campaign/outreach/deployment side effect occurs.

## 17. KILL LINES

- STOP if CRO-02 is absent or provider spend can occur before class/provenance/identity gates.
- STOP if a provider secret, raw payload, raw query with PII, or credential is printed/stored in audit output.
- STOP if provider or AI output writes canonical facts without observation/candidate/arbitration/mutation evidence.
- STOP if one crash/retry can duplicate provider billing or canonical mutation.
- STOP if ambiguous billing is automatically retried.
- STOP if failure, no-result, disabled, timeout, circuit, or budget outcomes collapse into success/empty-result ambiguity.
- STOP if phone/email mutation does not invalidate dependent validation/qualification generations.
- STOP if Outscraper/Apollo/Proxycurl/Serper/ZeroBounce or any paid provider is called without explicit approval and atomic budget ownership.
- STOP if tests make network/provider/GHL/outbound calls.
- STOP if a second contact/business/classification/provider authority is introduced.
- STOP if `db push`, production backfill, or migration-history edits occur.

Record any failure and continue auditing independent requirements.

## 18. IMPLEMENTATION RULES

Use the smallest reviewable diff, parameterized queries, stable reason codes, safe hashes/tokens, current redaction helpers, and existing queue/provider patterns. Store evidence references and hashes, not raw sensitive payloads. Keep source evidence immutable and canonical mutations explicit.

No broad refactor, dependency change, lockfile churn, provider config mutation, production script, formatting sweep, or unrelated UI cleanup.

## 19. TEST REQUIREMENTS

Use non-empty synthetic fixtures and fake transports. Cover:

- zero/one/many batches and items;
- snapshot stability when source records change later;
- first claim, concurrent claim, lease expiry, stale fence, heartbeat, cancellation, replay, divergent replay;
- crash before/after reservation, transport, attempt receipt, observation, candidate, arbitration, mutation, validation intent, and terminalization;
- success, zero result, conflict, disabled, not configured, timeout, 429, 4xx, 5xx, parse error, circuit open, budget blocked, ambiguous billing, cancelled, superseded;
- budget reserve/consume/refund/release and exact cost receipt totals;
- stale candidate versus newer canonical generation;
- provider conflict and deterministic winner/no-winner outcomes;
- AI candidate cannot override protected identity/class/consent fields;
- final email mutation causes new validation generation; stale ZeroBounce proof is blocked;
- class/provenance/identity/duplicate pre-spend denial;
- anonymous/Agent A/Agent B/manager/admin visibility and control matrix;
- all network/provider/GHL/outbound transports denied;
- migration bootstrap twice and compatibility with existing provider data.

Tests fail if fixture population is empty or provider transport is not explicitly denied.

## 20. SMOKE / INTEGRATION PLAN

Prove the local flow with fake providers:

`classified/source-resolved subject → batch snapshot → item claim → deterministic evidence → simulated provider operation → observation → candidate → arbitration → canonical mutation event → ZeroBounce intent → terminal/cost reconciliation`

Also prove blocked class, missing provenance, collision, no-result, ambiguous billing, and stale-worker cases.

## 21. CANARY / VALIDATION PLAN (DO NOT EXECUTE)

### Dry run

- Zero provider calls.
- Aggregate eligible/block reasons, source gaps, dedupe rate, predicted request count, maximum spend, and expected fields.
- Require operator, data owner, and finance approval of provider/template/budget.

### 100-record enrichment canary

- Deterministic stratified sample defined before execution.
- Hard budget and request ceilings.
- Measure unique-business yield, decision-maker yield, net-new current valid email yield, conflict rate, no-result rate, error/timeout rate, duplicate prevention, cost per usable record, and canonical mutation accuracy.
- Stop on any privacy leak, uncontrolled spend, duplicate charge/mutation, reconciliation mismatch, high conflict, or provider policy breach.

### 1,000-record validation

- Allowed only after reviewed 100-record evidence.
- Same frozen policy/template versions with tighter monitoring.
- Compare incremental provider value and conversion-relevant lift; do not optimize on raw row count.

No plan authorizes execution.

## 22. REQUIRED GATES

Run and report command, exit code, result:

- focused CRO-03 deterministic/provider-denied suites;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-static`;
- disposable migrations twice and deterministic integration capability;
- provider-denied server plus server-required capability;
- `npx tsx scripts/scan-paid-provider-adapters.ts`;
- provider-manifest validation, provider-deny certification, canonical intake/contact writer/classification scans;
- `npx tsx scripts/check-route-guards.ts`;
- `npx tsx scripts/check-migration-integrity.ts`;
- `npm run check`;
- `npm run build`;
- `git diff --check`.

Do not invent passes or substitute mocks for production verification.

## 23. POST-BUILD GREP CHECKS

Prove:

- no task-owned provider URL/SDK call exists outside an approved adapter;
- no direct provider/AI canonical write bypass remains in changed scope;
- all changed generic jobs have durable item claims/leases/fencing/terminal states;
- every paid call site has explicit approval plus atomic budget/operation ownership;
- no raw provider payload/error/PII is logged or persisted in new code;
- no failure/no-result/budget/circuit ambiguity remains;
- current ZeroBounce proof binds to final email token/generation;
- no production/provider/GHL/campaign/outreach/deployment mutation is present;
- no CRO-04 cohort/readiness policy is prematurely implemented.

## 24. DIFF REVIEW

Run status, stat, staged/unstaged diff, and `git diff --check`. Confirm only CRO-03 files changed; no CRO-02 rewrite, campaign activation, external config, secrets, PII, payloads, fixtures with real data, generated artifacts, lockfile drift, or unrelated formatting entered the diff.

## 25. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | CRO-02 pre-spend gate | `file:line` | denial matrix | PASS/FAIL |
| VFC-F02 | Durable batch/item ownership | `file:line` | claim/recovery tests | PASS/FAIL |
| VFC-F03 | Unified operation/attempt/observation | `file:line` | outcome matrix | PASS/FAIL |
| VFC-F04 | Candidate/arbitration/mutation authority | `file:line` | conflict/stale tests | PASS/FAIL |
| VFC-F05 | Exact billing/cost reconciliation | `file:line` | receipt equations | PASS/FAIL |
| VFC-F06 | Current ZeroBounce generation | `file:line` | mutation/freshness tests | PASS/FAIL |
| VFC-F07 | Outscraper remains approval-gated | `file:line` | provider-deny/static scan | PASS/FAIL |
| VFC-F08 | Safe normalized outcomes | `file:line` | failure matrix | PASS/FAIL |
| VFC-F09 | Provider/PII redaction | `file:line` | log/payload scans | PASS/FAIL |
| VFC-F10 | No external/production side effect | diff/search | denied transport | PASS/FAIL |

Expand for every Done Looks Like row and kill line.

## 26. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- **Repository State:** starting/ending SHA, worktree, migration head.
- **Prerequisite State:** exact CRO-01/CRO-02 evidence.
- **Verified Root Cause and Assumption Corrections.**
- **P0 / P1 / P2 Corrections:** complete set.
- **Enrichment / Provider Contract.**
- **Implementation:** `file:line — change`.
- **Reconciliation:** aggregate input/terminal, provider outcome, mutation, and cost equations.
- **Tests/Gates:** command, exit code, result.
- **Grep and Kill-Line Verification.**
- **Runtime/Operations Verification:** code/test versus provider account/production truth.
- **Canary State:** planning only unless separately authorized.
- **Remaining Risks and Owner Actions.**
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE.
- **Branch/PR URL:** no merge/deploy/activation without explicit authorization.

## 27. RELEVANT FILES / AREAS TO VERIFY

- `shared/schema.ts`
- `server/services/provider-manifest.ts`
- `server/services/provider-readiness-control.ts`
- `server/services/zerobounce-campaign-worker.ts`
- `server/services/serper-gateway.ts`
- `server/services/enrichment.ts`
- `server/services/sdr/outscraper.ts`
- `server/services/sdr/serper-enrichment.ts`
- `server/services/sdr/lead-finder.ts`
- `server/services/sunbiz-enrichment.ts`
- `server/services/contact-field-authority.ts`
- `server/services/contact-writer.ts`
- `server/services/commercial-classification-authority.ts`
- `server/routes/sdr.ts`
- `server/routes/contacts.ts`
- `server/routes/prospects.ts`
- `migrations/0158_provider_health_readiness_controls.sql`
- `migrations/0136_zerobounce_campaign_engine.sql`
- `migrations/0160_seed_zerobounce_provider_control.sql`
- `migrations/meta/_journal.json`
- `scripts/scan-paid-provider-adapters.ts`
- `scripts/test-certification-provider-deny.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/check-migration-integrity.ts`
- `.github/workflows/ci.yml`

Locate current owners first.

## 28. FINAL DIRECTIVE

Do not implement on the verified planning baseline because CRO-02 is absent. Finish the full preflight and exact correction set. When CRO-02 is merged/equivalent, recapture live main and proceed directly through the safe code-side build. Keep all real provider calls, paid activation, budgets, production canaries, GHL, campaigns, outreach, deployment, and production data untouched.
