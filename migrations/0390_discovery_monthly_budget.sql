-- New-search liability, not an invoice total. Polling retrieves already-purchased data.
ALTER TABLE discovery_schedules ADD COLUMN monthly_budget_micros integer NOT NULL DEFAULT 50000000;
--> statement-breakpoint
ALTER TABLE discovery_schedules ADD CONSTRAINT discovery_schedules_monthly_budget_check CHECK (monthly_budget_micros BETWEEN 0 AND 50000000);
--> statement-breakpoint
ALTER TABLE discovery_runs ADD COLUMN budget_reserved_micros integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE discovery_runs ADD COLUMN budget_month text;
--> statement-breakpoint
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_budget_check CHECK (budget_reserved_micros >= 0 AND (budget_reserved_micros = 0 OR budget_month IS NOT NULL));
--> statement-breakpoint
CREATE INDEX discovery_runs_budget_month_idx ON discovery_runs(budget_month) WHERE budget_reserved_micros > 0;
