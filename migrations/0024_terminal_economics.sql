ALTER TABLE equipment_orders
  ADD COLUMN IF NOT EXISTS liberty_cost numeric,
  ADD COLUMN IF NOT EXISTS estimated_monthly_gp numeric,
  ADD COLUMN IF NOT EXISTS payback_months numeric,
  ADD COLUMN IF NOT EXISTS approval_tier text,
  ADD COLUMN IF NOT EXISTS manager_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS approved_by_user_id varchar;
