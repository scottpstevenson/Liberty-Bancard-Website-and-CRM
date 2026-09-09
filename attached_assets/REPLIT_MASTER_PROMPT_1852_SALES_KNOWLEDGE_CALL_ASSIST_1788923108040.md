# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK #1852 — Sales Knowledge Authority & Human Call Assist

## MODE

PREFLIGHT + BUILD. Audit the current repository first, correct stale assumptions, then implement every safe build-ready requirement in the same run. Do not stop after producing another plan unless a genuine blocker exists.

Audited reference only: `origin/main` was `bae053a655e05ccb69a8b9dc07f84d1a5e020028`, with Tasks #1834–#1836 present and repository migration head `0234_contact_remediation_operations`. Re-fetch `origin/main`, report the exact build SHA, and select the next unused migration from the live journal. Do not assume `0235` is still free.

Never use `db push`, rewrite applied migrations, call a live provider from tests, persist fabricated AI output, weaken an assertion, duplicate authorization/knowledge authority, expose cross-user sessions, or mutate contacts/deals/call logs/GHL from Call Assist.

Required sequence: baseline → VFC → ownership/grep census → schema/auth/privacy/concurrency/external checks → verdict → corrected plan → implementation → targeted tests → full required gates → post-build grep → diff review → final VFC → merge verdict.

## VERIFIED STARTING REALITY — RECHECK BEFORE BUILD

- `knowledge_sources.audience` is text and `staff` is already accepted by routes/retrieval. There is no missing staff enum to add.
- Published sources are currently mutable; `publishSource()` increments an integer on the same row.
- `indexSource()` deletes current chunks and replaces them without a revision FK.
- Filtered `listKnowledgeSources()` constructs placeholders but does not pass its parameter array.
- Semantic retrieval reads only the first 1,000 chunks ordered by ID and ranks them in application memory.
- Keyword fallback builds an unescaped regular expression from user words.
- `assistant_sessions.user_id` is integer while canonical `users.id` is varchar.
- Existing assistant-session reuse, history, and feedback routes do not prove caller ownership; feedback does not prove the message belongs to the session.
- `/api/ai/chat` remains a separate direct OpenAI authority returning `{ response }`; `/api/assistant/chat` returns the governed assistant contract.
- `Chat.tsx` selects a contact label/vertical but does not send a contact ID.
- Canonical contact authorization is `authorizeContactAccess()` in `server/services/crm-object-access.ts` and the global CRM object guard.
- Sales Prep uses `OPENAI_API_KEY`, contains a `buildFixture()` fallback with an unsupported 15–30% claim, and can persist fixture output when the provider fails.
- Roleplay uses hardcoded scenario claims and initializes passing-looking 7/10 scores before parsing.
- The six training modules are defined in `client/src/pages/dashboard/Training.tsx`, not `server/routes/training.ts`.
- `CALL_ASSIST_ENABLED` does not exist in the canonical feature-flag/wizard registry.

## WHAT & WHY

Create one governed, revision-pinned staff sales knowledge authority and route staff-facing AI guidance through it. Repair assistant session isolation first, reconcile existing sales/training material into reviewable drafts, remove fabricated provider fallbacks, and add a feature-flagged human Call Assist panel that advises an authorized rep without performing outbound or changing CRM records.

## SOURCE-OF-TRUTH MAP

| Concern | Canonical owner |
|---|---|
| User identity/role | `users` plus existing auth middleware |
| Contact access | `server/services/crm-object-access.ts` |
| Manual-call eligibility | CR-04 contactability authority; do not reimplement it |
| Knowledge source/retrieval | `server/services/knowledge-base.ts` and revision-bound schema |
| AI safety | `server/services/chat-safety.ts` |
| Provider configuration | `AI_INTEGRATIONS_OPENAI_API_KEY` and existing base URL/budget controls |
| Feature activation | `feature-flags.ts` + `wizard-flag-overrides.ts` |
| AI audit | existing `ai_audit_logs`, extended with structured redacted metadata |

## DONE LOOKS LIKE

