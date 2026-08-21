-- BT-06: Commercial Truth Classification
-- Adds record_class to root-subject tables (contacts, deals), appends
-- record_class_at_event to operational event tables (outbound_send_log,
-- statement_upload_commands), and creates the classification event/command
-- tables and aggregate lineage table.
--
-- All existing rows receive 'unknown' by default. No historical data is
-- silently reclassified — promotion to 'production' requires an explicit
-- immutable classification event via CommercialClassificationAuthority.

-- ── 1. Add record_class to root-subject tables ────────────────────────────────

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "record_class" text NOT NULL DEFAULT 'unknown';

ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "record_class" text NOT NULL DEFAULT 'unknown';

ALTER TABLE "prospects"
  ADD COLUMN IF NOT EXISTS "record_class" text NOT NULL DEFAULT 'unknown';

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "record_class" text NOT NULL DEFAULT 'unknown';

-- ── 2. Add record_class_at_event to operational event tables ──────────────────
-- Captured at claim time; immutable once the row exists.

ALTER TABLE "outbound_send_log"
  ADD COLUMN IF NOT EXISTS "record_class_at_event" text NOT NULL DEFAULT 'unknown';

ALTER TABLE "statement_upload_commands"
  ADD COLUMN IF NOT EXISTS "record_class_at_event" text NOT NULL DEFAULT 'unknown';

-- Class-at-event is a historical fact captured by the claim operation. Status
-- and provider results remain mutable; the commercial snapshot must not be.
CREATE OR REPLACE FUNCTION commercial_class_event_snapshot_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_class_at_event IS DISTINCT FROM OLD.record_class_at_event THEN
    RAISE EXCEPTION
      'record_class_at_event is immutable on % rows (id=%).',
      TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS osl_record_class_snapshot_immutable ON "outbound_send_log";
CREATE TRIGGER osl_record_class_snapshot_immutable
  BEFORE UPDATE ON "outbound_send_log"
  FOR EACH ROW EXECUTE FUNCTION commercial_class_event_snapshot_immutable();

DROP TRIGGER IF EXISTS suc_record_class_snapshot_immutable ON "statement_upload_commands";
CREATE TRIGGER suc_record_class_snapshot_immutable
  BEFORE UPDATE ON "statement_upload_commands"
  FOR EACH ROW EXECUTE FUNCTION commercial_class_event_snapshot_immutable();

-- ── 3. Partial indexes for production and unknown projections ─────────────────
-- These support efficient KPI queries that must exclude non-production rows.

CREATE INDEX IF NOT EXISTS "contacts_production_idx"
  ON "contacts" ("id") WHERE "record_class" = 'production' AND "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "contacts_unknown_idx"
  ON "contacts" ("id") WHERE "record_class" = 'unknown' AND "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "deals_production_idx"
  ON "deals" ("id") WHERE "record_class" = 'production';

CREATE INDEX IF NOT EXISTS "deals_unknown_idx"
  ON "deals" ("id") WHERE "record_class" = 'unknown';

CREATE INDEX IF NOT EXISTS "prospects_production_idx"
  ON "prospects" ("id") WHERE "record_class" = 'production';

