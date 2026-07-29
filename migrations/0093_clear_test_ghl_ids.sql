-- Clear stale test GHL contact IDs that no longer exist in GHL.
-- These were created by QA/webhook test scripts and cause 400 errors
-- on every GHL sync tick, tripping the circuit breaker unnecessarily.
-- Nulling ghl_contact_id lets the sync re-discover the real GHL contact
-- (or create a new one) on the next sync tick.

UPDATE contacts
SET ghl_contact_id = NULL
WHERE ghl_contact_id LIKE 'wh-test-%'
   OR ghl_contact_id LIKE 'unknown-contact-%'
   OR ghl_contact_id LIKE 'test-mock-ghl-%'
   OR ghl_contact_id LIKE 'qa-release-%'
   OR ghl_contact_id LIKE 'qa-appt-%';