1. Staff knowledge uses immutable published revisions with provenance, review state, content hash, deterministic revision number, publishing actor, index state, and rollback-as-new-revision.
2. Retrieval and citations are pinned to the exact currently published, successfully indexed revision. A failed index never replaces the last good published pointer.
3. Existing public/merchant behavior remains compatible; staff sources are not visible to lower audiences.
4. Staff assistant sessions are bound to the canonical varchar user ID and cannot be reused, read, or rated by another user or audience. Public anonymous behavior remains supported through a server-bound, high-entropy session capability rather than trusting a bare client-supplied ID.
5. `/api/ai/chat` is a compatibility adapter over the governed orchestration. Existing clients continue to work while receiving equivalent answer/source/low-confidence/session information.
6. Contact context is assembled only after the route calls `authorizeContactAccess(..., { exactAssignment: true })` for agents. Unauthorized access is indistinguishable from not found.
7. Ephemeral context is bounded to first name, company/linked business, vertical, known processor, lead source, five authorized recent activities, open next task, and quality/manual-call eligibility summary. It never enters knowledge chunks.
8. Sales Prep uses governed staff retrieval and the canonical OpenAI configuration. Production no-key/provider failures return explicit unavailable reason codes and never persist fixtures.
9. Roleplay scenarios cite published staff revisions. Structured scoring is schema-validated; malformed output records failed/unavailable with no default passing score.
10. Call Assist is read-only, exactly assigned, manual-call-eligible, desktop/mobile accessible, default-off, and returns concise guidance, follow-up question, citations, and explicit low-confidence/unavailable state.
11. AI telemetry stores prompt version, model, revision IDs, actor ID, contact ID, latency, tokens, confidence, and safety flags without raw contact PII. Raw provider payload retention is prohibited unless separately encrypted, access-controlled, and retention-governed; this task should use redacted text/hash instead.
12. Deterministic certification proves audience boundaries, session isolation, contact isolation, revision pinning/rollback, citation grounding, no-key behavior, claim refusal/regression, score-failure behavior, Call Assist no-side-effects, and no PII in chunks/audit metadata.

## REQUIRED IMPLEMENTATION

### 1. Baseline and VFC

Capture branch, SHA, dirty state, migration SQL/journal head, package engines, workflow/pre-deploy inventory, current feature flags, AI routes, knowledge tables, and test classification. Produce a table with CONFIRMED/PARTIAL/FALSE/OUTDATED for every starting claim above.

### 2. Add the next migration

Use the next live migration number. Add, idempotently:

- `knowledge_source_revisions`: immutable ID, source FK, revision number, source snapshot fields, content hash, provenance JSON, review state, index state/error code, prompt/version metadata, publisher varchar user FK where safe, timestamps, and unique `(source_id, revision_number)`.
- `knowledge_sources.current_published_revision_id` as the single effective published pointer. Do **not** add a competing `effective_status` column.
- `knowledge_chunks.source_revision_id`, with indexes/uniqueness binding chunks to a revision.
- Convert `assistant_sessions.user_id` from integer to varchar using an explicit safe cast. Census orphans before adding/validating any FK; never delete them silently.
- Session-binding fields needed for anonymous capability verification, stored hashed rather than plaintext.
- Roleplay revision/scoring status fields needed for source provenance and fail-closed scoring.
- `call_assist_sessions` append-only telemetry and a separate append-only feedback table if feedback is in scope. Use varchar actor ID, contact FK, phase, reason-coded status, bounded/redacted note, answer, exact revision IDs, confidence, latency/tokens, timestamps. Do not make an immutable session row require later updates.
- Structured/redacted AI audit metadata fields or a JSONB metadata column. Do not put PII into raw prompt/response fields.

Add DB constraints, indexes, append-only triggers where applicable, clean-up behavior, and schema definitions. Prove clean replay and upgrade from the prior head on a disposable DB.

### 3. Revision authority and safe retrieval

- Publish under a source-row lock with expected-version/CAS semantics.
- Create and index a candidate revision; atomically advance `current_published_revision_id` only after successful indexing.
- Rollback by republishing historical content as a new revision.
- Refuse hard deletion of a source with revision history; archive it instead.
- Fix the filtered source query by using the canonical parameterized query mechanism.
- Replace raw regex fallback with a safe bounded query or properly escaped terms.
- Remove the first-1,000 ordered-chunk correctness ceiling. Use the repository-supported indexed/vector/search approach or a bounded DB-ranked strategy; report performance evidence.
- Return source ID **and revision ID** in every citation.

### 4. Reconcile legacy sales knowledge

Create `scripts/reconcile-staff-knowledge.ts` as preview-first and idempotent. Inventory and import draft staff sources from:

- legacy `knowledge_base` sales articles;
- `client/src/pages/dashboard/Training.tsx` training modules;
- `vertical-advisor-prompts.ts` and `vertical-voice-scripts.ts`;
- Sales Prep prompt text;
- roleplay scenario text;
- any additional duplicate authority discovered by the preflight census.

Use a stable canonical provenance key plus content hash; store origin file and line range. Never delete or auto-publish originals. Report created/updated/unchanged/conflicted/claim-risk counts. Flag unsupported numeric/guarantee language for review.

### 5. Secure assistant sessions before unification

- Enforce immutable session audience and ownership on create/reuse/chat/history/feedback.
- For authenticated staff, bind session user ID to `req.user.id`; never trust body identity.
- For anonymous sessions, bind access to a server-created secret/cookie whose hash is stored. A UUID in a query parameter alone is not sufficient authority.
- Verify feedback `message_id` belongs to the authorized session.
- Return 404-style denials for cross-user access and add replay/isolation tests.

### 6. Unify staff AI surfaces

- Convert only `POST /api/ai/chat` into a compatibility adapter; do not refactor unrelated AI endpoints in the same large file.
- Preserve the current authenticated-role boundary or tighten it to explicit dashboard roles after a VFC.
- Update `Chat.tsx` to retain and submit selected `contactId`, while the server remains authoritative.
- Keep `InternalSidebarChat` and `DashboardDataAgent` on the governed assistant contract.
- Add compatibility tests for old and new response shapes during transition.

