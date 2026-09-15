---
name: ZeroBounce single-spend-path census
description: How the contact-level ZeroBounce spend/budget/receipt path was verified as already-consolidated, and the static census guard that keeps it that way.
---

## Finding
Task #1956 Step 7 asked to consolidate the legacy campaign-engine ZeroBounce path and the CRO03C-governed path so they share one control/budget/receipt/projection gate. Investigation found this was **already true by prior design**: both contact-level spend call sites —
`zerobounce-campaign-worker.ts`'s `processZeroBounceRun` and `routes/contacts.ts`'s `runZbValidationBatch` — already route through `createValidationIntent()` + `processValidationIntent()` in `provider-readiness-control.ts`, which is the sole place that calls the real `verifyEmail()` and mutates `provider_controls` (reserved/consumed units) for `provider='zerobounce'`.

`cro03/business-validation-service.ts` (business-level email validation, different subject type) is intentionally a separate, already-governed path using its own CRO03C authority chain — out of scope for "the two ZeroBounce paths," which refers only to the contact-level legacy-vs-CRO03C paths.

## Guard
`scripts/scan-zerobounce-contact-validation-paths.ts` (ripgrep-based, follows the `scan-serper-raw-fetch.ts` pattern) statically fails the build if:
1. Any file other than `provider-readiness-control.ts` calls `verifyEmail(` directly (excludes comments, test scripts, injected-dependency `deps.verifyEmail(` calls, and other `.verifyEmail(` method calls).
2. `zerobounce-campaign-worker.ts` or `routes/contacts.ts` call the real `verifyEmail()` instead of only accepting it as an injected test dependency.
3. Any file other than `provider-readiness-control.ts` mutates `provider_controls` with a literal `provider = 'zerobounce'` WHERE clause (excludes `scripts/test-*.ts` fixtures, which legitimately seed/reset control rows directly).

**Why:** without this census, a future PR could add a second raw `verifyEmail()` call site or a second raw `provider_controls` writer for zerobounce and silently reintroduce an ungoverned spend path — the same class of bug the DBPR/CRO03C hardening work in this task exists to prevent.

**How to apply:** run this scanner (or extend it) whenever adding a new ZeroBounce contact-validation call site or a new `provider_controls` writer. On this system, ripgrep does not support look-around — match broadly in the regex and filter false positives (comments, test fixtures, dead/disabled endpoints) in JS after the match.
