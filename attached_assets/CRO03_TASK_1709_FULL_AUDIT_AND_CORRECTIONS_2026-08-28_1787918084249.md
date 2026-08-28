# Task #1709 — CRO-03 Durable Enrichment Factory

## Full Preflight Audit, Material Corrections, and Controlling Addendum

**Audit date:** 2026-08-28  
**Audited task:** `1709 - CRO-03 Durable Enrichment Factory`  
**Authoritative repository baseline:** `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42`  
**Verdict:** **BUILD-READY WITH MATERIAL CORRECTIONS; MERGE BLOCKED UNTIL THE BASELINE STATIC FAILURE AND ALL P0/P1 ITEMS ARE CLOSED**

---

## 1. Executive verdict

Task #1709 is directionally correct and preserves the intended CRO sequence. It correctly recognizes that BT-10 already owns provider controls, CRO-02 remains shadow-first, Serper and ZeroBounce have existing authorities, and CRO-03 must add a durable evidence/candidate/arbitration layer without activating providers or declaring CRO-04 readiness.

The owner’s intended end state is now explicit: **ZeroBounce, Serper, Outscraper, and Apollo must all be first-class governed providers in the completed factory.** “Provider disabled during build” means transport and spend remain off until a separately approved canary; it does **not** mean leaving Apollo or Outscraper as documentation-only placeholders. Apollo is a new-provider onboarding because no Apollo job history exists. Outscraper must support both future API execution and later ingestion of results created directly on the Outscraper website, with both paths converging on the same observation/candidate/arbitration contract.

The plan is not yet sufficiently deterministic for implementation without an addendum. The remaining problems are concentrated in **15 material corrections**, not 33 independent defects:

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 8 | Must be incorporated before implementation or merge |
| P1 | 5 | Required for complete acceptance and reproducible certification |
| P2 | 2 | Explicitly deferred optimization/hardening |
| **Total** | **15** | Consolidated by control boundary, not line item |

The most consequential issues are:

1. The task does not freeze how every existing enrichment route, scheduler, and UI action transitions to the durable factory.
2. The batch snapshot is described by a hash/high-water mark, but exact immutable membership rows are not required.
3. The CRO-02 dependency fingerprint is not explicitly revalidated immediately before provider transport and again before canonical mutation.
4. A generic reservation ledger could double-count budgets already owned by Serper, ZeroBounce, and AI audit authorities, while Apollo and Outscraper still need explicit new budget owners.
5. Candidate privacy and atomic mutation lineage are underspecified; a hash alone cannot support later email/phone projection.
6. Generic and Sunbiz enrichment still contain direct network and canonical-write paths, including raw website fetching without a complete SSRF/redirect/size boundary.
7. The authorization model invents a generic “team-scoped” rule that is not established by the current single-tenant CRM policy and leaves several auth-only routes unresolved.
8. Current enrichment invokes CRO-04/CRO-05-adjacent effects such as readiness recalculation, offer routing, skipped-state clearing, business ingestion, and post-enrichment work.

Implementation may begin after the controlling addendum in Section 13 is appended to the task. Merge acceptance remains blocked until all P0/P1 items are evidenced and the known baseline CI failure is assigned and fixed.

---

## 2. Repository state and prerequisite proof

The audit used a clean detached worktree. The pre-existing checkout and its unrelated uploaded/media edits were not modified.

| Item | Verified state |
|---|---|
| `HEAD` | `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42` |
| `origin/main` | `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42` |
| Commit | `Complete CRO-02 shadow commercial resolution and graph fencing` |
| Worktree | Clean |
| CRO-01 | `2f463398…` confirmed in ancestry |
| CRO-02 | Present at current HEAD |
| Migration head | `0173_cro02_graph_lock_order.sql` |
| Journal | index `177`, `when=1795700000000` |
| CI manifest | 67 suites: 22 static, 26 integration, 13 server-required, 6 server-optional |

The prerequisite is therefore satisfied: CRO-03 no longer waits on CRO-02. CRO-02 is deliberately shadow-first, however. `authorizeCommercialUse()` returns the legacy decision as `effectiveDecision`; CRO-03 must require the stricter `shadowDecision.allowed` result for its `provider_pre_spend` boundary without converting all other CRO-02 consumers to live enforcement.

---

## 3. Verified root cause

The repository is not missing provider controls. It has durable provider operations, attempts, observations, validation intents, ZeroBounce generation checks, a Serper circuit/budget owner, provider metadata, and a commercial-resolution graph.

The defect is fragmentation:

- `enrichment_jobs` is an aggregate mutable job row, and `enrichment_runs` retains mutable JSON rather than immutable per-subject claims and terminal receipts (`shared/schema.ts:1375-1397`, `3486-3505`).
- `runEnrichmentJob()` and `enrichContactBatch()` execute process-local loops (`server/services/enrichment.ts:239-297`, `303-489`).
- Authenticated routes launch work with detached `.catch()` calls (`server/routes/prospects.ts:733-770`, `server/routes/contacts.ts:1160-1193`).
- Generic enrichment fetches an arbitrary derived domain directly and projects provider/AI output to CRM fields (`server/services/enrichment.ts:27-50`, `155-217`, `303-489`).
- Sunbiz enrichment performs multiple direct web fetches and direct storage writebacks rather than passing all evidence through a universal candidate/arbitration contract (`server/services/sunbiz-enrichment.ts:213`, `244`, `295`, `355`, and writeback paths).
- The same enrichment queue can be invoked by both the SLA worker and queue manager (`server/services/sla-worker.ts:1329`, `server/services/queue-manager.ts:2111-2124`).
- Contact enrichment currently recalculates readiness, clears `outreach_queue_skipped_at`, routes offers, and can initiate additional post-enrichment work (`server/services/enrichment.ts:400-416`, `server/routes/contacts.ts:1274-1297`).

