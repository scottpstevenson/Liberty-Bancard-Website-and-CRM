-- Task #2000: immutable/versioned SFP outreach policy authority, additive
-- typed candidate lineage on sfp_outreach_eligibility, and safe legacy-row
-- marking. Strictly additive — no existing column is repointed or dropped,
-- no existing row is rewritten except to attach a resolvable legacy policy
-- reference where its historical meaning is provable.

-- ── Policy documents: immutable, versioned, hashed ──────────────────────────
CREATE TABLE IF NOT EXISTS sfp_outreach_policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  document_hash TEXT NOT NULL,
  validation_ttl_days INTEGER NOT NULL,
  accepted_outcomes JSONB NOT NULL,
  retryable_outcomes JSONB NOT NULL,
  role_inbox_policy JSONB NOT NULL,
  consent_tier_policy JSONB NOT NULL,
  reason_codes JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION sfp_reject_policy_document_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SFP_POLICY_DOCUMENT_IMMUTABLE:%', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS sfp_outreach_policy_documents_immutable_trg ON sfp_outreach_policy_documents;
CREATE TRIGGER sfp_outreach_policy_documents_immutable_trg
  BEFORE UPDATE OR DELETE ON sfp_outreach_policy_documents
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_policy_document_mutation();

-- ── Singleton active-policy pointer ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sfp_outreach_policy_control (
  singleton BOOLEAN NOT NULL DEFAULT TRUE,
  active_policy_id UUID NOT NULL REFERENCES sfp_outreach_policy_documents(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by TEXT NOT NULL,
  PRIMARY KEY (singleton)
);

-- Seed policy v1 (30-day TTL). Idempotent: only inserts if version 1 absent.
INSERT INTO sfp_outreach_policy_documents
  (version, document_hash, validation_ttl_days, accepted_outcomes, retryable_outcomes,
   role_inbox_policy, consent_tier_policy, reason_codes, created_by)
SELECT
  1,
  encode(sha256(
    ('{"version":1,"validation_ttl_days":30,"accepted_outcomes":["valid"],'
     || '"retryable_outcomes":["failed","dns_indeterminate","unknown"]}')::bytea
  ), 'hex'),
  30,
  '["valid"]'::jsonb,
  '["failed","dns_indeterminate","unknown"]'::jsonb,
  '{"role_inbox_eligible_for_cold_b2b": true, "named_or_unclassified_requires_review": true}'::jsonb,
  '{"cold_no_consent": "eligible_for_staging_review", "warm_no_pewc": "eligible_for_staging_review", "pewc_full_automation": "eligible_for_staging_review", "opted_out": "ineligible", "do_not_contact": "ineligible"}'::jsonb,
  '["zb_valid_role_inbox_eligible","zb_valid_named_review_required","zb_catch_all_review","zb_invalid_not_deliverable","zb_spamtrap_not_deliverable","zb_abuse_not_deliverable","zb_do_not_mail_not_deliverable","zb_unknown_review_required","zb_transport_failed_retryable","policy_existing_relationship","policy_suppressed","policy_consent_ineligible","policy_dbpr_excluded","policy_stale_reused"]'::jsonb,
  'system:migration_0289'
WHERE NOT EXISTS (SELECT 1 FROM sfp_outreach_policy_documents WHERE version = 1);

INSERT INTO sfp_outreach_policy_control (singleton, active_policy_id, activated_by)
SELECT TRUE, id, 'system:migration_0289' FROM sfp_outreach_policy_documents WHERE version = 1
ON CONFLICT (singleton) DO NOTHING;

-- ── Additive typed lineage + policy pin on sfp_outreach_eligibility ─────────
ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS paid_candidate_evidence_id UUID REFERENCES sfp_paid_candidate_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS normalized_value_hash TEXT,
  ADD COLUMN IF NOT EXISTS policy_document_id UUID REFERENCES sfp_outreach_policy_documents(id),
  ADD COLUMN IF NOT EXISTS policy_document_hash TEXT,
  ADD COLUMN IF NOT EXISTS consent_tier TEXT,
  ADD COLUMN IF NOT EXISTS validation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_provider_status TEXT,
  ADD COLUMN IF NOT EXISTS raw_provider_substatus TEXT,
  ADD COLUMN IF NOT EXISTS reused_from_operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Legacy free-candidate rows: safe, provable association to policy v1 — a
-- row already carries policy_version=1 (SFP_POLICY_VERSION at time of write)
-- and a non-null candidate_id (free lineage). Anything else is left
-- explicitly unresolved (source_kind stays NULL) rather than guessed.
UPDATE sfp_outreach_eligibility e
   SET source_kind = 'free',
       policy_document_id = pd.id,
       policy_document_hash = pd.document_hash
  FROM sfp_outreach_policy_documents pd
 WHERE pd.version = 1
   AND e.policy_version = 1
   AND e.candidate_id IS NOT NULL
   AND e.paid_candidate_evidence_id IS NULL
   AND e.source_kind IS NULL;

-- Exactly one consistent source reference per decision row (once resolved).
ALTER TABLE sfp_outreach_eligibility DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_source_ref_one_of_chk;
ALTER TABLE sfp_outreach_eligibility ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
  source_kind IS NULL
  OR (source_kind = 'free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
  OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL)
);

CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_paid_evidence_idx
  ON sfp_outreach_eligibility (paid_candidate_evidence_id);
CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_normalized_hash_idx
  ON sfp_outreach_eligibility (business_id, normalized_value_hash);
CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_policy_idx
  ON sfp_outreach_eligibility (policy_document_id);

-- ── Freshness-reuse lookup index on provider_observations ───────────────────
CREATE INDEX IF NOT EXISTS provider_observations_business_hash_created_idx
  ON provider_observations (subject_id, email_token_hash, observed_at DESC)
  WHERE subject_type = 'business';

-- ── Snapshot-bound execute idempotency: stored replay result (additive) ─────
-- payload_hash / preview_snapshot_hash already exist on sfp_stage_runs
-- (Task #1999, migration 0288-and-earlier lineage); only the stored replay
-- result payload is new here.
ALTER TABLE sfp_stage_runs
  ADD COLUMN IF NOT EXISTS stored_result JSONB;
