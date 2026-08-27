# Liberty Bancard — Task 1699 / CRO-01 Full Audit and Corrections

**Audit date:** 2026-08-27  
**Audit type:** Read-only task preflight against authoritative current code  
**Verdict:** **BUILD-READY WITH MATERIAL CORRECTIONS — DO NOT EXECUTE THE DRAFT AS-IS**

## 1. Executive verdict

Task 1699 is the correct next tranche after Task 1698/CRO-00, and its core diagnosis is valid: the CRM has several distinct acquisition and revenue populations, capped client snapshots are being presented as totals, Pipeline and Reporting do not share one deal population, Portfolio is not currently a merchant-only projection, and prospect conversion does not have a concurrency-safe intended-deal reuse boundary.

The task must be corrected before implementation. The current draft leaves enough ambiguity to create a second source of truth or to produce different but still false counts. This audit identifies **24 required corrections: 10 P0, 9 P1, and 5 P2**.

No production data, GHL/provider transport, campaign, outreach, deployment, migration, or remote repository mutation was performed.

## 2. Authoritative repository baseline

The local primary worktree was not a valid Task 1699 baseline: it was on `agent/1629-ghl-route-pause-gates` at `7c6d3a81a81b59a813e6037010acade23d52ba3a` with unrelated modified media assets. It was left untouched.

A fresh read-only fetch and isolated detached worktree established the authoritative baseline:

| Item | Verified value |
|---|---|
| Remote | `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/` |
| Authoritative branch | `origin/main` |
| Authoritative SHA | `c5d0baa8c697778caccaed4dba74e456c9a07063` |
| CRO-00 commit | `658fabb95c79c9dc9fd577edc2cf887f67e7deb6` |
| CRO-00 ancestry | Confirmed ancestor of current `origin/main` |
| Isolated worktree | Clean; `git diff --check` clean |
| Migration SQL head | `migrations/0165_outbound_send_claim_lease.sql` |
| Journal head | index `169`, tag `0165_outbound_send_claim_lease`, `when=1794900000000` |

The current `origin/main` commit adds a test statement PDF after CRO-00. It does not change the CRO-01 application findings.

## 3. Corrected verified-from-code table

