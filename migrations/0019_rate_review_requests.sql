CREATE TABLE IF NOT EXISTS rate_review_requests (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  deal_id INTEGER REFERENCES deals(id),
  document_id INTEGER REFERENCES documents(id),
  status TEXT DEFAULT 'requested',
  analysis_result JSONB,
  is_optimal_pricing BOOLEAN,
  request_notes TEXT,
  rep_viewed_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_review_requests_contact_id_idx ON rate_review_requests(contact_id);
CREATE INDEX IF NOT EXISTS rate_review_requests_status_idx ON rate_review_requests(status);
CREATE INDEX IF NOT EXISTS rate_review_requests_created_at_idx ON rate_review_requests(created_at);
