-- REV-06A (Task #1737): Credential Authority Matrix — Probe Results
--
-- This migration records the REV-06A §4a sandbox probe audit log entry.
-- It does NOT insert a new processor_activation_snapshots row, because
-- inserting a 'held' snapshot would supersede the existing owner_confirmed
-- row (the registry uses latest-snapshot-wins) and would revoke the already
-- authorized board_merchant and get_merchant_status operations. The existing
-- activation snapshot remains the authoritative gate.
--
-- PROBE RESULTS (September 2026):
--   ALL candidate REV-06A endpoints returned 401 Unauthorized or 404/405
--   for both PAYARC_API_KEY (partner) and PAYARC_MERCHANT_API_KEY (merchant).
--   No endpoint reached a verified HTTP 2xx. Details:
--
--     GET /accounts/me           PARTNER → 401  MERCHANT → 401
--     GET /charges               PARTNER → 401  MERCHANT → 401
--     GET /batch/reports         PARTNER → 401  MERCHANT → 401
--     GET /batch/reports/details PARTNER → 401  MERCHANT → 401
--     GET /agent/batch/reports   PARTNER → 401  MERCHANT → 401
--     GET /cases                 PARTNER → 401  MERCHANT → 401
--     GET /residuals             PARTNER → 405  MERCHANT → 405 (POST only)
--     GET /applicants            PARTNER → 404  (path deprecated)
--     GET /applications          PARTNER → 401
--     GET /merchants             PARTNER → 401
--     GET /agent/batch/reports/details  PARTNER → 404
--
-- CONSEQUENCE: No new operations are added to supported_operations beyond
-- what was already in the startup seed (board_merchant, get_merchant_status).
-- All REV-06A target operations remain absent from supported_operations and
-- therefore blocked by requireConfirmedActivationSnapshot().
--
-- ACTION REQUIRED: When Payarc provides valid credentials that produce a
-- verified 2xx for each operation, insert a new owner_confirmed snapshot
-- row with exactly those operation strings added to supported_operations.
-- The new row will supersede the current seed and authorize those operations.

INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
VALUES (
  'rev06a_credential_probe_recorded',
  'system',
  0,
  'system',
  jsonb_build_object(
    'task', '1737-REV-06A',
    'probeDate', '2026-09-04',
    'baseUrl', 'https://testapi.payarc.net/v1',
    'summary', 'All candidate REV-06A endpoints returned 401 or 404/405 for both PAYARC_API_KEY (partner) and PAYARC_MERCHANT_API_KEY (merchant). No new operations added to activation snapshot. Existing board_merchant and get_merchant_status authorization preserved.',
    'endpoints', jsonb_build_array(
      jsonb_build_object('path','GET /accounts/me','partner',401,'merchant',401),
      jsonb_build_object('path','GET /charges','partner',401,'merchant',401),
      jsonb_build_object('path','GET /batch/reports','partner',401,'merchant',401),
      jsonb_build_object('path','GET /batch/reports/details','partner',401,'merchant',401),
      jsonb_build_object('path','GET /agent/batch/reports','partner',401,'merchant',401),
      jsonb_build_object('path','GET /cases','partner',401,'merchant',401),
      jsonb_build_object('path','GET /residuals','partner',405,'merchant',405,'note','POST only'),
      jsonb_build_object('path','GET /applicants','partner',404,'note','path deprecated'),
      jsonb_build_object('path','GET /applications','partner',401),
      jsonb_build_object('path','GET /merchants','partner',401)
    ),
    'authorizedNewOps', '[]'::text,
    'boardingOpsPreserved', jsonb_build_array('board_merchant','get_merchant_status')
  ),
  NOW()
)
ON CONFLICT DO NOTHING;
