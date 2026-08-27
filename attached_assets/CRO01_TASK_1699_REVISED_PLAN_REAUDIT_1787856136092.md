# Liberty Bancard — Task 1699 Revised Plan Re-Audit

**Audit date:** 2026-08-27  
**Scope:** Read-only audit of `Pasted markdown(20260827-180729).md` against current `origin/main`  
**Verdict:** **BUILD-READY WITH FINAL CORRECTIONS — DO NOT BUILD FROM THE REVISED PLAN UNTIL THE P0 ADDENDUM IS APPLIED**

## 1. Outcome

The revised task is substantially stronger and correctly incorporates the prior 24-item audit. It preserves the canonical-writer, classification, authorization, concurrency, isolation, migration, and successor-task boundaries.

It is not fully closed yet. Seven remaining P0 ambiguities still allow materially different implementations, including omission of the real Leads UI that was required by the original Task 1699. This re-audit identifies **15 final corrections: 7 P0, 6 P1, and 2 P2**.

No application code, schema, migration, production data, provider, GHL, campaign, outreach, deployment, or remote Git state was changed.

## 2. Repository recapture

| Item | Verified result |
|---|---|
| Current `origin/main` | `c5d0baa8c697778caccaed4dba74e456c9a07063` |
| Commit subject/date | `Add test statement PDF to uploads`, 2026-08-27T16:32:42Z |
| CRO-00 prerequisite | `658fabb95c79c9dc9fd577edc2cf887f67e7deb6` is an ancestor |
| Migration head | `0165_outbound_send_claim_lease`, journal index 169 |
| Primary local worktree | Unrelated modified media assets remain; they were not touched |
| Audit source | Fresh detached worktree at exact `origin/main` |

## 3. Revised-plan VFC

| ID | Revised-plan claim | Verdict | Verified correction |
|---|---|---|---|
| RVFC-01 | The original 24 audit corrections are represented | CONFIRMED, WITH ONE SCOPE LOSS | A01-A24 capture the prior findings, but the original requirement to add a real Leads UI was dropped. |
| RVFC-02 | Lead has an executable definition | PARTIAL | Cardinality and tie-break are defined, but the actual included/excluded stage set is still delegated to the executor. |
| RVFC-03 | People has explicit classification behavior | PARTIAL | The task says classification is “stated,” but does not state whether the default People population includes all classes or production only. |
| RVFC-04 | Prospect Staging authorization is complete | PARTIAL | The task covers `/api/prospects*`, but does not explicitly disposition `/api/prospect-lists*`, several of which remain generically authenticated. |
| RVFC-05 | Prospect route mutation is strict | PARTIAL | Strictness is required but no exact editable allowlist is frozen. Internal services also use `storage.updateProspect`, so route validation must not incorrectly restrict the internal storage authority. |
| RVFC-06 | Deal owner derivation is safe | PARTIAL | “Authenticated server identity when policy permits” could assign a converting manager as the sales owner. Existing contact assignment, conversion actor, and merchant owner email are different identities. |
| RVFC-07 | Single and batch conversion preserve scope | CONTRADICTORY | The task says production keeps current policy but also demands durable and effect parity; current single conversion creates stage-rule tasks/notifications while batch does not. Parity would change production automation policy. |
| RVFC-08 | Transactional deal classification is covered | PARTIAL | `deriveLinkedDealClass` currently reads through the global database handle, not the conversion transaction. The task must require a transaction-aware variant or same-transaction linked-class query. |
| RVFC-09 | Reporting scope is controlled | PARTIAL | Inventory is required, but no mandatory endpoint disposition table is required before edits or in the final evidence. |
| RVFC-10 | Reconciliation buckets are auditable | PARTIAL | The task does not state whether buckets overlap or partition the population, so totals may be misinterpreted. |

## 4. Final required corrections

### P0 — blockers (7)

#### P0-01 — Freeze the open-sales Lead stages in the task

Do not let the executor choose the canonical stage set. Add this controlling constant and test it exactly:

```ts
OPEN_SALES_LEAD_STAGES = [
  "New Lead",
  "Enriched",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Verbal Commit",
  "Promise to Submit",
]
```

Exclude `Nurture / Not Now`, `Closed Won`, and `Closed Lost`. Unknown sales stages are excluded and counted only in an aggregate reconciliation bucket. Do not use mixed `ACTIVE_DEAL_STAGES`.

#### P0-02 — Restore the real Leads UI requirement

The revised plan relabels staging but never requires a real Leads list/page. Freeze this UI contract:

- `/dashboard/contacts-leads` has `People`, `Leads`, and `Prospect Staging` tabs for admin/manager.
- The existing `leads` tab key becomes the real Lead view.
- Prospect Staging uses `tab=prospect-staging`.
- `/dashboard/prospects` redirects to `?tab=prospect-staging`, not to Leads.
- Agents receive a scoped `My Leads` entry/view backed by the same Lead API and SQL owner scope, or the final task must explicitly remove agent Leads UI from Done Looks Like and the authorization matrix. Do not claim agent Leads UX without a route.
- Direct refresh, deep link, back/forward, and legacy redirect behavior are tested.

#### P0-03 — Freeze People classification semantics

People is the operational contact directory and must default to **all non-archived record classes within role scope**, with `filters.recordClass="all"` and aggregate class facets. It must not silently hide current unknown contacts before CRO-02.

Lead, Deal, Merchant, Pipeline revenue aggregates, and canonical Reporting revenue facts remain production-only. Non-production People can be viewed operationally but never counted as canonical revenue state.

#### P0-04 — Complete the Prospect Staging authorization inventory

Apply an explicit matrix rather than a wildcard edit:

- Manager/admin: `GET /api/prospect-lists`, `GET /api/prospect-lists/:id`, `POST /api/prospect-lists`, `GET/POST/PUT /api/prospects...`, import, and normal conversion.
- Admin only: list archive, readiness transition, and readiness override.
- Agent/anonymous: no staging rows, list totals, details, create/update/import/convert, or list existence.
- Preserve the disabled demo-cleanup behavior while preventing it from becoming a staging information leak.
- Do not blanket-change Sunbiz, enrichment, lead-intelligence, or other later-tranche routes merely because they share `server/routes/prospects.ts`.

Also restrict `/dashboard/prospects/import` and every direct Prospect Staging UI/deep link to manager/admin.

#### P0-05 — Freeze the HTTP prospect update allowlist

Use a route-only `.strict()` schema. The editable HTTP fields are:

`companyName`, `dba`, `website`, `phone`, `email`, `ownerFirstName`, `ownerLastName`, `ownerEmail`, `ownerPhone`, `address`, `city`, `state`, `zip`, `vertical`, `estimatedVolume`, `estimatedResidual`, `estimatedAvgTicket`, `estimatedProcessor`, `employeeCount`, `yearEstablished`, `googleRating`, `googleReviews`, `estimatedRevenue`, `notes`, `tags`, `doNotContact`, and `lastContactedAt`.

Reject `id`, list/import lineage, `recordClass`, `contactId`, score/qualification/status/enrichment/AI projections, all conversion claim/recovery fields, timestamps other than the allowlisted contact time, and every unknown key.

Do not replace the broader internal `storage.updateProspect` authority with this HTTP schema; internal enrichment/conversion services legitimately update authority-managed projections.

#### P0-06 — Freeze deal owner derivation

Conversion actor is not sales ownership. Prospect `ownerEmail` is merchant-owner identity and must never become `deals.owner`. A manager performing conversion must not automatically own the deal.

- Reused deal: preserve its current owner.
- New conversion deal: use the canonical contact’s existing `assignedTo` only when it is a valid current employee email allowed by the existing assignment policy; otherwise set `owner = NULL`.
- Do not use the actor’s display name, actor email merely because they clicked Convert, or prospect owner identity.

#### P0-07 — Remove the post-commit parity contradiction

CRO-01 requires durable conversion parity, not a production automation-policy change.

- Single and batch must share the same claim/contact/deal/finalization service and return contract.
- Preserve each route’s current post-commit production policy in this task.
- Extract/inject effect adapters only as needed for test denial and explicit results.
- Do not add single-route stage-rule tasks/notifications to batch or remove them from single in CRO-01.
- Record post-commit policy unification for CRO-04/CRO-05 after outreach/task authority is available.

### P1 — acceptance corrections (6)

#### P1-01 — Make classification derivation transaction-aware

The create-or-reuse path must obtain linked record class inside the same transaction/lock snapshot. Add a transaction-aware variant of the existing classification read or perform the same canonical linked-class query through the supplied transaction. Do not call a global-DB helper and claim the class decision was atomic.

#### P1-02 — Require a Reporting endpoint disposition table

Before editing and again in the final response, list every task-owned consumer with: UI surface, endpoint, current population, canonical population, role scope, disposition (`MIGRATE`, `ADAPT`, or `EXPLICITLY EXCLUDED`), and test. At minimum cover `/api/analytics/pipeline`, `/api/kpi/summary`, `/api/kpi/pipeline-stats`, `/api/reporting/operations`, and `/api/acquisition/roi-calculator`.

