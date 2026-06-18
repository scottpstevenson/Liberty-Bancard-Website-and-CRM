-- Underwriting rules config table (singleton row, seeded with defaults)
CREATE TABLE IF NOT EXISTS underwriting_rules (
  id SERIAL PRIMARY KEY,
  min_monthly_volume NUMERIC NOT NULL DEFAULT 5000,
  max_monthly_volume NUMERIC NOT NULL DEFAULT 500000,
  effective_rate_ceiling NUMERIC NOT NULL DEFAULT 3.5,
  chargeback_rate_limit NUMERIC NOT NULL DEFAULT 1.0,
  chargeback_rate_hard_limit NUMERIC NOT NULL DEFAULT 2.0,
  volume_hard_deviation_pct NUMERIC NOT NULL DEFAULT 50,
  allowed_processors TEXT[],
  blocked_processors TEXT[],
  auto_approve_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed a single default config row
INSERT INTO underwriting_rules (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Per-deal underwriting decision log
CREATE TABLE IF NOT EXISTS underwriting_decisions (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id),
  decision TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT[],
  rules_snapshot JSONB,
  decided_at TIMESTAMP DEFAULT NOW(),
  overridden_by TEXT,
  overridden_at TIMESTAMP,
  override_action TEXT,
  override_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS underwriting_decisions_deal_id_idx ON underwriting_decisions(deal_id);
CREATE INDEX IF NOT EXISTS underwriting_decisions_decision_idx ON underwriting_decisions(decision);
CREATE INDEX IF NOT EXISTS underwriting_decisions_created_at_idx ON underwriting_decisions(created_at);
