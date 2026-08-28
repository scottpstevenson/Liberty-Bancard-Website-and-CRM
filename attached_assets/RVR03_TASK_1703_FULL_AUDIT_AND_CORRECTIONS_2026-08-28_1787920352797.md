# Liberty Bancard — Task #1703 RVR-03 Full Audit and Required Corrections

**Audit date:** 2026-08-28  
**Submitted task:** `1703 - SAST Privacy Logging Remediation`  
**Audit mode:** full live-repository preflight and plan correction; no application implementation  
**Authoritative repository:** `origin/main`  
**Audited SHA:** `b1921ac523e77f22c941f46667e84af2ed2b5981`  
**Submitted plan SHA:** `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42`  
**Migration head:** `0173_cro02_graph_lock_order`

## 1. Verdict

**VERDICT: NOT BUILD-READY AS WRITTEN. BUILDABLE ONLY AFTER THE CONTROLLING CORRECTIONS BELOW ARE ADDED.**

The plan correctly identifies fragmented privacy handling, raw operational error logging, excessive merchant-invite validation output, and the fact that digest-derived OG filenames defeat ordinary user-controlled path traversal. It does **not** yet describe a complete or safely closable security task.

The most important correction is that the historical password-related SAST finding is not a harmless reset-token-column false positive. Current `main` contains:

- an applied migration that identifies a production administrator and embeds a fixed credential hash while documenting the corresponding known password; and
- a tracked administrative reset utility that assigns a hard-coded password and prints that password and the selected account identity.

This report intentionally does not reproduce those values.

The task also omits live temporary-password delivery, URL-borne bearer tokens, purpose confusion between user reset and merchant activation tokens, non-atomic token consumption, duplicate partner reset route families, and unsanitized channel-audit snapshots. Finally, current `main` already fails its required tracked-file exposure scan, so the submitted clean-gate baseline is false.

### Correction count

This audit uses control-level corrections rather than counting every affected route or log call separately.

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 6 | Must be corrected before Task #1703 can be merged or closed |
| P1 | 3 | Required for full acceptance and durable recurrence prevention |
| **Total** | **9** | Consolidated control boundaries, not micro-findings |

## 2. Repository Recapture

| Item | Verified state |
|---|---|
| Submitted baseline | `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42` |
| Current `origin/main` | `b1921ac523e77f22c941f46667e84af2ed2b5981` |
| Baseline ancestry | Submitted SHA is an ancestor of current `main` |
| Intervening functional merge | RVR-02 dependency/lockfile remediation at `c20326a…` |
| Current migration head | `0173_cro02_graph_lock_order` |
| Current suite manifest | 73 suites: 27 static, 27 integration, 13 server-required, 6 server-optional |
| Audit worktree | Clean detached worktree; sparse tracked assets were materialized only to verify the build |
| Production/provider mutation | None |

The task must be rebased to the current SHA and must treat RVR-02's changes to the lockfile, dependency gates, CI manifest, OG route, and build environment as current authority.

## 3. Corrected Verified-Fact Table

