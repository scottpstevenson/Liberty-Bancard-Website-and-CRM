-- The subject type + record key is the canonical concurrency fence. The
-- redundant canonical_key uniqueness could win a concurrent insert race before
-- PostgreSQL reached the intended ON CONFLICT target.
DROP INDEX IF EXISTS consent_subjects_canonical_key_uidx;