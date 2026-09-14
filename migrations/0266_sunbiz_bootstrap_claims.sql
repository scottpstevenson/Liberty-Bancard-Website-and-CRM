-- Migration 0266: Sunbiz bootstrap idempotency claims (Task #1956, Step 2)
--
-- Durable claim table keyed on the stable Sunbiz source identity
-- (filing_number). Exactly one claim can ever exist per filing_number
-- (unique index), so a retried or resumed bootstrap batch can never
-- double-materialize a canonical business for the same Sunbiz entity, even
-- when name/domain/phone evidence would have missed the collision.
CREATE TABLE IF NOT EXISTS sunbiz_bootstrap_claims (
  id SERIAL PRIMARY KEY,
  filing_number TEXT NOT NULL,
  sunbiz_entity_id INTEGER REFERENCES sunbiz_entities(id),
  status TEXT NOT NULL DEFAULT 'claimed',
  business_id INTEGER REFERENCES businesses(id),
  deferred_reason_code TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sunbiz_bootstrap_claims_filing_number_unique
  ON sunbiz_bootstrap_claims (filing_number);

CREATE INDEX IF NOT EXISTS sunbiz_bootstrap_claims_status_idx
  ON sunbiz_bootstrap_claims (status);

-- Bounds the bootstrap candidate scan (ORDER BY id LIMIT n over hot/warm rows
-- with a durable filing_number) so a bounded batch stays cheap even against
-- the full ~1.9M-row sunbiz_entities corpus.
CREATE INDEX IF NOT EXISTS sunbiz_entities_hot_warm_filing_idx
  ON sunbiz_entities (id)
  WHERE score IN ('hot', 'warm') AND filing_number IS NOT NULL;
