-- CRO-07 database-enforced immutability for the webhook authorization
-- correlation columns.
--
-- Fixes a code-review finding: provider_account_id/provider_source
-- (0210/0211) were ordinary mutable columns — authorization relied on them
-- by convention only, so a later UPDATE could silently rebind an attempt to
-- a different webhook authority/account. This trigger makes both columns
-- immutable after insert at the database level (not just "nothing writes
-- to it today"), while leaving every other attempt column (state,
-- provider_attempt_id, redacted_error, attempted_at, terminal_at, etc.)
-- fully updatable for the normal claim -> in_flight -> terminal lifecycle.
CREATE OR REPLACE FUNCTION cro07_attempts_correlation_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id THEN
    RAISE EXCEPTION 'cro07_attempts.provider_account_id is immutable after insert';
  END IF;
  IF NEW.provider_source IS DISTINCT FROM OLD.provider_source THEN
    RAISE EXCEPTION 'cro07_attempts.provider_source is immutable after insert';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cro07_attempts_correlation_immutable_trg ON cro07_attempts;
CREATE TRIGGER cro07_attempts_correlation_immutable_trg
  BEFORE UPDATE ON cro07_attempts
  FOR EACH ROW
  EXECUTE FUNCTION cro07_attempts_correlation_immutable();

-- Releases are effectively write-once for their identity/dependency fields
-- (only state/approved_at/revoked_at ever change post-creation via
-- approveCro07Release), but sender_route/provider_source specifically are
-- the source of truth attempts copy their own immutable correlation from —
-- guard them the same way so that authority can never be rewritten either.
CREATE OR REPLACE FUNCTION cro07_releases_correlation_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.sender_route IS DISTINCT FROM OLD.sender_route THEN
    RAISE EXCEPTION 'cro07_releases.sender_route is immutable after insert';
  END IF;
  IF NEW.provider_source IS DISTINCT FROM OLD.provider_source THEN
    RAISE EXCEPTION 'cro07_releases.provider_source is immutable after insert';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cro07_releases_correlation_immutable_trg ON cro07_releases;
CREATE TRIGGER cro07_releases_correlation_immutable_trg
  BEFORE UPDATE ON cro07_releases
  FOR EACH ROW
  EXECUTE FUNCTION cro07_releases_correlation_immutable();
