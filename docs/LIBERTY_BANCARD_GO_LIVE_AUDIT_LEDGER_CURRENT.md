> Reconciled repository working copy, 2026-10-08. Baseline preserved verbatim from attached_assets/LIBERTY_BANCARD_GO_LIVE_AUDIT_LEDGER_CURRENT(2)_1791032739413.md. The later uploaded spec _4 contains only a file-stream-access-denied error, so it is not used as a specification. All historical source entries, repair groups and evidence remain below; the scoped amendment controls the new postmerge status.

## Owner-directed C4 patch integration

The prepared C4 patch and completed scoped repairs from candidate `2877b3a4e51b832dd0b2802b36e489787dc4242a` are integrated with current main, preserving existing C2/intake changes. The user explicitly clarified that unrelated existing test/CI failures are not prerequisites for applying this patch to origin/main. Publication is not authorized.

Exact-source isolated C4 run `38675003130` passed all six jobs; Static Checks passed; the local protected C2 browser passed 335 bounded receipts. Main-side C4 contracts and 46 C2 helper assertions passed. Normal CI's separate C1 browser row-set assertion (`50 !== 11`) remains reported, not silently relabeled green or used to block this scoped patch. Full conditional acceptance and Stage 3 release certification are not claimed. See `docs/certification/stage3-c4/owner-continuation-2026-10-14.md` for the controlling integration amendment.

## C2 postmerge correction — C2-R10: unfinished Contact header and action hierarchy

This was an unmet existing C2 implementation-step-4 requirement at the earlier closeout. It remains assigned to existing Task #2073/C2 alongside the Calendar-duration and pending-task corrections; it is not deferred to C3–C5 or a new task.

Implementation: ContactDetail adopts the existing RecordHeader/Liberty components, with identity, owner, lifecycle, consent/contactability, next action and essential outbound-pause reasons in a compact header. Log Call is primary; Add Note and New Task are the only secondary record actions. Other permitted operations are in the labelled More actions menu. Substantial SFP/readiness explanations and record diagnostics are expandable after the nearby five-area URL-backed navigation. Existing handlers, record context and permissions must remain intact.

Evidence status: scoped local PASS on 2026-10-08. Before/after desktop, phone and actual native 200% captures are retained. Thirteen bounded check groups verify real contact-bound Edit/Deal/Ticket/Note/Task/Call/scheduler persistence, clipboard values, keyboard/menu/dialog focus return, last-command reachability at 200%, and unchanged owner/merchant denials. See docs/certification/stage3-c2/contact-header/README.md and after-receipt.json for exact source/build hashes, geometry and qualifications. Three existing post-commit blueprint attempts were denied; external egress was zero. Email/AI execution, published signed-in UI, full C2/global acceptance and other-role/interior states are not certified. This amendment supersedes earlier blanket claims that the Contact outer composition was complete; it grants no global release GO.

The final eleven-entry sidebar remains C5. Outbound stays paused; incoming GHL synchronization remains independently enabled. No production writes, sends, provider activation, access bypass or publication are authorized by this correction.

---

# LIBERTY BANCARD — GO-LIVE AUDIT LEDGER (CURRENT)

## C4 owner-authorized implementation record — 2026-10-14

**Current controlling amendment:** Exact compiled source `b4810727c371c9e4b49e394c5dfc7af045b19767`, production build `e87f5f9c-7337-4aba-a120-5314da480330`. All six required suites passed locally and in [remote acceptance 38665072643](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/38665072643), alongside all 66 static suites, whole-project typecheck and build/integrity. Executed evidence includes 318 handler cases, 102 named browser rows, 40 responsive/theme probes, genuine 200% zoom, selected-tier Terminal actual CSV/failure suppression/single Escape/caller focus, fresh matched performance targets and actual production bundled rollback/schema-business invariants. Candidate useful-list `914.618 / 722.980 ms`; browser feedback `20.5 / 21.6 ms`. Exact hashes, recipe and qualifications are in the continuation.

[Normal CI 38665072299](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/38665072299) passes Static Checks; full Integration remains running at this amendment. Required C2 workspace-browser is unresolved: owned agent rejection-text case failed; a separate, unaccepted test-only reconciliation stopped at Quick Edit Sheet connected-focus return. Pipeline/preflight/deal-authority code is unchanged from main; further C2 edits are separate and unaccepted, with no authority/header-design change or new task ladder. Full applicable conditional-control/state-space qualification remains open; inventory observations are not action passes. **Merge SHA: none; C4 OPEN / NOT FULLY ACCEPTED; release remains NO-GO.** Original 95 findings/14 repair groups and existing ownership remain intact. No production durable tests, native transmission or publication; outbound PAUSED, proposals HELD and incoming GHL independently ENABLED/no-echo remain the operating contract.

### Superseded implementation record

**Current amendment superseding the historical paragraphs below:** Latest pushed source is `c5ee15ba2393a67aea51a330e6c1912916e1a831`. [Normal CI 38660366151](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/38660366151) passes Static Checks/all 66 static suites, dependency audit and production artifact scan; Integration is pending. [Latest isolated C4 38660365949](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/38660365949) has five passing jobs and a pending expanded browser. Preceding source `77662cadf8be9519325eb349b16aa71e1ea95420`, local build `d2d50121-3f08-4ee6-882c-2efdc20dfd9b`, passed all six suites locally and in [remote acceptance 38658649909](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/38658649909): 318 handler cases, 101 named browser rows, all 40 responsive/theme probes, genuine 200% zoom, matched 2,500/200 ms performance limits and actual candidate→baseline→candidate production bundled-server rollback with data/schema invariants. Its normal integration run passed the C4/C2 cases but failed a stateless Toast runner resource mismatch. That runner-only correction passed its real denied child at four widths with no database/Redis variables and is pushed in the latest candidate. Control appearances remain inventory, not action passes. **Merge SHA remains none; C4 remains OPEN / NOT FULLY ACCEPTED.** Latest CI and full applicable control/state-space qualification are still required. No publication occurred. Original 95-finding/14-group ownership and operating safety contracts remain unchanged. See the linked continuation for exact hashes and qualified historical evidence.

See [exact C4 continuation evidence and limits](certification/stage3-c4/owner-continuation-2026-10-14.md). V1–V4 are implemented on the isolated verification branch; all six required suites passed locally and in remote run 38637895318, including named nonempty financial and real handler/session/CSRF cases. Matched Portfolio candidate visible-list times were 371.139/391.851 ms; physical-input feedback was 41.032/40.335 ms. Native browser zoom was 200%; 223 scoped contact/MID rows retained their exact hash across bounded reader/client rollback.

Compiled source is `401d7bdad4c76172736a9a76bb33b3fd7abfd216`; local build is `b4ce8687-dad1-4c0f-9451-17572501279f`. Neither is a deployed or merge identity. **Merge SHA: none. C4 OPEN / NOT FULLY ACCEPTED; global release remains NO-GO.** Required normal CI fails a reproduced unchanged-main SFP assertion expecting obsolete `verifyEmail(realEmail)` source text; no gate was waived. Full C4 conditional control/action, state, accessibility, financial-scope and whole-source/bundled rollback acceptance remains unresolved under its existing owner, not moved to new tasks. Original 95 findings/14 repair groups and C2/C3/C4/C5/A/B/D ownership remain intact. Outbound PAUSED, proposals HELD and incoming GHL independently ENABLED/no-echo stay the operating contract. No production test writes or publication occurred.

**Canonical working record for the fresh Liberty Bancard go-live audit**

**Latest audit:** Section 18 records the October 2 Stage 3 three-audit consolidation, fresh authenticated checks, current source/runtime identities, proposed navigation/design/metric contracts and grouped implementation roadmap. Section 17 and earlier sections remain historical evidence.  
**Created:** 2026-09-28  
**Purpose:** Preserve every material audit finding, closure state, evidence gap, and coverage decision so findings are never lost in chat history or overwritten by later reports.

---

## 1. Operating Rules

This ledger is **append-only in substance**.

- Never delete a finding because it was fixed.
- Never overwrite discovery evidence with later closure evidence.
- Move findings through explicit states instead:
  - `OPEN`
  - `FIX IN PROGRESS`
  - `MERGED`
  - `DEPLOYED`
  - `RUNTIME VERIFIED`
  - `CLOSED`
- If code is fixed but production/runtime has not been independently verified, do **not** mark the finding `CLOSED`.
- If an area has not been exercised, mark it `UNTESTED` or `NOT STARTED`; never call it `PASS` merely because no defect is known.
- Every audit session must record the Git SHA reviewed.
- Final certification must bind to one exact deployed SHA only after remediation/build work is finished.
- Security review is continuous, but final **Platform / Security / Release Certification** occurs near the end of the go-live program.

### Severity

| Severity | Meaning |
|---|---|
| `P0` | Immediate launch stop / active data, auth, send, spend, destructive, or severe security risk |
| `P1` | Must be corrected before go-live; material security, reliability, business-flow, data, release, or compliance defect |
| `P2` | Important operational/UX/control defect; can be scheduled behind P0/P1 if safely bounded |
| `P3` | Improvement / polish / low-risk cleanup |
| `EVIDENCE` | Not necessarily a product defect, but proof is missing and certification cannot close without it |

---

## 2. Last Independently Audited Baseline

| Item | Current Evidence |
|---|---|
| Repository | `scottpstevenson/Liberty-Bancard-Website-and-CRM` |
| Default branch | `main` |
| Current audited `main` SHA | `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` |
| Current `main` commit title | `Published your App` |
| Migration journal | 317 entries |
| Current migration journal head | `0312_contact_business_system_links` |
| Latest GitHub commit explicitly titled `Published your App` observed during audit | `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` |
| Current `main` vs that publish-marked commit | Same GitHub commit |
| Exact currently deployed runtime SHA | **UNVERIFIED FROM GITHUB ALONE** |
| Final release SHA frozen? | **NO — intentionally deferred** |
| Replit contacted during this audit? | **NO** |
| Production mutated during this audit? | **NO** |

### Important baseline rule

The commit titled `Published your App` is useful historical evidence, but it is **not by itself proof of the exact SHA currently serving production**. Final runtime identity remains an evidence requirement.

---

## 3. Open Findings — Current Fresh Audit

### SEC-01 — Internal deal proposal read route is reachable by authenticated merchant sessions

| Field | Value |
|---|---|
| Lane | Platform / Security / CRM authorization |
| Severity | `P1` |
| Status | `MERGED — present in current publish-marked head; authenticated runtime role verification pending` |
| Discovered at SHA | `8c88fd13126e8a87efbbb728a59a6a68e348a186` |
| Primary path | `GET /api/deals/:id/proposal` |
| Primary file | `server/routes/ai.ts` |
| Related authority | `server/services/crm-object-access.ts`; `server/replit_integrations/auth/replitAuth.ts`; `server/routes.ts` |

**Finding**  
`GET /api/deals/:id/proposal` currently uses `isAuthenticated`, not `isDashboardUser` or another merchant-safe object authorization contract.

The global `crmObjectAccessGuard` scopes direct deal/contact paths only when `req.user.role === "agent"`. The partner middleware separately blocks partner sessions from general CRM routes. An authenticated `merchant` is therefore not rejected by either of those global guards before the proposal handler reads the deal/proposal.

**Why it matters**  
An authenticated merchant account should not be able to enumerate/read arbitrary internal CRM deal proposal data merely by possessing or guessing a deal ID.

**Required correction**

- Classify the intended audience for the internal deal-proposal endpoint.
- Apply the appropriate dashboard/object-level authorization boundary.
- Do not break the separate public bearer-token proposal journey.
- Add negative tests for merchant, partner, unrelated agent, and anonymous access.
- Preserve admin/manager and correctly owned agent behavior where intended.

**Closure evidence required**

- Merged SHA.
- Route guard/object-policy test.
- Deployed SHA.
- Authenticated runtime verification across relevant roles.

---

### SEC-02 — Session revocation / expiry authority fails open when validation lookup errors

| Field | Value |
|---|---|
| Lane | Platform / Security / Authentication |
| Severity | `P1` |
| Status | `MERGED — present in current publish-marked head; runtime failure-injection verification pending` |
| Discovered at SHA | `8c88fd13126e8a87efbbb728a59a6a68e348a186` |
| Primary file | `server/replit_integrations/auth/replitAuth.ts` |
| Primary function | `checkSessionValidity()` |

**Finding**  
When the backing `user_sessions` validity lookup throws, the catch path logs `session_validation_failed` and returns `null`. `null` is then interpreted by `isAuthenticated`, `isDashboardUser`, `isAdmin`, and other role guards as “no invalid reason,” allowing the already-authenticated request to continue.

The code explicitly states: `On error, allow through (fail open to avoid breaking the app)`.

**What this does NOT mean**  
This is not an anonymous login bypass. Passport must still consider the request authenticated.

**Actual risk**  
If a session should have been rejected because it was revoked, idle-expired, absolutely expired, or administratively terminated, a failure of the session-validity backing lookup can prevent that revocation/expiry decision from being enforced for that request.

**Required correction**

- Fail closed for protected CRM/dashboard/admin routes when session validity cannot be authoritatively checked.
- Use an explicit error result such as `session_validation_unavailable` rather than returning the same value as “valid.”
- Choose an appropriate response (`401`, `503`, or controlled equivalent) without silently permitting the request.
- Add tests for backing-store failure across `isAuthenticated`, `isDashboardUser`, `isAdmin`, and other security-sensitive guards.

**Closure evidence required**

- Unit/integration failure-injection tests.
- No anonymous regression.
- No merchant/partner/dashboard role regression.
- Runtime verification after deployment.

---

### REL-01 — GitHub CI cannot execute cleanly because lockfile contains Replit-internal package URLs

| Field | Value |
|---|---|
| Lane | Platform / Release / CI |
| Severity | `P1` |
| Status | `CLOSED — clean GitHub-hosted runner install now succeeds; current CI is red for a different SFP regression` |
| Discovered / reconfirmed at SHA | `8c88fd13126e8a87efbbb728a59a6a68e348a186` |
| Current GitHub Actions run inspected | CI run `#314` / run id `36460401002` |
| Primary file | `package-lock.json` |
| Historical related program | Repository exposure / dependency-lockfile portability work (`RVR-02`) |

**Finding**  
The current GitHub Actions run fails at `npm ci` before any security/build/integration suites execute. The lockfile contains package tarball URLs pointing at `http://package-firewall.replit.internal/...`, which a GitHub-hosted runner cannot resolve.

At the audited SHA, six occurrences of the Replit-internal package host were present in `package-lock.json`, including PostgreSQL dependency packages.

**Observed CI consequence**

- Dependency installation: `FAIL`
- Deterministic static suites: `SKIPPED`
- External dependency/security audit: `SKIPPED`
- Release artifact build/scan: `SKIPPED`
- Integration job: `SKIPPED`

The failure is therefore **not evidence that application tests failed**; it is evidence that the independent CI gate cannot run.

**Why it matters**  
A release cannot be independently certified on GitHub if a clean runner cannot install the locked dependency graph.

**Required correction**

- Regenerate/normalize the lockfile so resolved package URLs are portable from standard clean CI runners.
- Preserve dependency versions/integrity rather than silently changing the dependency graph.
- Add a portability check preventing reintroduction of `*.replit.internal` package resolution URLs.
- Re-run static, external-security, build-scan, migration, and integration jobs successfully.

**Closure evidence required**

- Clean-runner `npm ci` success.
- Full current-head GitHub CI completion.
- Artifact/security/integration stages actually executed, not skipped.

---

### REL-02 — Pre-deploy wrapper claims provider denial without establishing a global provider-deny boundary for the server process

| Field | Value |
|---|---|
| Lane | Platform / Release / Certification Safety |
| Severity | `P1` |
| Status | `MERGED — outer pre-deploy zero-egress boundary is present; full certification-run proof pending` |
| Discovered at SHA | `8c88fd13126e8a87efbbb728a59a6a68e348a186` |
| Primary files | `scripts/run-pre-deploy.sh`; `scripts/pre-deploy.ts`; provider-deny helpers |

**Finding**  
`scripts/run-pre-deploy.sh` says it starts the dev server “with provider denial,” but the wrapper launches the server with `GHL_TRANSPORT_FAILFAST=true` and does not itself establish `VG_PROVIDER_DENY_MODE=1` for the server process.

Many individual certification suites correctly install disposable/provider-deny boundaries. The background server, however, inherits the surrounding process environment and selected worker topology unless otherwise fenced.

**Why it matters**  
A ceremony that states “This gate makes NO real provider calls” should establish that property at the outermost process boundary, not rely on every individual worker/service/test path to remain independently safe.

**Required correction**

- Make zero-egress/provider-deny behavior explicit at the wrapper/server boundary for certification runs.
- Ensure background workers/schedulers cannot make live provider calls during certification.
- Preserve GHL fail-fast isolation.
- Add an executable assertion proving provider denial is active before server-required suites begin.

**Closure evidence required**

- Certification process-env test.
- Fake/denied provider assertion.
- Successful complete pre-deploy run with zero external provider effects.

---

### ADS-01 — Offline conversion export is accessible to ordinary dashboard agents

| Field | Value |
|---|---|
| Lane | Ads / Attribution / CRM Authorization |
| Severity | `P1` |
| Status | `MERGED — admin/manager restriction present; runtime role verification pending` |
| Discovered / reconfirmed at SHA | `8c88fd13126e8a87efbbb728a59a6a68e348a186` |
| Endpoint | `GET /api/acquisition/offline-conversions/export` |
| Primary file | `server/routes/acquisition.ts` |

**Finding**  
The offline-conversion export uses `isDashboardUser`, which permits `admin`, `manager`, and `agent`. The export includes conversion data suitable for Google Ads import and reads contact identifiers including email and GCLID.

**Why it matters**  
Bulk ad-attribution/conversion export is an administrative/growth-operations function and exposes data beyond what ordinary sales agents need for daily CRM work.

**Required correction**

- Restrict the bulk export to the approved administrative roles (expected: admin/manager unless a narrower governed role is established).
- Keep ordinary read-only acquisition metrics separately scoped if agents legitimately need them.
- Add role-matrix coverage for export vs non-export acquisition endpoints.

**Closure evidence required**

- Route-role tests.
- Runtime role verification.

---

### REL-03 — Exact deployed runtime SHA is not yet independently proven

| Field | Value |
|---|---|
| Lane | Platform / Release Identity |
| Severity | `EVIDENCE` |
| Status | `OPEN — GitHub head is publish-marked, but exact serving runtime identity remains unverified` |
| Current main | `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` |
| Latest publish-marked commit observed in GitHub | `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` |
| Distance | Same GitHub commit; exact serving runtime SHA still requires runtime identity evidence |

**Finding / evidence gap**  
GitHub proves the repository state and commit history but does not by itself prove the exact SHA currently serving `libertybancard.com` / the production CRM.

The four commits after the latest publish-marked commit include changes to:

- the selected background-worker profile;
- continuous SFP discovery/validation;
- SFP provider operations;
- runtime attestation refresh.

**Why it matters**  
Live/runtime audit findings must be attributed to the code actually serving traffic, not assumed from `main`.

**Required evidence**

- Production health/release identity exposing exact deployed SHA.
- Migration head.
- worker/profile identity.
- confirmation of whether current `main` changes are deployed before relying on them as runtime truth.

**Closure rule**  
Do not close until exact deployed runtime identity is independently verified. This is intentionally deferred until runtime/browser audit stages and final release certification.

---

## 4. Historical Findings Revalidated During This Fresh Audit

These rows remain in the ledger permanently. Their current status reflects only what the fresh source audit proved.

### ENR-H01 — Task #2002 `sunbiz-full-backfill` selective worker-profile omission

| Field | Value |
|---|---|
| Lane | Prospecting / Enrichment / Workers |
| Severity when found | `P1` |
| Current status | `MERGED` — runtime closure not yet independently verified |
| Original defect | `sunbiz-full-backfill` existed but was not assigned to any selectable capability group, so a selective deployment could mark backfill running without a consuming worker. |
| Current code evidence | Dedicated `sunbiz-backfill` capability group now maps to `sunbiz-full-backfill`. Checked-in selective profile includes `sunbiz-backfill`. |

**Do not delete this row.**  
Final closure still requires runtime proof that the deployed profile actually instantiates the queue/worker and the cursor advances safely.

---

### ENR-H02 — SFP `ready_held` campaign-staging intent had no governed paused-enrollment consumer

| Field | Value |
|---|---|
| Lane | Prospecting / Campaigns / Enrollment |
| Severity when found | `P1` |
| Current status | `MERGED` — runtime closure not yet independently verified |
| Current code | `server/services/cro03/sfp-enrollment-bridge.ts`; admin bridge route in `server/routes/lead-ops.ts` |

**Current source evidence**

The bridge now:

- converts a governed `ready_held` intent into a **paused** sequence enrollment;
- does not activate/send;
- refuses synthetic placeholder email creation;
- checks real/corroborated identity;
- rechecks promotion/suppression/existing-customer eligibility;
- rejects conflict with an already active enrollment;
- uses locking/idempotency protections;
- carries dedicated disposable certification coverage.

**Remaining closure proof**

- exact deployed SHA;
- real runtime canary with isolated test/canary records;
- prove zero unauthorized send;
- prove pause/hold state in UI and data.

---

### SEC-H01 — September AI/CRM authorization regression

| Field | Value |
|---|---|
| Lane | Platform / Security / AI CRM |
| Original status | P0/P1 authorization concern |
| Current status | `PARTIALLY CLOSED` |

**Fresh source evidence now confirms**

- company-wide AI insight/task/onboarding scans are admin/manager constrained;
- dashboard AI actions use `isDashboardUser` where appropriate;
- body-supplied contact/deal/ticket IDs have explicit ownership checks in audited paths;
- proposal bearer tokens are fingerprinted before audit logging;
- public proposal token routes have rate limiting;
- stale `sales` role checks were changed to the actual `agent` role in proposal-related mutations;
- chargeback copilot paths now check linked deal/contact access.

**Still open from this family**

- `SEC-01` internal proposal read route remains only `isAuthenticated`.

Therefore the historical family cannot yet be marked fully `CLOSED`.

---

## 5. Latent / Configuration Risk Register

These are not all proven active production defects, but they are important conditions that can become dangerous if topology or release configuration changes.

### CFG-01 — Legacy outreach/orchestrator flags remain armed in checked-in Replit configuration

| Field | Value |
|---|---|
| Lane | Runtime / Outreach Safety |
| Severity | `P2` |
| Status | `MERGED — checked-in legacy flags now safe-off; deployed runtime environment verification pending` |
| Observed values at current source | `LEGACY_OUTREACH_ENABLED=false`; `ORCHESTRATOR_ENABLED=false`; `NIGHTLY_DISCOVERY_ENABLED=false` |

**Post-merge state**  
The checked-in Replit defaults are now fail-safe for the legacy discovery/outreach/orchestrator switches. Final closure still requires confirming that the deployed runtime environment has not overridden those checked-in defaults and that selective profile resolution does not instantiate excluded outbound capabilities.

---

## 6. Release / Repository Governance Observations

### GOV-01 — Repository is public

| Field | Value |
|---|---|
| Status | `OBSERVATION` |
| Repository visibility | `public` |

Public visibility is not automatically a defect, but secret containment and generated-artifact hygiene must therefore be treated as hard requirements.

### GOV-02 — No repository rulesets returned by GitHub API

| Field | Value |
|---|---|
| Status | `EVIDENCE GAP / GOVERNANCE REVIEW` |

The GitHub API returned an empty ruleset list. Traditional branch-protection configuration could not be read with the connected GitHub integration because the integration lacks the necessary administration permission.

**Do not infer** that branch protection is absent solely from that 403. Final governance review still needs authoritative branch-protection evidence.

### GOV-03 — Quick source token-prefix search found no obvious GitHub/OpenAI/Google API tokens

| Field | Value |
|---|---|
| Status | `PARTIAL EVIDENCE ONLY` |

This was a bounded source search, not a complete secret scan. Final security certification still requires the full repository/build-artifact secret-scanning gate to execute successfully.

---

## 7. Audit Coverage Register

**Current sequencing authority:** Section 14 records the owner’s 2026-10-01 update: Stages 1 and 2 are completed, fixed, and merged; Stage 3 is next. Older findings and evidence gaps remain historical audit evidence until independently reverified.

This register answers **what was actually tested**, not what the code claims to support.

| Audit lane | Current status | What has been done | What is still required |
|---|---|---|---|
| Safety & Environment Preflight | `COMPLETED / FIXED / MERGED — OWNER CONFIRMED 2026-10-01; FINAL CERTIFICATION PENDING` | GL-01 fixes independently verified in current publish-marked head; clean-runner install now succeeds; session/proposal/export/config/pre-deploy corrections preserved | Current head CI must be green; exact serving runtime SHA/profile/migration/queue evidence; role/runtime failure-injection checks |
| Public Website & Inbound | `COMPLETED / FIXED / MERGED — OWNER CONFIRMED 2026-10-01; FINAL CERTIFICATION PENDING` | GL-02 major fixes verified in current publish-marked head: optional PEWC/marketing consent, consent-aware tracking, stable idempotency, callback ambiguity handling, core claim cleanup | Residual public claim drift; strict validation gaps; raw Meta/Microsoft click-ID authority; CI registration of GL-02 regression suites; interactive browser/mobile/network canaries; production assignment policy |
| CRM & Sales Operations | `NEXT — STAGE 3; FRESH LIVE AUDIT NOT STARTED` | Historical CRM audits exist | Discover current roles; authenticated walkthrough of every accessible route/tab/action by role; loading/empty/error/degraded states; data reconciliation; mobile/desktop; mutations where safely testable |
| Prospecting / Enrichment / Campaigns | `PARTIAL SOURCE REVALIDATION` | #2002 profile fix verified in current source; SFP enrollment bridge verified in current source; current capability/profile topology inspected | Exact deployed topology; real source→canonical→free enrichment→paid waterfall→validation→eligibility→staging→paused enrollment canary; cost/yield; queue/retry/failure tests |
| Application / Underwriting / Processor Boarding | `NOT STARTED — FRESH E2E` | Historical architecture exists | Isolated full statement→proposal→application→protected data→underwriting→RFI→processor sandbox→approval→MID journey |
| Merchant Onboarding / Support / Revenue | `NOT STARTED — FRESH E2E` | Historical architecture exists | MID activation; equipment/onboarding; portal; support; chargebacks/RFI; processor activity; residual import; reconciliation; commissions/revenue |
| Ads / Attribution | `PARTIAL SOURCE AUDIT` | Acquisition routes reviewed; `ADS-01` found | Landing pages; UTM/click IDs; GCLID; consent-aware tags; browser/server event dedupe; Enhanced Conversions for Leads; Data Manager; offline feedback; ad-account/billing/permissions/budgets/brand safety; capped launch thresholds |
| Sales Training / AI Operational Readiness | `NOT STARTED — FRESH` | Historical training/AI assets exist | Versioned rep enablement package; real-role onboarding; daily workflow; talk tracks; objections; compliance; practice/certification; AI evidence/permission/no-autosend validation |
| Platform / Security / Release — FINAL | `DEFERRED` | Early safety preflight in progress | After product remediation: freeze exact SHA; full clean CI; security/role/IDOR/migration/build gates; publish exact SHA; verify live; queue/provider/kill switch/rollback/incident certification |
| Final Lane-Specific Certification | `NOT STARTED` | — | Issue independent final verdicts for all nine launch lanes; no vague company-wide GO |

---

## 8. Final Lane Verdict Register

**These verdicts are intentionally blank until remediation and certification are complete.**

| Final certification lane | Verdict | Certified SHA | Evidence |
|---|---|---|---|
| Platform / Security / Release | `NOT YET CERTIFIED` | — | — |
| Public Website & Inbound | `NOT YET CERTIFIED` | — | — |
| CRM & Sales Operations | `NOT YET CERTIFIED` | — | — |
| Prospecting & Enrichment | `NOT YET CERTIFIED` | — | — |
| Campaigns & Outbound | `NOT YET CERTIFIED` | — | — |
| Merchant Application & Processor Boarding | `NOT YET CERTIFIED` | — | — |
| Merchant Onboarding / Support / Revenue | `NOT YET CERTIFIED` | — | — |
| Ads & Attribution | `NOT YET CERTIFIED` | — | — |
| Sales Training & Operational Ownership | `NOT YET CERTIFIED` | — | — |

---

## 9. Finding Closure Template

Copy this block for every new finding.

```md
### <ID> — <Short title>

| Field | Value |
|---|---|
| Lane | |
| Severity | |
| Status | `OPEN` |
| Discovered at SHA | |
| Discovered date | |
| Primary routes/files | |
| Owning task | |

**Finding**

**Why it matters**

**Exact evidence**

**Required correction**

**Regression tests required**

**Merge evidence**

**Deployment evidence**

**Runtime verification**

**Closed date**
```

---

## 10. Change Log

### 2026-11-07 — Public site mobile visibility and presentation (source only; not published)

Implemented from base `6d2dafad027daffb420272d0d3c2b8b5918870c9` in two checkpoints against the supplied mobile audit and repair plan. **Status: implemented and locally verified in source; no publish, no production smoke, no serving-SHA binding has occurred.** CRM design, the eleven-entry sidebar and theme, outbound pause, GHL outgoing, native/provider/calendar writers, the booking adapter, consent/classification/authorization, consent text and the shared `Checkbox` are unchanged. Stage 5 acceptance is not closed or claimed by this entry.

**Checkpoint A (visibility):** public styles are scoped to the public shell (body marker plus `.marketing-theme` tokens in `client/src/styles/public-contract.css`; no global body or CRM override); explicit low-contrast pairs repaired; one overlay/viewport coordinator (`PublicOverlayCoordinator.tsx`, `public-overlay.ts`) so consent and open dialogs take precedence and the chat launcher clears the dock/safe area; one industry data model with complementary layouts; accordion default and nested link/button semantics fixed; 44px public tap targets via `.public-tap` (hit-area only for the consent checkbox); every visible booking label is "Book a review call" on client and server-rendered pages (analytics event names unchanged); self-hosted Source Serif 4 display face with its OFL licence plus the existing IBM Plex body faces; `@assets` imports repointed to committed byte-identical sources with `logo-blue.png` and `logo-white.png` committed. **Finding:** a clean clone of `6d2dafad` cannot build because it imports untracked `attached_assets/` files; the repoint removes that dependency.

**Checkpoint B (presentation):** public contract primitives (`PublicSection`, `PublicImage`, `PublicAccordion`, extended hero/CTA); imagery pipeline `scripts/build-public-images.ts` (seven committed originals, AVIF/WebP/JPEG derivatives, manifest with explicit dimensions, only the principal hero is eager); Home rebuilt as eight sections under `client/src/components/home/` with linked image-led industry cards, the illustrative sample review labelled as illustrative, and corrected program defaults; shared primitives adopted on the inspected conversion, product, industry and content templates; footer rebuilt as four expandable groups with one Staff Login, every policy link still in the DOM (collapsed groups use `hidden`; server-rendered footer is `<details open>` collapsed below 1024px by an inline script) and shared link list in `shared/public-footer-links.ts`. Intake receipt, validation, error and recovery handlers are untouched.

**Deliberate content changes to know about:** Home no longer has the onboarding timeline, the count-up stats band, the mobile "$600–$3,200/year" hook or the desktop inline calculator; the Home h1 contract changed (56px desktop, 32px mobile; Stage 3 A/B fixtures updated to match); three staff footer shortcuts were removed in favour of one Staff Login; footer test IDs were renamed (for example `button-footer-company-toggle`); public pages use public-scoped contrast tokens and the shared `--muted-foreground` is unchanged. **Imagery provenance is unverified:** all seven originals carry `provenance: "unverified"` and `usage: "illustrative"`; no licensed or verified real-merchant photograph exists in the repository, so the plan's "one real-or-licensed merchant visual" is met only by an illustrative product render. Replacing it needs a licensed image and a registry/pipeline entry, not page changes. Terminal product PNGs (about 1 MB each, used on `/0-percent-processing` and others) were not routed through the pipeline.

**Local evidence (Chromium only, production build, isolated preview on synthetic fixtures, no production writes):**
- Mobile visibility matrix `scripts/check-public-site-mobile.ts --strict`: 26 inspected routes × 390/768/1440 × light/dark = 156 states; the only finding was a Home contrast pair, fixed and rescanned to zero. Overlay probes `scripts/check-public-overlay.ts`: 22 probes, 0 failed. Fonts `scripts/check-public-fonts.ts --strict`: all routes pass, shift 0. `build-public-images.ts --check`: seven sources current and within budget.
- New checks registered in `scripts/pre-deploy.ts` MANDATORY_SUITES and `scripts/ci-suite-manifest.ts` (image derivatives deterministic-static; mobile visibility, fonts and overlay server-required); manifest `--check` valid (254 suites). `scripts/check-public-perf.ts` is explicit-evidence tooling and is not in the gate.
- Lab performance, 5-run medians, 390×844 DPR2, CPU ×4, 1.6 Mbps / 150 ms, cold cache, HEAD build (before) versus candidate build (after), both in isolated previews. Targets LCP ≤ 2.5 s and CLS ≤ 0.1 are lab targets, not field results.

| Route | LCP before → after | CLS before → after | Total KB | Image KB |
|---|---|---|---|---|
| `/` | 376 → 1256 ms | 0.0043 → 0.0042 | 1177 → 1154 | 148 → 168 |
| `/upload-statement` | 1168 → 888 ms | 0.0249 → 0.0254 | 983 → 1001 | 148 → 148 |
| `/faq` | 5156 → 996 ms | 0.0002 → 0.0157 | 952 → 1001 | 148 → 148 |
| `/0-percent-processing` | 932 → 764 ms | 0.0071 → 0.0284 | 2980 → 2997 | 2144 → 2144 |
| `/industries/restaurant-payment-processing` | 332 → 760 ms | 0 → 0 | 1044 → 1022 | 148 → 169 |
| `/industries/retail-payment-processing` | 340 → 732 ms | 0.0001 → 0 | 1044 → 1020 | 148 → 167 |

All after-values are within budget. Home and the two industry pages got later LCP because the new hero/card image (a 20 KB AVIF on Home) paints after hydration, while the earlier LCP was the server-streamed first paint; the `/faq` before value was a 5 s outlier. CLS stays small but rose on three routes because server-rendered content is replaced at hydration. `/0-percent-processing` still ships 2.1 MB of terminal PNGs, unchanged from before. Single runs vary by more than a second when the machine is busy; use medians. Chromium cannot open port 6000 (the isolated-preview default) so browser evidence used a forwarder on another port.

**Regression boundary (compared with a clean `6d2dafad` build):** `seo-audit` passed (421 routes, sitemap and partner uniqueness ok); `role-guards` 169/169; `api-coverage` ok; SSR style isolation passed (134 rules); Stage 5 intake browser, intake recovery and public journey passed on disposable databases; Stage 3 C5 walk (theme, contrast, zoom), D-V landmarks and D-R2 headings passed. Pre-existing failures identical at base and candidate: `test-public-route-validation` (two stale `GetStarted.tsx` assertions that predate `usePublicIntake`) and `test-stage3-b-browser` (fails at the contact "compose email" click; its updated Home h1 assertions run earlier and pass). `test-stage3-a-authority` failed once in the terminal-recommendation report (`0 !== null`), passed on rerun and passes at base — treated as a flake. The full `pre-deploy` roster still reports delegated execution unverified, as before. The passing runs refreshed the checked-in receipts under `docs/certification/stage5/intake-browser`, `stage3-c5/browser` and `stage3-d-v/landmarks-browser`; they record base `6d2dafad` as `sourceHead` and the then-uncommitted candidate tree, and the Stage 5 receipt records a passed run only, not Stage 5 acceptance. CRM/portal comparison on both previews (real login, light and dark; admin 5 routes, agent 2, merchant portal 1): pixel difference 0.000% on pipeline, tasks, notifications and merchant portal; 0.02–0.03% on Overview and about 0.37% on Contacts, limited to fixture-generated timestamps and values; header, sidebar and theme identical. The Partner Portal login page renders inside public chrome and changed 6.7–7.1% from the intended header/footer redesign only.

**WebKit / iPhone: NOT EXERCISED.** WebKitGTK 2.50.4 (`MiniBrowser`, `WebKitWebDriver`) exists in the container, but its web process aborts with "Could not create default EGL display: EGL_BAD_PARAMETER" in three configurations (default, compositing disabled, Mesa software rendering); there is no GPU render node. Even if it ran, WebKitGTK on Linux is not iOS Safari and cannot show safe-area insets, dynamic toolbars, iOS zoom/large text or keyboard behaviour. Safe-area padding exists in source (`StickyMobileCTA`, `index.css`) but is unverified on a device. Chromium results above must not be read as a Safari or iPhone result.

**Handoff:** merge and publish are the owner's. After publication, run the read-only smoke `BASE_URL=<published origin> PUBLIC_SITE_STRICT=1 PUBLIC_SITE_WIDTHS=390,1440 npx tsx scripts/check-public-site-mobile.ts`, bind it to the serving SHA, and then run a real iPhone Safari pass (safe area, dynamic bars, large text, keyboard).

### 2026-10-01 — Reference audits and GHL sync posture added to Stage 3

Added a bottom section to the Stage 3 plan requiring full verification/reconciliation of both supplied October dashboard audits, including reported bugs, positive claims, cleanup history, GHL observations and conflicting snapshots. Owner specifies outbound emails remain paused while GHL data sync stays enabled and operational. Reference recommendations to unpause email, raise send caps or run cleanup are not adopted as authorization. No live state was changed or independently verified. See Section 16.

### 2026-10-01 — Stage 3 audit and redesign game plan authored

Created the Stage 3 CRM audit and redesign game plan with five passes: complete inventory; role/route/tab/action verification; sales journeys and data reconciliation; navigation/UI design; prioritized remediation and re-test. Added Section 15 with scope, deliverables, proposed navigation, and stage ownership. No new repository/runtime verification or defect closure occurred. Stage 3 remains next, with the live audit pending.

### 2026-10-01 — Owner stage completion and sequence update

Owner confirms Stages 1 and 2 have been completed, fixed, and merged. Added the authoritative ten-stage sequence in Section 14, set Stage 3 as the next audit, and established mandatory ledger updates after every task and audit. This is an owner-status update, not a new repository/runtime audit. Prior discovery evidence and unresolved independent-verification requirements are retained. Section 14 supersedes the older Stage 3 deferral in Section 13.3. No new SHA, CI result, deployment, or runtime verdict is asserted.

### 2026-10-01 — Stage 1/2 post-merge re-audit

Re-pinned to current publish-marked `main` `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` and migration head `0312_contact_business_system_links`. Verified GL-01 fixes remain implemented and the old clean-runner dependency-install failure is closed. Found current CI red on stale SFP structural assertions after a safer implementation refactor and found GL-02 residuals in public claim governance, strict public-form validation, raw click-ID authority, and CI registration of GL-02 regression tests. Stage 3 remains deferred until this bounded closure pass is complete.

### 2026-09-28 — Ledger created

Seeded from the fresh GitHub/current-code Safety & Environment Preflight plus revalidated historical go-live findings.

Initial current findings recorded:

- `SEC-01` — internal deal proposal read authorization defect.
- `SEC-02` — session validity authority fails open on lookup error.
- `REL-01` — GitHub CI blocked by Replit-internal package URLs in lockfile.
- `REL-02` — pre-deploy provider-deny boundary mismatch.
- `ADS-01` — offline conversion export over-broad to agents.
- `REL-03` — exact deployed runtime SHA not independently proven.
- `CFG-01` — latent armed legacy outreach/orchestrator configuration.

Historical findings revalidated and retained:

- `ENR-H01` — #2002 Sunbiz backfill worker-profile omission fixed in current source; runtime closure pending.
- `ENR-H02` — SFP `ready_held` → paused enrollment bridge now implemented; runtime closure pending.
- `SEC-H01` — September AI/CRM authorization family substantially remediated, with `SEC-01` still open.

Coverage register initialized for the full fresh go-live audit program.

---

## 11. Next Audit Entry

**Next lane:** Stage 3 — CRM & Sales Operations
**Execution plan:** [Stage 3 CRM Audit and Redesign Game Plan](https://chatgpt.com/space/page_bdb0fc8cc3bc8191bf890e19796ccbbc); authored 2026-10-01. Live audit pending.  
**Method requirement:** Fresh current repository + authenticated CRM walkthrough by real role + sales-workflow/data tracing; historical reports are checklists/evidence only, never treated as current truth.  
**Do not close this lane until:** accessible CRM routes, tabs, filters, actions/mutations, object permissions, loading/error/empty/degraded states, mobile/desktop behavior, and the rep workflow have actual evidence. See Section 14 for the current sequencing authority.


---

## 12. Public Website & Inbound — Fresh Audit Entry (2026-09-28)

**Audit SHA:** `8bf8318762963eb2298aad386b136c7361de54e0`  
**Methods used:** current GitHub source + deployed public-site HTTP/HTML inspection.  
**Not performed:** no Replit interaction; no production mutation; no real-lead form submissions; no authenticated cloud-browser session. Interactive browser/mobile/console certification remains pending because that execution surface was unavailable in this chat.

### WEB-01 — Public merchant terms contradict each other on contracts and early termination fees

| Field | Value |
|---|---|
| Lane | Public Website / Commercial Claims |
| Severity | `P1` |
| Status | `PARTIAL — core conversion pages corrected; affiliate/partner public claim residuals remain` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary surfaces | Homepage, Get Started, Merchant Application, FAQ/Help, Terms, Refund Policy |

**Finding**  
Customer-facing pages state variants of `Cancel Anytime. No Early Termination Fee. No Penalty.` and `no cancellation fees`, while the Terms/Refund Policy and global footer state that agreements may have 1–3 year terms and early termination fees may apply, including a stated typical range of roughly $295–$595.

**Why it matters**  
These are contradictory statements about a material commercial term. A merchant should not receive a categorical no-ETF promise on a conversion page while the governing/legal pages say an ETF may apply.

**Required correction**  
Establish one governed contract/ETF claim and use conditional language everywhere unless the exact offer is guaranteed to be a no-ETF program. Bind marketing copy, FAQ/help, application copy, AI/knowledge content, SSR pages, and legal disclosures to that authority.

---

### WEB-02 — Merchant application forces PEWC/TCPA marketing consent despite saying consent is not required for service

| Field | Value |
|---|---|
| Lane | Public Website / Application / Consent |
| Severity | `P1` |
| Status | `MERGED — PEWC no longer required to submit; browser/runtime verification pending` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary file | `client/src/pages/MerchantApplication.tsx` |

**Finding**  
Final-step progression requires `reviewConfirmed && pewcConsent`. The immediately adjacent PEWC disclosure says the applicant understands this consent is **not required to obtain services**. The server finalize DTO itself treats `pewcConsent` as optional, so the mandatory behavior is a frontend constraint rather than a backend necessity.

**Required correction**  
Separate application/underwriting assent from optional automated marketing/contact consent. A user must be able to submit the merchant application after accepting required application terms without being forced to grant optional PEWC marketing consent.

---

### WEB-03 — Free Analysis requires marketing-contact consent to obtain the advertised free analysis

| Field | Value |
|---|---|
| Lane | Public Website / Lead Capture / Consent |
| Severity | `P1` |
| Status | `MERGED — marketing consent no longer required to obtain Free Analysis; runtime verification pending` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary file | `client/src/pages/FreeAnalysis.tsx` |

**Finding**  
The final Free Analysis step cannot proceed unless the marketing checkbox is checked. The checkbox grants calls, texts, and email marketing communications. This makes marketing consent a condition of receiving the advertised free analysis, while other forms correctly treat PEWC as optional.

**Required correction**  
Separate the requested service response from optional marketing-channel consent. Preserve transactional response authority without converting service submission into mandatory promotional consent.

---

### PRIV-01 — Cookie preferences do not control GA4/Meta loading; Google Consent Mode is absent

| Field | Value |
|---|---|
| Lane | Public Website / Privacy / Ads |
| Severity | `P1` |
| Status | `MERGED — Consent Mode/tag gating implemented; browser network verification pending` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary files | `client/src/components/CookieConsent.tsx`; `client/src/lib/tracking.ts` |

**Finding**  
The cookie banner stores `necessary/analytics/marketing/functional` choices in localStorage. The tracking module initializes at module load and injects GA4 and Meta Pixel whenever their IDs are configured. It does not read the stored preferences and contains no Google Consent Mode calls (`gtag('consent', ...)`).

**Why it matters**  
`Reject Non-Essential` / custom preferences are not currently demonstrated to control analytics/marketing tag execution. The banner and the actual tag behavior are separate systems.

**Required correction**  
Default analytics/marketing consent appropriately before tag initialization, wire banner state to the tag layer, implement/validate Consent Mode where required, and add browser tests proving tag/network behavior for accept/reject/custom states.

---

### ATTR-01 — Click-ID attribution is incomplete and inconsistent across public conversion paths

| Field | Value |
|---|---|
| Lane | Public Website / Attribution / Ads |
| Severity | `P1` |
| Status | `PARTIAL — GCLID/booking continuity improved; raw FBCLID/MSCLKID authority remains unresolved` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary files | `client/src/lib/utm.ts`; `client/src/pages/FreeAnalysis.tsx`; booking URL helper; acquisition reporting |

**Finding**  
The canonical UTM helper stores raw `gclid`, but only boolean presence for `fbclid` and `msclkid`; raw Meta/Microsoft click IDs are not preserved. Booking links propagate UTM values but not click IDs. Free Analysis manually captures only UTM query keys into its local state, then sends `utmParams.gclid`, which is never populated by that local capture path. Acquisition readiness also contains historical/stale `gclidCaptureActive: false` reporting despite other forms now capturing GCLID.

**Required correction**  
Define one governed acquisition-attribution payload and use it on every public form and booking handoff. Preserve supported raw click IDs where policy allows, report capture truthfully, and test source continuity from landing page through contact/deal and offline conversion export.

---

### INB-01 — Callback intake has weak identity/deduplication semantics

| Field | Value |
|---|---|
| Lane | Public Website / Inbound CRM |
| Severity | `P1` |
| Status | `MERGED — phone identity/ambiguity review implemented; isolated runtime canary pending` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary route | `POST /api/public/callback` |

**Finding**  
Callback intake has no email identifier and always calls `writeContact()` with `email: ""`. The public-form consolidation service explicitly exempts callback from the normal existing-contact path. Repeated legitimate callback submissions with different idempotency keys can therefore create multiple contacts/deals for the same phone/person unless a deeper writer constraint happens to stop them. Current clients validate only non-empty name/phone, not a normalized telephone identity.

**Required correction**  
Give callback requests an explicit phone-based identity/review policy rather than blind create. Preserve distinct request occurrences while linking them to the same canonical contact when identity is sufficiently strong, and route ambiguity to review rather than duplicating contacts.

---

### INB-02 — Several public clients generate idempotency keys per HTTP attempt, not per logical submission

| Field | Value |
|---|---|
| Lane | Public Website / Inbound Reliability |
| Severity | `P2` |
| Status | `MERGED — stable logical-submission keys implemented across audited public clients; replay canary pending` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary file | `client/src/lib/queryClient.ts` |

**Finding**  
The server-side inbound claim system is strong, but the generic `apiRequest()` creates a new UUID whenever a public POST is issued without an explicit key. Get Started, Estimate, callback widgets, support and other callers do not all retain a key across an ambiguous timeout/retry. Statement Upload and Free Analysis do retain a logical-submission key and demonstrate the safer pattern.

**Why it matters**  
If the first request commits but the browser loses the response, a user retry can receive a new key and become a second request occurrence, defeating replay protection at the client boundary.

**Required correction**  
Generate one key per logical form submission and retain it through retries until definitive success/reset for every durable public mutation.

---

### INB-03 — Server-side hostile-input validation is inconsistent across public lead forms

| Field | Value |
|---|---|
| Lane | Public Website / Inbound Validation |
| Severity | `P1` |
| Status | `PARTIAL — estimate/support/get-started improved; callback and Free Analysis still lack full strict bounded server schemas` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |

**Finding**  
Several frontends have useful Zod/client validation, but equivalent server schemas are not uniformly enforced. Examples: Free Analysis checks only first name + email at route entry; callback accepts non-empty strings; estimate/get-started/support handlers destructure request bodies without a route-level Zod contract. Public rate limiting and field allowlists reduce blast radius but do not replace server validation.

**Required correction**  
Create canonical server-side schemas for every public form: bounded lengths, normalized email/phone, allowed enums, numeric/range constraints, unexpected-field policy, and safe error codes. Keep frontend validation as UX, not authority.

---

### WEB-04 — Merchant application contains unresolved `[Bank Partner]` production placeholder

| Field | Value |
|---|---|
| Lane | Public Website / Legal / Trust |
| Severity | `P1` |
| Status | `MERGED — placeholder removed and source regression scan added` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary file | `client/src/pages/MerchantApplication.tsx` |

**Finding**  
The application review/success UI still renders `Liberty Bancard is a registered ISO of [Bank Partner]` in current source.

**Required correction**  
Replace with the approved exact disclosure, or remove the unsupported bank-partner wording until a canonical legal disclosure is available. No placeholder may ship on the production application journey.

---

### WEB-05 — Public claims have multiple content authorities and are already drifting

| Field | Value |
|---|---|
| Lane | Public Website / SEO / Claim Governance |
| Severity | `P1` |
| Status | `PARTIAL — homepage authority improved; public affiliate/partner claims remain outside canonical claim governance` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |
| Primary files | `client/src/lib/site-content.ts`; `client/src/pages/Home.tsx`; `server/ssr/home.ts`; `server/ssr/pages.ts`; compare/help/legal content |

**Finding**  
`site-content.ts` declares itself the canonical public marketing-claim contract, but major pages and SSR files still hardcode statistics, savings claims, testimonials, contract claims, and offer language independently. Current live HTML and source show materially different claim sets across routes. Examples include a hardcoded homepage fees-identified statistic outside the canonical stats object and multiple different savings ranges on Statement Upload, Estimate, comparison and other pages.

**Required correction**  
Create one versioned claim registry/provenance contract for commercial claims used by client pages, SSR, FAQ/help, sales content and AI knowledge. Claims should carry source/effective date/qualifiers and fail review when unsupported or contradictory.

---

### WEB-06 — Current public accessibility/performance certification is not executable evidence

| Field | Value |
|---|---|
| Lane | Public Website / UX / Accessibility / Performance |
| Severity | `EVIDENCE` |
| Status | `OPEN` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |

**Finding / gap**  
The repository contains historical visual QA and an SEO crawler, but no current Axe/Pa11y/Lighthouse-style accessibility/performance gate was found. Source contains many good accessibility practices, but that does not prove keyboard order, contrast, focus behavior, responsive overflow, CLS/LCP/INP, console errors, or real mobile usability on the current deployed build.

**Required evidence**  
Interactive browser certification at representative mobile/desktop widths plus automated accessibility/performance measurements on the final candidate.

---

### INB-E01 — Production inbound assignment policy is not proven from GitHub

| Field | Value |
|---|---|
| Lane | Public Website / Inbound Sales Handoff |
| Severity | `EVIDENCE` |
| Status | `OPEN` |
| Discovered at SHA | `8bf8318762963eb2298aad386b136c7361de54e0` |

**Source result**  
The current inbound authority correctly creates assignment evidence, one request-owned task and an SLA deadline derived from source receipt time. Missing/invalid assignment policy or exhausted capacity leaves the request review-required instead of falsely claiming assignment.

**Evidence still required**  
GitHub does not contain the live value of `INBOUND_ASSIGNMENT_POLICY_JSON`. Production must prove that the actual reps, active flags, territories, capacities and ownership identifiers are configured and that one isolated inbound canary lands on the intended rep/task/SLA.

---

### Public-site positive controls verified in source

The following are retained as positive evidence, not findings:

- Public lead endpoints are rate-limited in production.
- JSON public intake is durably claimed before business mutation.
- Statement Upload has a stable client idempotency key, content fingerprint and durable command handoff.
- Statement file uploads are memory-bounded to 10 MB and MIME-filtered.
- Existing email-identified public contacts use a protected merge path that prevents public forms from overwriting DNC/status/readiness/GHL/compliance fields.
- Sales-form requests create request-owned work links and SLA evidence.
- Missing assignment authority does not silently report a successful assignment.
- Statement Upload, Get Started and Estimate allow PEWC to remain unchecked; the forced-consent defects are not universal.
- Production CSP no longer includes `unsafe-inline` for scripts; development retains it only for HMR.

### Public Website & Inbound closure state

**Current lane status: `NOT CERTIFIED — POST-MERGE RESIDUALS + INTERACTIVE RUNTIME EVIDENCE REQUIRED`.**

Source/HTTP audit is complete enough to identify the current structural defects above. Final lane certification still requires:

1. exact deployed SHA identity;
2. interactive desktop/mobile walkthrough of all public route families;
3. browser console/network evidence;
4. consent-banner accept/reject/custom network proof;
5. isolated form canaries proving contact/deal/ticket creation, dedupe, assignment, task/SLA and receipt replay;
6. failure/degraded rehearsal without real prospect sends;
7. current accessibility/performance measurements;
8. revalidation after remediation.


---

## 13. Stage 1 + Stage 2 Post-Merge Verification — 2026-10-01

**Audited current GitHub `main`:** `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827`  
**Commit title:** `Published your App`  
**Migration journal:** 317 entries; head `0312_contact_business_system_links`  
**Method:** independent current-tree review plus GitHub Actions evidence. No Replit messaging and no production mutation.

### 13.1 GL-01 / Stage 1 implementation result

Owning merged commit: `420f15f363480c3c422f98d36209964e85e7c4f3`.

The six GL-01 corrections are still present in the current publish-marked tree:

- `SEC-01`: internal deal proposal read now uses `isDashboardUser` plus `authorizeDealAccess()`.
- `SEC-02`: session-validity authority failure now returns `session_validation_unavailable` and protected guards fail closed with a retryable `503` rather than treating authority failure as valid.
- `REL-01`: GitHub-hosted `npm ci` now succeeds and the Replit-internal tarball-host defect is absent from the active lockfile. CI run `#407` completed dependency installation and locked-dependency policy successfully.
- `REL-02`: `scripts/run-pre-deploy.sh` now establishes the repository's provider-deny/zero-egress boundary around the server-required certification process rather than only enabling GHL fail-fast.
- `ADS-01`: offline-conversion export is now `admin`/`manager` only.
- `CFG-01`: checked-in `NIGHTLY_DISCOVERY_ENABLED`, `LEGACY_OUTREACH_ENABLED`, and `ORCHESTRATOR_ENABLED` are all `false`.

**Stage 1 implementation verdict:** `MERGED AND PRESERVED IN CURRENT HEAD`.

This is **not** the same as final Platform / Security / Release certification. Exact production identity, runtime role behavior, runtime environment overrides, and a green full current-head CI are still required.

### REL-04 — Current publish-marked head is release-red because the SFP structural regression test is stale against the safer current implementation

| Field | Value |
|---|---|
| Lane | Platform / Release + Prospecting / Enrichment |
| Severity | `P1` |
| Status | `OPEN — RELEASE GATE / TEST DRIFT` |
| Observed at SHA | `74a5307b2c4dcfd9e5e09fefa3ce1a14603e0827` |
| GitHub Actions | CI run `#407`, run id `36844957258` |
| Failing suite | `scripts/test-sfp-pipeline-correction.mjs` |

**Evidence**

The old clean-install blocker is fixed: dependency install, locked dependency policy, and manifest validation all passed. The deterministic suite then failed on two source-shape assertions.

A deeper current-tree inspection shows the intended safety properties are present:

1. `sfp-validation.ts` awaits `db.transaction(...)`, whose callback returns `openSfpCandidatePlaintext(...)`; plaintext remains inside the audited callback/transaction boundary and the boundary itself rejects plaintext escape. The static test still requires the obsolete literal shape `await openSfpCandidatePlaintext(`.
2. `sfp-validation.ts` calls `isCanonicallySuppressed([emailHash, contactEmailTokenHash], tx)` before provider use and again after provider wait. The static test regex expects a one-argument `isCanonicallySuppressed([...])` source shape and therefore fails when the transaction executor is passed as the second argument.

Because the static job failed, the external dependency/build-scan steps after it and the Integration Tests job did not complete.

**Interpretation**

This is a **release-gate/test-drift defect**, not currently evidence that the SFP runtime implementation lost the two safety properties. The test must be updated to assert the current behavioral/structural contract without pinning an obsolete call-site spelling. The safety assertions themselves must not be removed.

**Required closure**

- Update `scripts/test-sfp-pipeline-correction.mjs` so it recognizes the current audited transaction/plaintext-boundary call and the two-hash suppression call with its transaction executor.
- Keep assertions that plaintext cannot escape and that both candidate + contact hashes are suppression-checked before and after provider wait.
- Re-run the exact current-head CI through static, external-security, build-scan, and integration stages.

### 13.2 GL-02 / Stage 2 implementation result

Owning merged commit identified during the audit: `5885c35d582108cbb9f4aaaec17ef3a89d5de75e`.

**Confirmed landed and preserved**

- Merchant application PEWC is optional; required review/application assent remains separate.
- Free Analysis no longer requires marketing consent to proceed.
- Cookie consent now drives Google Consent Mode state and Meta initialization rather than being a storage-only banner.
- Explicit unchecked optional consent is no longer automatically converted into an opt-out in the corrected audited paths.
- Public clients audited by GL-02 now retain stable per-logical-submission idempotency keys instead of relying on a new generic key per HTTP retry.
- Callback intake now normalizes phone identity, reuses one unambiguous contact, and sends multiple-match ambiguity into durable review rather than picking/duplicating blindly.
- The merchant application `[Bank Partner]` placeholder is removed.
- Homepage headline/stat rendering now consumes the canonical public-site content registry rather than the old hard-coded count-up values.
- Estimate, Support, and Get Started now have bounded server-side schemas.

**Stage 2 implementation verdict:** `PARTIAL — MATERIAL RESIDUALS REMAIN`.

### WEB-01R — Public contract/ETF claim drift remains on affiliate/partner public surfaces

| Field | Value |
|---|---|
| Lane | Public Website / Commercial Claims |
| Severity | `P1` |
| Status | `OPEN` |
| Current evidence | `client/src/pages/AffiliateProgram.tsx`; `client/src/pages/PartnerBrandedPage.tsx` |

The core Get Started and Merchant Application blanket no-ETF copy was corrected, but current public source still contains:

- Affiliate Program sales talking point: `No long-term contracts or early termination fees`.
- Public partner-branded page: `Zero Risk to Switch` / `No early termination risk`.

These remain inconsistent with the governed Terms/Refund disclosures that some programs can carry 1–3 year terms and ETFs.

**Required closure:** route the affiliate/partner claims through the same conditional commercial-term authority and extend claim regression coverage beyond the two original pages.

### WEB-05R — Claim authority is still incomplete outside the homepage/core forms

| Field | Value |
|---|---|
| Lane | Public Website / Claim Governance |
| Severity | `P1` |
| Status | `OPEN` |
| Current evidence | `client/src/pages/PartnerBrandedPage.tsx`; `client/src/pages/AffiliateProgram.tsx`; `client/src/lib/site-content.ts` |

The canonical registry now owns the homepage statistics, but public partner/affiliate content still hard-codes broader commercial/savings claims such as `Most businesses save 20–40% when they switch`. The current `test-claim-authority.ts` does not prove that all public claim-bearing surfaces consume the canonical authority.

**Required closure:** extend canonical claim ownership/provenance and the scanner to the complete public route/content inventory rather than only the original Get Started/Merchant Application/Home examples.

### INB-03R — Strict server validation is still incomplete for callback and Free Analysis

| Field | Value |
|---|---|
| Lane | Public Website / Inbound Validation |
| Severity | `P1` |
| Status | `OPEN` |
| Current evidence | `server/routes/public.ts` callback handler; `server/routes/imports.ts` free-analysis handler |

Estimate, Support, and Get Started now use explicit bounded Zod schemas. Callback still destructures the public body before an equivalent strict bounded schema, and Free Analysis still begins from raw request fields with only a small required-field check before downstream processing.

**Required closure:** apply the GL-02 strict-schema contract to those remaining lead-intake handlers, including field bounds, normalized phone/email, enums/ranges, unexpected-field policy, and safe error responses.

### ATTR-01R — Raw Meta/Microsoft click-ID authority remains unresolved

| Field | Value |
|---|---|
| Lane | Public Website / Attribution / Ads |
| Severity | `P1` |
| Status | `OPEN` |
| Current evidence | `client/src/lib/utm.ts`; `shared/schema.ts`; booking attribution helper |

GL-02 improved GCLID persistence and now propagates GCLID/landing page through booking handoffs. `fbclid` and `msclkid`, however, are still reduced to presence booleans in the common helper rather than retained as governed raw click IDs. No matching canonical raw fields or explicit corrected presence-only attribution contract was found.

**Required closure:** either preserve the approved raw click IDs end-to-end for the later ads/offline-feedback authority, or explicitly define and test a different canonical contract that does not require them. Do not leave the implementation halfway between those models.

### WEB-07 — GL-02 regression suites are not registered in the canonical CI suite manifest

| Field | Value |
|---|---|
| Lane | Public Website / Release Assurance |
| Severity | `P1` |
| Status | `OPEN` |
| Current evidence | `scripts/ci-suite-manifest.ts` plus GL-02 test files |

GL-02 added focused tests including:

- `scripts/test-claim-authority.ts`
- `scripts/test-cookie-consent-tracking.ts`
- `scripts/test-consent-unchecked-not-optout.ts`
- `scripts/test-callback-identity.ts`
- `scripts/test-callback-review-disposable.ts`
- `scripts/test-public-route-validation.ts`

The current canonical CI suite manifest does not register these task-owned regression suites. A developer can therefore regress GL-02 behavior without the canonical current CI necessarily exercising those tests.

**Required closure:** register the applicable deterministic/static/disposable suites in the canonical manifest with correct isolation metadata; prove CI actually executes them.

### 13.3 Stage transition decision

**Historical decision — superseded for sequencing by the owner’s completion update in Section 14.** Preserve the findings and verification requirements below; they do not override the current instruction to proceed to Stage 3.

Do **not** mark Stage 2 certified and do **not** start Stage 3 as though the inbound/public baseline were closed.

The bounded next closure pass is:

1. close `WEB-01R` / `WEB-05R` public claim residuals;
2. close `INB-03R` callback + Free Analysis strict validation;
3. close or explicitly resolve `ATTR-01R` before the later Ads/Attribution lane;
4. register GL-02 regression tests (`WEB-07`);
5. repair `REL-04` stale SFP structural regression assertions without weakening the intended safety contract;
6. re-run current-head CI and Stage 1/2 source verification;
7. perform the remaining interactive browser/runtime canaries when that execution surface is available;
8. then begin Stage 3 CRM & Sales Operations against the corrected baseline.


---

## 14. Authoritative Go-Live Stage Sequence and Owner Update — 2026-10-01

**Authority:** Owner instruction in the current conversation.  
**Update type:** Program sequencing and reported task-completion status; no fresh source or runtime audit was performed for this update.  
**Ledger role:** Continuing reference and working record for all remaining Go-Live tasks and audits. Update this same document after every task and every audit.

### 14.1 Current progress

- **Stage 1:** Completed, fixed, and merged — owner confirmed.
- **Stage 2:** Completed, fixed, and merged — owner confirmed.
- **Stage 3:** Next audit stage; game plan authored 2026-10-01; live audit not yet performed. See Section 15.
- **Stages 4–8:** Remaining staged work; historical source reviews do not establish fresh end-to-end completion.
- **Stage 9:** Final certification intentionally deferred until prior product lanes have finished remediation. No release SHA freeze now.
- **Stage 10:** Final nine lane-specific GO/NO-GO verdicts remain pending.

The owner’s completion report supersedes the earlier instruction in Section 13.3 to defer Stage 3. Preserve the older residual findings and discovery evidence. Do not label them independently CLOSED merely from this status update. At the next relevant verification, append their fixing task/merge SHA, deployment evidence, regression results, and runtime evidence, or retain an explicit verification gap. This does not reopen owner-completed tasks merely because old evidence has not yet been refreshed.

### 14.2 Fixed sequence

| Stage | Audit / task stage | Required scope | Current program status |
|---|---|---|---|
| 1 | Current-state safety preflight | Confirm production is stable enough to test: auth is not catastrophically open; outbound/send gates paused; provider spend controlled; test data isolated; DB/Redis healthy enough; approximate running version known. This is an audit-safety check, with no SHA freeze. | COMPLETED / FIXED / MERGED — owner confirmed |
| 2 | Public website + inbound acquisition | Exercise every form, CTA, attribution path, consent state, validation/error behavior, CRM creation, assignment, dedupe, SLA/task creation, mobile behavior, and degraded integration case. | COMPLETED / FIXED / MERGED — owner confirmed |
| 3 | CRM + sales operations | Walk the authenticated CRM by real role; exercise actual routes, tabs, filters, buttons, mutations, loading/error/empty states, permissions, mobile/desktop, and the rep workflow. | NEXT |
| 4 | Prospecting/enrichment + campaigns/outbound | Prove #1998–#2002, Sunbiz, free enrichment, Serper/OpenAI/Apollo/Outscraper/ZeroBounce, the five verticals, campaign staging, enrollment, suppression, bounce/reply handling, worker profiles, and schedules end to end. | PENDING — historical partial source evidence retained |
| 5 | Application → underwriting → processor → MID | Exercise the merchant application lifecycle with protected test records and processor sandbox/canaries. | PENDING |
| 6 | Onboarding → support → processor activity → residuals → commissions/revenue | Prove the post-sale business closes the loop across these workflows. | PENDING |
| 7 | Ads, attribution and conversion measurement | Finish landing pages, UTM/click IDs, GA4, Google/Meta, offline conversions, consent behavior, deduplication, conversion taxonomy, budgets, and stop thresholds. | PENDING — historical partial source evidence retained |
| 8 | Sales training + AI operational readiness | Finalize the rep workflow, approved claims, talk tracks, AI permissions, coaching, certification, and documentation against the CRM that now exists. | PENDING |
| 9 | Platform / Security / Release FINAL certification | Stop feature changes; fix remaining security/release defects from all prior lanes; freeze one SHA; run full CI/security/migration/role/IDOR/build suites; publish that exact SHA; verify it live; verify workers/queues/Redis/integrations/kill switches; test rollback/recovery; bind all certification evidence to that release. | DEFERRED UNTIL PRIOR LANES COMPLETE |
| 10 | Final lane-specific GO/NO-GO | Issue nine separate verdicts using Section 8, each with its certified SHA and evidence. | PENDING |

Stage 4 covers both Prospecting & Enrichment and Campaigns & Outbound; those receive separate final verdicts. Stage 1 is the preliminary safety pass; Stage 9 provides the final Platform / Security / Release verdict. Thus ten ordered stages produce the nine final lane verdicts already listed in Section 8.

### 14.3 Mandatory update after every task and audit

1. Record the date, stage number, task/audit identity, exact SHA reviewed, and methods used. If no code was reviewed, say so; do not reuse an old SHA as though newly audited.
2. Append new findings with stable IDs and evidence. Preserve original discovery evidence and previously recorded fixes.
3. For existing findings, record task ownership, merge SHA, deployment identity, tests actually executed, runtime verification, and the resulting status. Distinguish owner-reported completion from independent verification.
4. Update the coverage register, current stage progress, next audit entry, and change log. Keep unexercised paths explicitly UNTESTED and unavailable evidence explicit.
5. Carry unresolved cross-lane items to the relevant later stage and final certification without silently losing them or restarting completed tasks without fresh evidence of a remaining defect.
6. Save the updated version to this same existing file after every task/audit. Preserve file identity and version history.
7. Keep Section 8 verdicts uncertified until lane evidence and final release binding support them. Never substitute a single company-wide readiness claim for the nine verdicts.

**Next action when the Stage 3 audit is invoked:** Refresh repository/runtime identity and role inventory, then perform the authenticated CRM + sales operations audit. Record all resulting findings and coverage here. No live audit, production mutation, provider activation, or outbound action is authorized merely by this ledger-reference update.


---

## 15. Stage 3 CRM Audit and Redesign Game Plan — 2026-10-01

**Status:** `PLAN AUTHORED — LIVE AUDIT PENDING`.  
**Task:** Stage 3 game-plan authoring requested by the owner. No build task number assigned.  
**Plan:** [Liberty Bancard Stage 3 CRM Audit and Redesign Game Plan](https://chatgpt.com/space/page_bdb0fc8cc3bc8191bf890e19796ccbbc).  
**Companion file:** `LIBERTY_BANCARD_STAGE_3_CRM_AUDIT_AND_REDESIGN_GAMEPLAN.md`.  
**Methods:** Read the historical CRM UI/tab audit, canonical-source audit, execution roadmap, end-to-end lifecycle roadmap, and the current ledger. Designed the execution plan and proposed reconciliation from those references and the owner’s scope.  
**SHA reviewed during this authoring task:** None. Historical reference SHAs are labelled in the plan; the last independently audited baseline in Section 2 is unchanged.  
**Runtime/browser tests:** Not performed. No source, production, provider, outbound or permission changes made.

### 15.1 Execution passes

| Pass | Scope | Required evidence/output |
|---|---|---|
| 1 | Refresh current source/runtime identity and inventory all routes, navigation, tabs and actions | Full register with current denominator, roles, APIs, authority and lifecycle |
| 2 | Authenticated role walkthrough and direct route/API/action verification | Expected/actual, persisted effect, failure/retry and role/object access results |
| 3 | Controlled rep/manager sales journeys and data reconciliation | Workflow breaks, count/identity/ownership truth, click/time/performance baseline |
| 4 | Navigation reconciliation and UI/workflow design | Exact old-to-new route/tab/action map; shared design specification; desktop/mobile prototype |
| 5 | Prioritized bounded repairs, implementation and re-test | Task/merge/deployment/runtime evidence, regression coverage, updated ledger |

### 15.2 Proposed navigation

Initial candidates, pending current inventory and user-workflow validation:

- Work and Sales: My Day, People, Businesses, Pipeline, Inbox, Tasks/Calendar, Ready for Outreach, Statements/Proposals.
- Lead Operations: raw inventory/sources, imports, discovery, enrichment, identity review, classification, data quality, run history.
- Campaigns and Delivery: campaigns, sequences, audience/preflight, delivery analytics, deliverability.
- Merchant Operations: applications, underwriting, boarding/onboarding, portfolio, support/RFIs, merchant health, residuals/commissions.
- Reporting: sales, team operations, acquisition, outreach, merchant/revenue.
- Administration and System: users/access, integrations, automation, queues/incidents, data integrity, consent/compliance, audit/release.
- Resources: knowledge, playbooks, collateral, training and scoped AI.

Preserve scoped partner/merchant portals and distinct partner/content/growth workspaces where the current inventory establishes their purpose. Keep a small daily navigation for agents, with contextual shortcuts to the canonical destination. Do not delete or merge modules merely from this proposal.

### 15.3 Coverage and closure requirements

Every current route, tab and action receives a tested or explicit blocked/untested/disposed result. Prove meaningful actions through the correct service and persisted outcome, not only clickability/toasts. Include ownership/role denials, direct URLs, invalid/stale/double/retry behavior, loaded/empty/error states, accessible desktop/mobile use, deep-link preservation and record/report consistency.

Stage 3 inspects the CRM surfaces for later-stage enrichment, campaign, application, processor, revenue and attribution workflows, but their full external operational proof stays in Stages 4–7. Training certification stays in Stage 8. Final release freeze/certification stays in Stage 9. Final nine lane verdicts remain uncertified.

**Next:** Run the Stage 3 current repository and authenticated CRM audit using the linked game plan; append findings with current source/runtime evidence. No audit results or independent closures are inferred from writing this plan.


---

## 16. Stage 3 Reference Audit Reconciliation and GHL Sync Instruction — 2026-10-01

**Status:** `PLAN UPDATED — REFERENCE FINDINGS UNVERIFIED`.  
**Owner instruction:** Use the two attached dashboard audits ONLY for reference; add a bottom section requiring verification and reconciliation of all findings. Keep outbound emails paused without turning GHL sync off.  
**Plan updated:** Section 13 of [Stage 3 CRM Audit and Redesign Game Plan](https://chatgpt.com/space/page_bdb0fc8cc3bc8191bf890e19796ccbbc), plus the opening operating-posture paragraph.  
**Sources read:** `Liberty Bancard — Dashboard Audit: Findings, Bugs & Fix List.docx`; `What's Broken (Oct 2026).docx`. Both are source claims, not current independent verification.  
**Source/runtime audit SHA:** None for this document update. No authenticated CRM/GHL testing, production configuration changes, cleanup or sends performed.

### 16.1 Required operating posture

- Outbound email stays paused across CRM and GHL-triggered paths.
- GHL data sync stays enabled and operational as a separate capability. Check actual effective configuration, worker progress, mapping and receipts. If currently off, identify the defect and recovery path; do not falsely mark it active.
- Synchronization must not cause downstream email through tags/stages/workflow enrollment that bypasses the pause. Verify local transport and external workflow effects separately.
- UI must show separate truthful sync and sending states; stale/unavailable sync cannot be “All Systems Healthy.”
- Do not broadly enable killed jobs, publish workflows, raise sending caps, push raw inventory, or recreate reported fake opportunities from stale IDs.

### 16.2 Reference coverage added

The plan now explicitly crosswalks D1–D22, DEV-23–DEV-29, the reported miswired Delete Contact control, the developer P0-05 relationship-view requirement, G1–G11, all mirror comparisons, remaining section/route observations, claimed positive tests, sample-quality/scoring/activity assertions, recommendations and reported cleanup mutations.

For each claim require current evidence and a disposition: confirmed, partly confirmed, fixed verified, not reproduced, disproved, expected control, proposed upgrade, superseded state, or blocked/untested. Preserve original source IDs and dates. Reassess severity rather than copying a reference’s P0 label. Link duplicate claims to one canonical ledger finding without losing source traceability.

### 16.3 Conflicts and recommendations requiring special handling

- Email tests denied by a deliberate pause may be correct; do not unpause to pass them.
- The full audit’s earlier 1,175 GHL opportunities and the developer recap’s later reported zero after deletion must be reconciled. Do not migrate/restore those reported fake deals. A reported restore window is not an irreversible purge.
- Refresh cleanup counts, archive/delete/pause results and stalled real-sequence memberships; attachments grant no new destructive cleanup authorization.
- Resolve the explicitly corrected ticket identities, task/deal/notification count scopes, failed-create-after-commit behavior and sending-identity removal/reseed history.
- Local and GHL stage/workflow/user counts need semantic ownership/mapping, not forced numerical equality.
- Sample plausibility does not establish database-wide validated identity, email validity, target fit or eligibility. QQ-domain/numeric-local-part alone does not prove a bogus email.
- Do not purge immutable consent/audit evidence merely because IP/UA resembles a test.
- Form builders, one-to-one composer, invite/deactivate/archive controls and the complete merchant relationship view require current capability assessment; missing preferred controls are not automatically defects.

**Next:** Execute Stage 3 using the updated plan and settle all reference claims with current evidence. Stage 3 remains live-audit pending; final lane verdicts and reviewed-source baseline are unchanged.


---

## 17. Stage 3 Live CRM and Repository Audit — 2026-10-01

**Status:** `DISCOVERY / ACCESSIBLE ADMIN WALKTHROUGH RECORDED — STAGE 3 NO-GO; REMEDIATION AND CERTIFICATION OPEN`.
**Owner authorization:** Proceed with the full updated Stage 3 CRM audit through the cloud browser and audit the repo. Two dashboard audits remain reference-only.
**Report:** [Stage 3 CRM Audit Results and Redesign Specification](https://chatgpt.com/space/page_50935c4368b48191a57998a7e69abe8d).
**Companion artifacts:** `LIBERTY_BANCARD_STAGE_3_CRM_AUDIT_RESULTS.md`, five CSV registers, `CRM_WORKSPACE_DESIGN_PROTOTYPE.html`, `STAGE_3_CRM_AUDIT_EVIDENCE.zip`; the existing Stage 3 game-plan file/Page is updated with the execution status.
**New implementation task numbers:** None assigned.

### 17.1 Current baseline and controls

| Item | Independently observed evidence |
|---|---|
| Repository/source | `scottpstevenson/Liberty-Bancard-Website-and-CRM`, main `37ad19cb8c73492dbc3bf37ed7b50739b48c3315` |
| Reviewed tree | `9c25c9807349a7d2d7fc7daeadaae03bf64fd8b4` |
| Production health | `ok`, SHA `119079c9b52e06c36e8b7a7666ba0aec5791fa23`, built `2026-10-01T21:29:51.616Z`, production |
| Serving-source gap | Reported runtime SHA differs from GitHub; fetch returned “not our ref.” Source conclusions remain bound to reviewed SHA; deployed equivalence unproved. |
| Live role | Admin only; other roles reviewed in source and remain untested live. |
| Outbound | Global pause observed; no sends or unpause. |
| GHL sync | Found already killed, last run 26 days ago; data writes gated by send authority in reviewed source. Required independent sync remains OPEN. This audit did not disable it. |
| Automations | Current UI 12/19 killed; old 12/20 denominator superseded. Enabled status alone does not prove fresh execution. |
| Source / production mutation | No source fixes, commit, PR, deployment, cleanup, permissions/settings change, invitation, worker activation or provider run. Browser navigation/filter/dialog and rejected blank-input tests only. |
| Final SHA freeze | NO; Stage 9 only. |

### 17.2 Coverage and proof boundaries

146 explicit dashboard registrations: all 142 static paths reached; contact, canonical-business and mobile-contact fixtures cover three of four parameterized patterns (**145/146 route patterns traversed**). Company Detail fixture/consumer remains missing. Primary hubs, 22 Contact Detail sections and 46 operator panels explored. Operator click navigation is broken; panel review used parent-preserving deep links.

542 browser observations are preserved with evidence IDs; 309 tab/panel observation-context rows and 8,704 visible-control context rows are inventory entries, **not unique capability counts or mutation passes**. Selected dialog/required-field and search/status-filter behavior proved. Successful persisted mutations, full role/object allow/deny, mobile responsive/touch and native GHL data-canary/no-downstream-email proof remain blocked/untested. No percentage of all actions or roles is claimed.

### 17.3 New Stage 3 finding register

| Finding | Severity / proof limit | Discovery | State |
|---|---|---|---|
| CRM3-01 | EVIDENCE / release blocker | Production cannot be bound to the reviewed source | OPEN |
| CRM3-02 | P1 | Stock CI cannot install its lockfile | OPEN |
| CRM3-03 | P1 | GHL sync is killed and data writes share the send pause | OPEN |
| CRM3-04 | P1 | Connected/configured badges falsely imply operational health | OPEN |
| CRM3-05 | P1 | Work counts and AI briefing contradict actionable tasks | OPEN |
| CRM3-06 | P1 | Permissions audit silently returns zero routes | OPEN |
| CRM3-07 | P1 | Queue Holds crashes on its response contract | OPEN |
| CRM3-08 | P1 | Provider Results tab routes back to Businesses | OPEN |
| CRM3-09 | P1 | Operator navigation exits its parent hub | OPEN |
| CRM3-10 | P2 | Financial aliases select the wrong report | OPEN |
| CRM3-11 | P1 | Scope mismatches make lists and reports disagree | OPEN |
| CRM3-12 | P1 | Terminal ROI represents test/new-lead equipment as deployed | OPEN |
| CRM3-13 | P1 | Readiness and contactability advice disagree with actual permission | OPEN |
| CRM3-14 | P1, source-confirmed; live role proof pending | Cold-lead collection and bulk re-engagement lack agent scope | OPEN |
| CRM3-15 | P1 | Re-engagement audience label and value math are unsupported | OPEN |
| CRM3-16 | P1 | Sequence report counts are multiplied by a join | OPEN |
| CRM3-17 | P1, source-confirmed; manager runtime pending | Manager enrollment fetch contract produces misleading empty counts | OPEN |
| CRM3-18 | P1 | Assignment and SLA handoff do not create an actionable rep queue | OPEN |
| CRM3-19 | P1 | Launch probes contain schema-invalid queries | OPEN |
| CRM3-20 | P1, shared Stage 4/9 dependency | Enrichment runtime owner and worker health are not proved | OPEN |
| CRM3-21 | P2 | Dense workspaces bury the rep's next action | OPEN |
| CRM3-22 | P2 | Large panels and bundles need bounded loading | OPEN |
| CRM3-23 | P2 | Provisioning exists but is hard to discover; deactivation must be proved | OPEN |
| CRM3-24 | P2 | Empty and filtered states confuse missing data with missing matches | OPEN |
| CRM3-25 | P1 / EVIDENCE | Security and training readiness remain explicit follow-up items | OPEN |
| CRM3-26 | P2, shared Stages 5–6 | Lifecycle relationship workspace is incomplete | OPEN |

Detailed reproduction, reviewed-source causes, acceptance tests and later-stage ownership are in the report and findings register. These rows are discovery entries, not merged/deployed/closed fixes. Source-only role concerns require controlled live/runtime proof; do not label the site catastrophically open from an empty permissions audit.

### 17.4 Material data and health reconciliations

- Settled Home: 3,073 pending / 3,072 overdue; briefing 3,082 overdue; Tasks one future-due unassigned inbound follow-up. KPI/briefing predicates and AI prompt differ from active task storage.
- Production People default: 153,980; all-class email-health total: 154,382, including 402 Test. Production pipeline zero versus legacy/all-scope 1,572 deals needs explicit scope, not fake-deal restoration.
- GHL settings: 1,915 synced, 152,467 unsynced; read connection works, while killed/stale/error states contradict “All Systems Healthy.” Historical error totals are not asserted as current 24-hour failures.
- Sequence report step × enrollment join inflates counts. Reported 2,097 stalled / roughly 2,040 Referral Flywheel rows are not proved unique real contacts. No cleanup/resume based on them.
- Queue Holds response record/array mismatch crashes; Provider Results URL allowlist omission selects Businesses; operator view clicks lose parent hub tab; financial aliases select Revenue.

### 17.5 Validation evidence

Stock GitHub run 36926922128 / Static Checks job 110586426532 fails at dependency installation; integration skipped. Four lockfile URLs target the private Replit registry. Local stock install also fails. An isolated audit dependency copy rewrote only those four URLs, retaining integrity; repository lockfile/source unchanged.

With the documented workaround: CRM #2056 UI contracts, protected-object static authority, CR-04 static authority, GHL #1629 route pause gates (71 assertions), and Task #1721 structural checks PASS; TypeScript PASS with expanded heap; production client/server build PASS with recorded warnings. Audit runtime Node 24.19.0/npm 11.9.0 differs from prescribed Node 22.22.x/npm 10.9.4. DB/Redis-backed role/mutation/full security suite not run. No final CI/release certification claimed.

### 17.6 Reference reconciliation and design decisions

All D1–D22, DEV-23–DEV-29, unnumbered Delete Contact, P0-05 relationship upgrade, G1–G11, additional positive/negative claims and cleanup families have 69 reference-register rows and explicit dispositions. Native GHL/profile/phone/analytics states and per-record historical cleanup receipts remain blocked. Current counts supersede older snapshots only where observed. Missing composer/invite claims are disproved as absolute UI/capability claims; operational send/invite proof remains open.

No immutable consent/audit logs purged, no user/contact/ticket/sequence/opportunity deletion, no Referral Flywheel clearing, no 532,626-row source job/ZeroBounce batch and no fake GHL-deal rehydration.

Proposed Work/Sales, Lead Operations, Campaigns/Delivery, Merchant Operations, Reporting, Admin/System and Resources groupings retain current canonical authorities and working URLs first. Every route has a proposed group/disposition. Contact Detail becomes five areas plus persistent History. The fictional-data design preview demonstrates contextual note/task and readable related-record links; it proves no live API behavior.

### 17.7 Next work and closure rule

1. Repair access/control/navigation/DTO defects and portable dependency CI; establish accessible serving-source provenance.
2. Reconcile metrics, classes, readiness, sequence math and current worker/probe evidence. Decouple and recover safe data sync with all outbound email held and downstream GHL no-send proof.
3. Implement the scoped core sales workspace; execute protected successful mutations and actual manager/two-agent/merchant/partner/anonymous/session tests.
4. Close Company Detail, mobile/keyboard/accessibility, failure/retry and measured performance gaps; retest the complete registers.
5. Append actual task/PR/merge, deployed build and runtime closure evidence after every task/audit. Preserve this discovery history and earlier stages.

**Stage 3 NO-GO remains.** Stage 3 is not fully executed/certified by broad admin route coverage. Stages 4–8 retain their operational obligations; Stage 9 freezes one exact release; Stage 10 issues nine separate lane verdicts.

---

## 18. Stage 3 consolidated implementation specification — 2026-10-02

**State:** Discovery/reconciliation at documented scope complete; implementation and full functional certification NOT COMPLETE. No repair was implemented, merged, deployed or closed in this consolidation. Stages 1–2 remain completed/fixed/merged in the user’s go-live sequence. Stage 3 remains without an unconditional GO.

**Current working document:** [Liberty Bancard — Stage 3 consolidated implementation specification](https://chatgpt.com/space/page_01d5de8fcd688191a708d3ce9474077c). The accompanying file is `LIBERTY_BANCARD_STAGE_3_CONSOLIDATED_IMPLEMENTATION_SPEC.md`; evidence is `STAGE_3_CONSOLIDATED_EVIDENCE.zip`. Prior plan/report and their evidence remain historical.

### 18.1 Updated source and production baseline

- GitHub main / reviewed source: `51edb7fb3b5698366faf05346f52cbb3a8461973`; tree `4e487f84ca16b002e306a9a190baf4778accf0c4`. Clean detached checkout; compared against original `37ad19cb8c73492dbc3bf37ed7b50739b48c3315`.
- Serving `/api/health`: `26a7da8bf96d80eb7a125bb6521e6140e3b5c8d5`, production, built `2026-10-02T10:36:34.721Z`, publishBuildId `ba1896d0-facc-417c-acb1-74c7ab780f89`, `ghlTransportFailFast=false`.
- GitHub fetch of serving commit returned No Commit Found (422). Serving source and reviewed main are not bound. Build identity now exists, superseding the older absence of a publishBuildId; provenance gap CRM3-01 remains open. This is not the Stage 9 SHA freeze.
- 19 source files changed, 566 additions/7 deletions, mainly SFP runtime/build identity/docs. CRM pages/routes/CSS, contacts/campaigns and package-lock unchanged. Confirmed old source cause anchors remain present; deployed equivalence still unproved.
- User restored cloud-browser sign-in. Scott admin session inspected; 26 fresh C-001–C-026 observations, including loading intermediates. Only settled observations support conclusions.

### 18.2 Consolidation accounting and dispositions

26 Stage 3 tracked entries + 69 reference claim families = 95 **source entries**, with substantial overlap. The specification assigns every entry one primary owner across **14 repair groups** and **four implementation tasks**. Neither 95 nor 14 is a verified unique defect total. Design proposals and pending claims are explicitly separate from confirmed causes.

The original 69 reference dispositions are preserved: 7 confirmed, 19 partial, 6 disproved, 20 blocked/untested, 3 superseded, 4 expected controls, 8 upgrades, 1 not reproduced, 1 declined recommendation. Fresh checks strengthen several rows without proving every subclaim. The bottom reference crosswalk retains all 69 claims and exact evidence/next actions. No unverified historical action is silently closed by count agreement or code existence.

The complete proposal includes all 146 dashboard route patterns and 309 observed panel entries. It preserves role boundaries, query/object context and legacy compatibility; proposes nine principal employee destinations plus Administration/Resources; five-area Contact and Lead Ops views; five Admin groups; shared metric authorities; exact current Liberty tokens/layout/typography; prioritized workflow upgrades and action acceptance contracts.

### 18.3 Fresh confirmed observations

- CRM3-06: Permissions still reports 0 of 0 registered API routes. Express 5 source uses `_router` extraction.
- CRM3-07: Queue Holds still crashes; visible error `(t.desiredLogicalHolds ?? []).map is not a function`. Source UI expects array while coordinator returns Record.
- CRM3-08: Provider Results click changes URL but Businesses stays selected. Source valid-tab list omits provider-results.
- CRM3-09: Worker Heartbeats click loses `tab=monitor`; System Readiness becomes selected.
- CRM3-10: Forecasting and Terminal ROI aliases both select Revenue. Source expects `financialTab`.
- CRM3-05: Home pending 3,075 / overdue 3,072; briefing overdue 3,082 with AI saying no immediate overdue alerts; settled Tasks shows 3 pending unassigned due October 6. Shared scope/status/deletion/asOf reconciliation still needed.
- CRM3-11: Contacts All/KPI 154,407 vs Production 154,005 and Test 402. Home production total 154,005. Different populations are real; same-label/scoped metrics must not obscure them.
- CRM3-13: Contact #159443 internal no-email placeholder earns 25/25 email readiness points while NBA correctly blocks global pause. Data readiness and send permission require separate truthful UI.
- CRM3-18: Current pipeline 2 and task 3 records are unassigned. Pipeline records display Liberty QATest; classification/intended fixture/archive receipts remain pending before any cleanup. Contact shows 3 linked deals vs 2 active pipeline; do not force unlike counts equal.
- CRM3-03/04: GHL Sync killed. Registry 19 automations / 12 killed. Integration says All Systems Healthy while entity rows have stale timestamps and 159 task / 6,929 deal / 1,174 company / 68,549 contact errors. Displayed counters are not unique current failed objects. Sync 1,915 / 154,407 and unsynced 152,492 use unclear predicates; another count 154,411 has unclear asOf/scope.
- Mapping now shows 2/19 local resolved and 4 external stages. Won/lost display same shortened external identifier; full IDs/semantic trigger behavior unverified. GHL stage counts are not required to equal local stage counts.
- CRM3-20: recent active enrichment zero-record run does not prove runtime ownership or queue/provider success. Later Stage 4/9 receipts remain required.

### 18.4 Proposed execution packages

| Task | Scope | Closure requirement |
| --- | --- | --- |
| A — shared authorities, access and sync policy | Source/build/CI; collection/bulk authorization; record and metric scope; enrollment aggregation; manager query contract; independent safe data sync | Portable clean CI, schema/scope tests, exact source/build mapping, fake transport no-send proof, reviewed native trigger safety before isolated sync enablement |
| B — rep workflow and recoverable lifecycle | Task/briefing/assignment/notifications; Inbox and permission; user provisioning/lifecycle; verified relationships; consent/privacy; archive/restore | Durable protected fixtures, eligible routing/dedupe/SLA receipts, correct permissions, cancellation/idempotency/cache/audit/restore proof |
| C1 — routes and shared UI foundation | Destination registry, legacy/tab compatibility, Liberty primitives, loading rules | All route/panel owners; role-safe aliases; tested responsive template; no premature shell cutover |
| C2 — daily sales workspace | Today, Records/contact, Pipeline, Inbox, Work; integrate A/B contracts | Durable rep actions, scoped metrics, real-role/mobile/state/context tests |
| C3 — Prospecting and Campaigns | Five Lead Ops areas, Provider Results, campaign local groups | Correct tabs/aliases and truthful staging/provider states; no-send/no-spend navigation |
| C4 — Merchant Operations and Reports | Lifecycle destinations, financial aliases, shared reporting layouts | Verified links and metric scopes; portal boundaries; Stage 5–6 execution remains separate |
| C5 — Administration, Resources and shell cutover | Five admin groups; Permissions/Queue Holds/Heartbeats; 11-entry shell | Functioning destinations first; safe roles/aliases; diagnostics; measured responsive/accessibility/performance proof |
| D — integrated reconciliation and Stage 3 closure | All reference findings, actual serving build, real roles/actions/metrics/mobile/degraded cases, native GHL/later-lane obligations | Complete evidence matrix and explicit scoped verdict; same document/ledger updated; remaining Stage 4–9 work retains separate owners |

Each task may contain small reviewed commits and its own checks; all testing is not deferred to D. Merged alone is not closed. No hard route removal without consumer inventory and compatibility retirement evidence. No identity merge by display name. No purge of immutable consent/audit records. No unsupported revenue/deliverability/stalled-count conclusions.

### 18.5 Safety and unproved coverage

Outbound communications remain intentionally paused. GHL data synchronization is required to work independently but is currently observed killed and shares the pause boundary. R03 / Task A defines capability separation, allowed noncommunicating fields, external trigger checks, independent sync worker and receipts. This session did not turn on workers, run Sync All, change a kill switch, purchase enrichment, enroll a sequence, send a message, change roles or delete/archive production data.

Real manager/agent/merchant/partner sessions, anonymous/IDOR negative mutations, narrow viewport/touch, durable CRUD/lifecycle, degraded integration responses, native GHL and no-send sync canaries remain unproved. The original 8,704 control observations are not unique button passes; 145/146 route reach and 309 panels are traversal evidence only. No new full CI/security/database/build/role certification is claimed.

**Next authorized scope:** use the consolidated document to execute the grouped implementation work with explicit acceptance and evidence. The current task produced a reviewable specification, not a production release. Stage 3 cannot receive unconditional GO while these workflow/access/sync/metric defects or critical coverage gaps remain. Later Stage 9 certifies one frozen release; Stage 10 issues nine lane verdicts.


## 19. Stage 3 delivery sizing revision — 2026-10-02

The owner requested that the oversized navigation/design task be split. Task C is now a parent scope with five execution tasks C1–C5. A, B and D retain their existing scopes, producing eight proposed execution tasks in total. No Replit task IDs are assigned by this revision.

The consolidated specification Section 10 now contains exact delivery boundaries, source-finding slices, dependencies, acceptance/handoff evidence and staged cutover gates. C1 establishes ownership/components; C2 migrates daily sales; C3 Prospecting/Campaigns; C4 Merchant Operations/Reports; C5 Administration/Resources and final shell cutover. A/B retain backend authority and workflow repairs; C tasks integrate these rather than duplicate them. D verifies the combined serving build after each preceding task has already passed its own checks.

Coverage remains 26 Stage 3 entries plus 69 reference-audit entries, 95 traceable source entries in 14 repair groups. Original dispositions, code anchors, route/panel inventories and closure obligations are preserved. The 146 route patterns and 309 observed panel entries are inventories, not unique screens or functional passes. Splitting C adds no findings and closes none.

The interactive Liberty preview is a design draft using sample data. Its local navigation, notes/tasks/drafts and shared sample counts are not production verification. No source code, runtime setting, GHL switch, outbound gate, provider job, role or production record was changed by this planning revision. Outbound stays paused; safe GHL data sync remains an independent repair requirement. No new live audit or CI certification is claimed.

Next implementation order: agree A/C1 contracts → relevant B contracts and C2 → C3/C4 → C5 guarded shell cutover → D integrated Stage 3 verification. Stage 9 release freeze and Stage 10 lane verdicts remain separate. Update this ledger and the consolidated specification after each task/audit; merged is not closed without the required runtime receipts.


## 20. GHL repair follow-up — 2026-10-02

Fresh repo main: 07898f15d242a8e75aae4aef7ad89b223c7912b9. GHL repairs: 2b276db and 7e9b8425b6ab61c454b59b9a8d8f315bd0dd4d68. Public health now reports the latter SHA, production environment, builtAt 2026-10-02T16:51:26.540Z and publishBuildId 7d09a107-0a12-41ac-9f36-06b6d7f04757. That serving commit is accessible in fetched history; the earlier source mismatch is historical for the old build. Health alone does not prove import/worker completion or pause/control settings.

The current incoming contact repair is one-way GHL → Liberty database: preserve nonblank values, fill missing details, add identifiable unmatched contacts, exact ID/email collision checks, leased/hash/idempotent preview/apply and a local-only no-echo writer. It does not update GHL records, qualify recipients or establish canonical business links/consent. Native-workflow review is not an incoming-read/local-import prerequisite. Separate optional provider-write controls exist but must not be enabled merely to meet incoming requirements.

CRM3-03 is source-remediated with runtime closure pending. CRM3-04 is partially source-remediated; the broad healthy label is replaced with a health-probe label and timestamp. REF-008/009/069 receive qualified follow-up dispositions in the report. GHL runtime fencing improves the GHL slice of CRM3-20 but does not verify SFP enrichment. R06 metric denominators/backlog eligibility, semantic mappings, REF-003 create behavior and native/later-lane claims remain open. No finding is fully runtime-closed from this source review.

Six focused suites rerun and passed: capability policy, truth utilities, inbound sanitization/identity, incoming route guards (42 middleware + 5 input checks), isolated runtime boundary and incoming UI static states (10 checks). Used available dependencies, test mode and a nonworking localhost database URL; no production/provider writes or worker activation. No migrated disposable DB was available for integration certification. No full CI/build or signed-in live browser check is claimed.

Section 12 of the consolidated specification owns the detailed source trace, revised dispositions and exact remaining proof. Task A now verifies/reconciles the implemented incoming flow rather than rebuilds separation. C5 reuses the new components and separates Incoming contact updates / Optional GHL writes / Outbound communications. D verifies production actual counts, durable fields and no echo/send/enrollment. All 95 source entries and 14 repair groups remain; eight execution tasks remain. Original sections 18–19 observations are historical where Section 20/Report Section 12 supersede them.


## 21. Stage 3 current live/source verification — 2026-10-02

Stage 3 remains **OPEN / NOT CERTIFIED**. Current report Section 13 supersedes conflicting older Section 18–20/baseline dispositions. Reviewed main 74c15805a5cbdb3e0a82183c8c56104999075671; serving SHA 4cd62b589cef10a773909414aebe9e71d164dfd8 is accessible, content-equivalent to HEAD, built 2026-10-02T20:12:06.875Z; publishBuildId 88034800-7804-4deb-8a1a-be20a2c279fd. The earlier inaccessible serving-source finding is superseded for this build, but private lockfile install fails current npm ci. No Stage 9 freeze or release certification.

**22 distinct confirmed repair causes** are documented with current source destinations, specific evidence, exact repairs and task mapping. This is a bounded confirmed register, not a final unique-defect count across every composite claim. All 26 Stage 3 +69 reference rows (95 source entries), 14 repair groups and eight tasks A/B/C1–C5/D remain. New repair causes: incoming GHL pagination failure, consent event-kind mislabeling, Knowledge source-list invalid Drizzle call, workflow create/update/run management-role omission. Sequence FK deletion and report join multiplication are reproduced using actual methods/SQL on disposable fixtures. Notification target-resolution and fixed sequence runtime copy sharpen prior reference claims.

**Verified repaired:** Provider Results click/deep-link/reload selects its actual panel; CRM3-08 navigation slice closed. Current incoming GHL control is Enabled, outbound Paused, proposal auto-send Hold for Review. One-way incoming separation and health-probe wording are observed live; do not rebuild them or globally unpause. Current persisted incoming run b9289cb4-c35e-4930-925a-f66ff03a08a2 failed after reading 3,994 with GHL_INBOUND_PAGINATION_INVALID and 0 actual updates/additions. Successful durable import/webhook receipt/no-echo remains open.

Actual contact archive/restore persists with two audit receipts; governed disposable test-class deletion snapshot/preview/execute succeeds with idempotent retry and production-class denial. Those prove actual components/handlers, not all production UI actions. Workflow Edit/Cancel, contact search/menu and selected tabs work; no production Save/Delete/Run/activation was submitted.

All 40 previously unresolved reference entries now have individual current dispositions and attempted evidence checks in report Section 13. Native GHL sign-in did not complete; native profile/token/campaign/channel/historical opportunity claims remain blocked. Historical cleanup/identity fixes require exact immutable IDs and receipts, not population-count guesses. Composite partial rows remain qualified; no assertion that all 40 or every tab/button/role/mobile flow was verified.

Focused GHL/inbox/consent tests pass; separate disposable tests reproduce counts/schema/query/guard/FK defects and prove safe contact lifecycle handlers. Audit-only public dependency directory and PGlite current-schema fixture were used after stock install failed. Node/runtime differs from declared supported versions; no full canonical migration, stock CI, build, native PostgreSQL concurrency or live role suite certified. No repository source/lockfile modification, merge, deployment, provider send, enrollment, purchase or production purge.

Keep 11 proposed destinations and exact Liberty design tokens/layout contract; retain C1–C5 delivery split. Amend A for pagination and workflow authority, B for actual handlers/consent/knowledge/notification/sequence policies, C3 for runtime count/truth, C4 for actual financial semantics, C5 for diagnostics/error states. D must prove final actual serving build with real roles, protected durable UI fixtures, mobile, degraded cases, same-scope metrics and no-send/no-echo receipts. Stages 1–2 remain recorded completed; no later lane certified by this audit. Update ledger/report after each task and audit.


## 22. Stage 3 Task A/B master prompts and current-source preflight — 2026-10-02

Created two master Replit preflight+build prompts grounded in a fresh clone of main 74c15805a5cbdb3e0a82183c8c56104999075671 and current handler/authority/CI source inspection. Serving health has changed to 1fe28bc0d1ff9ad86e777c96b67902701f159fd8, built 2026-10-02T21:40:33.861Z, publish ID a17e3a59-81fe-4ad6-80ab-0b2b27b8ec61; reported commit fetch fails not our ref. Prior 4cd62b source equivalence is historical, not current certification. A must reconcile current Replit serving source/lockfile/build receipts; safe reviewed source work continues with explicit provenance limits.

Task A owns reproducible lockfile/CI, shared contact/task/report authority, cold-lead and workflow authorization, sequence aggregation/manager read, financial truth and existing incoming pagination/no-echo repair. Task B consumes A contracts and owns durable tasks/briefing/routing/SLA/notifications, readiness/inbox drafts, consent/privacy request states, recoverable contact/sequence/campaign/ticket/user lifecycle, relationships/workflow consumer actions and actual Knowledge SQL/error repair. Full UI/navigation/token rollout remains C1–C5; native/historical/integrated obligations remain D/later stages. All assigned confirmed/partial/unverified/disproved/upgrade/history rows retain individual proof requirements and exact owner boundaries.

Prompts: LIBERTY_STAGE3_TASK_A_PREFLIGHT_BUILD_MASTER_PROMPT.md; LIBERTY_STAGE3_TASK_B_PREFLIGHT_BUILD_MASTER_PROMPT.md. Both contain current-source VFC tables, kill lines, scope/files/implementation steps, rg checks, guarded PostgreSQL/Redis/session/actual-handler tests, desktop/mobile action readback, stock CI gates and mandatory ledger/report updates. No new full CI/migration/live browser mutation/repair/merge/deployment performed. No 95-defect claim or unsupported source-status recount. Outbound remains required Paused; incoming contact sync required Enabled; actual control state was not newly re-observed in authenticated UI this authoring pass. No sends/enrollment/spend/purge permitted. Stages 1–2 remain recorded complete; Stage 3 implementation/certification remains open.


## 23. Task #2061 review against original Stage 3 authority audit — 2026-10-03

Reviewed attached Stage 3 Authority Repairs task against freshly fetched main 7fd447ada822cdd363d567e78f29b3a976714d05 and original Task A/specification. Current serving health c893360a439dbbc829a3bb6b66a11453fc41315d, built 2026-10-03T11:27:47.302Z, publish ID 6302bdac-3bd2-42be-bc7d-15008e9ed986; accessible serving/main trees equal 35a913ebfb017501a996da7c50aed257f1b8c0ce, no tracked diff. Previous inaccessible serving-source gap superseded for this build; artifact/install equivalence remains distinct.

Task scope aligned; all 33 original A parent rows retained, zero missing parent IDs, not 33 unique defects or all 95 verified. Retain newer GHL parser/no-echo, single numeric-path middleware, manager-owned read restriction and workflow schema/no-invented-owner qualifications. Real strict lock-policy inspection fails eight policy checks (4 private-host/4 HTTP, two per resolution). Pure pagination/source assertions pass; local-only fetch transport fixture follows 302. Node 24/npm 11 audit is supplemental, not supported stock CI; no full DB/Redis/session/browser mutation/source fix/merge/deploy performed. Replit clean-install/SRI receipt claims remain supplied and unrerun here.

Five bounded amendments: supply canonical report/ledger; A adopts shared task predicates in actual backend readers while B owns UI/AI/workflow; explicitly repair SequenceReport hardcoded pause/SMTP statements; fix false replit_direct enrolled accounting and action-before-tag authority; reject unvalidated incoming HTTP redirects with actual fake-service fixtures. Details and copy-paste addendum in LIBERTY_TASK_2061_REPO_AND_ORIGINAL_AUDIT_REVIEW.md. No new tasks/defect totals or C navigation scope expansion. Keep outbound Paused, incoming Enabled/no-echo and proposals Hold for Review; controls not newly authenticated-observed. Apply addendum, build same #2061, then update ledger/report with real gates and source-fixed/tested/merged/deployed/live outcomes. Stage 3 remains open; original 95 findings and all later owners retained.

## 24. Stage 3 A intermediate workspace implementation — 2026-10-03

**Stage 3 OPEN. Task A INCOMPLETE / NOT RELEASE-READY.** No merge, deployment,
production DDL, sends/enrollment, provider spend, native writes, cleanup or worker
activation. Outbound Paused, incoming independently Enabled/no-echo and proposals
Hold for Review remain required policy; disposable incoming tests did not change
real controls. No repaired live/runtime control certification is asserted.

Receipts/commands/contracts/changed paths:
`.local/tasks/liberty-stage3-task-a-execution-receipts.md`. Supported Node22.22.0/
npm10.9.4 stock public-registry install, real-lock strict source policy, focused
actual session/DB/incoming-service/render fixtures, typecheck/build and manifest
validation pass. Security audit FAILS seven high Tailwind-chain findings
(GHSA-vfj7-8cjw-p6xm includes public latest braces3.0.3); stock static CI separately
previously failed the baseline SFP assertion `assertPaidBudgetAuthorized`. The user
confirmed paid approval and paid limits were intentionally removed. The stale
expectation now checks their absence, retaining activation/reservation/dispatch
checks; the focused source suite passes all 21 assertions. No runtime paid gate or
limit was restored; complete stock jobs remain uncertified. No major package
downgrade/migration or policy exception was silently applied. Both full stock jobs,
exhaustive A gates and repaired deployment provenance remain pending.

All original 95 findings/evidence qualifications remain above. This table retains
the 33 original A parent IDs individually; none is a blanket composite closure.
Expanded outcome/proof and remaining owners are also appended to the exact
supplied canonical specification, not substituted by an older audit.

| Original A parent | Workspace outcome / bounded proof | Remaining obligation and owner |
| --- | --- | --- |
| CRM3-01 | Dirty source/manifest/lock and successful local artifact identified; prior serving build predates repairs. | A clean final source; D/platform repaired serving artifact/install/live equivalence. |
| CRM3-02 | Portable npm-generated lock, supported stock install, strict real-lock and policy/inventory tests PASS; audit FAIL. Stale paid-approval SFP expectation corrected, focused 21-assertion PASS; complete stock jobs remain uncertified. | A approved dependency remediation/full required CI; historic install failure not reproduced. |
| CRM3-03 | Existing inbound parser/no-echo preserved; actual fake GET service/epoch/lease/webhook/replay PASS; redirect denied. Create recovery source only. | A timeout/429/retry and create fault matrix; B consumers; D native/history/fleet. |
| CRM3-04 | Typed configured/pause/unknown/error runtime facts; 27 static permutations + failed read PASS; no hardcoded SMTP/compliance claims. | A interacting UI/owner map; D actual worker/native/probe/delivery evidence. |
| CRM3-05 | Shared task predicate/state/metric adopted by storage/routes/overview/report/briefing; static same-fixture list/metric/deletion/state/asOf DB comparison PASS. | A full cross-reader snapshots/class/archive/owner/timezone; B UI/AI factual/fallback/actions/assignment/SLA/notifications; D history. |
| CRM3-11 | Scoped cold rows/count before pagination; owned/unassigned/nonowned real handler fixture PASS; differing populations retained. | A count/facet/export/cache/analytics completeness; C2/C4; D historic IDs. |
| CRM3-12 | Full recommendation forecast + bounded details; 5,001 additional rows PASS; actual deployment/cash/paid-off unavailable. | A missing/empty/archive/test/order/shipment permutations; Stage 6 verified actual ledger. |
| CRM3-14 | Whole selected-set locks/recheck; role/CSRF/mixed denial/retry no tags/enrolled=0 PASS; numeric guard retained. | A races/full action/fake false bridge/true receipt cases; B lifecycle; Stage 9. |
| CRM3-15 | Unsupported audience dollars removed; actual handler has no estimatedValue. | A browser/labels; C2/C4; audience is not send eligibility or revenue. |
| CRM3-16 | Actual DB 2 steps/3 active+cancelled+completed memberships/1 unique contact PASS, not fanout six. | A zero-child/manager/browser fixtures; B archive/cancel; C3; D native history. |
| CRM3-17 | Owned manager endpoint/client and error/loading labels; no global access expansion. | A real owned-manager/global-denied/API-failure/browser proof; B lifecycle. |
| CRM3-20 | Stored incoming lease/checkpoint/update truth separated from worker consumption; unknown explicit. | A complete owner map/browser; D/Stage 4 enrichment runtime receipts. |
| CRM3-23 | No A provisioning/invitation/deactivation feature or closure. | B lifecycle/discoverability; C5; Stage 9. |
| CRM3-25 | Actual session workflow role/input denial and zero workflow run/provider fetch PASS only. | A positive/executor/race matrix; B Knowledge; C5/D/Stages 8–9. |
| REF-003 | Local durable 202 degraded identity/canonical incomplete replay source implemented; accepted/completed no-op. | A full postcommit/link/task/effect/audit/queue/concurrent fault fixtures; B UI; D original incident. |
| REF-006 | Class/archive/link populations retained; no historic empty-pipeline reproduction. | A object/deal metric parity; C2/C4; D immutable same-scope deal IDs. |
| REF-008 | Actual incoming service/no-echo and redirect refusal PASS; historic root cause not inferred. | A timeout/429/retry; D sanitized original metadata/backlog/stage semantics. |
| REF-009 | No activations or historical 12/20-as-current claim; checkpoint isn't fleet health. | A exact source/owner map; D/Stage 4 heartbeat/ownership/checkpoint. |
| REF-011 | DB fanout correction and typed runtime static permutations PASS; active not permission/delivery. | A remaining zero/manager/browser; B lifecycle; C3; D native39/stalled identities. |
| REF-014 | No paid model/index request or invented consumption proof. | B Knowledge; D actual runtime; Stage 8 model/index receipts. |
| REF-015 | Disposable test Redis is not production-worker receipt; connected≠consumed retained. | A remaining map; D production Redis/queue/worker proof. |
| REF-017 | Incoming/manual/webhook observation separated; no native workflow IDs guessed. | A owner labels; D/Stage 4 approved dependency inventory. |
| REF-018 | Production/synthetic-QA filters preserved; no production cleanup/current historical-count assertion. | A exhaustive class/archive fixtures; B users; D historic/live census. |
| REF-020 | Disproved “no Invite” qualification retained; no invite sent. | B discoverability/lifecycle; C5/Stage 9. |
| REF-029 | Membership vs contact counters/paused meaning corrected; no cleanup performed. | A remaining counter fixtures; B governed cleanup; Stage 4. |
| REF-041 | External/local stage counts not forced equal; no mapping guessed. | D native semantic approval/Stage 4; A unmapped-label browser proof. |
| REF-046 | Old6,471/superseded UI not current denominator; scoped source only. | A object/event metric labels; C2/C4; D current view. |
| REF-052 | Six actual password-session roles and changed route/CSRF denial PASS, not universal auth/2FA/deactivation. | A full registered-server/browser gates; B lifecycle; Stage 9. |
| REF-059 | Rejected plausibility→83% validity inference retained; no purge. | Stage 5/8 evidence, no new A cause. |
| REF-060 | QQ/numeric invalidity inference rejected; identities preserved. | Validation authority, not appearance-based purge. |
| REF-061 | No immutable original email/name examples or cleanup. | D historic IDs; B/C2 separately assigned display. |
| REF-066 | Actual membership/contact distinction proved, not old2,094/2,097/~2,040 native census. | A remaining fixture matrix; B governed lifecycle; D history. |
| REF-069 | Local no-echo/preservation fixtures PASS; native contact/stage/user/form/phone inventory not obtained. | A remaining runtime/pagination; D native/Stage 4; no numerical parity. |

Assigned subclaims: REF-016/V18 SMTP/global pause/reason unknown/error static proof
is partial A evidence, not cap/delivery closure (A interacting UI; D/Stage4 actual
delivery; C3). REF-056/V22 workflow role/ID/zero-run session fixture PASS is not
complete executor/security readiness (A remaining cases; B editor; Stage9).
REF-037/038/065 native deletion/restore and REF-064/067 actor/time/before-after
history remain D-owned and unverified. No composite findings or later stages
have been closed by these workspace tests.

## Latest Task A ledger update — 2026-10-03

**INCOMPLETE / NOT READY FOR REVIEW OR RELEASE.** Focused source tests do not
override failed stock CI/security or missing production/native/history evidence.
All 95 original finding IDs and their qualifications remain; the 33-parent
dispositions below supersede only the earlier intermediate A update.

Receipts: `.local/tasks/liberty-stage3-task-a-execution-receipts.md` and
`.local/tasks/stage3-a-final/`. HTTP = actual password-session/CSRF/DB authority
handlers and contact/related-deal lock races; TASK = adopted backend task and
same-clock static-fixture cross-reader proof; SEQ = actual DB/owned-manager/error
reads; FIN = >5,000 full-population forecast/missing-value fixtures; CREATE =
registered writer/request faults and concurrent replay; GET = actual fake-service
incoming/redirect/timeout/429/checkpoint/lease/epoch/webhook/no-echo proof; UI =
typed renders plus signed-in desktop/phone viewport in existing desktop-view mode.
These are receipt labels, not new findings. Native mobile queues are unverified.

| Original A parent | Latest individual A outcome | Remaining owner / qualification |
| --- | --- | --- |
| CRM3-01 | Final isolated build/typecheck/inventory/redacting scan PASS; uncommitted source identity recorded. | A clean candidate/full gates; D/platform repaired serving artifact/install/live proof. |
| CRM3-02 | Stock public install/real-lock policy PASS; writable-build 1/1 PASS; audit FAIL 7 high; nine unchanged-baseline API mismatches; integration clean/diff gate blocked. | A dependency remediation/full stock CI. Not release-ready. |
| CRM3-03 | GET/CREATE PASS, including later-page timeout/429 checkpoints and committed-identity recovery. | B consumers; D historic incident/native/fleet; A full stock gates. |
| CRM3-04 | UI PASS; runtime visible with zero identities; configuration/active state not permission, throughput or delivery. | D real probe/delivery/worker facts; C3 design. |
| CRM3-05 | TASK PASS for actual storage/list/overview/analytics/briefing adoption and class/archive/link/state/date parity. | B UI/AI input/fallback/actions/assignment/SLA/notifications; D history. Parent PARTIAL. |
| CRM3-11 | Shared scoped contact/deal scalar comparisons and HTTP owned/unassigned reads PASS. | A broader facet/export/cache matrix; C2/C4; D native immutable census. |
| CRM3-12 | FIN PASS; missing cost unavailable, archived/test excluded, rejected recommendation only forecast, actual deployment/cash null. | Stage 6 authoritative shipment/deployment/cash evidence. |
| CRM3-14 | HTTP PASS for complete mixed-set denial, contact/related-deal race rechecks, consent block and repeat enrolled=0; no deceptive tags/provider effects. | B lifecycle; Stage 9 broader security. No live enrollment added. |
| CRM3-15 | HTTP/UI PASS; unsupported audience dollars removed. | C2/C4 design; no revenue/consent/purge inference. |
| CRM3-16 | SEQ PASS: 2 steps/3 memberships/1 unique contact, zero children and terminal history. | B lifecycle; C3; D historical native identities/delivery. |
| CRM3-17 | SEQ PASS: owned manager read, global/other denial, injected failure not empty. | B lifecycle; A broader manager-card browser proof. |
| CRM3-20 | Typed stored source/owner mode/checkpoint/lease/freshness observations, not fleet consumption. | D/Stage 4 live fleet facts; A broader diagnostic UI. |
| CRM3-23 | No provisioning/invitation/deactivation feature or certification added. | B lifecycle/discoverability; C5; Stage 9. |
| CRM3-25 | HTTP workflow role/ID/zero-denied-run and valid empty-action management run PASS. | B editor/trigger/action work; Stage 9 full executor/security. |
| REF-003 | CREATE pre/postcommit/task/link/work-link/effect faults, stable identity/one task/concurrent retry and visible pending projection PASS. | D historic incident; B modal/workflow consumers. No provider delivery proof. |
| REF-006 | TASK and scoped contact/deal scalar comparisons PASS. | A broader facet/export/cache parity; D native linked same-scope IDs. |
| REF-008 | GET redirects/timeout/429/resume/replay PASS; incoming independently Enabled. | D historical metadata/backlog/approved stage semantics. |
| REF-009 | No worker activation or blanket healthy/consumed assertion. | D/Stage 4 exact current owner/heartbeat/checkpoint. |
| REF-011 | SEQ/UI fanout/zero/history/unknown/error proof PASS. | B lifecycle; C3; D native historic stalled identities/delivery. |
| REF-014 | No paid model/index call or claimed consumed-work proof. | B Knowledge; D observations; Stage 8. |
| REF-015 | Disposable Redis only supports isolated tests, not production health. | D live Redis/workers; A broader diagnostic map. |
| REF-017 | Incoming/manual/webhook sources distinct; no guessed workflow inventory. | D/Stage 4 approved native IDs; A broader owner-class UI. |
| REF-018 | Class/archive/owner fixtures PASS; synthetic-QA filters preserved; no production census/cleanup. | B users; D historical/live counts. |
| REF-020 | Disproved missing-Invite allegation retained; no invitation sent. | B lifecycle/discoverability; C5/Stage 9. |
| REF-029 | SEQ membership/contact/paused/terminal distinctions PASS; no cleanup. | B governed cleanup; Stage 4. Upgrade, not new cause. |
| REF-041 | No native/local stage equivalence or mapping inferred. | D native IDs/semantic approval; Stage 4; A broader unmapped UI. |
| REF-046 | Scoped scalar tests, not dated global inventory denominator. | A broader object/event labels; C2/C4; D current-view receipt. |
| REF-052 | Six real role sessions, CSRF/handler denial and signed-in report/cold UI PASS. | Stage 9 universal auth/2FA/deactivation; B lifecycle; A full stock server/browser gates. |
| REF-059 | Appearance-based validity inference rejected; no purge/reclassification. | Stage 5/8 validation authority. |
| REF-060 | QQ/numeric invalidity inference rejected; source identity preserved. | Validation authority, not appearance-based purge. |
| REF-061 | No immutable historical identity examples or raw identity rewrite. | D IDs/history; B/C2 display work. |
| REF-066 | Actual membership/contact distinction PASS, not dated native census equivalence. | B lifecycle; D immutable history. |
| REF-069 | GET local preserve/fill/create/dedupe/no-echo/continuation PASS. | D native contacts/stages/users/forms/phone inventory; Stage 4. |

REF-016/V18 UI runtime slice PASS does not close cap/delivery (D/Stage 4/C3).
REF-056/V22 HTTP slice PASS does not close editor/full executor/security (B/Stage 9).
REF-037/038/065 and REF-064/067 native deletion/restore/actor/time/before-after
obligations remain D-owned. No composite parent or later-stage finding is closed.
Outbound remains Paused, incoming independently Enabled, proposals Hold for Review.
No production deployment/DDL, real send/enrollment, native write, provider spend
or held-intent release was performed for these fixtures.

### Final scoped A handoff correction — 2026-10-03

User-confirmed implementation/focused-certification closure; no further unrelated
legacy test repair. **NOT RELEASE-READY:** full stock integration/server checks
remain failed. No deployment or live/Stage 3 certification. Preserve all original
95 findings and composite B/C/D/later-stage ownership. These individual corrections
supersede only the outdated cells of the preceding 33-parent A matrix; all other
rows and qualifications remain unchanged.

| Original A parent | Final A outcome / receipt | Remaining owner or qualification |
| --- | --- | --- |
| CRM3-01 | Implementation committed at 255d25bbbf6d014ed34a18ca5e46aae0be1278df; isolated typecheck/build/inventory/redacting scan PASS. | D/platform repaired serving/install/live proof; full CI remains blocked. |
| CRM3-02 | Supported public install, strict real-lock policy (939 fingerprints), API census, security (zero high/critical; 7 moderate/1 low), static 57/57 and writable-build 1/1 PASS. | Full integration fails at CR-06 Redis reservation; server fails at New-Lead Enrollment Policy B9/B22/B23. No full-CI or baseline-equivalence claim. |
| CRM3-11 | Same-clock scalar and actual session list/facet/cache/export population parity PASS; approved owned/unassigned scope preserved. | C2/C4 presentation; D immutable native census. |
| CRM3-17 | Manager owned-positive/global-and-other-denied PASS; signed-in read failure explicitly unavailable, not zero. | B lifecycle; no comprehensive work-queue UI claim. |
| CRM3-20 | Incoming observations distinct from explicit unavailable legacy GHL/enrichment/SLA/communications owners and native mapping; 27 permutations plus unavailable-read PASS. | D/Stage 4 actual fleet observations, not inferred consumption. |
| REF-006 | TASK/scalar and actual session list/facet/cache/export parity PASS; different populations named. | D native same-scope linked IDs. |
| REF-015 | Explicit unavailable legacy owner UI/render proof PASS; disposable Redis is not production queue-health proof. | D production Redis/worker observations. |
| REF-017 | Manual incoming/webhook facts distinguished; native mapping/legacy owners explicitly unavailable, never guessed. | D/Stage 4 native inventory. |
| REF-041 | Native mapping proof explicitly unavailable in diagnostics; no stage parity/semantics inferred. | D approved native IDs/semantics; Stage 4. |
| REF-046 | Scoped scalar/list/facet/export/cache populations tested; censuses distinct from performed-action/event claims. | C2/C4 workspace; D current-view receipt. |
| REF-052 | Focused role/session/CSRF/denial and signed-in reporting browser proof PASS; full server-required job FAILED separately. | B lifecycle; Stage 9 universal auth/2FA/deactivation; full-CI release blocker. |

Receipts and exported-contract/path handoff:
`.local/tasks/liberty-stage3-task-a-execution-receipts.md`, final scoped section
and `stage3-a-final/handoff-*`. Existing original A rows not listed in this
correction retain their individually qualified outcomes, not blanket PASS.
Outbound remains Paused; incoming independently Enabled; proposals Hold for Review.
No production deployment/DDL, real send/enrollment, native write, provider spend
or held-intent release was performed.

## Task B implementation and acceptance checkpoint — 2026-10-06

**Stage3 Task B remains INCOMPLETE. No release/production deployment or company-wide readiness is certified.** Existing older ledger verdicts and historical/native/C/later-stage obligations remain unchanged.

Durable task/ticket commands, current routing identity and request-owned review fallback, namespaced versioned drafts, actor-local notification state/audiences/typed destinations, truthful factual snapshots, placeholder completeness, recoverable contact/account/sequence lifecycle, consent/privacy administration, contextual notes/company authorization, workflow concurrency/retained history and parameterized Knowledge repair have focused local measured receipts. Exact12-gate handoff and individually retained56 original outcomes: .local/tasks/liberty-stage3-task-b-local-handoff.md and .local/tasks/liberty-stage3-task-b-row-outcomes.md; specification Section13.7 embeds the56 fourth-cell outcomes.

Latest selected canonical disposable batch10/10 passed; account/auth2/2, installed-consent/provenance/child-retention1/1 and actual protected/public SSR Chromium1/1 passed separately. Existing-workspace canonical writable-build1/1 passed. Source policy948 packages and registered SSR120 layered rules passed. None is stock-install proof. Zero real sends/invitations/AI/provider spend/native GHL writes/enrollment/resume/production DDL/deployment. Incoming/no-echo authority preserved. Archive/restore and recoverable paused retirement remain available; permanent product erasure stays blocked independently of fixture labels.

Fresh blockers: clean stock install HTTP403 for security-blocked proxy-addr2.0.7, reproduced on baseline; full dependency audit1 critical/2 high, baseline production scope1 critical/1 high(proxy-addr/sharp); unchanged package/lock identities; deterministic-static SFP assertion missing verifyEmail(realEmail), reproduced on unchanged baseline. No bypass, suppressed failure, capability downgrade, package/lock rewrite or production action. Full clean-install canonical integration/server gates remain uncertified, with remaining acceptance work kept in Task B.

Next authorized step is an approved narrow dependency/security repair followed by stock install and remaining canonical acceptance; no automatic scope expansion or completed-task claim.


## Canonical execution continuation (supersedes the earlier stop for dependency approval)

Task B scope is retained: no dependency/lockfile upgrades and no unrelated assertion repair. C14 requires executing and reporting the canonical commands with baseline comparison, not widening this task until unrelated repository failures disappear. The earlier request to expand scope is withdrawn; no approval was received or assumed.

Both canonical guarded migration commands ran successfully against an empty owned PostgreSQL16 database and its reserved private Redis namespace. The actual canonical server wrapper reached seeded readiness on a nonce-proved127.0.0.1 listener. The server-required roster executed and stopped at CSV Import Reconciliation:97 assertions passed and2 provider-header deferral assertions failed. This is a measured failing gate, not a pass. The imports handler is unchanged relative to the comparison checkout; that source equality is not a fresh baseline runtime reproduction. Exact logs: /tmp/stage3-b-canonical-rehearsal-final.log and .local/tasks/liberty-stage3-task-b-canonical-rehearsal.json. Whole-disposable-DB and owned-process teardown had0 errors.

Canonical integration execution exposed B-owned fixture issues that bounded per-suite runs had not caught: nested Redis reservation, a desktop-view hard-navigation race, and global-count assertions on a shared canonical disposable DB. These are repaired without changing suite capabilities or weakening any product authority: fixtures reserve a new high-entropy descendant namespace; the browser waits for the actual Overview landing before reopening context; assertions count their own explicit actor/entity cohort. The private HTTP host/nonce now survives the existing child environment scrubber; tests prove provider credentials remain scrubbed. This prevents the canonical server wrapper from dropping the already-proved private-listener posture. No provider, auth, role or network permission was widened.


### Canonical B suite closure and related manual-intake correction
The full canonical deterministic-integration roster ran its first13 B suites successfully (not a filtered substitute): /tmp/stage3-b-canonical-integration-delivery.log. It then stopped at Stage3A Registered Session Authority and Metrics. Focused actual-handler diagnosis reproduced the failure in a fresh owned database and found a B-owned regression, not an unrelated baseline assertion: unknown-class manual first-party contact occurrences were refused instead of receiving the exact occurrence-owned management-review obligation.

The repair extends only the existing immutable-occurrence proof to manual_crm/dashboard with event_key manual:<request-id>, alongside the existing first-party form proof. Contact/deal production admission, assignment, archive denial, forged source rejection and external holds remain unchanged. The original A replay/fault/concurrency fixture now asserts the request→work link and verifies unknown classification is retained, contact admission is absent and canonical assignee remains null. This is directly related consumer-contract repair, not unrelated suite suppression. Pool fixture setup likewise declares its single-candidate precondition through real versioned membership commands while preserving users, past assignments and history.


## Final Task B completion-review receipt — 2026-10-06

**B implementation and bounded verification are ready for completion review. Whole-repository/release acceptance is NOT GREEN; no production or Stage3 certification is claimed.**

Latest canonical command: npx tsx .local/tasks/liberty-stage3-task-b-ci-rehearsal.ts --integration-only. It invokes the unchanged run-ci-suites.ts --capability deterministic-integration, with the full83-entry manifest and no filtered/capability changes. Both preceding run-guarded-canonical-migration.ts invocations passed on a new owned PostgreSQL16 database. The first21 canonical suites passed, including all13 Task B registered DB/session/browser suites, the related Task A actual-handler authority/retry/concurrency suite, three incoming/no-echo GHL suites, three CRO03A suites and BT12 integration. Suite22, South Florida Prospecting Corrections Certification, stopped at VFC-01b: its existing Task1999-only dirty-tree rule rejects14 current Task B/reporting/memory paths. This is an actual working-tree isolation rejection, not a passing suite or a demonstrated product regression. The remaining61 suites did not execute. No unrelated allowlist/assertion repair or capability reclassification was performed. Exact log: /tmp/stage3-b-canonical-final-acceptance.log; machine receipt: .local/tasks/liberty-stage3-task-b-canonical-integration.json. Whole-disposable infrastructure cleanup errors:0. The related manual-intake regression described above is fixed and its original fault/replay/concurrency consumer passes in this run; it is not being passed off as a baseline failure.

The earlier actual canonical server-required attempt remains a failing receipt: owned nonce-proved private server ready; CSV Import Reconciliation97 passed/2 provider-deferral failures; the remainder did not execute. No fresh baseline runtime reproduction is asserted for those2 failures. Source equality of the unchanged imports handler is explicitly weaker evidence. /tmp/stage3-b-canonical-rehearsal-final.log and .local/tasks/liberty-stage3-task-b-canonical-rehearsal.json retain the actual results.

Latest npm run check and git diff --check: exit0 (/tmp/stage3-b-final-acceptance-types.log). Certification environment scrubber regression and B static/source contracts: pass. Earlier actual canonical writable-build receipt passed with the existing installation; it is not a successful clean stock install. Stock install HTTP403, full audit1 critical/2 high and baseline-reproduced static verifyEmail(realEmail) assertion remain failed gates with their distinct comparisons preserved above. Source HEAD79d1175fed69c2d7cda23becd0d7035304e3ace0 plus the recorded Task B working-tree edits was tested; no clean merged/serving/deployed identity is asserted. Manifest SHA256ee31b22d58d5d1a03d7f2606560504ffdc160430021cf8fdc32ec6fe6ec4706c and lock SHA2563fa1797f812dff3117bdd95408b34fd7283618d7307d71e6272177bdc89e63c4 remain unchanged.

All56 individual retained original rows keep their dated claims and assigned owners. Their B fixtures establish bounded local outcomes only; composite parents and C/D/Stages4–9 historical/native/security/release obligations remain open. No duplicate follow-up is proposed for those already assigned downstream boundaries. Permanent contact erasure remains explicitly unavailable because the full retention contract has not been certified; this preserves protected evidence rather than treating a fixture label as disposal permission. Actual tested external transports/sends/invitations/AI/provider/native effects:0. Recovery does not release outbound holds. No main/shared workflow startup, production DDL/deployment, incoming-control toggle, dependency upgrade, lockfile change or Mockup Sandbox change occurred.


### Completion-validation role-guard repair and final measured pass
The first completion attempt passed API coverage and independent completion code review, but its configured npx tsx scripts/smoke-role-guards.ts command failed before route tests: a legacy source assertion required storage.archiveContact instead of the new fenced command. This was a directly related B consumer regression, not a baseline failure. The assertion now checks the actual archive command delegation and also forbids GHL deletion and DB deletion in its delegated service. A pre-import disposable PostgreSQL/Redis guard prevents this mutating script from using shared/default infrastructure.

The exact original role suite was then executed through the existing canonical dedicated launcher. Its stale archive/sequence positive and ownership-negative callers required real current principal/account/record version and command identity envelopes; they now submit those fields on the suite’s own records. Empty input400 is not treated as proof of ownership denial. The new sequence command’s non-disclosing ownership404 and unavailable seeded-note-context404 are asserted exactly; merchant/agent denials and retained-row/no-effect checks remain. No status wildcard or fixture bypass was added. Latest actual command: npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/smoke-role-guards.ts. Exit0,139/139 role routes across anon/merchant/agent/manager/admin, stateful manager archive/restore and ownership checks passed;1/1 full selected suite, child/setup/teardown/launcher failures0. Exact log: /tmp/stage3-b-owned-role-guards2.log. Final type check and diff check exit0: /tmp/stage3-b-role-guards-types.log.

The existing registered role-guards validation now uses that SAME isolated launcher and exact SAME complete script. This changes infrastructure setup, not the suite’s server-required capability, selected assertions or acceptance outcome. Raw shared-preview mutation is no longer the configured validation path. Main-project rebase had only generated asset-list conflicts; incoming asset records were preserved and Task B downloads regenerated. Application code did not change in that rebase; the rebased type check also passed. Full repository install/security/static/CSV and original release limitations remain as recorded; this new role-gate pass does not erase them.

## C4 provisional implementation — no GO verdict

C4 remains incomplete.39 assigned routes/70 historical panels are presentation lineage, not passed controls. Current work and qualified source/compiled identities are recorded in `certification/stage3-c4/working-status.md`; earlier audits/receipts remain historical. Current isolated handler evidence includes stable chargeback acceptance/replay, an executed post-commit response-loss fault, uncapped parent/member/MID relationships and stable local Inbox/Portfolio pagination, not real native execution or full action acceptance.

Grouped merchant/report presentation and narrow read/consumer fixes do not establish clean-candidate, deployed bundled-server, actual financial ingestion or integrated serving proof. The user approved linked handoff for manual kickoff: keep the eligible Closed Won Sales record, create/reuse a linked Onboarding record and retry unfinished local preparation only. Its bounded implementation evidence does not close the full conditional transition matrix or authorize native activation/resume. Same-filter metrics/exports, independent source completeness and full role/action/fault/geometry/accessibility matrix remain open under existing owners. C2 compact Contact header is preserved; C3 reuses C4 Outreach presentation; C5 final sidebar and D serving/native/release obligations remain separate. No publication, activation/resume, sending, real provider/native work, shared/prod mutation or normal workflow/control change was performed.

## 36. C3 Prospecting, Canonical Enrichment and Campaigns — implementation receipt, 2026-10-19 (no GO verdict)

C3 source repairs F01–F08 and the shell parts of F09–F14 are implemented (see consolidated specification Section 28). This is a **source** receipt; it is not serving, role, browser or production acceptance. Older five-view / 21-route / old-taxonomy ledger text is historical.

| Gate | Status |
| --- | --- |
| G01 source/serving identity, public smoke | Not exercised. No candidate hashes or serving receipts recorded. |
| G02 24 routes / 28 rows / six views / dynamic controls | Codec round trips, invalid and duplicate cases exercised in `test-stage3-c3-contracts.ts` (171 assertions, including conflicting canonicalView/view selectors). In the real-browser suite (`test-stage3-c3-browser.ts`, admin, compiled client, disposable DB) the six canonical views round-trip through click, reload and Back and conflicting selectors report an issue. The other route patterns and dynamic controls were not exercised. |
| G03 role matrix | Real-browser merchant and partner sessions are redirected and see no Source Prospects aggregates. Executed on a disposable database with real sessions/CSRF (`test-stage3-c3-roles.ts`): aggregate reads for admin/manager/agent/merchant/affiliate/partner/unauthenticated and denial of every non-admin on release/process commands with no audit rows written. `test-stage3-c3-browser-sequences.ts` adds a real-browser seven-role entrance matrix on the Sequences page and a mid-session manager demotion (reads refused, direct POST 403). Other pages' live matrix and a role change on non-Sequence pages were not exercised. |
| G04 real create/edit/save/archive with readback | Sequence create, step add, edit with step IDs/config, replay, stale and omitted-step refusal executed with DB readback (`test-stage3-c3-sequences.ts`). The import flow is exercised in jsdom and in the real browser up to the review step (no upload before review). Browser-driven Sequence create/edit/hydration-failure (`test-stage3-c3-browser-sequences.ts`) and draft Campaign create plus Signature edit/failure recovery (`test-stage3-c3-browser-campaigns.ts`) executed with DB readback. Campaign edit/archive/cancel, business and lifecycle controls were not exercised in the browser. |
| G05 F01 resolved or truthfully scoped; F03 fixtures; >500 pagination | >500 pagination executed (`test-stage3-c3-prospects.ts`, 620 rows). Mounted tests prove independent Backlog/Launch/Release unavailable states. Backlog/Readiness production faults not reproduced; no root cause claimed. Audit-after-commit fault injection executed for release-policy and revoke (`test-stage3-c3-post-commit.ts`: `committed:true, audit:"failed"` with durable readback). Process-enqueue fault injection, late-response and actor-switch tests not run. In the real browser an injected backlog 503 left the release panel visible and was not shown as zero. |
| G06 metric agreement and October ledger bridge | Not exercised. Labels state scope; no same-snapshot agreement test. |
| G07 widths, themes, zoom, keyboard, contrast | Partly exercised (admin only): no horizontal body overflow at 320/390/768/1440 on canonical, source prospects and imports; a dark-class check; one Tab-focus check; one H1 per page. Also exercised: emulated 200% zoom (640 CSS px at scale 2, no overflow) and computed WCAG AA contrast of main-region text on Source Prospects in light and dark. Not exercised: real browser zoom, phone hardware, screen reader, contrast on other pages, reduced-motion beyond emulation. |
| G08 performance and heavy-query budgets | Not exercised. Automatic heavy polling removed in source only. |
| G09 guarded backend suites on disposable DB/Redis | Executed through the isolated launcher: canonical-release-authority, vertical-acceptance-policy, staged-email-materialization and first-party-native-install PASS. serper-lookup-memory FAILS ("First pass settles without scope errors") and intake-review-pages FAILS (full-page source namespace probe; the known baseline failure). No Serper or intake code was changed by C3; the Serper failure also occurs with C3's only server-storage change reverted (baseline). The six certification suites were added to the explicit-selection roster only (not the default roster). |
| G10 toolchain, manifest, build | Executed: whole-project `tsc --noEmit` clean; C1 (339), C2 (286), C3 (171) and C4 contract scripts pass; C3 mounted jsdom suites and the bounded real-browser suite pass; `ci-suite-manifest.ts --check` valid with the C3 suites registered; supported `npm run build` completed (not published). Full CI and pre-deploy roster were not run. |
| G11 published candidate verification | Not exercised. Nothing published; outbound remains paused; incoming GHL sync untouched. |
| G12 lineage reconciliation | Older appendices labelled historical. Open items named in Section 28 remain with C3; C5 sidebar and D serving/native proof untouched. |

No production write, provider run, import, enrollment, release, send, unpause, schema push, startup DDL or dependency change was made.

### 36.1 C3 follow-up receipt, 2026-10-20 (no GO verdict)

Follow-up scope (formerly separate tasks for the remaining import/release-state screens and the mounted-browser proof) was audited against the merged C3 source. UploadLedger on the protected cancellable hooks with URL-addressable execution and filter, the intake-versus-fulfillment import wizard, ReleasePanel denied/expired/revoked states, the scoped open-deal label on Outreach Command, and the Business detail rail with Back-to-list were already present. One gap was closed: a repeated release request now shows a persistent "Replayed" state (previously a transient notice only), covered by the mounted Canonical Backlog suite. Release limits, schemas and the outbound pause were not changed.

Executed after that change: whole-project `tsc --noEmit` clean; C3 contracts (171 assertions) and the three mounted component suites pass; on disposable databases through the isolated launcher, C3 role matrix, sequence DTO/recovery, Source Prospects pagination and audit-after-commit suites pass; after `npm run build`, the three C3 real-browser suites (bounded browser, sequences and roles, campaigns and signatures) pass. Receipts under `docs/certification/stage3-c3/` were regenerated by those runs.

Still not exercised and not claimed: process-enqueue fault injection (no queue manager in the fixture), late-response and actor-switch browser tests, Campaign edit/archive/cancel in the browser, role matrices on other pages, G06 same-snapshot metric agreement, and G01/G07/G08/G11 (serving identity, native zoom/hardware, performance budgets, published candidate).

### 36.2 C3 final corrections receipt, 2026-10-20 (no GO verdict)

Scope: completion of the existing #2075 C3 scope after the post-publication review. No new audit ladder; delivered screens were not rebuilt. Release limits, strict schemas, the outbound global pause and channel pauses were not changed, and nothing here enrolled, sent or called a provider.

**Implemented in source (candidate, not yet published):**
- R1: contact detail `/api/contacts/:id` explicitly defers literal collection readers registered later (`readiness-stats`, `verticals`, `duplicates` and the rest of the set) so they are never shadowed. The retired duplicates reader answers 410 from its own handler.
- R2: `POST /api/sequences` is a single-transaction command (principal check, advisory lock, receipt replay with 409 on payload mismatch, paused row, `sequence_created` audit, receipt). The editor retains the command per actor and account version, recovers the committed ID after a lost response, double click, close or reload, reads persisted steps back and refuses (names) a differing saved step, and posts only missing steps. Fields are locked while an intent exists.
- R3: Backlog process uses a retained command intent and a real producer-only queue add; thrown-enqueue fault read back.
- R4: Businesses renders the inventory first; privileged matching, advanced reconciliation and coverage sit in a collapsed admin disclosure that mounts only after first open.
- R5: tab and child changes on Lead Ops and Outbound Center use one typed helper: only registered entity context and a safe fragment survive, stale list/paging/arbitrary parameters are dropped, history is pushed (Back/Forward restore).
- R6: "Open sales deals" has one definition (open sales-lead stages); scope is named in the payload and labels (Command company-wide, KPI all-owners for admin/manager and owned-or-unassigned for others).
- R7: Backlog process and readiness-stats results are decoded defensively (missing legacy counters are null, not zero).

**Executed on this candidate (receipts under `docs/certification/stage3-c3/`):** whole-project `tsc --noEmit` clean; C3 contracts (211 assertions); mounted component suites; disposable-database suites for sequences (create replay/conflict/audit/actor/account), Backlog command, open-deal definition (pinned population), role matrix, post-commit and prospects; role-guards smoke with the new literal-route cases; after `npm run build`, real-browser suites: bounded (62 checks: Businesses inventory-first at 1280/768/390, lazy disclosure, typed tab context with Back/Forward), sequences (49 checks: lost-response retry, close/reload confirmation, partial steps with differing saved step, account-version change quarantine, plus role entrance matrix and demotion) and campaigns (27 checks: draft create, step edit cancel/failed save/409 non-draft conflict/durable save, signatures).

**Not executed and not claimed:** a per-reader failure-injection test for readiness-stats beyond the unavailable-state decoding; late-response guards for protected source/import/ledger queries in a mounted browser (only the Sequence editor hydration guard is implemented, not browser-proven); campaign-level edit/archive/cancel (the Campaigns page has no such controls; only step edit and status toggle exist, and step edits have no version token); (the full pre-deploy roster and baseline dispositions are now recorded in Section 36.3); native zoom, hardware, contrast and performance budgets; the published-candidate serving identity check. C3 is therefore not recorded as fully accepted. The global sidebar remains C5, integrated closure D, native/provider outbound proof Stage 4 and the frozen-SHA release Stage 9.


### 36.3 Full pre-deploy roster and baseline dispositions, 2026-10-20 (no GO verdict)

Run on the published candidate (published identity `86b022ab`, local HEAD `db74eb5d`, which contains `ba25f315` and only an attached review document). Runner: `scripts/run-sfp2060-predeploy-disposable.ts` with no `--only`, one private PostgreSQL clone, Redis and port per entry; no production database, no provider calls, outbound pause unchanged. A fresh `npm run build` preceded the run. Raw logs are kept locally under the gitignored `generated-artifacts/` directory (not committed).

**Result: 161 of 197 mandatory roster entries passed; 36 failed.** Separately, 8 certification-fixture suites that are only reachable with `--only` were run: 5 passed, 3 failed.

**Caveat found during the run:** the whole-roster run leaves modified tracked evidence files under `docs/certification/` (172 paths), which makes later diff-isolation checks see a dirty tree. After restoring the tree, the 36 failures were re-run one at a time on a clean tree:
- 2 passed on re-run: `scripts/test-sfp-disposable-certification.ts` (its diff-isolation check failed only because of the dirty tree) and `server/tests/auth-actions.integration.test.ts` (passed in isolation; it needs its explicit disposable opt-in).
- 34 failed again on the clean candidate.

**Baseline comparison.** The 34 reproduced failures, plus the three failing fixture suites, were then run with the same runner against the commit before any C3 work in this series (`709a4fad`, 186-entry roster). Every one of the 34 roster failures also fails there with the same first failing assertion; for the multi-assertion suites (sequence compliance, new-lead enrollment policy, CRO-03 HTTP authorization, CRM operator experience, forms) the set of failing assertions is identical apart from random fixture identifiers. For `check-queue-compliance`, `check-contact-merge-manifest` and `test-reconciliation-certification` only the exit status was compared, because their output carries no assertion text. Therefore none of the 34 is attributable to C3 changes; none was fixed, and none is claimed passing.

Reproduced on both candidate and baseline (exit 1): the Stage 3 C1 browser suite (real-pointer target on the edit-first-name input) and the Stage 3 B browser suite (compose-email control) failed with identical assertions; the C4 Bounded Mounted Browser fails for the missing `c4-performance-baseline` candidate-integrity prerequisite (at baseline for the missing local build instead, so the cause is the same class but not the same file); the compliance scan reports the same one UNKNOWN email call site (`server/services/sfp-seed-test.ts`); sequence compliance and contactability fail with `mismatched_email_token`; the CRO-03/03B/03C, CR06, CRO07 and SFP2000/2001 certifications, ledger/seed-convergence checks, outbound boundary 1626, pause fence (no `outbound_pause_control` row on the private clone), NBA, forms, transport dispatch, and the canonical registry/provider-import certifications fail with unchanged messages. Browser suites at baseline had no baseline build; the identical assertion text is recorded but the baseline build identity was not independently verified.

Fixture suites: provider-import-recovery fails on both candidate and baseline (exit 1 each). Serper lookup memory and intake review pages fail on the candidate (`First pass settles without scope errors`; `Full-page source namespace probe must execute its index`), but those suites do not exist at the baseline commit, so no baseline comparison is possible; they remain candidate failures with unknown cause, not reproduced-at-baseline. The other five fixture suites passed. `test-outbound-pause-authority.ts` passed on its private database.

**Not claimed:** this is not production acceptance, it does not clear the 34 + 3 failures, and a failing gate means the pre-deploy gate as a whole would still report FAILED. C3 remains not fully accepted. No code was changed by this run.



## 37. C5 Administration, Resources and final shell — implementation receipt, 2026-10-20 (NOT READY, no GO verdict)

Source implementation of Pass 1 to 4 on `f1fb96a3`: truthful permissions inventory (Express 5 mount/method/guard provenance, unknown never public), Queue Holds DTO decoder and keyed render, readiness probe registry (migrated schema, existing authorities, failed evidence never a pass), separated GHL operational cards and database-bounded audit reads, consistent Replit-ownership guidance and reclassified workflow-ID diagnostic, Resources reader states and JSON-decoded receipts, URL-addressable selectors through the shared codec (`tab`, `integrationsView`, proposed `area`), manager gating by real endpoint permission, read-only incoming-sync summary, isolated mounted GHL Settings test, five-area Administration, Resources navigation and the eleven-entry role-filtered sidebar with legacy entrances behind Dev Mode.

Executed: 8 GiB typecheck, C1 (339), C3 (211), C4, style isolation (120), five new C5 suites, local production build, manifest (206 mandatory entries), workflow restart. Also executed: real-browser admin/manager/agent shell smoke (76 checks, disposable fixture, APIs answering 501: route, sidebar order/highlight, Administration area fallback; receipt in docs/certification/stage3-c5/browser). Workflow-ID guidance now distinguishes reference-only sequence IDs from handoff-workflow IDs that are skipped when missing. Also executed on a disposable migrated database: data-bearing Administration/Resources panels (real handlers; permissions 290/290 routes, Queue Holds real DTO, readiness 26 probes without schema failure, Knowledge labels/editor 190px/URL tabs), compiled style and overflow at 1280/768/390, GHL Settings mounted in a real browser for five incoming-sync states, and a matched pre-C5 client performance comparison (candidate not slower). Not executed: remaining panels' data walks, merchant/partner sessions, dark theme/zoom/screen-reader/contrast, live-provider GHL recheck, full roster (historical 161/197 unchanged and not relabeled). The GHL Settings stall was not reproduced in jsdom or in a real browser; its cause is unclaimed.

Remaining-panel walk (709 checks, disposable fixture, six real roles, all 46 Operator views, five integrations selectors, Content/Blaze/Playbooks/Training children, light/dark contrast on 3,322 elements per theme with 0 failures, real 200% zoom, keyboard and accessibility tree) passed after fixing defects it found (AI Health crash on failed response, unnamed controls, duplicate h1, admin-only requests from Overview, low-contrast text). Not a real screen-reader run; unregistered sources answered 501. Manifest now 210 mandatory entries. Evidence and exact remaining owners: `docs/certification/stage3-c5/README.md`; inventory: `docs/certification/stage3-c5/actions.csv` (268 rows). Incoming GHL remains enabled and outbound paused; no send, seed, release, provider write, DDL or deployment occurred.

## 38. Task #2076 / C5 live-source and CRM audit — 2026-10-20 UTC

**Scope/decision:** Audited the supplied Task #2076/C5 (Administration, Resources, diagnostics and final employee shell) against the original C5 prompt, current code and authenticated production CRM. Continue the same implementation task with the consolidated corrections; C5 is not accepted or deployed by this audit. See `LIBERTY_TASK_2076_C5_LIVE_REPO_CRM_AUDIT_AND_CORRECTIONS_2026-10-20.md` for exact code repairs, role/navigation/UI contracts, acceptance amendments, all 59 route patterns and all 181 assigned historical panel rows.

- Initial main `447e59cb8d7a2659258243107ec6454106fb3f6a`; closing source drift reviewed through `ef6434207ed8c8d08156a9c70d57e702c4a40314`. The later 13-path enrichment/queue-preparation change adds three integration suites; no C5 page/registry/diagnostic, lockfile or migration change. Preserve concurrent fixes. Current mandatory roster is 200; the retained full-run receipt was 197, not 200.
- Production public health reports `86b022ab33e7094d7aa9395500d4c8ef120b2f58`, build `a7f570e8-25e9-41af-943c-41fc0827c815`, built2026-10-20T03:50:52.981Z. Eight selected built C5 client chunks matched production bytes. This does not certify complete server/schema/native parity.
- Live admin desktop: legacy sidebar and eleven AdminHub tabs remain; five-area Administration/Resources/final eleven-menu consolidation is unbuilt scope. Permissions still says0/0. Queue Holds crashes with desiredLogicalHolds.map not a function. Full readiness displays25 while returning26 (16pass/7warn/3fail), includes failing schema queries and Pass despite a Communications activity query failure. Knowledge/Training child deep links ignore their tab; current C1 Operator parent/legacy/reload repair and hidden bulk-enroll rejection work in observed cases.
- Nine bundles contain current confirmed defects: permissions/provenance/error honesty; Queue Holds DTO; readiness schema/populations/canonical pause; operational status/bounded audit-history truth; complete GHL guidance and native-ID diagnostic; Knowledge/Content error states and JSON mutation receipts; typed C5 URL state; manager-visible admin-only actions; form labels/editor/visual adoption. Two further bundles specify unbuilt workspace/shell scope; one separates passive status from existing incoming-import continuation behavior. Twelve bundles are repair scopes, not twelve new independent additions to95 source claims. GHL Settings stalled browser inspection after one reload; cause remains unverified and requires complete-page mounted/candidate proof.
- Fresh stored incoming status at2026-10-20T10:07:10.514Z: production/configured/incoming enabled true; outbound paused true; retained import ready/nextAction null/applied0, last updateOct3, stale freshness/no observed owner/heartbeat. Configuration and an unapplied preview do not prove current delivery/consumption. Optional GHL sync control and circuit/connection must remain separately labelled. No incoming toggle or outbound change was made.
- Supported stock dependency install, whole-project typecheck with8GiB heap, actual production build, C1 foundation339, C3 contracts211, SSR style isolation120rules and manifest checks passed on the initial reviewed source. Closing source check/build/manifest results are separately recorded in the audit report. Full pre-deploy was not rerun here. Repo Section36.3 reports161/197 initial passes/36failures; clean retries left34 reproduced failures; additional fixture suites5pass/3fail, with baseline qualifications. It remains a failed gate, not accepted baseline defects.
- Full59-route/181-panel dynamic-control/alternate-role/mutation-readback/browser/mobile/dark/real-zoom/accessibility/performance/rollback/native acceptance is not claimed. Independent C5 work proceeds; final affected navigation targets need functioning authorized candidate handoffs. Unrelated later-stage certification is not a blanket prerequisite. Preserve C2/C3/C4 interiors/authorities, all historical source IDs, incoming-enabled/outbound-paused separation and D/Stages4–9 evidence ownership.

No application code, production setting/account/data, schema, worker schedule, provider send, enrollment/release, merge/push or deployment was changed/submitted by this audit. Existing mounted page reads may perform connectivity probes; no claim of zero provider reads. Replit read-only inspection was busy/not queued. The canonical ten-stage Go Live sequence and95-source-entry lineage remain unchanged.

Closing verification: on ef643420, whole-project TypeScript (8GiB heap), actual production build and the200-entry manifest check passed. The new local build is79a3a9a4-dcf9-4209-88e2-178859126691; it was not published. Closing public health still reports production86b022ab/builda7f570e8-25e9-41af-943c-41fc0827c815. Previous Section37 C3 source allegations R1–R7 are superseded where current repaired source/Section36.2 receipts establish the fix (literal routes, retained sequence creation, backlog bounds/enqueue/decoding, inventory-first UI, typed tab history, open-stage definition). Retain qualified acceptance obligations; do not carry obsolete source defects as blanket C5 blockers.


---

## 39. Integrated post-C1–C5 repository and published CRM audit — 2026-10-22 UTC

The owner reports C1–C5 merged/published. This audit confirms the final employee shell, Administration areas and retained compatibility navigation are serving. It does **not** establish full Stage 3 integrated acceptance or a Stage 9 release verdict.

Tested source `c0f05223be70102904063cb1c0afc5af92f278b9`; serving application `5ccb3be4ecff51f83ff5a38fec5123107e14fd15`, build `c745f679-686e-4a58-b83f-bf57f6e585a7` (`2026-10-21T22:22:52.402Z`). That tested snapshot differs from serving source only in documentation. Seven selected compiled client assets matched production; complete deployed-server/schema/native parity is not claimed.

Closing main advanced to `46878111a870a329381dc2c7108471c4095ac0de`; its eleven-file enrichment continuation diff was reviewed separately. Final health still reports the preceding serving build. Preserve its improved historical/estimate labels and default-closed domain/location automation; no worker activation, mutation, candidate build or runtime proof is claimed. D04 additionally covers its distinct-contact count labelled as paused memberships and available-empty ready-held groups displayed as unavailable. The nine repair bundles and 147 UI route patterns remain unchanged. Fresh check results below belong to `c0f05223`, not closing main. See the report's closing-source qualification for the exact additional gates.

Live admin walkthrough opened all 147 route patterns, including context records, compatibility aliases and separate mobile/portal entrances. It exercised the eleven sidebar targets, 46 Operator view selectors, five Contact areas/20 available sections, fourteen Lead Ops selectors and six Canonical Enrichment views, plus Administration/Reports/Resources/service entrances. Some records are navigation/loading observations; this is not a pass for all 309 historical panel rows, every data reader, every role, or every mutation. Detailed route coverage accompanies `Liberty-CRM-Audit-2026-10-22.md`.

Read-only authority observations: outbound **paused**, database source, epoch **1**; incoming GHL updates **enabled**, configured true, outboundPaused true. Retained incoming import remains an October 3 unapplied ready preview; runtime heartbeat/backlog/owner consumption is not proved. Queue Holds renders without its former DTO crash. Permissions enumerates 1,738 registrations (1,311 role, 284 authenticated, 143 unknown; unknown not public). Full Launch Readiness returns 26 probes, **18 pass / 7 warn / 1 fail**, with no old missing-table/column errors. Queue/Redis degraded evidence and stale sync remain qualified; the Sales Rep Operations failure retains Stage 8 ownership. GHL Settings rendered 100 recent-activity rows without the earlier all-log stall. Review aggregate 110 is separate from pending dead-letter history 2,988. Partner Referrals loaded after its earlier route repair.

Nine grouped confirmed repairs remain: D01 unsafe Data Health subprocess/command and false safe-operation copy; D02 incomplete GHL execution ownership/readiness guidance; D03 sales metric definition drift and zero-denominator performance claims; D04 loaded-window/raw-status/population labelling; D05 remaining raw hub URL callers; D06 missing/duplicate composed H1s; D07 textarea selector specificity (86px Notes/44px computed floor versus 96px contract); D08 unnamed ticket checkboxes, dark KPI contrast (1.82:1) and dark wordmark treatment; D09 unbounded company picker (1,227 buttons/13,458 nodes). Six optional UI/workflow proposals are separate from defects. These repair bundles **are not nine net-new additions to the original 95**. Prior C5 R01/R02, core R03, R09/R10 and specific GHL history/circuit repairs are superseded where current evidence proves the fix; R05/R07 and remaining presentation acceptance stay open. Preserve all original IDs and the ten-stage sequence.

Fresh supported checks: stock install 764 packages, whole TypeScript, actual local production build, C1 foundation339/query-runtime, C2 contracts286, C3 contracts211, C4 contracts, four C5 static suites, style isolation120 and manifest219 passed. Two nested npx/tsx mounted launchers failed on local IPC EPERM before component execution; direct execution of UploadLedger/CanonicalBacklog/LeadImports/GhlSettings component files passed. The failed launchers are not relabelled. Full 219-suite CI/DB/Redis/security/real-role/rollback roster was not rerun. Historical161/197 and baseline qualifications remain historical, not a current green gate.

Remaining acceptance is grouped as real-role workflows; disposable mutation/replay/fault/readback; widths/real zoom/assistive technology/contrast/performance; operational/native and financial provenance; clean delivery/full gate/rollback. Actual zoom was not achieved by this browser's key controls. C4's repository receipt still records incomplete user-requested closure; C5 README still says NOT READY and its referenced actions.csv was absent from the tracked evidence directory inspected. Publication does not retroactively close those evidence gaps.

Proceed under existing Stage 3 D with D-R1 data/actions/truth, D-R2 shared UI/workflow and D-V integrated acceptance. Preserve incoming ON/outbound paused, command/identity/consent authorities, public-site style isolation and concurrent enrichment work. No application code, production setting/account/schema, provider command/send, enrollment/import/approval/release, merge/push or deployment was changed. Canonical document files updated here; carry this receipt into repository docs during the repair handback.

### 39.1 Stage 3 D-R1 implementation receipt — source only, not yet published (no GO verdict)

Scope: CRM-D01 to CRM-D05. D-R2 (D06 heading ownership, D07 textarea specificity, D08 accessible names/contrast/inverse logo, D09 bounded company picker, UI-01 to UI-06) and D-V (integrated acceptance) are **tracked and not started**. The 95 source entries and 14 repair groups are unchanged; D01–D05 are repair bundles, not new findings, and no original finding is closed by this receipt.

| Bundle | Change | Executed proof | Not claimed |
| --- | --- | --- | --- |
| D01 | The immediate Data Health subprocess is removed (`scripts/reconcile-orphans.ts` deleted). Admin-only read-only plan, explicit selected-action apply with per-action row lock, recheck and same-transaction audit, durable receipt per operation. Only `deal_link` (unique email match, never ambiguity-first) and `enrollment_cancel` actions exist. The lifecycle backfill action was dropped because `contacts.lifecycle_state` is NOT NULL with a default, so a null population cannot exist; it is reported only. `next_action_at` is never changed and no enrollment is created. | Disposable-database cert `test-data-health-reconcile.ts`: 46 checks (read-only plan, ambiguity/archived/non-production/no-email unresolved, apply, forged key, replay, conflict, concurrency, drift, audit-failure rollback, stale resume, no provider network). Role-guard smoke 162/162 including plan/apply/operation guards. | Browser run of the new Data Health plan/confirm/receipt UI; response-loss fault injection; any production execution. Direct SQL is used inside the transaction because the existing storage authorities are not transaction-capable. |
| D02 | `shared/ghl-ownership-guidance.ts` now lists the 15 supported handoff workflows that have real callers and treats the other 24 registry IDs as reference-only. System Readiness reports only missing supported handoffs, naming the caller; Marketing/GHL guide copy no longer says missing workflow IDs make all automation fail. No activation or unpause guidance. | `test-ghl-ownership-readiness.ts` 73 checks (39 registry, 15 supported, 24 reference-only; source census). `test-stage3-c5-diagnostics.ts` passes. | Rendered readiness page in a browser. The existing "no unpause guidance" check has exemptions for three files and is weak. |
| D03 | One rate contract (`shared/metric-contract.ts`). Reports "Active Pipeline" now uses `OPEN_SALES_LEAD_STAGES`; Nurture and unrecognized stages are reported separately; stalling uses open stages. Win rates (Reports and Chargebacks) are unavailable with numerator/denominator when nothing is decided, shown as "Not enough outcomes" / "No decided deals" instead of 0% / below target. | Disposable-database cert `test-pipeline-metric-contract.ts`: 16 checks (New Lead, Nurture, unknown stage, Closed Won/Lost, archived, non-production, other owner; privileged and rep scope; empty denominator versus real 0%; chargeback rate). `test-cro01-revenue-contract-static.ts` passes. | Browser rendering; other surfaces that compute their own rates. |
| D04 | Audit Log card is "Entries loaded" for the current window; Contacts count states "matching the current filters" with as-of; raw email status `active` is labeled "Active status" / "status only, not validated"; Data Health returns populations; Lead Ops counts paused **contacts** and paused **enrollments** separately (old `readyHeldPausedMemberships` removed), an available empty `ready_held` returns exact 0, failed blocks stay unavailable with `blockErrors`, and each funnel block reports availability and as-of. Newer funnel labels from the enrichment continuation are kept. | Source assertions; production build; role-guard smoke. | A DB-backed test for the lead-ops funnel block statuses; browser verification. |
| D05 | GHL Integration, Content, Playbooks, SDR and Deliverability hubs decode `tab` once through `hubTabState` (duplicate, invalid and role-forbidden values fall back and show a notice) and change tabs through `typedTabUrl` (history push, registered context such as `contactId` and hash kept, arbitrary keys dropped). Generated route/query registry refreshed (five `tab` entries). Legacy entrances unchanged. | `test-stage3-d-hub-tabs.ts` 33 checks; C1 foundation 339; C2 contracts 286; C3 contracts 211; C4 contracts; C5 route inventory, resources, sidebar; manifest check; `api-coverage` workflow; local production build. | Reload, Back/Forward and keyboard behavior in a real browser (D-V). |

No full-project TypeScript check was run (project instruction); compilation was covered by the local production build and per-file syntax checks only. Production is unchanged until the owner publishes this group; serving identity will be recorded separately below after publication.

## 39.2 D-R1 publication identity and signed-in production walkthrough — 2026-10-22 UTC

**Serving identity (read from `https://libertybancard.com/api/health`):** source `4e1b3788…` (the D-R1 commit), build `a8cc7afd-b8f8-4308-81c7-939a209a246e`, built 2026-10-22T09:57:50Z. Publication was performed by the owner.

**Verified in a signed-in production browser (admin session, read-only actions only; no production write was made):**

| Item | Observed |
|---|---|
| D01 | Data Health renders; "Build read-only plan" reports 0 safe actions; 5 active enrollments without a next-action time and null lifecycle (0) are reported only. The apply path was not exercised in production because there was nothing to apply. |
| D02 | System Readiness shows supported handoff workflow IDs 0/15 with caller-specific messages; the 24 reference-only IDs are labelled as not affecting readiness or sequence sending. |
| D03 | Reports show Win Rate "Not enough outcomes — 0 won of 0 decided", Active Pipeline 2, Chargebacks "No decided deals". |
| D04 | Audit Log card is "Entries loaded (this view, capped at 100)"; Contacts shows "160,226 contacts matching the current filters" with an as-of time; "Active status" is labelled status only; Lead Ops SFP blocks all available with as-of and no block errors. |
| D05 | All five hubs fall back and show the selection notice for invalid or duplicate `tab`; real tab clicks push history, keep an integer `contactId` and hash, and drop junk keys; Back/Forward/reload and keyboard arrows behave. Legacy `ghl-settings` and `ghl-workflows` entrances redirect to the right tab. |
| General | 14 pages loaded with zero console exceptions and zero `/api` 4xx/5xx responses. |

**Findings from the walkthrough:**

1. **Unknown-class deals are excluded from Reports.** Only 2 sales deals are `record_class = 'production'`; 1,569 New Lead, 2 Proposal Sent and 2 onboarding deals are class `unknown` and are excluded by the existing revenue-read-authority rule. Not changed. Data Health's "active production deals" wording counted unknown-class deals (1,441), so the label now says "active and not classed test, demo or synthetic (this includes deals whose record class is still unknown, which Reports does not count)".
2. **Stale GHL setup guide text.** The Workflow IDs tab still told operators that "GHL then handles all delivery" and to "unpause the sequences you want running". Both contradicted the ownership model and the pause. Rewritten (steps 2 and 5), and the unpause-wording check in `test-ghl-ownership-readiness.ts` no longer exempts that file (73 checks pass).
3. **Domain/location automation makes almost no progress per tick.** It is enabled (by an administrator), has made 28 assignments, 0 paid calls, no error, but after three ticks the cursor was still 0. It runs only inside the 30-minute discovery job, and a tick that stopped on its time budget did not save its place, so each tick re-evaluated the same first contacts. The tick now saves the last contact handled when it stops on its budget and resumes after it. New certification checks (60 pass on a disposable database) prove cursor advance and no re-evaluation. This takes effect only after publication.
4. **Serper contact-page stage** was observed enabled (25 requests per run) by someone other than this session: 41 requests/credits, 5 businesses with a staged email, 0 qualified. No setting was changed.

**Not verified in this walkthrough:** D-R1 apply path in production, responsive/mobile and the non-admin role matrix (D-V), C4/C5 browser suites after publication (known baseline failures, §36.3). D-R2 and D-V remain tracked and not started. Outbound pause unchanged (paused, epoch 1); no sends, enrollments, releases or provider enabling.

### 39.2.1 Follow-up publication confirmed — 2026-10-22 UTC

Production `/api/health` serves source `67b6226c2f4b5d5a70306704c8b26b803b59e8d2`, build `10f68a14-6651-4f87-a6f1-2f64f7488ff9`, built 2026-10-22T11:07:26Z. First domain/location tick after publication (11:08:34Z): cursor moved from 0 to 281 (scanned 407, committed 31, no error), so resumable ticks work in production. The rest of the first window and later windows are still pending; one tick runs per 30-minute discovery job. D-R2 and D-V remain tracked and not started.

## 40. Stage 3 D-R2 — source implementation and local verification, 2026-10-22 UTC (not published; no GO verdict)

D-R2 changes presentation, heading ownership and one read-only search route. No outbound pause, provider budget, worker schedule, enrollment, release or deal classification was changed; the ~1,570 unknown-class deals were not touched.

| Item | What changed | Verification actually run |
|---|---|---|
| CRM-D06 | The page `h1` is a runtime claim. `PageTitle`, `PageHeader` and `CrmPageHeader` at level 1 register a claim; the shell title (`ShellPageTitle`) is the single fallback `h1` only while no claim exists. The error-boundary fallback is itself a level-1 title, so a crashed page or route has one `h1`. Loading skeleton is a `role=status` region, not a page. Hubs embed children at `h2`; unrelated section headings are never suppressed. | `scripts/test-stage3-d-r2-headings.ts` (jsdom, mounted, 14 checks, in the pre-deploy roster): shell-only, shell-to-page hand-off, page switch, tab re-key, hub with embedded children, unmount, crash inside shell, crash with no shell, recovery, and a MutationObserver sampling that never saw two `h1`. Browser monitor on direct entrances, tab clicks and contact 404/500 never showed two `h1`; zero `h1` appears only before the shell mounts and while a route chunk's fallback shows (no loading-time `h1` was added deliberately, to avoid a text swap). |
| CRM-D07 | Ordinary CRM/portal `textarea` floor 96px (removed from the 44px control rule), prose editor 200px; scoped to `.crm-theme`/`.crm-portal`. No public CSS changed. | Computed styles in a signed-in browser, light and dark: ordinary 96px, prose 200px. |
| CRM-D08 | Ticket-row checkbox name `Select ticket #id`; Prospects select-all and Outreach Queue bulk checkbox named; separate `--crm-danger-text` token for `.text-destructive`; employee sidebar renders blue logo in light and white logo in dark. | Computed danger text: light `rgb(175,29,29)` on `rgb(252,250,248)`; dark `rgb(244,113,113)` on `rgb(15,23,41)` (both above 4.5:1 by calculation). Dark shows only the white logo, light only the blue. |
| CRM-D09 | `GET /api/companies/search`: actor predicate in SQL before order and limit, default 25 / max 50, order `lower(legal_name), id`, opaque keyset cursor, exact authorized `total`, `excludeContactId` re-pins contact authority, strict query schema, registered before `/api/companies/:id`. `readCompanies(bindWorkActor(...))` and link/create command versions are unchanged. Picker uses a debounced, abortable, generation-guarded hook; states Loading / No match / Unavailable+Retry / Show more / selected summary kept by exact ID; ArrowDown/ArrowUp move between options. | Disposable-DB suite with 1,150 companies (19 checks): exact total above 1,000, full cursor walk without gaps or duplicates, agent total/page limited to authorized rows, another agent disjoint, cursor from another actor never widens, literal `%` and `_`, malformed cursors → 400, stale auth epoch → 404, unauthorized contact scope → 404. Browser: 25 of 1,222 shown, No match, Show more to 50, selection kept, keyboard focus moves option → option → input. |
| UI-01 | Contact keeps header, owner, pause state and area links while a section loads. Only the contact core is retained (`RetainedContactCore`), keyed by protected actor scope, permission generation and contact ID; no section payload is reused. The core is dropped on any error, actor/permission change or record change, and a response that arrives after such a change is discarded. | `scripts/test-retained-contact-core.ts` (10 checks: actor change, permission change, record change, late response after each, error drop, no section payload). C2 header suite rebuilt and passed with stronger geometry assertions (Back and breadcrumb on one row, exactly one `h1`, area navigation after the status block, mobile 390x844 navigation bottom within the viewport as originally certified). |
| UI-02 | Campaigns already has one `h1`, four areas and one contextual row; Canonical Enrichment view rail made single-line (descriptions moved to titles). URL keys and aliases unchanged. | Crawl and browser. |
| UI-03 | Today: "Next actions" worklist directly after the summary (each count states Unavailable rather than 0 when unread); AI copilot/digest controls collapsed into a details element; pause and capability notices stay visible. | Browser, light and dark. |
| UI-04 | Shared presentation adopted where its contract fits (table below). `PageHeader` is now a thin wrapper over `CrmPageHeader` (single header implementation; test ids kept). Sixteen destinations now use `CrmPage`; ten of them also use `CrmPageHeader`; My Earnings, Partner Portal and Partner Referral Pipeline KPI blocks use `ScopedMetricStrip`. Metric rail numerals are Sans with tabular figures; Mono stays for IDs. | `scripts/stage3-d-r2-ui04-inventory.ts` (56 routes, output saved in `docs/certification/stage3-d-r2/ui04-inventory-after.txt`); contract suite asserts each adopted page and that every shared tag in use is imported (a missing import in Arbitration Log was found by browser and fixed). Browser: 17 migrated screens at 1280 and 390 px, one `h1` each, no horizontal overflow. |
| UI-05 | People: one toolbar, selected-filter chips with remove buttons, quick filters moved into the existing filter panel (all filters and URL keys retained). Merchant Operations keeps 5 groups / 16 destinations; current group emphasized. | Browser: chips render from URL; panel contains chip-never-contacted; 5 groups, 16 links, current group "Delivery" on Onboarding. |
| UI-06 | Contact Back returns to the remembered filtered People URL (per user, validated pattern); breadcrumb "Records / Contact" sits on the Back row. Business Back no longer uses browser history: the inventory remembers its search, filters and page (`bq`, `bvertical`, `bemail`, `boffset`) per user and Back opens that URL, or the default inventory when none is remembered. Collateral labelled "public library" in Resources with a "Back to Resources" line for signed-in employees on `/assets`; no employee CSS on public assets. | Browser: inventory with `bq=llc` -> business -> Back restored the URL, search input and the same 50 rows; direct entrance with 9 history entries -> Back opened the default inventory (not the previous page); reload on the business page with remembered context -> Back restored the filtered list. Static contract and validator checks for inventory URLs. |

**Suites:** `scripts/test-stage3-d-r2-contracts.ts` (46 checks), `scripts/test-stage3-d-r2-headings.ts` (14), `scripts/test-retained-contact-core.ts` (10) and `scripts/test-company-search-authority.ts` (19, disposable DB) are in the pre-deploy roster and manifest. D hub-tab (33), C2/C3/C4 contract suites, C5 sidebar/resources and the API-coverage check pass.

**Private-browser suites (rebuilt `dist`, isolated disposable DB/Redis, one suite per run):** C2 contact header, C2 post-merge browser, C2 actions, C2 browser (.mjs), C5 panels, C5 role-negative requests, C5 GHL stored run, C5 walk, C5 browser and C5 mounted all passed (10/10; summary in `docs/certification/stage3-d-r2/private-browser-suites.txt`). `test-stage3-c5-performance.ts` is an explicit opt-in and was not run (D-V). A first run against a build that predated an import fix also passed 9/10; the one failure was my own new header assertion reading elements the test script had not yet captured, not a product defect.

**Corrections to earlier statements:** the earlier claim that `test-c2-contact-header.ts` fails on a clean baseline was wrong. The failure came from a stale `dist/public`, then from a breadcrumb placed on its own row; after rebuild and moving the breadcrumb onto the Back row the certified geometry holds (mobile navigation bottom 842 within 844). The private-browser suites were not skipped; results are above.

**UI-04 destination disposition** (flags: P=CrmPage, H=CrmPageHeader, M=ScopedMetricStrip, S=CrmDataState, W=WorklistToolbar, T=CrmDataTable; full list in the saved inventory):
- Already compliant before this change: Overview, My Day, Next Best Action, Contacts (with table), Contact, Company, Pipeline, Work (tasks/appointments), Reporting hub, Admin hub.
- Changed to the shared contracts: Co-Branded Proposals, Partner Organizations, Arbitration Log, Knowledge Admin, Knowledge Base, My Portfolio, Referral Program, My Earnings (+ metric strip), Ready for Outreach, Queue Holds (page + header); Boarding Tracker, Merchant Applications, Document Vault, Leaderboard (page root); Partner Portal and Partner Referral Pipeline (page root + metric strip).
- Deliberately retained: thin hubs that delegate presentation to children (GHL Integration, System Health, Merchant Risk, Merchant Success, Support, Content, Playbooks, Contacts and Leads, My Leads); redirect routes and sidebar aliases (no UI of their own); Comms Hub keeps a hard-coded `crm-page` root because the inbox workspace needs its own layout class; large bespoke screens left unchanged to avoid risk (Activation Panel, Lead Operations Center, Training, Statement Review, Settings Integrations, Canonical Enrichment, Prospect Import, Underwriting, Onboarding Kickoff, Business Detail, Outbound Center); `WorklistToolbar` is used nowhere because People uses the filter panel with chips, which the toolbar contract does not fit. Provenance paragraphs on these retained screens were not shortened in this pass; that remains open under D-V/UI follow-up.

**Not verified:** published behavior (D-R2 is not published at the time of writing), non-admin role matrix and full performance evidence (D-V), narrow-viewport inspection beyond the screens named above. D-V remains tracked and must also verify that D01's direct SQL preserves authorization, identity and lifecycle invariants. Stage 3 D remains open.

## 41. Stage 3 D-V — integrated acceptance, 2026-10-22 UTC (source; not yet published; no GO verdict)

D-V closed the three D-R2 observations, ran integrated acceptance, and repaired the defects that acceptance found. No outbound pause, provider budget, worker schedule, enrollment, release, GHL apply or deal classification was changed; the ~1,570 unknown-class deals were not touched. Production was read-only (health and public GETs only). The previous published build is `f22318cb31797e7484075b10c4586c5492d21b48` (built 2026-10-22T16:34:47Z, verified at `https://libertybancard.com/api/health`). This section describes the next commit, which is not live until the owner publishes it.

### 41.1 D-R2 observations

| Observation | Result | Evidence |
|---|---|---|
| Knowledge Admin at 1280, heading and error state | No defect. Six loads (3 direct, 1 in-app navigation, 1 reload) each end with one H1 "Knowledge Base Admin" once the lazy chunk loads (0.9–1.6 s typical, one 5.8 s cold dev compile; the earlier "missing H1" was still loading at a 4.5 s window). With `/api/knowledge*` blocked the H1 stays and two `role=alert` states appear ("Whole-library statistics unavailable", "Knowledge sources are unavailable. This is not an empty library."). | Browser run on dev serving build. |
| Company picker selection, pagination, keyboard | No defect on current source. Contact 192678: 25 of 1,222 shown; no match → "No match"; clear restores; Show more → 50; ArrowDown/ArrowUp moves through options and back to the input; selection summary names company and ID with submit enabled; no horizontal overflow at 390 px. First dev load needs about 14 s. | Browser run on dev serving build. |
| UI-04 provenance presentation | Added `ProvenanceNote` (visible summary + expandable "Data source and limits"). Leaderboard, Document Vault and Canonical Enrichment now show a short scope / as-of / uncertainty line (Leaderboard keeps period, as-of, deals loaded/total, completeness and "not observed revenue or native receipts"; Document Vault keeps "not complete relationship coverage"); diagnostics are inside the expandable detail. A 45-route crawl found one h1 everywhere; remaining long text is operational data (tables, queue holds header, GHL inbound sync card, settings/integrations, system health) and was left unchanged. | `scripts/test-stage3-d-r2-contracts.ts` (58 checks) and browser expand/collapse on the three pages. |

### 41.2 Defects found by acceptance and repaired

| Defect | Repair | Proof |
|---|---|---|
| `GET /api/dashboard/stats` counted the first 500 rows of deals, contacts and tickets and returned them as totals (dev: contacts 500 of 154,889). No page consumes it, but it is a role-guarded API. | Deals use `readPipelineAnalytics` (production, non-archived, open stages from `OPEN_SALES_LEAD_STAGES`), contacts use the authorized production total, tickets use an uncapped open count. Response adds `population` and `asOf`. | Dev after restart: deals 90 / activeSales 90 (matches `/api/analytics/pipeline` and `/api/kpi/summary`), contacts 154,889 (matches lifecycle distribution), tickets 5 (matches KPI). Contract check in the D-R2 suite. Role-guard smoke 162/162 includes this route. |
| `/sitemap-compare.xml` listed `/compare/{shopify-payments,heartland,worldpay,fiserv,gravity-payments}`, which have no comparison page and answered an empty 404. | Sitemap lists a `/compare/<slug>` URL only when the page exists. | All 539 sitemap URLs return 200 on dev after the fix (was 11 non-200 across two causes). |
| `/industries/{dental,med-spa,legal,accounting,fitness,hospitality}-payment-processing` answered an empty 404 from the server although the client app renders them. | Listed industry slugs without a server-rendered page fall through to the client app. | Same 539-URL check. |
| Controls without an accessible name found by the crawl: People contact links for records with no person name, People Show Archived switch, three Pipeline toggles, Partner Referral Pipeline email icon link, 15 Knowledge Admin archive buttons. | Name fallback (company, email, then `Contact #id`), `aria-label` on the others. | Crawl rerun: 45 routes, 0 failures; real unnamed controls 0 (the 6 reported on Onboarding Kickoff are aria-hidden Radix mirrors). |

### 41.3 D01 direct-SQL invariants

`server/services/data-health-reconcile.ts` applies each action in its own transaction with row locks and a same-transaction audit row, rechecks unique active exact-email identity under the lock, and does not go through `LifecycleService` (the storage layer's own deal and enrollment updates do not either, so behavior is at parity). Authorization is route-level admin-only.

- `scripts/certification/test-data-health-reconcile.ts` now also snapshots invariants around apply: contact rows and lifecycle state unchanged, deal fields other than the link unchanged, enrollment schedule fields unchanged, no `communication_events` written, pause settings unchanged. Disposable database: 50 checks passed.
- New `scripts/test-stage3-d-v-data-health-browser.ts` (registered in `scripts/pre-deploy.ts` and `scripts/ci-suite-manifest.ts`): real browser, real admin route module, disposable migrated database, real admin/manager/agent sessions. Plan → select → review → confirm; a real post-commit truncated response (executed fault event recorded) leaves the page saying "Result not confirmed" with no receipt; the saved effect is durable and has exactly one audit row; re-submitting the same operation shows "Result (saved)" and does not apply or audit twice; contact lifecycle/record, deal stage and pause settings unchanged; no provider call. Manager sees no plan controls and the plan route returns 403; agent plan request returns 403. 24 checks passed. A connection-reset fault was tried first: Chrome retried the POST by itself with the same operation id and the page showed the saved result, so the truncated-response fault is the one that exercises the visible failure path. Receipt: `docs/certification/stage3-d-v/data-health-browser-receipt.json`.

### 41.4 Suites executed on the final dev/disposable build (all passed)

Built with `node --import tsx script/build.ts` after the last source edit; each suite verifies the candidate identity.

- Disposable-database browser/route suites: D-V Data Health browser; C5 walk; C5 role-negative requests (admin-only routes denied to manager, agent and anonymous); C5 data-bearing panels; C5 browser; C2 contact header; C2 post-merge browser; C2 actions; C5 GHL settings stored run; C2 post-merge repairs.
- Static/mounted suites: C5 route inventory, diagnostics, hub tabs (33 checks, tab deep links), D-R2 contracts (58), D-R2 headings (jsdom; React `act` warning only), C5 resources, sidebar, mounted GHL settings, C2 contracts.
- `smoke-role-guards`: 162/162. `check-api-coverage`: no new client endpoint without a server handler (860 client endpoints, 1,739 handlers). `test-public-route-validation`: 12 passed. SEO audit: 421 routes, 0 failed, 12 with warnings.
- Matched performance (`scripts/test-stage3-c5-performance.ts`, baseline = pre-C5 client from commit 1422503b built into `generated-artifacts/c5-baseline-client`): medians baseline → candidate, `/dashboard` 349 → 346 ms, admin hub 385 → 232 ms, knowledge base 346 → 326 ms, permissions 467 → 355 ms; all within the bound. Scope: same disposable API/DB/machine, cold navigation, cache disabled, 7 runs; not a production or network measurement.
- Responsive and accessibility crawl: 45 routes × 1280/768/390: one h1, no page overflow, no error text, no duplicate ids, no missing alt (`docs/certification/stage3-d-v/route-control-coverage.md`).

### 41.5 Metric parity checked

Dev, admin session: open sales pipeline = 90 in `/api/analytics/pipeline`, `/api/kpi/summary` and (after repair) `/api/dashboard/stats`, and equals the SQL count of non-archived production sales deals (the dev table holds 2,076 sales deals in total; the rest are archived or non-production). Production contacts = 154,889 in the lifecycle distribution and `/api/dashboard/stats`, matching SQL. `/api/outreach/status` reports 164,267 contacts because it counts every non-archived contact regardless of record class. The two populations differ by definition; whether each screen labels its population was not audited here.

### 41.6 Not executed or not established

- Post-publication smoke of this commit: not run, because the commit is unpublished. Required after publish: `/api/health` sha equals the pushed commit, public page GETs, an admin sign-in walk of the dashboard routes (h1, overflow, console errors), `/api/dashboard/stats` returns whole-population counts, `/sitemap-compare.xml` lists only existing pages, the six `/industries/*` URLs return 200.
- Live (production) role matrix and live apply were not run; role evidence is from disposable-database sessions and the role-guard smoke.
- Performance is a local matched comparison only.
- axe-core is not installed; contrast rests on the calculations in Section 40; no screen-reader testing.
- The accessibility crawl covers 45 routes at rest. `Label`-without-`htmlFor` next to `Switch` exists in other files (29 files use `Switch`); only switches reachable on the 45 routes were checked.
- Other routes still read capped samples (`storage.getDeals/getContacts/getTickets({limit: 500})` in `server/routes/ai.ts`, `crm-operations.ts`, `deals.ts`, `conversation-ai-config.ts`). They feed AI context and operational helpers, not the metric destinations compared above, and were not changed.
- The full pre-deploy roster was not run; only the suites listed in 41.4.

## 42. D-V independent review of b0335a0b — dispositions (2026-10-22; source, not published)

Code under test: commit `d584bdf7` (F01 is the preceding commit on the same branch). All suites below ran on the disposable database against a production build of that code. The final commit adds only this ledger, the spec note and regenerated receipts. Stage 3 is not closed by this section; it needs publication and the post-publication smoke in 42.4.

### 42.1 Dispositions

| Finding | Disposition | Evidence |
|---|---|---|
| F01 Data Health apply authority | Source repair. Each action re-pins ownership token and generation and admin authority in its own transaction; the deal link takes the same per-mailbox advisory lock as `writeContact`; receipts are fenced and actor-scoped; reload recovery offers check, re-submit and discard. | `test-data-health-reconcile.ts` (74 checks), `test-stage3-d-v-data-health-browser.ts` (37 checks), both re-run on d584bdf7. |
| F02 failed reads shown as zero or empty | Source repair. Both partner pages and the expanded referral list throw on a non-OK read and render denied or unavailable with Retry; metric availability derives from the read; "Unavailable" replaces zeros, including the pipeline-value card. Overview active deals use `OPEN_SALES_LEAD_STAGES`. | `test-stage3-d-v-contracts.ts`; `test-stage3-d-v-landmarks-browser.ts` (real 501 read on both pages). Denied (403) rendering and a real successful partner read were not driven in a browser. |
| M1 `/api/dashboard/stats` population | Source repair. The single whole-payload label is replaced by a per-field `populations` object. Tickets are labelled all tickets with a status other than Resolved or Closed, not role-scoped, matching `/api/kpi/summary`. No second ticket policy was introduced. | Contract suite. |
| M2 contact total labels | Source repair. Outreach Command and mobile name the population (all unarchived contacts, all record classes, all owners); `/api/outreach/status` returns `contactsScope`. | Contract suite. |
| F03 Today destinations | Source repair. Overdue and pending task actions open Tasks with `due=overdue` or `taskState=pending`; the new-leads action opens Pipeline with `created=7d`, backed by a server filter `createdLast7Days` on the same predicate as the KPI. Tasks and Pipeline derive the cohort from the URL, show it, and offer a clear control. The overdue predicate is shared by the Today figure's definition and the Tasks filter. | `test-stage3-d-v-cohort-browser.ts`: direct entry, reload, in-app change, Back and Forward on Tasks; Pipeline chip, clear and Back. |
| F04 retained Contact core | Source repair. Only the projected contact core and capability flags are stored; section arrays, notes, deals, tickets, tasks and loaded flags never enter the retained value. | `test-stage3-d-v-contact-core-browser.ts` drives the real Contact component with deferred and failed section responses. A second signed-in actor and a permission-generation change were not driven in a browser; they rest on the protected-scope key and `test-retained-contact-core.ts`. No cross-actor disclosure is claimed. |
| E1 capped exports | Source repair. `/api/export/{contacts,deals,tickets}` have no client consumer; they now stream bounded keyset pages by ascending id with no 500-row cap. Contacts use the People read predicate (archived excluded, role scope, optional `search`, `status`, `assignedTo`, `recordClass`); deals use the Pipeline predicate and resolve contacts by linked ids per page; tickets export all tickets. A failure after streaming starts destroys the connection instead of ending a short file. | `test-stage3-d-v-exports.ts` (18 checks): 1,250 contacts, 1,099 deals with contacts across pages, 1,010 tickets, quote/comma/newline round trip, ascending order, role denial, first-page and mid-stream failure. |
| U1 duplicate main | Source repair. Canonical Enrichment renders a section when not embedded. The crawl tool now fails when a page has a main count other than one. | `test-stage3-d-v-landmarks-browser.ts`: one main and one h1 on the direct page and embedded in Lead Ops. The 45-route crawl was not re-run on this candidate. It forces desktop, uses bare hub URLs and heuristic control names, and is not a mobile, tab, dialog or role matrix. |
| Performance gate | Source repair. Every sample asserts shell readiness and data readiness (no loading indicator for two consecutive polls); a timeout fails the run instead of counting as a sample. Shell and data medians are recorded separately, with candidate identity and the baseline index hash. Legitimate empty or unavailable states count as ready. | Re-run on d584bdf7, 7 alternating samples, same API, database and machine. Data-ready medians, baseline then candidate: `/dashboard` 353 → 491 ms (+138 ms, passes only through the 25% + 150 ms allowance), admin hub 502 → 297, knowledge base 393 → 478, permissions 473 → 254. The `/dashboard` regression is within the bound, not absent; its cause was not investigated. |

### 42.2 Other suites on d584bdf7

`test-stage3-d-r2-contracts.ts` (58), `test-retained-contact-core.ts` (10), `test-stage3-d-v-contracts.ts` (33), `smoke-role-guards.ts` (disposable), `check-api-coverage.ts`, `test-c2-postmerge-browser.ts`, `test-c2-contact-header.ts`. The new suites are registered in `scripts/pre-deploy.ts`.

### 42.3 Not established

- The full pre-deploy roster, the SEO audit and the public-route validation were not re-run; no public route was changed.
- Remaining capped `limit: 500` reads in `server/routes/ai.ts` are unchanged and remain assigned to the AI readiness scope, not to D-V.
- `/api/dashboard/stats` tickets keep the same unscoped definition as the KPI summary; role-scoping tickets would be a separate policy decision.
- Evidence runs used a desktop viewport and an admin session unless a suite states otherwise.

### 42.4 After publication (required before Stage 3 is closed)

`/api/health` SHA equals the pushed commit; authenticated admin smoke of Today actions, Tasks `?due=overdue`, Pipeline `?created=7d`, a Contact section switch, both partner pages and the three exports (row counts against SQL); Data Health apply is not run against production; confirm the outbound pause and incoming GHL sync from their actual control authorities.

## 43. D-V published-review follow-up: partner credential exposure, F01 mailbox-lock gap, F02 remainder (2026-10-22; source, not yet published)

Stage 3 stays open. This section records source and test dispositions only; live dispositions are added after publish and the final authenticated smoke.

| Item | Disposition | Evidence |
|---|---|---|
| Partner credential exposure on six routes (`GET /api/partners`, `GET /api/partners/:id`, `POST /api/partners`, `PATCH /api/partners/:id`, `GET /api/partners/referral-pipeline`, `PATCH /api/partners/:id/tracking`) | Source-fixed. Every response is built from one explicit field allowlist (`shared/partner-response.ts`, `server/utils/partner-response.ts`); nothing is copied by spreading a storage row. Password hash, reset token and expiry, invite token and expiry, `paypalEmail`, stored derived counters and the follow-up task id are not in any response. `link-referral` also returns the allowlisted partner. `Cache-Control: private, no-store`. Internal auth storage (`getPartnerByEmail`, login, reset, invite) is unchanged and still reads full rows. Roles are unchanged (list and detail: dashboard users including agents; create/update: admin; pipeline and tracking: admin/manager); no role receives credential fields. The create route no longer echoes database error text. | `scripts/test-stage3-d-v-partner-response.ts` (71 checks): actual registered handlers, fake populated credentials and a fake future internal column on a storage result, root and nested key checks, success and error bodies, anonymous/merchant/partner/affiliate/agent/manager/admin matrix, required UI fields still present, stored credentials unchanged. Registered in pre-deploy. |
| Frontend types | Storage-row types replaced by `PartnerOperatorRecord` / `PartnerPipelineRecord` in the Partner Portal admin, Referral Pipeline and Referral Program screens. | Editor diagnostics clean on all edited files; `scripts/test-stage3-d-v-partner-browser.ts`. |
| F01 remaining: `storage.updateContact` email change took graph locks but not the reconcile mailbox lock (reachable from the partner-org proposal send) | Source-fixed. `storage.updateContact` and `storage.createContact` take the per-mailbox transaction advisory lock first (old and new address, sorted to avoid deadlock), before any row or graph lock, using the same key as `writeContact` and Data Health apply (`lockContactMailboxes`). No unique-email constraint was added. Known limit: the pre-transaction read of the old email is not repeated inside the transaction; a concurrent change of the old address between that read and the lock is not covered. | Two-connection check in `scripts/certification/test-data-health-reconcile.ts` (78 checks): an updater using real `storage.updateContact` waits while another connection holds the mailbox lock, then updater and reconcile linearize (link applied only before the second match existed, or refused). The `writeContact` concurrency check is retained. |
| F02 remaining: partner "Pipeline Value" used the first 10 contacts and first 5 deals per partner | Replaced by one SQL aggregate over all referred contacts: `openPipelineVolume` (processing volume of distinct open sales-stage, production, non-archived deals; not revenue) and `openPipelineDealCount`; the label reads "Open Pipeline Volume". Admin and manager see all owners. Agent scope labels now read "owned or unassigned" deals and "assigned, unassigned, or linked to an owned deal" contacts. | Partner response suite: 12 referred contacts, 7 deals each, a repeated referral, malformed volume, archived/test/unknown/closed/onboarding rows excluded (85 deals, 84,000), and an empty partner. Partner browser suite: success, truly empty, 403, 500, Retry recovery, expanded referrals success/403/500, on both partner pages, no credential value rendered or received (12 checks). |
| Smoke selector | The API selector is `createdLast7Days=true`; `created=7d` is the page selector only. | Cohort browser suite adds an API check for the recent-deal selector. |
| Suites run on this source | partner response, partner browser, Data Health reconcile, cohort browser, landmarks browser, contracts, exports, role guards, API coverage: all pass. Data Health browser not rerun (UI and apply behavior unchanged). | Disposable runner output. |

Pending (not claimed): publish, serving-SHA check, final authenticated smoke, outbound-pause and inbound-GHL control reads, bounded non-null exposure counts for partner credential columns, owner decision on any credential rotation.

### 43.1 Live dispositions after publish (2026-10-22, serving SHA 8194202c)

- `/api/health` reports production at `8194202c8c4675008999d1d574239fe57cf11cc5`.
- Authenticated admin: `GET /api/partners`, `/api/partners/:id` and `/api/partners/referral-pipeline` return 200 with `private, no-store`, zero credential-pattern keys (23 and 27 keys), and `openPipelineVolume` as a number with no `pipelineValue`. Role-denied behavior is covered by the source role matrix; no agent or manager session was driven in production.
- Controls (read only, never changed): `GET /api/admin/pause-state` reports `paused:true`; `GET /api/admin/ghl/inbound-contact-sync` reports `inboundEnabled:true`, `outboundPaused:true`, with its stored run in state `ready`. The webhook control is part of that response and was not separately toggled or exercised.
- `GET /api/deals?pipeline=sales&createdLast7Days=true` total 0, matching read-only production SQL (0). Exports: deals 2 rows, tickets 8 rows, contacts about 160,700 lines streamed and counted without storing (consistent with 160,690 unique rows plus multi-line fields).
- Data Health: no `DATA_HEALTH%` audit rows in production; nothing applied.
- Exposure assessment (counts only, no values): 3 partners; 2 have a stored password hash; 0 reset tokens, 0 invite tokens, 0 active reset or invite tokens, 0 PayPal emails. Before this publish, the partner list, detail and pipeline routes returned the hash to every dashboard role that could call them (list and detail included agents). No bearer-style token was exposed, so no urgent token revocation is needed; whether to require those two partners to reset passwords is an owner decision. Nothing was reset.
- Not re-driven after this publish: the Today action page in a browser and a signed-in partner-state browser walk in production (covered by the disposable browser suites on the same source).

## 44. D-V remaining repairs after live verification of 8194202c (2026-10-22; source, not yet published)

| Item | Disposition | Evidence |
|---|---|---|
| F01: `updateContactLocalFirst` had no mailbox lock (Contact PUT, incoming GHL apply) | Source repaired. The function takes sorted mailbox locks (address left, address taken) before its contact row lock and re-checks the address after the row lock. `storage.updateContact` re-reads inside its transaction. The incoming GHL apply takes the source-email mailbox lock before its identity row locks. | New suite `test-stage3-d-v-mailbox-and-stats.ts` (real `updateContactLocalFirst`, real Contact PUT handler, `storage.updateContact`, two connections): the writer waits while another transaction holds the destination or old mailbox lock, the contact row is unlocked while it waits, one audit row, stale compare-and-set rejected without writes, case-only change keeps the generation, two concurrent changes into one mailbox complete without deadlock. `test-ghl-inbound-sync-integration.ts` adds a real incoming apply of a blank-email contact: it waits on the mailbox holder without holding the row lock, then completes and fills the email. Data Health reconcile suite (80 checks) pins the lock order in source. |
| F02 regex: partner pipeline SQL used a cooked single backslash, so `.` was a wildcard (accepted `1,000` pattern gaps, `1x25`; `::numeric` could fail the whole aggregate; `$1,000` was silently 0) | Source repaired. One amount contract (`shared/amount-contract.ts`, `server/utils/amount-sql.ts`) with a bracketed literal dot; invalid and blank amounts are counted as unknown deals, never summed as zero; the response carries `openPipelineVolumeUnknownDeals` and `openPipelineVolumeStatus`, and `openPipelineVolume` is `null` when no open deal has a usable amount. The KPI summary volume and profit sums use the same expression (their output no longer concatenates stray digits from malformed text; invalid amounts are excluded there without a separate indicator). | Partner response suite (77 checks) on real SQL: `$1,000`, `1,250.50`, plain amounts are summed; `1x25`, `1.2.3`, `1,00` and blank are unknown; partial, unavailable and complete partners; no route-wide cast failure; TypeScript and SQL verdicts agree on 18 samples. Partner browser suite shows the partial label on both pages. Production read-only check: 2 open production deals, both blank amounts, 0 invalid, 0 formatted, so live totals are expected to show 0 deals with a usable amount for those. |
| Stats contacts predicate | Source repaired (not wording only). `/api/dashboard/stats` contacts count uses the People list population (`readContactPopulationCount`), which includes the agent-owned-deal branch. Admin/manager numbers use the same production, non-archived, non-synthetic definition as the People list. | Agent fixture: assigned, unassigned and foreign-assigned linked to an agent-owned non-archived deal are counted (+3); foreign-assigned without a deal, foreign-assigned with only an archived agent deal, archived and non-production rows are not; stats delta, People list ids and count reader agree; admin and manager +5; merchant denied. |
| Suites on this source | New mailbox/stats suite, GHL inbound integration, partner response, partner browser (rebuilt first), Data Health reconcile, contracts, role guards, API coverage: pass. | Disposable runner output; partner browser evidence receipt and screenshots refreshed. |

Pending (not claimed): publish, serving-SHA check, authenticated live smoke of the partner pipeline keys and control reads. Agent-specific stats parity cannot be exercised with the admin account in production.

## 45. D-V lifecycle contact-count inconsistency after live verification of debf0ded (2026-10-23; source, not yet published)

Original 95-finding lineage and the three completed `debf0ded` repairs (§44) are unchanged. This is the F02/M1 contact-count definition: an independent production check on the published `debf0ded` observed Dashboard stats, People production facets and Today → Contacts by Lifecycle State disagreeing by one contact (dated observations of 160,345, 160,345 and 160,346; not fixed expectations).

| Item | Disposition | Evidence |
|---|---|---|
| `/api/analytics/lifecycle-distribution` filtered only `record_class='production'` and non-archived. It omitted the synthetic-QA exclusion and the role/ownership predicate used by People and dashboard stats. | Source repaired. A shared reader `readLifecycleDistribution` in `server/services/revenue-read-authority.ts` builds its population from `contactReadPredicate` with the same actor and production/non-archived filters as `readContactPopulationCount`. The route keeps its 2,500 ms statement timeout, the 503 unavailable body (`distribution:null`, `total:null`, `available:false`, `error`), the existing fields (`distribution`, `total`, `available`, `sampledAt`) and the `unknown` bucket for null lifecycle state; it adds a `population` field. The Overview chart now states its population, total and as-of time, and a failed read shows an unavailable message instead of vanishing or showing zero. | Disposable actual-handler suite `scripts/test-stage3-d-v-mailbox-and-stats.ts` (now 30 checks): admin, manager and agent distributions sum to their returned totals; totals equal dashboard stats and the canonical count reader for the same actor; admin/manager add exactly the five production non-archived non-QA fixtures; agent adds assigned, unassigned and foreign-assigned contacts linked to an owned non-archived deal, and excludes forbidden, archived-deal, archived, nonproduction and legacy-QA rows; per-state counts move only by in-scope fixtures; merchant denied; a real statement timeout under a table lock returns 503 with null distribution and total, and the next read recovers. Role guards (162/162), API coverage and the static classification check pass. |

These are disposable role-test results; no production write, Data Health apply, contact deletion or reclassification, outbound change or GHL change was made. Pending (not claimed): publish, serving-SHA check, and a production comparison of lifecycle total, People production facets and dashboard stats at matching scope and time.

## 46. D-V Contact verification gaps closed: actor change and authority change during a delayed section read (2026-10-23; test and evidence only)

Closes the two gaps stated in §42.1 F04 ("a second signed-in actor and a permission-generation change were not driven in a browser"). No application, production, account, provider, outbound or GHL change was made. The serving version tested is `cafc77ab1ba7c5a834a84fa000299524516aa626`.

### 46.1 What was added (test-only; not part of the serving application)

- `scripts/test-stage3-d-v-contact-actor-browser.ts` (new), registered in `scripts/pre-deploy.ts` as "Stage 3 D-V Contact Actor Browser". Receipts and screenshots: `docs/certification/stage3-d-v/contact-actor-browser/`.
- Test-only instrumentation inside the page: a fetch hold on `/detail?section=` reads that sends the real request at once under the current session and delays delivery (it strips the abort signal so a late response is genuinely delivered); a `Date.now` skew plus synthetic offline/online events, which make the application's own reconnect rule re-read `/api/auth/user`. The fixture changes the database directly for the account-version, permission and fixture-row changes. Everything that clears, fences or recovers the header, capabilities and section content is the unmodified application.

### 46.2 Binding to the serving version

The receipt records: `client/`, `shared/`, `migrations/`, `package.json`, `package-lock.json`, `vite.config.ts` and `tsconfig.json` have no difference from `cafc77ab` (the run fails if they do); the 13 route, auth, access and storage files the suite loads have identical blob hashes to `cafc77ab`. Six other server files differ from `cafc77ab` (`server/db.ts`, `server/index.ts`, `server/lib/lock-trace.ts`, `server/lib/transaction-observability.ts`, `server/services/canonical-import-recovery-worker.ts`, `server/services/queue-manager.ts`). They come from earlier, separate work (database client BEGIN-failure release, timing and summary logging) and are loaded by the fixture only as infrastructure. The client bundle was built from this workspace by `script/build.ts` and verified by the candidate integrity check; it was not rebuilt from a separate checkout of `cafc77ab`, so "same client source as `cafc77ab`" is established by the source comparison, not by a byte comparison with the published bundle. The candidate identity (`outputHash`, `inputHash`, workspace `sourceHead`) is in the receipt.

### 46.3 Result (disposable PostgreSQL and Redis, persisted Passport sessions, provider transports denied, private Chromium)

Final run: passed, 43 checks, `receipt.json` status `passed`. Each case holds a section response produced for the old actor, changes the actor, shows that the old header, capability tab and section content are gone while the new actor's read is pending, then releases the late old response and shows it does not restore anything, then releases the new actor's read and shows the correct result.

| Case | Change while the section response is held | Recovery observed |
|---|---|---|
| 1 | A different persisted user (agent to another agent) signs in; the open page re-reads `/api/auth/user`. | The new user's own read of the first record is denied and shown as unavailable; a record that user may read shows its own header and content, and its own capability set (no onboarding tab). |
| 2a | The same user's `account_version` is incremented (session stays valid). | The fresh read shows the changed record name and note, and the onboarding tab is absent because the fresh read reports no onboarding deal. |
| 2b | The same user's `permissions` array changes (session stays valid). | Same as 2a. |

Controls in the same run: the held response is shown to contain the old actor's name and section content (so a restore would be visible); the cleared-state predicate is shown to be false while the old header is on screen; no uncaught page exceptions in any case.

### 46.4 Not established

- This is not a full CRM pass. It does not cover a role matrix (only agent to agent, and one user's own changes), production, a real second browser tab, a network-level abort race (the hold removes the abort signal on purpose), or any other page.
- Until the application re-reads `/api/auth/user`, the page keeps showing the previous user's retained header after a session cookie swap made elsewhere. The server authorizes every data read under the new session, and the page fences as soon as the actor is re-read. This is the existing revalidation design and is recorded as an observation, not as a pass or a defect.
- The run used the working tree at `bd22a22b` plus the new test, not a checkout of `cafc77ab`.
- The independent production walkthrough is separate and is not claimed here.

## 47. Stage 4A — Catalog and operational truth (2026-10-28; source, not yet published)

Scope: F01, F02, F10, F12, F13, N01. No outbound activation, no change to the global/email/SMS/cold-email pauses, the `sequences` or `ghl-enrollment-recovery` kill switches, or to GHL sync control, epoch, owner, circuit, approval or runtime selection. No GHL call from application code, no contact-removal or existence script, no local GHL link cleared, no backfill, no provider call, no asset deleted. Incoming GHL contact sync was not touched. No sidebar, theme, dependency or lockfile change (the forbidden-file diff grep returns nothing).

### 47.1 Binding

- Base commit: `4baf2106` (the work is uncommitted source in the working tree on top of it; the receipt is the working tree, not a commit).
- Build identity of the final local build: `56887058-cbfe-4cc1-ae2b-840e86551eea` (`npm run build`, exit 0, client built and server bundle written). The browser suite binds to this build.
- Production baseline control state: unavailable. The production database could not be read through the available read-only path from this session, so no before/after production control comparison is claimed.

### 47.2 What changed (behavior)

- F01: the pilot tab is a read-only history (`PilotHistoryPanel`: GET only, no buttons or inputs). Retired pilot entrances (`select-cohort`, `select-roi-cohort`, `validate-cohort`, `freeze-cohort`, `execute-phase`, `advance`, `transition`, `effect-links`, definitions, approvals, reconciliation) answer 410 after the auth/role gate and enqueue nothing. The paid-provider emergency stop route is unchanged and live; its control moved to Program Health (`PaidProviderControlsPanel`).
- F02: catalog classification derives from package-version pins and `retired_at`, never from status or name; superseded versions are preserved; an unproven transport is not shown as ready.
- F10: sequence and campaign step totals come from a grouped count of real steps, not the stored `total_steps`; `healthScore` 0 stays 0 and null stays unknown; failed channel-count reads show unavailable; SDR `stage`/`currentStage` use one precedence helper and report conflicts; reply, opt-out, bounce, delivery failure and delivery are counted separately and a delivery failure no longer stamps `lastReplyAt`; the paid-provider in-flight list is labelled as a sample next to a whole-population count; the contact page labels a local GHL link as "linked ID recorded locally; current native existence unverified" and shows outgoing control as paused, enabled or unknown.
- F12/F13: queue topology and ZeroBounce schedule reported from what is actually selected and instantiated.
- N01: the exact GHL message "email must be an email" and known variants are a terminal, non-retryable, sanitized rejection; unknown 422, 401, 429 and 5xx are unchanged; an unchanged rejected identity is fingerprinted and not re-dispatched by unrelated enqueues, ticks or restarts; a material change allows one reconsideration.

### 47.3 Verification (commands and exit codes)

Disposable runner is `npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only <script>`.

| Check | Result |
|---|---|
| `test-stage4a-operational-truth.ts` (disposable) | exit 0 |
| `test-stage4a-retired-pilot-routes.ts` (disposable) | exit 0 |
| `test-stage4a-catalog-truth.ts` (disposable) | exit 0 |
| `test-stage4a-metrics-truth.ts` (disposable; also direct against dev) | exit 0 |
| `test-stage4a-browser-pilot-history.ts` (disposable, private Chromium, compiled client; rerun on the final build) | exit 0; 51 checks: emergency stop anonymous 401 and manager/agent/merchant 403 (never sent as admin), empty state at 1280/768/390 px in light and dark, no horizontal overflow, no controls, no non-GET request; populated, loading, error ("unavailable, not empty"), denied, Back and reload |
| `test-ghl-contact-validation.ts` (disposable) | exit 0 (section D updated: see 47.4) |
| `test-ghl-sync-status-render.tsx` (`npx tsx --tsconfig scripts/tsconfig.ghl-inbound-ui-test.json`) | 8/8 pass, exit 0. Not registered in the disposable roster because it needs that tsconfig. |
| `certification/test-ghl-projection-authority.ts` (disposable) | exit 0 on the final rerun, including the new N01 checks GPA-28 to GPA-38 (rerun after the in-flight-edit fix in 47.6). An earlier run exited 1 in an unrelated fixture (a unique-index collision); it did not reproduce and its cause was not established. |
| `test-background-profile.ts` (disposable) | exit 0 |
| `test-stage3-c3-contracts.ts` (disposable) | exit 0 |
| `test-sfp-vertical-classifier-v2.ts`, `test-sfp-five-vertical-fairness-pure.ts` (direct) | exit 0, exit 0 |
| `test-ghl-prepared-review.ts`, `test-ghl-sync-runtime-boundary.ts` (direct) | exit 0, exit 0 |
| `test-cro03c-shared-provider-control.ts`, `test-paid-provider-controls-convergence.ts` (disposable) | exit 0, exit 0 (the second needed one retry after a private-Redis start failure) |
| `role-guards` workflow | 162/162 guarded routes passed, exit 0 |
| `api-coverage` workflow | passed (853 client endpoints, 1767 server handlers, no new unmatched endpoint) |
| `npm run build` | exit 0 |
| `scripts/cro03c-level1-certification.ts` (disposable) | exit 1, one phase failing: 2c. See 47.4. Phases 9a to 9f pass. |

### 47.4 Not established / known failures

- `cro03c-level1-certification.ts` phase 2c fails ("Must have evaluated at least one candidate"). The ROI cohort selector now requires completed classification evidence rows, which this script's seeded businesses do not have. No Stage 4A file touches the selector. It was not compared against a clean baseline checkout, so "already failing before this task" is a conclusion from the code, not a measured baseline. Phases 9a and 9b asserted the retired UI and were rewritten to assert retirement and read-only history.
- `test-ghl-contact-validation.ts` section D used to push a phone-only create and a provider 422 through the real upsert boundary with a fake provider. Provider writes are now fenced by the GHL sync control, which this task must not change, so D2 to D4 now assert that the write is refused (`runtime_not_selected`) and no create reaches the provider. The 422 classification itself is covered by sections A to C and the projection-authority certification.
- The "5xx alert" cause was inconclusive and is not claimed as proven.
- The full TypeScript check was not run (production build and focused suites only). Consumer handlers beyond the ones named in 47.3 were not exercised.
- `ci-suite-manifest.ts --check` reports manifest gaps for five `test-stage3-d-v-*` mandatory suites. They are not new suites from this task; the new suites are in `CERTIFICATION_FIXTURE_SUITES`, not `MANDATORY_SUITES`.
- `CRO03C_CURRENT_MIGRATION_HEAD` is `0260_mi07_dedup_unique_indexes` while the migrations directory ends at 0377. This task added no migration and did not change that constant.
- `client/src/lib/crm-route-registry.generated.json` was edited by hand (one component name, `PilotStatusPanel` to `PilotHistoryPanel`) instead of rerunning the generator, which rewrites many certification documents.
- Stale local GHL links and 15 unresolved edited lead-file GHL contacts are untouched and must not be deleted without an explicit instruction.
- Nothing was published and production behavior was not observed.

### 47.5 Rollback

Source only. Revert the working-tree changes for the files in this task (or restore the `4baf2106` versions) and rebuild. There is no migration, no data write and no control change to undo. The retired entrances return to their previous behavior on revert; the paid-provider emergency stop route is unchanged either way.

### 47.6 Review finding fixed: edit during an in-flight provider request

A code review found that a contact edit enqueued while a request was in flight advanced the desired generation, but a rejection of the old identity then settled the row terminal with a fingerprint of the new (edited) identity, which would have fenced the corrected contact. Fixed in `server/services/ghl-projection-authority.ts`: the rejection is recorded against the identity fingerprint captured at claim time, and an identity rejection settled while the desired generation is newer than the claimed generation returns the row to pending with a fresh budget and records no fingerprint. Other terminal settlements are unchanged. A new certification (GPA-34 to GPA-36) edits the contact during the pending provider call, returns the email-validation 422, and verifies that the corrected identity is dispatched and succeeds. `test-ghl-projection-authority.ts` exit 0 after the change.

### 47.7 Review finding fixed: non-replies stamping `lastReplyAt`

The completion review found that `handleMessageReceived` excluded only failed SMS from the `lastReplyAt` update, so failed email, delivered outbound notifications and inbound STOP messages still counted as engagement. `server/services/sdr/webhook-handlers.ts` now classifies the webhook once with `classifySdrEventKind` and only a genuine inbound reply updates `lastReplyAt`, runs intent classification or moves the stage; opt-outs and every delivery outcome do not. `scripts/test-stage4a-metrics-truth.ts` section 8 drives the real handler for failed SMS, failed email, undelivered, delivered outbound, STOP and a genuine reply and reads the stored state; exit 0 on a disposable database.

## 48. Stage 4A post-publish follow-up P01 to P05 and Q01 (2026-10-28; source, not yet published)

Scope: bounded repairs to the Stage 4A work in section 47. History retirement, the emergency stop, real package ownership, nullable schedules, queue selection and the Contact partial/paused receipts are unchanged. No control, epoch, owner, native approval, production link/projection, campaign content, schedule, provider job, theme, sidebar, dependency or lockfile was touched, and the CR-06 manifest was not applied. Outbound stays paused and outgoing GHL stays owner-paused.

### 48.1 What changed

| Item | Change |
|---|---|
| P01 | Projection skips are described by `describeProjectionSkip`; only true identity rejections (email-validation 422, no usable identity) record the identity fingerprint. Stale links, identity conflicts, not-configured and pause-blocked outcomes keep their own reason or wait. |
| P02 | Catalog truth is derived from pinned package facts (`shared/catalog-truth-contract.ts`, `server/services/catalog-truth.ts`): class, readiness facts (configured, selected, contentVerified, qualified, paused, statusActive, runtimeSelected, operationalEvidence, nativeEffectVerified) and a shared pin-conflict result. Preflight splits `active_sequences` (installation only) from `package_qualification`. |
| P03 | `CatalogTruthPanel` (loading / denied / unavailable with Retry / successful empty / populated) mounted in Cr06Governance. Retired-entrance replacement text names the selected program's governed owner. |
| P04 | `getFullSyncDashboard` reads 24h counts from scoped SQL aggregates (`server/services/ghl-dashboard-metrics.ts`): one asOf, window and scope; each section fails independently to null; 422 email / custom-field / unknown are classified in SQL; only the 10-row detail sample is bounded. The circuit block returns the latest event (so a later close is visible) alongside the last trip. GhlSettings shows the window and the close. |
| P05 | `getIdentityHealthReport` and `getSendMonitoringData` return null rates and an `evidence` block (basis, denominator, sufficient) when there are zero sends; overall capacity is null with no limits. IdentityHealthDashboard separates denied / unavailable (with a read-only Retry) / successful empty. InboxHealth and OperatorDashboard show n/a, unknown health is no longer a green 100, and the domain summary averages known scores only with known/total coverage (a real 0 is preserved). Helpers: `shared/rate-evidence.ts`, `client/src/lib/domain-health-summary.ts`. |
| Q01 | New and previously unregistered suites are registered (see 48.2). Real registered-handler tests added for the retired entrances. Phone-only and 422 proof added to the projection certification through the real worker and a fake HTTP provider. |

### 48.2 Registered / selected / executed / passed

"Registered" = in a roster (`pre-deploy.ts`; the two mandatory ones also in `ci-suite-manifest.ts`, `--check` passes with 241 classified). "Selected and executed" = run through `run-sfp2060-predeploy-disposable.ts --only <script>` on a fresh private database and Redis, or directly. Every row below was registered, selected, executed and passed unless noted.

| Suite | Roster | Result |
|---|---|---|
| `test-stage4a-ghl-dashboard-metrics.ts` (new) | fixture suites | exit 0: exact zero; 700+600 mixed rows with late matches; outside-window and after-asOf rows excluded; open / auth-open / closed circuit; 422 email / custom-field / unknown separated; failures injected per section give null, never zero; `getFullSyncDashboard` contract |
| `test-stage4a-identity-health-metrics.ts` (new) | fixture suites | exit 0: zero-send and outside-window identities give null rates; real 0% with sends stays 0%; alerts unchanged |
| `test-stage4a-retired-routes-registered.ts` (new) | fixture suites | exit 0: real `registerLeadOpsRoutes`, persisted sessions, CSRF and `requireRole`: all 14 retired entrances refuse anonymous, five non-admin roles and admin-without-CSRF, admin with CSRF gets the stable 410; row counts and provider/system control fingerprints unchanged; emergency stop probed for denial only |
| `test-stage4a-ui-render.mjs` (new wrapper: `test-ghl-sync-status-render.tsx` 8 checks, `test-stage4a-catalog-ui.tsx` 8 checks, `test-stage4a-identity-health-ui.tsx` 7 checks) | mandatory + manifest | exit 0. These are `renderToStaticMarkup` of pure view components, not a jsdom or browser mount. |
| `test-http-client-error.ts` | mandatory + manifest | exit 0. Registered because it was an unregistered deterministic test in the repo; whether it was part of the #2106 baseline was not established. |
| `certification/test-ghl-projection-authority.ts` | fixture suites | exit 0, 309 checks including GPA-37 to GPA-48 and the new Q01 checks GPA-173 to GPA-176 (phone-only 422 is retryable and consumes budget with no fence; email-validation 422 fences once and is not re-dispatched unchanged) |
| `test-stage4a-catalog-truth.ts`, `test-stage4a-retired-pilot-routes.ts`, `test-stage4a-metrics-truth.ts`, `test-stage4a-operational-truth.ts`, `test-ghl-contact-validation.ts` | fixture suites | each exit 0 on the final tree |
| `test-stage4a-browser-pilot-history.ts` | fixture suites | first run exit 1 at "denied: access is refused visibly or the panel is not mounted" (the wait returned before the page rendered); rerun on the same build exit 0. Treat as a timing flake in the test, not fixed here. |
| `npm run build` | n/a | exit 0 |

`test-stage4a-retired-pilot-routes.ts` is still helper-shape only (stub `x-role` gate); its header now says so and the unconnected `sideEffects` counter was removed. The real-handler proof is the new registered-routes suite.

### 48.3 Not established

- The full TypeScript check was not run. The full pre-deploy roster, `role-guards` and `api-coverage` workflows were not re-run for this follow-up.
- `GhlSettings` and the other changed pages were not opened in a real browser by this follow-up except through the pilot-history browser suite; the new UI states are verified by static markup only.
- Authenticated production pages cannot be verified from here. No production emergency stop was clicked and no native or provider canary was run.
- `cro03c-level1-certification.ts` phase 2c (see 47.4) was not re-run and remains a known failure.

### 48.4 Rollback

Source only: no migration, data write or control change. Roll back through the existing publishing rollback. No manual database, consent or GHL rollback and no production backfill is needed.

### 48.5 Forbidden-file check

`git diff --name-only | rg 'ghl-sync-control|ghl-sync-runtime|outbound-pause|crm-theme|index.css|package(-lock)?.json'` returned nothing.

### 48.6 V01 passive production observation (2026-10-28, after publish)

- Public `/api/health` returned 200 with `sha` `be8f57fb2a9c…`, `env` production, `builtAt` 2026-10-28T20:38:49Z. That commit contains the P01 to P05 and Q01 files. The following "Published your App" commit `2b498b46` has an identical tree (empty diff against `be8f57fb`), so the running build matches the source verified in 48.2.
- The site root returned 200. These were the only production reads made; no write, no emergency-stop click, no native or provider canary.
- Authenticated pages (GHL Settings, Identity Health, Inbox Health, Operator Dashboard, Cr06 Governance catalog panel) were NOT verified; they need a signed-in session this environment does not have. Neither was it established that the optional/aggregate production reads show the new null/n-a states for real data.
- The www hostname did not respond from this environment (connection failure); not investigated.


## 49. Stage 4B — SFP supply and throughput (2026-10-30; source, not yet published)

Numbering note: the Stage 4B review text refers to "ledger §51.5" and "implementation spec §43.5". Neither exists in this repository (the ledger ended at §48 and the implementation spec at §32.6), so this receipt is §49 here and §32.7 in the spec.

Scope: F03 durable staging hold, F09 single estimator authority, F14 Provider Results crash fix / independent backlog readers / SQL cold-lead paging / truthful loading, F15 selected-policy TTL / per-block telemetry / suppression-first ladders, and the SFP tab reorder. No outbound activation, send, enrollment, provider call, GHL write, Sunbiz run, backfill, reclassification or reimport. The global pause, email/SMS/cold-email pauses and GHL controls were not touched. No schema change (F03 uses the existing `sfp_stage_items` ledger). No theme, sidebar, dependency or lockfile change.

### 49.1 What changed

| Item | Change |
|---|---|
| F03 | `sfp-staging-hold.ts`: a permanent, item-local refusal is recorded on `sfp_stage_items.redacted_result.hold` and bound to a relevant-fact revision (eligibility facts, selected-policy hash, current package fingerprint, link decision, email token, latest named-email review) — not to the run id, the 15-minute bucket or `updated_at`. Suppression refusals (`SFP_STAGING_SUPPRESSED` and the shared gate's `SFP_STAGING_ADDRESS_SUPPRESSED`) are held only for a 12-hour recheck window (the suppression facts are keyed by the sealed address and are not in the revision, so a lifted suppression must be re-evaluated by time, not by revision change). Unknown errors are always retryable. The worker selects, writes ledger rows and claims in one transaction under an advisory lock, skips recipients leased by another live run, and fences settle writes on the run claim token. The outer whole-command catch is unchanged and fails closed. |
| F09 | `resolveVolumeModel` is the one estimator authority. Actual merchant values win; an unavailable model (including Fitness/Recreation, a missing or unknown vertical) yields nulls, never "Other" or $0.00. `deals.ts` and `sunbiz-cron.ts` use it. |
| F14 | Provider Results no longer crashes on a null cost (`usdFromMicros`: null "Unpriced", 0 "$0.00", sub-cent keeps four decimals, non-finite "Unavailable"). Backlog aggregate callers are answered at the whole-response deadline (the caller waits on a race, so a slow pre-transaction read cannot delay the 503); late work is generation-fenced, cannot cache, and is cancelled on pid + xact_start once its transaction is identified. A superseded flight is rejected immediately. Process history has its own endpoint (`/api/canonical-enrichment/backlog-process-history`) and mounts outside the aggregate barrier. Cold leads page in SQL (`LIMIT/OFFSET`, `ORDER BY ..., c.id`) with the total and average from a parallel aggregate over the same predicate; response shape unchanged. Copy and accessible names on Cold Leads are accurate. |
| F15 | Selected recipient-policy TTL applies to businesses inside the SFP staging boundary (the stricter of 180 days and the policy TTL); an unreadable policy fails closed to unavailable. Lead Ops telemetry is read per block, and a failed block shows "Unavailable" with its name instead of a dash or zero. The backlog contact ladder checks current suppression, address, business/link and program/package facts before counting a ready-held recipient as done. |
| UI | SFP tab order: enrichment control center, named-email eligibility review, then cohort tools in a collapsible section. Lead Imports labels the Outscraper reference card general/legacy. Business count reads "Counting businesses…" or "Business count unavailable". |

### 49.2 Evidence, by class (kept separate)

- Code-proved: `npm run build` exit 0 (bundle only; no full TypeScript check, per the kill lines). `ci-suite-manifest.ts --check` valid.
- Closure repair (second pass, 2026-10-30): the aggregate backlog route no longer reads process history at all (no `lastPriorityRun` field); the history route is bounded at 5 s, answers a typed 503 (`PROCESS_HISTORY_DEADLINE_EXCEEDED` / `PROCESS_HISTORY_UNAVAILABLE`), and cancels its database backend on pid + xact_start. The real-worker run found that the shared eligibility gate reports a suppressed address as `SFP_STAGING_ADDRESS_SUPPRESSED` (409), not `SFP_STAGING_SUPPRESSED`; it was classified retryable, so a suppressed recipient would have been retried and then re-selected every window. It is now a timed hold like the other suppression code.
- Fixture-proved on disposable databases (`run-sfp2060-predeploy-disposable.ts --only`), each on its own database:
  - `scripts/certification/test-stage4b-supply-throughput.ts`: 87 assertions. Pure estimator, refusal classification and cost formatting; hold predicate semantics; backlog deadline / supersede / cache fence; the **real HTTP routes** with stalled history (aggregate success, aggregate deadline made genuinely slow by an exclusive table lock, history deadline, a real `pg_sleep` stall whose backend is cancelled, recovery, malformed history, agent 403 on both endpoints); SQL cold-lead paging over 520 rows (page count derived from the total); TTL outside the boundary; worker structure as source assertions.
  - `scripts/certification/test-stage4b-staging-worker.ts` (new, registered in `CERTIFICATION_FIXTURE_SUITES`): 36 assertions driving the real `processSfpCampaignStagingTick` with fake ZeroBounce validation on recipients prepared through the governed canonical preparation writer. Proved: 8 recipients at 3 per window drain across four windows, each staged once; a permanent refusal (retired package) is held and three later windows do not re-select it; publishing a new package reopens exactly those recipients once and they stage; a real suppression refusal is a timed hold, a lifted suppression does not reopen it inside the 12 h window, and after the window the real worker stages it; two concurrent ticks never double-stage (observed: one completes, the other is refused with `SFP_CAMPAIGN_STAGING_RUN_ALREADY_CLAIMED`); no outbound send row; provider traffic limited to the fake transport. **Limits:** windows are simulated by releasing the idempotency bucket key of finished runs, not by waiting 15 minutes; the crashed-worker case starts from a persisted expired claim written by the fixture, not from killing a process mid-transaction. Observed and not fixed: the recovered recipient is staged by the next bucket's run, and its original expired `claimed` ledger row stays `claimed` (inert: expired lease, excluded from selection, one completed row, one intent).
  - `scripts/test-stage4b-workspace-browser.ts`: 23 checks against the compiled client with a private admin session, at 1280 px and at 390 px (mobile emulation). Covers >500 cold leads (total over 500, 100-row pages, next page), history failure shown as unknown while the aggregate renders, a 6 s delayed history read not blocking the aggregate and release panel, Provider Results costs, and no horizontal overflow at 390 px on cold leads, backlog and Provider Results. The Provider Results payload is fixture-supplied. The SFP-tab check only confirms the cohort tools are a collapsible `details`, not DOM order.
  - Existing suites passing after the repair: `test-provider-readiness-controls`, `test-stage3-c3-backlog-command`.
- Stale fixture: `test-sfp2001-campaign-staging-certification` fails at SFP2001-17 on baseline because validation now requires a prepared canonical contact (`canonical_target_selection_required`); its fixture predates that rule. It was not weakened or edited; the new focused suite builds the prerequisite through the governed writer instead.
- Live-read-observed (production read replica, 2026-10-30 17:21 UTC, the build currently published, which does not contain F03): eligibility `discovery_required` 5,770 / `invalid` 421 / `validated_review_required` 237 / `validated_outreach_eligible` 71 (2 of those unstaged); 72 staging intents, all `ready_held`; campaign-staging runs in the last 14 days: 1,323 failed, 15 completed, 6 pending; ledger rows: 2,111 `dead_letter` `named_email_requires_eligibility_review` and 33 retry of the same code, 27 retry `SFP_STAGING_RECEIPT_SUBJECT_OR_ADDRESS_CHANGED`, 1 retry `SFP_STAGING_SOURCE_REFERENCE_DRIFTED`, 72 completed, none carrying a hold. This is the repeated re-evaluation F03 targets; it is the pre-publish baseline, not evidence that F03 works in production. Last recorded backlog priority-run setting: 2026-10-20 09:39 UTC.
- Missing, preserved as missing: the census at the start of the Stage 4B build (production SHA, migration head, policy pointer/hash/TTL, pause and GHL controls) was never captured and cannot be reconstructed; the 2026-10-30 census above is a later, separate reading.
- Not done: post-publish smoke. Nothing has been published from this work, so there is no deployed build to smoke. The signed-in UI of the published app was not checked.

### 49.3 Rollback and read-only post-publish checks

- Rollback: revert the Stage 4B commit; there is no schema or data change to undo. Existing `redacted_result.hold` JSON on ledger rows is inert once the worker no longer reads it.
- After publish, read only: cold-leads page loads with a total and paging; Provider Results opens without an error and shows "Unpriced" for rows with no price; the SFP tab shows the control center first; the hold census (`readStagingHoldCensus`) returns held-by-code counts; confirm the global pause epoch and GHL owner pause are unchanged. Authenticated pages were not checked in this environment.

Next in order: 4C1, 4C2, 4D.

### 49.4 Stage 4B closure repair R01–R03 (2026-10-30; source, not yet published)

The user's report numbers this receipt §51.7 (ledger) and §43.7 (spec); the repo's numbering is §49.4 / §32.8. Already-repaired aggregate/history separation, Provider Results, SQL paging, SFP ordering and the real-worker suite were kept, not rebuilt. Published audit baseline: `8ad8b008442e904a87107620a6b514fa284cc7af`; fresh controls: global pause true epoch 1, outgoing GHL `enabled:false` epoch 16.

**R01 (backlog and launch inventory).**
- Source: the aggregate's `business_locations` correlated subquery became a pre-aggregated join, and the per-contact `cr04_enrollment_intents` lateral became a materialized `DISTINCT ON` CTE. No timeout was raised, nothing sampled, no row dropped, no index added.
- Production-replica-measured (SELECT only, interleaved 3 rounds, identical output md5): businesses phase 20.5s to 2.0s (93 rows); contacts phase 5.8s to 1.1s (292 rows).
- Residual risk, not fixed: the registry phase scans the cold 1.5GB `sunbiz_entities` heap, 0.8s warm and up to about 11s cold. Estimated worst-case aggregate is 15–16s against the 25s deadline; this is an estimate.
- Source: the launch inventory now runs as a generation-fenced flight with a 25s whole-read deadline, cancels the exact transaction (pid + xact_start), refuses to start new policy work after expiry, and answers a typed 503 `LAUNCH_INVENTORY_DEADLINE_EXCEEDED` with the stalled phase and progress. Contact-policy answers are memoized per run for the 600s freshness window, used only by the inventory flight (never by `verifyRecipientBinding` or `selectPrimaryRecipients`), so a retry continues from finished checks. Release status is bounded at 10s with typed 503 `RELEASE_STATUS_DEADLINE_EXCEEDED`. Per-phase timing is logged for post-publish capture.
- UI: the release panel is one independent sibling in loading, error and ok states; failures show a short notice, Retry and closed diagnostics; the SFP cohort tools `<details>` is closed by default.
- Production-replica-measured: the recorded-facts SQL returns 1,934 prepared recipients in about 1.3s cold, about 20ms warm. Dev-measured: per-row contact policy about 35 queries and about 60ms (concurrency 4).
- **Unverified:** the inventory's end-to-end completion time on production is NOT measured; the estimated policy cost for about 1.9k rows exceeds 25s on a cold first read, so the first production read may still return the typed 503 and rely on memo convergence across retries. No production-scale fixture of the full policy path was built; the memo itself has no dedicated fixture test.
- Fixture-proved (`test-stage4b-supply-throughput.ts`): success and caching, deadline, ordinary error, recovery, cancellation (no lingering backend), late-result and superseded-generation fences, a real table-lock stall of the inventory returning the typed 503 while the aggregate still answers 200, release-status deadline and recovery.

**R02.** `readLastBacklogPriorityRun` throws the typed deadline error when a transaction registers after expiry, so no value query runs, and cancels the exact late transaction. Fixture-proved by exhausting the pool: answered at the deadline, zero value queries after expiry, pool returned, no unhandled rejection, a later history request succeeds.

**R03.** The worker settles `claimed` items left by an older claim generation of the reclaimed run before selecting. If another run already completed the governed intent, the old item becomes `skipped` (`superseded_by_completed_intent`) with `redacted_result.recovery` naming the completing item, run and intent; otherwise it is released as `retry` (attempts kept) or closed `dead_letter` when attempts are exhausted. Writes are fenced on the running claim token; a recovery-settled `skipped` row cannot be turned into a second success. Counters are recomputed from the ledger; nothing is deleted or restaged. Fixture-proved (`test-stage4b-staging-worker.ts`, 36 plus new assertions): no stale claimed row on the terminal run, exact lineage, counters equal the ledger, one intent and one completed effect, stale-token and non-running-run settlements rejected, late stale completion rejected; permanent/timed-hold and concurrent-tick tests kept. The released (no prior completion) branch is source-reviewed and was observed once in a failing intermediate run, but is not asserted by a final test. The crash is still simulated by a fixture-written expired claim.

**Browser (fixture):** the stalled and failed inventory both keep the release panel mounted; mobile 390px Provider Results no longer only logs overflow: it asserts no document overflow and no unlabelled inner scroll container. 27 checks pass on a production build.

**Outstanding:** the owner publishes; the post-publish `/api/health` SHA and read-only production screens (backlog, launch inventory with its phase log line, release panel, SFP tab) are not yet checked. The build-start census remains recorded as missing. No production job, provider call, release, backfill or deletion was run; all pauses are unchanged.


## Stage 4C1 — content workspace (2026-10-31)

**Status: source-complete in part; not committed, not merged, not published, not live-verified.** Base commit `45c51437fefa07419e7e8170408f8e5eb02dfc87` plus uncommitted workspace edits. Node v22.23.4.

**Delivered (source):**
- Typed purpose-aware CTA/link contract (`server/services/message-cta-contract.ts`): CTA kinds and permitted purposes, retired-path map, href safety check, duration-claim finder, sales-booking resolver with no default (missing or disagreeing ID sources fail closed; a slug address is shape-checked but cannot be compared with an ID). First-party `GET /book` adapter (302 to the validated widget, no-store, ignores query parameters, 503 when unavailable).
- Token fixes: `custom_values.booking_link` alias; `deal.topCostDrivers`; no value for `estimatedSavings`; savings fallback and hardcoded calendar removed from `sequence-worker.ts`/`ghl.ts`. Lint rules `unverified_duration` and `retired_link`. Ten-minute claims and `/apply` links replaced in the listed seeds and services.
- Draft compare-and-swap (no schema change; content-hash identity) on save, discard and publish with 409 recovery metadata and a publish retry receipt; HTTP routes require `expectedDraftToken`.
- Transport final previews (`POST /api/message-steps/final-preview`): SFP SMTP and non-cold Gmail through the real composers, labelled simulations. Editor dialog `size="workspace"` variant, 600/375 canvases, conflict alert, responsive grids.
- Premium SFP drafts (25) and warm/service baseline (12) as generated, read-only, `proposed_draft` data with a claim/CTA/cadence checker and `GET /api/content-workspace/premium-drafts` (admin/manager). Never auto-published.
- Asset inventory and disposition for all 175 Appendix A assets under `docs/certification/stage4-c1/`.

**Tests (disposable DB where marked; all passed):** CTA contract 55; premium drafts and inventory 22; content workspace (disposable) 28; message-template-versions (disposable) 56; template-final-preview 16; message-copy-convergence 65; workflow-email-wording; workflow-sms-wording; sfp-launch-content 632; sfp-launch-runner-e2e 26; sfp-seed-test 84. `npm run build` passed. The 4C1 suites are registered in `scripts/pre-deploy.ts`, `scripts/ci-suite-manifest.ts` and the disposable runner. The full pre-deploy roster was not run.

**Not delivered (shortfall against the specification):** the grouped Current SFP / Sales library / Merchant lifecycle / History / Diagnostics views and any UI that calls the final-preview or premium-draft routes; paired campaign+sequence package publication through `populateOne`/package-hash authority with 3- and 5-touch support and started-journey protection; adoption of the premium drafts into versioned step drafts; the 1280/768/390 browser verification and the browser suite; already-installed workflow and template rows keep their old wording until an operator publishes a reviewed draft; legacy SDR orchestrator, voice scripts, knowledge seed, `statement-review.ts`/`inbox.ts` booking-ID fallbacks, public pages with "10-minute" text, and client `CALENDAR_URL` were not changed.

**Owner notes:** sales-booking resolution fails closed if the sources are missing, malformed or name different calendar IDs. Rollback: revert the uncommitted files; there is no schema, secret or environment change.


**4C1 addendum (same day, after review):** added the live grouped overview (`GET /api/content-workspace/overview`, `server/services/content-workspace.ts`) and `ContentWorkspace.tsx` mounted in GHL Settings below message templates: URL-backed tabs (`?content=`) for Current SFP / Sales library / Merchant lifecycle / History / Diagnostics. Current SFP pins are read from `sfp_campaign_package_versions` at request time (cadence and started-journey counts shown); every row states why it is in its group; diagnostics rows show journey dependencies; nothing is written. The Current SFP tab lists the 25 premium drafts with a per-touch "Preview as SFP email" that calls the transport final-preview route. Content-workspace certification now 38 checks (disposable DB). Production build passed.

**Still not delivered:** adoption of premium drafts into a package (step editing/reordering and paired campaign+sequence publication through `populateOne`/package-hash authority, 3/5-touch, stale-hash conflicts, started-journey protection beyond display); a refreshed *production* inventory and dependency read (the register is the attachment's snapshot; the live overview reads the environment it runs in, and the development database holds test-polluted rows that differ from production); mounted-browser verification at 1280/768/390 (sign-in required; not run). Follow-ups #2117-#2119 cover the remainder.

## Stage 4C1 — published-audit reconciliation (2026-11-01)

Supersedes the 4C1 closure claims above where they differ. Source: `docs/certification/stage4-c1/source/Liberty-Stage4C1-Published-Audit-and-Corrections-2026-10-31.md`. Identities: production serves `6777641f`; main is `03fa438b` (a later unpublished booking/copy follow-up); every change below is **uncommitted on top of `03fa438b`** and not published. Outbound pause (epoch 1) and outgoing-GHL owner pause were not touched; nothing was published, activated, enrolled, sent or written to production by this work.

**Done and tested**
- R08: the pure 4C1 suites (CTA contract 74, premium drafts 22, workspace navigation 20) are in `MANDATORY_SUITES` and the manifest; `ci-suite-manifest.ts --check` passes. DB certs run through the disposable runner.
- R02: manager overview and package aggregates follow the same ownership rule as the campaign/sequence readers; one REPEATABLE READ snapshot. Disposable cert `stage4c1-content-workspace` 45 checks pass.
- R05: one CTA/link contract (first-party `/book`, secure upload, no retired links, no `{{estimatedSavings}}` value, no stated call length), final-render link gate, calendar-URL helper. Cert and pure suites pass.
- R03: the stored-template editor records the parent version and draft token at load; saves send them, edits typed during a save are kept, and a changed parent disables Save/Publish with a banner. Compiled by the build; **no browser test was run**.
- R01 (server): admin-only paired package publication (`GET/POST /api/content-workspace/packages/:packageKey[/publish]`): version+hash compare-and-swap, replay, started-journey/active/non-draft refusals, live-drift refusal, 3 or 5 touches with relative delays, link/claim/token validation, readiness guard with full rollback, new immutable version, approval invalidated, audited in the same transaction. Generic single-sided campaign/sequence step routes now return 409 `pinned_package_content` for pinned rows. Disposable cert `stage4c1-package-publication` 39 checks pass (including a concurrent-publish race). Role-guard smoke (anonymous, merchant, admin, manager, agent) passes for the overview, premium drafts and package routes.
- R01 (client): "Open content workspace" entrance in the Campaigns and Sequences tabs (and GHL Settings); per-package "Open content" editor with step rail, subject/body/delay editing, add/remove/reorder (3–5), adoption of a premium five-touch draft as an editable draft, selected-step SFP preview, diff against the published step, and confirm-then-publish. Drafts are held in the browser's session storage (no server draft table; schema changes were out of scope), so they are per-browser and per-version.
- R07: group/package selection uses push/popstate through a typed codec (invalid and duplicate values fall back with a notice); reviewed-purpose grouping (the 13 `V-*: Account Management Ops` sequences and QBR content go to Merchant lifecycle; the name rule is a labelled fallback); relative delay and cumulative day shown separately; packages vs assets counted separately; Retry states for the overview and premium-draft queries; null-safe journey counts.
- R06 (partial): the final-preview route accepts the asset purpose and picks the matching signature; the package editor previews the selected step with the real SFP renderer.

**Gates run:** `npm run build` passed; disposable certs `stage4c1-content-workspace`, `stage4c1-package-publication`, `sfp-launch-content` (632), `test-message-copy-convergence`, `test-message-template-versions`, `test-template-final-preview` pass; role-guards pass; `check-api-coverage` passes; manifest check passes. Build identity: `03fa438b` plus uncommitted edits. The dev server was restarted on this tree; **no signed-in browser run and no served-build smoke were performed**, and the full pre-deploy roster was not run.

**Not done (remaining, do not treat 4C1 as closed)**
- R04: stored copy and CTA-intent adoption (templates 1 and 6, workflows 4/5/7/11/12/13, sequences 36/84/85/86/91/93/94, the scheme-less `/apply` SMS) is not adopted anywhere. The contract and gates are in code; adoption through the guarded owners still needs a read-only production census and an operator-run, hash-checked publication.
- R06: selected-step final previews in the existing Campaigns/Sequences step editors (they still use the older preview modal) and previews built from the asset's actual interpolator.
- R07: the asset inventory (`asset-inventory.json`, Appendix A snapshot) was not refreshed to 20 campaigns / 127 sequences / 8 templates / 17 workflows.
- The generic-route fence (409 `pinned_package_content`) is covered by code and role-guard rows only; no authenticated HTTP test hits a pinned row.
- Browser verification of the new editor and the R03 template editor; served-build passive smoke after the user's publish.
- Campaigns 69/77/79: no cause is asserted.

## Stage 4C1 — published-audit reconciliation, completion pass (2026-11-01)

Supersedes the "Not done" list and the identity line of the entry above. **Identities:** production serves `6777641f`. Tested and built tree: `9dee3fb3` (an automatic commit on top of `03fa438b` that already contains the earlier R01–R07 work) **plus this pass's uncommitted edits**, which are not published. The earlier statement "uncommitted on top of `03fa438b`" is corrected to this. Build: `npm run build` passed on this tree (artifact SHA `9dee3fb3`); the dev workflow was restarted on it. Outbound pause (epoch 1) and the outgoing-GHL owner pause were not touched. Nothing was published, activated, enrolled, sent or written to production by this work; production was read with read-only SQL only.

**R04 — stored copy and CTA adoption (code and tests done; production adoption not run)**
- Workflows 4/5/7/11/12/13 and templates 1/6 adopt corrected wording through `convergeReviewedCopy` (exact-substring, versioned, never touches enabled/isActive; runs at startup and from the admin POST). Sequences 36/84/85/86/91/93/94 (16 steps) adopt through the new plan-hash-bound admin route `GET/POST /api/message-copy/sequence-adoption` (admin only). Sequence 84 is ACTIVE, so it is refused until an operator pauses it; the command never pauses or activates anything.
- Disposable cert `stage4c1-stored-copy-adoption`: 32 checks (idempotency, stale-hash 409, operator edits left as conflicts, concurrent applies change each step once, audit row, no network). **Not tested:** the pinned-sequence refusal inside adoption (needs a package-version fixture).
- Still review-only, not edited: sequence 36 step 8 hardware claims, sequence 84 step 3 "live within 3–5 business days", sequence 93's referral-credit claim.
- **Production census (read-only, 2026-11-01, `asset-reconciliation.md`):** 16 retired first-party links remain in installed wording across sequences 36/85/86/91/93/94 and workflows 7/11/12/13; `{{estimatedSavings}}` is still used in sequences 36 and 84; about **78 sequences still link the GoHighLevel booking widget** (251 links) instead of the first-party `/book` address. The adoption plan covers only the audited targets above; the widget-link population is an owner decision and is not changed by any automatic path.
- To adopt in production after the user publishes: run the convergence POST, pause sequence 84, preview then apply the sequence adoption with the previewed plan hash.

**R06 — as-sent previews in the legacy editors (done, tested)**
- `POST /api/message-steps/asset-preview` (admin/manager): the caller supplies asset identity (and optional unsaved text), the server resolves transport, signature and substitution. SFP launch step → SFP renderer + SMTP; cold legacy sequence → worker interpolation + category signature + SMTP; non-cold sequence → interpolation + signature + Gmail; campaign → engine merge fields + sales signature + SMTP. SMS refused; a step the worker would block (`{{estimatedSavings}}`, retired link, unresolved booking) is shown as blocked. The worker now calls the same `interpolateSequenceText` (`sequence-step-interpolation.ts`), so there is one copy. Limits stated in the UI: the GHL fallback is not simulated, and campaign AI personalization is not simulated.
- The Sequences and Campaigns step previews use it ("Message as sent", with the subject, path, signature, warnings, and the old editor sample behind a labelled disclosure). The Campaigns modal is covered by the route and cert but **not by a browser run**.
- Disposable cert `stage4c1-asset-preview`: 22 checks.

**R07 — inventory refreshed (done)**: `production-snapshot-2026-11-01.json` (hashes, lengths, link and token lists only), `asset-inventory-production.json`, `asset-reconciliation.md`, generated by `scripts/generate-stage4c1-production-reconciliation.ts` (`--check` supported). Production now: 20 campaigns (79 steps), 127 sequences (517 steps), 8 templates, 17 workflows; 5 current SFP package pins. 172 assets match Appendix A by id and name; campaigns 69, 77 and 79 are in Appendix A but absent from production — **no cause is asserted**. The Appendix A register is unchanged.

**Generic-route fence over HTTP (done)**: cert `stage4c1-generic-route-fence`, 14 checks: all seven pinned campaign/sequence edit routes return 409 `pinned_package_content` and change nothing; an agent gets 403 and anonymous 401 before the fence; unpinned assets still edit; a superseded pin does not fence.

**Browser verification (done, narrow)**: `scripts/test-stage4c1-browser.ts` (12 checks, in `MANDATORY_SUITES` and the manifest) on the compiled client, real admin session and CSRF, disposable database: the Sequences step "Message as sent" modal (path, signature, subject, body frame, blocked `{{estimatedSavings}}` step, nothing created, sequence stays paused) and the R03 stored-template editor (live version, preview follows the edit, draft saved with live wording/version/activation unchanged, discard). The browser run found that the modal did not show the subject; fixed. Not browser-tested: the Campaigns step preview, the package editor, 768/390 widths, manager/agent roles in the browser.

**Other gates this pass:** role-guards smoke passes including the new `asset-preview` and `sequence-adoption` rows; `check-api-coverage`, `ci-suite-manifest --check`, `generate-stage4c1-inventory --check`, `test-stage4c1-cta-contract` (74) pass; `test-stage4c1-content-workspace` and the message-copy suites passed earlier in the pass. `check-queue-compliance` and `compliance-scan` report failures only in `inbound-acknowledgement.ts`, `partner-approval-delivery.ts` and `sfp-seed-test.ts`, files this work did not touch (not compared against a clean baseline). No full TypeScript run and no full pre-deploy roster.

**Remaining:** production adoption itself (operator-run after publish); the GHL-widget booking links in ~78 sequences (owner decision); the three review-only claims above; the 4C2 native workflow install/execution and 4D scope; served-build passive smoke after the user's publish; the Campaigns and package-editor browser runs.

**Production adoption run (2026-11-01, after the owner's publish; production served `f9a96cab`, repository HEAD `d664e6da`, which contains this pass):** at the owner's request the guarded adoption plan was run through the admin routes (admin session and CSRF). No outbound pause, GHL pause, sequence status or activation was changed.
- Workflows and templates: the startup convergence had already run on the published build (applied 8, already current 5, conflict 0, failed 0; workflows 4/5/7/11/12/13 and templates 1/6 to new versions). Nothing further was needed.
- Sequences: previewed plan hash `3d3dd5c17bd38c73` (14 ready, 2 blocked, 0 conflicts); applied with that hash. Applied 14 steps: sequence 36 steps 4/8/9, 85 steps 1/3/5, 86 steps 1/3, 91 steps 1/2/4, 93 step 1, 94 steps 1/3. Re-preview afterwards: 14 already current, 0 conflicts, 2 blocked.
- **Not applied:** sequence 84 steps 2 and 3 are refused because sequence 84 is active; an operator must pause it, then re-preview and apply. I did not pause it.
- Still open: the ~78 sequences with GoHighLevel booking-widget links, the three review-only claims, and the Campaigns/package-editor browser runs.

## Stage 4C1 — adoption review follow-up (2026-11-01; 4C1 stays OPEN)

Source: the 2026-11-01 adoption review (a source document, not an instruction). **Identities:** production serves the build the owner published after `d664e6da`; repository HEAD `0b08836e`. Everything below is **uncommitted/unpublished** local work: the adoption service, the new link-target module and fixtures, the certification, the browser suite. Built with `npm run build` (exit 0) after the last edit. No production write was made in this pass, no outbound pause or GHL control was touched, no schema/startup DDL, no dependency change, no full TypeScript run.

**1. Audit and transaction proof (done, tested on a disposable database)**
- Each step's wording change, its sequence version bump and its receipt `stored_sequence_step_copy_adopted` commit or roll back together. Receipt payloads use `wordingDigest` (the audit sanitizer redacts a key named `hash`).
- A non-adoption error stops the loop and is rethrown; the batch summary is best-effort and records `interrupted`.
- Certification `stage4c1-stored-copy-adoption`: **63 checks passed** (was 32). New: audit-failure rollback via a trigger in the disposable DB only (no production fault injection), partial per-step evidence, interrupted summary, stale replay, retry reporting already_current/applied with exactly one receipt per step, concurrency, and the pinned-SFP refusal (stale pre-pin plan, blocked row with zero step/version/audit change, unpinned sequences still adopt, a superseded pin releases).

**2. Unsupported claims replaced (code and tests done; production not yet applied)**
Neutral wording replaces: sequence 36 step 8 (subject, equipment recommendation and feature list), sequence 84 step 3 (go-live timing), sequence 93 step 1 (referral credit and the request for another person's details). Layered edits converge from both the original and the already-adopted wording (36/8 and 93/1 are already adopted in production in their first form).
- **Not changed, still present:** sequence 84 step 3 still has "We handle everything…", "No downtime…" and "No long-term contracts…"; sequence 93 step 3 says "Just reply with a name…"; many SMS steps state "10 minutes" and one states "$300–$800/month". These are outside the three named claims and need an owner decision.

**3. Sequence 84 (not done; waits for the owner's publish)**
Sequence 84 is active and its snapshot `enrollments` is null, which is not proof of no in-flight work. After publish: verify `/api/health` SHA; read-only production SQL for 84's enrollments, queued/in-flight sends and dependencies; pause **only** 84 through the existing guarded command (`PUT /api/sequences/:id/toggle-status`, versioned command, admin/manager); re-preview; apply with the new plan hash; leave 84 paused; never resume it. Any started-journey incompatibility needs an explicit safe disposition before applying.

**4. GHL widget links by step purpose (code and tests done; production not yet applied)**
`stored-sequence-link-targets.ts`: 34 sequences, 74 steps — 42 email booking anchors → first-party `/book`, 24 SMS booking links → `/book`, 8 upload anchors → the secure upload address. Only the address changes, and an anchor is moved only by its own label (booking wording or "upload"). The fixture of 74 step bodies was read from production read-only.
- **Left alone:** Account Management sequences and their calendar links (23, 37, 57, 60, 63, 66, 69, 72, 75, 78, 81 plus widget links); sequences 1150/1151 (existing-merchant reviews); referral sequences 23 and 37; application, referral, proposal and unlabeled CTAs (about 67 steps) and "Get a … Review" labels — owner decisions; active sequences (108 steps, refused by adoption); immutable history. No blanket replace of the 251 links, no bulk pause. Production census: 249 widget-linked steps, 218 on the sales address, 31 on the Account Management calendar.

**5. Browser checks (done)** `scripts/test-stage4c1-browser.ts`: **41 checks passed** on the compiled client, disposable database, real sessions and CSRF, only the campaigns and templates-settings routes registered:
- Sequences and Campaigns "Message as sent" modals; Campaigns step with `{{estimatedSavings}}` shows a literal-delivery warning (the legacy campaign path does not block it); nothing created, statuses and revisions unchanged.
- Stored-template draft editor.
- Current-SFP package editor on a package built with the real writers: edit and preview only, publish disabled until confirmed, no version, wording or publication record changed.
- 768 and 390 widths (controls inside the viewport, no sideways scroll, touch-sized controls, dialog fits), screenshots in `docs/certification/stage4-c1/browser/`.
- Seven-role matrix (`role-matrix.json`): admin sees the editor; manager sees the workspace and only the administrators-only notice and is refused package read/publish (403) while step preview is allowed; agent, other, merchant, affiliate and partner see neither surface and get 403 on package read, step preview and publish.
- Not covered: published-candidate or production browser acceptance; the mobile shell; the Campaigns page for non-admin roles beyond the matrix above.

**Compliance baselines (not weakened):** `compliance-scan` (2 call sites: `partner-approval-delivery.ts:107`, `sfp-seed-test.ts:219`) and `check-queue-compliance` (3 files missing the coordinator import: inbound-acknowledgement, partner-approval-delivery, sfp-seed-test) fail identically on clean `git archive` trees of `6777641f`, `03fa438b` and `HEAD`, and on this working tree (same failing lines, diffs are path prefixes only). None of those files or either scanner changed between `6777641f` and HEAD; the first of the two scan failures predates `f8094f94` (2026-10-24). Failures are therefore pre-existing, not caused by 4C1.

**Other gates run this pass:** `ci-suite-manifest --check`, `check-api-coverage`, `generate-stage4c1-inventory --check` pass; `test-stage4c1-cta-contract` 74 checks pass. **Not run:** full pre-deploy, full TypeScript, native/delivery/calendar/SMS proof (4C2), integrated certification (4D), served-build smoke.

**Open:** owner publish; sequence 84 steps; production apply of the claim and link changes through the guarded route; owner decisions listed under items 2 and 4; test contact 159443 remains in production (see the deletion finding below).

**Test contact 159443 deletion request (owner answered yes, 2026-11-02; read-only production census, nothing deleted):** the contact ("Liberty QATest", placeholder no-email address) has three linked `inbound_requests` (not two; one is linked to deal 2579, which has one task), one deal, one task, 3 `contact_source_events`, 6 `contact_identity_observations`, 8 `enrichment_runs`, 8 `lead_sources`, 1 AI decision-log row and **2 `consent_audit_logs` rows**. `consent_audit_logs` has a BEFORE DELETE/UPDATE append-only guard and a NO ACTION foreign key to the contact, so a hard delete of the contact is refused by design; removing it would require bypassing that compliance guard, which was not done. Agent production access is read-only, so no production write was attempted either. The contact and its receipts stay as they are; a non-destructive alternative (marking it a test record and keeping it out of lists and sends) needs an owner choice.

**Test contact 159443 removal (owner decision 2026-11-02, supersedes the "cannot delete" finding above):** the owner asked for the contact and everything attached to it to be removed, including the two consent audit rows. Agent production access is read-only, so the removal is a guarded script for the Database pane: `docs/ops/delete-qa-contact-159443-2026-11-02.sql` (dry run by default, exact-count guards against the production census, one transaction). It deletes the 3 inbound requests (with 12 effects, 3 assignment decisions, 1 work link), deal 2579 and task 7067, the contact's source events, identity observations, enrichment runs, lead sources, analytics events and other contact-owned rows, consent subject 1 with its 2 channel states, and the 2 canonical consent audit rows (ids 3138/3139: PEWC opt-ins for a fictional phone). To delete those two rows it disables the append-only trigger on that one table and re-enables it in the same transaction, checking it is back on before finishing. It adds an audit row for the deletion. Checked: every statement runs against the schema (rolled-back run on the development database) and the guard counts match production today. **Not run in production.**

**Test contact 159443 removal applied (owner ran the script in the production Database pane, confirmed read-only 2026-11-02):** contact, its 3 inbound requests, deal 2579, task 7067 and the 2 consent audit rows no longer exist; the consent append-only trigger is enabled; the deletion audit row `qa_test_contact_hard_deleted` exists. The earlier "Open" note about this contact is closed.

## Stage 4C1 — production adoption, second run (2026-11-02, after the owner's publish; 4C1 stays OPEN)

**Identity:** production served `cecb3ed3` (health SHA; contains the per-step receipt, claim and link-reconciliation code). Run through the guarded admin routes (admin session, CSRF). Outbound pause (epoch 1) and GHL controls untouched; no provider call.

**Sequence 84 pre-checks (read-only production SQL):** active, version 1, 3 steps; **0** enrollments of any status, 0 `cr04`/post-enrichment intents, 0 send-log, communication and analytics rows, 0 command receipts, no SFP package pin, no trigger-config or system-setting reference, and no code path references it by id or name (the code's "Switch & Save" names are a different sequence, "1. Switch & Save — Statement Audit"). No started journey, so no incompatibility needed a disposition.

**Pause:** only sequence 84, via `PUT /api/sequences/84/toggle-status` with `expectedVersion` 1, actor and account version bound; result paused, version 2. No other sequence status changed (one `sequence_toggle` audit row in the hour). 84 was **not** resumed.

**Adoption:** re-preview 78 ready / 12 already current / 0 conflict / 0 blocked (plan `421286813adcc144`); applied with that hash: **78 applied, 0 skipped**, 78 `stored_sequence_step_copy_adoption` per-step receipts (one per step, 78 distinct steps) plus one batch summary. Re-preview afterwards: 0 ready, 90 already current. This included sequence 84 steps 2 and 3, 36/8 and 93/1 neutral wording, and the link reconciliation (booking links to `/book`, upload anchors to the secure upload address). **Sequence 84 is still paused** (version 4).

**Remaining, by design:** 60 widget-linked steps in paused sequences (Account Management sequences, application/referral/proposal/unlabeled CTAs: owner decisions); active sequences were not rewritten (31 active sequences, 108 widget-linked steps); the other unsupported lines in 84 step 3 and 93 step 3 and the SMS "10 minutes"/"$300–$800/month" claims. 84 stays paused until the owner decides to resume it. Not run: full pre-deploy, native/delivery (4C2), integrated certification (4D).

## Stage 4C2 — appointment and follow-up authority (2026-11-02, source-only; unpublished)

Implemented in source: occurrence-keyed workflow runs with input pin and SQL lease, per-channel delivery receipts (`followup_effect_receipts`, migration 0378), honest run outcomes (failed / blocked / completed; legacy runs shown as "completed · N steps not delivered" and never rewritten), application-reminder milestones consumed only on accepted delivery, statement request/reminder rewritten around receipts, exact inbound GHL identity, calendar purpose resolver, selected-range appointment reader, default-denied booking preview/execute/readback command, corrected GHL appointment write templates, and corrected native-workflow guidance. Evidence: `docs/certification/stage4-c2/` (journey authority 59 checks, calendar contract 45 checks, both on a disposable database with negative controls; appointment-statement 7; ownership scanner 73; production build passed).
*First-pass "Not done" list (history; superseded below):* browser matrix, calendar source filter/detail drawer, server-paged run history, SMS purpose propagation audit, other `limit: 500` handlers, full pre-deploy roster, native workflow installation (4D), live booking writes. The browser matrix, calendar source filter/detail drawer, paged run history and SMS purpose work were delivered afterwards; the rest stays open.

### Stage 4C2 correction pass (2026-11-02, source-only; unpublished)
Audit input: `Liberty-Stage4C2-Post-Publication-Audit-and-Corrections-2026-11`. Serving SHA `bb107f91` = `c8a846b7` + GHL sync exact lookups; publish commit `5a25ed17` has an identical tree. Migration head 0378 → **0379** (`workflow_runs.input_context`, receipt `request_fingerprint` and `attempt_count`; additive, idempotent). P01–P08 and E01 were fixed in source: handler defects, executor durability (lease, fenced saves, local-action receipts, halt after an undelivered send), one statement-request owner per call (and the opt-out regression found and fixed), proposal touch identity, occurrence-scoped reminders, strict trigger decoder, held missing-ID handoff as a durable expiring obligation, booking command binding and server-side contact resolution, SMS authority recheck and toolkit forged-purpose refusal, and the operator UI (agenda, URL state, range reader, denied-detail wording, booking panel, run Details). Evidence on disposable databases with fake transports (Node 22, build passed): journey-authority 71, calendar-contract 67, correction-pass 36 (4 negative controls), sms-recipient-authority, appointment-statement, ownership-readiness, sync-exact-lookups, browser suite 107 checks. **Narrowed or not done:** interleaving suites for appointment handlers, dedicated executor-crash and settlement-failure suites, proposal-tracking SDR resend not unified with the worker path, browser proof of the denied-detail state, full pre-deploy roster, queue/compliance base-vs-candidate scans, other `limit: 500` handlers. Native-only (4D): workflow slot install and one test enrollment each, cancel-disposition approval, booking-writer enablement, calendar-purpose config. Safety: global pause epoch 1, outgoing GHL owner-paused epoch 16, no send, no booking write, no publish. 4C2 is **not** complete while those items remain. Details and rollback: `docs/certification/stage4-c2/owner-map-and-disposition.md`.

### Stage 4C2 completion pass (2026-11-02, source-only; unpublished)
Audit input: `Liberty-Stage4C2-Merged-Repair-Review-2026-11-02`. Production serves `ce4d7865`; `main` `f8245106` has the same tree. Shipped repairs are kept and credited (appointment normalization, persisted run context, task command keys, strict trigger decoder, statement owner token, typed worker outcomes, URL state, agenda, booking change panel, fixture version repair, runner registrations). Tested tree: `main` at `8ca031a1` plus the uncommitted completion-pass working tree (Node 22.23.4, `npm run build` passed); it has no commit identity until the platform commits it, so serving/tested identity must be re-read after publish.
**Repaired in source (RC1–RC5):** RC1A workflow notification/audit steps write the row and the receipt in one transaction under a share-locked lease check (`workflow-local-actions.ts`); RC1B the request fingerprint is part of the single atomic claim (exact match; NULL matches only NULL, so a legacy row cannot be adopted by a fingerprinted request and the reverse; owner and channel are also bound). RC2A the generic `/api/webhooks/ghl` inbound path converges on the canonical provider message identity with per-effect receipts (no provider id converges on a payload fingerprint and audits `ghl_inbound_identity_unavailable`); the specialized SDR route keeps its own claim. RC2B a non-durable held outcome fails at the owning step (retryable). RC2C recovery re-reads the obligation under lock, a newer revision amends the pending row, and an expired hold becomes a terminal `failed`/`hold_expired` row with an audit and no provider call. RC3A statement requests keep a per-channel owed state; RC3B SDR SMS compares the provider number with the local one and rechecks consent/STOP/purpose/number before every attempt; the dormant `resendProposalEmail` is retired fail-closed. RC4A booking readback must name the exact appointment, calendar, location and contact plus the requested time/status. RC4B the booking panel saves an unresolved command (actor/account/permission/appointment scoped, 24h) before execution, restores it, and offers "Check saved result" (read-only). RC4D old completed runs with an undelivered step read "Historical unresolved step — review required", with raw provider text only in sanitized collapsed diagnostics. RC5 `test-ghl-sync-exact-lookups.ts` is in the CI suite manifest and the pre-deploy roster.
**RC4C decision: explicit deferral to 4D.** The backend create preview/execute is built and tested; no create form is added to the Calendar UI in this pass, so a create from the console remains unavailable until the owner approves writer scope.
**Evidence (disposable databases, fake transports, no provider attempt):** completion-pass 63 checks (new, with negative controls: 0379 install/rollback/upgrade, barrier interleavings, lease takeover, inbound convergence, expiry, per-channel state, readback identity); journey-authority 71; calendar-contract 67; correction-pass 36; sms-recipient-authority 42; appointment-statement, ghl-webhooks, channel-orchestrator, sync-exact-lookups pass; browser suite 130 checks (1280/768/390, light and dark, admin plus manager and agent sessions, saved booking command reload, historical run label). Migration 0379 was not edited; install, rollback to the 0378 shape and upgrade were exercised on a disposable database only.
**Baselines recorded separately (not green):** compliance scan fails 3 sites (`partner-approval-delivery.ts:107`, `sdr/voice-orchestrator.ts:594`, `sfp-seed-test.ts:219`); queue-compliance fails the coordinator check for `inbound-acknowledgement.ts`, `partner-approval-delivery.ts`, `sfp-seed-test.ts`; none of those files was changed by this pass. Two focused-editor type errors in `workflow-executor.ts` `retryFailedWorkflowRun` (nullable `workflowId`) pre-date this pass. Full pre-deploy roster and full TypeScript were not run.
**Narrow gaps documented, not hidden:** the inbound communication-event effect uses its own connection (a rare duplicate, never a loss); the enrollments-paused audit is skipped on a retry if the pause already applied; `sms_not_permitted:provider_*` codes are parsed generically as permanent. Under the global pause the recovery worker does not touch held rows, so an expired hold is dispositioned on the first tick after unpause.
**4D remaining (finite):** native workflow slot install and one test enrollment each; cancel-disposition approval; booking-writer enablement with one canary on a marked test contact; calendar-purpose configuration; delivery/readback proof; role and performance acceptance on the served build. 4C2 is not complete until the completion-pass tree is published and those items are accepted. Safety: global pause epoch 1, outgoing GHL owner-paused epoch 16, booking writer denied, no send, no booking, no publish.

## Stage 4D — integrated acceptance (2026-11-03)

Separate verdicts (details in `docs/certification/stage4-d/`, including `publication-and-verdicts.md` and `integrated-journey-matrix.md`):
- **Implementation:** ready. `stage4d-integrated-acceptance` (47 checks incl. scanner gate-removal negative controls), `stage4d-vertical-county-matrix` (16, 516 rows), role-guard smoke (booking create/preview/execute roles, no receipt on denial), 173-check browser run including the New provider appointment console at 1280/768/390 x light/dark, and the section 19 suites that were run all pass on disposable infrastructure. `npm run build` passes. Compliance scan and queue-compliance now pass by per-file gate proof (no blanket allowlist). No provider network attempt.
- **Repairs:** inbound reply evidence and receipt in one transaction; audited reply-stop pause; non-sending expiry sweep for held GHL enrollments (also while paused); full-number SMS provider identity; null-workflow retry parks for review; governed create console with explicit purpose, IANA zone to UTC, server-owned preview context; campaign ownership filter.
- **Data/count, SFP prep/staging, content/CTA:** unchanged. Production recapture: five current v2 packages, 3 steps each, campaigns draft and sequences paused; five-touch drafts verified, not adopted or approved.
- **Native GHL/calendar:** **BLOCKED** — no authorized protected test path (booking writer default-denied, outgoing GHL disabled epoch 16). Feasibility packet and proposed protected path in `owner-and-native-matrix.md`.
- **Roles/UI/performance:** roles and the Calendar console verified in a real browser; Campaigns filter and Program Health note not browser-verified; no performance measurement.
- **Publication/schema/rollback:** no migration; uncommitted working-tree changes on HEAD `73272418`; `ghl_appointment_state_status_chk` still lacks `'no_show'` in production (owner SQL repair). Known baseline failure: `ghl-projection-authority` GPA-99.
- **Overall:** implementation ready; acceptance blocked. Open items are listed in the evidence packet.

### Stage 4D — completion status update (2026-11-03, after the published-build audit; earlier text above is kept as history)

- **Publication:** Stage 4D is merged and published as `548812f0` (build id `77138085-bcf3-4620-afee-0c69ab641d14`, built 2026-11-03T18:22:41Z). The earlier line "uncommitted working-tree changes on HEAD `73272418`" described the first pass and is superseded. Repository head `087a657e` also holds later Payarc changes that are not in the serving build.
- **Closed this pass (disposable database and fakes):** booking-create recovery (R1), zoned time (R2), GPA-99 (R3), bad-source journey, signed reply/STOP/bounce through both entrances, partner denial on booking routes, 4B/4C1/4C2 browser reruns, matched Calendar performance, schema repair and rollback rehearsal.
- **Found and fixed, not yet published:** SDR webhook signature middleware `require()` failure under ESM; a STOP arriving only through the specialized `message-received` route did not withdraw consent.
- **Still open:** native acceptance (BLOCKED, no authorized path), production `no_show` constraint repair (owner-run packet), production performance not measured, Campaigns filter and Program Health note not browser-verified, the two fixes need Publish.
- **Separate verdicts and evidence:** `docs/certification/stage4-d/publication-and-verdicts.md`. Stage 4D is not called complete because code is published.


### Stage 5 — Application to MID: status (corrected 2026-11-04 after the published-source audit; earlier text above is kept as history)

- **Correction:** the earlier "not published" status is superseded. The first Stage 5 change was published (production served `218d4c4e5a3697990c6955df3e94f559b474c0b0` when audited), and the published-source audit found it open: the real public application journey, effect/consent/delivery truth, readiness policy, processor uncertainty and contract, underwriting decision pinning, condition chases, MID semantics and registry, and the browser acceptance were incomplete. Repairs R01–R09 are now in source (uncommitted working tree on `8876077c`; the next publish is the owner's step). The 24 original findings keep their dispositions; this does not add entries to the 95-entry register.
- **Layers, stated separately:** application/review functionality PASS at fixture and browser layers; protected data/security PASS at fixture layer; processor/MID command integrity PASS at fixture layer with the provider denied; UI/roles/accessibility PASS for the focused browser journeys (BoardingPanel, public wizard, MID registry, underwriting, applications, role denials); installed schema fixture-only (migrations `0380`, `0381` apply on a disposable database; the production database holds the `0381` objects per the later read-only check while its Drizzle ledger has no `0380`/`0381` entry; `0380`'s `ALTER … USING NULL` discards any populated actor values and an application rollback cannot restore them; however, the present objects, empty tables and missing ledger rows do not prove that statement ran against production actor data (risk and verified facts are recorded separately in `docs/certification/stage5/verdicts.md`; no ledger stamp, replay or startup DDL was performed); `0381` is additive); native/production NOT RUN; release: published later, see the 2026-11-06 correction entry.
- **Defects the browser proof found and fixed:** signed-in operators' wizard writes had no CSRF header; autosave sent `null` yes/no answers (400); finalize returned 400 for any visitor with a stored landing page or click id because the strict schema rejected those keys.
- **Not passing:** `scripts/test-forms.ts` still fails in the disposable harness for environment reasons (statement upload, estimate queue manager, outbox worker profile). The policy matrix `boarding.policy.matrix.v1` is unrecorded, so real boarding fails closed.
- **Stage 5 remains open** until the owner publishes the repaired build and the read-only/native steps in `docs/certification/stage5/native-packet.md` are executed and reviewed. Evidence: `docs/certification/stage5/verdicts.md`, `native-packet.md`, `browser/`.

### Stage 5 completion pass (2026-11-05; still open; later published, production confirmed serving `b554212e` — see the 2026-11-06 correction entry)

Applied the published completion audit C01–C06 as one bounded pass. Fixture results: application-effects 69, underwriting-conditions 85, boarding-routes 114, boarding-worker 76, public-journey 34, payarc-codec 67, status-apply 14, underwriting evidence/read-model/override 27/31/46, application-contract 79, merchant-application-security 273/0; role guards, API coverage, migration integrity (1009), suite manifest and compliance scan pass. Browser (fixture, built client + source handlers, not the deployed server): 24 checks pass. `test-forms.ts` still exits 1 (provider deny mode starts no workers; estimate/get-started 400 reproduced at source as a record-class acceptance 409 that production data cannot confirm or refute). Read-only production schema check: `0381` columns/index present, chase table empty, ledger has no `0380`/`0381` entry; `0380` actor values are not restorable by an application rollback. No native, production, provider or publish step was taken; outbound paused (epoch 1), outgoing GHL disabled (epoch 16). Detail: `docs/certification/stage5/verdicts.md` and `native-packet.md`.


### Stage 5 correction pass F01–F03 (2026-11-06; still open)

Cross-reference: this entry corresponds to the canonical ledger/spec/roadmap entries §51.21 / §43.20 / §14.15 (the canonical documents also carry §51.20 / §43.19 / §14.14 for the published C01–C06 receipt). The repository copies of these documents do not contain those section numbers, so no section number is asserted here; identify this entry by title and date, and by `docs/certification/stage5/verdicts.md`. The 95-entry lineage is unchanged.

Production identity at the start of the pass: serving `b554212e` (publish build `8ce8a2ec-1666-4542-85d4-a4d3198484bb`), main `c7239f21`. Layers, kept separate: **Source** — F01 fresh-inbound class contradiction repaired (unknown contact and deal are accepted as a truthful `review_required` occurrence with durable unlinked management work, retained exact contact/deal/request evidence and held assignment/sending; explicit nonproduction, archived and foreign-linked contexts are retained as `INBOUND_CONTEXT_UNAVAILABLE` review evidence instead of a generic 400; later review continues the same request, contact, deal and task without duplicates); F02 one retry owner for outbox-owned workflow enrollment; F03 MID registry Open/Back round trip. **Fixture** — see `verdicts.md` for counts. **UI** — fixture browser only. **Native** — NOT RUN. **Release** — historical wording: these corrections were not published when this entry was written (later published; see the F01 recovery entry below). No production submit, send, provider call, reclassification or native enablement occurred; outbound pause epoch 1, outgoing GHL disabled epoch 16, incoming GHL enabled. Stage 5 remains OPEN; no closure or native-GO claim.


### Stage 5 F01 recovery and continuation pass (2026-11-06; still open)

Cross-reference: this entry corresponds to the canonical ledger/spec/roadmap entries §51.22 / §43.21 / §14.16 (the canonical documents also carry §51.21 / §43.20 / §14.15 for the F01–F03 correction, whose "not published" wording is historical: F01–F03 was later published, serving `f22696f1`, build `05b9f1ea-2c23-4ceb-9510-6a73b95eff5d`, main `e4e9d5ff`, post-publish browser receipt 2,694 inputs and 27 checks, live admin F03 walkthrough). The repository copies of these documents do not contain those section numbers, so no section number is asserted here; identify this entry by title and date, and by `docs/certification/stage5/verdicts.md`. Entries §51.21 / §43.20 / §14.15 are unchanged.

Layers, kept separate: **Source** — committed contact/consent/deal progress is bound to the public sales occurrence (immutable occurrence-keyed evidence only, never email/name/phone guesses); a failure with committed rows answers a truthful recoverable 202 and a same-key replay finishes the same request without duplicates or promotion; scoped admin/manager review continuation route with click-time authority/identity/revision checks, held external effects and real blocked reasons; public forms no longer treat a recoverable or unreadable response as success. **Fixture** — `test-stage5-intake-recovery` 193 checks (real HTTP failure injection after contact, consent, deal, link bind and notification; lost response; concurrent replay; stale lease; scoped resume matrix); fresh-inbound 168, test-forms 30 and the other focused regressions pass; manifest, API coverage, compliance, migration integrity and role-guard gates pass. **UI** — fixture browser `test-stage5-intake-browser` 34 scenario groups at 1280/390 px for Estimate, Get Started and Home callback; ContactBubble, the HelpCenter callback panel and the admin resume button were not browser-exercised. **Native** — NOT RUN. **Release** — candidate, not published by this entry. Migration `0380` wording in the native packet is now conditional: empty tables and current column types do not establish historical execution or data loss, with no provenance-incident or backup-recovery claim. No production form submission, reclassification, provider call, native operation or activation occurred; outbound pause epoch 1, outgoing GHL disabled epoch 16, incoming GHL enabled. Stage 5 remains OPEN; no closure or native-GO claim.

### Website email lifecycle readiness — default-closed implementation and isolated proof (2026-11-07; project task 2143; still open)

Cross-reference: this entry has no canonical section number in the repository copies of these documents, so none is asserted; identify it by title and date, and by `docs/certification/website-email/browser/receipt.json`. The plan is `.local/tasks/website-email-lifecycle-readiness.md`; the owner's corrected pre-build audit is `attached_assets/Liberty-Task2143-Final-Prebuild-Audit-and-Corrections-2026-11-0_1794078783321.md`. Earlier entries are unchanged.

Scope as run: the corrected preflight and the default-closed implementation with isolated tests only. No production write, send, mailbox or provider probe, profile or capability enablement, GHL or native writer, recipient release, control unpause or ad launch occurred. Live activation and delivery acceptance are NOT complete and are not claimed.

**Source (what the code now does; none of it is active).** A separate warm Gmail lane for website requesters, closed by default.
- Consent: Estimate, Get Started, Free Analysis and newsletter forms carry an optional, unchecked email-marketing box. The server owns the wording and its hash. An unchecked or omitted box writes no email consent event; a consent-write failure reports `unavailable`; the newsletter page reports a subscription only from a server-recorded consent; the "PDF" promise was removed; the Free Analysis phone-and-text sentence no longer claims email marketing. The phone consent control and its writers are untouched. New email opt-in writes appear only through the canonical consent authority (`website-email-consent.ts`); the other canonical opt-in writers are unchanged.
- Programs: `requested_followup` (purpose `human_response`, transport `transactional_response`) and `nurture` (stays `promotional`, transport `marketing_outreach`). Nurture needs an email opt-in from THIS occurrence. A second occurrence for a person who already has an active or completed journey for the same program is refused `PRIOR_JOURNEY_EXISTS`, whatever warm revision or source sequence the program is mapped to at that time (the check runs under the contact lock; a unique index on contact and program for active and completed admissions is the database backstop). Unknown record class holds both programs (`CLASS_REVIEW_PENDING`). A later inbound message stops the journey.
- Decision: one pure function, `decideWebsiteWarmAdmission`, judged at creation, claim and before-I/O; claim and before-I/O re-bind to the live address hash, address generation, frozen revision hash, channel and admission state. It calls the unchanged pure CR-06 decision with an explicit boundary and purpose (`website-email-contracts.ts`). `CR06_DISPATCH_AVAILABLE` is still `false` and the CR-06 decision file is unchanged. Warm enrollments never use the CR-04 fence, canonical recipient preparation or SFP cohorts, and never read a sequence's free-form trigger config.
- Lane configuration: append-only, compare-and-swap on the revision. Opening requires the connected Gmail account to equal the sender account, approved warm revisions with zero unsupported steps for every mapped program, and a daily limit above zero. The eligible-from time can move later, never earlier (only an open-to-open change carries the existing start; opening from closed floors to the change time). Requests that arrived before the lane opened are terminal `BEFORE_ELIGIBILITY_START`; held intents expire after 72 hours.
- Warm revisions: frozen snapshots copied from a paused source sequence (states inactive, approved, retired). Approving does not activate the source sequence; non-email steps are recorded as unsupported and block approval.
- Enrollment marker: `sequence_enrollments.website_admission_id`. The legacy sequence worker filters marked rows (`sequence-worker.ts`), and the read-only operator "silent sequences" widget excludes them (`server/routes/activation.ts`), so marked journeys reach only the warm runtime.
- Transport: Gmail OAuth only (non-cold sender category). Send attempts are written before I/O to `website_email_send_receipts`; an uncertain outcome stays fenced and is never resent automatically (admin resolve only); the global pause is enforced inside `sendGmailEmail`; the `website-email` queue cannot run while global outbound is paused. The mailbox reader uses Gmail history polling, is closed by default, and its first poll initializes the cursor with no backfill.
- New in the final pass: the lane proves from the catalog that `communication_events` accepts the provider `gmail` before it admits, claims, sends or opens (`PROVIDER_LEDGER_NOT_READY`, a recoverable hold). Reason: Publish delivers new tables but has previously skipped CHECK changes on existing tables, and a send that cannot be recorded must never be made. Status shows `ledger.acceptsGmail`; the lane card shows "Message ledger accepts Gmail".
- Admin surfaces (no new sidebar entry): Outbound readiness lane card (single authority-backed status; Save requires an ok preview of the identical input; opening needs an acknowledgment checkbox), Sequences warm-content panel (create frozen copy, preview, approve, retire), a read-only Activation panel summary with a link, and the existing receipt card. Ten admin routes under `/api/admin/website-email` (status, revision preview, config preview, config save, revision create, approve, retire, reader open, reader close, receipt resolve); admin only for writes, admin and manager for reads.
- Migration `0382_website_email_lifecycle` (journal index 385, `when` 1800400290000): seven additive tables, the nullable enrollment marker column and its foreign key, and a widened provider CHECK on `communication_events` (the old CHECK lacked `gmail`). The new background capability group `website-email` is defined but not selected by any checked-in profile.

**Fixture / disposable database (all on freshly created disposable databases; provider and network egress denied).**
- Backend certification `scripts/certification/test-website-email-lifecycle-disposable.ts`: 376 checks PASS on the final tree — consent source matrix across Estimate, Get Started, Free Analysis and newsletter, default-closed lane, per-occurrence per-program durable intents, scoped admission (including a remap to a different approved source sequence that still cannot start a second journey for the same contact and program, and a direct second insert refused by the database), marker ownership versus the legacy lane (including a production-shaped mirror), transport outcomes and capacity, reader and canonical stops, tick ownership, the role-denial matrix over all ten routes, the schema-delivery fence (narrow CHECK: zero Gmail calls, no receipt, lane unopenable, status says why; restore: same journey sends), and zero external network calls.
- `scripts/test-website-email-contracts.ts` 43 checks PASS; `test-cro05a-static.ts` 21 checks PASS; `test-consent-writer-dominance.ts` PASS (its three baseline assertions were repaired with negative controls; none showed a production leak); `test-redis-topology.ts` PASS (earlier tree); `smoke-role-guards.ts` PASS through the disposable runner after adding GET status (anonymous 401, merchant 403, agent 403, admin 200, manager 200) and GET revision preview (404 for admin and manager, 403 agent), which also proves the routes are mounted in the real app.
- Regression suites (E15), each through the disposable runner or run directly, all PASS: background-profile, forms, stage5 fresh-inbound, stage5 public-journey, stage5 intake-recovery, inbound-acknowledgement, canonical-release-authority, stage4d signed-reply journey, sequence-reply-decision, ghl-capability-policy, sender-policy (82/82). These ran on the tree before the final catalog-fence edit; that edit touched only the website-email contracts, lane store, status, lane card, reasons file and two test scripts. `smoke-selective-profile.ts` and `test-background-cadence-cleanup.ts` fail on the untouched baseline as recorded earlier and are not attributed to this work.
- Gates: `ci-suite-manifest --check` valid; `check-migration-integrity` PASS (1012 checks, 2 historical warnings); `check-api-coverage` PASS (883 client endpoints against 1805 handlers, no new unmatched); `check-queue-compliance` PASS; `compliance-scan` PASS (96 call sites). Focused compiler checks of the changed website-email files were clean. No whole-project TypeScript result is reported or relied on.

**Schema (E14).** `scripts/test-website-email-migration.ts` 173 checks PASS: fresh install through the production harness (exact 0382 ledger hash; rerun leaves the ledger unchanged); SQL-to-Drizzle parity for all seven tables and the marker column (columns, types, nullability, indexes, checks) with database negative controls; upgrade with historic rows from an EMULATED 0381 head (a harness-migrated database with exactly the 0382 objects reversed and its ledger row removed — not a genuine historic database; a genuine one cannot be built because the migrator folder is bound to the working directory); partial-schema convergence; replay idempotency with retained rows; a legacy raw enrollment insert still works; the journey unique index covers contact and program (not revision); narrowing the provider CHECK is refused while Gmail evidence exists (schema rollback is not a supported path). Registered in the suite manifest and the pre-deploy roster.

**Browser (fixture).** `scripts/test-website-email-browser.ts` 150 checks PASS, private Chromium against the real handlers on a disposable database: Sequences warm panel (copy, unsupported-step blocking, HTML/plain/link preview, keyboard open and Escape, approve), lane card (read facts, blocked open preview with reasons, closed save and reload, Back), Activation summary, admin-to-manager actor switch with direct 403s, role matrix admin/manager/agent plus merchant, partner and affiliate negatives at 1280, 768 and 390 px in light and dark, and the public Estimate, Get Started, Free Analysis and newsletter consent surfaces (checked, unchecked, request failure; the Free Analysis call-and-text sentence no longer names email). The Free Analysis scenarios were added in this pass after the first attempt returned 501: the browser fixture had not mounted the route file that holds the Free Analysis handler; it is now mounted and the real handler answered. Egress: the only denied external attempt is the existing deal-blueprint AI call from the unchanged public handlers (host-attributed); none to Gmail, GHL, ZeroBounce or any other provider. NOT exercised in the browser: ContactBubble and the HelpCenter callback panel (a callback without an email address is covered in the disposable-database certification: no consent event, no warm effect). The Stage 5 intake browser suite also passed (34 scenario groups); its re-rendered evidence images were restored to their committed content.

**Build and tested-tree identity.** Tested tree: uncommitted working tree on main `0332181102c736af52fab9768e833f7360bd3b6b` (55 changed or untracked paths, 22 of them untracked, before these documents were updated; package, lockfile and `.replit` unmodified; nothing stashed or reset). Final production build: `NODE_ENV=production npm run build`, buildId `365c3b65-b432-4257-b4ff-be345df14193`, artifactSha `0332181102c736af52fab9768e833f7360bd3b6b`. Browser receipt input hash `59b02859f12c8799984e45d059c4a14fe4ff994436bf017cc0b8d7ad44989f4c`, source input hash `5f686a3ad2205fe00ab08d8c307615f6e4e3740f12c15a4e3efa562833b61980`; the scope is stated there as the compiled client with registered source handlers, not deployed bundled-server parity. The final build, the browser run, the backend certification (376 checks), the migration proof (173 checks), the migration integrity check and the contract suite all ran after the last source edit (the one-journey-per-contact-and-program correction). The Stage 5 intake browser run and the E15 regression suites listed above ran earlier on the tree before that correction and the catalog-fence edit; the correction touched only the lane store admission check, the journey index in the migration and the Drizzle schema, and the certification script.

**Production, read-only.** `git ls-remote` shows origin main equals the tested base `0332181…` (no fetch was run). Production `/api/health` serves `8edb02db0a00623898a9a8509c050032d8c464de`, publishBuildId `32e186e8-d5f9-4194-b0ea-064fb780445f`, unchanged since preflight. On main the migration journal has 385 entries (last `0381_stage5_condition_chase_versioning`, `when` 1800400280000), so index 385 and `0382` are unreserved on main; other remote branch journals were not inspected. The development database was read: it does not contain the 0382 objects (the harness applies migrations when the development app boots, which was not done). The production database was not read or written; production controls, pause state and schema were not queried this pass.

**Gate and grep results.** The only new caller of the lifecycle decision (`website-email-contracts.ts`) passes an explicit boundary and purpose; existing callers use the compatible wrapper and were not edited beyond the marker filter. The background-profile diff adds only the `website-email` group; existing groups are unchanged. Enrollment-insert census: legacy storage method (never sets the marker), the SFP enrollment bridge, canonical recipient preparation and the post-enrichment worker's raw SQL (all unmarked, and the legacy worker's marker filter keeps marked rows away from them) and the warm writer (the only one that sets the marker). The existing "no usable channel" reason appears only in the untouched promotional-enrollment-eligibility and census code. Queue and send compliance scans pass; no direct send call outside the existing helpers; no production-targeted write script; no dependency, lockfile, environment or secret change; no checked-in profile or capability enablement; the 127 catalog sequences and the CR-06 cold pilot manifest are untouched. E12 (signed ingress) is not applicable because Gmail history polling was chosen over Pub/Sub.

**Migration and deploy instructions.** (1) Publish reconciles production from the development database, so boot the development app once so the harness applies 0382 (additive, closed) before publishing. (2) Publish delivers tables, columns, indexes and foreign keys; it has skipped CHECK alterations before, so after publishing confirm read-only that the CHECK on `communication_events` names `gmail` (the status route's `ledger.acceptsGmail`, or the same catalog predicate). If it does not, apply the final statements of `migrations/0382_website_email_lifecycle.sql` (drop the narrow CHECK, add `communication_events_provider_gmail_chk` NOT VALID, validate) through the owner's Database SQL console; until then the lane holds with `PROVIDER_LEDGER_NOT_READY` and cannot be opened. (3) After publishing, all seven tables are empty and the lane has no configuration revision: closed.

**Rollback and hold semantics.** Closing the lane (admin UI) appends a closed revision and admits nothing further; revoking revokes admitted journeys; global outbound pause and the queue pause gate stay as found. Code rollback is a redeploy of the previous build; the schema is additive and is not dropped (the database refuses narrowing the provider CHECK while Gmail evidence exists). Marked enrollments remain tied to paused source sequences; that an older build will not process them is reasoned from the paused sequences and the unchanged pure CR-06 refusal of promotional mail, not tested.

**Not verified.** Any deployed behaviour; the production database state; Gmail connection, alias and receiving mailbox; DNS, SPF, DKIM, DMARC and delivered headers; real delivery and inbox arrival; the ContactBubble and HelpCenter callback browser paths; the older-build behaviour above; a genuine historic migration head.

**Remaining gates (all pending and owner-controlled; none are claimed).** Owner publish; confirm serving identity and unchanged controls and schema; one narrowly authorized seed to the owner's designated inbox with real From and Reply-To, SPF, DKIM and DMARC alignment, links, unsubscribe and arrival; a protected complete website journey with authorized test mailboxes (receipt, enrollment, first and later step, reply stop, unsubscribe, bounce); proof of the actual Gmail connection and alias; scoped lifting of only the necessary pauses after exclusion of old work is shown, with SMS and unused native writers off and outgoing GHL contact sync as found; proof of immediate stop, revoke and recovery without replaying delivered or uncertain steps. Owner decisions still required: non-cold transport and sender (connect Gmail or approve a reviewed change), SMTP provider identity and policy eligibility for any SFP list, DNS and delivered-header alignment, incoming GHL bulk-sync status, and the ads minimum release. SFP provider and list eligibility, native GHL, SMS and calendar work, and ads remain open and are not marked complete here.

### Website intake and CRM handoff repair — durable review handoff, statement-upload queue capability and review surfaces (2026-11-07; direct owner request; Publish required)

Cross-reference: this entry has no canonical section number in the repository copies of these documents, so none is asserted; identify it by title and date, and by the three certification scripts `scripts/certification/test-website-intake-handoff.ts`, `scripts/certification/test-statement-upload-queue-capability.ts` and `scripts/certification/test-website-intake-handoff-browser.ts`. The owner's scope is `attached_assets/Liberty-Website-Intake-and-CRM-Handoff-Full-Repair-Scope-2026-1_1794106172520.md`.

Scope as run: one bounded repair with three checkpoints (A trace and durable handoff, B public and operator behaviour, C integrated proof). Isolated tests only. No production write, send, provider call, profile or capability enablement, GHL write, recipient release, control unpause, deletion or reclassification occurred. Production was read only for diagnosis. The repair is NOT live: it is unpublished, and the existing occurrence 269B66AF has NOT been recovered. Neither is claimed.

**Root cause (sanitized evidence).** The site serving libertybancard.com ran build `8edb02db…`; the repository head was `22286be2…` and unpublished. Reference 269B66AF is a statement upload whose 521,585-byte PDF was retained; its request lifecycle was `failed` with `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, its statement command was `recoverable_failed`, its receipt (transactional acknowledgement) was already `sent`, and its assignment, sales work, SLA and statement-review effects were `held`, so no task or notification existed. A second identical failure (reference 0A900C02) exists and is reported only. All four production statement commands were `recoverable_failed`. Three defects combined. (1) The `.replit` background profile selected no group containing the `statement-upload` capability, so no producer queue existed and the public route answered 503 before it accepted the request. (2) The receipt sweep had no prerequisite that the internal review work exist, so a receipt could promise review that nobody had been asked to do. (3) Re-saving the receipt capability moved the eligibility start forward.

**Source (what the code now does).**
- Capability: a narrow `statement-upload` group is selected by the profile (`selective:…,ghl-sync-only,statement-upload`). It admits only the statement producer queue and consumer; it does not widen the critical-commands group.
- Durable handoff: queue refusal is not a failed request. The retained file and in-progress command stand, one review task with its deadline and one management notification (label "Processing needs attention", link `/dashboard/lead-ops?tab=pipeline&ref=<REF>`, no statement or financial content) are created, the request is `review_required` with terminal reason `STATEMENT_PROCESSING_DEFERRED:<code>`, and the merchant receives a truthful 202 with an eight-character reference that says automatic processing is behind and an advisor will handle it. A same-key replay answers 200 with the same reference. The other six statement producers keep their boolean/503 contract.
- Storage and responses: the 10 MB limit is kept; the file type is judged from the real bytes (PDF, JPG, PNG), with 413, 415 and 400 for an oversized file, an unsupported file and a malformed submission, before any contact, file or request is written.
- Receipt gating: receipts are gated per request class on the internal review milestone and a per-class cutoff, so an old request is never back-filled and a re-save never moves the start; the global pause and the five-class capability are unchanged.
- Recovery: admin-only, CSRF-protected `POST /api/lead-ops/inbound-requests/:receipt/statement-recovery`; it re-enqueues the retained command only when a consumer exists, otherwise says so plainly and changes nothing; it never touches a receipt, never creates a replacement submission, contact, task or notification.
- Review surfaces: Inbound Operations (cards below 1024 px, table from 1024 px) with reference lookup, the review task link and the retry control for admins; an Overview "Website requests" card for admin and manager; the Messaging Inbox "Site chat" scope note that points to Inbound Operations and a failed-source notice that names the source, says it is not an all-clear and offers Retry; stale deal links now resolve to `/dashboard/pipeline?id=`. No sidebar entry was added.
- Receipt settings and previews: per-class windows and save semantics are shown; previews are sent as support@ and render in an empty sandbox; the dashboard preview inlines the logo for display only (the sent HTML and its absolute logo URL are unchanged); the full-preview dialog now starts focus on the dialog so Escape closes it (the preview frame used to take focus and swallow the key).
- Disclosed behaviour change: automatic statement AI analysis for the website source is held behind a default-closed `system_settings` flag, so a deferred upload does not spend a provider call on its own.

**Test receipts by layer (all on disposable databases, deny-by-default egress, global outbound pause in force).**
- Service/route/queue/effects: `test-website-intake-handoff.ts` 116 checks passed; `test-statement-upload-queue-capability.ts` 32 checks passed; `server/tests/statement-command-worker.test.ts` and `scripts/test-redis-topology.ts` passed.
- Mounted browser (private Chromium, compiled production client, real sessions, 1280, 768 and 390 px, light and dark): `test-website-intake-handoff-browser.ts` 140 checks passed on two consecutive runs: Inbound Operations matrix, long business name, lookup, retry, Overview, receipt settings and previews, Messaging Inbox, notification link, the merchant upload form driven like a merchant (no file, a program posing as a PDF, a real PDF), manager and agent role boundaries, no uncaught browser exception, no external call, no message sent. The Messaging Inbox payload in that run is fixture-supplied and proves how the client renders a failed source and Retry, not what the live reader returns.
- Static: migration integrity (no migration was added), queue compliance, CSRF fetch scan, outbound compliance scan passed. Both new certifications and the browser certification are registered in the disposable runner roster and the CI suite manifest.
- Known baseline failures, unrelated and present before this work: `test-task2056-crm-ui-contracts`, `test-crm-operator-experience`, `test-lead-ops-budget-removal`, and the `server/db.ts` line 174 type error. A whole-project type check was not run.

**Unchanged controls.** No code path in this repair enables a provider, sequence, campaign, SMS, GHL write or booking, and none changes the global outbound pause or the five-class receipt capability; the certifications assert that nothing is sent and that receipt effect rows are untouched by retry. A production readback of those controls is a post-Publish step and has not been done.

**Rollback.** Redeploy the previous build; there is no schema change. Removing `statement-upload` from the `.replit` profile returns the previous (failing) behaviour, so rollback would reintroduce the defect.

**Not verified.** Any deployed behaviour; the production serving identity after Publish; the production state of 269B66AF; real merchant browsers other than Chromium; the live Messaging Inbox reader.

**Remaining gates (pending; none are claimed).** Owner Publish of the current build, which also delivers the `.replit` profile change; confirm the serving identity and the unchanged controls read back; recover 269B66AF only through the admin recovery route with its full request identifier, without resending its receipt and without creating a replacement submission, then confirm its review task and notification exist and its CRM projection stays held; leave 0A900C02 unrecovered until the owner decides; the review links are `/dashboard/lead-ops?tab=pipeline&ref=269B66AF`, `/dashboard/tasks-appointments?tab=tasks`, `/dashboard/notifications`, `/dashboard/comms-hub` and `/dashboard/ghl-integration?tab=settings`.

### Website intake and CRM handoff repair — Publish verification and recovery of occurrence 269B66AF (2026-11-08; direct owner request; follows the 2026-11-07 repair entry)

**Serving identity.** After the owner Publish, the unauthenticated health endpoint of the production site reported source commit `d041c5c6` built 2026-11-08 13:00 UTC with `env: production`. That commit holds the full repair, including the `statement-upload` group in the `.replit` background profile; the platform's "Published your App" commit above it carries no file changes. The statement-recovery route answers an unauthenticated POST with 401 (present and guarded), and the production `worker_heartbeat_statement-upload` heartbeat is current (13:40 UTC on the recovery day) and its worker consumed the recovered command, so the narrow queue capability is live.

**Controls read back, read-only, before and after recovery.** The global outbound pause is still `paused` at epoch 1 (committed 2026-08-15, unchanged). The receipt capability setting is unchanged since 2026-11-07 20:22 UTC: enabled, the same five classes. No `communication_events` rows were created after 13:30 UTC on the recovery day. No `ghl_projection_operations` rows exist for the contact, and the review task has no GHL task id, so nothing was written to GHL and the CRM projection stayed held. No provider, sequence, campaign, SMS, booking or paid call was started by this work.

**Recovery of 269B66AF.** Before: request `failed` with `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, its command `recoverable_failed` with zero attempts, four held review effects, no task, no notification, the receipt effect `sent` (attempt 1, 2026-11-07 20:21 UTC). Action: one admin-authenticated, CSRF-protected `POST /api/lead-ops/inbound-requests/269b66af-…/statement-recovery`. Result: `outcome: recovered`, `queued: true`, no queue code. After, read back from production: the same command row `succeeded` after one attempt with the stored statement document attached; the request is `review_required`; review task 7072 ("Review statement", pending, normal priority, due 2026-11-11 17:00 UTC, no deal, no GHL id) is linked to the request; exactly one internal management notification exists (unread); the SLA effect and statement-review effect are `sent` as internal authority only; assignment remains held (`UNASSIGNED_POLICY_MISSING`, no assignment policy recorded; the task is unassigned until a manager takes it); the receipt effect's state, attempt count and timestamp are exactly as before. One `statement_occurrence_recovered` audit row records `receiptTouched: false` and `replacementSubmissionCreated: false`. The Inbound Operations list returns the occurrence by its short reference with the task link, and the 7-day summary reads received 7, needs review 5, statement attention 3.

**Left as found.** Occurrence 0A900C02 (failed, `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, command `recoverable_failed`) was reported only and not recovered, pending the owner's decision; the two other `recoverable_failed` statement commands are untouched. No receipt was resent, no replacement submission was created, and no historical receipt was replayed.

**Not verified.** The signed-in screens were not rendered in a browser against production (production sign-in is not available to the capture tool); the data behind them was read through the authenticated list and summary routes and direct production reads. Task assignment, the statement analysis result and any contact with the merchant are manager work and have not been done.

**Rollback.** Unchanged: redeploy the previous build. The recovery created a task, a notification, a stored document link and one audit row for a real submission; they can stay or be archived through the normal task and notification controls, and nothing external depends on them.

**Remaining gates.** Owner decision on 0A900C02 and the other two failed statement commands; a manager takes task 7072 and reviews the statement; the owner sets an assignment policy if automatic assignment is wanted. Review links: `/dashboard/lead-ops?tab=pipeline&ref=269B66AF`, `/dashboard/tasks-appointments?tab=tasks`, `/dashboard/notifications`, `/dashboard/comms-hub` and `/dashboard/ghl-integration?tab=settings`.

### W-A Public Truth and Terms — equipment, statement fee handling, timing, zero-percent program, integrations and competitor pricing (2026-11-08; project task "W-A Public Truth and Terms"; source and fixture receipt, not published)

**Serving identity.** Candidate is the working tree on `f20104fa` (not committed by this work; 43 tracked files changed, 8 new files). It was built with `npm run build` and served only from an isolated preview (disposable database and Redis, no provider calls). Nothing was published and the live site is still on the previously published build. The full record, the LI-W evidence table, the owner-evidence register, the competitor price table and the census are in `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**What changed.** A typed claim register now governs the wording of equipment and contract terms, statement fee handling, timing and funding, the zero-percent program, integration compatibility and competitor prices. A claim shows only when approved with an evidence key held in a server-only register; the equipment "no upfront" placement claim and the volume threshold are withheld, and 30 earlier assertions are retired with approved fallbacks. React pages, server-rendered pages, navigation, footers, metadata and structured data read the same selectors. Fixed here: the month-to-month and no-ETF assertions beside a footer that says early termination fees may apply, 48-hour, same-day, one-business-day and next-day windows (including the site-wide Organization schema), invented Liberty markups and savings ranges, the retired Square rate (2.6% + 10¢, now the dated list rate 2.6% + 15¢ in person), "never shared" statement handling text, the legality opinion and dollar math on the zero-percent page, the 20+ platform count and lock-in claims on Integrations, and the internal margin and payback tables that were publicly visible on the terminal shop page. Competitor prices are 12 dated, source-cited records checked 2026-11-08; Toast shows no rate because none is published. Route URLs, `offer=free-terminal`, `?terminal=yes` and the "Free Smart Terminal" label are unchanged.

**Test receipts by layer.**
- Source/fixture: `scripts/test-public-claims-contract.ts` 664 assertions and 31 negative controls passed, also with `PUBLIC_CLAIMS_REQUIRE_BUNDLE=1` against a fresh build (the server-only evidence register is absent from the client bundle); registered in the pre-deploy mandatory suites and the CI manifest (`ci-suite-manifest.ts --check` valid). `test-public-route-validation.ts` 12 passed. Production build succeeded. A focused type check over every changed file found no errors in changed code; a whole-project type check was not run.
- Browser (Chromium, lab, dev server and isolated preview): mobile gate across the owned routes and the other edited pages at 320, 390, 768, 1024 and 1440 px, light and dark where stated in the record: no overflow and no failure in changed markup; `/integrations` contrast defect caused by this work fixed and re-verified. Overlay check 22 probes, 0 failed. Fonts check 25 of 26 routes ok. Performance (CPU x4, 1.6 Mbps, cold cache, median of 5): the eight measured routes are within the 2.5 s LCP and 0.1 CLS budgets and comparable to a baseline measured from a `git archive` snapshot of `f20104fa`. One rendered-output scan of 22 routes and a follow-up grep found five remaining universal next-day funding statements (site-wide Organization schema description and service offer, Why Liberty schema description, Help Center funding FAQ, Free Analysis badge), all fixed.
- Baseline, not introduced here: a layout shift of about 0.23 on `/industries/retail-payment-processing` in the fonts check (present with the `f20104fa` Industry page and intermittent), small tap targets on `/integrations` and `/beat-square-stripe`, and contrast and tap targets on the `/merchant-application` stepper.

**Unchanged controls.** No setting, schema, migration, journal, lockfile, dependency or theme change; no `statement_auto_analysis_enabled` or other setting write; no GHL, provider, paid, Gmail, message or booking call; the global outbound pause and every provider and sequence control are as found. The Terms, Privacy, Advertising Disclosure, Merchant Policies, Refund and Security pages were not edited.

**Rollback.** Revert the changed source files to `f20104fa` and redeploy; there is no schema, data or setting change. Reverting restores the contradictory and unsupported claims listed above. Never delete submissions or receipts as part of a rollback.

**Not verified.** Anything on the deployed site; Safari/WebKit and real devices (WebKit cannot run here, and Chromium cannot reach port 6000); field performance; receipt delivery, native booking, GHL and advertising behavior; the legal, contractual and operational facts that the withheld and fallback wording still depends on.

**Remaining gates (pending; none are claimed).** Owner Publish of a build containing this work, then a read of the health endpoint to compare the served source to the tested candidate; the owner evidence in section 4 of the record (agreement and equipment terms, inventory and placement rights, fulfillment capacity, funding availability, acquirer program rules, integration test evidence, statement retention and AI disclosure, case releases, image rights, PCI attestation) so held claims can be approved; W-B (shared footer and navigation consumption, Home sections), W-C (quiz and offer flow, statement-upload states, consent placement) and W-D (long-tail pages: blog, help-center articles, glossary, case studies, asset pages, testimonials, location pages, partner and affiliate talking points, free-analysis guarantee page, `/merchant-application` stepper styling, tap targets) handoffs listed in the record.

### W-A Public Truth and Terms — post-Publish read-back (2026-11-08; follows the W-A source and fixture entry above)

**Serving identity.** After the owner Publish, the unauthenticated health endpoint of the production site reported source commit `1a90e734`, built 2026-11-08 17:52 UTC, `env: production`, publish build `f8e627db`. That commit is an ancestor of the current main head (`d7066e8b`, "Published your App"), contains the claim register, the server-only evidence register and the contract suite, and the only later difference is a memory note. The published source therefore equals the tested candidate.

**Live read-back (read-only; unauthenticated GETs of public pages in a private Chromium with analytics, marketing and third-party scripts blocked).** After hydration, the page text, title, meta description and every JSON-LD block of 18 routes were searched for the retired assertions (month-to-month, no-ETF, ownership, no-lock-in, 48 hours, same-day, one-business-day, all-50-states, never-shared, the retired Square rate, invented Liberty markups and savings ranges, free/no-upfront equipment, contract-term assertions, next-day funding, internal margin tables, Review/AggregateRating schema, evidence-register markers): `/`, `/free-smart-terminal`, `/upload-statement`, `/0-percent-processing`, `/integrations`, `/compare/square`, `/compare/stripe`, `/compare-rates`, `/beat-square-stripe`, `/faq`, `/get-started`, `/shop`, `/free-analysis`, `/about-contact`, `/why-liberty-bancard`, `/savings-calculator`, `/merchant-application`, `/industries/retail-payment-processing`. Zero matches on all 18. A raw-HTML pass over 13 of the same routes found the same except one server-rendered "Next-Day Funding" card on `/why-liberty-bancard`, which hydration replaces; it is on the W-D list. `/free-smart-terminal` and `/shop` are served as the client shell (no server-rendered body), so their wording is only visible after hydration.

**Not verified.** Safari/WebKit and real devices; field performance; signed-in screens; receipt delivery, native booking, GHL and advertising behavior; the production state of the outbound pause, receipt capability and provider controls (a post-Publish read-back of those controls was not done by this work and no code in it changes them); the legal, contractual and operational facts that the withheld and fallback wording depends on.

**Rollback.** Unchanged: revert the changed source files to `f20104fa` and redeploy; no schema, data or setting change.

**Remaining gates.** The owner-evidence items in section 4 of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md` so held claims can be approved; the W-B, W-C and W-D handoffs in that record; a controls read-back after this Publish if the owner wants one recorded.

### W-B Design and Responsive Layout with post-Publish review corrections (2026-11-08; follows the W-A post-Publish read-back above)

**Source and build identity.** Base `2a3671a6` plus uncommitted working-tree changes; production build `a60d049d-cf77-4d8a-a995-72b5aa84ddd0`; Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, schema, migration, setting or data change. Full detail: section 7b of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**Review corrections.** R01: the promotion banner, list, inline and card variants, their Free Analysis and shop consumers and the retained shop equipment and fee assertions read the approved shared claims; `FREE30` remains only in the link and attribution. R02: every comparison table, FAQ, JSON-LD block and server summary keeps the product, plan, channel and rate qualifier with its rate; Authorize.net All-in-One and Gateway Only are separate records. R03: the shared statement, program FAQ, schema and Home and program consumers say credit-card surcharging does not apply to debit or prepaid cards and keep cash discount separate; the register has an official-source entry. R04: the record, ledger, spec and roadmap carry these receipts.

**W-B design.** B1: one shared server-shell stylesheet and menu model for every server page; the server-only comparison and switch pages no longer render the logo at its intrinsic 3,360 px width; link and button colors moved to token colors that meet contrast. B2: `/free-smart-terminal` call-to-action buttons wrap at 320 px and at 200% zoom. B3: Integrations and Beat Square/Stripe targets are at least 44 px. B4: palette extension (navy, red, light surface), shared navigation, `/industries` hub, rebuilt Home and About and Contact, no new promotion or price. B5: product images served as derivatives (about 2.1 MB to 16-66 KB on initial load for the three product pages; `/shop` 792 KB to 45 KB); shell logos at 420 px (about 8 KB instead of about 75 KB twice per server page; `/alternatives/square` document 218,909 to 47,804 bytes).

**Verification.** Contract suite 18 families, 938 assertions, 90 negative controls, 0 failures (plain and with the bundle required); suite manifest, image pipeline (13 sources) and route validation pass; production build succeeds. On an isolated production-profile preview (Chromium): strict design check 320 probes, 0 failed; mobile gate at 320/390/768/1440 across 27 gated routes (108 states) and 28 more routes (112 states), 0 findings; overlay 22 probes, 0 failed; fonts 27 routes ok; SEO audit passed. Matched lab performance (baseline `2a3671a6` versus candidate): 14 of 15 routes within the LCP and CLS budgets; `/faq` is over the LCP budget on both builds in that session (host-load spread, carried to W-D). A focused type check of the changed files shows only errors that exist at the base; a whole-project type check was not run.

**Not verified.** Safari/WebKit and real devices; dark color scheme beyond the default gates; field performance; signed-in screens; live form submission, receipts, booking, GHL and advertising behavior; the production outbound pause and provider controls (untouched). The owner Publish has not happened, so no deployed-UI read-back exists yet.

**Rollback.** Revert the 7b source files to `2a3671a6` and redeploy; no schema, data or setting change.

**Remaining gates.** Owner Publish, then a read-only read-back (health source commit; shop, comparison, program FAQ and server and mobile shell); W-C and W-D handoffs and the owner-evidence items in the record.

### W-B Public Shell and Hubs (2026-11-09; follows the W-B design section above)

**Source and build identity.** Base `4f8fdf16` (`4f8fdf163079905ad702650fa8f5d79ff402c492`) plus uncommitted working-tree changes; production-profile preview build `61d8d77e-5309-481f-9243-b3561b966176`; Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, lockfile, schema, migration, setting, data, content-security-policy or provider change; the only routing change is sitemap and SEO entries for the two new public routes. Full detail: section 7c of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**Delivered.** `/payment-processing` and `/pricing-and-programs` (one shared content module for the server and React renders; commercial wording only from the W-A claim records). Industries hub heading with all 14 industry routes preserved. Header: Solutions to `/payment-processing`, Pricing & programs to `/pricing-and-programs`, Help under Resources, utilities Support, Account sign in (`/login`) and Partner sign in (`/partner-login`), Talk to Liberty in the bar from 400 px and in the Menu drawer below that; the server header uses a no-script disclosure menu. Home sections in one contract order in both renders. About and Contact server render with a stable `#inquiry` anchor, no form and no "Call/Text" label. Curated footer (Staff Login and the old Partner Portal Login replaced by the two sign-in entries). Glossary hub and term pages on the shared shell (one main, one h1) with their own same-origin font faces. The glossary is server-only (no client route), so the hydrated header, drawer and footer link to it with native anchors; real clicks from hydrated pages to the hub and a term page are proven. Public tokens single-sourced; CRM tokens untouched. Field-services slot is an icon tile. The performance gate counts an invalid measurement as a failure.

**LI-W evidence.** LI-W01 (`/` offer hierarchy): shell contract (section order in both renders, claim-backed review and equipment text), design gates clean. LI-W08 (`/about-contact`): phone 954-266-8214 and support@libertybancard.com from one shared module, `#inquiry` present, no form; response time and hours remain unstated until the owner confirms them. LI-W22 (footer and partner utility): curated footer and the Partner sign in entry proven by contract and by the role-flow browser test; `/partners` page wording was not changed in W-B.

**Verification.** Claims contract 959 assertions, 93 negative controls, 0 failures; new public shell contract 113 assertions, 21 negative controls, 0 failures; the three new suites are registered in the pre-deploy roster and the CI manifest (`ci-suite-manifest.ts --check` valid). Role-flow proof on a disposable database and Redis with the compiled client and real pointer input: 16 receipt groups passed (both utilities reach the real sign-in forms; wrong passwords create no session; admin, merchant and partner password sign-in land in `/dashboard`, `/dashboard/merchant-portal` and `/partner-portal`; the public shell is absent on destinations and restored on the next public page; 390, 430 and 320 px menu behavior; OS and stored dark mode; static glossary pages). Development server, Chromium: shell design 78 states, mobile gate 310 states, strict design 425 probes, overlay 22 probes, fonts 31 routes and `seo-audit` all clean. Isolated production-profile preview on port 6100: shell design 58 states, strict design 390 probes, overlay 22 probes and fonts 31 routes clean; mobile gate 310 states with 290 clean and 20 findings, all on the two glossary routes that the isolated preview does not serve (clean on the development server and on the compiled build in the role-flow fixture). A focused type check shows only errors that exist at the base; a whole-project type check was not run.

**Performance.** 10 routes, 5 cold-cache runs each, 0 invalid measurements; 9 inside the 2.5 s LCP and 0.1 CLS budgets (`/payment-processing` 1124 ms, `/pricing-and-programs` 932 ms, `/about-contact` 924 ms, `/` 1748 ms). `/faq` is over the LCP budget (4576 ms), as in the previous W-B session; carried to W-D. No baseline build was served, so comparison with earlier figures is indicative only.

**Deviations.** Home review card body stays claim `offer.review.short`; the equipment note is a disclosure sentence plus an equipment claim; image provenance stays "unverified" (open owner licence item); the overlay probe that targeted the removed Staff Login now targets the last footer link (same intent).

**Not verified.** Safari/WebKit and real devices; field performance; production sign-in and form submission; receipt delivery, native booking, GHL and advertising behavior; the production outbound pause and provider controls (untouched). The owner Publish has not happened, so no deployed-UI read-back exists yet.

**Rollback.** Revert the 7c source files to `4f8fdf16` and redeploy; no schema, data or setting change.

**Remaining gates and handoffs.** Owner Publish, then a read-only read-back (health source commit; the two new pages, Industries, About and Contact, `/learn` and a term page at 390 and 1440 px). W-C: the `#inquiry` mount point and Contact labels. W-D: Why Liberty team photo, long-tail editorial and proof publication, the `/faq` first-paint spread. Owner: image licence evidence, an approved founder portrait, and wording for SMS, hours or response time.

### W-C Forms and CRM Handoff (2026-11-09; follows the W-B Public Shell and Hubs section above)

**Source and build identity.** Base `fe4ae7f8` (`fe4ae7f8448eae2c42a63a77292beec5f98ab1f3`) plus uncommitted working-tree changes (39 tracked files changed, 12 new); production build identity `fe4ae7f8` (the artifact records HEAD, not the dirty tree); Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, lockfile, schema, migration, setting, data, CSRF, `.replit` or provider change. Full detail, route inventory, request contracts and the release checklist: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md`.

**Delivered.** (1) `/free-smart-terminal`: every primary, eligibility, card and final call to action opens a no-statement equipment inquiry; an offer section carries the approved equipment-terms disclosure beside the call to action; the existing product derivatives stay with an honest equipment-options note (provenance still unverified; no image invented). (2) `/get-started?offer=free-terminal` (and `?terminal=yes`): the short terminal inquiry; the generic six-step quiz is untouched without a mode. (3) `/about-contact#inquiry`: the short general or new-business inquiry; the secure application stays the next stage and `MerchantApplication.tsx` is untouched. (4) `/upload-statement`: form first, both `#upload-form` and `#statement-review-form` reach and focus the form, phone and industry optional end to end, formats stated as PDF, JPG or PNG up to 10 MB, strict bounded multipart fields, semantic fingerprint with legacy replay. (5) `/support`: no attachment picker, no text-message requirement, no response-time promise, sensitive statements pointed to the protected statement form, per-effect resumable executor (one ticket, one comment, one notification, original receipt on retry). (6) Staff handoff: the two new modes and support appear in Lead Ops with the frozen intent, protected document access without a deal, correctly addressed notifications; the statement handoff view reports held, manual review and unavailable states truthfully with Retry (it previously filtered audit actions that are never written and treated held steps as success). (7) Mobile Menu focus (WB-PV01): focus returns to the Menu button after Escape or close, `aria-expanded` and `aria-controls` accurate, navigation focuses the destination `<main>`. (8) Receipt kept until the status read confirms it, per-form intent storage, no key rotation after an ambiguous response.

**Source-policy and fingerprint decision.** `website_form|equipment_inquiry` and `website_form|general_inquiry` exist in the current (v3) contract only, as sales requests with the existing sales effects, added to the sales recovery list and deliberately **absent from the website warm lane**, so there is no nurture, requested-follow-up or promotional admission; support has its own executor. New statement requests use a plain 64-hex v2 semantic fingerprint (the `v2:`-prefixed first attempt failed the `inbound_requests.request_fingerprint` CHECK and was replaced by hashing the version into the digest); legacy fingerprints still replay.

**LI-W evidence.** LI-W02 (hardware visual and terms): source complete with the equipment-options fallback; approved hardware depiction is an owner-evidence item. LI-W04 (ad click to short terminal path): source and browser proof; paid-traffic landing check belongs to the ads owner. LI-W05 (statement form-first): source, API cert and browser proof. LI-W07 (booking): `/book` preserved and untouched; native booking receipt and routing need separately authorized marked-contact acceptance (not done). LI-W21 (support): source, API cert and browser proof; hours and response expectations await the owner. LI-W23 (new-business inquiry): source, API cert and browser proof. LB-FT-01 to FT-03, LB-SR-01 to SR-05 and LB-C-01: intake behavior covered by the same suites.

**Verification.** W-C API/handler cert on a disposable database and Redis with real multipart, fake transports and egress denied: 169 checks. W-C mounted browser acceptance with the production build, real pointer input, 320/390/768/1024/1440 px, light and dark, keyboard, native 200% browser zoom (device pixel ratio 2, 720 CSS px), Back/Forward, reload, request to task to protected document for admin, manager and agent, plus anonymous public journeys: 231 checks. Existing website intake handoff 116 and mounted browser 140; claims contract 960 assertions with 93 negative controls; `test-cro05a-static` 21, `test-consent-unchecked-not-optout` 4, `test-public-route-validation` 13, Stage 3 C3 contracts 211, D-R2 contracts 58; Stage 4A retired pilot routes, public shell contract and role-guard smoke pass; inbound acknowledgement, statement-upload queue capability, Stage 5 fresh inbound and intake recovery, Stage 3 B intake and A authority, merchant outbox handoff and the ready-held consumer contract pass; `ci-suite-manifest.ts --check` valid (261 suites; both new suites registered in the pre-deploy roster and the manifest); API coverage shows no new uncovered endpoint; `seo-audit` passes (it caught a 166-character `/support` description during the work; shortened to 150); `git diff --check` clean; production build succeeds.

**Performance.** Matched baseline and candidate, isolated production-build preview, 390 x 844 at DPR 2, CPU x4, 1.6 Mbps and 150 ms, cold cache, 5 runs per route, 0 invalid in either matched run. Candidate versus baseline LCP: `/free-smart-terminal` 1044 versus 1008 ms, `/get-started?offer=free-terminal` 980 versus 884 ms, `/upload-statement` 980 versus 1168 ms, `/about-contact` 916 versus 712 ms (all within budget). `/support` is over the LCP budget in **both** builds (3020 versus 3084 ms): not task-caused, not relabelled green. Candidate CLS on `/free-smart-terminal` is 0.045 against 0.0001 (within the 0.1 budget; cause not isolated). Later reruns on the same host were invalid for both builds and are excluded. Lab fixture timings, not field performance.

**Baseline failures (reproduced at the base commit, not introduced).** `test-statement-acquisition` (two step-7 "held" assertions), `test-crm-operator-experience`, `test-task2056-crm-ui-contracts`, `test-lead-ops-budget-removal`, `test-consent-field-protection` (foreign-key cleanup on the shared development database). Not run: `test-forms` (needs the GHL fail-fast server) and whole-project type check (kill line).

**Deviations and decisions.** Existing static tests coupled to moved code were updated, not loosened. The status read treats 404, 409 and a failed read as "unresolved", never as permission to clear the saved intent. The statement form follows the same rule: only a pre-claim refusal releases its key; a server fault, key conflict or lost answer keeps it, a changed detail or file is held back until the visitor starts a new request, and a fault in optional bookkeeping after acceptance still returns the accepted receipt. Merchant and partner fixtures were not run as separate actors in the new certs; they are refused by the same admin and manager gates.

**Superseded W-B statements (kept above for history).** "About and Contact server render with a stable `#inquiry` anchor, no form" and the W-C "`#inquiry` mount point and Contact labels" handoff are now delivered: the anchor hosts the inquiry form. The W-A and W-B statements that `/free-smart-terminal` leads to `/upload-statement?offer=free-terminal` and starts with a statement upload are superseded by the no-statement inquiry path. Any earlier support response window (4 hours, 1 hour, 24/7) is retired.

**Not verified.** Deployed UI (the owner Publish has not happened); production `/api/health`; real submissions, receipt delivery and inbox arrival; native booking, GHL, advertising and outbound behavior (untouched and not exercised); Safari/WebKit and real devices; signed-in CSRF for public submits (middleware unchanged, no new case); browser zoom above 200%.

**Rollback.** Revert the changed source files to `fe4ae7f8` and redeploy; no schema, data or setting change. Never delete submissions, tasks, tickets, receipts or protected files. Compatibility limits: occurrences created under the two new sources or the v2 fingerprint are not understood by the older build (labels and recovery), so do not run the older build's recovery over them; rollback also restores the 4-hour support promise and the statement-first terminal path.

**Remaining gates and handoffs.** Owner Publish, then the read-only checklist in the record (health source commit; the five changed routes at 390 and 1440 px; Menu focus; first-party `/book`; signed-in request, task or ticket, notification and protected-file readback if an authorized fresh submission exists, otherwise production end-to-end acceptance stays pending). Owner evidence: approved hardware depiction and image rights, support hours and response expectations, retention wording. W-D: long-tail response-time wording (Help Center, chat widget, Asset page and similar), the `/faq` and `/support` first-paint spread.


### W-C closure correction pass (2026-11-10; follows the W-C section above; published as `87159c74cb4ca9bfb6ed88fc263e44fd09600dad`, see the next section)

Source: the W-C post-publish audit of 2026-11-09. Full record: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md` section 17.

**Identity.** Serving `532a8b56015127ffb31ef9dd2d4bd1d0ddba7ac9` (built 2026-11-09T21:27:55.713Z, publish build `70e570f7-a89e-407c-8943-29a4752e057d`, re-read 2026-11-10); GitHub main `63b9e6f7a2edacaff4b4dea7770d9ea472b31772` with an identical tree. The corrections are a working tree on `63b9e6f7`: 15 modified and 2 new source and test files. No commit was made by this work (the platform checkpoint makes it). Tested-tree digest `2cd4d65cee8b5b3ecd7170c76d6506f98814f053bd75a78947f0bc19e7fa7aa5` (SHA-256 of `git diff HEAD --binary -- client server shared scripts` plus each untracked file in those roots, rule in the record). The suites ran on that tree after a fresh build, not on the serving commit.

**Corrected.** WC-PV01 both statement fragments in the server HTML plus one shared anchor helper that scrolls under the fixed header and focuses the form heading on a lazily rendered page; WC-PV02 terminal heading, intro, title and description from one shared module read by the server renderer and the React page for `?offer=free-terminal` and `?terminal=yes`; WC-PV03 a stored pending upload is restored as an unconfirmed request with the same key after a reload; WC-PV04 statement analysis wording derived from each upload's own evidence ("Analysis result not recorded for this statement" when none exists); WC-PV05 public-form controls 48 px and actions 52 px, scoped to the public theme.

**Evidence.** Failing before at the base source: API cert five failed sections, browser suite eight (four anchor sections, hydrated terminal step, sizing, reload during upload, analysis wording). Passing after: API cert 294, browser 404 (Chromium), website intake handoff 116 and 140, claims contract 960 assertions and 93 negative controls, shell contract 113 and 21, cro05a 21, route validation 13, role guards 1/1, manifest valid (267 classified, 261 mandatory), API coverage 882 endpoints and 1,807 handlers, SEO audit 424 routes passed, production build, `git diff --check` clean, `.replit` and package files unchanged. Whole-project type check not run (standing instruction); changed-file diagnostics clean. Added isolated coverage for six signed-in actors submitting public support requests with and without a CSRF token (policy unchanged), CSRF negative controls, and merchant, partner and affiliate refusals on the staff surfaces.

**Record corrections.** Support notifications carry no typed contact or ticket target and link to Inbound Operations (`/dashboard/lead-ops?tab=pipeline&ref=<REF>`); admin and manager recognize the event. The original browser cert did not assert direct-anchor focus; the original record's "Not published", signed-in CSRF and merchant/partner coverage statements are corrected in place.

**Production walkthrough (read-only, 2026-11-10).** One administrator sign-in, session confirmed twice, GET requests only, metadata-only read-replica queries. Request `269B66AF`: row, source, lifecycle `review_required`, assignment held (`UNASSIGNED_POLICY_MISSING`), due 2026-11-11 17:00 UTC; task 7072 pending and linked; management notification 5002 unread with the Inbound Operations link; protected document 1077 present with empty size and type metadata (observed, not investigated); handoff list four occurrences, three needing attention; summary 7 / 5 / 3 / 0 as in the audit. The audit's browser bounce to login is not reproduced and not explained; the sign-out confirmation line was not captured. No production statement row has a deal, so the occurrence-bound wording is not observable live.

**Not closed.** W-C is not labelled fully closed until the owner publishes the corrected build and the post-publish read-back in the record (health commit, first HTML for both entrances, real-browser fragments, new analysis wording, control heights) is recorded. Chromium only; WebKit and real devices not exercised; the upload-hold fault simulates an in-flight transfer rather than aborting a real connection. The earlier-review observation about a direct, confirmed JSON-form save clearing the stored intent is repaired in the next section. No send, setting change, auto-analysis enablement, GHL write, new submission, historical-command recovery, reclassification, schema or dependency change was made.


### W-C second closure correction (2026-11-10; follows the closure correction above; owner Publish of this candidate has not happened)

Source: `attached_assets/Liberty-W-C-Closure-Verification-2026-11-09_1794278816886.md`. Full record: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md` section 18. WC-PV01, WC-PV02, WC-PV03 and WC-PV05 stay as repaired and were re-run; only two items were finished. #2150 and W-D are separate and untouched.

**Identity.** Serving `87159c74cb4ca9bfb6ed88fc263e44fd09600dad` (built 2026-11-10T01:57:58.106Z, publish build `612af1d2-8f51-4dc9-b97e-c3e294d51c2d`, read from `/api/health` on 2026-11-10); GitHub main `b5c01724791bd403b8285d6054e13bef73e0233d`, tree `b84351eb32eb911cb7986599c3ce16fe79ba5633`. The candidate is a working tree on `b5c01724`: 18 modified files and 1 new source file; no commit was made by this work. Tested-tree digest `59791cd576fa5315a3c0d38909b6d2b10903536a6ccdfecc3a1428666dc1a607` (rule in the record; it replaces the earlier digest). Eventual published identity: not known until the owner publishes, then read `/api/health` and record it in the record's section 18.1.

**Corrected.** (A) WC-PV04: the deal's analysis status only records that the deal blueprint finished, so it never completes a statement; only an analyzer result record that names the upload's document does, a document-bound failure record reads failed even when the deal says complete, the newest record per deal and document decides, and the worker now writes the document id on its failure record. No stored row is rewritten. (B) A confirmed direct save is retained in the tab as identity and state only (key, request hash, receipt, pending-review state, once-per-receipt conversion claims; no personal details, notes or file bytes); a reload, Back or Forward restores the original reference and the pending-review wording; the same details replay under the same key; only Send another starts a new request and then creates exactly one new occurrence; conversions and thank-you page views fire once per receipt. Covers equipment and general inquiry, support, estimate, get started and the home, bubble and help-panel callbacks.

**Evidence.** Failing before (base sources restored, same new tests): the confirmed-save cert section failed at its first check, the browser suite failed six steps (four confirmed-save flows, the estimate/get-started restore, the analysis wording), and the base analysis files failed three sections of the worker-bound analysis cert. Passing after: API cert 415 checks, browser (Chromium) 440 checks, website intake handoff 116 and 140, claims contract 960 assertions and 93 negative controls, shell contract 113 and 21, CRO-05A static 21, route validation 13, role guards 1/1, manifest valid (261 mandatory), API coverage 882 endpoints and 1,807 handlers, SEO audit passed, production build, `git diff --check` clean, `.replit` and package files unchanged. Whole-project type check not run (standing instruction); changed-file diagnostics clean. Real isolated coverage: the real client library driven in Node against the real handlers with a recording fetch and lost-answer mode, the real worker job with a loopback fake OpenAI transport, and a real browser with a recording analytics stub and public-POST counter.

**Not closed.** W-C is not labelled fully closed until the owner publishes this candidate and the read-back in the record is recorded. Chromium only; WebKit and real devices not exercised; the lost answer is simulated in the page rather than by cutting a real connection; the help-center callback panel (signed-in only) and the floating callback bubble (not mounted on any page) are covered through the shared storage slot and source, not a browser; the live restore behavior needs a real submission and was not observed. Observed and left unchanged: the analyzer returns normally after recording a failure, builds its OpenAI client without an explicit base URL, and the blueprint generator swallows errors. No send, setting change, auto-analysis enablement, GHL or booking write, new submission, historical recovery, reclassification, schema or dependency change was made.
