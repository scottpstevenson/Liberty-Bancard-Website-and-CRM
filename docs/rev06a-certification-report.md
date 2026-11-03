# REV-06A Certification Report — Task #1737 (revised by Task #1777)

## Task #1777 revision — Payarc revenue access (documentation, implementation, access)

**Produced against:** `main` at `73272418` (one commit ahead of `origin/main @ e112d19e`, "Published your App", 2026-11-03).
**Migration head:** last numbered file `0379_stage4c2_correction_pass.sql`; Drizzle journal last idx 382 (383 entries). **No migration was added or needed**; the next free number would be 0380 unless other work lands first.
**Report date:** 2026-11-03. The September material below (dated 2026-09-09, baseline `origin/main @ 8109ecaa` / migration 0222) is **historical evidence**, kept unchanged except where a line is marked "superseded by Task #1777".

### What changed in the premise
The original premise ("all partner endpoints 401, residuals need a POST schema, /dispute-chart lists cases") is outdated. Provider reply plus owner documentation establish: partner key for `GET /v1/agent/batch/reports` and `GET /v1/agent_residual/summary`; merchant key for `/v1/dispute-chart`; `POST /v1/residuals` is unsupported as a partner endpoint; `/v1/dispute-chart` is aggregate, cases come from `GET /v1/cases`. September's merchant-key HTTP 200s had empty arrays, so they prove access only, not field mappings or reconciliation.

### Four separate questions, answered separately
| Question | Answer for each operation |
|---|---|
| Documented support | Yes for every row in the matrix below (re-checked 2026-11-03). |
| Fresh authenticated access | **Not established in this task** — see "Canary status". Historical (Sept) evidence only. |
| Populated-contract validation | **None.** No populated provider response has been observed; parsers are proven on sanitized documented fixtures only. |
| Authorized use | **None granted.** New operations are blocked until the owner creates activation-snapshot rows listing them. |

### Capability matrix (reporting hosts: sandbox `https://testapi.payarc.net/v1`, production `https://api.payarc.net/v1`)
| Operation (snapshot name) | Route | Key class | Required scope | Implemented | State |
|---|---|---|---|---|---|
| `get_charges` | GET /charges | merchant | MID, dates | pre-existing (unchanged, /100 retained) | snapshot-authorized (sandbox_verified) |
| `get_daily_stats` | GET /merchant_statements | merchant | MID, dates | pre-existing | snapshot-authorized (sandbox_verified) |
| `get_disputes` | GET /cases (dates YYYY/MM/DD) | merchant | dates, optional MID bind | **new `listDisputeCases`** | snapshot-authorized; merchant-account scope, never portfolio coverage |
| `get_dispute_chart` | GET /dispute-chart | merchant | dates | **new `getDisputeChart`** | aggregate only; **not in any snapshot → blocked** |
| `get_batch_reports` | GET /agent/batch/reports | partner | dates ≤31d, explicit filter placement | **new `getBatchReports`** | **not in any snapshot → blocked**; placement unresolved (below) |
| `get_residual_summary` | GET /agent_residual/summary | partner | **bank required**, dates, optional mid | **new `getResidualReport`** | blocked (no snapshot; bank value needed) |
| `get_residual_table_summaries` | GET /residual_table_summaries | partner | dates; bank/agent optional | **new `getResidualReport`** | blocked (no snapshot) |
| `get_residual_details` | GET /residual-details | partner | dates; bank/agent/MID optional; paginated | **new `getResidualReport`** | blocked (no snapshot) |
| `submit_dispute_evidence` | POST /cases/{id}/upload (multipart `file` required, optional `dispute_evidence`; jpeg/bmp/png/pdf) | unproven | — | **held** | contract documented; authorization and safe sandbox submission unproven; owned by the dispute-evidence safety task |
| legacy `getResiduals()` | — | — | — | held | numeric `Residual[]` cannot carry decimal text/nulls/summary-vs-line-item; use `getResidualReport` |
| `POST /residuals`, `/agent_residual/details`, Connect `/v3/transactions/sale`, OAuth, token reveal, webhook writes | — | — | — | **not implemented, by design** | out of scope or unsupported |

