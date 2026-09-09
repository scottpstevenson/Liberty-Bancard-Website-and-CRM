-- 0241_field_sales_routes
-- Door-to-door field sales: routes and stops

CREATE TABLE IF NOT EXISTS field_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id uuid REFERENCES field_route_previews(id),
  territory_id uuid REFERENCES sales_territories(id),
  rep_user_id varchar NOT NULL REFERENCES users(id),
  route_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  frozen_at timestamptz,
  frozen_by_user_id varchar REFERENCES users(id),
  cancelled_at timestamptz,
  cancelled_by_user_id varchar REFERENCES users(id),
  policy_version text NOT NULL,
  stop_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (status IN ('open', 'cancelled'))
);
--> statement-breakpoint

-- At most one active (non-cancelled) route per rep per date
CREATE UNIQUE INDEX IF NOT EXISTS field_routes_one_open_per_rep_date
  ON field_routes (rep_user_id, route_date)
  WHERE status = 'open';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS field_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES field_routes(id),
  business_id integer NOT NULL REFERENCES businesses(id),
  contact_id integer NOT NULL REFERENCES contacts(id),
  planned_order integer NOT NULL,
  record_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  claimed_at timestamptz,
  claimed_by_user_id varchar REFERENCES users(id),
  completed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CHECK (status IN ('available', 'claimed', 'completed', 'released'))
);
--> statement-breakpoint

-- One stop per business per route
CREATE UNIQUE INDEX IF NOT EXISTS frs_one_business_per_route
  ON field_route_stops (route_id, business_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS frs_route_id_idx ON field_route_stops (route_id);
