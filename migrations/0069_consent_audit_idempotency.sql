-- KL-9: Consent re-enable audit idempotency
-- Ensures replay of the same (contact, submissionId, channel) combination
-- produces exactly one audit row. ON CONFLICT DO NOTHING in the application
-- layer relies on this index being present.
--
-- Pre-apply audit (run manually before applying in production):
-- SELECT contact_id, form_id, channel, COUNT(*)
-- FROM consent_audit_logs
-- WHERE action = 'consent_reenable_blocked'
-- GROUP BY contact_id, form_id, channel
-- HAVING COUNT(*) > 1;
-- (Abort and resolve any duplicates before applying this migration.)

CREATE UNIQUE INDEX IF NOT EXISTS consent_reenable_blocked_event_unique
  ON consent_audit_logs (contact_id, form_id, channel)
  WHERE action = 'consent_reenable_blocked';
