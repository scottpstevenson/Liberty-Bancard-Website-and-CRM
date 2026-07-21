-- Migration 0076: Outbound Launch Foundation
-- Adds outbound_send_log (step-level idempotency + provider record)
-- and webhook_event_log (GHL webhook dedup)

-- ── outbound_send_log ─────────────────────────────────────────────────────────
-- One row per touch attempt. idempotency_key = seq-{enrollmentId}-s{stepOrder}
-- guarantees each sequence step is attempted exactly once regardless of worker retries.
CREATE TABLE IF NOT EXISTS outbound_send_log (
  id                      SERIAL PRIMARY KEY,
  idempotency_key         TEXT NOT NULL UNIQUE,
  sequence_id             INTEGER REFERENCES follow_up_sequences(id) ON DELETE SET NULL,
  sequence_enrollment_id  INTEGER REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  contact_id              INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  step_order              INTEGER,
  channel                 TEXT NOT NULL,        -- 'email_gmail' | 'email_ghl' | 'email_smtp' | 'sms_ghl'
  from_address            TEXT,
  to_address              TEXT NOT NULL,
  subject                 TEXT,
  provider_message_id     TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'sent'|'failed'|'skipped'|'bounced'|'delivered'|'complained'
  failure_reason          TEXT,
  next_action_at          TIMESTAMPTZ,
  sent_at                 TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_osl_enrollment ON outbound_send_log(sequence_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_osl_contact    ON outbound_send_log(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_osl_status     ON outbound_send_log(status);
CREATE INDEX IF NOT EXISTS idx_osl_created    ON outbound_send_log(created_at DESC);

-- ── webhook_event_log ─────────────────────────────────────────────────────────
-- One row per processed GHL webhook event.  event_id = SHA-256 of raw body (hex).
-- Prevents double-processing when GHL retries delivery of the same event.
CREATE TABLE IF NOT EXISTS webhook_event_log (
  id              SERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'ghl',
  contact_id      INTEGER,
  ghl_contact_id  TEXT,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_summary  TEXT
);

CREATE INDEX IF NOT EXISTS idx_wel_event_id ON webhook_event_log(event_id);
CREATE INDEX IF NOT EXISTS idx_wel_contact  ON webhook_event_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_wel_type     ON webhook_event_log(event_type, processed_at DESC);
