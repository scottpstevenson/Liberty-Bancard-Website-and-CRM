-- Widen sfp_campaign_package_versions.package_key CHECK constraint to also
-- allow the South Florida v2 taxonomy package keys (5 verticals), alongside
-- the existing legacy v1 five-package keys. Additive only — no existing v1
-- row's package_key value is affected or narrowed.
ALTER TABLE sfp_campaign_package_versions
  DROP CONSTRAINT IF EXISTS sfp_campaign_package_versions_package_key_check;

ALTER TABLE sfp_campaign_package_versions
  ADD CONSTRAINT sfp_campaign_package_versions_package_key_check
  CHECK (package_key IN (
    'sfp.restaurant.v1','sfp.med_spa.v1','sfp.dental.v1','sfp.retail.v1','sfp.auto_repair.v1',
    'sfp.automotive.v2','sfp.healthcare.v2','sfp.beauty_spa.v2',
    'sfp.construction_trades_home_services.v2','sfp.fitness_recreation.v2'
  ));
