# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify current code before accepting this task, correct stale assumptions, and implement immediately when materially valid and safe. Do not stop at another plan without a genuine blocker.

Do not create a competing consent system, infer consent from contact existence or email validity, conflate email and SMS permission, redesign unrelated outreach, use `db push`, auto-resolve historical conflicts to the least restrictive state, weaken tests, enable real sends, or mutate production data speculatively.

Required sequence: baseline → VFC → searches → root cause → canonical ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → build → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture current branch, HEAD SHA, working-tree status, and migration high-water mark/journal. Preserve unrelated changes. Record global/channel pause state read-only if current diagnostics make it available; do not change it.

## 2. VERIFIED FROM CODE — PREFLIGHT

Provide:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Verify the alleged `consentEmail`/`consentSms` mapping, every consent/suppression/status field and value, canonical contactability function, all writers and readers, public/operator routes, import/GHL/webhook behavior, sequence/enrollment/scheduler/transport callers, immutable audit/event tables, UI/API consumers, A2P/PEWC/quiet-hour/number-ownership checks, and related tests.

## 3. REQUIRED SEARCH / GREP CHECKS

Inspect surrounding implementations for:

- `consentEmail`, `consentSms`, `doNotContact`, `doNotAutoContact`;
- `emailStatus`, `smsStatus`, opted-out/unsubscribe/bounce/complaint/DNC/suppression fields;
- `opted_out`, `opted-out`, `unvalidated`, `active`, `valid`, `role-based`, `role_based`, `unsafe`, PEWC spellings and consent tiers;
- public forms, imports, contact updates, GHL inbound, unsubscribe/DNC handlers and operator actions;
- contactability/purpose/channel decision functions and decision versions;
- `enqueuePromotionalEnrollment`, sequence enrollment/worker, outbound/channel orchestrator and raw transports;
- consent/audit/event tables, projections and history APIs;
- A2P/10DLC, phone ownership, quiet hours, rate limits, channel feature flags;
- all tests and UI/API consumers of changed status values or response shapes.

Also search direct contact writers/updates so the new policy cannot be bypassed. Grep is inventory only.

## 4. VERIFIED ROOT CAUSE

State the original assumptions, actual mapping/vocabulary drift, current fail-open/fail-closed behavior, and where simplified callers bypass the composite policy. Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| ... | ... | ... |

## 5. SOURCE-OF-TRUTH CHECK

Identify:

- canonical immutable consent/suppression evidence owner;
- canonical current projection owner;
- canonical purpose-aware contactability decision owner;
- canonical contact mutation owner;
- canonical enrollment/sending boundary;
- canonical audit owner.

Email and SMS are channel-specific. Validation is evidence of deliverability, never consent. A verified global DNC may block all channels; a positive field must never silently clear a blocking event.

## 6. BLAST RADIUS

### In scope

- fixing verified field-mapping defects;
- one versioned vocabulary/projection for consent, DNC, suppression and channel status;
- immutable events for new mutations;
- mandatory purpose-aware decision at automated enrollment/send boundaries;
- conflict detection/reporting and manual remediation queue;
- explicit SMS readiness gate;
- migrations, compatibility handling, APIs and focused tests required for those behaviors.

### Out of scope

- automatically resolving historical conflicts to allow contact;
- sending messages or enabling SMS;
- bulk historical remediation without a separately approved data operation;
- replacing ZeroBounce/provider validation architecture;
- unrelated CRM/UI redesign.

List exact expected and untouched files. Keep the diff minimal.

## 7. DATA / SCHEMA CHECK

Verify exact tables/columns/types/nullability/defaults/checks/indexes/FKs/status values/archive behavior and every reader/writer. If immutable event/projection support is missing and migration is required:

- use the next valid migration and journal metadata;
- never `db push`;
- make it additive and backward compatible where necessary;
- do not rewrite historical consent automatically;
- preserve source, channel, purpose, effective time, actor and reason;
- provide a conflict report before any backfill.

If current schema already supports the correct model, do not add duplicates.

## 8. AUTHORIZATION CHECK

Verify actual role/middleware/field ownership:

