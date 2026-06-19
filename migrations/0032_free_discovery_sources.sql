-- Free discovery source fields on sdr_merchants
ALTER TABLE sdr_merchants
  ADD COLUMN IF NOT EXISTS bbb_accredited boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sourced_via text;
