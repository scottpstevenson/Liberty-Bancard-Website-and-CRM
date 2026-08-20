-- Canonical consent and reachability facts are immutable. Legacy traces remain
-- readable for migration/support purposes, but may not be mistaken for facts.
CREATE OR REPLACE FUNCTION prevent_canonical_consent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.record_kind IN ('canonical_fact', 'reachability_fact') THEN
    RAISE EXCEPTION 'canonical consent evidence is append-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS consent_audit_append_only_guard ON consent_audit_logs;
CREATE TRIGGER consent_audit_append_only_guard
  BEFORE UPDATE OR DELETE ON consent_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_canonical_consent_audit_mutation();