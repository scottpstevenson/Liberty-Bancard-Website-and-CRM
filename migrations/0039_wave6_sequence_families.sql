ALTER TABLE follow_up_sequences
  ADD COLUMN IF NOT EXISTS sequence_family text,
  ADD COLUMN IF NOT EXISTS eligible_consent_tiers text[],
  ADD COLUMN IF NOT EXISTS channels_allowed text[],
  ADD COLUMN IF NOT EXISTS offer_routes text[],
  ADD COLUMN IF NOT EXISTS lifecycle_stages_allowed text[];
