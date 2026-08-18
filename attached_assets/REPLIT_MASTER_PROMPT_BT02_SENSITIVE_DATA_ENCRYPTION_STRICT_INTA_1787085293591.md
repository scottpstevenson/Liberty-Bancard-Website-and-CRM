# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify the task against the current repository, correct stale assumptions, and—if materially valid and safe—implement it in the same run. Do not stop at another plan without a real blocker.

Do not blindly trust old paths/lines, redesign architecture unnecessarily, create competing owners, refactor unrelated code, use `db push`, weaken tests, expose sensitive values, or backfill production data without verified necessity and a safe migration. Stop only for a false finding, wrong owner, missing prerequisite/key-management authority, materially different architecture, unavailable required runtime evidence, necessary scope split, or kill line.

Required sequence: baseline → VFC → greps → root cause → ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → build → tests/gates → post-build greps → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture branch, HEAD SHA, working-tree status, and migration high-water mark/journal state. Identify unrelated modifications and preserve them.

## 2. VERIFIED FROM CODE — PREFLIGHT

Before editing, provide:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Verify the exact sensitive columns and types, current public/admin routes, validation schemas, DTOs, storage/service writers, readers, logs/audits, status-transition writers, key-management/encryption utilities, processor tokenization options, authorization checks, migrations, and tests. Find every caller/writer/consumer. Do not duplicate existing protection.

## 3. REQUIRED SEARCH / GREP CHECKS

Inspect surrounding code for:

- SSN/tax ID, routing/account/bank fields and aliases;
- merchant application schemas, draft/finalize/update/approval/underwriting/onboarding routes;
- inserts/updates/selects of merchant applications and protected fields;
- generic DTOs, serializers, API responses, logs, audits, exports, emails, GHL/processor payloads;
- application status values and every direct status writer;
- encryption, KMS, key version, tokenization, masking, last-four, decrypt, secret handling;
- `isAuthenticated`, `isDashboardUser`, `requireRole`, field-level permissions;
- migrations and Drizzle journal metadata;
- related unit, integration, public-form, application, boarding, and pre-deploy tests.

Also run the Liberty high-risk contact/outbound searches where the application flow creates contacts, deals, tasks, enrollments, or GHL writes. A grep hit is not proof; inspect implementation.

## 4. VERIFIED ROOT CAUSE

State what the task claimed, what current code actually persists/returns/logs, and whether status ownership is centralized. Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| ... | ... | ... |

## 5. SOURCE-OF-TRUTH CHECK

Identify:

- canonical application record/data owner;
- canonical protected-field mutation/read owner;
- canonical application status-transition owner;
- canonical encryption/tokenization/key owner;
- canonical audit owner;
- external processor/GHL owner where relevant.

Do not create a second application state machine or ad hoc crypto format if a canonical owner already exists.

## 6. BLAST RADIUS

### In scope

- preventing new plaintext sensitive persistence;
- strict field ownership at public and operator intake;
- purpose/role-scoped protected-field access;
- audited canonical application transitions;
- versioned encryption/tokenization representation;
- a proper migration and a resumable legacy-value migration only if populated legacy values actually exist;
- focused tests and scanners.

### Out of scope

- unrelated contact/deal redesign;
- storing secrets in repository or database rows;
- displaying full protected values in UI/logs/audits;
- broad production backfills when the live population is empty;
- processor onboarding or GHL workflow redesign beyond preserving existing effects.

List expected and explicitly untouched files. Keep the diff minimal.

## 7. DATA / SCHEMA CHECK

Verify exact table/columns, types, nullability, defaults, constraints, indexes, FKs, archive behavior, readers, and writers. If migration is required:

- use the next valid migration after the verified high-water mark;
- update the actual Drizzle journal/metadata correctly;
- never use `db push`;
- prefer additive/versioned migration and staged retirement;
- do not drop plaintext columns until every consumer is migrated and rollback is understood;
- do not backfill historical rows unless verified non-null data requires it;
- never emit sensitive values in migration output.

