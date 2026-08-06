-- Migration 0101: Fix agent_payouts uniqueness model to support per-partner-org rows.
-- Migration 0099 created a unique INDEX (not a named constraint), so we must
-- DROP INDEX, not DROP CONSTRAINT.
DROP INDEX IF EXISTS agent_payouts_agent_period_unique;

-- Two partial unique indexes replace the old one:
--   • rows with no partner org:  unique on (agent_user_id, period_month) WHERE partner_org_id IS NULL
--   • rows with a partner org:   unique on (agent_user_id, period_month, partner_org_id) WHERE partner_org_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS agent_payouts_agent_period_no_partner_unique
  ON agent_payouts (agent_user_id, period_month)
  WHERE partner_org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_payouts_agent_period_partner_unique
  ON agent_payouts (agent_user_id, period_month, partner_org_id)
  WHERE partner_org_id IS NOT NULL;
