-- Add sales_deal_id to link an onboarding pipeline deal back to the originating
-- sales deal (set automatically when a deal moves to Closed Won).
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sales_deal_id integer REFERENCES deals(id);
CREATE INDEX IF NOT EXISTS deals_sales_deal_id_idx ON deals(sales_deal_id);
