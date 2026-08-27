# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

First verify this task against the current codebase and repository state. If it remains materially valid and safe after corrections, continue directly into implementation in the same run. Do not stop after another plan unless a genuine blocker exists.

Do not blindly trust old claims, paths, line numbers, counts, or the known anchor SHA. Do not redesign architecture, create competing sources of truth, perform speculative refactors, clean unrelated code, expand scope silently, use `db push`, weaken tests, expose secrets/PII/message bodies, or make production-data mutations merely to satisfy a test.

Stop before a blocked portion only if a finding is false, the proposed owner is wrong, a prerequisite is missing, destructive/external authority is unavailable, safe work depends on unavailable runtime evidence, scope must genuinely be split, or a kill line is reached. Complete every independent safe portion that is not blocked.

Required sequence:

Repository baseline → VFC → targeted searches → verified root cause → source-of-truth check → blast radius → data/auth/concurrency/external-side-effect checks → preflight verdict → corrected build plan → kill lines → implementation → tests/gates → post-build searches → diff review → final VFC → merge verdict.

This is **CRO-00**, the first implementation task in the consolidated Revenue CRM and Cold-Outreach program. It owns normalized findings `CAR-024` through `CAR-029`.

## 1. REPOSITORY BASELINE

Known anchor when this task was written:

- PR #6 was squash-merged on 2026-08-27.
- `main` was `0e947faac9f7cd6aafbd634366e38e2dcd912f25`.
- PR #6’s reviewed source head was `a16fdc2a46e9402faf30dc95fc907a33051c651d`.

Recapture before making claims:

- fetch `origin/main` and record its exact full SHA;
- current branch and HEAD SHA;
- `git status --short` and whether unrelated changes already exist;
- origin URL and accessible repository metadata;
- PR #6 merged state and whether current main is its reviewed descendant;
- relevant GitHub workflow and branch-protection visibility;
- current migration SQL and Drizzle journal heads;
- exact currently registered static/integration/server-required suite commands.

Start from current clean `origin/main` on a dedicated task branch. Preserve unrelated/untracked uploads. Never print credentials, recipient data, provider payloads, message bodies, or database rows.

Production deployment identity is evidence only and may be stale. Do not deploy, publish, restart workers, clear holds, unpause, activate a campaign, enroll a production contact, or send email/SMS as part of this task.

## 2. VERIFIED FROM CODE — PREFLIGHT

Produce a concise table before implementation:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Both CRM-contact campaign SMTP paths omit canonical `contactId` | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | Campaign and SMTP layers can inject duplicate compliance footers | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-03 | Campaign mutation APIs are broader than the intended admin/manager authority | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-04 | Reply-authority lookup failure can continue sequence processing | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-05 | No-response sequence exhaustion can create `ENGAGED` or equivalent false engagement | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-06 | Startup seed paths can create active promotional sequences, including SMS content | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-07 | Existing pause, contactability, classification, sender-policy and durable-enrollment owners can be extended | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-08 | Task can be completed without production/provider mutations | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | repository/test evidence |

For every false or outdated claim, record whether the finding is already fixed, moved to another owner, or requires a corrected implementation. Inspect surrounding call chains and tests; a grep match alone is not proof.

## 3. REQUIRED SEARCH / GREP CHECKS

Use `rg`, Git inventory, route registration inspection, schema inspection, and current suite manifests to inspect at minimum:

### Campaign SMTP identity and rendering

- every `sendSmtpEmail`, SMTP transport, campaign email, sequence email, commercial classification and message-category caller;
- `contactId`, contact/business identity and campaign-member identity propagation;
- `getComplianceFooterHtml`, `injectCanSpamFooter`, footer markers, postal address, unsubscribe URL, List-Unsubscribe and One-Click headers;
- all HTML/plain-text renderers, preview renderers and delivery renderers;
- any raw SMTP, Gmail, GHL-email or fallback path reachable from campaign/sequence execution.

### Campaign authorization

- all create, update, step mutation, delete/archive, preview, queue, process, retry, cancel, pause and analytics routes;
- `isAuthenticated`, admin/manager guards, capability checks, object ownership and client-only route hiding;
- direct API use by anonymous, agent/representative, manager and admin roles;
- CSRF protection and background/internal worker authentication where applicable.

### Reply and lifecycle truth