#### P1-03 — Freeze route and response contracts

Use one stable real-Leads list route and one reconciliation route; recommended contracts:

- `GET /api/revenue/leads`
- `GET /api/revenue/reconciliation`

Corrected lists return `{data,total,limit,offset,filters,scope,asOf}`. Unsupported filters/sorts return stable 400 codes. Do not create several equivalent Leads endpoints.

#### P1-04 — Define reconciliation bucket semantics

Reconciliation buckets are explicitly **overlapping diagnostic counts** unless named otherwise; they must carry `bucketSemantics:"overlapping"` and must not be summed. Return the scoped base-population totals and exact filter/snapshot metadata needed to interpret them. No IDs or free-form examples.

#### P1-05 — Freeze the narrow deals error contract

For the changed deals list/aggregate routes, return `{message,code,correlationId}` on failures and set the same value in `X-Request-Id`. Generate it server-side when no trusted existing request ID is present. Log route, code, status, and correlation ID without SQL/PII. Do not broaden `serverError` globally unless every caller is audited.

#### P1-06 — Separate code proof from count observations

The final “before/after reconciliation” section must label all numbers as disposable-fixture evidence. CRO-01 is not authorized to read production, so it cannot claim real production count improvement. Production aggregate reconciliation is a later separately authorized exact-SHA runtime row.

### P2 — hardening (2)

1. Name focused suites consistently, register their exact capabilities, and require the final response to prove that zero-fixture/skip paths fail rather than silently pass.
2. Add a short canonical-set contract document or code-adjacent comment that records stage membership, People classification behavior, Lead cardinality, Merchant cardinality, and reconciliation bucket semantics.

## 5. Corrected acceptance matrix

| Requirement | Required evidence | Status before build |
|---|---|---|
| Exact open Lead stages | Named constant and table-driven test | MISSING |
| Real Leads UI/API | Route, tabs, role-aware navigation, API test | MISSING |
| People classification default | Response contract and multi-class fixture | MISSING |
| Complete staging route matrix | Route guards and role/deep-link tests | PARTIAL |
| Strict update allowlist | Route-only strict schema tests | PARTIAL |
| Safe owner policy | Conversion fixture asserting null/existing assignment | PARTIAL |
| Durable single/batch parity | Shared service and concurrency tests | PARTIAL |
| Post-commit policy preservation | Recording effect adapters | CONTRADICTORY |
| Transactional classification | Same-transaction test | PARTIAL |
| Reporting disposition | Pre/post endpoint table | PARTIAL |
| Reconciliation interpretation | Bucket-semantics contract | PARTIAL |

## 6. Grep additions

Add these to the existing search plan:

```text
rg -n "prospect-lists|api/prospects|dashboard/prospects" server/routes/prospects.ts client/src/App.tsx client/src/pages
rg -n "tab=leads|tab=prospect-staging|ContactsAndLeads|ProspectsPage" client/src
rg -n "ownerEmail|assignedTo|owner:.*Scott|conversion.*owner" server/services/prospect-conversion.ts server/routes/prospects.ts server/storage/deals.ts shared/schema.ts
rg -n "deriveLinkedDealClass|db.transaction|tx\." server/services/prospect-conversion.ts server/storage/deals.ts server/services/commercial-classification-authority.ts
rg -n "enqueuePromotionalEnrollment|createTask|createNotification|scoreContact|routeContact|generateDealBlueprint" server/routes/prospects.ts
```

Post-build inspection must prove the route-only update allowlist did not break internal enrichment/conversion writers, the legacy prospect redirect selects Prospect Staging, a real Lead route exists, and conversion actor identity is not used as sales ownership.

## 7. Gate status

This is a plan re-audit, not an implementation audit. Repository ancestry and current code were recaptured. No new Task 1699 diff exists to test. The revised plan’s listed preflight results remain historical preflight evidence; every acceptance gate must be rerun after implementation with installed dependencies and isolated services.

## 8. Final verdict

**PREFLIGHT:** BUILD-READY WITH FINAL CORRECTIONS  
**EXECUTION:** HOLD until P0-01 through P0-07 are inserted as controlling task text  
**MERGE:** NOT APPLICABLE; no Task 1699 implementation was provided  

After the seven P0 corrections are inserted, Task 1699 is sufficiently self-contained to send to the Replit build agent. Preserve all existing revised-plan content that does not conflict with this addendum.
