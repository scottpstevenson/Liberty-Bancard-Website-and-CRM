# Liberty Bancard — Task #1712 Full Post-Implementation Audit

**Audit date:** 2026-08-28
**Audit target:** live `origin/main`
**Audited SHA:** `13ad61c960a7fdc69df4a1a4def368ba96f72241`
**CRO-03 baseline:** `89ebb12f163ae09d8166f673db335e746aa7e455`
**Migration head:** `0175_cro03_frozen_subject_plans.sql`
**Verdict:** **PARTIALLY COMPLETE — DO NOT APPROVE FOR DEPLOYMENT OR PROVIDER ACTIVATION**

## 1. Executive verdict

Task #1712 delivered substantial, useful CRO-03 safety infrastructure. Frozen subject evidence, durable item/provider state, append-only reservation/settlement rows, provider-operation fencing, immutable CSV source snapshots, manager-owned batch reads, provider-denied defaults, migration guards, and the 43-assertion disposable integration suite are meaningful improvements.

It did not complete the controlling Task #1709 post-merge correction directive. The largest omissions are not cosmetic:

1. Prospect and Sunbiz “enrich” actions still convert staging records into canonical contacts and qualifying sales deals **before** enrichment.
2. The required Sunbiz/SDR/public-web/AI source convergence and South Florida merchant-candidate recipe remain incomplete.
3. Outscraper bypasses the CRO-02 commercial decision rather than using a versioned discovery-stage policy.
4. Apollo still performs a broad vertical/metro search instead of binding the request to a resolved organization or domain.
5. Provider attempts and observations are written after transport and after separate state/accounting writes, leaving crash windows with incomplete lineage.
6. Serper and ZeroBounce do not yet participate in one complete operation/attempt/observation/receipt/economics lifecycle.
7. Apollo/Outscraper CSV evidence is reconstructed after canonical writes and only for newly created contacts.
8. The exact-SHA GitHub Actions integration job failed; server-required tests were skipped.

These are eight consolidated correction groups, not dozens of independent tasks. Reopen Task #1712 or create one tightly controlled CRO-03 completion task. Do not fragment the implementation into a new task per bullet.

## 2. Repository state

| Item | Verified state |
|---|---|
| Live branch | `origin/main` |
| Live SHA | `13ad61c960a7fdc69df4a1a4def368ba96f72241` |
| Baseline SHA | `89ebb12f163ae09d8166f673db335e746aa7e455` |
| Commits after baseline | 6 |
| Migration head | `0175_cro03_frozen_subject_plans.sql` |
| Audit worktree | Clean detached worktree after verification |
| Merge state | The claimed SHA is already contained by `origin/main`; it is not merely awaiting merge |
| Provider activity | No live Apollo, Outscraper, Serper, ZeroBounce, GHL, campaign, or outreach activity was performed by this audit |

## 3. Verified delivery

The following Task #1712 work is present and materially correct:

- `migrations/0175_cro03_frozen_subject_plans.sql` adds frozen subject snapshots, route plans, hashes, terminal counters, append-only reservation/settlement structure, lineage constraints, and immutability guards.
- `server/services/cro03/enrichment-factory.ts:191-339` freezes bounded contact evidence and route plans at batch creation and provides idempotent command acquisition.
- `server/services/cro03/provider-context.ts:179-201` verifies the provider operation, run, item claim, execution fence, lease, and active batch immediately before provider use.
- `server/services/cro03/enrichment-factory.ts:1393-1446` adds final dispatch authorization and an adjacent current-worker check.
- `server/services/cro03/enrichment-factory.ts:555-618` writes append-only terminal settlement, updates the shared operation/control authority, creates the receipt, and links the run.
- `server/routes/cro03.ts:23-88` limits batch creation/read/cancel to admin/manager roles, restricts manager reads and cancellation to their own `actor_id`, and reserves reconciliation/policy for admins.
- `server/routes/imports.ts:1949-1963` preserves accepted source-row values separately from contact defaults and derived fields.
- `server/services/contact-merge.ts` and the merge-manifest guard include the new CRO-03 evidence relationships.
- Apollo and Outscraper remain compile-time disabled and budgetless; canaries are declared non-executable.
- The tracked-file scan reports no newly prohibited pasted-text asset.