| ID | Draft claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | People is canonical contacts | CONFIRMED WITH COUNT DEFECT | People renders Contacts and `/api/contacts` supplies a server total, but the normal contact query includes archived contacts while the client hides them. The default total and pagination are therefore already false. | `client/src/pages/dashboard/ContactsAndLeads.tsx:41-57`; `client/src/pages/dashboard/Contacts.tsx:408-417,443,557-563`; `server/storage/contacts.ts:108-118`; `server/routes/contacts.ts:247-305` |
| VFC-02 | Current Leads is prospect staging | CONFIRMED | The Leads tab renders `Prospects`, and the legacy `/dashboard/prospects` route redirects to that tab. | `client/src/pages/dashboard/ContactsAndLeads.tsx:8-16,41-57`; `client/src/App.tsx:544-555`; `server/routes/prospects.ts:125-136` |
| VFC-03 | Prospect totals are capped snapshots | CONFIRMED | The page fetches 500 and calculates total/facets from the filtered client array. Search and most filters also operate only on that page. | `client/src/pages/dashboard/Prospects.tsx:72-84,203-207,244-263`; `server/storage/prospects.ts:147-152` |
| VFC-04 | Pipeline requests an invalid page and computes KPIs locally | CONFIRMED | Pipeline requests 2,000 while `/api/deals` allows 500; it throws a generic error and calculates stage, won, revenue, and closed metrics from loaded rows. | `client/src/pages/dashboard/Pipeline.tsx:1544-1555,1781-1787,2581-2653`; `server/routes/deals.ts:49-63` |
| VFC-05 | Deal reads are inconsistent | CONFIRMED, DRAFT EVIDENCE INCOMPLETE | Pipeline uses `getDealsByPipeline`, which has no production classification filter. The actual Reporting overview uses `/api/analytics/pipeline`, which loads only the first 500 production deals and filters in memory. Other ReportingHub tabs and acquisition reports use still other direct SQL definitions. | `server/storage/deals.ts:103-140,175-208`; `client/src/pages/dashboard/Reporting.tsx:89-100`; `client/src/pages/dashboard/ReportingHub.tsx:10-35`; `server/routes/analytics.ts:388-430`; `server/routes/acquisition.ts:877-920,976-1026` |
| VFC-06 | Portfolio admits non-merchants | CONFIRMED, NOT PARTIAL | The route explicitly includes assigned contacts without a deal and contacts with any unarchived deal. It has no MID predicate and returns a 500-row snapshot whose length becomes the summary total. | `server/routes/portfolio.ts:8-24,48-86,95-185` |
| VFC-07 | Prospect conversion is fully idempotent | FALSE | The prospect claim/contact recovery is fenced, but intended-deal reuse is a find-then-insert race. It reuses only a `New Lead` deal, inserts directly instead of through the deal creation owner, and hard-codes a display name where owner scope expects email. | `server/services/prospect-conversion.ts:69-152,177-240`; `server/storage/deals.ts:217-239`; `shared/schema.ts:210-212`; `server/storage/deals.ts:104-109,175-179` |
| VFC-08 | Prospect staging supports per-agent object scope | FALSE | `prospects` has no sales owner/assignee field. `conversion_claim_owner_id` is a transient request claimant and cannot authorize staging records. The route and UI currently allow broader access than the proposed matrix. | `shared/schema.ts:1283-1346`; `server/routes/prospects.ts:125-176,443,692`; `client/src/App.tsx:295-337,544-559` |
| VFC-09 | Merchant evidence exists | CONFIRMED WITH REQUIRED PREDICATE | `merchant_mids` and its transition service are the strongest current processor evidence. Merchant membership must require a distinct contact with `status='active'` and `activated_at IS NOT NULL`; profile, assignment, or generic deal presence is insufficient. | `shared/schema.ts:5884-5911`; `server/services/merchant-mid-service.ts:6-10,47-76` |
| VFC-10 | A stable privacy-safe deals error contract exists | FALSE | `serverError` sanitizes production messages but returns only `{message}` and has no reason code or correlation identifier. | `server/utils/server-error.ts:16-37`; `server/routes/deals.ts:49-63` |
| VFC-11 | Contact/deal classification is future work only | OUTDATED | BT-06 classification already exists. CRO-01 must consume `record_class`, quarantine non-production rows from canonical counts, and expose aggregate mismatch buckets without reimplementing classification. | `shared/schema.ts:223-227,503-504`; `server/services/commercial-classification-authority.ts:350-398` |
| VFC-12 | CRO-01 can test conversion with provider denial alone | FALSE | Both single and batch conversion perform post-commit scoring, routing, blueprint generation, task/notification creation, and promotional-enrollment enqueueing. Provider denial alone does not isolate those effects. | `server/routes/prospects.ts:329-379,614-670` |

## 4. Verified root cause

The core problem is not missing tables. It is the absence of one executable read contract that defines set membership, cardinality, role scope, classification, archive behavior, pagination, and snapshot time.

The draft also treats object names as if they must be disjoint. That is mathematically wrong for this CRM. People is the canonical contact population; Lead and Merchant are revenue states over contacts and may overlap. Prospect Staging is a separate pre-CRM population. Deal is an opportunity row. Ready for Outreach is an eligibility view.

| Draft assumption | Verified reality | Required correction |
|---|---|---|
| Definitions must be non-overlapping | People is a superset; Lead and Merchant can overlap | Require non-synonymous definitions and document set relationships/cardinality |
| Lead is an “open qualified deal” | No exact stage set, contact cardinality, or primary-deal tie-break is defined | Define one explicit open-sales predicate and count distinct contacts |
| People already has truthful server totals | Archived rows are counted server-side and hidden client-side | Put active/archive and all displayed filters in the shared server predicate |
| Reporting is primarily `acquisition.ts` | Reporting overview actually reads `analytics.ts`; the hub has six tabs | Inventory and align every task-owned consumer before claiming parity |
| Agents can see their Prospect Staging objects | Prospect rows have no sales ownership field | Restrict staging to admin/manager in CRO-01; do not invent ownership |
| Current deal creation authority is reused | Prospect conversion inserts deals directly | Extend `server/storage/deals.ts` with a transaction-aware create-or-reuse operation |
| Provider denial makes conversion isolated | Local automation/enrollment effects still run | Inject/deny post-commit effects or test the pure service boundary |

