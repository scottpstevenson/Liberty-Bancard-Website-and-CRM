-- Enforce one active onboarding deal per sales deal at the database level.
-- Partial WHERE clause scopes the constraint to active, linked onboarding deals only;
-- archived deals and manually-created onboarding deals (sales_deal_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS deals_onboarding_sales_deal_unique
  ON deals(sales_deal_id)
  WHERE pipeline = 'onboarding'
    AND archived_at IS NULL
    AND sales_deal_id IS NOT NULL;
