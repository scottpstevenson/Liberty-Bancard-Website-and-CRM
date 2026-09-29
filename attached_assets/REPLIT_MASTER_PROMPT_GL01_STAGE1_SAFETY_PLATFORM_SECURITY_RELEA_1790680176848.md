# LIBERTY BANCARD - PREFLIGHT + BUILD MODE

## GL-01 - Stage 1 Safety, Platform, Security & Release Repairs

**Mode:** PREFLIGHT + BUILD  
**Priority:** P0/P1 go-live closure  
**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Verified audit baseline:** `main` at `8bf8318762963eb2298aad386b136c7361de54e0` on 2026-09-28  
**Verified migration journal at audit baseline:** 312 entries, current high-water mark `0307_serper_canonical_control_reconciliation`  
**Build boundary:** code/repository only. Do not publish, deploy, freeze the final release SHA, mutate production data, rotate secrets, change provider controls, send outreach, call paid providers, or alter GitHub repository settings in this task.

This is one owning task. Do not split the confirmed findings into follow-up tasks. If a materially false finding is proven during preflight, record it in the VFC table and remove only that correction from the build. Continue with the remaining verified scope.

---

## MODE

PREFLIGHT + BUILD. Verify this task against the current repository first, correct stale assumptions, then implement the smallest safe fix set in the same run.

Do not blindly trust the audit SHA or line numbers if `main` has moved. Re-pin before editing. The file/line references below are exact evidence from `8bf8318762963eb2298aad386b136c7361de54e0`; if current `main` differs, update the VFC evidence before implementation.

Required sequence:

baseline -> VFC -> greps -> root cause -> ownership -> blast radius -> auth/session checks -> CI/install checks -> provider-denial checks -> verdict -> corrected build plan -> build -> tests/gates -> post-build greps -> diff -> final VFC -> merge verdict.

No planning-only loop. Continue immediately when the verdict is BUILD-READY or BUILD-READY WITH CORRECTIONS.

---

## 1. REPOSITORY BASELINE

Before mutation, capture and report:

- current branch;
- exact HEAD SHA;
- `origin/main` SHA;
- working-tree status;
- migration journal count and high-water mark;
- Node/npm versions used for verification;
- latest GitHub Actions CI result for the pinned SHA if accessible;
- any unrelated local changes, which must be preserved untouched.

Audit evidence at `8bf83187...`:

- branch: `main`;
- migration journal count: 312;
- migration head: `0307_serper_canonical_control_reconciliation`;
- GitHub Actions CI run `#317`, run id `36484550297`, failed in `Static Checks` during dependency installation before the deterministic static suites or integration job could run.

Do not claim the current baseline is identical until rechecked.

---

## 2. VERIFIED FROM CURRENT CODE - PREFLIGHT FINDINGS

Produce this VFC table before editing and update the evidence if line numbers moved.

| ID | Audit claim | Audit-baseline evidence | Required preflight verdict |
|---|---|---|---|
| SEC-01 | Authenticated non-dashboard users can reach the internal proposal-read route because it uses only `isAuthenticated`. | `server/routes/ai.ts:954-962`; `server/services/crm-object-access.ts:100-114`; `server/replit_integrations/auth/replitAuth.ts:1003-1011` | CONFIRMED / FALSE / OUTDATED |
| SEC-02 | Session validity fails open when the backing validity lookup throws. | `server/replit_integrations/auth/replitAuth.ts:894-937`; middleware consumers begin at `:941` and `:1003` | CONFIRMED / FALSE / OUTDATED |
| REL-01 | GitHub CI cannot perform a clean install because `package-lock.json` contains Replit-internal tarball URLs. | `.github/workflows/ci.yml:31-32,120-121`; `package-lock.json:5645,11132,11159,11166,11191,11200`; CI run #317 failed with `ENOTFOUND package-firewall.replit.internal` | CONFIRMED / FALSE / OUTDATED |
| REL-02 | `run-pre-deploy.sh` says it starts with provider denial, but the server launch only establishes GHL fail-fast and inherits the rest of the process environment. | `scripts/run-pre-deploy.sh:79-82`; `scripts/pre-deploy.ts:909-916`; provider-deny behavior in `server/index.ts:436-445,532-534,596-598,667-685` | CONFIRMED / FALSE / OUTDATED |
| ADS-01 | Offline conversion export is readable by all dashboard roles, including ordinary agents, and exports email plus click/conversion attribution data. | `server/routes/acquisition.ts:379-445`; dashboard role definition `server/replit_integrations/auth/replitAuth.ts:1003-1011` | CONFIRMED / FALSE / OUTDATED |
| CFG-01 | Checked-in runtime defaults still arm legacy discovery/outreach/orchestrator flags even though the selective worker profile excludes generic outreach. | `.replit:131-145,153` | CONFIRMED / ACCEPTED INTENTIONAL / OUTDATED |

