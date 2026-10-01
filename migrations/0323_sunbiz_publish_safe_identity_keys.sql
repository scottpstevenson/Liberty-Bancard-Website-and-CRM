-- Development/disposable migration only. Publish owns production DDL.
-- Keep the prior normalization and partial-index predicates exactly; only
-- move the expressions into generated columns so Publish can serialize them.
ALTER TABLE sunbiz_entities
  ADD COLUMN IF NOT EXISTS contact_identity_name_key text GENERATED ALWAYS AS (
    btrim(regexp_replace(
      regexp_replace(
        lower(regexp_replace(coalesce(entity_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
        '\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\M', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ))
  ) STORED,
  ADD COLUMN IF NOT EXISTS contact_identity_dba_key text GENERATED ALWAYS AS (
    btrim(regexp_replace(
      regexp_replace(
        lower(regexp_replace(coalesce(dba, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
        '\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\M', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ))
  ) STORED;
--> statement-breakpoint
DROP INDEX IF EXISTS sunbiz_entities_contact_identity_name_key_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS sunbiz_entities_contact_identity_dba_key_idx;
--> statement-breakpoint
CREATE INDEX sunbiz_entities_contact_identity_name_key_idx
  ON sunbiz_entities (contact_identity_name_key)
  WHERE filing_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sunbiz_entities_contact_identity_dba_key_idx
  ON sunbiz_entities (contact_identity_dba_key)
  WHERE filing_number IS NOT NULL AND dba IS NOT NULL;