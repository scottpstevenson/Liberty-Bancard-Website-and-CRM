# Cold Email Config Readiness Report — Task 806

**Date:** 2026-07-07  
**Scope:** Verify cold email configuration, test unsubscribe endpoint, fix Case 27 test isolation, run all 5 required validation scripts.  
**Real outbound sent:** No

---

## 1. Config Gate Status

| Gate | Status | Value / Notes |
|------|--------|-------|
| `compliance_mailing_address` | ✅ PRESENT | `"Liberty Bancard \| Fort Lauderdale, FL 33309"` |
| `APP_URL` | ✅ PRESENT | `https://libertybancard.com` |
| `UNSUBSCRIBE_TOKEN_SECRET` | not set | — |
| `SESSION_SECRET` (fallback) | ✅ SET | used by `getUnsubscribeTokenSecret()` |
| Token secret overall | ✅ PRESENT | via `SESSION_SECRET` fallback; all three sequence-worker gates satisfied |

All three cold email config gates in `server/services/sequence-worker.ts` are satisfied. The worker will no longer block sends with `sequence_send_blocked_no_mailing_address`.

### ⚠ Operator Action Required — Mailing Address

`compliance_mailing_address` was seeded with `"Liberty Bancard | Fort Lauderdale, FL 33309"` because no registered street address exists anywhere in the codebase. **Before enabling cold email outreach, update this to the full CAN-SPAM §7(a)(5) physical postal address** (street + suite + city + state + zip):

```sh
COMPLIANCE_MAILING_ADDRESS="1234 Real St, Suite 100, Fort Lauderdale, FL 33309" \
  npx tsx scripts/seed-compliance-mailing-address.ts
```

Or update via Admin → System Settings in the dashboard.

---

## 2. Unsubscribe Endpoint Smoke Test

**Endpoint:** `GET /unsubscribe?t={hmac_token}`  
Token generated with `SESSION_SECRET` (same secret the live server uses). No `TEST_MODE` override — round-trip uses production path.

| Test | HTTP Status | Response | PII exposed? |
|------|------------|----------|-------------|
| Valid token for contact ID 1 | **200** | `<h2>You have been unsubscribed.</h2>` | ❌ None |
| Valid-format but wrong HMAC | **400** | `<h2>This unsubscribe link is invalid or has expired.</h2>` | ❌ None |
| Malformed token (no dot separator) | **400** | `<h2>This unsubscribe link is invalid or has expired.</h2>` | ❌ None |

Token round-trip (library-level):
- `generateUnsubscribeToken(1)` → valid 64-char hex HMAC ✅  
- `verifyUnsubscribeToken(token)` → `{ valid: true, contactId: 1 }` ✅  
- `verifyUnsubscribeToken("")` → `{ valid: false }` ✅  

---

## 3. Case 27 Test Isolation Fix

**File:** `scripts/test-sequence-compliance.ts` (lines 1098, 1117)  
**Root cause:** `processSequenceEnrollments()` in `testCase27()` was occasionally losing the job-lock race to the BullMQ `sequence-worker` background process (runs every 30 s in the main server). When the lock was held, the direct test call returned early and no audit log was written, causing count = 0.  
**Fix:** Added `await pool.query("UPDATE background_jobs SET status = 'idle' WHERE job_name = $1", ["sequence-worker"])` before **each** of the two `processSequenceEnrollments()` calls in `testCase27()` only. The production `acquireJobLock` / `releaseJobLock` in `server/services/job-registry.ts` are unchanged.

---

## 4. Validation Script Results (5 required scripts)

All run with `TEST_MODE=true SKIP_AI=true DRY_RUN=true` as required.

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
| `scripts/test-sequence-compliance.ts` | Case 27: two `pool.query` lock-reset calls added before each `processSequenceEnrollments()` tick — test isolation only |
| `scripts/check-cold-email-config.ts` | New — standalone config readiness checker with token smoke tests |
| `scripts/seed-compliance-mailing-address.ts` | New — idempotent seeder for `compliance_mailing_address` (accepts env var override) |
| `system_settings` DB row | `compliance_mailing_address` seeded (placeholder; operator must update with real street address) |

---

## 6. Remaining Blockers

| # | Severity | Description |
|---|----------|-------------|
| 1 | Medium | `compliance_mailing_address` is a placeholder — must be updated to a real registered street address before cold email outreach is enabled (see Task #807) |
| 2 | Low | `UNSUBSCRIBE_TOKEN_SECRET` is not set; currently using `SESSION_SECRET` as fallback. If `SESSION_SECRET` is rotated, all outstanding unsubscribe links become invalid. Set a dedicated `UNSUBSCRIBE_TOKEN_SECRET` secret (see Task #808) |

---

## 7. Out-of-Scope Confirmation

- No changes to sequence worker outreach logic or compliance rules
- No changes to `server/services/job-registry.ts` (production lock contract preserved)
- `ORCHESTRATOR_ENABLED`, `SMS_ENABLED`, `VOICE_AI_ENABLED`, `RINGLESS_VM_ENABLED` untouched
- No real sends performed
