-- MI-07: master_lead_staging_receipts + master_lead_generation_batches
-- when: 1800000006800

-- One receipt per business per generation — source of truth for disposition
CREATE TABLE IF NOT EXISTS master_lead_staging_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cro03_generation_id   UUID    NOT NULL,
  canonical_business_id INTEGER NOT NULL REFERENCES businesses(id),
  master_lead_id        UUID    REFERENCES master_leads(id),  -- NULL for duplicate/suppressed
  disposition           TEXT    NOT NULL, -- staged | duplicate | suppressed | failed
  suppression_reason    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS master_lead_staging_receipts_gen_biz_uidx
  ON master_lead_staging_receipts (cro03_generation_id, canonical_business_id);

CREATE INDEX IF NOT EXISTS master_lead_staging_receipts_generation_idx
  ON master_lead_staging_receipts (cro03_generation_id);

CREATE INDEX IF NOT EXISTS master_lead_staging_receipts_master_lead_idx
  ON master_lead_staging_receipts (master_lead_id);

-- Per-generation batch totals derived from receipts at reconciliation time
CREATE TABLE IF NOT EXISTS master_lead_generation_batches (
  id                  SERIAL PRIMARY KEY,
  cro03_generation_id UUID    NOT NULL UNIQUE,
  total_submitted     INTEGER NOT NULL DEFAULT 0,
  staged_count        INTEGER NOT NULL DEFAULT 0,
  duplicate_count     INTEGER NOT NULL DEFAULT 0,
  suppressed_count    INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  reconciled_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS master_lead_generation_batches_generation_idx
  ON master_lead_generation_batches (cro03_generation_id);
