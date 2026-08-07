---
name: Wave merge audit findings
description: Bugs found in Waves 2-6 merged code, all fixed before publish
---

# Wave 2–6 Post-Merge Audit Findings (2026-08-07)

## Rule
After any task-agent wave merge, run the compliance scan standalone BEFORE the full gate — it catches new email call sites faster.

## Bugs fixed

### lifecycle.ts — admin endpoints lacked role guards
12 endpoints (NPS, review-requests, merchant-referrals, retention-campaign-configs) used only `isAuthenticated`, allowing any authenticated user (including merchants) to read/mutate admin data. Added `isDashboardUser, requireRole("admin", "manager")` to all admin-only endpoints. Merchant portal routes kept `isAuthenticated`.

**Why:** Any authenticated user could enumerate NPS scores, referral credits, and retention configs.

### lifecycle.ts — raw err.message leaked in catch blocks
6 catch blocks returned `res.status(400).json({ message: err.message })` instead of `serverError(res, err)`. Fixed all to use serverError.

### virtual-terminal.ts — CSV escaping incomplete
Only the `memo` field double-escaped quotes; all other fields (cardholderName, authCode, etc.) were wrapped in quotes without escaping embedded quotes/newlines, producing malformed CSV. Fixed: `csvEscape` helper applied to all fields.

### shared/analytics-events.ts — PEWC_CHECKED and PEWC_UNCHECKED identical
Both exported the same string `"consent_field_interaction"`, losing checked-vs-unchecked distinction. Fixed: PEWC_CHECKED → `"consent_field_checked"`, PEWC_UNCHECKED → `"consent_field_unchecked"`.

### pipeline-silence-check.ts — cooldown recorded even on email failure
`cooldownMap[stageKey]` was set after the try/catch, so a failed email send would still suppress retries for 24h. Fixed: moved inside the try block, only set on successful send.

### pipeline-silence-check.ts — HTML injection in alert email
Stage/pipeline names interpolated raw into HTML. Fixed: inline `escHtml` helper escapes `&`, `<`, `>`. Note: `escHtml` inside the email HTML block is detected by the compliance scanner — added allowlist entry for `sendSmtpEmail` in pipeline-silence-check.ts.

## Compliance scan — two new allowlist entries required
Every wave that ships new email send sites WILL fail the compliance scanner. Pattern:
1. Run `npx tsx scripts/compliance-scan.ts` first to see exactly what's failing
2. Check `lineContains` must match text on the EXACT flagged line (not the subject/template string)
3. Add to `CALL_SITE_ALLOWLIST` in `scripts/compliance-scan.ts` with accurate `lineContains`

New entries added:
- `server/services/pipeline-silence-check.ts` | `lineContains: "sendSmtpEmail"` | internal_admin
- `server/routes/partner-orgs.ts` | `lineContains: "await sendSmtpEmail"` | transactional_merchant

## Pre-deploy workflow timing
The `pre-deploy` workflow fires before the server is fully ready and always reports "Server not reachable". Run the gate directly: `GHL_TEST_MODE=true npx tsx scripts/pre-deploy.ts`. Final result: 19/19 passed.