- reply/conversation lookup and error handling before a sequence touch;
- every catch/fallback that converts reply-state uncertainty into “no reply”;
- every write of `ENGAGED`, engagement score, lifecycle stage, lead score or equivalent;
- sequence completion/exhaustion states and downstream reporting/scoring consumers;
- canonical human reply, meeting, statement and manual engagement events.

### Promotional seeds

- every startup call that seeds, imports, repairs or activates sequences/campaigns;
- `sequences.json`, vertical seeders and any second seed catalog;
- defaults for active/published status, email/SMS steps, consent/channel metadata, claim evidence and calendar/booking links;
- repeat-start behavior and database drift handling;
- tests that assume active promotional content after boot.

### Boundaries and regressions

- pause/contactability/commercial-classification/sender-policy/send-log/enrollment boundaries;
- every retry/recovery path that can invoke provider transport;
- tests for campaign engine, SMTP, sequence compliance, contactability, sender policy, route guards, reply suppression and seeding;
- allowlists/exemptions that could bypass task-owned gates.

Do not invoke real providers, print contacts, or inspect production message bodies. Use source, redacted metadata, synthetic fixtures and fake transports only.

## 4. VERIFIED ROOT CAUSE

State the current root cause for each finding:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| Campaign preview/queue success implies SMTP delivery can classify the recipient | ... | ... |
| Either campaign or SMTP may independently add compliance material | ... | ... |
| Client navigation restriction is sufficient campaign authorization | ... | ... |
| Reply lookup failure is equivalent to no reply | ... | ... |
| Sequence exhaustion is engagement | ... | ... |
| Seed content is inert template data | ... | ... |

Confirm whether prior audits remain current. If a defect was fixed after the audit, do not reimplement it; prove the existing fix and tests, then complete the remaining findings.

## 5. SOURCE-OF-TRUTH CHECK

Locate and name the current owners for:

- canonical campaign execution and frozen campaign-member identity;
- SMTP transport and compliance/footer/header injection;
- commercial record classification;
- campaign route authorization and object ownership;
- consent, suppression and contactability;
- global/channel pause and final epoch authorization;
- sequence eligibility/enrollment and worker dispatch;
- canonical reply/conversation evidence;
- contact/deal lifecycle and engagement transitions;
- promotional content registry/seeding/publish state;
- sender policy, send reservation and provider outcome reconciliation.

Extend current owners. Do not create a second renderer, footer authority, reply authority, campaign role system, engagement state machine, sequence authority or outbound gateway.

## 6. BLAST RADIUS

### In scope

- both CRM-contact campaign SMTP call paths;
- canonical contact identity propagation to the existing SMTP/classification boundary;
- one idempotent HTML/text compliance-footer and header owner;
- campaign mutation authorization and object-scoped access;
- reply-state uncertainty behavior before sequence dispatch;
- no-response completion semantics and directly affected scoring/reporting regressions;
- startup promotional seed activation and seed metadata/status defaults;
- focused static, isolated integration, role and regression tests;
- task-owned documentation/evidence.

### Out of scope

- building the canonical lead/contact/business/deal model (`CRO-01`);
- classifying or backfilling production contacts (`CRO-02`);
- durable enrichment factory or provider spending (`CRO-03`);
- full cohort/Ready qualification service (`CRO-04`), except preserving current fail-closed gates;
- full CRM/GHL operator journey (`CRO-05`);
- premium content registry, exact-copy approval, distributed caps and feedback system (`CRO-06`), except removing unsafe automatic activation and duplicate rendering;
- production deployment, provider account verification or any real send;
- deleting or rewriting production campaigns/sequences.

Before editing, list exact files expected to change and files explicitly not expected to change. Keep the diff task-owned.

## 7. DATA / SCHEMA CHECK

Migration required: **NO by default**.

First determine whether current enums/status fields can represent a safe no-response terminal state and draft/paused promotional content. Prefer existing states and services when semantics are already valid.

If a schema change is indispensable:

- explain why code-only correction cannot satisfy the finding;
- use the next valid additive migration and journal entry;
- never edit historical migrations or use `db push`;
- apply the migration twice in disposable PostgreSQL;
- provide rollback/compatibility and reader/writer inventory;
- do not backfill or mutate production data.

Existing production seed records may need a later separately authorized classification/remediation run. This task changes code/defaults and isolated fixtures only.

## 8. AUTHORIZATION CHECK

Verify and test the intended authority rather than assuming these labels:

