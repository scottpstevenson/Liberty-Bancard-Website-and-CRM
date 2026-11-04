-- Stage 5 (S5-10): underwriting condition integrity. Additive except the two actor columns.
-- created_by/updated_by were INTEGER while users.id is varchar/UUID, so no real operator id could ever be stored.
-- The only non-null values ever written were CONTACT ids by the auto-initializer (not actors), so they are
-- cleared rather than reinterpreted as actor ids. Real string actor ids are stored from now on.
ALTER TABLE underwriting_conditions ALTER COLUMN created_by TYPE varchar USING NULL;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ALTER COLUMN updated_by TYPE varchar USING NULL;
--> statement-breakpoint
-- Waiver / reversal / supersession evidence (history is preserved, never deleted).
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS waived_by varchar;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS reversed_at timestamp;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS reversed_by varchar;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS reversal_reason text;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS superseded_at timestamp;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS superseded_by varchar;
--> statement-breakpoint
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS superseded_reason text;
--> statement-breakpoint
-- Identity of an auto-initialized standard condition, so initialization is race-safe and fills only missing items.
ALTER TABLE underwriting_conditions ADD COLUMN IF NOT EXISTS automation_key text;
--> statement-breakpoint
UPDATE underwriting_conditions uc SET automation_key = 'std:' || uc.condition_type
FROM (
  SELECT id, row_number() OVER (PARTITION BY deal_id, condition_type ORDER BY id) AS rn
  FROM underwriting_conditions
  WHERE decision_id IS NULL AND automation_key IS NULL
    AND condition_type IN ('merchant_application','processing_agreement','photo_id','voided_check','bank_statements','prior_processing_statements')
) ranked
WHERE uc.id = ranked.id AND ranked.rn = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_uw_conditions_automation_key
  ON underwriting_conditions (deal_id, automation_key) WHERE automation_key IS NOT NULL;
--> statement-breakpoint
-- Durable record of each owed merchant chase channel. A chase skipped under an outbound pause stays 'owed'
-- (never silently dropped) and is retried by the recurring sweep once sending is allowed again.
CREATE TABLE IF NOT EXISTS underwriting_condition_chases (
  id              serial PRIMARY KEY,
  deal_id         integer NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  status          text NOT NULL DEFAULT 'owed',
  recipient_email text,
  recipient_name  text,
  attempts        integer NOT NULL DEFAULT 0,
  last_reason     text,
  last_attempt_at timestamp,
  sent_at         timestamp,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_uw_condition_chases_deal_channel UNIQUE (deal_id, channel),
  CONSTRAINT chk_uw_condition_chases_status CHECK (status IN ('owed','sending','sent','not_applicable'))
);