## 4. Completion-claim audit

| Completion claim | Audit result | Evidence |
|---|---|---|
| Frozen subject identity and route plans | **PARTIAL PASS** | Snapshot and route plan are frozen, but hashes are not validated and the route plan is only field-gap routing, not the required South Florida/source/cost recipe. |
| Durable provider lineage across attempts, observations, receipts, validation | **FAIL / PARTIAL** | Apollo/Outscraper rows exist on normal completion, but attempt/observation creation occurs after transport; recovery can terminalize without them. Serper has no equivalent full lineage and ZeroBounce has only a pending-intent link. |
| Append-only economics with lineage validation | **PARTIAL PASS** | Reservation/terminal rows and DB lineage guards exist; actual provider-specific billed units and money remain zero/fixed-unit placeholders. |
| Final claim/fence/lease checks | **PASS for Apollo/Outscraper dispatch** | The worker and operation context is checked at dispatch and again immediately before adapter invocation. |
| Cross-run/provider/receipt lineage rejection | **PASS structurally** | Migration triggers and disposable tests cover mismatched lineage. |
| Admin/manager ownership enforcement | **IMPLEMENTED, UNDER-TESTED** | Route code is correct; no direct CRO-03 anonymous/agent/Manager A/Manager B/admin HTTP matrix was found, and the server-required CI stage was skipped. |
| Provider activation remains denied | **PASS** | `CRO03_PROVIDER_TRANSPORT_ENABLED = false`; Apollo/Outscraper controls are disabled and budgetless. |
| CSV imports preserve immutable source-row evidence | **PARTIAL PASS** | The source-row snapshot is preserved, but only after canonical contact writes and only for created rows; matched rows are excluded. |
| Exact-SHA clean-clone build | **PASS** | Independently reproduced after materializing the exact tracked asset tree. The first sparse-worktree failure was an audit-environment artifact, not a repository defect. |
| Full pre-deploy validation | **FAIL** | Exact-SHA Static Checks passed; Integration Tests failed at deterministic integration and server-required suites were skipped. |

## 5. P0 corrections — required before deployment or CRO-04 dependency acceptance

### P0-01 — Enrichment currently promotes staging records into canonical Leads

`server/routes/prospects.ts:31-69` converts any unlinked prospect with `convertProspectDurably()` before creating a CRO-03 batch. `server/services/prospect-conversion.ts:260-323` creates or reuses a qualifying sales deal and marks the prospect converted. The `/api/enrichment-jobs` route uses this helper at `server/routes/prospects.ts:785-810`. Sunbiz enrichment first converts an entity to a prospect and then uses the same contact/deal conversion at `server/routes/prospects.ts:1137-1170`.

An “Enrich” action must not fabricate the state `Prospect Staging → canonical Contact → qualifying sales Deal/Lead` merely to obtain a CRO-03 subject ID.

**Required correction:** support immutable source/staging subjects directly in CRO-03, or introduce a governed source-observation/intake command that performs identity, classification, quarantine, duplicate, and arbitration work before any canonical contact write. Deal creation must remain an explicit promotion/lifecycle action after qualification, never an enrichment prerequisite.

**Required tests:** untouched prospect; Sunbiz entity; duplicate prospect; quarantined source; enrichment replay; concurrent enrichment; and proof that contact/deal counts remain unchanged until explicit promotion.

### P0-02 — Source convergence and the South Florida candidate recipe are still missing

The route plan in `server/services/cro03/routing-policy.ts:23-49` selects providers only from missing-field booleans. It does not freeze or enforce the required South Florida geography, vertical/merchant-fit, commercial class, provenance, exclusions, duplicate/quarantine, cost, or purpose recipe.

Several old paths are dead-ended rather than replaced:

- `/api/sdr/discovery/run` and `/api/sdr/discovery/pilot`: `server/routes/sdr.ts:1046-1080`
- `/api/sdr/re-enrichment/run`: `server/routes/sdr.ts:2406-2410`
- Sunbiz mass/re-enrich/pipeline/deep-enrich paths: `server/routes/prospects.ts:1503-1570`

At the same time, `/api/sunbiz/promote-qualified` and `/api/sunbiz/bulk-ai-classify` remain live outside the factory at `server/routes/prospects.ts:1530-1545`. The `SafeEgress` implementation is referenced only by static tests; no production public-web source adapter imports it.

**Required correction:** build one versioned discovery/source command that turns Sunbiz, SDR discovery, approved public-web retrieval, and AI extraction into immutable source observations and candidates. Freeze the complete selection recipe. Update all affected clients away from retired `503` endpoints and remove or route all direct legacy writers through the canonical source command. Keep provider transport disabled.

### P0-03 — Outscraper bypasses CRO-02 instead of using a governed discovery policy

`server/services/cro03/enrichment-factory.ts:250-256` marks a contact executable when `paidEnrichmentEligible || discoveryEligible`. `server/services/cro03/enrichment-factory.ts:1191-1208` skips the commercial fence for Outscraper, and the pre/post transport checks use `{ allowed: true }` for Outscraper at `:1374-1377` and later. The static suite explicitly certifies this bypass at `scripts/test-cro03-static.ts:166-170`.

This can admit a CRO-02-denied or unresolved record using only company/location fields, while its provider-run target fingerprint may be the empty denied-decision fingerprint.

**Required correction:** add a narrow, versioned CRO-02 discovery effect/purpose with explicit class, provenance, duplicate, quarantine, geography, actor, and budget rules. Freeze its decision snapshot and fingerprint. Revalidate before reservation/transport and before candidate acceptance. Do not bypass the authority with a local boolean.

### P0-04 — Apollo is not bound to the resolved organization

`server/services/cro03/enrichment-factory.ts:723-728` calls `searchApolloForDiscovery(vertical, metro, state, limit)`. `server/services/sdr/apollo.ts:262-278` submits broad keyword-tag, title, and location filters to `/mixed_people/search`; it does not include the frozen domain, legal/DBA identity, or Apollo organization ID.

The local matcher in `server/services/cro03/enrichment-factory.ts:43-59` accepts a unique exact normalized company name with a score of 4 even when domain, phone, city, and state do not match. That can attach a same-named organization in the wrong market.

**Required correction:** resolve or search the organization by frozen domain and/or canonical legal/DBA identity plus address/geography first, then query people within that exact organization. Require a unique deterministic organization/person match. Preserve alternatives and project nothing on ambiguity. Tests must inspect the actual Apollo request payload and reordered multi-result behavior.

### P0-05 — Provider attempt/observation lineage is not crash-complete

`server/services/cro03/enrichment-factory.ts:765-807` inserts both the provider attempt and observation only after an outcome exists. The transport executes at `:1447-1466`; the run is terminalized at `:1470-1478`; accounting settles in a separate transaction at `:1479-1482`; only then is the attempt/observation inserted at `:1483-1486`.

A crash after dispatch but before evidence creation, or after run completion/settlement but before observation insertion, can leave a paid or ambiguous operation without a provider attempt/observation. `recoverExpiredCro03Dispatches()` selects only `reserved` or `running` runs at `:621-638`, so a completed run missing later evidence is not repaired.

**Required correction:** create the attempt before transport in the same authorized dispatch transaction. After response, atomically append the immutable observation, terminal ledger entry, receipt, run state, and operation/control settlement. Recovery must create an explicit `ambiguous_billing` attempt/observation for any dispatched-but-unknown result and must repair completed runs missing required lineage. Add injected crashes after every durable boundary.

### P0-06 — All four providers do not yet share one durable lifecycle