If tokenization is the canonical design, do not add parallel ciphertext fields without explaining why.

## 8. AUTHORIZATION CHECK

Verify actual middleware and field-level behavior. Produce:

| Action | Public | Agent | Manager | Admin | Purpose-scoped service |
|---|---:|---:|---:|---:|---:|
| Submit protected intake | ... | ... | ... | ... | ... |
| Read masked metadata | ... | ... | ... | ... | ... |
| Read/decrypt full value | ... | ... | ... | ... | ... |
| Change application status | ... | ... | ... | ... | ... |

Admin access must not automatically imply unrestricted decryption without purpose and audit evidence.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Check concurrent draft/finalize/status requests, stable idempotency, allowed transitions, duplicate applications, retry after partial failure, migration restart, key-version replay, and whether a crash can leave ciphertext/state/audit inconsistent. Use transactions/constraints/atomic transition predicates where needed.

## 10. EXTERNAL SIDE-EFFECT CHECK

Document real ordering across DB, encryption/tokenization/KMS, processor/GHL calls, enqueueing, and audit. Test or reason through external success/DB failure, DB success/external failure, retry, replay, and duplicate execution. Never claim PostgreSQL and external providers are atomic.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH. Continue immediately for either build-ready verdict.

## 12. CORRECTED BUILD PLAN

State verified What & Why, exact Done Looks Like, and stepwise current-file changes. Label realistic **BLOCKING CORRECTION** separately from optional **FOLLOW-UP HARDENING**. Do not include speculative future architecture.

## 13. KILL LINES

- KILL LINE: If any public, generic, or operator code path can still persist a new full SSN, routing number, or account number as plaintext, the task has FAILED.
- STOP if protected values appear in logs, audit details, errors, test snapshots, email, or ordinary API responses.
- STOP if a new ad hoc encryption owner/format competes with an existing canonical owner.
- STOP if application status can still bypass the canonical transition service.
- STOP if unauthorized roles can read/decrypt or mutate protected fields.
- STOP if concurrent/replayed finalization can duplicate durable or external side effects.
- STOP if a migration rewrites unrelated historical data, is not restart-safe, or uses `db push`.

## 14. IMPLEMENTATION RULES

Make the smallest safe diff, use current patterns, preserve canonical ownership, and avoid broad renames, formatting, unrelated cleanup, dependency changes, and production config mutation. If the root cause changes, update the corrected plan and continue only if safe.

## 15. TEST REQUIREMENTS

Prove applicable happy, negative, boundary, replay, concurrency, authorization, partial-failure, migration, and regression behavior. Tests must exercise production services/routes, not only crypto helpers. Use fake KMS/provider adapters where appropriate. Never use real sensitive values or provider calls.

## 16. SMOKE / INTEGRATION TEST

Extend the best existing merchant-application/public-form suite. If none proves the production path, add `scripts/test-bt02-sensitive-application.ts` (or repository-consistent equivalent) to assert:

1. valid protected intake persists only protected representation;
2. extra/unowned fields are rejected;
3. ordinary reads are masked/omitted;
4. unauthorized full access fails and leaves no audit gap;
5. status transitions use the canonical owner and are audited;
6. replay/concurrency do not duplicate effects;
7. legacy version handling works without value disclosure.

## 17. POST-BUILD GREP CHECKS

Prove no direct plaintext writers, generic protected DTO fields, unredacted logs, direct status writers, stale readers, or bypassing routes remain. Verify every consumer understands the new representation and no old column is silently authoritative.

## 18. REQUIRED GATES

Run real targeted tests, related application/public-form/onboarding tests, typecheck, production build if affected, migration validation/clean replay where feasible, compliance/invariant tests, and `git diff --check`. Report actual commands and results. Do not claim complete with a task-owned red gate.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, and `git diff`; confirm only intended files, no secrets/PII/debug junk/generated files/lockfile drift/unrelated formatting/production config changes.

## 20. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | ... | PASS / FAIL |

Every Done Looks Like requirement and kill line needs evidence.

## 21. FINAL RESPONSE FORMAT