## 5. Canonical object contract required before coding

The corrected task must freeze these meanings and use them in code and tests:

| Object | Executable definition | Cardinality |
|---|---|---|
| Discovery Record | Source/import observation outside canonical CRM | Source-specific |
| Prospect Staging | Row in `prospects`; optional one-way link to a contact after conversion | Prospect row |
| Person / Contact | Non-archived canonical `contacts` row; classification stated in response filters | Contact row |
| Lead | Distinct non-archived production contact attached to at least one non-archived production `sales` deal in the explicit open-sales stage set | One row/count per contact |
| Deal | Non-archived production local opportunity row in the requested pipeline/scope | Deal row |
| Merchant | Distinct non-archived production contact with at least one `merchant_mids` row where `status='active'` and `activated_at IS NOT NULL` | One row/count per contact; active MID count separate |
| Ready for Outreach | Existing channel eligibility/readiness view over contacts | Eligibility projection, never an entity synonym |

The open-sales stage set must be a named constant or predicate derived from `SALES_STAGES`, with terminal stages stated explicitly. Existing `ACTIVE_DEAL_STAGES` cannot be reused blindly because it mixes onboarding stages and omits `Enriched` and `Promise to Submit` (`shared/schema.ts:1035-1048,4251-4274`).

For a contact with multiple qualifying deals, the Lead list must select a deterministic primary deal (for example newest `updated_at`, then highest `id`) while count remains `COUNT(DISTINCT contact_id)`. Deal totals remain row counts.

## 6. Required corrections by priority

### P0 — merge blockers (10)

1. **Replace “non-overlapping definitions.”** Document the intentional set relationships above. Never force record copying to make sets disjoint.
2. **Freeze the Lead predicate and cardinality.** Name the exact open sales stages, production/archive rules, `COUNT(DISTINCT contact_id)`, multi-deal tie-break, and treatment of `New Lead`, `Nurture / Not Now`, and terminal stages.
3. **Repair People count truth.** Normal `/api/contacts` must exclude archived rows by default, support an explicit authorized archive mode, and apply every displayed filter/search/sort server-side before count/pagination. Client-only per-page facets must not be labeled global.
4. **Correct the Reporting blast radius.** Inventory `/api/analytics/pipeline`, `/api/kpi/summary`, `/api/kpi/pipeline-stats`, Growth Metrics, Operations Report, and any other ReportingHub count that uses Lead/Deal/Merchant semantics. Route task-owned deal facts through the shared authority or explicitly leave and label a consumer out of scope.
5. **Resolve Prospect Staging authorization without inventing ownership.** Because prospects lack a sales-owner field, CRO-01 must make Prospect Staging list/detail/create/update/import/convert admin/manager-only. Add `allowedRoles` to the direct UI/import routes and replace `isAuthenticated`/generic `isDashboardUser` on changed endpoints with the same server policy. Any agent staging ownership model requires a separately approved schema task.
6. **Replace passthrough prospect mutation.** Use a strict allowlisted update schema; block record class, conversion claim/link fields, provenance/identity authority fields, and unknown keys.
7. **Use the existing deal creation owner and serialize reuse.** Add a transaction-aware create-or-reuse operation to `server/storage/deals.ts`; lock the canonical contact row (or equivalent stable key) before selecting/creating; derive record class and write the canonical audit in the same transaction; use it from both single and batch conversion. Do not add a second writer.
8. **Define reuse and ownership precisely.** Reuse one deterministic existing non-archived open sales deal, not only a `New Lead` row. Remove the hard-coded `owner: "Scott Stevenson"`; use a server-derived email owner or leave unassigned according to current policy. Replay must return the same contact and deal IDs.
9. **Make Portfolio genuinely merchant-only.** Use the exact active/activated MID predicate, production/archive filters, `COUNT(DISTINCT contact_id)`, active-MID count, deterministic latest deal, role scope, server pagination, and snapshot summary. Remove assignment/any-deal fallback.
10. **Isolate conversion side effects.** Tests must inject or deny scoring, routing, blueprint, task/notification, queue, and promotional enrollment effects. CRO-01 may harden the local conversion transaction; it must not silently change outreach policy or let tests enqueue real work.

