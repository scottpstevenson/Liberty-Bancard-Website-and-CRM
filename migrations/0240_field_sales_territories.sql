-- 0240_field_sales_territories
-- Door-to-door field sales: do_not_visit flag, territories, assignments, and route previews

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS do_not_visit boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Add 'canonical' to the businesses record_class check constraint
-- (required for field sales eligibility gating: record_class = 'canonical')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'businesses_record_class_check'
      AND conrelid = 'businesses'::regclass
  ) THEN
    ALTER TABLE businesses DROP CONSTRAINT businesses_record_class_check;
  END IF;
  ALTER TABLE businesses ADD CONSTRAINT businesses_record_class_check
    CHECK (record_class IN ('production', 'test', 'demo', 'synthetic', 'unknown', 'canonical'));
END;
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales_territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  criteria jsonb NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  effective_date date,
  expired_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by_user_id varchar REFERENCES users(id),
  frozen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales_territory_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id uuid NOT NULL REFERENCES sales_territories(id),
  agent_user_id varchar NOT NULL REFERENCES users(id),
  is_primary boolean NOT NULL DEFAULT true,
  override_approver_user_id varchar REFERENCES users(id),
  override_reason text,
  override_at timestamptz,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);
--> statement-breakpoint

-- Enforces exactly one primary owner at a time per territory
CREATE UNIQUE INDEX IF NOT EXISTS sta_one_primary_per_territory
  ON sales_territory_assignments (territory_id)
  WHERE ends_at IS NULL AND is_primary = true;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sta_agent_user_id_idx ON sales_territory_assignments (agent_user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS field_route_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id uuid REFERENCES sales_territories(id),
  rep_user_id varchar NOT NULL REFERENCES users(id),
  route_date date NOT NULL,
  created_by_user_id varchar REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