Return VERDICT, repository starting/ending state, migration head, verified root cause, material corrections, `file:line` implementation summary, gate table, grep proof, kill-line proof, runtime/production verification distinction, realistic remaining risks, and final status: SAFE TO MERGE / SAFE TO MERGE — RUNTIME VERIFICATION PENDING / DO NOT MERGE.

## LIBERTY-SPECIFIC SAFETY RULES

- Contacts/prospects: do not create a competing contact writer when application intake creates or links CRM identities.
- GHL/processors: treat local and provider state as distributed; verify ordering, retries, duplicate IDs, protected-field boundaries and partial failures.
- Jobs: no `setImmediate`, process-memory-only retry, or swallowed error for revenue-critical application transitions.
- Database: proper migration/constraints only; no `db push`, unsafe destructive rewrite, or unrelated backfill.
- Sensitive data: purpose-scoped access, masking, audit evidence and key versioning are mandatory; tests use synthetic non-real values.

## PRACTICAL REVIEW STANDARD

Block for realistic plaintext exposure, unauthorized access, wrong application/merchant mutation, duplicated boarding/provider effects, data loss, or unrecoverable transition state. Do not block a safe implementation merely because a cleaner crypto abstraction could exist later.

---

# TASK TO PREFLIGHT + BUILD

## BT-02 — Sensitive Data Encryption & Strict Intake

**Primary findings:** `SEC-02`, `SEC-06`, `REV-03`
**Dependency:** BT-01 containment decision

### What & Why

The audit found merchant-application SSN, routing-number, and bank-account paths modeled or written as ordinary text, public schemas that may accept fields they do not own, and multiple application-status mutation paths. Empty production values do not make the future write path safe. The current repository may have changed, so verify exact columns, writers, consumers, and existing cryptographic/tokenization infrastructure first.

### Done Looks Like

- New full sensitive values cannot be persisted as plaintext.
- The protected representation is versioned and uses the existing approved key/token owner.
- Public and operator schemas reject extra/unowned protected fields.
- Generic DTOs and ordinary APIs cannot read or mutate full values.
- Purpose- and role-scoped access is audited without storing the value in audit details.
- One application transition service owns allowed status changes and required effects.
- Any populated legacy values are migrated resumably without logging values; if none exist, no needless backfill runs.
- Existing non-sensitive application/onboarding behavior remains compatible.

### Out of Scope

- Rebuilding the complete merchant funnel.
- Changing unrelated contact/deal ownership.
- Adding a second crypto/key system.
- Real provider calls or production-value inspection during tests.

### Proposed Implementation Steps

1. Inventory sensitive schema, all writers/readers/serializers/logs and status mutations.
2. Select and document the verified canonical encryption/tokenization owner and representation.
3. Add the minimum additive schema migration and migration metadata.
4. Introduce or extend a canonical protected-field service with masked metadata and audited purpose-scoped reads.
5. Make public/admin validation strict and remove protected fields from generic DTOs.
6. Consolidate application transitions behind one atomic service while preserving existing side effects through owned adapters.
7. Add a resumable legacy migration only if aggregate-safe evidence proves populated rows exist.
8. Add route/service/migration/concurrency/authorization tests and scanner assertions.

### Relevant Files and Areas to Verify

- `shared/schema.ts`
- root `migrations/**` and Drizzle journal/metadata
- current merchant-application public/admin route modules (historically including `server/routes/public.ts`)
- merchant application storage/services, underwriting/onboarding/boarding services
- Zod request schemas and shared DTO types
- audit-log service/table
- existing encryption, tokenization, KMS, secrets, masking utilities
- GHL/processor application adapters and tests

Locate current owners; do not trust historical line numbers.

### Existing Kill Line

KILL LINE: If any production-reachable path can still store or expose a new full SSN, routing number, or account number as plaintext—or bypass the canonical audited application transition owner—the task has FAILED.

## FINAL DIRECTIVE

Verify first, then build in the same run if safe. Do not create another planning loop unless key-management authority, migration safety, or a materially different application architecture is a genuine blocker.