CRO-03 should converge these paths on one durable command/evidence model while retaining the current specialized provider and canonical-field owners.

---

## 4. Verified-from-code table

| ID | Task claim | Audit verdict | Evidence and required disposition |
|---|---|---|---|
| VFC-01 | BT-10 already owns provider health/readiness records | **TRUE** | `provider_controls`, `provider_operations`, `provider_attempts`, `provider_observations`, and `validation_intents` exist at `shared/schema.ts:359-482`. Extend them; do not add a competing generic provider ledger. |
| VFC-02 | Generic execution is not durable per subject | **TRUE** | Existing job/run tables lack an immutable item population, lease/fence ownership, and exact terminal equations. |
| VFC-03 | Current routes detach enrichment from requests | **TRUE** | Prospect routes call `runEnrichmentJob(...).catch()` and `processEnrichmentQueue().catch()`; contact batch returns before its process-local loop completes. |
| VFC-04 | Provider and AI results bypass universal arbitration | **TRUE** | `enrichment.ts` constructs updates from Serper/AI results and sends them to the contact writer; prospect and Sunbiz paths also write directly. |
| VFC-05 | Serper already has a circuit and budget owner | **TRUE** | `server/services/serper-gateway.ts` owns the `serper_control` row and its reservation/consumption transitions. Shared linkage must not double-charge it. |
| VFC-06 | ZeroBounce already binds evidence to token/generation | **TRUE** | `provider-readiness-control.ts` uses email token hash, mutation generation, intents, claims, and normalized terminal results. |
| VFC-07 | CRO-02 is shadow-only | **TRUE** | `commercial-resolution.ts:190-209` returns `effectiveDecision: legacyDecision`; strict pre-spend use must inspect the shadow decision. |
| VFC-08 | CRO-02 can provide a dependency fingerprint | **TRUE** | `commercial-resolution.ts:300-315`, `584` supports `expectedFingerprint`, transaction composition, and lock policy. |
| VFC-09 | Outscraper remains disabled | **TRUE** | The adapter currently presents an unapproved caller and false paid approval. CRO-03 must not activate it. |
| VFC-10 | Current route policy is adequate | **FALSE/PARTIAL** | Prospect enrichment routes are merely authenticated; contact detail enrichment lacks an explicit object-access check before loading the contact. A complete route matrix is required. |
| VFC-11 | A snapshot hash is sufficient | **FALSE** | A hash/high-water mark does not prove which subjects were included or allow deterministic replay. Exact membership must be materialized. |
| VFC-12 | “Reservation = consumed + refunded/released/ambiguous” is exact | **FALSE** | It omits outstanding reservations and mixes a cumulative equation with a current balance. |
| VFC-13 | Candidate hash/encrypted representation is sufficient | **PARTIAL** | Hash-only candidates cannot later project email/phone. The task must choose a domain-specific authenticated encryption envelope or prohibit persistence of reversible candidate values. |
| VFC-14 | Current canonical writer composition is atomic | **FALSE** | `updateContactLocalFirst()` opens its own transaction and performs post-commit readiness work. A separately inserted mutation event can be lost after writer commit or duplicated on replay. |
| VFC-15 | Network denial is fully covered by adapter fakes | **FALSE** | Generic/Sunbiz code uses raw `fetch`; tests need process-level outbound denial and the implementation needs safe public-web egress controls. |
| VFC-16 | CRO-03 can independently pass all existing static suites | **FALSE at baseline** | `scripts/test-cro01-revenue-contract-static.ts:80` incorrectly forbids migration 0166, which CRO-02 legitimately added. |

---

## 5. P0 correction register

### P0-01 — Freeze the legacy entry-point and cutover contract

**Problem:** The task says to “adapt” generic, Serper, Sunbiz, AI, and future paid-provider paths, but it does not decide what every existing route, worker, scheduler, webhook, import, and UI action does during the transition. That permits old direct paths to remain active beside the new factory and could leave Apollo/Outscraper as non-executable placeholders.

**Required correction:** Before editing, publish a caller matrix covering prospect jobs, prospect process-queue, contact batch/single enrichment, Lead Ops, SDR/Serper, Sunbiz batch/re-enrich/mass/deep/pipeline actions, the SLA worker, queue manager, SDR re-enrichment scheduler, Apollo request/webhook/poll actions, Outscraper request/poll/webhook/import actions, and each client control. Assign each entry exactly one disposition:

1. enqueue/reuse a durable batch/item command and return `202` with canonical batch/item IDs and a status URL;
2. perform local evidence-only/dry-run work through the durable command; or
3. fail closed with a stable privacy-safe `503` reason until a later approved cutover.

