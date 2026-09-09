-- 0242_field_sales_visits
-- Door-to-door field sales: immutable visit records (append-only)

CREATE TABLE IF NOT EXISTS field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  stop_id uuid NOT NULL REFERENCES field_route_stops(id),
  rep_user_id varchar NOT NULL REFERENCES users(id),
  business_id integer NOT NULL REFERENCES businesses(id),
  contact_id integer NOT NULL REFERENCES contacts(id),
  visited_at timestamptz NOT NULL DEFAULT now(),
  outcome_code text NOT NULL,
  note text,
  confirmed boolean NOT NULL DEFAULT false,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fv_stop_id_idx ON field_visits (stop_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS fv_rep_visited_idx ON field_visits (rep_user_id, visited_at);
--> statement-breakpoint

-- Append-only trigger: no UPDATEs or DELETEs permitted (same pattern as audit_logs in 0014)
CREATE OR REPLACE FUNCTION field_visits_append_only()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'field_visits is append-only: UPDATE and DELETE are not permitted';
END; $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_field_visits_no_update ON field_visits;
--> statement-breakpoint

CREATE TRIGGER trg_field_visits_no_update
  BEFORE UPDATE ON field_visits
  FOR EACH ROW EXECUTE FUNCTION field_visits_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_field_visits_no_delete ON field_visits;
--> statement-breakpoint

CREATE TRIGGER trg_field_visits_no_delete
  BEFORE DELETE ON field_visits
  FOR EACH ROW EXECUTE FUNCTION field_visits_append_only();
