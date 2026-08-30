# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD — EXTERNAL DELIVERY MUST REMAIN DEFAULT-OFF

Task: **CRO-07 — Controlled Delivery, Reply, Growth & Conversion Feedback**

Verify this task against the actual repository before implementation. If materially valid after corrections, continue directly into the build. Do not stop at a revised plan unless a prerequisite or external authority genuinely blocks the affected portion.

Finding one P0 or enough defects to fail preflight is not permission to stop auditing. Close the full delivery, event-ingress, reply, suppression, attribution, analytics, growth, and legacy-execution surface end to end. Build every independent safe portion and isolate only the exact blocked external activation.

This task builds the technical capability after CR-06 `READY_HELD`; it does **not** authorize a prospect send. The latest verified drafting reference is `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22`, migration head `0194`. CRO-03B is merged; CRO-03C Task #1731 remains the separate provider-activation phase. Capture current truth at execution time. CRO-07 requires the final CRO-05A request/reply/task handoff contract but must not absorb CRO-03C or CRO-08A enrichment operations.

Required sequence:

Repository baseline → dependency gate → VFC → complete dispatch/webhook/event/taxonomy census → source-of-truth and transport decision → side-effect threat model → preflight verdict → corrected build plan → implementation under denied transport → disposable certification → exact post-build census → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture:

- branch, HEAD, origin/main, and clean/dirty state;
- migration head and journal integrity;
- current CR-04, CR-05, CR-06, and CRO-05A SHAs/contracts;
- exact CR-06 rollout/package/lifecycle state and final-dispatch rejection;
- current outbound/global/channel pause state and epoch, read-only;
- configured sender/transport/webhook key names and readiness booleans only;
- current CI/pre-deploy manifest owners and suite count;
- existing communication, feedback, analytics, attribution, experiment, SEO, and content-scheduler owners.

Never print credentials, recipient addresses, message bodies, webhook payloads, or unsubscribe secrets.

## 2. DEPENDENCY AND NON-DUPLICATION GATE

Verify the following before design:

| Domain | Existing authority | CRO-07 treatment |
|---|---|---|
| Frozen eligible cohort | CR-04 | Read exact frozen decision; never expand/recompute. |
| Approved package, held intents, reservations, attribution foundation | CR-06 | Release/reconcile through a new authority; never mutate approved history. |
| Consent, suppression, contactability | CRO-02 / CR-04 | Apply events through canonical authorities; never maintain weaker copies. |
| Tasks/tickets/reply SLA | CR-05/CRO-05A | Create reply work and escalations through these authorities. |
| Canonical contact/business/deal/MID | Existing writers/services | Reference exact generations; no parallel customer graph. |
| Deal/application/MID lifecycle | Stage/application/MID authorities | Observe canonical milestones for attribution; do not transition them here. |
| Campaign content | CR-06 immutable versions | Recommend a new version; never edit approved content. |

CRO-07 must not recreate CR-06 approval, rendering, cohort binding, preparation, manual-task definitions, or held-intent creation.

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce:

| ID | Task claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | CR-06 final dispatch is hard-disabled | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | One canonical transport boundary exists | ... | ... | ... |
| VFC-03 | All provider attempts are durable before I/O | ... | ... | ... |
| VFC-04 | Delivery/bounce/complaint/unsubscribe/reply events are authenticated and deduped | ... | ... | ... |
| VFC-05 | Any reply stops incompatible future outreach | ... | ... | ... |
| VFC-06 | Reply ownership/SLA is durable | ... | ... | ... |
| VFC-07 | Analytics writers use one canonical taxonomy | ... | ... | ... |
| VFC-08 | UTM/GCLID/offline conversion attribution is truthful | ... | ... | ... |
| VFC-09 | Experiments have sample/confidence/approval gates | ... | ... | ... |
| VFC-10 | Legacy promotional transports cannot bypass the new release authority | ... | ... | ... |

## 4. COMPLETE DELIVERY AND TRANSPORT CENSUS

Inventory every route, worker, queue, service, scheduler, CLI/script, and UI action that can:

- claim or release a CR-06 delivery intent;
- send email/SMS/GHL messages;
- enroll or execute campaigns/sequences;
- unpause global/channel/campaign state;
- send inbox/manual replies;
- create provider attempts;
- receive delivery/bounce/complaint/unsubscribe/reply events;
- retry, recover, or reconcile an uncertain send.

