-- Candidate retrieval optimization only. Uses the unchanged, immutable reviewed
-- normalization; relationship authority and existing lookup keys stay untouched.
-- Production DDL is delivered by owner Publish, never application startup.
CREATE INDEX IF NOT EXISTS canonical_link_business_name_lookup_idx
  ON businesses (crm_identity_name(canonical_name)) WHERE record_class='canonical';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS canonical_link_registry_name_lookup_idx
  ON sunbiz_entities (crm_identity_name(entity_name))
  WHERE filing_number IS NOT NULL AND source IN ('sunbiz','cordata','corevt');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS canonical_link_registry_dba_lookup_idx
  ON sunbiz_entities (crm_identity_name(dba))
  WHERE filing_number IS NOT NULL AND dba IS NOT NULL
    AND source IN ('sunbiz','cordata','corevt');