No route or scheduler may retain request-detached execution, a second interval owner, synchronous provider transport, or an untracked fallback. The durable worker/provider dispatcher must ship disabled for production execution; no system-setting boolean may bypass a separately approved activation/cutover.

### P0-02 — Materialize exact immutable batch membership

**Problem:** A normalized selection hash and high-water mark do not prove exact membership or guarantee replay.

**Required correction:** Persist one immutable membership row for every selected subject, with batch ID, ordinal, canonical subject type/ID, normalized root/contact/business IDs where applicable, selection-policy version, dependency fingerprint, and safe inclusion/exclusion reason. Enforce a unique key that prevents duplicate membership and permits deterministic replay.

Only canonical contact/business graph roots that can satisfy the strict CRO-02 pre-spend contract may reach executable network-provider stages. Prospect/Sunbiz/SDR staging rows may create local evidence or blocked/dry-run items, but CRO-03 must not fabricate contacts, businesses, prospect history, identity merges, or reviewed organization links to make them eligible.

### P0-03 — Close the CRO-02 TOCTOU boundary

**Problem:** The task requires the strict shadow result before reservation, but does not require freshness immediately before transport or mutation.

**Required correction:** Persist the CRO-02 shadow decision ID/version, reason codes, and dependency fingerprint on the item/operation. Use the existing expected-fingerprint and transaction/advisory-lock contract when reserving an operation. Do not hold a database transaction across network transport. After acquiring the provider claim, re-resolve and compare the expected fingerprint immediately before transport. Re-resolve again immediately before candidate projection/canonical mutation. On mismatch, release or reconcile the reservation and terminalize as stale/superseded without transport or mutation. Preserve CRO-02 table/column allowlists, advisory-lock ordering, graph transaction boundaries, and legacy-effective behavior outside this specific strict pre-spend composition.

### P0-04 — Preserve one budget authority per provider and build all four first-class adapters

**Problem:** A generic factory reservation can double-count budgets already owned by specialized controls.

**Required correction:** Freeze the budget ownership map:

| Provider/path | Budget/transport authority | CRO-03 behavior |
|---|---|---|
| Serper | `SerperGateway` / `serper_control` | Link factory item/operation/receipt to the gateway result; never independently decrement a second budget. |
| ZeroBounce | BT-10 provider controls and validation worker | Create/link the durable validation intent after the winning email mutation; do not pre-reserve a duplicate validation charge. |
| OpenAI | Existing AI audit/cost authority | Record candidate/evidence linkage around the existing audit result; no competing AI budget counter. |
| Outscraper | Existing denied adapter plus a new explicit Outscraper factory budget owner | Complete the approved adapter, asynchronous submit/poll/result-recovery path, safe receipt/usage accounting, and import-to-observation path. Keep execution disabled until a separate approved canary. |
| Apollo | New provider registration, Apollo adapter, and explicit Apollo factory budget owner | Complete organization/person enrichment, synchronous-result handling, and durable asynchronous webhook/poll recovery where requested data uses it. Keep execution disabled until a separate approved canary. |
| Proxycurl/other inactive paid adapters | Existing activation authority plus future approved factory reservation | Definitions/dry-run estimates only unless separately brought into scope; no transport activation. |
| Free/public sources | Approved adapter and safe-egress policy | Record zero-cost/unknown-cost receipt semantics without pretending a billable reservation occurred. |

Apollo and Outscraper credentials must be referenced only by environment-secret name. Credential presence means `configured`, not `enabled`, `approved`, `budgeted`, or `runtime_verified`. The provider registry must distinguish those states.

The Apollo adapter must normalize both immediate and deferred results. Current Apollo bulk people enrichment can return immediate match data, while phone or waterfall enrichment can require an HTTPS webhook and later polling; its `request_id` must be stored losslessly and webhook delivery must be idempotent. The Outscraper adapter should prefer its asynchronous request-ID workflow, persist the external request ID before polling, and retrieve results before the provider’s retention window expires. These provider-specific mechanics remain behind the common durable item/operation/evidence interface; the factory must not force every provider into one false transport shape.

Use separate immutable vocabularies for item state, provider outcome, and billing disposition, with an explicit mapping from current adapter values such as `no_match`, `invalid_input`, `budget_exhausted`, `provider_error`, `parse_error`, and `excluded`.

The exact cumulative equation must include outstanding reservations:

`cumulative_reserved = consumed + released + refunded + ambiguous + outstanding`

The current reserved balance must equal outstanding reservations, or an explicitly equivalent invariant. Ambiguous billing blocks automatic retry until reconciliation.

### P0-05 — Make candidate privacy and mutation lineage executable and atomic

**Problem:** A value hash cannot later project an email/phone, and the current contact writer cannot be followed by a separately committed mutation event without a crash gap.

**Required correction:** Choose and document one of these designs:

- persist no reversible sensitive candidate values and reacquire them only through an authorized in-memory provider result during a claimed projection command; or
- introduce a CRO-03-specific authenticated encryption envelope with a dedicated key/version, authenticated context bound to candidate ID/subject/field/generation, plus separate hash and mask. Do not reuse credential-specific or merchant-application encryption contracts.