At minimum inspect CR-06 services/routes, campaign engine, sequence worker, queue manager, outbound orchestrator, GHL boundary, SMTP/Gmail/SendGrid/Instantly or other adapters, inbox routes, reply-stop handlers, workflow executor, legacy enrollment jobs, admin unpause/release routes, and test-send scripts.

Produce a boundary table:

| Path | Classification | Current gate | Provider | Durable attempt before I/O? | CRO-07 disposition |
|---|---|---|---|---:|---|
| ... | promotional / transactional / human reply / test | ... | ... | ... | preserve / migrate / fence / retire |

## 5. COMPLETE EVENT, ANALYTICS, AND ATTRIBUTION CENSUS

Inventory every producer and reader of:

- send/release/accepted/delivered/deferred/failed/rejected;
- hard bounce, soft bounce, complaint, unsubscribe, spam/DND;
- reply, positive reply, objection, appointment, statement, proposal, application, approval, activation, revenue;
- page, CTA, form, statement, UTM/GCLID/fbclid/msclkid, offline-conversion events;
- campaign/sequence/content/offer/experiment attribution.

Reconcile raw strings against `shared/analytics-events.ts`. Explicitly investigate the known drift among `statement_uploaded`, `statement_upload_completed`, `statement_received`, and non-canonical application/approval/closed-won names. Find all reports/exports that hard-code `gclidCaptureActive` or proxy missing events.

## 6. VERIFIED ROOT CAUSE

State the actual causes:

- CR-06 intentionally stops at held preparation;
- existing transports and event handlers evolved around legacy campaigns/GHL and do not prove an exact held-intent release contract;
- multiple analytics names break funnel joins;
- provider callbacks, reply work, and commercial milestones lack one end-to-end attribution identity;
- optimization surfaces can overstate learning without adequate real samples.

Use an assumption/reality/correction table.

## 7. SOURCE-OF-TRUTH AND LIFECYCLE MAP

Freeze the lifecycle:

```text
CR-06 READY_HELD intent
→ approved release revision
→ atomic cap reservation
→ durable provider attempt
→ transport request/uncertain result
→ authenticated provider event(s)
→ canonical feedback/suppression/reply actions
→ commercial milestone attribution
→ governed experiment recommendation
```

CR-06 remains the immutable package/preparation owner. CRO-07 owns release authorization, final-attempt execution, provider reconciliation, event correlation, reply work, unified attribution, and governed learning.

## 8. DELIVERY-RELEASE AUTHORITY

Create a default-off release authority with immutable revisions and compare-and-set activation. An open release revision must bind:

- exact deployed/reviewed SHA and migration head;
- CR-06 gate/preparation/intent IDs and hashes;
- frozen cohort fingerprint/count;
- approved package/content/render hashes;
- sender identity/from/reply route;
- selected transport adapter and endpoint/environment identity;
- provider/sender/global/channel readiness snapshot;
- current suppression/contactability generation;
- global/channel pause epoch;
- per-batch, per-sender, per-domain, per-minute/hour/day caps;
- canary size and stop thresholds;
- approver capability, actor, reason, expiry, and revision hash.

Any drift, stale snapshot, missing approval, unresolved recipient identity, unavailable reply route, or pause/readiness failure must deny release. A release revision is not reusable across a changed dependency.

Build completion must leave the production activation pointer absent/disabled. OPS-09A and explicit owner approval own the first real release.

## 9. TRANSPORT ADAPTER CONTRACT

Do not assume GHL, SendGrid, SMTP, Gmail, or Instantly merely because code or credentials exist. Preflight must identify the explicitly approved cold-email transport. If none is approved, build the provider-neutral contract and denied adapter; do not fabricate a production provider.

The adapter contract must support:

- immutable attempt identity and provider idempotency key;
- sender/inbox selection from approved configuration;
- exact MIME/body/headers generated from frozen CR-06 bytes;
- reply-to and unsubscribe metadata;
- timeout and uncertain-outcome classification;
- provider message/campaign/account identifiers;
- request/response redaction;
- health/readiness and rate-limit observations;
- webhook signature/version contract;
- reconciliation by attempt/provider identity.

No transport may accept arbitrary caller-supplied bodies or recipients outside the held intent.

## 10. ATOMIC CLAIM, RESERVATION, ATTEMPT, AND RECONCILIATION

Within a transaction:

1. lock release revision and held intent;
2. revalidate dependency/contactability/pause state;
3. acquire exact capacity reservations;
4. create the provider attempt before I/O;
5. transition the held intent into an unclaimable in-flight state with lease/token;
6. commit before transport.

