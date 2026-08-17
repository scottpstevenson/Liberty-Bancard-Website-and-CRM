---
name: GHL invalid-contact terminal skip boundary
description: How contact data-quality failures are kept out of the GHL circuit breaker and retry queue
---

- All GHL contact upserts flow through the validated `upsertGhlContact` boundary (ghl.ts): pre-send email/phone identity validation (invalid email + valid phone → phone-only payload; neither → terminal skip with no provider I/O) and known email-validation 422s converted to `GhlInvalidContactError`.
- Terminal codes `ghl_contact_no_usable_identity` / `ghl_contact_email_validation_rejected` classify as "skip" in `classifyGhlSyncError` and must NEVER produce `ghl_sync_failed` audit rows — that action string feeds the failed-contact retry query.
- **Why:** a single contact with a bad email caused GHL 422s classified "retryable", wedging circuit recovery forever; raw 422 bodies also leaked PII into audit logs. Sanitized `ghl_sync_skipped_invalid_contact` audits carry only contactId + reason + stage + retryable:false.
- **How to apply:** any new caller of `upsertGhlContact` must catch `GhlInvalidContactError` as a skip (no retry flag, no failure audit). Half-open probe commits the cursor after EVERY skip, so committed skip progress survives a later provider failure in the same page.
- Unsynced-candidate selection (`getUnsyncedContactsForGhl`) accepts email OR phone — requiring email would starve phone-only contacts.