Important: a route existing behind another global middleware is not enough to dismiss SEC-01. Prove the actual role matrix. At the audit baseline, `crmObjectAccessGuard` only performs object scoping for `agent`; non-agent roles return through at `server/services/crm-object-access.ts:100-114`, while `isDashboardUser` is the canonical dashboard-role boundary at `replitAuth.ts:1003-1011`.

---

## 3. REQUIRED SEARCH / GREP CHECKS

Before editing, locate every relevant current owner and bypass.

Search at minimum for:

- `/api/deals/:id/proposal` and every proposal read/edit/send/public-token route;
- `isAuthenticated`, `isDashboardUser`, `requireRole`, `isPartner`, merchant guards, and every use of `checkSessionValidity`;
- `crmObjectAccessGuard`, `authorizeDealAccess`, direct `storage.getDeal()` readers and any indirect deal IDs;
- `/api/acquisition/offline-conversions/export` and every CSV/export route containing contact email, phone, GCLID, conversion data, or other first-party identifiers;
- `package-firewall.replit.internal`, private npm registries, `resolved` package-lock URLs, `.npmrc`, npm registry overrides, install wrappers and cache configuration;
- `run-pre-deploy.sh`, `pre-deploy.ts`, CI suite manifests, certification environment scrubbers, provider-deny helpers and all provider transport fail-fast flags;
- `VG_PROVIDER_DENY_MODE`, `GHL_TRANSPORT_FAILFAST`, `EMAIL_TRANSPORT_FAILFAST`, `SMS_TRANSPORT_FAILFAST`, `CRO03_PROVIDER_TRANSPORT_ENABLED`, provider API key env names, `SERPER_GATEWAY_ENABLED`, `SUNBIZ_ENRICHMENT_ENABLED`;
- `LEGACY_OUTREACH_ENABLED`, `ORCHESTRATOR_ENABLED`, `NIGHTLY_DISCOVERY_ENABLED`, `BACKGROUND_JOB_PROFILE` and queue/profile consumers;
- existing role-guard, auth, security-control, pre-deploy, certification provider-deny and CI lockfile tests.

A grep hit is not proof. Inspect the implementation and actual registration order.

---

## 4. VERIFIED ROOT CAUSES TO PROVE OR CORRECT

### SEC-01 - Proposal read boundary drift

Audit-baseline reality:

- `server/routes/ai.ts:954-962` registers `GET /api/deals/:id/proposal` with `isAuthenticated` only.
- `server/routes.ts:127-130` installs `crmObjectAccessGuard` globally before route registration.
- `server/services/crm-object-access.ts:100-114` only scopes users whose role is exactly `agent`; non-agent authenticated roles pass through.
- `server/replit_integrations/auth/replitAuth.ts:1003-1011` is the canonical dashboard boundary for `admin`, `manager`, and `agent`.

Required correction: the internal proposal read must require a dashboard role and must preserve object-level authorization for agents. Do not rely on accidental middleware ordering as the only authorization proof.

### SEC-02 - Fail-open session-validity authority

Audit-baseline reality:

- `checkSessionValidity()` begins at `replitAuth.ts:894`.
- its exception path at `:934-937` logs `session_validation_failed` and returns `null` with the explicit comment `fail open`;
- `isAuthenticated`, `isDashboardUser`, `requireRole` and related guards treat `null` as valid and continue.

Required correction: inability to verify revocation/expiry must not authorize the request. An infrastructure/lookup failure is not the same thing as a proven expired session, so do not destroy a legitimate session merely because the authority is temporarily unavailable. Return a fail-closed unavailable response and preserve the session for retry unless invalidation/expiry was actually proven.

### REL-01 - Non-portable dependency lock