| Action | Public | Agent | Manager | Admin | System/Webhook |
|---|---:|---:|---:|---:|---:|
| Record verified opt-in | ... | ... | ... | ... | ... |
| Record opt-out/DNC | ... | ... | ... | ... | ... |
| Clear suppression | ... | ... | ... | ... | ... |
| Resolve conflict | ... | ... | ... | ... | ... |
| Enable SMS capability | ... | ... | ... | ... | ... |

An admin override must be explicit, reasoned, audited, and unable to erase immutable evidence.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Check simultaneous opt-in/opt-out/webhook/operator mutations, event idempotency, ordering by effective time versus arrival time, projection updates, retry, partial failure, duplicate unsubscribe/complaint events, and whether any race can re-enable a blocked channel. Use atomic transactions/claims/constraints where required.

## 10. EXTERNAL SIDE-EFFECT CHECK

Document ordering across local contact/evidence writes, GHL/webhooks, enrollment queues, and transport. A rejected contactability decision must occur before enqueue/external I/O and must not cause success audit/downstream effects. Never treat external systems as transactionally atomic with PostgreSQL.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH. Continue directly on either build-ready verdict.

## 12. CORRECTED BUILD PLAN

State verified What & Why, exact behavioral/persistence/API/test outcomes, and current-file steps. Separate **BLOCKING CORRECTION** from optional **FOLLOW-UP HARDENING**. If a full historical reconciliation is unsafe now, build the correct forward path and conflict inventory without pretending the backfill is complete.

## 13. KILL LINES

- KILL LINE: If any blocked, opted-out, DNC, complained, hard-bounced, suppressed, or unresolved-conflict contact can still be automatically enrolled or sent on the blocked channel, the task has FAILED.
- STOP if email validity or contact existence is treated as consent.
- STOP if email consent is copied from SMS consent or vice versa without explicit verified evidence.
- STOP if an opted-out channel can be silently re-enabled by GHL/import/enrichment/operator simplification.
- STOP if projection updates lose or mutate immutable evidence.
- STOP if concurrent/replayed events can produce a less restrictive state incorrectly.
- STOP if status changes break unreviewed consumers or a migration rewrites unrelated history.
- STOP if SMS can activate without A2P/number ownership/PEWC/quiet-hour evidence.

## 14. IMPLEMENTATION RULES

Use the smallest safe diff, current canonical policy/writer, and existing patterns. No unrelated cleanup, broad renames, formatting sweeps, dependency changes, or production config mutation. Update the corrected plan if the root cause changes.

## 15. TEST REQUIREMENTS

Exercise production policy and boundaries:

- valid explicit channel consent happy path;
- every blocking state and unresolved conflict;
- `unvalidated` versus provider-valid boundary;
- email/SMS independence;
- global DNC precedence;
- replay and concurrent conflicting events;
- authorized/unauthorized mutations and override audit;
- rejected enrollment/send creates no forbidden mutation;
- legacy status compatibility and API/UI consumer regression;
- external/webhook partial failure where relevant.

## 16. SMOKE / INTEGRATION TEST

Extend the canonical contactability/sequence-compliance suite. If necessary, add `scripts/test-bt04-consent-contactability.ts` using isolated data and fake transports. It must prove the real enrollment/send boundary, not only a helper result.

## 17. POST-BUILD GREP CHECKS

Prove the bad field assignment and incompatible status writers are gone or normalized, every automated boundary calls the canonical decision, stale consumers were updated, no legacy simplified caller re-enables contact, and no competing consent projection was introduced.

## 18. REQUIRED GATES

Run targeted tests, sequence/enrollment/outbound/contactability suites, typecheck, production build if affected, migration validation/clean replay, relevant RBAC/contracts, pre-deploy compliance, and `git diff --check`. Report actual commands/results; do not claim complete with task-owned failures.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, and `git diff`; confirm only intended changes, no PII/secrets/debug files/lockfile drift/unrelated formatting/production config mutation.

## 20. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | ... | PASS / FAIL |

Every Done Looks Like requirement and kill line must be represented.

## 21. FINAL RESPONSE FORMAT

