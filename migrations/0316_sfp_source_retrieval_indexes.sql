-- Indexed retrieval for contact/source coverage. The expressions deliberately
-- match contact-link-coverage-query.ts: punctuation is tokenized, common legal
-- suffixes are removed, and whitespace is collapsed. Query through equality on
-- these keys; do not join contacts to the full Sunbiz corpus.
CREATE INDEX IF NOT EXISTS sunbiz_entities_contact_identity_name_key_idx
  ON sunbiz_entities (
    btrim(regexp_replace(
      regexp_replace(
        lower(regexp_replace(coalesce(entity_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
        '\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\M', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ))
  )
  WHERE filing_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS sunbiz_entities_contact_identity_dba_key_idx
  ON sunbiz_entities (
    btrim(regexp_replace(
      regexp_replace(
        lower(regexp_replace(coalesce(dba, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
        '\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\M', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ))
  )
  WHERE filing_number IS NOT NULL AND dba IS NOT NULL;