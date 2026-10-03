# Liberty Bancard — Task #2061 audit against current repo and original Stage 3 report

**Verdict: KEEP TASK #2061. Apply the five focused amendments below, then build.** Its repair scope agrees with Task A; there is no reason to rewrite it, create another task sequence, wait on every native historical claim, or repeat the already implemented GHL parser repair.

**Reviewed:** 2026-10-03. **Input:** `Pasted markdown(20261003-120406).md`, “#2061 — Stage 3 Authority Repairs.” **Repository HEAD:** `7fd447ada822cdd363d567e78f29b3a976714d05`. **Original authorities:** `LIBERTY_STAGE3_TASK_A_PREFLIGHT_BUILD_MASTER_PROMPT.md`; `LIBERTY_BANCARD_STAGE_3_CONSOLIDATED_IMPLEMENTATION_SPEC.md` (prior version 4, Sections 10/12/13/14, now updated with this review); current go-live ledger (prior version 9, now updated).

This is a pre-build task review. No Task A repairs, production writes, merges or deployment were performed. Source review, public health/source-tree comparison, real-lock policy execution and pure/local transport checks were performed. Full supported-toolchain stock CI, canonical PostgreSQL/Redis integration, valid-session role tests and live CRM action/browser certification were not run here.

## 1. What the task gets right

- Keeps R01/R02/R03/R06/R07 and the shared non-UI CRM3-05 contract in A; keeps B lifecycle/work queues and C1–C5 full navigation/design separate.
- Preserves every one of the **33 parent source rows** in the original A prompt's assigned register. Mechanical ID comparison found **zero missing parent IDs**. REF-056/V22 is explicitly added; other historical references remain qualified cross-references. This does not mean 33 unique defects, or that all subclaims across all 95 audit entries were verified.
- Correctly replaces the old inaccessible-serving-SHA conclusion with accessible source-tree equivalence, while withholding artifact/deployment certification.
- Correctly treats the private lock as a portability/policy defect even if a Replit installation succeeds. Does not insist on reproducing my earlier environment's 502 before repairing portable provenance.
- Correctly preserves the newer pure GHL pagination parser and separates source repair from successful actual import/webhook certification.
- Correctly distinguishes the existing agent guard on numeric contact detail paths from the still-unprotected collection and body-ID bulk paths.
- Correctly notes that `task-authority.ts` is a task-creation structural guard, not an existing shared read-query authority. A new shared read/metric predicate is justified; a second creation engine is not.
- Correctly retains manager global-enrollment restriction while providing an owned read/summary contract. The actual global route is admin/manager with manager sequence ownership requirements; it is not simply admin-only.
- Correctly rejects invented manager ownership for shared workflows: current workflow schema has no owner/createdBy field.
- Correctly separates mutable shipment/delivery observations from verified deployment and actual cash recovery; avoids inventing a new financial ledger to fix misleading labels.
- Keeps outbound paused, incoming independent/no-echo, proposals held, provider transports denied for tests, no production cleanup, and the repository's canonical CI/migration isolation.

## 2. Fresh baseline and evidence reconciliation

| Item | Fresh result | Consequence |
| --- | --- | --- |
| GitHub main | `7fd447ada822cdd363d567e78f29b3a976714d05` | Matches the task's reviewed HEAD. |
| Live public `/api/health` | status ok; SHA `c893360a439dbbc829a3bb6b66a11453fc41315d`; builtAt `2026-10-03T11:27:47.302Z`; publishBuildId `6302bdac-3bd2-42be-bc7d-15008e9ed986`; production; ghlTransportFailFast false | Matches the task's updated observation. Health alone does not prove DB/Redis/worker/sync health or control state. |
| Serving vs main source | Both trees `35a913ebfb017501a996da7c50aed257f1b8c0ce`; tracked file diff empty | Earlier unavailable serving source is superseded for this build. Do not retain it as a current blocker. Actual deployed artifact/install receipts remain a different evidence boundary. |
| Manifest SHA256 | `4408be46ca7912b4f0ac9667a0047970284122091bd092e1210a799703379cb0` | Matches attached preflight. |
| Lock SHA256 | `4d603128a407296bc5e230537f62e499ff3320cbe1623cd5540f28da24b79e12` | Matches attached preflight; lock was not repaired yet. |
| Real-lock policy | Actual `dependency-policy-evidence.ts --strict-sources` failed, exit 1, with **4 PRIVATE_PACKAGE_HOST + 4 NON_HTTPS_TARBALL errors** | These are two violations per private HTTP resolution, not eight independent CRM defects. Portable lock repair remains required. |
| Pure pagination/source regression | PASS | Confirms tested parser behavior and existing source wiring. Does not prove service/DB import completion or the cause of the old 3,994-row failure. |
| Fetch redirect boundary | Loopback-only default-fetch test followed a 302 to another path, destination hit once | Confirms default transport behavior; not a GHL exploit or service test. Add service-level redirect rejection tests. |
| Replit clean install / public SRI verification | Attached task reports successful clean installation and matching public SRI; its `.local` receipts are not in fetched GitHub source | Retain as supplied Replit receipts. This review did not independently rerun supported stock installation or registry-byte verification. Do not recast it as failed or independently certified. |

