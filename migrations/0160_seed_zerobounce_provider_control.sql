-- Safe local control-plane bootstrap. This does not enable traffic or allocate
-- credits; an administrator must set a bounded budget and enable the provider.
INSERT INTO provider_controls
  (provider, capability, enabled, circuit_state, local_budget_units, reserved_units, consumed_units, version)
VALUES
  ('zerobounce', 'email_validation', FALSE, 'closed', NULL, 0, 0, 0)
ON CONFLICT (provider) DO NOTHING;