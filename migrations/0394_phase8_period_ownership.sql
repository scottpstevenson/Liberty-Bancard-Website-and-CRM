-- Local DB-only periodic work and per-identity daily accounting. No schedules or controls enabled.
CREATE TABLE scheduled_period_receipts (
 job_key text NOT NULL,
 period_key date NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_key,period_key),
 CONSTRAINT scheduled_period_job_check CHECK (job_key IN ('inbox-maintenance','funnel-aggregation'))
);
ALTER TABLE sending_identities ADD COLUMN counter_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/New_York')::date);
-- Preserve existing consumption on upgrade. Normal reservation/maintenance rolls over only an older date.
