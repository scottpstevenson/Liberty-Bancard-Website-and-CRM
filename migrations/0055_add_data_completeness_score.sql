-- Add data_completeness_score to contacts
-- This is a DATA-READINESS signal (email+phone+name+company+website+vertical present),
-- completely separate from lead_score (behavioral/intent/fit composite).
-- Do NOT use for hot/warm/cold labeling — it is a raw integer 0-100.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_completeness_score integer;

-- Backfill: score every existing contact based on field presence.
-- email present      = 40 pts
-- phone present      = 25 pts
-- company_name       = 15 pts
-- first/last name    = 10 pts
-- website            = 5 pts
-- vertical           = 5 pts
UPDATE contacts
SET data_completeness_score = (
  CASE WHEN email IS NOT NULL AND trim(email) != '' THEN 40 ELSE 0 END +
  CASE WHEN phone IS NOT NULL AND trim(phone) != '' THEN 25 ELSE 0 END +
  CASE WHEN company_name IS NOT NULL AND trim(company_name) != '' THEN 15 ELSE 0 END +
  CASE WHEN (first_name IS NOT NULL AND trim(first_name) != '') OR
            (last_name IS NOT NULL AND trim(last_name) != '') THEN 10 ELSE 0 END +
  CASE WHEN website IS NOT NULL AND trim(website) != '' THEN 5 ELSE 0 END +
  CASE WHEN vertical IS NOT NULL AND trim(vertical) != '' THEN 5 ELSE 0 END
)
WHERE data_completeness_score IS NULL;
