CREATE TABLE IF NOT EXISTS sunbiz_bootstrap_ledger_events (
  id SERIAL PRIMARY KEY,
  filing_number TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL,
  deferred_reason_code TEXT,
  business_id INT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sunbiz_bootstrap_ledger_events_filing_number_idx
  ON sunbiz_bootstrap_ledger_events (filing_number);
CREATE INDEX IF NOT EXISTS sunbiz_bootstrap_ledger_events_run_id_idx
  ON sunbiz_bootstrap_ledger_events (run_id);