| ID | Submitted claim | Audit verdict | Corrected reality |
|---|---|---|---|
| VFC-01 | Two current high SAST findings remain | **PARTIAL** | The August 27 packet records eight SAST findings with two high categories, but no committed managed-scan rule artifact permits a complete current rerun. One high target is independently confirmed as a credential exposure; the OG traversal claim is outdated in its original form. |
| VFC-02 | Password-reset history does not prove credential exposure | **FALSE** | `migrations/0075_admin_password_reset.sql:1-5` contains a fixed credential hash, a named production identity, and a comment disclosing the corresponding password. `scripts/reset-admin-password.ts:6-26` contains another fixed administrative password and prints it with the account identity. Values must never be repeated in evidence. |
| VFC-03 | OG input can escape the cache root | **OUTDATED AS ORDINARY TRAVERSAL; PARTIAL AS CACHE SAFETY** | User template/slug/title values are not joined into the cache pathname. The pathname uses a fixed digest. However, cache reads follow symlinks and writes are non-atomic, so the task's own symlink/concurrency acceptance criteria do not pass on current code. |
| VFC-04 | Reset/invite risk is bounded to listed routes | **FALSE / INCOMPLETE** | User reset and verification, merchant activation, two partner reset families, partner invite activation, and partner-organization temporary-password creation/reset all belong to the credential surface. Four client pages retain bearer tokens in the query string. |
| VFC-05 | Existing sanitizer covers structured audits | **PARTIAL** | `audit_logs` writes through the canonical storage boundary are sanitized, but `channel_audit_log` is not. Current channel snapshots can persist actor email plus preview contact names, email addresses, phone numbers, and identifiers. Multiple direct audit inserts also exist and require an explicit sink inventory. |
| VFC-06 | Generic server errors are privacy safe | **PARTIAL** | Client responses are generic only in production. `serverError` logs the entire raw error object before establishing its correlation ID, and `safeMessage` returns raw messages outside production. This is unsafe for public-route tests and development logs containing real-like data. |
| VFC-07 | Required gates are current and green | **FALSE** | The 73-suite manifest is internally valid, but `scripts/scan-tracked-files.ts` currently fails on eight prohibited tracked generated-text artifacts in `main`. Full deterministic-static certification is therefore not green. |
| VFC-08 | Migration is not required | **FALSE FOR A COMPLETE FIX** | Replacing all independent reset/invite stores and partner-org plaintext temporary credentials with one durable, purpose-bound, atomically consumable authority requires an additive schema owner. A focused next migration is the recommended safe design. |

## 4. Verified Root Causes

### 4.1 Credential exposure and unsafe administrative reset paths

The password SAST category maps to real, reachable security risk, not merely to benign column names:

- `migrations/0075_admin_password_reset.sql:1-5` contains a known credential mapping for a production administrator.
- `scripts/reset-admin-password.ts:6-26` can update the environment-selected administrator to a hard-coded password and prints both the password and identity.
- The normal startup seed uses environment secrets and preserves existing passwords unless a force-update flag is explicitly enabled, so the tracked hard-coded utility is unnecessary and conflicts with the canonical owner.

Credential rotation, session invalidation, repository-history containment, and current-tree code cleanup are separate actions. The build agent may remove or hard-disable the unsafe utility, but it must not rewrite shared Git history or rotate production credentials without explicit owner authorization.

### 4.2 Fragmented one-time credential authorities

One-time credential behavior is implemented independently in multiple places:

- user password reset and email verification;
- merchant portal invitation and activation;
- legacy and canonical partner password reset routes;
- partner invitation/set-password;
- partner-organization user creation and administrator reset.

This produces inconsistent password policies, duplicated issuers, query-string bearer tokens, purpose ambiguity, non-atomic read-then-update consumption, inconsistent session invalidation, and divergent logging/delivery behavior.

The user `resetToken` fields are reused for both password reset and merchant activation. A route checks account role, but neither stored value nor lookup is purpose-bound. Partner rows have separate reset and invite columns, yet their consumers still perform a lookup followed by a separate update. Partner-organization users have no one-time token authority and are emailed plaintext temporary passwords generated with `Math.random()`.

### 4.3 Bearer credential transport and browser retention

New reset, verification, merchant activation, partner reset, and partner invite links place the raw bearer value in the URL query string. The clients retain it in `window.location.search`; merchant validation additionally submits it through a GET query.

This can expose the token to browser history, copied URLs, screenshots, analytics, referrer behavior, reverse-proxy/access logs, and error tooling. The application request logger uses `req.path`, which avoids query logging there, but infrastructure outside that logger is not proven safe.

### 4.4 Operational logging and audit boundaries

Confirmed unsafe families include:

- auth delivery logs containing recipient addresses and raw provider error content;
- partner flows logging complete reset/invite URLs and raw provider errors;
- merchant invitation logs containing recipient identity and raw mail errors;
- administrative seed logs containing account identity;
- `serverError` logging entire arbitrary error objects;
- `channel_audit_log` persisting unsanitized identity/contact snapshots.

The existing audit sanitizer is useful and passes its focused tests, but it is not an operational logger. Applying it indiscriminately would also be wrong because it preserves arbitrary top-level scalar strings unless they sit under a recognized sensitive key. A narrow structured operational-error adapter is required.

### 4.5 OG finding disposition

The original traversal theory is obsolete because cache filenames are based on a digest, not raw request path segments. Existing protections include a template allowlist, XML escaping, title length bounds, and a fixed cache root.

Current cache access is still best-effort synchronous I/O using `existsSync`/`readFileSync` and `writeFileSync`. It follows a pre-existing symlink and is not atomic under concurrent writers. Those are local-filesystem attack/reliability concerns, not evidence that an HTTP slug can traverse directories. The final report must classify these separately.

## 5. Nine Controlling Corrections

### P0-01 — Rebase and clear the actual required baseline

Replace the submitted repository state with:

- `origin/main = b1921ac523e77f22c941f46667e84af2ed2b5981` or the newer exact SHA at execution;
- migration head `0173_cro02_graph_lock_order` or the newer journal head;
- 73 currently classified suites, not 67;
- RVR-02's portable lockfile and dependency-policy owners.

Before Task #1703 can merge, resolve the separate RVR-01 regression causing `scripts/scan-tracked-files.ts` to fail on eight prohibited tracked artifacts. RVR-03 must not delete unrelated artifacts itself, suppress the gate, or claim the failure is harmless.

### P0-02 — Treat the historical password finding as a credential incident

Do all of the following without printing credential material:

1. Remove or permanently hard-disable `scripts/reset-admin-password.ts`; the canonical reset and controlled environment-seed flows must remain the only owners.
2. Add a deterministic source guard that rejects hard-coded non-fixture passwords, known password/hash mappings, raw credential output, and production identity targeting in migrations and operational scripts.
3. Record a security-owner action requiring proof that the affected administrator credential has been rotated and all sessions invalidated on every relevant environment.
4. Record repository-owner disposition for the sensitive applied migration and reachable Git history. Do not edit the applied file or rewrite shared history without explicit approval, clone/deployment coordination, and rollback.
5. Keep current-tree cleanup, history rewrite, credential rotation, and deployed-release replacement as separately evidenced steps.

**Kill line:** Task #1703 cannot report the password high as fixed or false while the known credential mapping remains reachable and rotation/session evidence is absent.

### P0-03 — Create one canonical purpose-bound auth-action authority

Replace the independent reset/invite stores with one server-side authority backed by one additive migration. The recommended contract is a durable `auth_action_tokens`-style table containing only a cryptographic token hash and safe metadata:

- purpose;
- subject type and canonical subject ID;
- token hash;
- issued/expiry timestamps;
- consumed/revoked timestamps;
- delivery disposition and safe reason code;
- issuer/correlation metadata without recipient or raw payload.

Supported purposes must be explicit and non-interchangeable:

- `USER_PASSWORD_RESET`;
- `USER_EMAIL_VERIFY`;
- `MERCHANT_PORTAL_ACTIVATE`;
- `PARTNER_PASSWORD_RESET`;
- `PARTNER_INVITE_ACTIVATE`;
- `PARTNER_ORG_INVITE_ACTIVATE`;
- `PARTNER_ORG_PASSWORD_RESET`.

Issue with a cryptographically secure random value, store only its hash, and atomically consume it inside the same transaction as the password/verification state change:

```text
UPDATE auth_action_tokens
SET consumed_at = now()
WHERE token_hash = :hash
  AND purpose = :purpose
  AND consumed_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now()
RETURNING subject_type, subject_id
```

Exactly one concurrent consumer may receive a row. If the subject update fails, token consumption must roll back. Partner password updates across `partners` and the linked auth user must share one transaction. Password reset must invalidate all sessions; activation may establish a new session only after the durable state commits.

