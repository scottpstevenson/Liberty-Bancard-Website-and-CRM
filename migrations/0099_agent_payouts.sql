-- Agent payout ledger: tracks pay periods, amounts due, and disbursements
CREATE TABLE IF NOT EXISTS agent_payouts (
  id SERIAL PRIMARY KEY,
  agent_user_id VARCHAR REFERENCES users(id) NOT NULL,
  partner_user_id VARCHAR REFERENCES users(id),
  period_month TEXT NOT NULL,
  gross_residual TEXT NOT NULL DEFAULT '0',
  agent_share TEXT NOT NULL DEFAULT '0',
  partner_share TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_payouts_agent_period_unique
  ON agent_payouts (agent_user_id, period_month);