### 7. Bounded contact context and eligibility

- At each contact route, call the canonical `authorizeContactAccess()` helper. Agents require exact assignment for Call Assist.
- Query only the approved context fields and authorized activity/task summaries.
- Call the existing CR-04 manual-call evaluator and refuse Call Assist with a stable blocked reason when the contact is not currently eligible.
- Do not create contacts, deals, calls, tasks, sequence enrollments, or provider events.

### 8. Repair Sales Prep and roleplay

- Standardize task-owned provider calls on `AI_INTEGRATIONS_OPENAI_API_KEY` and existing budget controls.
- Restrict fixtures to explicit test transport only. No-key/provider error returns an unavailable contract and is not cached.
- Keep a stable cache namespace and store/compare a dependency fingerprint derived from contact `updated_at`, current revision set, prompt version, and model; overwrite the derived cache row rather than generating unbounded keys.
- Validate provider JSON with zod before persistence.
- Make Sales Prep/Call Assist accessible to authorized canonical contacts without accidentally depending on `sdr_lead_state`; preserve the existing SDR-specific behavior where unrelated.
- Replace roleplay hardcoded truth with revision-pinned content and record scoring status/error codes. Store only redacted/bounded diagnostic response material.

### 9. Call Assist API and UI

Add a feature-flagged endpoint under `/api/contacts/:id/call-assist` accepting the bounded phases `pre_call`, `objection`, `follow_up`, and `statement_request`. Validate objection category and note length. Return `{ available, answer, sources, lowConfidence, sessionId, latencyMs, reason? }`.

Add a reusable compact panel to Contact Detail and Mobile Contact Detail. It may be surfaced from Sales Prep but must not be hidden for a non-SDR canonical contact. No microphone, recording, transcript, autodial, message send, or automatic CRM write.

Add `CALL_ASSIST_ENABLED` to every canonical flag enumeration, environment/default map, wizard override/readiness surface, and test. Default false.

### 10. Readiness, metrics, and tests

Keep the existing `/api/knowledge/*` namespace unless the audit proves a canonical admin namespace migration. Add staff readiness, revision history, claim-risk, index failure, grounded response, low-confidence, feedback, roleplay-failure, and Call Assist usage metrics with explicit denominators.

Tests must:

- require a disposable database URL and hard-refuse the production/shared DB;
- deny all real provider/network calls through a fake OpenAI transport;
- prove exact pre/post DB state and no Call Assist side effects;
- cover simultaneous publish, rollback, duplicate import, session replay, cross-agent access, and malformed model output;
- register in the canonical CI/pre-deploy manifest without weakening existing gates.

## AUTHORIZATION MATRIX

| Action | Public | Merchant | Agent | Manager | Admin |
|---|---:|---:|---:|---:|---:|
| Public assistant | Yes, bound anonymous session | Yes | Yes | Yes | Yes |
| Staff knowledge retrieval | No | No | Yes | Yes | Yes |
| Staff source/revision admin | No | No | No | Yes | Yes |
| Publish/rollback staff revision | No | No | No | Yes | Yes |
| Contact-context staff chat | No | No | Exact assigned | Yes | Yes |
| Call Assist | No | No | Exact assigned + eligible | Yes + eligible | Yes + eligible |
| Enable feature flag | No | No | No | Per existing wizard policy | Per existing wizard policy |

Enforce this server-side. UI hiding is not authorization.

## KILL LINES

- STOP if staff sessions can be replayed/read/rated by another user or audience.
- STOP if retrieval cites a mutable source without an exact revision.
- STOP if a failed index replaces the last-known-good published revision.
- STOP if Call Assist bypasses exact contact access or CR-04 manual-call eligibility.
- STOP if any production fallback fabricates or persists a result.
- STOP if raw contact PII enters chunks, audit metadata, logs, or ungoverned raw prompt storage.
- STOP if tests can call OpenAI or mutate a shared/production database.
- STOP if the build creates a second contact authorization policy, knowledge authority, provider client, or feature-flag registry.
- STOP if Call Assist writes contacts, deals, tasks, call logs, sequences, GHL, email, SMS, or voice actions.

## REQUIRED GATES AND FINAL RESPONSE

Run targeted deterministic tests, disposable DB integration tests, knowledge/assistant/Sales Prep/roleplay suites, object-access and role guards, migration validation/clean replay, typecheck, production build, canonical pre-deploy/compliance, and `git diff --check` under repository-pinned Node/npm.

Return: verdict; starting/ending SHA; migration head; VFC; authority map; implemented `file:line` evidence; gate command/result table; post-build grep proof; kill-line proof; diff review; remaining runtime/external activation; and `SAFE TO MERGE`, `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`, or `DO NOT MERGE`.

Separate code, merge, deployment, schema-application, credentials, feature activation, production publication, and outbound states. Merging this task does not authorize production publication or outbound.