| Action | Anonymous | Agent/Rep | Manager | Admin | Internal Worker |
|---|---:|---:|---:|---:|---:|
| Read own permitted campaign/contact data | No | Scoped if current policy permits | Scoped | Yes | Task-scoped only |
| Create/edit draft campaign | No | No unless explicitly delegated | Yes | Yes | No |
| Approve/queue/process campaign | No | No | Only if explicitly authorized | Yes | Approved revision only |
| Mutate campaign steps/delete/archive | No | No | Scoped policy | Yes | No |
| Execute transport | No | No | No | No | Only after canonical gates |
| Publish/activate seed content | No | No | No unless explicit policy | Explicit audited action only | Never automatically at boot |

Hiding UI navigation is not authorization. Background/internal routes must not become public role bypasses.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Prove:

- the same campaign member cannot produce duplicate transport calls under concurrent workers/retries;
- contact identity passed to SMTP is the frozen/canonical member identity and cannot drift to another contact;
- compliance footer and headers remain exactly once across repeated rendering and nested campaign/SMTP calls;
- reply-state lookup failure durably defers once, does not send, and retries safely;
- sequence exhaustion transition is idempotent and cannot race with a real reply into false state;
- startup/restart seeding is idempotent and cannot reactivate promotional content;
- authorization checks occur before any queue, provider, or durable “success” side effect.

Do not redesign distributed rate control or provider timeout reconciliation here; preserve existing fail-closed behavior and hand remaining gaps to CRO-06.

## 10. EXTERNAL SIDE-EFFECT CHECK

Required campaign-send order for isolated tests:

1. Resolve frozen campaign member and canonical contact identity.
2. Verify role/approved command boundary as applicable.
3. Read classification, contactability, suppression, validation, pause and sender authority.
4. Claim existing idempotency/send reservation.
5. Perform final pause/epoch check.
6. Render exactly one approved body/footer/header set.
7. Invoke a fake transport exactly once.
8. Persist deterministic outcome/audit evidence.

Required reply behavior:

1. Query canonical reply authority.
2. On positive reply, stop/defer incompatible future touches.
3. On confirmed no reply, continue under normal gates.
4. On error/unavailable/ambiguous state, durably defer with zero provider I/O.

No real SMTP, GHL, SMS, provider, production queue, deployment or campaign activation is authorized.

## 11. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

If build-ready, implement immediately. If some audited defects are already fixed, classify them as verified current controls and continue the remaining task-owned work.

## 12. CORRECTED BUILD PLAN

Before editing, state:

- verified What & Why;
- exact Done Looks Like;
- current files/functions/services that own each correction;
- whether migration is required;
- focused implementation steps and tests.

Separate:

- **BLOCKING CORRECTION** — required to merge CRO-00;
- **FOLLOW-UP HARDENING** — valid later CRO-06/CRO-08 work that must not expand this task.

Minimum Done Looks Like:

- classified production synthetic fixture reaches fake SMTP exactly once with the canonical contact ID;
- unknown/test/demo fixture is blocked before transport;
- campaign/sequence rendering contains one postal address, one opt-out URL, one text footer and one List-Unsubscribe/One-Click header set;
- campaign mutations enforce the verified server-side role/object policy;
- reply-state uncertainty sends nothing and leaves recoverable deferred state;
- no-response completion never creates engagement or reply-derived score;
- clean/repeated boot creates no active promotional email/SMS content;
- all existing pause, contactability, classification, sender and sequence regressions remain green.

## 13. KILL LINES

- KILL LINE: If either CRM campaign path can reach transport without canonical `contactId`, the task has FAILED.
- KILL LINE: If any rendered campaign/sequence can contain duplicate compliance footer/address/opt-out treatment, the task has FAILED.
- STOP if a public/agent/unauthorized role can mutate, queue or process campaigns.
- STOP if reply-state error/unavailability can be interpreted as no reply or permit provider I/O.
- STOP if sequence exhaustion can create `ENGAGED`, reply credit or equivalent false engagement.
- STOP if startup/restart can activate promotional email or SMS content without an explicit audited publish/activation command.
- STOP if blocked tests invoke any real or fake provider transport when invocation count must be zero.
- STOP if the fix weakens pause, contactability, classification, validation, sender policy, send reservation or durable enrollment.
- STOP if production data, campaigns, sequences, pause state, providers or deployment are mutated.
- STOP if a migration uses `db push`, edits historical SQL or backfills production.
- STOP if unrelated CRO-01 through CRO-09 scope is pulled into this PR.