Serper is selected in the route plan, but the global compile-time transport check at `server/services/cro03/enrichment-factory.ts:1228-1230` stops it before the Serper branch. If enabled later, the branch at `:1280-1330` uses the mutable current contact, takes the first organic result, writes a candidate without an observation ID, and creates no shared operation/attempt/receipt/economics lineage.

ZeroBounce creates and links a `validation_pending` intent at `:1252-1278`, but no CRO-03 consumer was found that links the eventual validation outcome back to the run/observation. `isCro03Provider()` covers only Apollo and Outscraper in `server/services/cro03/provider-context.ts:204-205`.

**Required correction:** define a compatibility lifecycle for Serper and ZeroBounce that preserves their existing budget/validation authorities while producing the same CRO-03 operation/attempt/observation/candidate-or-validation/receipt lineage. Use frozen subject data, deterministic matching, typed missing-key/disabled/no-result outcomes, and generation-bound final validation.

### P0-07 — Provider CSV convergence is after-the-fact, not evidence-first

`server/routes/imports.ts:2034-2065` calls `writeContact()` before creating CRO-03 evidence. The code then scores every result and may create a sales deal at `:2081-2095`. CRO-03 evidence is collected only for `_intakeOutcome === "created"` rows at `:2066-2077` and written only after the import execution completes at `:2150-2160`.

Matched existing contacts receive no Apollo/Outscraper observation. New contacts can be written, scored, and promoted to deals before the purported observation/candidate/arbitration path exists. This is attribution scaffolding, not `source observation → candidate → arbitration → canonical writer`.

**Required correction:** persist immutable per-row/per-field provider observations for created, matched, duplicate, rejected, and conflict dispositions before canonical mutation. Run identity/arbitration, then call the canonical writer only for an authorized winner. Score and create a deal only through the explicit lifecycle authority after governed projection.

### P0-08 — Exact-SHA CI is red and authorization runtime proof did not run

GitHub Actions run `33197867230` is bound to `13ad61c960a7fdc69df4a1a4def368ba96f72241`:

- Static Checks: **success**
- Integration Tests: **failure** at “Run all deterministic integration suites”
- Server-required application and role-guard suites: **skipped**

The disclosed failures are credible inherited expectation defects:

- `scripts/test-statement-acquisition.ts:145-152` expects the startup-seeded statement sequence to be active, while `server/services/seed-sequences.ts:48-60` intentionally seeds every new sequence paused.
- `scripts/test-backlog-preview.ts:379-397` accepts only `ok|schema_missing` for deferred GHL enrollments, unlike the adjacent source check that correctly permits `unavailable`.

Tasks #1713 and #1714 may remain labeled separately, but they must be completed before Task #1712 receives an exact-SHA final verdict. Do not weaken safety policy or falsify outage truth to make them pass. The rerun must reach and pass all server-required suites, including a direct CRO-03 role/ownership matrix.

## 6. P1 acceptance corrections

### P1-01 — Economics are structural, not provider-accurate

Every Apollo/Outscraper operation reserves one unit (`server/services/cro03/enrichment-factory.ts:1344-1351`), while monetary amounts remain zero. Before activation, reservation estimates and terminal settlement must reconcile actual provider-specific billed units/credits, result counts, receipt references, refunds, and ambiguous charges.

### P1-02 — Retry fields are not a durable retry policy

The run records `retryable` and `retry_after`, but `nextProviderForItem()` treats failed provider runs as finished and the item becomes terminal. Define typed retry limits and backoff. Never automatically retry ambiguous billing; retry only outcomes proven unbilled/released.

### P1-03 — Snapshot and route hashes are stored but not verified

New rows use application SHA-256 while migrated rows use PostgreSQL MD5. The worker validates JSON shape but never recomputes or verifies `subject_snapshot_hash` or `route_plan_hash`. Either define versioned hash algorithms and verify them before execution, or remove the implication that the hashes are integrity controls. Include the frozen snapshots/plans in the command/membership identity.

### P1-04 — UI/status compatibility is incomplete

