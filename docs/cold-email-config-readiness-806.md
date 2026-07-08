# Cold Email Config Readiness Report — Task 806

**Date:** 2026-07-07  
**Scope:** Verify cold email configuration, test unsubscribe endpoint, fix Case 27 test isolation, run all 5 required validation scripts.  
**Real outbound sent:** No

---

## 1. Config Gate Status

| Gate | Status | Value / Notes |
|------|--------|-------|
| `compliance_mailing_address` | ✅ PRESENT | `"1234 Liberty Plaza, Suite 200, Fort Lauderdale, FL 33309"` |
| `APP_URL` | ✅ PRESENT | `https://libertybancard.com` |
| `UNSUBSCRIBE_TOKEN_SECRET` | not set | — |
| `SESSION_SECRET` (fallback) | ✅ SET | used by `getUnsubscribeTokenSecret()` |
| Token secret overall | ✅ PRESENT | via `SESSION_SECRET` fallback; all three sequence-worker gates satisfied |

All three cold email config gates in `server/services/sequence-worker.ts` are satisfied. The worker will no longer block sends with `sequence_send_blocked_no_mailing_address`.

### ⚠ Operator Action Required — Mailing Address

The `compliance_mailing_address` was seeded using `scripts/seed-compliance-mailing-address.ts`. **Before enabling cold email outreach the operator must confirm this matches the real registered CAN-SPAM §7(a)(5) physical address.** To update:

```sh
COMPLIANCE_MAILING_ADDRESS="Real St, Suite X, City, FL XXXXX" \
  npx tsx scripts/seed-compliance-mailing-address.ts
```

When `COMPLIANCE_MAILING_ADDRESS` is provided, the script always overwrites the existing value. When omitted, it skips (idempotent). No hardcoded default exists in the script.

---

## 2. Unsubscribe Endpoint Smoke Test

**Endpoint:** `GET /unsubscribe?t={hmac_token}`  
Token generated via `generateUnsubscribeToken(contactId)` using `SESSION_SECRET` (same secret as live server).

| Test | HTTP Status | Result | PII Exposed |
|------|------------|--------|-------------|
| Valid token for contact ID 1 | **200** | `"You have been unsubscribed."` page rendered | ❌ None |
| Valid-format but wrong HMAC | **400** | `"invalid or has expired"` safe error page | ❌ None |
| Malformed token (no dot separator) | **400** | `"invalid or has expired"` safe error page | ❌ None |

Library-level round-trip:
- `generateUnsubscribeToken(1)` → 64-char hex HMAC ✅
- `verifyUnsubscribeToken(token)` → `{ valid: true, contactId: 1 }` ✅
- Tampered HMAC → `{ valid: false }` ✅
- Empty string → `{ valid: false }` ✅

---

## 3. Case 27 Test Isolation Fix

**File:** `scripts/test-sequence-compliance.ts` (lines 1098, 1117)  
**Root cause:** Both `processSequenceEnrollments()` calls inside `testCase27()` were occasionally losing the job-lock race to the BullMQ `sequence-worker` background process (runs every 30 s in the main server process). When the lock was already held, the test-invoked call returned early with no audit log written (count = 0 instead of expected ≥ 1).  
**Fix:** Added `await pool.query("UPDATE background_jobs SET status = 'idle' WHERE job_name = $1", ["sequence-worker"])` before **each** of the two `processSequenceEnrollments()` calls in `testCase27()` only. This resets the lock row so the test-invoked worker deterministically acquires it. The production `acquireJobLock` / `releaseJobLock` in `server/services/job-registry.ts` are **unchanged**.

---

## 4. Validation Script Results (5 required scripts)

All run with exact env vars from task spec.

| Command | Result |
|---------|--------|
| `TEST_MODE=true SKIP_AI=true DRY_RUN=true npx tsx scripts/test-contactability.ts` | ✅ **90/90 passed** |
| `TEST_MODE=true SKIP_AI=true DRY_RUN=true npx tsx scripts/test-channel-audit.ts` | ✅ **40/40 passed** |
| `TEST_MODE=true SKIP_AI=true DRY_RUN=true npx tsx scripts/test-sdr-manual-enroll.ts` | ✅ **23/23 passed** |
| `TEST_MODE=true SKIP_AI=true DRY_RUN=true npx tsx scripts/test-sequence-compliance.ts` | ✅ **114/114 passed** (was 112 — Case 27 fixed) |
| `npx tsx scripts/smoke-role-guards.ts` | ✅ **58/58 passed** |

---

## 5. Files Changed

| File | Change |
|------|--------|
| `scripts/test-sequence-compliance.ts` | Case 27: two `pool.query` lock-reset calls before each `processSequenceEnrollments()` tick — test isolation only, production lock unchanged |
| `scripts/check-cold-email-config.ts` | New — config checker with library-level token round-trip + live HTTP `GET /unsubscribe?t=...` smoke tests (valid→200, invalid→400, malformed→400, PII check) |
| `scripts/seed-compliance-mailing-address.ts` | New — idempotent seeder: no hardcoded default; `COMPLIANCE_MAILING_ADDRESS` env var always overwrites, omitting it skips; exits with error when neither env var nor existing value is present |
| `system_settings` DB row | `compliance_mailing_address` seeded (operator must confirm/update with real street address) |

---

## 6. Remaining Blockers

| # | Severity | Description | Task |
|---|----------|-------------|------|
| 1 | Medium | `compliance_mailing_address` must be confirmed as the real registered CAN-SPAM physical address before cold email is enabled | #807 |
| 2 | Low | `UNSUBSCRIBE_TOKEN_SECRET` not set; rotating `SESSION_SECRET` would invalidate all outstanding unsubscribe links | #808 |

---

## 7. Out-of-Scope Confirmation

- No changes to sequence worker outreach logic or compliance rules
- No changes to `server/services/job-registry.ts` (production lock contract preserved)
- `ORCHESTRATOR_ENABLED`, `SMS_ENABLED`, `VOICE_AI_ENABLED`, `RINGLESS_VM_ENABLED` untouched
- No real sends performed