CREATE INDEX IF NOT EXISTS "companies_production_idx"
  ON "companies" ("id") WHERE "record_class" = 'production';

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. Use catalog guards so a
-- baseline/replay cannot fail after another environment has applied the check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_record_class_check') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_record_class_check"
      CHECK ("record_class" IN ('production', 'test', 'demo', 'synthetic', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_record_class_check') THEN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_record_class_check"
      CHECK ("record_class" IN ('production', 'test', 'demo', 'synthetic', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_record_class_check') THEN
    ALTER TABLE "prospects" ADD CONSTRAINT "prospects_record_class_check"
      CHECK ("record_class" IN ('production', 'test', 'demo', 'synthetic', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_record_class_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_record_class_check"
      CHECK ("record_class" IN ('production', 'test', 'demo', 'synthetic', 'unknown'));
  END IF;
END $$;

-- ── 4. Commercial classification events (append-only) ─────────────────────────
-- Each row is an immutable evidence-backed transition for one subject.
-- (event_namespace, event_key) uniqueness makes events idempotent on replay.

CREATE TABLE IF NOT EXISTS "commercial_classification_events" (
  "id"                serial PRIMARY KEY,
  "subject_type"      text NOT NULL,        -- 'contact' | 'deal' | 'prospect' | 'company'
  "subject_id"        integer NOT NULL,
  "event_namespace"   text NOT NULL,        -- stable namespace for this event source
  "event_key"         text NOT NULL,        -- unique within namespace; enables idempotent replay
  "policy_version"    integer NOT NULL DEFAULT 1,
  "prior_class"       text,                 -- NULL = first classification
  "new_class"         text NOT NULL,        -- 'production' | 'test' | 'demo' | 'synthetic' | 'unknown'
  "evidence_hash"     text,                 -- SHA-256 of allowlisted evidence (no PII)
  -- evidence_fields: allowlisted non-PII key/value pairs describing evidence.
  -- Must NOT contain: SSN, EIN, bank data, email/document bodies, credentials.
  "evidence_fields"   jsonb NOT NULL DEFAULT '{}',
  "actor_id"          text,                 -- who requested the classification
  "approver_id"       text,                 -- who approved (may differ from actor)
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);

-- Idempotency: same event cannot be re-inserted with a different outcome.
CREATE UNIQUE INDEX IF NOT EXISTS "cce_namespace_key_uidx"
  ON "commercial_classification_events" ("event_namespace", "event_key");

-- Fast lookup by subject.
CREATE INDEX IF NOT EXISTS "cce_subject_idx"
  ON "commercial_classification_events" ("subject_type", "subject_id");

-- Append-only guard trigger: prevent UPDATE or DELETE on classification events.
CREATE OR REPLACE FUNCTION commercial_classification_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'commercial_classification_events is append-only: UPDATE/DELETE are not permitted (id=%). '
    'Use a new INSERT to record a reclassification.', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS cce_immutable_guard ON "commercial_classification_events";
CREATE TRIGGER cce_immutable_guard
  BEFORE UPDATE OR DELETE ON "commercial_classification_events"
  FOR EACH ROW EXECUTE FUNCTION commercial_classification_events_immutable();

-- ── 5. Commercial classification commands (preview/approve/execute workflow) ──

CREATE TABLE IF NOT EXISTS "commercial_classification_commands" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key"  uuid NOT NULL UNIQUE,
  "subject_type"     text NOT NULL,
  "subject_id"       integer NOT NULL,
  "target_class"     text NOT NULL,
  "status"           text NOT NULL DEFAULT 'preview',  -- preview | approved | executed | rejected
  "requested_by"     text,
  "approved_by"      text,
  -- evidence_fields mirrors what the resulting event will store.
  "evidence_fields"  jsonb NOT NULL DEFAULT '{}',
  -- Optimistic version locking: stale updates return 409.
  "version_lock"     integer NOT NULL DEFAULT 0,
  "preview_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "approved_at"      timestamp with time zone,
  "executed_at"      timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ccc_subject_idx"
  ON "commercial_classification_commands" ("subject_type", "subject_id");

CREATE INDEX IF NOT EXISTS "ccc_status_idx"
  ON "commercial_classification_commands" ("status");

-- ── 6. Aggregate lineage snapshots ───────────────────────────────────────────
-- Stores metadata for each KPI/metric rebuild so reconciliation can verify
-- that aggregates are built only from classified production inputs.

CREATE TABLE IF NOT EXISTS "commercial_aggregate_lineage" (
  "id"                serial PRIMARY KEY,
  "aggregate_type"    text NOT NULL,        -- 'funnel_metrics' | 'executive_kpi' | 'agent_payouts'
  "aggregate_key"     text NOT NULL,        -- e.g. date string "2026-08-21" or period "2026-08"
  "policy_version"    integer NOT NULL DEFAULT 1,
  "source_row_count"  integer NOT NULL DEFAULT 0,
  "production_count"  integer NOT NULL DEFAULT 0,
  "excluded_count"    integer NOT NULL DEFAULT 0,
  "unknown_count"     integer NOT NULL DEFAULT 0,
  "lineage_hwm"       timestamp with time zone,  -- high-water mark of source data
  "computed_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cal_type_key_idx"
  ON "commercial_aggregate_lineage" ("aggregate_type", "aggregate_key");
