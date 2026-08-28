# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

Verify the August 27 SAST/privacy claims against current remote `main`, recapture the exact scanner rules and findings without exposing sensitive content, and implement every safe current-code repair in the same run. Do not treat a scanner count as a verified vulnerability, dismiss findings without surrounding-code inspection, print secrets or identities, edit applied migration history casually, or perform unrelated security redesign.

Required sequence:

Repository baseline → certification lineage → VFC → scanner/findings inventory → exploitability and data-flow review → root cause → canonical redaction/error ownership → blast radius → data/auth/concurrency/external checks → verdict → corrected plan → kill lines → implementation → focused negative tests → full gates → post-build searches → diff review → final VFC → merge verdict.

**Absolute audit rule:** A confirmed P0/high finding makes the task non-mergeable but does not end the audit. Continue until every SAST/privacy finding in the affected scope is classified P0/P1/P2 with exact code reality, fix, regression test, and external owner action.

## 1. TASK IDENTITY

**RVR-03 — SAST, Privacy, Path-Safety, and Logging Remediation**

**Historical evidence:** August 27 certification reported eight SAST findings including two high findings, plus 93 privacy findings described as primarily logging-oriented. The high categories were described as historical password-reset migration content and Open Graph path handling. Those are claims to re-verify, not automatic defects.

**Runtime support:** release/security readiness under VG-01 and `RV-CI-01`; this task does not close production runtime rows.

**Parallelism:** Begin with read-only preflight beside CRO-01. Implement in parallel only after producing an exact changed-file map proving no overlap with CRO-owned routes/services/tests. Do not touch contacts, prospects, deals, campaigns, sequences, revenue counts, providers, or migrations used by an active task.

## 2. WHAT & WHY

High-severity scanner findings and privacy/logging findings can represent real token exposure, path traversal, identifier leakage, or merely historical/schema names and safe structured metadata. Liberty needs evidence-backed remediation: reject unsafe paths at the boundary, remove sensitive values from logs/errors/audits, preserve useful correlation fields, and prevent recurrence with required scanners and regression tests.

## 3. BASELINE

Drafting baseline to independently recapture:

- `origin/main`: `c5d0baa8c697778caccaed4dba74e456c9a07063`.
- Migration head: `0165_outbound_send_claim_lease`; migration expected: NO by default.
- Certification artifacts were added by `0e947faac9f7cd6aafbd634366e38e2dcd912f25` and tested `78ae07e8…`.
- Current code includes `server/routes/og.ts`, password-reset routes/storage, redaction/error utilities, application logging, SAST/security scripts, and applied migration/snapshot history.
- The historical counts may have changed after later commits and scans must be rerun.

Capture branch/HEAD/remote, clean-tree status, migration head, scanner versions/configuration, exact current counts by severity/category, and hashes of machine-readable scan artifacts. Never include matched secret/PII text in the report.

## 4. VERIFIED FROM CODE — PREFLIGHT

| ID | Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Two current high SAST findings remain | CONFIRMED/PARTIAL/FALSE/OUTDATED | Exact rules, current files, reachability | redacted scanner + `file:line` |
| VFC-02 | Password-reset finding exposes sensitive material | CONFIRMED/PARTIAL/FALSE/OUTDATED | Schema-name false positive, example credential, token, or real secret | metadata/redacted evidence |
| VFC-03 | OG route permits unsafe filesystem path resolution | CONFIRMED/PARTIAL/FALSE/OUTDATED | Input-to-path data flow, canonicalization, containment | `server/routes/og.ts` |
| VFC-04 | Privacy findings emit identifiers/content | CONFIRMED/PARTIAL/FALSE/OUTDATED | Logging callsites and runtime reachability | `file:line` |
| VFC-05 | Canonical redaction/error helpers cover affected sinks | CONFIRMED/PARTIAL/FALSE/OUTDATED | Existing owner and bypass list | `file:line` |
| VFC-06 | Security/privacy scans are required and fail closed | CONFIRMED/PARTIAL/FALSE/OUTDATED | CI/pre-deploy behavior | workflow/gate evidence |