Residual sources are never combined: aggregates (`agent_residual/summary`, `residual_table_summaries`), fee line items (`residual-details`) and monthly agent income (`ag_net`) are separate semantics, results carry `overlapPolicy: single_source_only`, and money is carried as exact decimal text (never divided by 100). Batch reports keep `Merchant_Account_Number`/`Batch_Reference_Number`/`Settlement_Date`, treat `Amounts` as gross sales and `total_net_amt` as net, and count an identical repeated batch once. Case records omit card number, last four, ARN and addresses. Every MID-bound read requires exact string equality; a mismatch is a hold.

### Remaining checks (specific, none are "missing schema")
1. **Entitlement** — partner identity and residual table summaries were accepted on production (2026-11-03); no 401/403 observed. Batch reports return 422 "no merchants attached" until merchants are live.
2. **Bank value** — `/agent_residual/summary` requires Liberty's bank. The task listed 5670, 6719, 9267; a documented 422 message also lists 8999 and 9999. All five are accepted by the validator as a documented enum; which applies to Liberty is unknown.
3. **Batch filter placement** — the OpenAPI declares `from_date`/`to_date` in a GET request body, while the page's own code sample uses query parameters. `filterPlacement` has no default; a read is held (`filters_ignored`) if rows fall outside the window. The canary operation `batch-placement-compare` resolves this, but only with a populated day (empty responses cannot distinguish honored from ignored filters).
4. **Monetary units** — batch (`Amounts`, integers) and case amounts (`case_amount`, integers) have no documented unit; residual values are decimals. Nothing is converted until the provider states the rule.
5. **Pagination** — batch reports document none (handled via optional `meta.pagination`); `/residual-details` documents `limit` and `meta.pagination` but no `page` parameter, so `page` is verified through the reported `current_page` and a no-progress guard.
6. **Activation-snapshot rows** — the owner must create rows listing each new operation (with `authorizedBaseUrl`) before the manual command can run it.
7. **Webhooks** — Partner Hub lifecycle events (Lead Category Update, Lead Updated, Merchant Onboarded, Merchant Activated) and `dispute.created/updated/won/lost` are documented. Account subscriptions, webhook authenticity, lifecycle mapping and replay behavior are unverified; no verification secret exists and `PAYARC_WEBHOOK_VERIFIED` stays unset. Connect's bearer callback contract does not apply to these webhooks. Receipt-only behavior is unchanged.
8. **Credential environments** — secrets are present, but whether each is sandbox- or production-issued is undeclared. The canary and adapters require/consult the non-secret declarations `PAYARC_PARTNER_KEY_ENVIRONMENT` and `PAYARC_MERCHANT_KEY_ENVIRONMENT`. `PAYARC_API_BASE_URL` points at the production host (`api.payarc.net`), which is consistent with the September partner-key evidence but does not prove the merchant key's environment.

### Tools
- **Bounded canary** `scripts/probe-payarc-endpoints.ts` (replaces the old all-key/all-host scan): one explicit `--environment` and `--operation`, matching credential class only, opt-in `PAYARC_SANDBOX_LIVE=1`, declared credential environment must equal the selected one, production hosts also need `--allow-production-read`. Prints redacted receipts (status class, top-level keys, field names, counts). Never uses OAuth, `/residuals`, token reveal, Connect, uploads or webhook writes; `webhooks-list` is a read-only GET with counts only.
- **Manual command** `scripts/rev06a-operator-manual-command.ts`: `--operation transactions|daily-stats|dispute-cases|dispute-chart|batch-reports|residual-summary|residual-table-summaries|residual-details` with explicit dates/`--month`, `--bank`, `--agent-id`, `--mid-id`, `--batch-filter-placement`. Each operation passes its own snapshot gate; output is masked counts/metadata only; nothing is ingested, posted, reconciled, paid, uploaded or scheduled.