## 14. IMPLEMENTATION RULES

Use the smallest safe diff and current project patterns. Extend existing owners. No unrelated cleanup, broad rename, dependency change, formatting sweep, production config mutation, new provider, new campaign system or alternate sequence worker.

Use fake/no-I/O transports. Do not log raw addresses, names, emails, message bodies, unsubscribe tokens or provider payloads. If the root cause changes materially, update the corrected plan and proceed only if this remains one independently reviewable task.

## 15. TEST REQUIREMENTS

Tests must cover applicable happy, negative, boundary, replay, concurrency and regression cases:

- classified production fixture passes commercial gate to fake SMTP once;
- unknown/test/demo/missing-contact fixtures block with zero transport calls;
- both CRM-contact send branches propagate the correct contact ID;
- HTML and plain-text footer/header idempotency under repeated/nested rendering;
- anonymous/agent/manager/admin authorization matrix for every campaign mutation;
- reply present, confirmed absent, DB error, timeout/unavailable and retry cases;
- no-response exhaustion versus real reply race;
- repeated startup and seeding with email/SMS promotional content remaining draft/paused;
- unsupported active-seed claims are not activated;
- pause/contactability/validation/sender/enrollment behavior remains intact.

Tests must create their own disposable fixtures and must not silently pass because the relevant table is empty.

## 16. SMOKE / INTEGRATION TEST

Extend existing owners and suites where available, including current equivalents of:

- campaign engine/queue tests;
- SMTP sender/compliance/footer tests;
- campaign authorization/role-guard tests;
- sequence compliance and reply-suppression tests;
- contactability and commercial-classification tests;
- sender-policy and provider-readiness tests;
- startup/seed idempotency tests.

Add one focused CRO-00 end-to-end isolated suite only if no current suite can prove:

`campaign member → canonical contact ID → gates → exact render → fake transport`

and

`reply uncertainty → deferred → zero provider invocation`.

Use disposable PostgreSQL/Redis and provider denial when stateful behavior is required. Never use the ordinary development or production database.

## 17. POST-BUILD GREP CHECKS

Re-run targeted searches and prove:

- no task-owned CRM campaign SMTP caller omits canonical contact ID;
- no duplicate campaign-level footer injection remains reachable;
- no campaign mutation route retains overly broad authentication;
- no reply-check catch/fallback continues as “no reply”;
- no sequence-exhaustion branch writes engagement;
- no startup path activates promotional email/SMS seeds;
- no raw provider/send path was added;
- no legacy bypass/allowlist defeats the repaired gates;
- no production-data remediation logic was added.

## 18. REQUIRED GATES

Discover and run the repository’s actual current commands. At minimum, where present/applicable:

- focused CRO-00 tests;
- deterministic-static related suites;
- disposable deterministic-integration and server-required suites for changed behavior;
- TypeScript check;
- production build;
- migration integrity if schema/migration changed or repository policy requires it;
- CI capability manifest;
- compliance scan;
- sender policy;
- GHL route pause gates;
- sequence compliance;
- contactability and commercial classification;
- campaign/API role guards;
- `git diff --check`.

Report exact command, exit code and PASS/FAIL. Any skip, timeout, missing fixture, unreachable isolated service or unavailable required capability is a non-pass. Fix task-caused failures; identify unrelated failures honestly.

## 19. DIFF REVIEW

Run `git status --short`, `git diff --stat`, and full `git diff`. Confirm:

- only CRO-00-owned files changed;
- no secret, PII, recipient data, message body, debug output or generated artifact entered the diff;
- no unrelated lockfile/formatting/config drift;
- migrations and journal agree if used;
- no production activation, provider call, pause change, deployment or data mutation occurred.

## 20. FINAL VFC TABLE

Map every Done Looks Like requirement and kill line to file/evidence and a test/gate:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Both campaign SMTP paths propagate canonical contact ID | `file:line` | focused fake-transport integration | PASS / FAIL |
| VFC-F02 | Compliance rendering is exactly once | `file:line` | HTML/text/header idempotency tests | PASS / FAIL |
| VFC-F03 | Campaign mutation role/object guards | `file:line` | role matrix | PASS / FAIL |
| VFC-F04 | Reply uncertainty defers with zero I/O | `file:line` | error/retry integration | PASS / FAIL |
| VFC-F05 | No-response completion is not engagement | `file:line` | lifecycle/scoring regression | PASS / FAIL |
| VFC-F06 | No active promotional content after boot | `file:line` | repeated-start seed test | PASS / FAIL |

