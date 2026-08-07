-- Day-30 VAS upsell suppression fields on deals
-- Allows reps to opt a merchant out of automatic cross-sell enrollment from the portfolio page.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS vas_upsell_suppressed_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS vas_upsell_suppressed_reason TEXT;
