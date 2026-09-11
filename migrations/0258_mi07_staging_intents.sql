-- MI-07: master_lead_staging_intents — durable outbox for pipeline staging
-- when: 1800000006700

CREATE TABLE IF NOT EXISTS master_lead_staging_intents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_business_id INTEGER NOT NULL REFERENCES businesses(id),
  cro03_generation_id   UUID    NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | consumed | failed
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate pending intents for the same business+generation
CREATE UNIQUE INDEX IF NOT EXISTS master_lead_staging_intents_pending_uidx
  ON master_lead_staging_intents (canonical_business_id, cro03_generation_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS master_lead_staging_intents_status_idx
  ON master_lead_staging_intents (status);

CREATE INDEX IF NOT EXISTS master_lead_staging_intents_business_idx
  ON master_lead_staging_intents (canonical_business_id);
