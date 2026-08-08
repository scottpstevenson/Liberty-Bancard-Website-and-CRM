-- Migration: 0117_contact_nba
-- Next Best Action Engine — contact_nba + nba_recommendation_history tables

-- ---------------------------------------------------------------------------
-- contact_nba: one active NBA per contact (UPSERT on contact_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "contact_nba" (
  "id" serial PRIMARY KEY,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,

  -- The recommended action
  "action_type" text NOT NULL,
  "channel" text,                          -- email | sms | voice_ai | ringless_vm | manual_call | null
  "owner_role" text,                       -- agent | manager | system | null

  -- Timing
  "due_at" timestamp,
  "urgency" text NOT NULL DEFAULT 'normal', -- low | normal | high | critical
  "expires_at" timestamp,

  -- Reasoning
  "reason_code" text NOT NULL,
  "explanation" text,
  "confidence" integer,                    -- 0-100
  "rule_version" text,
  "model_version" text,
  "evidence" jsonb,                        -- snapshot of inputs used to generate

  -- Value signals
  "opportunity_value_cents" integer,
  "automation_eligible" boolean NOT NULL DEFAULT false,
  "human_required" boolean NOT NULL DEFAULT false,

  -- Status lifecycle: OPEN → AUTO_EXECUTED | HUMAN_EXECUTED | DISMISSED | SUPERSEDED | EXPIRED | BLOCKED
  "status" text NOT NULL DEFAULT 'OPEN',

  -- Audit
  "generated_at" timestamp NOT NULL DEFAULT NOW(),
  "executed_at" timestamp,
  "dismissed_at" timestamp,
  "dismissed_by" varchar,
  "updated_at" timestamp NOT NULL DEFAULT NOW(),

  CONSTRAINT "contact_nba_contact_id_unique" UNIQUE ("contact_id")
);

CREATE INDEX IF NOT EXISTS "contact_nba_status_urgency_idx" ON "contact_nba" ("status", "urgency");
CREATE INDEX IF NOT EXISTS "contact_nba_due_at_idx" ON "contact_nba" ("due_at") WHERE "due_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "contact_nba_action_type_idx" ON "contact_nba" ("action_type");

-- ---------------------------------------------------------------------------
-- nba_recommendation_history: audit trail of every superseded recommendation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "nba_recommendation_history" (
  "id" serial PRIMARY KEY,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,

  "action_type" text NOT NULL,
  "channel" text,
  "owner_role" text,
  "due_at" timestamp,
  "urgency" text NOT NULL,
  "expires_at" timestamp,
  "reason_code" text NOT NULL,
  "explanation" text,
  "confidence" integer,
  "rule_version" text,
  "model_version" text,
  "evidence" jsonb,
  "opportunity_value_cents" integer,
  "automation_eligible" boolean NOT NULL DEFAULT false,
  "human_required" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL,
  "generated_at" timestamp NOT NULL,
  "executed_at" timestamp,
  "dismissed_at" timestamp,
  "dismissed_by" varchar,

  -- How / why it was superseded
  "superseded_at" timestamp NOT NULL DEFAULT NOW(),
  "superseded_reason" text
);

CREATE INDEX IF NOT EXISTS "nba_history_contact_id_idx" ON "nba_recommendation_history" ("contact_id");
CREATE INDEX IF NOT EXISTS "nba_history_generated_at_idx" ON "nba_recommendation_history" ("generated_at");