### P1 — required for complete acceptance (9)

1. **Create one focused read authority**, for example `server/services/revenue-read-authority.ts`, containing pure predicate builders/types. Do not put read truth in UI components or duplicate SQL strings.
2. **Publish explicit list contracts:** `{data,total,limit,offset,filters,scope,asOf}`. Facets/aggregates must use the same predicate and role scope as rows.
3. **Give `asOf` real snapshot semantics.** Prefer one SQL statement with window totals or a read-only repeatable-read transaction. A timestamp attached after unrelated queries is not snapshot proof.
4. **Define the reconciliation API.** Admin/manager-only, aggregate-only, no identities, with named buckets such as archived, non-production by class, missing contact, multiple open deals, invalid stage, active MID without eligible contact, and assigned/deal-only legacy Portfolio rows.
5. **Align API authorization with UI authorization.** Reporting UI is admin/manager-only while multiple analytics routes are `isDashboardUser`. Either restrict those endpoints to admin/manager or apply tested agent owner scope before every join/count. Never rely on a hidden link.
6. **Specify the deals failure envelope:** `{message, code, correlationId}` for safe failures; preserve 400/401/403-or-404/409/500 status; log the same correlation ID server-side without SQL, PII, or raw row content.
7. **Narrow adjacent-consumer scope.** Statements, Applications, Tasks, and GHL receive only compatibility/read changes proven necessary for CRO-01 counts or canonical IDs. Task UX, GHL synchronization/runtime repair, provenance, classification decisions, and dashboard-wide reliability remain successor work.
8. **Make “no migration” operational.** Use contact-row locking/advisory locking first. If a database fence is truly required, stop and publish the conflicting identity population and backfill consequence in aggregate before adding migration `0166`; no unapproved dedupe/backfill.
9. **Register non-empty focused suites.** Cover >page-size totals, multi-deal contacts, role scope inside counts, active/archive/classification, primary-deal tie-break, MID distinctness, replay/concurrency/stale claims, single-vs-batch parity, error redaction, and post-commit side-effect denial. Empty/skipped fixtures fail.

### P2 — follow-up hardening (5)

1. Add query/index tuning only after disposable `EXPLAIN` proves a need; do not speculate during CRO-01.
2. Keep temporary legacy redirects/response adapters with explicit deprecation tests and removal owner/date.
3. Correct stale comments such as prospect conversion’s reference to a prior GHL call and document the canonical set contract beside the read authority.
4. Trend aggregate mismatch buckets after CRO-02 classification/provenance work; do not turn CRO-01 into a classification remediation task.
5. Leave broad null-safe dashboard formatting, detailed Pipeline retry UX, task remediation, and full client/server correlation to CRO-05/Task 1694 successor work.

## 7. Correct authorization matrix

| Action | Anonymous | Agent | Manager | Admin |
|---|---:|---:|---:|---:|
| People/Leads/Deals list and count | No | Own plus current unassigned policy, applied in SQL | Team/global per current policy | Yes |
| Prospect Staging list/detail | No | No in CRO-01 | Yes | Yes |
| Create/update/import/convert prospect | No | No in CRO-01 | Yes, without admin override | Yes |
| Reconciliation buckets | No | No | Yes | Yes |
| Merchant Portfolio | No | Verified merchants in agent scope | Team/global | Yes |
| Change MID or revenue object | No | Existing explicit mutation policy only | Existing explicit policy | Existing explicit policy |

For agents, role scope must be part of the count/list SQL. It cannot be applied after a global page is loaded. Cross-agent denial must not leak row existence, totals, or mismatch reasons.

## 8. Concurrency and side-effect correction

The local durable conversion order should be:

1. Authorize prospect under the admin/manager staging policy.
2. Acquire/reuse the fenced prospect claim.
3. Create/reuse the contact through `writeContact` in local-first mode.
4. Persist recovery contact ID under the claim.
5. In one transaction, lock the canonical contact key, reuse/create one intended open sales deal through the existing deal creation authority, and finalize the prospect only if the claim still belongs to the caller.
6. Commit canonical local audit facts.
7. After commit, invoke existing scoring/routing/automation/enrollment adapters. In CRO-01 tests these are injected fakes/no-ops and provider/queue transports are denied.

Failure injection is required between each durable step. A claim-loss rollback must not leave a committed orphan deal. Concurrent single/batch calls resolving to the same contact must return one deal.

## 9. Required grep/search verification

Pre-build inventory and post-build proof must use `rg` plus surrounding-code inspection:

```text
client array totals/facets:
  rg -n "limit=500|limit=2000|\.length|reduce\(" client/src/pages/dashboard/{Contacts,Prospects,Pipeline,Reporting,ReportingHub,Portfolio}*.tsx

all revenue consumers:
  rg -n "api/(deals|analytics/pipeline|kpi/summary|kpi/pipeline-stats|reporting/operations|acquisition/roi-calculator)" client server
  rg -n "FROM deals|JOIN deals|getDeals\(|getDealsByPipeline\(" server --glob '*.ts'

authority/writer bypass:
  rg -n "insert\(deals\)|UPDATE deals|SET stage|createDeal\(" server --glob '*.ts'
  rg -n "insert\(contacts\)|insert\(prospects\)|contact_id.*prospect" server --glob '*.ts'

authorization:
  rg -n "api/prospects|api/analytics|api/portfolio|isAuthenticated|isDashboardUser|requireRole" server/routes client/src/App.tsx

merchant evidence:
  rg -n "merchant_mids|merchantMids|activated_at|activatedAt|status.*active" server shared

external side effects:
  rg -n "enqueuePromotionalEnrollment|scoreContact|routeContact|generateDealBlueprint|createTask|createNotification|ghl|provider" server/routes/prospects.ts server/services/prospect-conversion.ts
```

Post-build review must prove that changed KPI/aggregate code no longer treats an array length as a global total; all task-owned Pipeline/Reporting reads call the shared predicate; Portfolio has no assignment/any-deal membership fallback; no raw prospect passthrough remains; no new contact/deal/stage/MID writer exists; and no production/GHL/provider/deployment/campaign/outreach mutation was added.

## 10. Test and gate audit

The task’s listed acceptance gates are appropriate after the corrections above. This audit independently verified baseline ancestry, clean isolated status/diff, and migration/journal head.

The TypeScript/`tsx` gates were **not independently rerun in this audit environment** because the isolated worktree had no installed dependencies and the available primary worktree contained only a partial `node_modules`; `npx --no-install` correctly failed before executing the suites. Therefore the draft’s stated 364-check, 60-suite, route-guard, typecheck, and build outcomes remain preflight claims from the submitting agent, not acceptance proof from this audit.

The executor must run and report exit codes for:

- focused static contract/UI tests;
- focused disposable PostgreSQL concurrency/reconciliation tests;
- CI capability manifest and deterministic-static suite;
- migration bootstrap/idempotency and deterministic-integration suite;
- provider/queue-denied isolated server-required suite;
- route guards, API coverage, classification/contact-writer scanners;
- `npm run check`, `npm run build`, migration integrity, and `git diff --check`;
- final status/stat/full diff and exact starting/ending SHA.

No production runtime count or provider evidence is required to merge CRO-01, but none may be claimed from isolated fixtures. Production reconciliation remains a separately authorized, aggregate-only runtime step after exact-SHA deployment.

## 11. Scope and dependency verdict

Task 1699/CRO-01 should proceed next and should not be merged with CRO-02 through CRO-07. It establishes contracts those tasks consume:

- CRO-02 owns classification/provenance remediation and production disposition.
- CRO-03 owns enrichment provider coherence and cost/yield.
- CRO-04 owns qualified outreach eligibility.
- CRO-05 owns broad CRM/GHL/operator reliability, Task 1694, and Task 1695.
- CRO-06 owns campaign/sequence content, preview, rendering, and lifecycle work.
- CRO-07 owns attribution/economics.
- CRO-08 owns deployed exact-SHA runtime certification.