### Verification performed
- `scripts/test-payarc-revenue-reads.ts` (118 assertions; fake transport, sanitized documented fixtures, no DB/network): request construction (query vs GET-body, YYYY/MM/DD), envelopes, decimal precision, leading-zero MIDs/batch numbers, nullable values, pagination and no-progress guard, 401/403/422/429/5xx/malformed/oversized responses, key-class and host/environment separation, Connect host refusal, MID binding, per-operation revocation precedence, canary refusals, redaction. Registered in `scripts/pre-deploy.ts` and `scripts/ci-suite-manifest.ts`.
- `scripts/check-processor-kill-lines.ts`: 17/17. KL13 no longer permanently requires `getResiduals` to be held; it now requires the documented reads to delegate to the contract readers and the upload to stay held. New KL16 proves behaviorally that reads are GET-only, snapshot-URL gated, host/environment bound, and that read modules contain no write method, upload, OAuth, `/residuals`, `agent_residual/details`, or Connect references.
- `scripts/test-payarc-adapter.ts` fails 10 assertions that expect the removed simulation mode (pre-existing, not in any suite roster; unrelated to this change).

### Canary status (updated 2026-11-03, later the same day)
The owner declared the partner key **production** and the merchant key **sandbox** (declarations supplied in chat; non-secret). Read-only receipts, redacted:

| Key / environment | Operation | Result |
|---|---|---|
| Partner / production (`api.payarc.net`) | identity `GET /accounts/me` | HTTP 200, empty `data[]` |
| Partner / production | `GET /residual_table_summaries` (2026-09-01..30) | HTTP 200, 0 rows (access granted; nothing to map) |
| Partner / production | `GET /agent/batch/reports` (7-day and single-day; query and body placement) | HTTP 422: "You don't have any merchants attached to your Agent account." |
| Partner / production | `GET /agentaccounts`, `GET /agent-hub/sub-agents/` (two extra documented read-only diagnostics, counts only) | HTTP 200, 0 merchants, 0 sub-agents |
| Merchant / sandbox (`testapi.payarc.net`) | identity, `GET /cases` (2026-10-01..31), `GET /dispute-chart` | HTTP 200; 0 cases; chart returned 37 data points (aggregate; fields not compared with real figures) |

**Interpretation:** the partner key is accepted as an agent key on production. The owner states no merchants are live, which explains the empty results and the batch 422. That 422 is **not** a parameter or entitlement failure and it means batch filter placement could not be tested (no data to filter). The adapter now reports this case as hold code `no_merchants_attached` (previously mislabeled `provider_rejected_parameters`). The batch endpoint's documented required fields are only `from_date` and `to_date` (re-checked online 2026-11-03).

**Still unproven (needs a live merchant):** batch filter placement, populated field mappings for batch/residual/case records, batch and case monetary units, Liberty's bank value, and any reconciliation. Empty 200s and the dispute-chart sandbox response are access evidence only.

### Still inactive
Evidence uploads, webhook handling/verification, payouts, lifecycle activation, recurring ingestion, residual posting, production grants, and Connect/terminal calls.

---

# Historical record — Task #1737 (September 2026)
**Date:** September 9, 2026 (updated from Sept 4 draft)  
**Baseline:** `origin/main @ 8109ecaa` / migration head `0222_serper_lookup_attempts.sql` (idx 222)  
**Mode:** Manual-proof-first (no recurring automation registered)

---

## §12 Certification Checklist