Audit-baseline reality:

- CI executes `npm ci --include=dev --ignore-scripts --no-audit --no-fund` at `.github/workflows/ci.yml:31-32` and again at `:120-121`;
- six lockfile `resolved` fields point to `http://package-firewall.replit.internal/...` at the exact lines listed in the VFC table;
- GitHub Actions run #317 failed on `pg-protocol` with `getaddrinfo ENOTFOUND package-firewall.replit.internal`, causing all later static gates and the integration job to be skipped.

Required correction: produce a portable lockfile that installs from the approved public registry in a clean external runner. Do not solve this by deleting the lockfile, using `npm install` in CI, disabling lock integrity, or weakening `npm ci`.

### REL-02 - Claimed provider denial is narrower than the launched server boundary

Audit-baseline reality:

- `run-pre-deploy.sh:81` prints `Starting dev server with provider denial`;
- `:82` starts the server with only `GHL_TRANSPORT_FAILFAST=true STATEMENT_COMMAND_TEST_STORAGE=true npm run dev`;
- suite processes in `pre-deploy.ts:909-916` inherit `process.env` plus suite overrides;
- the repository already has canonical certification environment/provider-deny helpers and `VG_PROVIDER_DENY_MODE=1` semantics;
- `server/index.ts` explicitly disables BullMQ workers, GHL workflow hydration, daily maintenance and content scheduling in certification deny mode.

Required correction: the pre-deploy server and descendant certification processes must run inside the repository's real zero-egress/test boundary, not merely a GHL-only boundary.

### ADS-01 - Excessive export role

Audit-baseline reality:

- `server/routes/acquisition.ts:379` uses `isDashboardUser` for the offline conversion export;
- the returned data includes `contact_email` and `gclid` at `:387-445`;
- `isDashboardUser` includes ordinary `agent` users.

Required correction: restrict bulk offline-conversion export to the smallest existing privileged role set that already owns reporting/export administration. Expected default is `requireRole("admin", "manager")` unless preflight proves a narrower canonical export capability already exists.

### CFG-01 - Armed legacy defaults

Audit-baseline reality:

- `.replit:133-134` has `NIGHTLY_DISCOVERY_ENABLED="true"` and `LEGACY_OUTREACH_ENABLED="true"`;
- `.replit:144` has `ORCHESTRATOR_ENABLED="true"`;
- `.replit:153` uses a selective enrichment/staging profile that does not include the generic outreach capability.

Required correction: verify whether any current required non-outreach feature still depends on these legacy flags. If not, checked-in defaults must be safe-off. Do not disable the current canonical enrichment capabilities or the selective profile merely to close this finding.

---

## 5. SOURCE-OF-TRUTH CHECK

Identify and preserve the existing canonical owners:

- dashboard role authority: `server/replit_integrations/auth/replitAuth.ts`;
- deal/contact object scope: `server/services/crm-object-access.ts`;
- proposal route owner: `server/routes/ai.ts`;
- acquisition export owner: `server/routes/acquisition.ts`;
- CI workflow owner: `.github/workflows/ci.yml` plus the existing CI suite manifest/runners;
- provider-denial/certification environment owners: existing `scripts/certification-*`, provider-deny helpers, pre-deploy wrapper, and test-infrastructure guards;
- background capability ownership: `server/services/background-profile.ts`, `server/services/queue-manager.ts`, `.replit` only for checked-in defaults.

Do not create a second auth/session system, a second role vocabulary, a second provider-deny flag, or a second background profile system.

---

## 6. BLAST RADIUS

### In scope

- internal proposal read authorization;
- session revocation/expiry validation failure behavior;
- clean-runner package-lock portability and CI install reliability;
- zero-egress pre-deploy server/certification boundary;
- offline-conversion export authorization;
- safe checked-in defaults for legacy outreach/orchestrator/discovery flags if current code proves they are not required;
- focused tests and CI/pre-deploy registration needed to prevent regression.

### Out of scope

- publishing/deploying the application;
- freezing the final release SHA;
- production database writes or backfills;
- production session invalidation;
- changing Google Ads accounts or importing conversions;
- enabling/disabling live paid providers in production;
- rotating secrets or printing secret values;
- changing GitHub repository visibility, branch protection or rulesets;
- redesigning the CRM role model;
- unrelated enrichment/campaign fixes;
- Stage 2 public website/forms/consent/content work.

