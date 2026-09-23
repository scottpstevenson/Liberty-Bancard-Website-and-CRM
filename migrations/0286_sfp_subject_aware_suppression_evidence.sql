-- 0286: SFP round-3 correction (item 3) — genuinely subject-aware
-- suppression/bounce evidence on sfp_cohort_decisions.
--
-- Prior columns (suppression_scope, suppression_subject_hash) only ever
-- carried ONE sampled contact's evidence, and that sample's "scope" was
-- inferred from whether its email column happened to be non-null rather
-- than from which predicate actually determined the outcome. This
-- migration adds columns to carry the real authority (which column/rule
-- fired), a canonical reason code, an evidence reference, the affected
-- channel, and the full list of every determining subject — never
-- truncated to a sample.

ALTER TABLE sfp_cohort_decisions
  ADD COLUMN IF NOT EXISTS suppression_authority TEXT,
  ADD COLUMN IF NOT EXISTS suppression_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS suppression_evidence_ref TEXT,
  ADD COLUMN IF NOT EXISTS suppression_channel TEXT,
  ADD COLUMN IF NOT EXISTS suppression_subjects JSONB,
  ADD COLUMN IF NOT EXISTS suppression_business_wide_rule_applied BOOLEAN NOT NULL DEFAULT FALSE;
