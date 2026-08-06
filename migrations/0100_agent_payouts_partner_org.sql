-- Migration 0100: Add partner_org_id to agent_payouts
-- Links each payout row to the partner organization that earned the partner share,
-- looked up via the deals associated with the agent's merchant residuals.
ALTER TABLE agent_payouts
  ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id);

CREATE INDEX IF NOT EXISTS agent_payouts_partner_org_idx ON agent_payouts(partner_org_id);
