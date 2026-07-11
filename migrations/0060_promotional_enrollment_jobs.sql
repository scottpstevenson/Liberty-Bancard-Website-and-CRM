-- Durable record for every promotional enrollment trigger event.
-- One row per source_event_id (BullMQ dedup key + idempotency guard).
CREATE TABLE IF NOT EXISTS promotional_enrollment_jobs (
  id                serial PRIMARY KEY,
  source_event_id   text NOT NULL,
  contact_id        integer NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_type      text NOT NULL,
  form_type         text,
  status            text NOT NULL DEFAULT 'pending',
  reason_codes      text[],
  enrollment_ids    integer[],
  attempts          integer NOT NULL DEFAULT 0,
  job_id            text,
  created_at        timestamp NOT NULL DEFAULT now(),
  processed_at      timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS promotional_enrollment_jobs_source_event_id_uidx
  ON promotional_enrollment_jobs (source_event_id);

CREATE INDEX IF NOT EXISTS promotional_enrollment_jobs_contact_id_idx
  ON promotional_enrollment_jobs (contact_id);

CREATE INDEX IF NOT EXISTS promotional_enrollment_jobs_status_idx
  ON promotional_enrollment_jobs (status);