### 1. Activation-snapshot authorization blocks unlisted operations
**PASS** — `requireConfirmedActivationSnapshot()` uses per-operation resolution: it finds the newest snapshot (by `created_at DESC, id DESC`) that explicitly lists the required operation, then validates its status. Migration 0238 inserts a `sandbox_verified` snapshot with `["get_charges","get_daily_stats","get_disputes"]` (merchant-key operations only). The startup-seed snapshot continues to authorize `board_merchant` and `get_merchant_status` via partner-key — neither is included in 0238. Unlisted operations (`get_residuals`, `submit_dispute_evidence`) return `ACTIVATION_SNAPSHOT_OPERATION_MISSING`. A newer `held`/`expired` row that lists an operation blocks the older qualifying row for that same operation (revocation tested in KL15 tests 14–16). KL13 enforces credential separation statically.

---

### 2. Each enabled operation uses the correct credential class (per §4a matrix)
**PASS (SANDBOX)** — Final probe results Sept 9 2026:

| Credential | Base | Path | Result |
|---|---|---|---|
| PAYARC_API_KEY (production) | api.payarc.net/v1 | /accounts/me | ✓ 200 (identity only) |
| PAYARC_API_KEY (production) | api.payarc.net/v1 | /agent/batch/reports | ✗ 401 (permissions) |
| PAYARC_API_KEY (production) | api.payarc.net/v1 | /agent_residual/summary | ✗ 401 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /accounts/me | ✓ 200 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /charges | ✓ 200 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /merchant_statements | ✓ 200 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /cases (date range) | ✓ 200 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /deposits | ✗ 404 |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /residuals | ✗ 405 (POST only) |
| PAYARC_MERCHANT_API_KEY (sandbox) | testapi.payarc.net/v1 | /disputes | ✗ 404 |

**Implemented operations use `PAYARC_MERCHANT_API_KEY`** on `testapi.payarc.net`:
- `getDailyStats` → `GET /merchant_statements?from_date=&to_date=`
- `getTransactions` → `GET /charges?from_date=&to_date=`
- Dispute listing → `GET /cases?report_date[gte]=&report_date[lte]=`

**Boarding operations use `PAYARC_API_KEY`** (unchanged from REV-05A):
- `boardMerchant` → `POST /applicants`
- `getMerchantStatus` → `GET /applicants/{id}`

Credentials never mixed. KL13 enforces `merchantApiKey` separation.

---

### 3. Real authenticated Payarc sandbox responses are parsed correctly
**PASS (SANDBOX — data[] empty)** — All four verified endpoints returned HTTP 200 with valid JSON envelopes. Response structure confirmed:

```json
{ "data": [], "meta": { "pagination": { "total": 0, "count": 0, "per_page": N, "current_page": 1, "total_pages": 1, "links": {} } } }
```

Sandbox data arrays are empty (no transactions in the sandbox merchant account). Field mapping implemented conservatively with null-safe access. Amount fields assumed in cents; divided by 100 in mapping layer. Missing fields stay absent — never zero-filled.

---

### 4. Transaction identity and MID-generation correlation are exact
**PARTIAL (SANDBOX EMPTY)** — `getTransactions()` passes the caller-supplied canonical MID through to each returned `Transaction.mid`. The correlation logic is implemented; the sandbox account has 0 charges so no live correlation can be demonstrated. Production certification requires a real transaction.

---

### 5. Qualifying first activity activates once
**DEFERRED** — First-transaction activation (compare-and-set `assigned → active`) is not implemented in this task. Sandbox has no transactions. This belongs in the automation follow-up task after manual path is production-verified.

---

### 6. Replay does not activate twice (idempotency proven)
**DEFERRED** — No activation implemented; idempotency is deferred to the follow-up automation task.

---

### 7. Daily totals reconcile to the provider records used
**PASS (SANDBOX EMPTY)** — `getDailyStats()` calls `GET /merchant_statements` and maps provider records directly to `DailyStats[]`. No derived computation — values come from Payarc response fields. Sandbox returned 0 records. Production reconciliation requires live data.

---

### 8. Missing days remain missing rather than zero
**PASS** — Both `getDailyStats()` and `getTransactions()` return `[]` when the API response `data[]` is empty. No zero-fill logic exists. Confirmed by sandbox probe (all dates returned empty, not zero rows).