Audit execution environment was Node v24.19.0/npm 11.9.0, whereas the task/CI requires Node 22.22.0/npm 10.9.4. Pure checks and policy inspection are supplemental; their results are not a supported release/CI certification. No dependency installation or fake schema workaround was used in this review.

For the pure test only, a scratch copy of the existing script changed import/base URLs so Node's built-in TypeScript support could load it without package installation. Test assertions were retained. The repo test/source was not modified. The real policy script executed directly against the actual current manifest and lock with strictSources enabled.

## 3. Verified-from-current-code comparison

Paths/lines refer to the reviewed HEAD; use symbols after editing. The mechanisms below are source confirmations unless the row explicitly names a executed check. No fresh production exploit or DB mutation proof is inferred.

| Original cause / claim | Current source or fresh proof | #2061 disposition |
| --- | --- | --- |
| CRM3-01 source identity | Git trees/diff and health receipt above | Correctly updated; source comparison proved, artifact receipt still qualified. |
| V01 / CRM3-02 dependency portability | `package-lock.json` four private HTTP resolved URLs; actual `inspectLock` strict result eight errors | Accurate; do not confuse successful private-environment install with portable-lock policy pass. |
| V11 / CRM3-14 cold collection | `server/routes/contacts.ts:451–509` selects global cold audience, no actor/record_class predicate, whole-population fetch then JS slice; existing revenue authority has scope/cache machinery | Accurate: shared scoped SQL before totals/page/cache; preserve approved unassigned/owned-deal semantics. |
| V11 body-ID mutation | `contacts.ts:1212–1249` loops selected IDs, tags before workflow attempt, lacks whole-set authorization | Accurate: all-ID authorization/concurrency/no-partial-effect repair. Also apply amendment 4 for false result accounting. |
| Direct numeric agent path | `server/routes.ts:133` registers `crmObjectAccessGuard` before contact routes; `crm-object-access.ts:100–118` guards numeric agent detail subpaths | Correctly qualified; do not duplicate/remove guard or claim it protects body IDs. Actual session regression remains required. |
| V22 workflow management/run/read | `server/routes/workflows.ts:118–198` management mutations/run and reads/run history are authentication-only; run forwards raw entityType/entityId; workflow schema lacks ownership | Accurate explicit role/entity/associated-read contract. Do not change secret-authenticated `/api/webhooks/trigger` into a user-session endpoint; preserve its distinct existing boundary. |
| V08 scopes | `server/services/revenue-read-authority.ts` has parameterized people/deal scope, filters and scoped facet cache; analytics/cold audience have independent semantics | Accurate: shared predicates for identical metrics; labelled intentionally different censuses. |
| V09 terminal economics | `server/routes/terminal-economics.ts:267–348` caps deals at 5,000, counts recommendations as deployed and estimates paid_off from elapsed time/forecast GP | Accurate read-truth repair; no actual asset or cash receipt inferred. |
| V12 audience dollars | `contacts.ts:500` computes total×15,000; ColdLeads displays USD | Accurate: remove or explicitly label scenario; no measured revenue claim. |
| V13 aggregation | `server/routes/campaigns.ts:1921–1945` joins step and enrollment children before COUNT/SUM | Accurate distinct child aggregation/DB counterexample; standalone all-status totals are separate. |
| V14 manager reads | `campaigns.ts:1186–1196` requires manager owned sequenceId; `Sequences.tsx:201–204` queries unfiltered and defaults [] | Accurate scoped summary/read + explicit API errors, not globally widening manager access. |
| V16 incoming parser | `server/services/ghl-inbound-pagination.ts:4–50`; service fetch delegates around299–305 and checks incomplete/total drift/loops around424–455 | Existing source repair correctly retained. Actual DB/service and historical payload still separate. Amendment5 makes redirect acceptance precise. |
| Incoming independent/no-echo | Existing inbound routes/service, local-only writer and pause-epoch/lease/idempotency checks retained | Correct; do not disable incoming or add outbound write transport. No fresh control toggle/import was exercised here. |
| Runtime truth / V18 | `SequenceReport.tsx:303` hard-codes paused reason and`:408` says SMTP not configured/all email through GHL; general health/registry wording already has qualifiers | Broad truth scope correct; amendment3 adds exact literal/DTO acceptance to prevent omission. |
| A13 shared task reads | storage list excludes deleted; overview SQL/briefing due and overdue independent; task-authority structural guard only | Correct root cause, but clarify exact backend adoption owner in amendment2. B retains AI/UI work. |
| A14 local-create recovery | `contacts.ts:392–447` commits local write then awaits orchestration; replay returns existing contact; `inbound-request-authority.ts:553–718` starts link before inner try and tracks later failures | Accurate possible post-commit/replay boundary. Historical actual 500 still unverified. Use canonical durable request identities, no new parallel outbox or broad reprocessing. |
| A15 test classification | No `ghl-inbound` match in canonical manifest; new parser test and service/route/integration suites have different capabilities | Accurate coverage gap: register correct capabilities/guards; pure PASS is not DB/session proof. |

