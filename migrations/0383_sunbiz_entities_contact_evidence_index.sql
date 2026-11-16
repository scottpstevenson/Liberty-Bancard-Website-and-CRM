-- Registry evidence index. The enrichment backlog counts the state registry records that carry a website or an email
-- (about 40,000 of 1.9 million). With no index that count read the whole 1.4 GB table every time, which took 12 to 25
-- seconds when the disk cache was cold. This partial index holds only those rows, so the same count reads a few
-- thousand pages instead. Additive and read-only in effect: no data changes, nothing is enabled, nothing is sent.
-- The predicate is deliberately the plain null test (not the trimmed-blank form) so the schema diff can carry it intact.
CREATE INDEX IF NOT EXISTS sunbiz_entities_contact_evidence_idx
  ON sunbiz_entities (filing_number)
  WHERE website IS NOT NULL OR email IS NOT NULL;
