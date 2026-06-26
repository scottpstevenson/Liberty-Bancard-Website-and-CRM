-- Add owner contact fields to sdr_merchants (schema/DB drift fix)
ALTER TABLE sdr_merchants
  ADD COLUMN IF NOT EXISTS owner_first_name text,
  ADD COLUMN IF NOT EXISTS owner_last_name text;
