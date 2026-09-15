-- Task #1971 items 8/9/12: one explicit, fail-closed control row for every
-- paid caller. This only creates disabled rows; it never enables provider I/O.
INSERT INTO provider_controls
  (provider, capability, enabled, circuit_state, local_budget_units, reserved_units, consumed_units, version)
VALUES
  ('serper', 'business_discovery', FALSE, 'closed', NULL, 0, 0, 0),
  ('outscraper', 'business_discovery', FALSE, 'closed', NULL, 0, 0, 0),
  ('openai', 'cro03_classification', FALSE, 'closed', NULL, 0, 0, 0),
  ('apollo', 'contact_enrichment', FALSE, 'closed', NULL, 0, 0, 0),
  ('zerobounce', 'email_validation', FALSE, 'closed', NULL, 0, 0, 0)
ON CONFLICT (provider) DO NOTHING;