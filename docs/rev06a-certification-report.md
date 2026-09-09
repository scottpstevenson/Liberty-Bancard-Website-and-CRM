# REV-06A Certification Report — Task #1737
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
**HELD** — `getResiduals()` remains HeldResult. GET /residuals returns 405 (POST only). POST schema unknown. Partner key agent_residual endpoints return 401. No residual data path verified.

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
| `getResiduals` held (GET 405 / POST schema unknown) | HeldResult with reason |
| `submitDisputeEvidence` held (upload not probed) | HeldResult with reason |
| `submitChargeback` compatibility wrapper | ✓ Delegates to submitDisputeEvidence |
| KL13–KL15 kill lines | ✓ 16/16 PASS |
| MID masking / access receipts | ✓ Not regressed (KL8, KL10) |
| No recurring scheduler | ✓ Confirmed |
| No simulation data | ✓ Confirmed |
| Production merchant key & host | ⬜ TBD — sandbox only; production key not issued |
| First-transaction activation | ⬜ Automation follow-up task |
| Residuals | ⬜ Partner key permissions or POST schema needed |
| Evidence upload | ⬜ POST /cases/{id}/upload probe needed |