All legacy and canonical partner route paths must delegate to the same helper and retain only their compatible HTTP envelope. No route may independently generate, hash, look up, clear, or consume a credential token.

Partner-organization creation/reset must stop generating or emailing plaintext temporary passwords. Create a pending user and send a one-time activation/reset action instead.

This correction changes the migration decision to **YES — one additive migration**. Serialize migration ownership with any concurrent CRO task; never use `db push`, edit prior migration history, or reuse a timestamp/tag.

### P0-04 — Remove bearer values from query transport and public identity responses

For every new auth-action email:

- place the raw value in a URL fragment, not a query string;
- parse it client-side once and immediately remove it with `history.replaceState` before any fetch, analytics, error capture, or navigation;
- submit it only in a JSON POST body to a rate-limited endpoint;
- set `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on token validation/consumption responses and public auth pages;
- never echo a bearer value in a response, log, audit, correlation field, or provider error.

Merchant invitation validation must become a rate-limited POST and return only a stable validity/disposition envelope. It must not return email, first name, or last name. Invalid, expired, wrong-purpose, revoked, used, wrong-role, and unknown tokens must use one privacy-safe public error family.

The client blast radius omitted from the submitted plan is mandatory:

- `client/src/pages/ResetPassword.tsx`;
- `client/src/pages/VerifyEmail.tsx`;
- `client/src/pages/ActivatePortal.tsx`;
- `client/src/pages/PartnerLogin.tsx`;
- `client/src/pages/PartnerPortal.tsx`.

Existing query-string links cannot be accepted indefinitely without retaining the leak. Use an explicit cutover: invalidate legacy action tokens, require a new reset/request or authorized invite resend, and document that operational reissue is outside the build. Do not silently accept a legacy token in more than one purpose endpoint.

### P0-05 — Establish one privacy-safe operational diagnostic boundary

Change the canonical error path so it:

1. creates the correlation ID before logging;
2. derives a stable safe error class/reason code;
3. emits a bounded structured event containing correlation ID, route/method/status, safe class, and safe operational context;
4. never passes a whole `Error`, stack, SQL detail, provider body, recipient, URL, request body, or arbitrary raw message to `console.*`;
5. always returns a generic public message, including development/test for public endpoints.

Do not use `safeMessage` as permission to expose raw messages outside production. Route-specific client errors may use an explicit allowlisted code/message map; unexpected failures always use the generic envelope.

Normalize auth/partner/merchant mail results to `sent | definitely_failed | ambiguous` plus a safe reason code. Remove recipient identities, reset/invite URLs, account identities, provider payloads, and raw error objects from the scoped log families.

For structured audit:

- sanitize `channel_audit_log` at its storage boundary;
- stop persisting preview names, emails, phone numbers, or raw evaluated subjects in `checklistSnapshot`;
- retain aggregate counts, channel, safe reason buckets, actor user ID, and approved notes;
- classify every direct `audit_logs` insert and prove it invokes the canonical sanitizer;
- preserve the explicit `communication_events` business-content exception.

### P0-06 — Make scanner closure reproducible and fail-closed

The August packet contains counts only. Task closure requires a current redacted artifact with:

- scanner name/version/configuration;
- rule IDs and severities;
- current SHA;
- path and safe line range;
- reachability/disposition;
- fix, documented false positive, or external owner action;
- rerun result.

Add one focused deterministic suite covering:

- known credential mapping/hard-coded admin reset utilities;
- raw reset/invite/verification URLs in operational logs;
- query-string creation for auth-action links;
- whole-error and raw provider-error logging in the scoped auth families;
- public merchant validation identity output;
- independent token hash/lookup/consume implementations outside the canonical authority;
- unsanitized `channel_audit_log` writes.

Register the same suite in `scripts/pre-deploy.ts` and `scripts/ci-suite-manifest.ts` as deterministic-static. Add negative fixtures that prove the scanner fails on synthetic reintroduction. Do not add path-wide exclusions, blanket `nosemgrep` comments, or a second suite registry.

If the managed SAST/privacy service is unavailable, the executor must say so. Repository tests may prove the remediated callsites, but they cannot claim the historical managed finding count is zero without the managed rerun.

### P1-01 — Freeze delivery, enumeration, replay, and rollout semantics

Define these contracts before implementation:

- forgot-password responses use the same status/body family whether a subject exists or not;
- all issue/validate/consume endpoints have purpose-appropriate rate limits;
- repeated issuance revokes previous unconsumed tokens for the same subject/purpose in the same transaction;
- a definite pre-dispatch failure revokes only the matching newly issued token;
- an ambiguous provider outcome is recorded safely and is not automatically retried, preventing duplicate sends or ambiguous billing;
- replay, concurrent replay, expiry, revocation, wrong purpose, wrong subject type, and stale legacy links fail generically;
- password-reset success invalidates all prior sessions; merchant activation session creation happens only after commit;
- delivery failure never changes the public account-existence response.

Use synthetic transports only. No live email or provider call is authorized.

### P1-02 — Preserve OG digest ownership while fixing the testable local-cache gaps

Keep the fixed-root, allowlisted-template, digest-derived cache design. Do not create a raw user-path authorization layer that is unnecessary for the current architecture.

To satisfy the task's own symlink and concurrency requirements:

- use a full SHA-256 cache key or equivalent fixed-length strong digest;
- validate the internal key shape before any access;
- read with no-follow semantics where supported and reject non-regular files;
- write a uniquely named file in the cache directory with exclusive creation and restrictive mode, then atomically rename it into place;
- never follow or overwrite a symlink target;
- return one generic public render error in every environment while logging only safe correlation/class data.

Tests must distinguish HTTP traversal (not reachable) from a hostile local cache entry (must not escape or corrupt another file). Collision tests should inject a cache-key seam rather than attempt a real cryptographic collision.

### P1-03 — Expand the file/test inventory and final evidence contract

Add these omitted owners:

- `migrations/0075_admin_password_reset.sql` — evidence/incident disposition only; do not edit casually;
- `scripts/reset-admin-password.ts` — remove or hard-disable;
- `server/routes/partner-orgs.ts:735-881`;
- `server/storage/partner-orgs.ts:146-188`;
- the five client auth-action pages listed above;
- `server/middleware/csrf.ts` and the shared rate-limit owner;
- `server/index.ts:195-218` for request-log behavior;
- `shared/schema.ts:2998-3015` and `server/routes/activation.ts:1243-1400` for channel-audit payloads;
- every direct `audit_logs` insertion found by the post-build inventory.

The final VFC must separately report:

- source code/tests;
- managed scanner results;
- credential/session rotation;
- repository-history containment;
- deployment/log-retention actions;
- RVR-01 tracked-file gate recovery.

No code-only proof may be labeled production credential rotation, history purge, deployed release replacement, or production log deletion.

## 6. Corrected Build Sequence

1. **Stop secret reproduction.** Create a metadata-only incident record for the known credential mapping and unsafe reset utility.
2. **Obtain owner actions.** Security owner rotates the affected credential and invalidates sessions; repository owner chooses the history-containment path. Do not expose values in tickets or chat.
3. **Rebase and clear prerequisite gates.** Recapture current `main`; resolve the separate eight-file RVR-01 gate failure.
4. **Allocate migration ownership.** Reserve the next additive migration after all earlier concurrent migration tasks are settled.
5. **Build the canonical auth-action authority.** Add purpose-bound issuance, validation, revocation, atomic consumption, delivery disposition, and session handling.
6. **Migrate every consumer.** Route user, verification, merchant, partner, and partner-org actions through the authority; eliminate plaintext temporary credentials and duplicate token logic.
7. **Harden browser/public contracts.** Fragment transport, immediate URL scrub, POST validation, generic responses, no-store/no-referrer, and rate limits.
8. **Harden diagnostics and audits.** Structured operational errors, normalized provider results, channel-audit sanitation, and direct-sink inventory.
9. **Preserve and harden OG cache.** Retain digest identity; add no-follow/atomic cache behavior and focused hostile-local-entry tests.
10. **Add recurrence gates.** Register the focused deterministic scanner and negative fixtures in both existing owners.
11. **Run full verification.** Disposable database migration/bootstrap/idempotency; auth-action integration/concurrency tests; static, integration, server-required, typecheck, build, artifact, managed scan, grep, and diff gates.
12. **Close operations evidence.** Attach safe proof of rotation/session invalidation, history disposition, managed rescan, and exact reviewed SHA before the final verdict.

## 7. Required Test Matrix

### Credential authority

- issue/consume for every purpose;
- wrong-purpose and cross-subject denial;
- expiry, revocation, first replay, repeated replay;
- two simultaneous consumes: exactly one success;
- transaction failure after claim: no consumed token and no partial password state;
- partner row and linked auth user update atomically;
- password reset invalidates all sessions;
- merchant activation establishes a session only after commit;
- legacy query tokens fail generically and reissue guidance works;
- partner-org invite/reset uses no temporary password.

### Transport and privacy

- email links contain no query-string credential;
- the client removes fragment state before any network/analytics/error activity;
- token endpoints send `no-store` and `no-referrer` policy;
- valid/invalid forgot responses do not reveal account existence;
- validation reveals no identity fields;
- captured logs contain no raw token, URL, recipient, account identity, request/provider body, SQL detail, or whole error;
- correlation ID, route, method, status, safe class, and reason code remain.

### Delivery

- SMTP success;
- definite SMTP/GHL denial;
- provider timeout/ambiguous result;
- no provider configured;
- repeated and concurrent issue requests;
- failure cleanup affects only the matching token generation;
- no real provider is constructed.

### Structured audit

- nested sensitive keys and error strings;
- channel checklist/preview audit contains only approved aggregate fields;
- direct audit inserts cannot bypass sanitation;
- `communication_events` content exemption remains unchanged.

### OG cache

- raw and encoded separators, absolute paths, dot segments, nulls, long input, hostile XML, and unsupported template;
- injected digest collision behavior;
- concurrent writers/readers;
- symlink/hard-link/non-regular cache entry where platform-supported;
- no external file read/write and one generic client failure envelope.

### Authorization

- anonymous-only public token routes;
- authenticated-session presence does not change token authority;
- admin/manager resend permissions remain unchanged;
- cross-role token use fails generically;
- partner-org reset remains admin-only and object-bound.

## 8. Required Gates

Run and report exact command, exit code, and result:

- focused RVR-03 static scanner and negative fixtures;
- focused auth-action disposable integration/concurrency suite;
- focused public HTTP contract suite with synthetic transports;
- focused operational log-capture and channel-audit sanitation suite;
- focused OG cache suite;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- `npx tsx scripts/check-migration-integrity.ts`;
- empty disposable migration bootstrap and idempotent rerun through the new head;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-static`;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-integration`;
- provider-denied server plus `server-required` capability;
- `npx tsx scripts/check-route-guards.ts`;
- `npx tsx scripts/check-api-coverage.ts`;
- `npm run check` or the repository's exact TypeScript command with required heap configuration;
- `npm run build`;
- `npx tsx scripts/scan-build-artifacts.ts`;
- current managed SAST and privacy scans;
- `git diff --check`;
- final status/stat/full diff and tracked/generated/secret review.

The executor must not replace a failing command with a different command merely to report green. Environment-specific execution workarounds must be disclosed and the canonical CI command must still pass in CI.

## 9. Audit-Time Gate Results

No application source was changed during this audit.

| Command | Exit | Result |
|---|---:|---|
| `npm ci --ignore-scripts --no-audit --fund=false` | 0 | Portable lockfile installation succeeded; 845 packages installed. |
| `node scripts/ci-suite-manifest.ts --check` using the primary runtime | 0 | 73 suites classified; manifest and pre-deploy registry agree. |
| `node scripts/check-migration-integrity.ts` using the primary runtime | 0 | 388 checks passed; two documented historical duplicate-timestamp warnings. |
| `node scripts/test-cro01-revenue-contract-static.ts` using the primary runtime | 0 | 45 assertions passed. |
| `node --import tsx scripts/check-cro02-authority.ts` | 0 | 103 structural checks passed. |
| `node --import tsx scripts/test-audit-sanitizer-merchant.ts` | 0 | 32 assertions passed. |
| `node --import tsx scripts/test-security-controls.ts` | 0 | CSP/CORS/JSON-LD controls passed. |
| `node --import tsx scripts/check-route-guards.ts` | 0 | Assertions passed; pre-existing stale-route warnings remain. |
| `node --import tsx scripts/check-api-coverage.ts` | 0 | No new unmatched client API path; 16 documented pre-existing unmatched paths. |
| `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit --incremental false` | 0 | TypeScript passed. A first 2 GB attempt exited 134 for heap exhaustion; this was not a type error. |
| `NODE_OPTIONS=--max-old-space-size=4096 node --import tsx script/build.ts` | 0 | Production client and server build passed after materializing tracked assets omitted by sparse checkout. |
| `node --import tsx scripts/scan-build-artifacts.ts` | 0 | No credential pattern found in production artifacts. |
| `node --import tsx scripts/scan-tracked-files.ts` | 1 | **Real baseline failure:** eight prohibited tracked generated-text artifacts. |
| `npx tsx scripts/run-ci-suites.ts --capability deterministic-static` | 1 in this executor | Local `tsx` CLI could not create its IPC socket (`EPERM`). Direct suite execution worked; canonical GitHub CI still must run. Independently, the tracked-file suite would fail on current `main`. |
| `git diff --check` | 0 | Clean. |
| `git status --short` | 0 / empty | Audit worktree clean. |

## 10. Kill Lines — Corrected

- **STOP** if the known credential mapping or fixed administrative password is printed, attached, or copied into a task response.
- **STOP** if Task #1703 calls the historical password high false without credential rotation/session proof and a history disposition.
- **STOP** if an applied migration or shared Git history is rewritten without explicit owner approval and coordinated clone/deploy rollback.
- **STOP** if any password, verification, merchant activation, partner reset/invite, or partner-org credential flow bypasses the canonical purpose-bound authority.
- **STOP** if a token can succeed for the wrong purpose or if two concurrent consumers can both change credential state.
- **STOP** if any new auth action uses a query-string bearer credential or returns unnecessary identity.
- **STOP** if a public/client error or operational log includes a raw token, credential URL, recipient, identity, provider body, SQL detail, request body, stack, or whole error.
- **STOP** if `channel_audit_log` retains preview PII or direct `audit_logs` inserts bypass sanitation.
- **STOP** if the OG route is described as an HTTP traversal vulnerability without a current data flow, or if local symlink/concurrency criteria remain untested.
- **STOP** if the focused scanner can silently skip, uses blanket suppressions, or is registered in only one suite owner.
- **STOP** if the eight-file RVR-01 gate failure is ignored or folded into RVR-03 through unrelated deletion.
- **STOP** if a live email/provider call, production database mutation, production credential operation, deployment, or history rewrite is performed by the build task.

## 11. Final VFC Table for the Build

| ID | Requirement | Required evidence | Status now |
|---|---|---|---|
| RVR03-F01 | Exact current scanner/rule disposition | SHA-bound managed artifact and callsite matrix | FAIL |
| RVR03-F02 | Known credential exposure contained | code guard + rotation/session + history evidence | FAIL |
| RVR03-F03 | One purpose-bound auth-action authority | schema/service/route inventory | FAIL |
| RVR03-F04 | Atomic single-use/replay semantics | concurrent disposable DB tests | FAIL |
| RVR03-F05 | No query-string auth bearer values or identity validation output | email/client/API tests and grep | FAIL |
| RVR03-F06 | No plaintext partner-org temporary credentials | route/service tests | FAIL |
| RVR03-F07 | Privacy-safe operational diagnostics | captured-log negative tests and safe correlation proof | FAIL |
| RVR03-F08 | Structured audit boundaries complete | sink inventory and channel-audit tests | FAIL |
| RVR03-F09 | OG traversal correctly dispositioned and local cache safe | data-flow proof and hostile cache tests | PARTIAL |
| RVR03-F10 | Required recurrence gate cannot skip | negative fixtures + manifest/pre-deploy/CI | FAIL |
| RVR03-F11 | Current required-suite baseline green | full capability gates, including tracked-file scan | FAIL |
| RVR03-F12 | No external/production mutation by build | diff/search/provider-denial evidence | PASS for audit only |

## 12. Final Status

**CURRENT PLAN STATUS: DO NOT SEND TO BUILD UNCHANGED.**

**CORRECTED EXECUTION STATUS:** The source-remediation branch may begin after this report is appended as the controlling addendum, the next migration is serialized, and the separate RVR-01 gate regression has an owner. Task #1703 must not be marked complete or merged until the known credential incident has rotation/session and repository-history evidence and the current managed security scans are dispositioned.

No production data, credentials, sessions, providers, email, deployment, remote history, or live logs were changed or inspected during this audit.

## 13. Send-Ready Controlling Directive

Append the following to Task #1703:

> **CONTROLLING RVR-03 CORRECTION — supersedes conflicting task text.** Rebase to current `origin/main` and the current migration/suite heads. Do not classify the historical password SAST finding as false: current source contains a fixed known administrator credential mapping in applied migration history and a hard-coded administrative reset utility. Do not reproduce the values. Remove/hard-disable the utility, add a deterministic credential-source guard, and require security-owner credential rotation/session invalidation plus repository-owner history containment evidence. Do not edit applied history or rewrite shared refs without explicit approval.
>
> Replace the fragmented user reset/verification, merchant activation, partner reset/invite, and partner-organization temporary-password flows with one additive, purpose-bound, hashed, durable auth-action authority. Consumption must be atomic in the same transaction as the credential state change, exactly one concurrent consumer may succeed, wrong-purpose use must fail generically, password resets must invalidate sessions, and partner plus linked-auth updates must be atomic. Eliminate plaintext temporary passwords and `Math.random()` credential generation.
>
> New action links must carry the bearer value only in a URL fragment; clients must capture and immediately scrub it before network/analytics/error work, then submit it in a rate-limited POST body. Return no public identity from validation and set no-store/no-referrer policy. Invalidate legacy query tokens and require reset/resend rather than indefinitely supporting the leaking format.
>
> Replace whole-error/raw-provider/recipient/token-URL logging in the scoped families with one structured safe diagnostic boundary. Correlation ID must be created before logging; retain only route/method/status, safe class/reason, and bounded non-PII context. Sanitize `channel_audit_log` at its storage boundary and persist aggregate preview evidence only. Inventory every direct audit insert.
>
> Preserve the OG digest-derived architecture. Disposition ordinary HTTP traversal as non-reachable, while adding no-follow regular-file reads, exclusive temporary writes plus atomic rename, generic public errors, and hostile local-entry/concurrency tests. Add one focused deterministic credential/privacy scanner with negative fixtures to both the manifest and pre-deploy registry. Obtain a SHA-bound managed SAST/privacy rerun; do not convert repository tests into a claim that managed findings are zero.
>
> Current `main` has 73 suites and the tracked-file exposure suite presently fails on eight prohibited artifacts. RVR-01 owns that separate regression; RVR-03 must not suppress it or claim a green baseline. No live provider/email, production database/session/credential mutation, deployment, or history rewrite is authorized by the build task.
