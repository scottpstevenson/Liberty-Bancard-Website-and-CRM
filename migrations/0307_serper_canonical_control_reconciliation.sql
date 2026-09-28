-- Gate 2 (Liberty Bancard enrichment): reconcile the legacy `serper_control`
-- singleton with the canonical `provider_controls` row used by every other
-- paid provider and the admin/lead-ops control surfaces.
--
-- This does NOT discard serper_control's history (lifetime/window counters,
-- call log) and does NOT change today's live-enabled behavior: the canonical
-- row is seeded from whatever serper_control.enabled/state already are right
-- now, so this migration cannot itself turn Serper on or off. From this
-- point forward, server/services/serper-gateway.ts requires BOTH rows to
-- allow a call (see the canonical_control_* block in executeSearch()) — an
-- admin who disables the canonical row (via the same lead-ops panel used for
-- outscraper/openai/apollo/zerobounce) now also stops Serper, and legacy
-- serper_control-only reads (billing-window accounting) are unaffected.
INSERT INTO provider_controls (
  provider, capability, enabled, circuit_state, local_budget_units,
  reserved_units, consumed_units, last_outcome, observed_at, updated_at
)
SELECT
  'serper',
  'business_discovery',
  sc.enabled,
  CASE sc.state
    WHEN 'closed' THEN 'closed'
    WHEN 'open' THEN 'open'
    WHEN 'half_open' THEN 'half_open'
    ELSE 'closed'
  END,
  sc.local_budget,
  0,
  0,
  'reconciled_from_serper_control',
  NOW(),
  NOW()
FROM serper_control sc
WHERE sc.id = 1
ON CONFLICT (provider) DO NOTHING;

-- If serper_control doesn't exist for some reason (should always be present
-- per migration history), still ensure a canonical row exists, defaulting to
-- disabled — fail-closed, matching every other provider's safe default.
INSERT INTO provider_controls (provider, capability, enabled, circuit_state)
VALUES ('serper', 'business_discovery', FALSE, 'closed')
ON CONFLICT (provider) DO NOTHING;