For every P0/P1 finding, inspect caller, trust boundary, normalization, storage, log sink, environment, and downstream consumer. Continue auditing after the first blocker until the full affected scope is closed.

## 5. REQUIRED SEARCHES

Inspect at minimum:

- SAST/privacy/security workflow definitions, configurations, suppressions, baselines, and artifact retention;
- password-reset token creation, hashing, URL generation, email dispatch, audit events, errors, development logs, schema/migration history, and example credentials;
- Open Graph route parameters, decoded path segments, cache filenames, filesystem joins/resolves, traversal/symlink behavior, MIME/size controls, cache writes, and response headers;
- logging of emails, phones, names, contact/deal IDs, statement/provider content, raw request bodies, headers, tokens, SQL errors, stack traces, and URLs containing secrets;
- canonical `server-error`, redaction, structured-audit, and correlation-ID utilities;
- scanner allowlists/suppressions and whether surrounding code—not comments alone—proves safety.

Search output must be limited to paths, line numbers, rule IDs, reason codes, and safe structural snippets. Never reproduce matched credentials, reset tokens, PII, or payloads.

## 6. ROOT CAUSE AND SOURCE OF TRUTH

Determine separately whether each finding comes from:

1. Unsafe current runtime behavior.
2. Sensitive example/history content that requires repository/security handling.
3. Over-broad logging that bypasses canonical redaction.
4. A scanner false positive requiring a narrow evidence-backed suppression.
5. Missing required enforcement in CI.

Extend current path validation, server error, log redaction, audit, authentication, and security-scan owners. Do not create a second logger/redactor or duplicate password-reset authority.

Applied migration history is immutable by default. If a real secret exists in reachable history, rotate/revoke first through the authorized owner and prepare a separate coordinated history-cleanup operation; do not silently edit an applied SQL file and claim the history is clean.

## 7. BLAST RADIUS

### In scope

- Current reachable high SAST repairs.
- OG/cache path canonicalization and containment, if confirmed.
- Password-reset log/error/audit and example-content remediation, if confirmed.
- Routing unsafe logs/errors through existing redaction/correlation owners.
- Narrow scanner rule/suppression corrections with regression tests.
- Required security/privacy gate enforcement.

### Out of scope

- Broad logging framework replacement.
- Editing unrelated historical migrations, schema redesign, credential rotation without authority, remote-history rewrite, production token inspection, or production session mutation.
- CRM, campaign, sequence, enrichment, provider, analytics, or UI redesign.
- Fixing every low informational scanner match without realistic risk.

Expected files must be identified after VFC; likely areas include `server/routes/og.ts`, current auth/password-reset owners, `server/utils/server-error.ts`, existing redaction utilities, security tests, and CI/pre-deploy scan configuration.

## 8. DATA, AUTHORIZATION, CONCURRENCY, AND EXTERNAL EFFECTS

**Migration required: NO by default.** Stop and explain before any schema/migration proposal.

Security code may be changed by developers; credential rotation, history rewrite, production log deletion, provider configuration, and deployment require separate owner authorization. Do not fetch live secrets/logs merely to prove a test.

Path/cache code must be safe under simultaneous requests, canonicalize before authorization/write, resist encoded traversal and symlink escape, use collision-safe cache identity, and never write outside the approved cache root. Reset flows must remain single-use/expiring/idempotent and must not leak account existence or token material on concurrent/replayed requests.

## 9. PREFLIGHT VERDICT

Use one Liberty verdict. If findings are false/obsolete, return `NOT NEW TASK` or `WATCH` with rule-level proof. If safe repairs remain, implement them immediately. A confirmed secret in history or required credential rotation blocks only that external portion; complete independent current-code containment.

## 10. CORRECTED BUILD PLAN

1. Recapture exact scanner versions, current counts, and affected paths.
2. Build a P0/P1/P2 disposition matrix with reachability and data-flow proof.
3. Repair confirmed OG/path issues through existing validation/cache ownership.
4. Repair confirmed reset-token/example/log issues without exposing values or weakening reset behavior.
5. Route unsafe errors/logs through canonical redaction and correlation helpers.
6. Add narrow scanner suppressions only for proven false positives, with reason/owner/expiry.
7. Add negative boundary, replay, encoding, symlink/path, and redaction tests.
8. Enforce the scans in required gates and retain redacted machine-readable artifacts.
9. Re-run full security, typecheck/build, auth, route, and regression gates.

