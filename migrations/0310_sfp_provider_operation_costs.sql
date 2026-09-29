-- Preserve the reviewed price used at SFP reservation time so CRM reporting
-- can show exact provider spend without multiplying old unit counts by a
-- possibly different current price. NULL on legacy/non-SFP operations means
-- historical cost is unknown; never fabricate a backfill from today's price.
ALTER TABLE provider_operations
  ADD COLUMN IF NOT EXISTS unit_price_micros BIGINT,
  ADD COLUMN IF NOT EXISTS settled_cost_micros BIGINT;

DO $$ BEGIN
  ALTER TABLE provider_operations
    ADD CONSTRAINT provider_operations_unit_price_nonnegative_chk
    CHECK (unit_price_micros IS NULL OR unit_price_micros >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE provider_operations
    ADD CONSTRAINT provider_operations_settled_cost_nonnegative_chk
    CHECK (settled_cost_micros IS NULL OR settled_cost_micros >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS provider_operations_sfp_cost_idx
  ON provider_operations (provider, created_at)
  WHERE purpose LIKE 'sfp_%';
