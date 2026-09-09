-- REV-06A (Task #1737): New activation snapshot — sandbox-verified merchant operations
--
-- PROBE RESULTS (Sept 9 2026 — after PAYARC_MERCHANT_API_KEY sandbox token set):
--   Host: testapi.payarc.net/v1
--   Credential: PAYARC_MERCHANT_API_KEY (sandbox merchant token)
--
--   GET /accounts/me                                    → 200 ✓
--   GET /charges?limit=N&page=P                        → 200 ✓ (pagination confirmed)
--   GET /merchant_statements?from_date=&to_date=       → 200 ✓ (pagination confirmed)
--   GET /cases?report_date[gte]=&report_date[lte]=     → 200 ✓ (pagination: per_page=25)
--   GET /deposits                                       → 404 ✗ (route not found)
--   GET /residuals                                      → 405 ✗ (POST only)
--   GET /disputes                                       → 404 ✗ (route not found)
--
--   Partner key (PAYARC_API_KEY) on testapi.payarc.net → 401 (production key, wrong env)
--   Partner key (PAYARC_API_KEY) on api.payarc.net     → 200 on /accounts/me only
--
-- This migration inserts a NEW activation snapshot row with status=sandbox_verified.
-- It does NOT mutate the startup seed.
--
-- SNAPSHOT SCOPE — merchant-key operations only (PAYARC_MERCHANT_API_KEY):
--   get_charges, get_daily_stats, get_disputes.
--
-- Boarding operations (board_merchant, get_merchant_status) are intentionally EXCLUDED.
-- They use the partner key (PAYARC_API_KEY) and are authorized by the startup-seed snapshot.
-- requireConfirmedActivationSnapshot resolves per-operation: for each operation it finds the
-- newest snapshot that explicitly lists that operation, then validates its status. A newer
-- snapshot that omits "board_merchant" does not supersede the boarding authorization; a newer
-- snapshot that lists an operation as held/expired actively revokes it.
--
-- IMPORTANT: authorized_base_url is the MERCHANT API sandbox host (testapi.payarc.net/v1).
-- This is where PAYARC_MERCHANT_API_KEY is verified.

INSERT INTO processor_activation_snapshots (
  processor_name,
  processor_program,
  sandbox_entitlement,
  production_entitlement,
  authorized_base_url,
  supported_operations,
  owner_confirmed_at,
  owner_confirmed_by,
  status,
  notes
) VALUES (
  'payarc',
  'traditional',
  true,
  false,
  'https://testapi.payarc.net/v1',
  '["get_charges","get_daily_stats","get_disputes"]'::jsonb,
  NOW(),
  'system-rev06a',
  'sandbox_verified',
  'REV-06A sandbox probe completed Sept 9 2026. Verified: GET /charges (MERCHANT_KEY), GET /merchant_statements (MERCHANT_KEY), GET /cases with date range (MERCHANT_KEY). All on testapi.payarc.net/v1. Boarding operations (board_merchant, get_merchant_status) are intentionally excluded — they use PAYARC_API_KEY (partner key) and are authorized by the earlier startup-seed snapshot. Registry resolves per-operation so boarding is unaffected. Production operations held — no production merchant key issued yet. Residuals (POST-only) and dispute evidence upload not yet verified.'
);

-- Record the updated probe audit log
INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
VALUES (
  'rev06a_sandbox_merchant_key_verified',
  'system',
  0,
  'system',
  jsonb_build_object(
    'task', '1737-REV-06A',
    'probeDate', '2026-09-09',
    'credential', 'PAYARC_MERCHANT_API_KEY (sandbox)',
    'host', 'testapi.payarc.net/v1',
    'verifiedEndpoints', jsonb_build_array(
      jsonb_build_object('path', 'GET /accounts/me', 'status', 200),
      jsonb_build_object('path', 'GET /charges', 'status', 200, 'pagination', 'limit/page'),
      jsonb_build_object('path', 'GET /merchant_statements', 'status', 200, 'params', 'from_date/to_date'),
      jsonb_build_object('path', 'GET /cases', 'status', 200, 'params', 'report_date[gte]/report_date[lte]')
    ),
    'heldEndpoints', jsonb_build_array(
      jsonb_build_object('path', 'GET /deposits', 'status', 404, 'reason', 'route not found'),
      jsonb_build_object('path', 'GET /residuals', 'status', 405, 'reason', 'POST only — GET not supported'),
      jsonb_build_object('path', 'GET /disputes', 'status', 404, 'reason', 'route not found'),
      jsonb_build_object('path', 'POST /cases/{id}/upload', 'status', 'NOT_PROBED', 'reason', 'evidence upload pending'),
      jsonb_build_object('path', 'GET /agent/batch/reports', 'status', 401, 'reason', 'partner key permissions')
    ),
    'newSnapshot', 'sandbox_verified — operations: get_charges, get_daily_stats, get_disputes (merchant-key only; board_merchant and get_merchant_status remain in the startup-seed snapshot)',
    'productionStatus', 'held — no production merchant key issued, ap1.payarc.net ERR'
  ),
  NOW()
)
ON CONFLICT DO NOTHING;
