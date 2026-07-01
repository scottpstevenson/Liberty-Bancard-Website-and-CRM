DO $$
DECLARE dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT website_domain FROM businesses
    WHERE website_domain IS NOT NULL
    GROUP BY website_domain HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create unique index: % duplicate websiteDomain values exist in businesses table. Deduplicate manually before running this migration.', dup_count;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_website_domain_unique_idx
  ON businesses (website_domain) WHERE website_domain IS NOT NULL;