Return VERDICT, repository state, migration head, verified root cause, corrections, implementation lines, gate table, grep proof, kill-line proof, runtime/production distinction, realistic remaining risks, and SAFE TO MERGE / SAFE TO MERGE — RUNTIME VERIFICATION PENDING / DO NOT MERGE.

## LIBERTY-SPECIFIC SAFETY RULES

- Contacts: use the canonical writer/mutation owner; audit direct inserts/updates before adding another path.
- Outreach: readiness, score, consent, contactability and promotional eligibility remain independent gates.
- Consent: email and SMS are channel-specific unless verified global DNC applies; existence or form submission does not automatically grant every purpose/channel.
- GHL: provider tags/status cannot clear Liberty suppression without verified evidence.
- Email/sequences: all automated work must use durable enrollment/sending paths and enforce unsubscribe/suppression/contactability.
- Database: proper migrations and constraints only; no `db push` or speculative history rewrite.

## PRACTICAL REVIEW STANDARD

Block for realistic compliance bypass, wrong-channel re-enable, duplicate external action, unauthorized override, lost evidence, or unrecoverable projection state. Do not block correct forward-path enforcement merely because historical conflicts require a separately controlled remediation operation.

---

# TASK TO PREFLIGHT + BUILD

## BT-04 — Consent, Suppression & Channel Eligibility

**Primary findings:** `OUT-05`, `OUT-07`, `DAT-06`, `DAT-14`
**Dependency:** BT-03 boundary interfaces

### What & Why

The audits found a public intake path where `consentEmail` may derive from `consentSms`, incompatible status values and PEWC spellings, missing/unvalidated values treated too permissively by some callers, and a strong composite contactability service that is not necessarily unavoidable at every automated boundary. Conflicting live representations can produce unsafe reports or simplified decisions. Verify the current repository because recent outbound work may have corrected portions of this.

### Done Looks Like

- Verified mapping defects are fixed.
- One versioned policy returns the same purpose/channel decision in UI, enrollment, scheduler and transport paths.
- `unvalidated` is never reported as provider-valid and validity never grants consent.
- Explicit opt-out, complaint, hard bounce, DNC, suppression or unresolved conflict blocks automation.
- New consent/suppression mutations create immutable evidence and update one deterministic projection.
- Historical conflicts are inventoried and queued for manual remediation before any approved backfill.
- Email and SMS permission remain independent.
- SMS cannot be enabled without A2P/10DLC, number ownership, PEWC and quiet-hour evidence.

### Out of Scope

- Bulk auto-resolution of historical conflicts.
- Live sends or global/channel unpause.
- Provider validation redesign.
- Unrelated CRM UI consolidation.

### Proposed Implementation Steps

1. Inventory current fields, values, writers, readers, decision points and provider/webhook paths.
2. Verify/fix the public intake mapping and strict ownership.
3. Define the canonical versioned vocabulary and compatibility map using the existing contactability owner.
4. Add/extend immutable consent/suppression evidence and deterministic projection only if missing.
5. Route all automated enrollment/send decisions through the canonical purpose-aware policy before side effects.
6. Add conflict detection/reporting and a manual remediation queue without bulk auto-resolution.
7. Enforce the SMS readiness gate.
8. Update all consumers and add production-path concurrency/authorization/regression tests.

### Relevant Files and Areas to Verify

- `server/services/contactability.ts` or current policy owner
- public intake/form routes and schemas, historically `server/routes/public.ts`
- contact mutation/writer services and `shared/schema.ts`
- consent/suppression/audit tables and services
- imports, GHL inbound sync/webhooks, unsubscribe/DNC handlers
- promotional enrollment, sequence worker and channel/outbound adapters
- A2P/PEWC/quiet-hours/number-ownership configuration and checks
- contactability/sequence/pre-deploy tests and relevant UI/API consumers

Locate current owners; do not trust historical lines.

### Existing Kill Line

KILL LINE: If any explicit blocking evidence or unresolved conflict can still be bypassed by an automated enrollment/send path—or if one channel’s consent silently enables another—the task has FAILED.

## FINAL DIRECTIVE

Verify first, correct the plan, and build in this run if safe. Never solve ambiguity by choosing the least restrictive value, and never call a forward-path fix a completed historical reconciliation without runtime/data evidence.