After transport, terminalize with compare-and-set. Timeouts/crashes remain `unknown` until reconciled—never blind-retry. Database uniqueness must prevent concurrent duplicate release. Reservation expiry/reconciliation must not allow cap oversubscription.

## 11. WEBHOOK AND FEEDBACK AUTHORITY

Implement replay-safe authenticated ingestion for all provider-supported events:

- accepted/delivered;
- deferred/soft bounce;
- hard bounce;
- provider rejection/failure;
- complaint;
- unsubscribe;
- reply and reply classification;
- optional click/open only when trustworthy and explicitly classified.

Each event must:

- authenticate before parsing side effects;
- deduplicate by provider/event/account identity;
- correlate to exact attempt, intent, recipient/contact generation, content version, cohort, program, sender, and release;
- preserve original event time and receipt time;
- update canonical suppression/contactability without clearing stronger state;
- stop incompatible active/future outreach;
- create reply work/SLA through CR-05/CRO-05A;
- retain immutable lineage and sanitized reason codes.

Do not count machine opens, privacy-proxy opens, or provider acceptance as qualified engagement.

## 12. REPLY OWNERSHIP AND STOP CONDITIONS

Any human reply must immediately make incompatible automated outreach unclaimable, before classification or AI drafting. Required behavior:

- durable inbound occurrence and exact correlation;
- deterministic contact/deal/owner resolution or review-required;
- CR-05 reply task with SLA and escalation;
- positive/neutral/objection/unsubscribe/complaint classification as evidence, not autonomous commercial truth;
- safe draft generation only after evidence and policy checks;
- human approval for replies unless a separately approved transactional policy exists;
- no reply backlog beyond configured capacity before new release;
- automatic batch stop on reply/SLA backlog breach.

## 13. CANONICAL EVENT TAXONOMY

Create one versioned taxonomy registry—not scattered constants alone—with:

- canonical event name and semantic definition;
- subject and required identity fields;
- occurrence/idempotency rules;
- producer authority;
- allowed source aliases;
- historical mapping rules;
- event-time and ingestion-time semantics;
- PII-safe metadata schema;
- deprecation and version policy.

Migrate writers/readers/reports/exports to canonical events. Preserve immutable historical rows; add alias mapping or normalized projections rather than rewriting history without evidence.

## 14. SOURCE-TO-REVENUE ATTRIBUTION CONTRACT

Build immutable joins for:

```text
source/UTM/click/session/request
→ contact/business/deal
→ cohort/program/content/release/attempt
→ reply/conversation/statement/proposal
→ application/approval/MID/activation
→ processor-confirmed volume and reconciled residual revenue
```

Requirements:

- explicit `unknown`/`multi_touch`/`direct` dispositions;
- no last-touch invention when identity is missing;
- no database deal label as revenue proxy;
- estimates, pipeline value, processor-confirmed activity, and reconciled revenue remain separate;
- GCLID capture status derived from real coverage/health, not a hard-coded boolean;
- offline export requires canonical eligible milestone and deduplicated export receipt;
- synthetic/test/demo/unknown commercial records never contaminate production KPIs.

## 15. GOVERNED GROWTH, PITCH, CONTENT, SEO, AND EXPERIMENT LOOP

CRO-07 may create evidence-backed recommendations for website pages, offers, pitches, sales assets, public content, SEO priorities, and new CR-06 versions. It may not silently publish, send, change pricing/claims, or edit approved content.

Every experiment must freeze:

- hypothesis and primary metric;
- eligible population and allocation hash;
- control/variant content versions;
- sample-size floor and duration;
- confidence/error rule and guardrail metrics;
- exclusion/contamination rules;
- stop conditions;
- owner approval and review result.

No winner may be declared from opens alone, tiny samples, overlapping audiences, changed allocation, missing attribution, or while stop thresholds are breached. A winning recommendation creates a new draft/approval workflow and new immutable CR-06 version.

## 16. DATA / SCHEMA / MIGRATION CHECK

Prefer extending CR-06 feedback/attribution structures where ownership is compatible. Add only the minimum authoritative tables for release revisions, attempts/reconciliation, taxonomy registry/mappings, attribution links, and experiment decisions.

Require:

- additive migrations after current head;
- SQL/schema parity;
- unique constraints for release/attempt/webhook/export/experiment identity;
- immutable terminal receipt protections;
- indexes for claim, webhook, reply, attribution, and operator queries;
- no destructive historical event rewrite;
- fresh/apply-twice/upgrade/recovery certification.