The task preserves the original confirmed/partial/disproved/expected/upgrade/history qualifications. No overall 95-entry disposition recount is justified by this focused review. No new independent repair-group total is introduced; amendments3/4 sharpen existing runtime truth and cold-action contracts, amendment5 is a service boundary hardening requirement, and amendments1/2 close documentation/ownership ambiguity.

## 4. Five amendments to apply before build

### 1 — Supply and bind the actual canonical audit documents

The task truthfully says the canonical spec and ledger were absent in Replit. They are available now with this review. Attach the updated files listed at the end of this report and replace “missing canonical docs” with a concrete read/update requirement. Use Sections 10/12/13/14/15 and the detailed original finding register; do not substitute the older August ledgers supplied as project references.

**Gate:** all 33 A parent rows and their assigned subclaims have an individual final outcome, proof/remaining owner; original 95 rows remain preserved in the canonical document. A only closes its own slices. Build can proceed while genuinely external receipts are pending; document availability should no longer be an avoidable reconciliation blocker.

### 2 — Make the backend task-query handoff precise

The task alternates between A “owned reporting adoption” and B “list/Home/briefing consumers.” That can leave a shared helper published but existing backend queries unrepaired.

**Exact boundary:** A implements the shared parameterized task-read/metric authority and migrates the applicable backend readers in `server/storage/tasks.ts`, `server/routes/analytics.ts` and `server/routes/daily-briefing.ts` to it (or explicitly different named, labelled population contracts). B owns visible task actions/work queues, client consumption/layout, `generateAiBriefing` factual overdue/degraded input/fallback, assignment/SLA/notification workflow. No duplicate SQL/status truth in B. A can refactor a briefing read without claiming B's entire briefing/AI defect closed.

**Gate:** DB fixtures compare list, overview, task analytics and briefing reads at the same actor/class/state/asOf/timezone and deletion/archive rules. Source call-site census shows the shared predicate is actually used. Do not mark full CRM3-05 closed before B's factual/UI gates.

### 3 — Name the existing SequenceReport runtime assertions

The general instruction “keep delivery assertions truthful under pause” should explicitly repair these owned minimal consumers:

- `client/src/pages/dashboard/SequenceReport.tsx:303`: Paused → “blocked by compliance gate,” regardless of actual reason.
- `:408`: SMTP fallback → “not configured — all email goes through GoHighLevel API,” regardless of current transport status.

**Exact repair:** add/reuse a secret-safe typed status contract from the existing outbound pause/transport configuration authorities. Distinguish configured, enabled, globally paused, sequence status/reason, probe observation and verified delivery. Render not-observed/unavailable when appropriate. No secrets, connection test sends, new delivery transport or C3 redesign. Paused can be intentional, not a compliance failure; configured is not successful delivery.

**Gate:** fixture permutations for configured/unconfigured SMTP/GHL, global pause, manually paused sequence, unknown reason and failed status read. API failure is not “not configured”; presence of active identities is not permission to send. Track under the existing V18/CRM3-04/REF-011/016 truth scope, not an additional independent defect count.

### 4 — Correct re-engagement outcome accounting as part of the existing cold-action repair

Current bulk route counts an item as enrolled when `result.enrolled || result.method === "replit_direct"`. But `server/services/ghl-workflow-enrollment.ts:456,476,488,533` can return `enrolled:false, method:"replit_direct"` including explicit blocked cases. A method label is not a durable membership receipt. The single action also returns success:true regardless of enrolled flag and unconditionally tags before the attempt; API success can be interpreted as successful enrollment.

**Exact repair:** use a truthful typed outcome (blocked/held/skipped/failed, or actually enrolled only when the intended authoritative receipt proves that state). Preserve existing compatible fields or version the DTO/minimal consumer together. Under this task's pause, no new enrollment or native write is authorized; permitted local intent must be explicitly identified, never labelled enrolled or activation-ready. Evaluate action authority and pause/eligibility before activation-like tags or effects, retain whole-set denial atomicity, and clearly distinguish request processed from action performed. Do not convert `method:"replit_direct"` into a new enrollment or provider call merely to make the counter correct.

**Gate:** actual registered-handler fixtures inject false/replit_direct blocked results, pause and failed provider paths; enrolled remains 0, correct reasons persist, no deceptive tag changes or effects occur. Include true receipt cases only using fake/test authority, with zero live enrollment. Manager/agent owner/nonowner/unassigned, stale owner/state, mixed-ID denial and retry remain original required tests. Keep this under V11/CRM3-14 cold-action authority/truth scope.

### 5 — Convert redirect review into a required GHL read boundary

`ghl-inbound-sync.ts` fetchPage currently calls fetch without a redirect policy. Default fetch follows redirects before metadata/cursor validation. Validating nextPage URLs does not validate HTTP redirect destinations. This is a transport boundary finding, not evidence of an actual malicious response, token leak or old pagination failure.

**Exact repair:** reject redirects (`redirect:"error"` or an equivalent validated fail-closed boundary); do not contact alternate host/path/location through an automatic redirect. Retain fixed HTTPS endpoint, request timeout and parser cursor reconstruction. If any redirect support is genuinely necessary, require explicit exact origin/path/scope validation before the next request and do not widen transport to arbitrary URLs. This does not require another native GHL approval or a parser rewrite.

**Gate:** actual fake-transport/service fixtures cover302/307 responses, location/path/host changes, timeout/rate-limit and retry checkpoint safety. No redirected destination/provider request; run remains incomplete with explicit error; no premature successful completion or local apply. Preserve the independent incoming control rather than shutting the lane off after failure. Do not claim the loopback default-fetch test alone certifies this repaired service behavior.

## 5. Exact implementation gate additions

The attached task already contains the main required CI gates. Add the following precision, not a new test architecture:

```bash
# Supported Node 22.22.0/npm 10.9.4, disposable clean checkout after npm regeneration:
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npx tsx scripts/dependency-policy-evidence.ts --strict-sources --output stage3-a-dependency-policy-evidence.json
npx tsx scripts/test-dependency-policy-evidence.ts
npx tsx scripts/test-inventory-artifact-dependencies.ts
npx tsx scripts/ci-suite-manifest.ts --check
```

