-- MI-03: canonical_source_links — governed source identifier store per business per registry namespace.
-- Also adds county_fips and license_source_key to business_locations (additive, nullable).

-- ── canonical_source_links ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_source_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       INTEGER NOT NULL REFERENCES businesses(id),
  source_system     TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  stable_key        TEXT NOT NULL,
  registry_id       TEXT REFERENCES source_registry_adapters(adapter_key),
  raw_evidence      JSONB,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cross-registry comparisons are prohibited; uniqueness is scoped per namespace.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canonical_source_links_namespace_key_unique'
  ) THEN
    ALTER TABLE canonical_source_links
      ADD CONSTRAINT canonical_source_links_namespace_key_unique
      UNIQUE (source_system, source_type, stable_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS canonical_source_links_business_id_idx
  ON canonical_source_links (business_id);

CREATE INDEX IF NOT EXISTS canonical_source_links_last_confirmed_at_idx
  ON canonical_source_links (last_confirmed_at);

CREATE INDEX IF NOT EXISTS canonical_source_links_source_system_type_idx
  ON canonical_source_links (source_system, source_type);

-- ── business_locations additive columns ───────────────────────────────────────
ALTER TABLE business_locations
  ADD COLUMN IF NOT EXISTS county_fips         TEXT,
  ADD COLUMN IF NOT EXISTS license_source_key  TEXT;

-- Partial unique index on (business_id, county_fips) for non-null county_fips rows.
-- Enables an atomic ON CONFLICT upsert in projectBusinessOnly() without a
-- SELECT-then-INSERT race. Rows with county_fips IS NULL are excluded (a business
-- may have many unlocated rows; uniqueness is only enforced once a FIPS is known).
CREATE UNIQUE INDEX IF NOT EXISTS business_locations_business_county_fips_unique
  ON business_locations (business_id, county_fips)
  WHERE county_fips IS NOT NULL;