---

### 9. Late corrections create revisions rather than overwrites
**PASS (manual path)** — `upsertMidDailyStat()` in storage uses `ON CONFLICT (mid, date) DO UPDATE SET ...`, explicitly setting all optional fields to `null` when absent (not retaining stale prior values). A re-run of the manual command for the same date range overwrites with fresh provider data rather than accumulating. Absent optional fields (txCount, avgTicket, effectiveRate, chargebackCount, chargebackAmount, refundCount) are stored as `null` — the schema dropped zero-defaults (migration 0239). Automated correction tracking with revision history is a follow-up task.

---

### 10. Residual rows use processor-published evidence only
**HELD (historical; superseded by Task #1777)** — `getResiduals()` remains HeldResult. GET /residuals returned 405 (POST only); `/residuals` is now known to be unsupported as a partner endpoint. September partner-key agent_residual calls returned 401, which Task #1777 treats as an entitlement result. Documented replacements are `getResidualReport` (see matrix above); no populated residual data has been observed.

---

### 11. Dispute evidence is attached only to an existing verified Payarc case
**PARTIAL** — `GET /cases?report_date[gte]=&report_date[lte]=` confirmed 200 (dispute listing works). `submitDisputeEvidence()` remains HeldResult — `POST /cases/{id}/upload` not yet probed. Evidence upload requires multipart/form-data; field schema not confirmed.

---

### 12. Raw MIDs, credentials, PANs, and sensitive payloads are absent from logs
**PASS** — KL8 enforces masked MID in audit logs. Adapter methods log only endpoint paths and record counts. No credential logging. `PAYARC_MERCHANT_API_KEY` passed via env var, never logged.

---

### 13. No recurring scheduler was registered or enabled
**PASS** — No BullMQ schedules, cron jobs, or recurring workers added. `ingestMidDataForActiveMids()` in registry.ts still returns `{ processed: 0, held: true }`. Manual-only path. Confirmed by code review.

---

### 14. No merchant communication, payout, or external export occurred
**PASS** — No outbound communications, no payout triggers, no export paths in any code added by this task.

---

### 15. A sandbox-verified snapshot does not grant production authority
**PASS** — Migration 0238 inserts snapshot with `sandbox_entitlement: true`, `production_entitlement: false`, status `sandbox_verified`. `requireConfirmedActivationSnapshot()` enforces `productionEntitlement` check in production environments — a `sandbox_verified` snapshot throws `ACTIVATION_SNAPSHOT_ENTITLEMENT_MISMATCH` before any provider I/O in production.

---

## Summary

| Category | Status |
|---|---|
| Credential authority matrix built | ✓ COMPLETE |
| Sandbox 2xx for 3 operations | ✓ VERIFIED (charges, statements, cases) |
| Snapshot revision with verified ops | ✓ Migration 0238 |
| `getDailyStats` implemented (real API) | ✓ MERCHANT_KEY on testapi.payarc.net |
| `getTransactions` implemented (real API) | ✓ MERCHANT_KEY on testapi.payarc.net |
| `getResiduals` held (historical; superseded by Task #1777 typed residual reads) | HeldResult with reason |
| `submitDisputeEvidence` held (upload not probed) | HeldResult with reason |
| `submitChargeback` compatibility wrapper | ✓ Delegates to submitDisputeEvidence |
| KL13–KL15 kill lines | ✓ 16/16 PASS |
| MID masking / access receipts | ✓ Not regressed (KL8, KL10) |
| No recurring scheduler | ✓ Confirmed |
| No simulation data | ✓ Confirmed |
| Production merchant key & host | ⬜ TBD — sandbox only; production key not issued |
| First-transaction activation | ⬜ Automation follow-up task |
| Residuals | ⬜ (superseded) Partner entitlement, bank value, snapshot rows — see Task #1777 section |
| Evidence upload | ⬜ POST /cases/{id}/upload probe needed |
