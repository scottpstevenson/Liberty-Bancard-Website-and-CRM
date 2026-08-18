-- Migration 0141: Serper zero-yield cooldown state on sdr_merchants (#1599)
--
-- Adds per-merchant cooldown/backoff columns so zero-yield merchants stop
-- re-entering every Serper enrichment batch, plus an eligibility index.
--
-- Backfill: at migration authoring time (2026-08-17), exactly 251 merchants had
-- website IS NULL AND main_phone IS NULL and had never returned a Serper result.
-- They are seeded into a temporary 7-day cooldown with attempts=1 (we do NOT
-- fabricate historical attempt counts).

ALTER TABLE sdr_merchants ADD COLUMN IF NOT EXISTS last_serper_checked_at TIMESTAMPTZ;
ALTER TABLE sdr_merchants ADD COLUMN IF NOT EXISTS serper_no_result_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sdr_merchants ADD COLUMN IF NOT EXISTS serper_next_eligible_at TIMESTAMPTZ;
ALTER TABLE sdr_merchants ADD COLUMN IF NOT EXISTS serper_last_outcome TEXT;
ALTER TABLE sdr_merchants ADD COLUMN IF NOT EXISTS serper_last_reason_code TEXT;

CREATE INDEX IF NOT EXISTS sdr_merchants_serper_eligibility_idx
  ON sdr_merchants (serper_next_eligible_at, do_not_contact_flag);

-- Backfill the already-zero-yield merchants (251 rows at authoring time) into a
-- 7-day cooldown. Guarded on serper_next_eligible_at IS NULL for idempotency.
UPDATE sdr_merchants
SET serper_next_eligible_at = now() + interval '7 days',
    serper_no_result_attempts = 1,
    serper_last_outcome = 'no_result',
    serper_last_reason_code = 'backfill_zero_yield'
WHERE website IS NULL
  AND main_phone IS NULL
  AND serper_next_eligible_at IS NULL;
