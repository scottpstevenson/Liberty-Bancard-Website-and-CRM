-- C6: named-person policy eligibility is a separate append-only decision.
-- It never changes the ZeroBounce result, held-intent review, or send authority.
CREATE TABLE sfp_named_email_eligibility_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eligibility_id UUID NOT NULL REFERENCES sfp_outreach_eligibility(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  idempotency_key TEXT NOT NULL UNIQUE,
  expected_updated_at TIMESTAMPTZ NOT NULL,
  policy_document_id UUID NOT NULL REFERENCES sfp_outreach_policy_documents(id) ON DELETE RESTRICT,
  policy_document_hash TEXT NOT NULL,
  validation_operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('free', 'paid', 'contact')),
  source_reference_id TEXT NOT NULL,
  contact_business_link_decision_id UUID REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  contact_business_link_revision INTEGER,
  normalized_value_hash TEXT NOT NULL,
  normalized_value_hash_version INTEGER NOT NULL CHECK (normalized_value_hash_version IN (0,1)),
  validation_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source_kind = 'contact' AND contact_business_link_decision_id IS NOT NULL AND contact_business_link_revision IS NOT NULL)
      OR (source_kind IN ('free','paid') AND contact_business_link_decision_id IS NULL AND contact_business_link_revision IS NULL))
);
CREATE INDEX sfp_named_email_reviews_eligibility_idx
  ON sfp_named_email_eligibility_reviews (eligibility_id, created_at DESC);
CREATE UNIQUE INDEX sfp_named_email_reviews_snapshot_uidx
  ON sfp_named_email_eligibility_reviews (eligibility_id, expected_updated_at);

CREATE FUNCTION sfp_named_email_reviews_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sfp_named_email_eligibility_reviews is append-only';
END;
$$;
CREATE TRIGGER sfp_named_email_reviews_append_only_trg
  BEFORE UPDATE OR DELETE ON sfp_named_email_eligibility_reviews
  FOR EACH ROW EXECUTE FUNCTION sfp_named_email_reviews_append_only();