## 11. DONE LOOKS LIKE

- Every current high finding is fixed or proven false/non-reachable with reviewable evidence.
- OG/cache paths cannot escape their approved root through raw, encoded, absolute, separator, dot-segment, or symlink input.
- Reset tokens, temporary credentials, identities, request bodies, provider errors, and SQL details do not enter logs/client errors.
- Safe correlation IDs, reason codes, route/method/status, and redacted error classes remain available.
- Required scans fail on synthetic reintroductions and do not silently skip.
- No production secrets/data/history/deployment was mutated.

## 12. KILL LINES

- **KILL LINE:** Any confirmed reachable high SAST finding left unfixed or silently suppressed makes the task `DO NOT MERGE`.
- STOP if secrets, tokens, reset URLs, credentials, PII, statement/provider content, or raw matched scanner output is printed or committed.
- STOP if path validation occurs after filesystem access or relies on string-prefix checks without canonical containment.
- STOP if an applied migration is rewritten as a substitute for rotation/history response.
- STOP if logging is simply deleted where operational correlation is safety-critical; preserve redacted structured evidence.
- STOP if tests weaken authentication, CSRF, rate limits, token expiry, or account-enumeration protection.

## 13. TESTS AND GATES

Tests must cover normal and malicious path inputs, percent/double encoding, platform separators, absolute paths, `..`, null bytes, long names, cache collision, symlink escape where supported, concurrent cache requests, invalid/replayed/expired reset tokens, account enumeration, log capture with synthetic secrets/PII, safe correlation fields, scanner false positives, and synthetic recurrence.

Run actual focused tests plus current SAST/privacy/security scans, auth/security controls, route guards, CSRF checks, deterministic-static suites, `npm run check`, `npm run build`, build-artifact scan, and `git diff --check`. Report exact commands/exits and redacted counts.

## 14. POST-BUILD SEARCH AND DIFF REVIEW

Prove no affected raw log/error bypass remains, no unsafe path join/write remains, no secret-like example was introduced, no broad suppression was added, and no CRM/provider/schema scope leaked in. Review status/stat/full diff and scan the diff safely for secrets and PII.

## 15. FINAL VFC AND RESPONSE

| ID | Requirement | Evidence | Test/Gate | Status |
|---|---|---|---|---|
| VFC-F01 | High SAST findings closed/dispositioned | rule/file matrix | SAST rerun | PASS/FAIL |
| VFC-F02 | Path/cache containment | implementation | malicious-path suite | PASS/FAIL |
| VFC-F03 | Reset/privacy data redacted | canonical logger/error | log-capture suite | PASS/FAIL |
| VFC-F04 | Scans required/fail closed | workflow | negative fixture | PASS/FAIL |
| VFC-F05 | No external/destructive mutation | diff/evidence | review | PASS/FAIL |

Return the full Liberty final format: verdict, repository state, root cause/corrections, P0/P1/P2 matrix, implementation `file:line`, tests/gates, grep evidence, kill lines, runtime versus pending operations, remaining risks, and merge status. Never deploy or rotate/rewrite without explicit authorization.

## 16. RELEVANT FILES

- `server/routes/og.ts`
- `server/replit_integrations/auth/replitAuth.ts`
- `server/routes/partners.ts`
- `server/routes/partner-orgs.ts`
- `server/storage/partners.ts`
- `server/utils/server-error.ts`
- current logging/redaction/audit utilities discovered in preflight
- `migrations/0109_fearless_starhawk.sql` and metadata for inspection only
- `scripts/test-security-controls.ts`
- security/privacy/SAST workflows and scan configs
- `docs/VG_RUNTIME_EVIDENCE_PACKET_78ae07e8_2026-08-27.md`

## FINAL DIRECTIVE

Re-run and verify the findings, close the entire reachable high-risk scope, retain useful redacted diagnostics, and separate current-code repair from any owner-controlled credential/history operation.