`POST /api/enrichment-jobs` now returns a CRO-03 batch, while `GET /api/enrichment-jobs` still returns legacy enrichment jobs. Multiple clients still call retired endpoints and old progress APIs. Replace those consumers with a CRO-03 batch/status/history contract and truthful disabled/blocked/empty/error states.

### P1-05 — Route authorization needs direct HTTP proof

The route implementation is sensible, but the 27-check CRO-03 suite only scans source. Add anonymous, agent, Manager A owner, Manager B non-owner, and admin cases for create/get/cancel/reconciliation/policy, including privacy-safe 404 behavior and malformed UUIDs.

### P1-06 — Diff hygiene is not green

`git diff --check 89ebb12f..13ad61c` exits 2 because the task-added audit Markdown contains trailing whitespace. The same task removes pasted assets but adds a generated audit report under application `attached_assets`, which the current scanner does not classify as prohibited. Remove it from application assets or place approved technical documentation in the proper documentation owner, then pass `git diff --check`.

## 7. P2 follow-up hardening

- GitHub Actions warns that older action versions target deprecated Node.js 20; update action versions in the appropriate CI maintenance task.
- The production build reports stale Browserslist metadata and several oversized chunks; these are performance/tooling warnings, not CRO-03 merge blockers.
- Migration integrity retains two historical duplicate-timestamp warnings. They are not introduced by Task #1712; preserve the current strict high-water policy for new migrations.

## 8. Independent gates and evidence

| Command/evidence | Result |
|---|---|
| `git rev-parse origin/main` | PASS — exact SHA `13ad61c...` |
| `node --import tsx scripts/test-cro03-static.ts` | PASS — 27/27 |
| `node --import tsx scripts/ci-suite-manifest.ts --check` | PASS — 75 suites: 28 static, 28 integration, 13 server-required, 6 optional |
| `node --import tsx scripts/check-migration-integrity.ts` | PASS — 394 checks, 2 historical warnings |
| `node --import tsx scripts/scan-tracked-files.ts` | PASS — no new prohibited tracked files |
| `NODE_OPTIONS=--max-old-space-size=6144 tsc --noEmit --incremental false` | PASS |
| `node --import tsx script/build.ts` with exact tracked asset tree | PASS |
| Exact-SHA GitHub Actions Static Checks | PASS |
| Exact-SHA GitHub Actions Integration Tests | **FAIL** |
| Exact-SHA server-required suites | **SKIPPED** |
| `git diff --check 89ebb12f..13ad61c` | **FAIL** — trailing whitespace in task-added audit Markdown |
| Independent disposable PostgreSQL/Redis rerun in this audit environment | NOT RUN — no local disposable endpoints were configured; exact CI did provision PostgreSQL/Redis but the job failed later |

The reported 43-assertion CRO-03 disposable suite is credible isolated proof and is consistent with the new test file. It does not replace the failed exact-SHA workflow or the missing end-to-end cases identified above.

## 9. Test-database decision

Yes, CRO-02 through CRO-04 and the RVR certification work require a disposable test database. The correct setup is **ephemeral per run**, not a long-lived shared “test” database:

- empty PostgreSQL instance or unique database per run;
- migrations bootstrapped through the full journal and rerun for idempotency;
- isolated Redis instance or unique namespace per run;
- synthetic fixtures only;
- a dedicated test encryption key;
- fake/denied provider transports and no production credentials;
- automatic teardown after the run.

Task #1712 appears to have used such a disposable PostgreSQL/Redis environment for its focused 43 assertions, and GitHub Actions also provisioned both services. You do not need to create a manual persistent database merely to approve this task. You do need to preserve the disposable CI services and require the full exact-SHA workflow to finish green.

## 10. Final VFC