## 12. Final task verdict

**PRE-FLIGHT VERDICT:** BUILD-READY WITH CORRECTIONS  
**MERGE VERDICT:** NOT APPLICABLE — no Task 1699 implementation was audited  
**INSTRUCTION:** Send the controlling correction directive below with the existing task. Do not let the executor mark the task complete while any P0 or P1 correction, required gate, or kill line is red.

## 13. Controlling correction directive for Replit

The following directive is intended to be sent immediately after the existing Task 1699 text. It supersedes conflicting language in that task while preserving all non-conflicting requirements.

---

**TASK 1699 / CRO-01 — AUTHORITATIVE AUDIT CORRECTION**

Proceed in PREFLIGHT + BUILD mode, but do not implement the prior draft literally. Preserve every non-conflicting requirement and apply these corrections as controlling requirements.

1. Recapture `origin/main`; expected audit baseline is `c5d0baa8c697778caccaed4dba74e456c9a07063`, with CRO-00 commit `658fabb95c79c9dc9fd577edc2cf887f67e7deb6` in its ancestry and migration head `0165_outbound_send_claim_lease`. Stop for drift that materially changes ownership or findings.
2. Replace “non-overlapping definitions” with explicit, non-synonymous set relationships. People is the canonical contact population. Lead and Merchant are contact states and may overlap. Prospect Staging is separate. Deal is an opportunity row. Ready for Outreach is an eligibility view.
3. Freeze an executable Lead predicate before editing: one distinct non-archived production contact with at least one non-archived production `sales` deal in a named open-sales stage set. State terminal stages explicitly. Do not reuse `ACTIVE_DEAL_STAGES` unchanged because it mixes onboarding stages and omits sales stages. Count Leads with `COUNT(DISTINCT contact_id)` and define a deterministic primary-deal tie-break for list rows.
4. Repair People count truth as part of CRO-01. The normal contact query currently counts archived contacts while the UI hides them. Move active/archive mode and every displayed search/filter/sort that affects the list into the server predicate before count/pagination. Never label current-page facets as global.
5. Correct the Reporting inventory. The actual overview uses `/api/analytics/pipeline`; ReportingHub also includes Growth, Win/Loss, Operations, Outreach, and Financial tabs. Inventory `/api/analytics/pipeline`, `/api/kpi/summary`, `/api/kpi/pipeline-stats`, `/api/reporting/operations`, and every task-owned Lead/Deal/Merchant count. Route task-owned deal facts through one read authority or explicitly document a consumer as excluded. Pipeline and Reporting must not retain different production/archive/pipeline/ownership predicates.
6. Prospect Staging has no sales-owner field. In CRO-01 make its list/detail/create/update/import/convert surfaces admin/manager-only in both UI and API. Do not treat `conversion_claim_owner_id` as CRM ownership and do not invent agent scope. Replace the passthrough update body with a strict allowlist that blocks conversion/classification/provenance/identity authority fields and unknown keys.
7. Add one focused read authority (for example `server/services/revenue-read-authority.ts`) that owns predicate builders/types for People, Leads, sales Deals, and Merchants. Responses must use `{data,total,limit,offset,filters,scope,asOf}`; facets and totals use the identical predicate and role scope. Use one SQL statement/window count or a read-only repeatable-read transaction so `asOf` has real snapshot meaning.
8. Pipeline’s current `getDealsByPipeline` lacks a production-class filter while Reporting filters production records. Canonical revenue counts must consume existing BT-06 `record_class`; do not implement classification. Exclude non-production rows from canonical counts and expose aggregate-only mismatch buckets by class. Be explicit that counts may be zero until CRO-02 classifies records; do not relabel unknown rows as production.
9. Prospect conversion must call the existing deal creation authority. Extend `server/storage/deals.ts` with a transaction-aware create-or-reuse operation; lock the canonical contact row or an equivalent stable key, reuse one deterministic existing non-archived open sales deal, otherwise create one with linked classification and canonical audit in the same transaction. Use it from both single and batch conversion. Remove the direct `.insert(deals)` bypass and hard-coded display-name owner; use a server-derived email owner or the canonical unassigned policy. Replay/concurrency/stale recovery must return the same contact and deal IDs.
10. Define Merchant exactly as a distinct non-archived production contact with at least one MID where `status='active'` and `activated_at IS NOT NULL`. Portfolio must use that predicate, count distinct contacts, expose active MID count separately, preserve role scope, paginate server-side, and compute its summary from the full predicate. Remove assignment/any-deal fallback.
11. Add an admin/manager-only aggregate reconciliation endpoint with no identities. Required buckets include archived, non-production by class, missing contact, multiple qualifying open deals, invalid stage, active MID without an eligible contact, and legacy assignment/any-deal Portfolio rows. Do not expose cross-agent totals to agents.
12. Align backend and frontend authorization. Reporting is admin/manager-only in the UI but several analytics endpoints are `isDashboardUser`. Restrict them or apply tested agent scope inside every join/count. Hiding links is not authorization. Use privacy-preserving 404s for indirect object denial.
13. Add a stable safe deals failure envelope `{message,code,correlationId}` and log the same correlation ID. Never expose SQL, table/constraint names, contact data, provider payloads, or secrets. Keep broad Pipeline retry UX and dashboard formatter work in CRO-05.
14. Provider denial alone is insufficient for conversion tests. Single and batch conversion currently invoke scoring, routing, blueprint generation, task/notification automation, and promotional-enrollment enqueueing after commit. Inject fakes/no-ops or test the pure transaction service with provider and queue transports denied. Do not change campaign/outreach policy in CRO-01 and do not let tests enqueue real work.
15. Narrow Statements, Applications, Tasks, and GHL to compatibility/read changes directly proven necessary for canonical IDs or counts. Do not absorb task remediation, GHL runtime repair, enrichment, outreach qualification, campaign content, classification remediation, provenance reconstruction, or broad dashboard reliability.
16. Keep migration required = NO. First use contact-row/advisory locking. If a database uniqueness fence is indispensable, stop and report the exact aggregate conflict/backfill consequence before adding migration `0166`; no `db push`, history edit, production migration, dedupe, or backfill.
17. Add non-empty isolated tests for >page-size totals, active/archive modes, all record classes, multi-deal Lead cardinality, primary-deal tie-breaks, Pipeline/Reporting parity, multiple active MIDs, cold Portfolio exclusion, role scope inside counts, strict prospect updates, single/batch conversion parity, replay/concurrency/stale claim/failure injection, safe errors, and denial of every post-commit side effect. Empty or skipped core fixtures fail the suite.
18. Run the full required gates and exact post-build grep inventory. Report commands, exit codes, starting/ending SHA, migration head, status/stat/full diff, P0/P1 completion, kill-line mapping, and isolated-versus-production evidence. Do not merge, deploy, mutate production, call GHL/providers, activate campaigns, or send outreach without explicit authorization.

Additional kill lines:

- STOP if archived People remain counted while hidden.
- STOP if Lead count can duplicate a contact with multiple deals.
- STOP if an undefined or mixed sales/onboarding stage set becomes canonical.
- STOP if Prospect Staging is exposed to agents without a real server-owned authorization field and approved policy.
- STOP if prospect conversion still directly inserts deals, reuses only `New Lead`, hard-codes a display-name owner, or single/batch paths differ.
- STOP if canonical Pipeline/Reporting counts include unknown/test/demo/synthetic records as production.
- STOP if Portfolio counts MIDs instead of distinct merchants or admits assignment/any-deal fallbacks.
- STOP if `asOf` is merely a response timestamp over drifting queries.
- STOP if conversion tests can create task, queue, enrollment, provider, GHL, or outreach side effects.
- STOP if any P0/P1 correction is deferred while the task is marked COMPLETE.

Final status may be `SAFE TO MERGE` only when all task-owned P0/P1 items, focused suites, required static/integration/server gates, post-build searches, diff review, and final VFC rows pass. Production reconciliation and exact-SHA runtime truth must remain explicitly pending unless separately authorized and directly evidenced.

---