---

## 7. AUTHORIZATION REPAIR - SEC-01

Implement the smallest current-pattern fix.

Required behavior matrix for `GET /api/deals/:id/proposal`:

| Actor | Expected behavior |
|---|---|
| anonymous | 401 |
| merchant | denied; no internal proposal JSON |
| partner | denied by the existing partner boundary; no internal proposal JSON |
| agent assigned/authorized for the deal | 200 when proposal exists |
| agent not authorized for the deal | 404-style object denial, matching existing CRM object policy |
| manager | 200 when proposal exists |
| admin | 200 when proposal exists |

Use the existing role and object-access helpers. Expected shape is a dashboard-role guard plus explicit deal authorization or an equivalent current canonical helper that proves the same matrix. Do not expose whether an unauthorized deal exists.

Audit sibling proposal routes so the fix does not leave an equivalent read bypass at another path.

---

## 8. SESSION VALIDITY FAIL-CLOSED REPAIR - SEC-02

Refactor the session-validity result so it can distinguish at least:

- valid;
- expired;
- invalidated;
- validation authority unavailable/error.

Required behavior:

1. anonymous requests remain 401;
2. proven expired/invalidated sessions remain 401 and may be cleared/destroyed as currently appropriate;
3. if `authStorage.getUserSession()` or the validity authority throws, protected middleware MUST NOT call `next()`;
4. authority-unavailable should return a stable 503-class response such as `SESSION_VALIDATION_UNAVAILABLE` without leaking internal exception data;
5. do not destroy the browser session on an authority outage unless invalidity was actually proven;
6. the same rule must apply consistently to every guard that calls `checkSessionValidity`, including `isAuthenticated`, dashboard role guards, partner/merchant guards and `requireRole` equivalents;
7. diagnostics must remain redacted and useful.

Do not weaken Passport authentication or remove durable session invalidation.

---

## 9. CI / LOCKFILE PORTABILITY REPAIR - REL-01

The lockfile must be usable from GitHub-hosted runners and ordinary clean clones.

Required implementation:

- determine why the six packages were locked to `package-firewall.replit.internal`;
- regenerate or minimally normalize `package-lock.json` using the approved public npm registry while preserving dependency versions and integrity where possible;
- do not perform opportunistic dependency upgrades;
- prove no `package-firewall.replit.internal` or other private Replit package host remains in the committed lockfile unless a package is intentionally private and the CI has an explicit supported credentialed registry contract - none was observed in the audit;
- preserve `npm ci` in CI;
- add or extend a deterministic static check so future private/internal `resolved` URLs fail before merge;
- preserve existing dependency-policy/toolchain checks.

Required proof:

- clean dependency install succeeds outside Replit;
- the CI `Static Checks` job gets past `Install dependencies`;
- deterministic static suites and build scan actually execute rather than being skipped;
- integration job is no longer skipped solely because static install failed.

Do not claim CI green if only a local Replit install works.

---

## 10. PRE-DEPLOY ZERO-EGRESS REPAIR - REL-02

Use the existing certification isolation architecture.

The pre-deploy wrapper must establish an explicit test/zero-egress boundary before launching the server used by server-required suites. At minimum, verify and use the current canonical equivalents of:

- `NODE_ENV=test`;
- `VG_PROVIDER_DENY_MODE=1`;
- `GHL_TRANSPORT_FAILFAST=true`;
- `EMAIL_TRANSPORT_FAILFAST=true`;
- `SMS_TRANSPORT_FAILFAST=true`;
- `SUNBIZ_ENRICHMENT_ENABLED=false`;
- `SERPER_GATEWAY_ENABLED=false`;
- no inherited live provider credentials for the test server unless a test explicitly replaces them with controlled fake values;
- no inherited live provider transport authorization;
- disposable/test statement storage where required.

Prefer reusing `scripts/certification-process-env.ts`, `scripts/certification-provider-deny.ts`, `scripts/certification-provider-deny-preload.cjs`, or their current canonical successor instead of duplicating scrub logic in shell.

The server started by `run-pre-deploy.sh` must truthfully report the zero-egress/test posture through existing health evidence where available. Server-required suites must abort if that posture is not proven.