## 17. AUTHORIZATION, PRIVACY, AND SECURITY

Certify admin/manager/agent/service-principal/public denial for:

- release creation, approval, activation, cancellation;
- batch/recipient detail access;
- webhook ingress and reconciliation;
- reply ownership/action;
- experiment creation/approval/winner review;
- attribution exports.

Use 404-style IDOR where appropriate and CSRF on authenticated mutations. Verify webhook signature freshness/replay prevention. Never log raw recipient addresses, bodies, provider payloads, tokens, unsubscribe secrets, credentials, or message content. Operator views use bounded pagination and role-scoped details.

## 18. EXTERNAL SIDE-EFFECT CHECK

Build/test order:

```text
schema and pure evaluators
→ denied/fake transport
→ disposable concurrency/recovery
→ synthetic signed webhook events
→ read-only production readiness snapshot
→ merge with release disabled
```

No real recipient, provider dispatch, DNS change, mailbox warm-up, campaign activation, unpause, or external content publication is authorized. External sender-domain/DNS/inbox assets remain owner/operations inputs.

## 19. PREFLIGHT VERDICT

Use exactly one: BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH.

An unselected production transport may block the concrete adapter/live activation, but it does not block the release authority, denied transport, webhook contract, attribution, taxonomy, growth governance, or disposable certification. Complete safe independent work.

## 20. CORRECTED BUILD PLAN AND PHASES

State verified What & Why, Done Looks Like, current files, migration plan, retirement/fencing list, rollback, blocking corrections, and nonblocking hardening.

Implementation phases:

1. Full dispatch/event/taxonomy census.
2. Freeze lifecycle and approved transport decision state.
3. Add release/reconciliation/taxonomy/experiment schema.
4. Implement pure release evaluator and cap allocator.
5. Implement attempt/transport boundary under denial.
6. Implement authenticated feedback/reply handling.
7. Migrate taxonomy, attribution, reports, and offline exports.
8. Add governed experiment/recommendation workflow.
9. Fence every legacy promotional execution bypass.
10. Build operator UI and register certification gates.

## 21. KILL LINES

- KILL LINE: If any promotional path can dispatch without the exact CR-06 held intent and open CRO-07 release revision, the task has FAILED.
- KILL LINE: If production release is enabled by merge, environment key presence, or a generic unpause, the task has FAILED.
- KILL LINE: If an attempt is not durable before provider I/O or an uncertain outcome is blindly retried, the task has FAILED.
- KILL LINE: If complaint/unsubscribe/hard bounce can be cleared by weaker feedback, the task has FAILED.
- KILL LINE: If a reply does not stop incompatible future outreach and create owned work, the task has FAILED.
- KILL LINE: If reports mix estimates/deal labels with processor-confirmed or reconciled revenue, the task has FAILED.
- KILL LINE: If approved CR-06 content/history is mutated, the task has FAILED.
- KILL LINE: If any real external message is sent during build/certification, the task has FAILED.

## 22. IMPLEMENTATION RULES

Use current authorities and minimal coherent changes. No `db push`, broad campaign rewrite, automatic content publication, silent analytics-history rewrite, dependency churn, or live-data cleanup. Keep transactional/human-response channels separately classified; do not indiscriminately disable legitimate replies. Stable hashes, reason codes, provider attempt accounting, and immutable evidence are mandatory.

## 23. TEST REQUIREMENTS

Cover:

- stale/changed/expired CR-06 dependencies;
- pause epoch change before/after claim;
- cap contention and oversubscription races;
- concurrent/double release;
- crash before I/O, timeout after I/O, and reconciliation;
- adapter rejection and provider duplicate;
- signed/unsigned/replayed/malformed webhooks;
- every feedback type and stronger-suppression dominance;
- reply-stop, owner ambiguity, SLA escalation, and backlog stop;
- event alias mapping and historical rows;
- GCLID/offline-export dedupe;
- sample/confidence/guardrail experiment rules;
- admin/manager/agent/public/service-principal authorization;
- log/audit redaction.

## 24. DISPOSABLE CERTIFICATION

Run on fresh disposable PostgreSQL and isolated Redis with network denied. Use deterministic fake transports that model accepted, rejected, timeout/unknown, reconciliation-success, reconciliation-failure, and duplicate-provider behavior. Use synthetic signed webhooks.

Prove:

- migration zero/apply-twice/upgrade;
- exact one-attempt behavior under concurrency;
- cap reservations never oversubscribe;
- reply/complaint/unsubscribe immediately fence future release;
- attribution links source through synthetic reconciled revenue without proxies;
- experiments cannot auto-publish or mutate CR-06;
- final production release pointer remains disabled;
- provider-attempt fixture counts reconcile exactly;
- actual external network/message count is zero.

## 25. POST-BUILD SEARCHES, GATES, AND DIFF REVIEW

Re-run complete transport and event censuses. Prove all promotional execution paths are registered/fenced, old event-name readers are migrated/mapped, no hard-coded GCLID status remains, and no direct CR-06 mutation/release exists.

Run targeted suites, migration integrity, sender policy, pause/fence, consent/contactability, webhook signature, CSRF/authorization, API coverage, typecheck/build, suite-manifest/pre-deploy registration, and `git diff --check`. Fix task-owned failures; classify unchanged baseline failures separately.

Review the full diff for secrets, PII, payload logging, generated junk, lockfile drift, unrelated formatting, or production activation.

## 26. FINAL VFC AND RESPONSE

Map every Done Looks Like requirement and kill line:

| ID | Requirement | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` / receipt | command | PASS / FAIL |

Return:

- verdict and merge status;
- starting/ending SHA and migration head;
- complete path/event census;
- release/attempt/webhook/attribution/experiment authority maps;
- changed-file inventory;
- migrations and disposable test totals;
- zero-network/zero-external-message evidence;
- release-disabled/pause-preserved evidence;
- authorization matrix;
- transport selection/readiness status without secrets;
- exact remaining OPS-09A/owner actions;
- code-complete versus production-connected versus sending-enabled status.

Do not call fake transport evidence production verification.

---

# TASK TO PREFLIGHT + BUILD

## CRO-07 — Controlled Delivery, Reply, Growth & Conversion Feedback

### What & Why

CR-06 correctly creates immutable approved campaign packages and held delivery intents, but final dispatch is intentionally unavailable. CRO-07 adds the separately governed, default-off release and reconciliation boundary; trustworthy feedback/reply handling; canonical source-to-revenue attribution; and an evidence-driven optimization loop that can recommend—not silently publish—new website, pitch, offer, SEO, sales-asset, or CR-06 content versions.

### Done Looks Like

- Every promotional dispatch requires an exact CR-06 intent and CRO-07 release revision.
- Release remains disabled after merge.
- Provider attempts, caps, uncertainty, and reconciliation are durable and exactly once.
- Authenticated delivery/bounce/complaint/unsubscribe/reply events preserve lineage and update canonical authorities.
- Replies stop future outreach and create owned SLA work.
- One versioned event taxonomy powers truthful funnel and offline-conversion reporting.
- Source-to-revenue attribution distinguishes estimates, pipeline, processing activity, and reconciled revenue.
- Experiments require frozen design, adequate sample/confidence, guardrails, and human approval.
- Approved CR-06 history is never mutated.
- Disposable certification produces zero external messages.

### Out of Scope

- CR-06 package/content/preparation redesign;
- creating sender domains, DNS, inboxes, provider accounts, billing, or warm-up externally;
- first real prospect release—OPS-09A plus explicit owner approval owns it;
- merchant application, boarding, MID activation, or residual ingestion implementation;
- automatic publication or autonomous pricing/claim changes.

### Relevant Files and Areas to Verify

- `server/services/cr06-premium-campaigns.ts`, `server/routes/cr06.ts`, CR-06 feedback/attribution services
- campaign engine, sequence worker, workflow executor, queue manager, outbound/pause authorities
- GHL, inbox, SMTP/Gmail/SendGrid/Instantly or other current transports
- webhook routes, reply-stop handlers, consent/contactability/suppression services
- `shared/analytics-events.ts`, analytics/acquisition routes and offline conversion export
- SEO routes/audits, content scheduler, growth/experiment/reporting surfaces
- CR-05/CRO-05A task/SLA authority
- `shared/schema.ts`, migrations, pre-deploy and CI manifests

### Existing Kill Line

KILL LINE: CRO-07 may make bounded approved delivery technically possible, but no real send may occur and no production release pointer may become active until OPS-09A and explicit owner authorization.

## FINAL DIRECTIVE

Verify, correct, and build this task in place. Do not reopen CR-06, do not use a mock success as production evidence, and do not treat provider key presence as activation. Finish with release disabled, exact zero-message proof, registered disposable certification, and a strict review with no task-owned blockers.
