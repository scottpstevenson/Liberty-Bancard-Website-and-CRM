-- MI-07: Partial unique indexes for pipeline master_leads dedup serialization
-- when: 1800000006900
--
-- Prevents two active staged pipeline rows from sharing the same email or phone.
-- Advisory locks in the staging worker and promotion service use these indexes as
-- a DB-level backstop for concurrent-worker races.

-- One active staged pipeline row per email token hash
CREATE UNIQUE INDEX IF NOT EXISTS master_leads_pipeline_email_hash_uidx
  ON master_leads (email_token_hash)
  WHERE pipeline_origin = 'cro03_pipeline'
    AND status NOT IN ('duplicate', 'suppressed')
    AND email_token_hash IS NOT NULL;

-- One active staged pipeline row per normalized phone
CREATE UNIQUE INDEX IF NOT EXISTS master_leads_pipeline_phone_uidx
  ON master_leads (normalized_phone)
  WHERE pipeline_origin = 'cro03_pipeline'
    AND status NOT IN ('duplicate', 'suppressed')
    AND normalized_phone IS NOT NULL;