Decryption must occur only inside the projection authority. Logs, observations, receipts, reconciliation, and APIs remain hash/mask/reason-code only.

Projection must be atomic or durably command-driven. Either extend the canonical writer to accept an approved transaction/mutation-command context, or persist an idempotent mutation command before invoking the writer and reconcile its result by expected generation/hash. A crash after canonical mutation but before event recording must be recoverable without a second mutation or second downstream side effect. Preserve contact-field authority, identity/relationship/link owners, and `updateOrganizationDescriptive()` for business description fields.

For email, terminalize the CRO-03 item after the winning mutation and durable validation-intent link. Do not wait indefinitely for ZeroBounce. Record `validation_pending`, `validation_deferred`, or equivalent durable disposition; CRO-04 later decides whether current positive evidence exists.

### P0-06 — Contain all provider and raw-web transports

**Problem:** The paid-provider scanner does not cover generic `fetch`, free directory/social calls, or unsafe public-web retrieval. `enrichment.ts` and Sunbiz code contain raw fetch paths and direct OpenAI/provider use.

**Required correction:** Inventory every network call reachable from changed enrichment entry points, including generic domain fetch, Sunbiz websites/search/social/directories, Serper, ZeroBounce, Outscraper, Apollo, OpenAI, RDAP, JSON-LD, contact pages, and post-enrichment workers. Each call must be routed through an approved injectable adapter or denied.

Any allowed first-party/public-web fetch must enforce HTTPS, a normalized approved public hostname, DNS resolution with private/link-local/loopback/metadata ranges denied, redirect-hop revalidation, timeout, maximum response bytes, content-type checks, safe parsing, redacted errors, and an injectable fake transport. Sources marked excluded by the provider manifest—including unapproved social-only scraping—must not remain an implicit execution path.

Tests require both fake adapters and process-level outbound denial; they must fail on any unregistered socket/fetch attempt. Provider, GHL, SMTP/SMS/voice, campaign, deployment, and production database transports must be unreachable.

### P0-07 — Freeze authorization, object scope, DTOs, and scheduler ownership

**Problem:** The task’s “manager team-scoped” language invents a generic tenant/team rule and does not repair auth-only routes. The current application is a single-tenant employee CRM with existing role/object helpers; Prospect Staging lacks a safe agent-owner model.

**Required correction:** Use the current role and object-access authorities. Do not introduce workspace/tenant semantics. Publish a route matrix for create, cancel, retry, status, list, aggregate, receipt/evidence, candidate review, and dry-run endpoints. At minimum:

- production-capable batch creation, cancellation, retry, and policy changes are admin/manager only and remain disabled without separate operational approval;
- Prospect Staging enrichment controls are manager/admin only unless a current explicit object policy proves narrower access;
- contact/business detail operations must check object access before revealing existence or enqueuing work;
- agents may view only existing object-scoped status that current policy permits;
- aggregate endpoints apply scope in SQL before counts and return one `asOf` plus documented filters;
- provider enablement, budget changes, spend approval, and production execution are never implied by application role.

Replace `insertEnrichmentJobSchema` passthrough with strict server-owned command DTOs. Clients must not set status, counts, claims, attempts, results, errors, timestamps, actors, fingerprints, budget fields, or terminal dispositions.

Elect one logical scheduler/queue owner and one repeatable job identity. The SLA worker, queue manager, and SDR re-enrichment interval cannot independently own the same execution stream.

### P0-08 — Enforce the CRO task boundary and fix the baseline merge gate

**Problem:** Current enrichment performs readiness, offer-routing, queue-skip clearing, business-ingestion, and post-enrichment effects. Separately, one required static suite is already red because it still forbids migration 0166.

**Required correction:** CRO-03 must not directly declare channel readiness, campaign/cohort eligibility, alter enrollment, clear outreach suppression/skipped state, route offers, advance deal stages, trigger campaigns, or send GHL/outbound work. Local durable projection intent may remain if the canonical writer requires it, but external transport must stay denied and its effect must be documented. Business evidence may use the existing canonical business/link candidate authority; it must not silently create reviewed links or classifications.

Before merge, remove only the obsolete `0166`-absence assertion at `scripts/test-cro01-revenue-contract-static.ts:80`, retaining the rest of the CRO-01 contract. Migration integrity and the CRO-02 structural guard now own those checks. RVR-02/#1702 currently owns that repair; CRO-03 may build independently but must either wait for that fix to merge or receive an explicit narrow ownership exception. A red deterministic-static capability cannot be reported as an accepted baseline or waived in the final verdict.

---

## 6. P1 correction register

### P1-01 — Freeze API and state contracts

Define versioned, non-overlapping enums for batch state, item state, provider outcome, candidate/arbitration result, mutation disposition, and billing disposition. Publish mappings from every existing adapter result. A no-result is not success, failure, conflict, unavailable, or disabled. Stable HTTP responses must use privacy-safe codes/correlation IDs, return `202` for accepted durable commands, and provide polling/replay identifiers.

### P1-02 — Expand the blast radius and ownership inventory

The task’s relevant-file list is incomplete. The implementation preflight must include at least:

- `server/routes/contacts.ts`, `server/routes/prospects.ts`, `server/routes/sdr.ts`, `server/routes/lead-ops.ts`;
- related Prospect, Contact, Lead Ops, SDR, and Sunbiz client controls;
- `server/services/queue-manager.ts`, `sla-worker.ts`, `logical-job-manifest.ts`, and `sdr/re-enrichment.ts`;
- `organization-service.ts`, `post-enrichment-worker.ts`, `contact-readiness.ts`, and `offer-router.ts`;
- every generic/Sunbiz/Serper/AI/raw-web caller and canonical field writer;
- route-guard, API-coverage, provider-denial, scheduler, migration, and CI manifest tests.

Post-build scans must prove no unowned caller remains.

### P1-03 — Add truthful reconciliation, retention, and safe operational reads

Materialize exact aggregate equations for selected/blocked/claimed/running/retryable/cancelled/terminal items, provider outcomes, candidates, arbitration decisions, mutation commands/results, and cumulative/current cost. Include outstanding work, not only terminal outcomes. Every response needs one `asOf`, filters, policy/template versions, and explicit unavailable/degraded reason codes. Define retention, expiry, deletion/tombstone, receipt-reference, and key-rotation behavior for observations, candidates, arbitration evidence, and mutation lineage without exposing raw PII.

### P1-04 — Strengthen isolated tests and migration proof

Tests must use non-empty fixtures, disposable PostgreSQL, isolated Redis namespace, fake clocks where lease timing matters, injected provider adapters, and process-level network denial. Fixture setup that is empty, skipped, or pointed at a non-disposable database must fail. “Migration bootstrap twice” means apply the complete journal through the new head to a fresh disposable database, rerun the migrator idempotently, and compare schema/constraints; never use `db push`.

Cover all crash boundaries, concurrent claims, stale fences/fingerprints/generations, divergent replay, cancellation after incurred billing, no-result versus failure, ambiguous billing, authorization/object scope, safe errors, and absence of CRO-04/CRO-05/CRO-06 side effects.

### P1-05 — Make four-provider routing and canary plans non-executable and approval-complete

The dry-run/100/1,000 plans must be versioned documents or disabled definitions only. Each needs exact population policy, template/provider versions, maximum calls/spend, sampling method, success metrics, stop thresholds, review sample, owners, legal/purpose approval, rollback/disable owner, and evidence packet. Plans must separate Apollo, Outscraper, Serper, and ZeroBounce usage/cost/yield and also measure the combined routing policy. No UI button, worker schedule, environment toggle, or admin role may execute either canary in this task.

---

## 7. P2 follow-up register

### P2-01 — Provider-mix optimization

Defer predictive source selection, marginal ROI by vertical, and automatic provider-mix optimization until reviewed canaries establish measured yield, accuracy, cost, and conflict rates.

### P2-02 — Providers beyond the required four and richer operator UX

Defer providers beyond ZeroBounce, Serper, Outscraper, and Apollo, automated activation, bulk remediation UX, and long-term economics dashboards to separately authorized tasks after CRO-03 isolated certification and CRO-04 qualification authority.

---

## 8. Canonical authority matrix

| Boundary | Existing owner to preserve | CRO-03 responsibility |
|---|---|---|
| Class/provenance/identity/link/duplicate gate | CRO-02 commercial graph | Persist strict shadow decision/fingerprint and revalidate around side effects |
| Provider catalog and activation metadata | `provider-manifest.ts` and activation authority | Reference approved version; no parallel registry or activation switch |
| Provider operations/attempts/observations | BT-10 tables/services | Extend/link to batch items; no competing ledger |
| Serper budget/circuit/transport | `SerperGateway` / `serper_control` | Link evidence/economics; no second charge |
| Email validation | ZeroBounce readiness/intent worker | Link only after winning email generation |
| AI usage/cost | AI audit authority | AI produces candidates/explanations only |
| Contact mutation | contact writer and contact-field authority | Project winner via transaction-aware or durable mutation command |
| Business descriptive mutation | `updateOrganizationDescriptive()` | Project allowed descriptive winner; no identity/link bypass |
| Identity and business link | identity/link/relationship authorities | Record candidates/blocked reasons; never self-approve |
| Channel/campaign readiness | CRO-04 | No READY/cohort/enrollment decision in CRO-03 |
| Offer and operator journey | later CRO tasks | No automatic routing/task/enrollment side effect |

### 8.1 Required four-provider workflow

“Use all four” means every provider is available through a governed routing policy—not that every record is sent to every provider.

| Stage | Provider role | Required behavior |
|---|---|---|
| Existing evidence | Canonical CRM and approved free sources | Normalize and resolve what is already known before spending credits. |
| Business discovery | Outscraper | Discover or enrich businesses when a versioned policy selects it; use durable async request IDs, polling/webhook recovery, usage receipts, and observations. Existing website-run exports enter through an import-to-observation command, never direct CRM overwrite. |
| Organization/person enrichment | Apollo | Enrich resolved businesses/people when policy selects it; persist immediate and deferred result states, credit receipts, idempotent webhook/poll results, and field candidates. No direct CRM overwrite. |
| Search fallback | Serper | Use the existing gateway only for justified gaps; preserve its circuit, cooldown, and budget owner while linking common operations/evidence. |
| Final email validation | ZeroBounce | Run only after arbitration and the canonical winning email mutation; bind evidence to the final token and mutation generation. |
| Qualification | CRO-04 | Independently determine email/SMS/manual-call/no-channel eligibility from current evidence and consent/suppression policy. |