Keep specialized suites that intentionally set `CRO03_PROVIDER_TRANSPORT_ENABLED=true` for authority-path testing inside `VG_PROVIDER_DENY_MODE=1` with fake/scrubbed credentials; do not remove those tests merely because transport is logically enabled inside a denied certification environment.

---

## 11. OFFLINE CONVERSION EXPORT ACCESS - ADS-01

Restrict `GET /api/acquisition/offline-conversions/export` from ordinary agents.

Requirements:

- use an existing privileged role/capability; do not invent a new auth subsystem;
- default expected role matrix is admin + manager only unless preflight proves a narrower canonical export permission already exists;
- deny merchant, partner and agent users;
- preserve the existing bounded date range and row limit;
- preserve CSV escaping/format behavior;
- do not alter conversion taxonomy in this Stage 1 task;
- add role-guard regression coverage for both JSON/default and `?format=csv` behavior.

No Google Ads API call belongs in this task.

---

## 12. SAFE CHECKED-IN RUNTIME DEFAULTS - CFG-01

Verify current consumers of:

- `LEGACY_OUTREACH_ENABLED`;
- `ORCHESTRATOR_ENABLED`;
- `NIGHTLY_DISCOVERY_ENABLED`.

If current canonical enrichment/SFP operation does not require them, change the checked-in `.replit` defaults to safe-off while preserving:

- `FREE_ENRICHMENT_ENABLED=true` if still intentional;
- the current selective `BACKGROUND_JOB_PROFILE` capabilities needed for enrichment/backfill/classification/staging/discovery;
- all explicit database/provider/runtime gates that are already canonical.

Do not switch `BACKGROUND_JOB_PROFILE` to `full`.

Do not turn off `sfp-continuous-discovery` merely because the legacy `NIGHTLY_DISCOVERY_ENABLED` flag is disabled; verify their owners are separate first.

If any legacy flag is genuinely required by a current canonical path, leave it unchanged and document the exact owner/caller/test proving why. Do not mark CFG-01 closed merely because the selective profile currently masks the risk.

---

## 13. DATA / SCHEMA / MIGRATION CHECK

No schema migration is expected for these verified Stage 1 fixes.

Before adding any migration, prove an actual schema gap that cannot be fixed in existing code/config/tests. If a migration is unexpectedly required:

- re-pin the journal high-water mark;
- use the next valid migration;
- never edit a historical migration;
- never use `db push`;
- do not backfill production data in this task.

A lockfile change is expected for REL-01. A dependency-version change is not expected unless preflight proves it is unavoidable and directly related.

---

## 14. CONCURRENCY / FAILURE / RETRY CHECK

Verify the fixes under failure, not only the happy path.

Required cases:

- session validity DB/read failure while an otherwise authenticated session exists;
- session invalidated versus authority unavailable are distinguishable;
- concurrent requests during a temporary session-authority outage do not slip through;
- repeated proposal reads do not bypass ownership;
- CI clean install is deterministic on repeated `npm ci`;
- pre-deploy cleanup kills its test server even when a suite fails;
- pre-deploy failure cannot leave workers/providers armed;
- role-export denials do not leak data in error responses.

---

## 15. EXTERNAL SIDE-EFFECT CHECK

This task must be provider-denied.

No test may:

- send email/SMS/voice;
- enroll a sequence;
- call GHL live;
- call Serper, Apollo, Outscraper, ZeroBounce, OpenAI, processor or ad-provider live APIs;
- import Google Ads conversions;
- mutate production pause/provider controls;
- publish/deploy.

Prove zero-egress using the existing transport/provider-denial mechanisms, not a comment or an acknowledgment flag.

---

## 16. PREFLIGHT VERDICT

Return one of:

- BUILD-READY;
- BUILD-READY WITH CORRECTIONS;
- NOT BUILD-READY;
- NOT NEW TASK;
- WATCH.

For BUILD-READY or BUILD-READY WITH CORRECTIONS, continue immediately into implementation.

Do not stop because one finding became outdated. Remove that item and complete the still-valid owning task.

---

## 17. CORRECTED BUILD PLAN

Before editing, print a compact corrected plan containing:

- verified current root cause for each retained finding;
- exact current files to change;
- files explicitly not to change;
- whether the migration head remains unchanged;
- role matrices;
- test files/suites to extend;
- expected lockfile-only dependency impact;
- external-effect denial strategy.