The first policy command reads the real lock and must exit 0 after repair. The fixture script does not replace it. Continue with all attached deterministic-static/external-security/writable-build/guarded-migration/deterministic-integration/server-required gates. Do not use this audit's Node 24 inspection as release certification; do not run old DB imports against default Replit database.

Supplement the existing before/after rg census:

```bash
rg -n 'method === "replit_direct"|success: true, enrolled|enrolled\+\+' server/routes/contacts.ts
rg -n 'enrolled: false|method: "replit_direct"|enrollment blocked' server/services/ghl-workflow-enrollment.ts
rg -n 'blocked by compliance gate|not configured|all email goes through' client/src/pages/dashboard/SequenceReport.tsx
rg -n 'redirect|fetch\(' server/services/ghl-inbound-sync.ts
rg -n 'FROM tasks|from\(tasks\)|deleted_at|deletedAt' server/storage/tasks.ts server/routes/analytics.ts server/routes/daily-briefing.ts
rg -n 'ghl-inbound|pagination|stage3|2061' scripts/ci-suite-manifest.ts
git diff --check
```

Inspect legitimate remaining matches; regex absence is not handler/DB/session proof. Add named behavioral suites in the existing canonical manifest with correct capabilities and guards. Do not require provider purchases/native writes to pass any A component gate.

## 6. Copy-paste amendment for Replit Task #2061

> Keep #2061's existing scope and build sequence. Apply this current-repo audit as a bounded addendum, then implement; do not create another planning-only task or expand into B/C design work.
>
> 1. Read the supplied updated consolidated Stage 3 specification and current go-live ledger. They are now available; clear the missing-document limitation. Preserve all original 95 IDs and reconcile every assigned A subclaim individually. No historical/native evidence gap blocks independent safe code work.
> 2. A must implement **and adopt** the shared task read/metric authority in the applicable backend storage/overview/analytics/briefing reads. B owns UI, task workflows and factual AI input/fallback. Publish exact exported scope/DTO symbols; do not leave an unused helper or competing backend SQL. Keep full CRM3-05 closure pending B.
> 3. Replace SequenceReport's hard-coded “paused by compliance” and “SMTP not configured/all email through GHL” with secret-safe current status/reason DTOs, explicit unknown/error states and fake-status fixture checks. No real send/probe/provider activation.
> 4. Repair cold re-engagement result accounting: method=replit_direct alone cannot count as enrolled; false/blocked results cannot appear as completed enrollment. Check action authority/pause before activation-like tags/effects, report honest blocked/held intent, and prove zero live enrollment/native writes under pause. Test actual routes, including mixed IDs and false/replit_direct results; do not bypass gates to manufacture success.
> 5. Reject unvalidated HTTP redirects in inbound fetchPage and add fake-service 302/307/host/path/scope/timeout/retry tests. Next-page metadata validation does not protect followed HTTP redirects. Preserve existing parser and independent incoming Enabled/no-echo lane.
>
> Run the real-lock command `npx tsx scripts/dependency-policy-evidence.ts --strict-sources --output stage3-a-dependency-policy-evidence.json`, require exit 0, then the existing full canonical CI/session/DB/browser gates. Current HEAD 7fd447ad and serving c893360a have equal tracked trees; source provenance is no longer inaccessible for this build. Deployed artifact receipts remain separate; no deploy or Stage 3 certification claim. Keep outbound Paused, incoming Enabled and proposals Hold for Review. Update the actual canonical report/ledger after build, with exact source-fixed/tested/merged/deployed/live-verified dimensions and remaining owners.

## 7. Files to send with the task

1. This audit/addendum.
2. `LIBERTY_BANCARD_STAGE_3_CONSOLIDATED_IMPLEMENTATION_SPEC.md` — now includes Section 15 with this review and preserves the original 95-entry register/design/task roadmap.
3. `LIBERTY_BANCARD_GO_LIVE_AUDIT_LEDGER_CURRENT(2).md` — now includes Section 23 with current source/tree/parser/policy facts and #2061 amendments.

The attached task itself was not rewritten or marked implemented. A/Task #2061 remains the same task. These five amendments tighten its existing contracts; they do not change the eight-task delivery roadmap or require a new navigation mega-task. Proceed to build once the addendum/documents are supplied; final review/merge readiness still depends on actual required gates.