The versioned routing policy must support provider allow/deny, operation type, prerequisite evidence, priority, fallback conditions, maximum calls/credits/cost, cooldown/deduplication window, field purpose, and stop reason. A provider is eligible only when it is configured, policy-approved, operationally enabled, within budget, and selected for that subject/purpose/version. `configured` alone is never executable authorization.

Current provider documentation confirms that the adapters need distinct mechanics: [Apollo bulk people enrichment](https://docs.apollo.io/reference/bulk-people-enrichment) mixes immediate results with deferred webhook/poll results for some phone/waterfall requests; [Outscraper Google Maps Search](https://docs.outscraper.com/endpoints/google-maps-search/) supports asynchronous request IDs and later retrieval; [ZeroBounce batch validation](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-batch-validate-emails) returns email-level results and errors through its validation contract; and [Serper](https://serper.dev/) remains the search API behind the repository’s existing gateway.

---

## 9. Corrected build sequence

1. Recapture SHA, worktree, migration head, 67-suite manifest, provider manifest, scheduler ownership, all callers, and the known red CRO-01 assertion.
2. Freeze the route/caller disposition matrix, authorization matrix, state vocabularies, provider budget ownership, and production-disabled activation contract.
3. Add immutable batch membership and durable item/claim/lease/fence/cancellation/replay persistence through the next legal additive migration.
4. Extend BT-10 operations/evidence with item, policy, fingerprint, safe receipt, billing, and reconciliation linkage rather than creating a second provider system.
5. Implement strict CRO-02 shadow pre-spend composition with persisted dependency fingerprint and revalidation before transport and mutation.
6. Complete governed adapters for Apollo and Outscraper, adapt Serper and ZeroBounce to the shared linkage contract, implement safe public-web egress, and deny all unregistered transports. Preserve existing Serper, ZeroBounce, and AI budget owners; establish exactly one new owner each for Apollo and Outscraper.
7. Add encrypted-or-ephemeral candidates, deterministic arbitration, and an atomic/durable canonical mutation command with generation/fingerprint checks.
8. Convert or fail closed every legacy route, UI action, scheduler, and post-enrichment path; elect one queue owner.
9. Add scoped aggregate APIs/status UI with exact equations, one `asOf`, stable safe codes, and no activation controls.
10. Add disposable static/integration/server tests, migration bootstrap/idempotency, post-build searches, full diff review, and the final expanded VFC.

---

## 10. Required tests and gates

The executor must report the exact command, exit code, duration, and result. Required coverage includes:

- focused CRO-03 contract/static suite;
- disposable migration bootstrap through the new head and idempotent rerun;
- batch membership, replay, claim/lease/fence/heartbeat/cancellation/recovery tests;
- strict pre-spend fingerprint race tests before reservation, transport, and mutation;
- budget-authority and cumulative/current reconciliation tests;
- provider-result mapping and ambiguous-billing tests;
- Apollo immediate/no-match/partial/429/5xx plus idempotent webhook/poll/deferred-credit tests;
- Outscraper async submit/poll/webhook/result-expiry/website-export-import and usage-receipt tests;
- Serper gateway linkage without double reservation or circuit bypass;
- ZeroBounce final-generation linkage without duplicate validation reservation;
- routing-policy deduplication proving a subject is not sent to all providers by default;
- candidate privacy/encryption/AAD/key-version/redaction tests;
- atomic mutation/recovery/stale-generation tests;
- ZeroBounce winning-email intent/currentness compatibility;
- route/object/role matrix and safe error contracts;
- fake-adapter plus process-level network-denial tests;
- scheduler singleton/repeatable-job ownership;
- explicit absence of readiness, offer, enrollment, campaign, GHL, and outbound effects;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- deterministic-static and deterministic-integration capabilities;
- provider-denied server startup and server-required capability;
- paid-provider, raw-fetch, canonical-writer, route-guard, API-coverage, CRO-02 authority, and migration-integrity scans;
- `npm run check`, `npm run build`, and `git diff --check`.

Skips, empty fixtures, unavailable disposable services, reachable network, or the known CRO-01 static failure are not passes.

---

## 11. Audit-time gate results

These are baseline/preflight observations, not CRO-03 implementation acceptance:

| Command | Exit | Result |
|---|---:|---|
| `git rev-parse HEAD` | 0 | `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42` |
| `git rev-parse origin/main` | 0 | Same SHA |
| `$CODEX_PRIMARY_RUNTIME_NODE scripts/ci-suite-manifest.ts --check` | 0 | PASS; 67 suites classified |
| `$CODEX_PRIMARY_RUNTIME_NODE scripts/test-cro01-revenue-contract-static.ts` | 1 | **FAIL**; obsolete assertion forbids legitimate migration 0166 |
| `$CODEX_PRIMARY_RUNTIME_NODE scripts/check-route-guards.ts` | 0 | PASS; informational stale-route inventory warnings remain |
| `$CODEX_PRIMARY_RUNTIME_NODE scripts/check-migration-integrity.ts` | 0 | PASS; 388 checks, two historical duplicate-timestamp warnings |
| `git diff --check` | 0 | PASS; clean audit worktree |

The full `tsx` capabilities, typecheck, build, and stateful suites were not rerun in this audit environment because the clean worktree has no installed dependencies and the lockfile still contains Replit-internal package firewall resolutions. That portability repair is owned by RVR-02/#1702. This is not a filesystem-permission limitation and must not be represented as one.

---

## 12. Post-build search and kill-line verification

The final executor response must provide commands and results proving:

- no changed enrichment route launches detached `.catch()` work;
- no legacy process-local enrichment loop or duplicate scheduler remains reachable;
- every executable batch has materialized immutable membership;
- strict CRO-02 shadow decision/fingerprint is persisted and rechecked before transport and mutation;
- no provider has two budget authorities or two reservation decrements;
- no ambiguous-billing item automatically retries;
- no provider/AI/raw-web result writes canonical fields without observation, candidate, arbitration, and recoverable mutation lineage;
- no raw candidate value, provider query, raw payload/body, authorization header, secret, or PII appears in logs/APIs/evidence;
- no unsafe raw fetch or unregistered network call remains reachable from changed scope;
- all contact/business mutations use current canonical owners and stale generations fail closed;
- ZeroBounce evidence binds only to the final winning email token/generation;
- no READY state, campaign/cohort eligibility, offer routing, outreach skip clearing, enrollment, GHL transport, or outbound send is introduced or triggered;
- Apollo and Outscraper adapters/registrations are complete but their live execution remains disabled; Serper and ZeroBounce retain their current authorities; Proxycurl and other out-of-scope paid providers remain disabled;
- no `db push`, historical migration edit, production backfill, provider execution, deployment, or budget mutation occurred;
- the full final diff contains only task-owned code, migration, tests, and documents, with no uploads, media, secrets, lockfile drift, generated assets, or broad formatting.

Kill the build if any of those proofs fails.

---

## 13. Controlling addendum to send to Replit

Append the following beneath Task #1709. It supersedes conflicting or ambiguous portions of the existing plan while preserving all valid requirements.

> ### TASK #1709 CONTROLLING AUDIT ADDENDUM — 2026-08-28
>
> Implement Task #1709 only with the following corrections. Treat them as acceptance requirements and kill lines.
>
> 1. **Legacy entry points and activation:** Before editing, inventory every prospect, contact, Lead Ops, SDR/Serper, Sunbiz, queue-manager, SLA-worker, SDR re-enrichment, post-enrichment, Apollo request/webhook/poll, Outscraper request/poll/webhook/import, and UI caller. Give each exactly one disposition: durable `202` command with canonical IDs/status URL, local evidence-only/dry-run command, or stable fail-closed `503`. No detached `.catch()` execution, synchronous/direct transport, duplicate interval owner, or untracked fallback may remain. Ship the production dispatcher/providers disabled while still completing the four-provider code paths. No role or system-setting boolean activates spend.
> 2. **Exact snapshot:** Persist immutable membership rows, not only a selection hash/high-water mark. Store batch/ordinal/canonical subject/root IDs/policy version/dependency fingerprint/safe reason, with uniqueness and deterministic replay. Only canonical contact/business graph roots that pass strict CRO-02 may reach executable network stages. Staging subjects may be local evidence/dry-run/blocked only; do not fabricate records, merges, classifications, or reviewed links.
> 3. **Strict CRO-02 TOCTOU fence:** Persist the `provider_pre_spend` shadow decision/version/reasons/dependency fingerprint. Compose reservation with the existing expected-fingerprint/transaction/advisory-lock contract. Preserve CRO-02 allowlists, lock order, transactions, shadow-only operation, and legacy-effective behavior elsewhere. Do not hold a DB transaction over transport. Re-resolve expected fingerprint immediately before transport and before canonical mutation; mismatch releases/reconciles cost and terminalizes stale/superseded without the side effect.
> 4. **Four first-class providers and one budget owner each:** The completed factory must support ZeroBounce, Serper, Outscraper, and Apollo through governed adapters and a versioned routing policy. “Disabled during build” means no live transport/spend or canary execution; it does not permit Apollo or Outscraper to remain placeholders. Serper budget/circuit remains `SerperGateway`/`serper_control`; ZeroBounce remains BT-10 readiness/validation; OpenAI remains AI audit. Add exactly one explicit factory budget owner each for Apollo and Outscraper. Apollo must support immediate results plus idempotent webhook/poll recovery for deferred phone/waterfall results and store external IDs losslessly. Outscraper must support durable async submit/poll/result recovery and website-export import through observations. Credentials are referenced only by secret name, and `configured` is distinct from `enabled`, `approved`, `budgeted`, and `runtime_verified`. CRO-03 links operations/evidence/receipts without double charging. Freeze separate item, provider-outcome, and billing enums and map every legacy adapter status. Enforce `cumulative_reserved = consumed + released + refunded + ambiguous + outstanding`, with current reserved balance equal to outstanding or an explicitly equivalent invariant. Ambiguous billing never auto-retries.
> 5. **Candidate privacy and atomic mutation:** A hash alone cannot support email/phone projection. Either persist no reversible value or add a CRO-03-specific authenticated encryption envelope with dedicated key/version, candidate/subject/field/generation AAD, plus hash/mask. Decrypt only inside the projection authority. Make canonical mutation plus lineage crash-recoverable through a transaction-aware writer or durable idempotent mutation command with expected generation/hash; a crash after mutation cannot cause a duplicate mutation/effect. Preserve contact/business/identity/link/relationship authorities. Terminalize email items after winning mutation plus durable ZeroBounce intent link; validation completion is a later/currentness result.
> 6. **Transport containment:** Inventory generic/Sunbiz/Serper/ZeroBounce/Outscraper/Apollo/AI/RDAP/JSON-LD/contact-page/directory/social/raw-web calls. Route each through an approved injectable adapter or deny it. Any permitted public-web fetch requires HTTPS, approved public hostname, DNS/private/link-local/loopback/metadata blocking, redirect revalidation, timeout, byte cap, content-type checks, safe parsing, and redacted errors. Excluded social/unapproved sources stay excluded. Tests use fake adapters plus process-level network denial and fail on any unregistered outbound socket/fetch.
> 7. **Authorization and DTOs:** Use the current single-tenant role/object authorities; do not invent workspace/tenant/team semantics. Publish create/cancel/retry/list/status/aggregate/evidence/candidate/dry-run route matrices. Prospect Staging controls remain manager/admin unless a current explicit object policy proves otherwise. Contact/business operations check object access before existence or enqueue. Scope SQL before counts. Application roles never imply spend/activation approval. Replace `insertEnrichmentJobSchema` passthrough with strict server-owned command DTOs.
> 8. **CRO boundary:** Do not declare readiness/cohort/campaign eligibility, clear outreach skipped/suppression state, route offers, advance deals, enroll, send, or invoke GHL/provider/outbound effects. Preserve only the canonical local projection semantics explicitly required by existing writers, with transports denied. CRO-04 and later tasks own qualification/operator/outreach effects.
> 9. **Baseline static blocker:** `scripts/test-cro01-revenue-contract-static.ts:80` currently fails because it forbids legitimate CRO-02 migration 0166. RVR-02/#1702 owns removal of only that obsolete absence assertion. CRO-03 may implement independently but must not merge until that fix is present, or until an explicit narrow ownership exception allows this branch to remove only that assertion while retaining all other CRO-01 checks. Do not waive or misreport the red deterministic-static capability.
> 10. **Complete acceptance:** Freeze stable state/API mappings, expand the full caller/writer/scheduler blast radius, define retention/key rotation/tombstones and exact aggregate equations with one `asOf`, run non-empty disposable PostgreSQL/isolated Redis/fake-clock/network-denied tests, apply the full migration journal to a fresh database and rerun idempotently, and keep provider-specific plus combined-routing dry-run/100/1,000 canary definitions non-executable with explicit approvals/ceilings/stops/owners. Prove the routing policy uses all four providers selectively and never sends every subject to every paid provider by default.
>
> Final status may be `SAFE TO MERGE` only when every P0/P1 requirement above has file-and-line evidence, all required capabilities pass with exact commands/exits/durations, provider/network denial is proven, the full diff is task-owned, and no production/provider/GHL/campaign/outreach/deployment/budget mutation occurred. Otherwise return `DO NOT MERGE` or `SAFE TO MERGE — RUNTIME VERIFICATION PENDING` with the exact unresolved evidence.

---

## 14. Final audit VFC

| ID | Requirement | Preflight status |
|---|---|---|
| F01 | CRO-01/CRO-02 prerequisite present | PASS |
| F02 | Existing BT-10/Serper/ZeroBounce owners identified | PASS |
| F03 | Exact legacy caller/cutover matrix frozen | FAIL — correction required |
| F04 | Immutable materialized batch membership required | FAIL — correction required |
| F05 | Strict shadow fingerprint revalidation closes TOCTOU | FAIL — correction required |
| F06 | One budget owner and exact outstanding equation | FAIL — correction required |
| F07 | Candidate privacy and mutation lineage are executable | FAIL — correction required |
| F08 | All raw/provider transports and SSRF are contained | FAIL — correction required |
| F09 | Role/object/DTO/scheduler ownership is explicit | FAIL — correction required |
| F10 | CRO-04/later downstream effects excluded | FAIL — correction required |
| F11 | ZeroBounce, Serper, Outscraper, and Apollo are first-class governed providers | PARTIAL — owner intent frozen; implementation required |
| F12 | API/state/reconciliation/retention contracts frozen | PARTIAL — P1 required |
| F13 | Disposable tests and migration proof are complete | NOT RUN — build acceptance gate |
| F14 | Baseline deterministic-static capability green | FAIL — obsolete 0166 assertion |
| F15 | No production/provider/GHL/outbound mutation in audit | PASS |

**Final preflight status:** **BUILD-READY WITH MATERIAL CORRECTIONS. MERGE BLOCKED PENDING ADDENDUM CLOSURE AND A GREEN REQUIRED-GATE BASELINE.**