| ID | Requirement | Status |
|---|---|---|
| VFC-C03-01 | Immutable membership and frozen subject/route evidence | **PARTIAL PASS** |
| VFC-C03-02 | Crash-safe terminal batch accounting | **PARTIAL PASS** |
| VFC-C03-03 | Safe, governed, reachable Outscraper discovery | **FAIL** |
| VFC-C03-04 | Resolved-organization Apollo matching | **FAIL** |
| VFC-C03-05 | Complete attempt/observation/candidate/receipt lineage | **FAIL** |
| VFC-C03-06 | Provider-accurate economics and retry semantics | **PARTIAL PASS** |
| VFC-C03-07 | Role and indirect-object ownership | **PARTIAL PASS** |
| VFC-C03-08 | Sunbiz/SDR/public-web/AI source convergence | **FAIL** |
| VFC-C03-09 | Evidence-first canonical projection and ZeroBounce generation fence | **PARTIAL PASS** |
| VFC-C03-10 | Prospect staging is not promoted by enrichment | **FAIL** |
| VFC-C03-11 | Live provider transport and budgets remain denied | **PASS** |
| VFC-C03-12 | Exact-SHA clean install/build/static proof | **PASS** |
| VFC-C03-13 | Exact-SHA stateful and server-required CI | **FAIL** |
| VFC-C03-14 | Repository/migration hygiene | **PARTIAL PASS** |

## 11. Corrected build plan

Use one consolidated CRO-03 completion pass:

1. Recapture live `main`, exact migration head, and the current CI run.
2. Add source/staging subjects so enrichment does not create contacts or deals.
3. Add the versioned South Florida selection/source/cost recipe.
4. Add a CRO-02-owned discovery effect and remove the Outscraper bypass.
5. Bind Apollo to resolved organization identity and strengthen deterministic result matching.
6. Make attempt/observation/settlement/receipt/run completion atomic and crash-recoverable.
7. Bring Serper and ZeroBounce into the shared lifecycle without replacing their existing authorities.
8. Make provider CSV imports evidence-first for all row dispositions.
9. Cut all clients and legacy sources over to the new command/status contract.
10. Add HTTP role/ownership, source, provider-outcome, crash-boundary, and no-contact/no-deal tests.
11. Complete the truthful paused-sequence and unavailable-backlog test corrections.
12. Run every exact-SHA gate through server-required; perform full diff/search review.

## 12. Controlling directive for Replit

> Task #1712 is already present on live `main` at `13ad61c960a7fdc69df4a1a4def368ba96f72241`. Treat it as a substantial partial CRO-03 completion, not as deployment- or provider-ready. Reopen it or execute one consolidated corrective CRO-03 task; do not create a task per finding. Preserve all delivered immutable evidence, fencing, append-only accounting, provider-denied defaults, and CRO-02/CRO-01 authorities. Stop enrichment from converting Prospect Staging or Sunbiz entities into canonical contacts and qualifying deals. Add source/staging subjects, the versioned South Florida merchant-candidate recipe, and governed Sunbiz/SDR/public-web/AI source adapters. Replace the local Outscraper CRO-02 bypass with a versioned discovery effect and fingerprint. Bind Apollo requests and matching to the frozen resolved organization. Create attempts before transport and atomically record outcome observation, receipt, settlement, and run state with complete crash recovery. Bring Serper and ZeroBounce into the same lineage through compatibility adapters. Make Apollo/Outscraper CSV imports evidence-first for created, matched, duplicate, rejected, and conflict rows. Cut clients away from retired 503 routes, add a direct CRO-03 role/ownership HTTP matrix, fix #1713 and #1714 without weakening paused-by-default or truthful-unavailable behavior, remove task-added diff hygiene defects, and require a fully green exact-SHA workflow through server-required suites. Do not enable any provider, change live budgets, deploy, run production batches, mutate production data, activate campaigns, sync GHL, or send outreach.

## 13. Final status

**VERDICT:** PARTIALLY COMPLETE

**MERGE STATE:** already on `origin/main`

**DEPLOYMENT STATUS:** DO NOT DEPLOY

**PROVIDER STATUS:** DO NOT ACTIVATE APOLLO, OUTSCRAPER, SERPER, OR ZEROBOUNCE THROUGH CRO-03

**NEXT ACTION:** one consolidated Task #1712 completion pass, then exact-SHA disposable certification and CRO-04 prerequisite review.