Expand until every material requirement and kill line is represented.

## 21. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE
- **Repository State:** starting SHA, ending SHA/working tree, current migration head
- **Verified Root Cause**
- **Preflight Corrections**
- **Implementation:** `file:line — change`
- **Tests / Gates:** command, exit and result
- **Post-Build Search Verification**
- **Kill-Line Verification**
- **Runtime/Operations Verification:** distinguish isolated code/tests from production/provider/deployment proof
- **Remaining Risks:** realistic residual risks only, with owner/task assignment
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE
- **Branch/PR URL:** do not merge or deploy without explicit authorization

Do not call local, static, fake-provider or isolated evidence production verification.

## LIBERTY-SPECIFIC SAFETY RULES

- Database: no `db push`, production writes/backfills, ordinary-database tests or destructive cleanup.
- Outbound: keep global/email/SMS pauses closed; no real recipients, enrollments, queue processing or providers.
- Content: no active promotional seed, unsupported claim, unapproved fallback or SMS activation.
- Authority: preserve canonical contactability, classification, pause, sender, enrollment and lifecycle owners.
- Evidence: no secrets, raw PII, message bodies or provider payloads.

## PRACTICAL REVIEW STANDARD

Block implementation for realistic risk of unauthorized send, false engagement, production mutation, role bypass, duplicate compliance rendering or weakened outbound gates. Do not block isolated repairs merely because production deployment, provider/DNS evidence or later cohort qualification belongs to another task.

---

# TASK TO PREFLIGHT + BUILD

## CRO-00 — Campaign and Sequence Truth Repair

**Primary consolidated findings:** `CAR-024`, `CAR-025`, `CAR-026`, `CAR-027`, `CAR-028`, `CAR-029`

### What & Why

The cold-outreach audit reproduced two concrete campaign-send defects and confirmed four additional campaign/sequence truth defects. CRM campaign SMTP callers omitted the contact identity required by the existing commercial-classification boundary; campaign and SMTP rendering could inject duplicate compliance treatment; mutation APIs were broader than the intended UI role policy; reply-state errors could allow another touch; no-response sequence exhaustion could create false engagement; and startup seeders could create active promotional email/SMS content with unsupported claims.

These defects undermine delivery, authorization, reply safety, lifecycle truth and content governance before cohort enrichment or campaign optimization begins. Repair them through the current canonical owners without building CRO-01 through CRO-09 early.

### Done Looks Like

- Both CRM campaign SMTP paths use the correct canonical contact identity.
- Unknown/test/demo contacts remain blocked before provider transport.
- HTML/plain-text compliance treatment and unsubscribe headers appear exactly once.
- Every campaign mutation uses the verified server-side role/object policy.
- Reply-state uncertainty durably defers and invokes no transport.
- Sequence exhaustion records a truthful no-response terminal result and never creates engagement.
- Promotional seed content is draft/paused and cannot auto-activate at startup.
- Existing pause, contactability, validation, sender, send-log and enrollment controls remain fail closed.

### Relevant Files and Areas to Verify

- `server/services/campaign-engine.ts`
- `server/services/smtp-email.ts`
- `server/routes/campaigns.ts`
- `server/services/sequence-worker.ts`
- `server/services/contactability.ts`
- commercial classification, sender policy, send log and enrollment owners
- server startup/seed registration
- `server/data/seeds/sequences.json`
- vertical campaign/sequence seeders
- campaign, SMTP, sender, sequence, route-guard and startup test suites

Do not assume paths or owners remain unchanged; locate current implementations first.

### Existing Kill Line

KILL LINE: If a CRM campaign can reach provider transport without canonical contact identity, duplicate compliance rendering, correct role authority, certain reply state and non-promotional boot state, the task has FAILED.

## FINAL DIRECTIVE

Do not implement this task exactly as written merely because it was provided. Verify it first against current main. Then perform the complete sequence in this prompt. If task-owned repairs are build-ready, implement and test them now. Do not create another planning loop without a real blocker, and do not cross the production/provider/deployment boundaries.