Then build it.

---

## 18. KILL LINES

- KILL LINE: If any authenticated merchant/partner/non-dashboard role can still read internal proposal JSON by deal ID, the task has FAILED.
- KILL LINE: If a session-validity authority error still allows a protected request to continue, the task has FAILED.
- KILL LINE: If CI still requires `package-firewall.replit.internal` or another inaccessible Replit-only package URL, the task has FAILED.
- KILL LINE: If pre-deploy can start the server with live provider credentials/effects reachable outside a verified zero-egress boundary, the task has FAILED.
- KILL LINE: If an ordinary agent can still export bulk offline-conversion contact email/GCLID data, the task has FAILED.
- STOP if tests weaken or delete an existing security/provider-denial gate just to go green.
- STOP if the build changes production secrets, production database rows, provider controls, ad accounts, or deploys/publishes.
- STOP if `db push` is used or historical migrations are edited.
- STOP if the fix introduces a new role vocabulary, session system, provider-deny flag or background profile owner.

---

## 19. IMPLEMENTATION RULES

- Make the smallest safe diff.
- Preserve current canonical owners.
- No broad formatting/refactor churn.
- No unrelated dependency upgrades.
- No unrelated lockfile churn beyond restoring portable resolved URLs/metadata.
- Preserve existing outward error semantics where security permits; do not leak session authority internals.
- Keep unauthorized CRM-object responses non-enumerating.
- Do not convert a temporary session-authority outage into mass logout.
- No follow-up tasks for findings that belong to this scope.

---

## 20. TEST REQUIREMENTS

At minimum add/extend focused tests for:

### Authorization

- proposal read role matrix: anonymous, merchant, partner, agent-owner, agent-other, manager, admin;
- offline-conversion export role matrix for JSON/default and CSV;
- no object enumeration for unauthorized agent.

### Session validity

- valid session;
- expired session;
- invalidated session;
- missing durable session row under the repository's intended compatibility behavior;
- `authStorage.getUserSession()` throws -> protected middleware fails closed with 503-class unavailable result;
- authority-unavailable does not destroy an otherwise authenticated session;
- every role guard that consumes session validity follows the same rule.

### CI portability

- static scanner rejects `package-firewall.replit.internal` and private/internal resolved URLs in committed lockfile;
- clean `npm ci --include=dev --ignore-scripts --no-audit --no-fund` succeeds in a clean non-Replit environment;
- dependency versions remain intentionally stable.

### Provider denial

- pre-deploy server process has provider deny + test mode before app startup;
- background workers/schedulers remain disabled under provider deny;
- GHL/email/SMS fail-fast is active;
- a synthetic outbound/provider attempt is blocked before network egress;
- cleanup works after forced test failure.

### Config

- selective background profile still includes the intended canonical enrichment groups;
- safe-off legacy flags do not disable the current canonical enrichment/SFP queues;
- generic outreach remains excluded from the selective profile.

Use existing suites where possible rather than adding redundant test frameworks.

---

## 21. SMOKE / INTEGRATION / GATE COMMANDS

Discover current canonical commands first. At minimum run the current equivalents of:

- `npx tsc --noEmit`;
- `npm run build`;
- `npx tsx scripts/smoke-role-guards.ts`;
- `npx tsx scripts/test-security-controls.ts`;
- `npx tsx scripts/test-certification-process-env.ts`;
- `npx tsx scripts/test-certification-provider-deny.ts`;
- focused new/extended auth-session tests;
- focused acquisition export role tests;
- CI suite manifest validation;
- `git diff --check`;
- a clean `npm ci` outside the Replit package firewall;
- `scripts/run-pre-deploy.sh` only after its zero-egress correction is in place and only against disposable/test infrastructure required by the repository.

If a suite needs PostgreSQL/Redis, use the repository's disposable test infrastructure guards. Never point a stateful certification suite at production/shared development state.

After push/PR, capture the actual GitHub Actions result for the implementation SHA if accessible. A local pass does not erase a red GitHub install gate.

---

## 22. POST-BUILD GREP CHECKS

Prove all of the following:

- no internal proposal-read route remains session-only when it should be dashboard/object-scoped;
- no session validity exception path returns an allow/valid result;
- no `package-firewall.replit.internal` remains in `package-lock.json`;
- no pre-deploy server launch omits the canonical provider-deny/test boundary;
- no bulk offline-conversion export remains agent-readable;
- no unexpected `BACKGROUND_JOB_PROFILE=full` was introduced;
- no new live provider secret was added to source;
- no historical migration changed.

Report grep commands and results.

---

## 23. DIFF REVIEW

Run and report:

- `git status --short`;
- `git diff --stat`;
- `git diff`;
- `git diff --check`.

Confirm:

- only intended files changed;
- no secrets or PII;
- no generated/debug junk;
- no unrelated migrations;
- no unrelated dependency upgrades;
- no production config mutation beyond safe checked-in defaults explicitly owned by this task;
- no publish/deploy action occurred.

---

## 24. FINAL VFC TABLE

Return a final table with at least:

| ID | Requirement | Final evidence | Test/gate | Status |
|---|---|---|---|---|
| SEC-01 | Internal proposal read has dashboard + object authorization | `file:line` | role matrix | PASS/FAIL |
| SEC-02 | Session validity authority errors fail closed | `file:line` | injected-error test | PASS/FAIL |
| REL-01 | Lockfile portable; clean GitHub/non-Replit `npm ci` works | `file:line` + CI evidence | clean install/CI | PASS/FAIL |
| REL-02 | Pre-deploy server is zero-egress/provider-denied | `file:line` | provider-deny test | PASS/FAIL |
| ADS-01 | Offline conversion export restricted to privileged roles | `file:line` | role matrix | PASS/FAIL |
| CFG-01 | Legacy runtime defaults safe or explicitly justified | `file:line` | profile/config test | PASS/FAIL/ACCEPTED |

Every Done Looks Like item and kill line needs evidence.

---

## 25. FINAL RESPONSE FORMAT

Return:

1. VERDICT;
2. starting branch/SHA and ending implementation SHA;
3. migration head before/after;
4. verified root cause for each finding;
5. exact changed files with `file:line` summary;
6. test/gate table with real commands and outcomes;
7. GitHub Actions run/result for the implementation SHA if available;
8. provider/network denial proof;
9. post-build grep proof;
10. kill-line proof;
11. items that remain deployment/runtime verification only;
12. final status: `SAFE TO MERGE`, `SAFE TO MERGE - RUNTIME VERIFICATION PENDING`, or `DO NOT MERGE`.

Do not claim DEPLOYED, RUNTIME VERIFIED, or FINAL RELEASE CERTIFIED. This task ends at merge-ready code/repository evidence.

---

# TASK TO PREFLIGHT + BUILD

## What & Why

Stage 1 is the safety foundation for the fresh Liberty Bancard go-live audit. Current code is strong enough to continue auditing, but the five confirmed closure items above prevent final release certification: an internal proposal-read role gap, fail-open durable session validation, non-portable GitHub CI dependencies, an incomplete pre-deploy provider-denial boundary, and an over-broad offline-conversion export. The checked-in legacy activation flags also need a safe-default decision so future profile changes cannot unexpectedly arm obsolete paths.

These are bounded repairs. They do not justify a platform redesign, a deployment, or another month-long security project.

## Done Looks Like

- Internal proposal reads are restricted to the correct dashboard roles and deal ownership.
- Session revocation/expiry authority fails closed on lookup errors without converting infrastructure outages into silent authorization or unnecessary logout.
- `package-lock.json` is portable and GitHub Actions can complete `npm ci` from a clean hosted runner.
- Pre-deploy runs the server and suites inside a real test/zero-egress boundary and proves it.
- Offline-conversion exports are not available to ordinary agents.
- Checked-in legacy outreach/orchestrator/discovery defaults are safe-off unless a current canonical owner proves a required dependency.
- Existing canonical enrichment/selective-worker behavior remains intact.
- No production side effect, provider call, publish or final SHA freeze occurs.
- Tests and CI prevent regression.

## FINAL DIRECTIVE

Verify current `main` first, then implement every still-valid correction in this one task. Do not create follow-up tasks for task-owned findings. Do not publish. Do not freeze the final release SHA. Do not touch production data or live provider controls. Finish at a clean, tested, merge-ready implementation with exact evidence.
