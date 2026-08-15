---
name: ZeroBounce validation safety
description: Canonical unvalidated-email predicates and provider-failure guards for email validation
---
- `UNVALIDATED_EMAIL_PREDICATE` and `VALID_EMAIL_ELIGIBILITY` (exported from server/routes/contacts.ts) are the ONLY allowed sources for "needs validation" SQL; hand-written copies caused the #1533 'unvalidated' regression.
- **Why:** email_status default changed 'active'→'unvalidated'; any filter matching only NULL/'active' silently skips new contacts.
- verifyEmail() encodes failures as `skipped:true` or `reason` set; a result with either must never be written to contacts.email_status (`isRetryableZbFailure`). Only completed provider decisions write status.
- Missing ZEROBOUNCE_API_KEY must be preflighted BEFORE claimZeroBounceCredit(); otherwise a misconfigured batch burns the whole daily cap with zero provider calls.
- Synthetic placeholder emails (`no-email-%`, `%.internal` from CSV import) must be excluded before credit claim; `isPlaceholderEmail()` guards this.
- Explicit contactIds from API callers must be deduplicated and re-checked against eligibility SQL (`resolveZbExplicitCandidates`), not trusted.
- **How to apply:** any new validation entry point (1540B durable campaign etc.) should reuse `runZbValidationBatch` with injected deps; tests inject fake verifyEmail/claimCredit — never real HTTP.
