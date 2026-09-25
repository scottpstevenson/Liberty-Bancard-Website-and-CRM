-- Task #2001 post-merge corrective patch (PM-09): tighten the package-
-- version authority so it cannot become ambiguous.
--
-- 1. One current package per exact vertical (not just "one current row per
--    package_key" — two different package_keys could otherwise both be
--    marked current for the same vertical).
-- 2. Immutable payload columns: package_key, vertical, campaign_id,
--    sequence_id, and content_hash may never change in place once a row
--    exists. Only lifecycle_state, effective_at, superseded_at, notes, and
--    updated_at may be updated. A real "content changed" event must issue a
--    brand-new version row, never mutate an existing one.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'sfp_campaign_package_versions_current_vertical_uidx'
  ) THEN
    CREATE UNIQUE INDEX sfp_campaign_package_versions_current_vertical_uidx
      ON sfp_campaign_package_versions (vertical)
      WHERE lifecycle_state = 'current';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sfp_campaign_package_versions_immutable_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.package_key IS DISTINCT FROM OLD.package_key
     OR NEW.vertical IS DISTINCT FROM OLD.vertical
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.sequence_id IS DISTINCT FROM OLD.sequence_id
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
  THEN
    RAISE EXCEPTION 'sfp_campaign_package_versions payload columns are immutable (package_key, vertical, campaign_id, sequence_id, content_hash) — insert a new version row instead of updating this one (row id: %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sfp_campaign_package_versions_immutable_trg ON sfp_campaign_package_versions;
CREATE TRIGGER sfp_campaign_package_versions_immutable_trg
  BEFORE UPDATE ON sfp_campaign_package_versions
  FOR EACH ROW
  EXECUTE FUNCTION sfp_campaign_package_versions_immutable_guard();
