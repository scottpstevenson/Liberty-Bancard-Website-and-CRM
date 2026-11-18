-- One CRM-wide Outscraper allowance. No provider controls or existing ledger rows are changed.
CREATE TABLE outscraper_budget_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
 limit_micros integer NOT NULL DEFAULT 50000000 CHECK (limit_micros BETWEEN 0 AND 50000000),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 maps_price_micros integer NOT NULL DEFAULT 3000 CHECK (maps_price_micros >= 3000),
 maps_quote_expires_at timestamptz NOT NULL DEFAULT '2026-12-18T00:00:00Z',
 maps_quote_evidence text NOT NULL DEFAULT 'Published Google Maps base price, reviewed 2026-11-18: https://outscraper.com/pricing/',
 leads_price_micros integer CHECK (leads_price_micros >= 3000),
 leads_price_unit text CHECK (leads_price_unit IN ('domain','contact')),
 leads_quote_expires_at timestamptz, leads_quote_evidence text,
 updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE outscraper_budget_windows (
 period text PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 legacy_micros bigint NOT NULL DEFAULT 0 CHECK (legacy_micros >= 0),
 unknown_operations integer NOT NULL DEFAULT 0 CHECK (unknown_operations >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE outscraper_budget_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period text NOT NULL REFERENCES outscraper_budget_windows(period),
 service text NOT NULL CHECK (service IN ('maps','leads')),
 state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','dispatched','not_dispatched')),
 maximum_micros integer NOT NULL CHECK (maximum_micros BETWEEN 1 AND 50000000),
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
 price_micros integer NOT NULL CHECK (price_micros >= 3000),
 price_unit text NOT NULL CHECK (price_unit IN ('result','domain','contact')),
 policy_revision integer NOT NULL, request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
 provider_operation_id uuid REFERENCES provider_operations(id), cro03c_operation_id uuid REFERENCES cro03c_stage_operations(id),
 created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz,
 CONSTRAINT outscraper_budget_request_owner_check CHECK (provider_operation_id IS NULL OR cro03c_operation_id IS NULL)
);
--> statement-breakpoint
CREATE INDEX outscraper_budget_requests_period_idx ON outscraper_budget_requests(period,state);
--> statement-breakpoint
CREATE INDEX outscraper_budget_requests_provider_idx ON outscraper_budget_requests(provider_operation_id);
--> statement-breakpoint
CREATE INDEX outscraper_budget_requests_cro03c_idx ON outscraper_budget_requests(cro03c_operation_id);
--> statement-breakpoint
CREATE INDEX provider_operations_outscraper_budget_idx ON provider_operations(created_at) WHERE provider='outscraper';
--> statement-breakpoint
CREATE INDEX cro03c_operations_outscraper_budget_idx ON cro03c_stage_operations(created_at) WHERE provider='outscraper';
