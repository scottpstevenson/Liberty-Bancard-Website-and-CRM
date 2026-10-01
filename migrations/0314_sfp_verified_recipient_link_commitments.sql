-- SFP-specific typed CRM link evidence, transactionally pinned initial
-- recipient commitments, and item-level bridge holds. This migration is
-- additive. Publish must install its SQL functions and triggers as well as
-- the table/column diff before either SFP link authority is enabled.

CREATE TABLE contact_business_sfp_link_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_key text NOT NULL UNIQUE,
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  eligibility_id uuid NOT NULL REFERENCES sfp_outreach_eligibility(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  free_candidate_id uuid REFERENCES free_discovery_candidates(id) ON DELETE RESTRICT,
  paid_candidate_evidence_id uuid REFERENCES sfp_paid_candidate_evidence(id) ON DELETE RESTRICT,
  normalized_value_hash text NOT NULL,
  normalized_value_hash_version integer NOT NULL,
  contact_email_token_hash text NOT NULL,
  validation_operation_id uuid NOT NULL REFERENCES provider_operations(id) ON DELETE RESTRICT,
  facts_hash text NOT NULL,
  facts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_business_sfp_link_evidence_source_chk CHECK (
    (source_kind='free' AND free_candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
    OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND free_candidate_id IS NULL)
  ),
  CONSTRAINT contact_business_sfp_link_evidence_hash_version_chk CHECK (
    normalized_value_hash_version IN (0,1)
  )
);
CREATE INDEX contact_business_sfp_link_evidence_subject_idx
  ON contact_business_sfp_link_evidence(contact_id,business_id,created_at);
CREATE INDEX contact_business_sfp_link_evidence_eligibility_idx
  ON contact_business_sfp_link_evidence(eligibility_id);

ALTER TABLE contact_business_link_decisions
  ADD COLUMN sfp_evidence_id uuid
    REFERENCES contact_business_sfp_link_evidence(id) ON DELETE RESTRICT;
CREATE INDEX contact_business_link_decisions_sfp_evidence_idx
  ON contact_business_link_decisions(sfp_evidence_id)
  WHERE sfp_evidence_id IS NOT NULL;

CREATE OR REPLACE FUNCTION cro02_sfp_link_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'COMMERCIAL_SFP_LINK_EVIDENCE_IMMUTABLE';
END $$;
CREATE TRIGGER contact_business_sfp_link_evidence_append_only
  BEFORE UPDATE OR DELETE ON contact_business_sfp_link_evidence
  FOR EACH ROW EXECUTE FUNCTION cro02_sfp_link_evidence_append_only();

-- Extends the same 0312 sole database authority. The existing strict Sunbiz
-- path and independent-admin path retain their requirements unchanged; SFP
-- typed evidence is a third explicit system branch and is never represented
-- as Sunbiz source evidence or an admin reviewer.
CREATE OR REPLACE FUNCTION enforce_reviewed_contact_business_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_contact_id integer;
  evidence_actor_type text;
  evidence_actor_id text;
  reviewer_role text;
  evidence_row contact_business_system_link_evidence%ROWTYPE;
  sfp_evidence contact_business_sfp_link_evidence%ROWTYPE;
BEGIN
  IF NEW.decision = 'verified' AND NEW.superseded_at IS NULL THEN
    IF NEW.actor_id = 'system' THEN
      IF NEW.sfp_evidence_id IS NOT NULL THEN
        IF NEW.business_id IS NULL OR NEW.system_evidence_id IS NOT NULL
           OR NEW.evidence_source_event_id IS NOT NULL OR NEW.reviewed_by IS NOT NULL
           OR NEW.reviewed_at IS NOT NULL THEN
          RAISE EXCEPTION 'COMMERCIAL_SFP_SYSTEM_LINK_CONTRACT_REQUIRED';
        END IF;
        SELECT * INTO sfp_evidence
          FROM contact_business_sfp_link_evidence WHERE id=NEW.sfp_evidence_id;
        IF NOT FOUND OR sfp_evidence.contact_id <> NEW.contact_id
           OR sfp_evidence.business_id <> NEW.business_id
           OR sfp_evidence.decision_key <> NEW.decision_key THEN
          RAISE EXCEPTION 'COMMERCIAL_SFP_LINK_EVIDENCE_SUBJECT_MISMATCH';
        END IF;
        IF NOT EXISTS (
          SELECT 1
            FROM contacts c
            JOIN businesses b ON b.id=NEW.business_id AND b.record_class='canonical'
            JOIN sfp_outreach_eligibility e ON e.id=sfp_evidence.eligibility_id
              AND e.business_id=NEW.business_id
              AND e.source_kind=sfp_evidence.source_kind
              AND e.normalized_value_hash=sfp_evidence.normalized_value_hash
              AND e.normalized_value_hash_version=sfp_evidence.normalized_value_hash_version
              AND e.zb_outcome='valid'
              AND e.suppression_status='not_suppressed'
              AND e.policy_document_id IS NOT NULL
              AND e.validation_expires_at > now()
            JOIN sfp_cohort_runs r ON r.id=e.cohort_run_id
              AND r.cohort_state='frozen' AND r.voided_at IS NULL AND r.superseded_at IS NULL
            JOIN sfp_programs p ON p.id=r.program_id AND p.is_active=TRUE
            JOIN sfp_outreach_policy_control pc ON pc.singleton=TRUE
            JOIN sfp_outreach_policy_documents pd ON pd.id=pc.active_policy_id
              AND e.policy_document_id=pd.id AND e.policy_document_hash=pd.document_hash
            JOIN provider_observations po
              ON po.operation_id=sfp_evidence.validation_operation_id
             AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
             AND po.subject_type='business' AND po.subject_id=NEW.business_id
             AND po.email_token_hash=sfp_evidence.contact_email_token_hash
             AND po.observed_at<=NOW()
             AND LEAST(
               COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
               po.observed_at+(pd.validation_ttl_days::text||' days')::interval
             )>NOW()
            JOIN provider_operations op ON op.id=po.operation_id AND op.state='completed'
           WHERE c.id=NEW.contact_id
             AND c.business_id IS NULL
             AND c.email_token_hash=sfp_evidence.contact_email_token_hash
             AND c.archived_at IS NULL
             AND c.record_class NOT IN ('test','demo','synthetic')
             AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
             AND COALESCE(c.do_not_contact,FALSE)=FALSE
             AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
             AND COALESCE(c.opted_out_email,FALSE)=FALSE
             AND COALESCE(c.opt_out_status,'active') <> 'opted_out'
             AND COALESCE(c.unsubscribe_status,'active') <> 'unsubscribed'
             AND COALESCE(c.bounce_status,'none') <> 'hard'
             AND COALESCE(c.complaint_status,'none') <> 'reported'
             AND COALESCE(c.email_status,'unvalidated') NOT IN ('bounced','invalid')
             AND c.suppression_reason IS NULL
              AND e.validation_at BETWEEN po.observed_at-INTERVAL '5 minutes'
                                       AND po.observed_at+INTERVAL '5 minutes'
              AND e.validation_expires_at<=LEAST(
                COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
                po.observed_at+(pd.validation_ttl_days::text||' days')::interval
              )
             AND (
               (sfp_evidence.source_kind='free'
                AND e.candidate_id=sfp_evidence.free_candidate_id
                AND e.paid_candidate_evidence_id IS NULL
                AND EXISTS (SELECT 1 FROM free_discovery_candidates fc
                             WHERE fc.id=sfp_evidence.free_candidate_id
                               AND fc.business_id=NEW.business_id
                               AND (e.normalized_value_hash_version<>1
                                    OR fc.normalized_value_hash=e.normalized_value_hash)))
               OR
               (sfp_evidence.source_kind='paid'
                AND e.paid_candidate_evidence_id=sfp_evidence.paid_candidate_evidence_id
                AND e.candidate_id IS NULL
                AND EXISTS (SELECT 1 FROM sfp_paid_candidate_evidence pe
                             WHERE pe.id=sfp_evidence.paid_candidate_evidence_id
                               AND pe.business_id=NEW.business_id
                               AND (e.normalized_value_hash_version<>1
                                    OR pe.normalized_value_hash=e.normalized_value_hash)))
             )
             AND (
               e.status='validated_outreach_eligible'
               OR (
                 e.status='validated_review_required' AND e.named_contact=TRUE
                 AND EXISTS (
                   SELECT 1 FROM sfp_named_email_eligibility_reviews rv
                    WHERE rv.eligibility_id=e.id AND rv.decision='approved'
                      AND rv.expected_updated_at=e.updated_at
                      AND rv.validation_operation_id=sfp_evidence.validation_operation_id
                      AND rv.source_kind=e.source_kind
                      AND rv.normalized_value_hash=e.normalized_value_hash
                      AND rv.normalized_value_hash_version=e.normalized_value_hash_version
                 )
               )
             )
             AND NOT EXISTS (
               SELECT 1 FROM contact_business_link_decisions current_link
                WHERE current_link.contact_id=c.id AND current_link.superseded_at IS NULL
             )
        ) THEN
          RAISE EXCEPTION 'COMMERCIAL_SFP_SYSTEM_LINK_AUTHORITY_FENCE_LOST';
        END IF;
      ELSIF NEW.system_evidence_id IS NOT NULL THEN
        IF NEW.business_id IS NULL
           OR NEW.evidence_source_event_id IS NOT NULL OR NEW.reviewed_by IS NOT NULL
           OR NEW.reviewed_at IS NOT NULL THEN
          RAISE EXCEPTION 'COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED';
        END IF;
        SELECT * INTO evidence_row
          FROM contact_business_system_link_evidence WHERE id=NEW.system_evidence_id;
        IF NOT FOUND OR evidence_row.contact_id <> NEW.contact_id
           OR evidence_row.business_id <> NEW.business_id
           OR evidence_row.decision_key <> NEW.decision_key THEN
          RAISE EXCEPTION 'COMMERCIAL_SYSTEM_LINK_EVIDENCE_SUBJECT_MISMATCH';
        END IF;
        IF NOT EXISTS (
          SELECT 1
            FROM contacts c
            JOIN businesses b ON b.id=NEW.business_id
            JOIN canonical_source_links csl
              ON csl.id=evidence_row.source_link_id AND csl.business_id=b.id
             AND csl.source_system='sunbiz' AND csl.source_type='sunbiz_entity'
            JOIN sunbiz_entities se
              ON se.id=evidence_row.source_entity_id
             AND se.filing_number=csl.stable_key AND se.source IN ('cordata','corevt','sunbiz')
           WHERE c.id=NEW.contact_id
             AND c.archived_at IS NULL
             AND c.record_class NOT IN ('test','demo','synthetic')
             AND COALESCE(c.existing_merchant_customer,false)=false
             AND COALESCE(c.do_not_contact,false)=false
             AND COALESCE(c.do_not_auto_contact,false)=false
             AND COALESCE(c.opted_out_email,false)=false
             AND COALESCE(c.opt_out_status,'active') <> 'opted_out'
             AND COALESCE(c.unsubscribe_status,'active') <> 'unsubscribed'
             AND COALESCE(c.bounce_status,'none') <> 'hard'
             AND COALESCE(c.complaint_status,'none') <> 'reported'
             AND COALESCE(c.email_status,'unvalidated') NOT IN ('bounced','invalid')
             AND c.suppression_reason IS NULL
             AND c.business_id IS NULL
             AND b.record_class='canonical' AND COALESCE(b.do_not_visit,false)=false
             AND lower(regexp_replace(split_part(regexp_replace(trim(c.website),'^[a-zA-Z]+://',''),'/',1),'^www[.]','','i'))
                 = lower(regexp_replace(trim(b.website_domain),'^www[.]','','i'))
             AND lower(regexp_replace(split_part(regexp_replace(trim(se.website),'^[a-zA-Z]+://',''),'/',1),'^www[.]','','i'))
                 = lower(regexp_replace(trim(b.website_domain),'^www[.]','','i'))
             AND regexp_replace(lower(c.company_name),'[^a-z0-9]','','g')
                 = regexp_replace(lower(b.canonical_name),'[^a-z0-9]','','g')
             AND regexp_replace(lower(se.entity_name),'[^a-z0-9]','','g')
                 = regexp_replace(lower(b.canonical_name),'[^a-z0-9]','','g')
             AND split_part(lower(trim(c.email)),'@',2) = lower(regexp_replace(trim(b.website_domain),'^www[.]','','i'))
             AND split_part(lower(trim(c.email)),'@',2) NOT IN
               ('gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','outlook.com','hotmail.com',
                'live.com','aol.com','icloud.com','me.com','msn.com','proton.me','protonmail.com',
                'mail.com','comcast.net','att.net')
             AND (SELECT count(*) FROM businesses other
                   WHERE other.record_class='canonical'
                     AND lower(regexp_replace(trim(other.website_domain),'^www[.]','','i'))
                         = lower(regexp_replace(trim(b.website_domain),'^www[.]','','i'))) = 1
             AND NOT EXISTS (
               SELECT 1 FROM contact_business_link_decisions current_link
                WHERE current_link.contact_id=c.id AND current_link.superseded_at IS NULL
             )
        ) THEN
          RAISE EXCEPTION 'COMMERCIAL_SYSTEM_LINK_AUTHORITY_FENCE_LOST';
        END IF;
      ELSE
        RAISE EXCEPTION 'COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED';
      END IF;
    ELSE
      IF NEW.system_evidence_id IS NOT NULL OR NEW.sfp_evidence_id IS NOT NULL THEN
        RAISE EXCEPTION 'COMMERCIAL_REVIEWED_LINK_EVIDENCE_KIND_MISMATCH';
      END IF;
      -- Existing independent-admin reviewer contract, unchanged.
      IF NEW.business_id IS NULL OR NEW.evidence_source_event_id IS NULL
         OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'COMMERCIAL_LINK_REVIEW_CONTRACT_REQUIRED';
      END IF;
      SELECT contact_id,actor_type,actor_id
        INTO evidence_contact_id,evidence_actor_type,evidence_actor_id
        FROM contact_source_events WHERE id=NEW.evidence_source_event_id;
      IF NOT FOUND OR evidence_contact_id <> NEW.contact_id THEN
        RAISE EXCEPTION 'COMMERCIAL_LINK_EVIDENCE_SUBJECT_MISMATCH';
      END IF;
      IF evidence_actor_type = 'user' AND evidence_actor_id = NEW.reviewed_by THEN
        RAISE EXCEPTION 'COMMERCIAL_LINK_REVIEWER_MUST_BE_INDEPENDENT';
      END IF;
      SELECT role INTO reviewer_role FROM users WHERE id=NEW.reviewed_by;
      IF reviewer_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'COMMERCIAL_LINK_REVIEWER_ROLE_INVALID';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contact_business_link_review_contract ON contact_business_link_decisions;
CREATE TRIGGER contact_business_link_review_contract
  BEFORE INSERT OR UPDATE ON contact_business_link_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_contact_business_link();

-- One initial accepted recipient per program and versioned normalized address.
-- v1 is the current canonical identity hash; source hashes remain immutable in
-- their own evidence rows and aliases retain the original version for audit.
CREATE TABLE sfp_recipient_address_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  objective_key text NOT NULL DEFAULT 'sfp.initial_recipient_acquisition.v1',
  recipient_identity_hash text NOT NULL,
  recipient_identity_hash_version integer NOT NULL,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  package_version_id uuid NOT NULL REFERENCES sfp_campaign_package_versions(id) ON DELETE RESTRICT,
  staging_intent_id uuid NOT NULL REFERENCES sfp_campaign_staging_intents(id) ON DELETE RESTRICT,
  contact_id integer REFERENCES contacts(id) ON DELETE RESTRICT,
  contact_business_link_decision_id uuid REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'claimed',
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CONSTRAINT sfp_recipient_address_commitments_identity_chk CHECK (
    length(recipient_identity_hash)=64 AND recipient_identity_hash ~ '^[0-9a-f]{64}$'
    AND recipient_identity_hash_version=1
  ),
  CONSTRAINT sfp_recipient_address_commitments_objective_chk CHECK (length(trim(objective_key))>0),
  CONSTRAINT sfp_recipient_address_commitments_state_chk CHECK (state IN ('claimed','committed')),
  CONSTRAINT sfp_recipient_address_commitments_commit_state_chk CHECK (
    (state='claimed' AND committed_at IS NULL)
    OR (state='committed' AND contact_id IS NOT NULL
        AND contact_business_link_decision_id IS NOT NULL AND committed_at IS NOT NULL)
  ),
  CONSTRAINT sfp_recipient_address_commitments_staging_intent_uidx UNIQUE(staging_intent_id)
);
CREATE UNIQUE INDEX sfp_recipient_address_commitments_program_hash_uidx
  ON sfp_recipient_address_commitments(program_id,objective_key,recipient_identity_hash);
CREATE INDEX sfp_recipient_address_commitments_business_idx
  ON sfp_recipient_address_commitments(program_id,business_id,created_at);

ALTER TABLE sfp_campaign_staging_intents
  ADD COLUMN recipient_commitment_id uuid
    REFERENCES sfp_recipient_address_commitments(id) ON DELETE RESTRICT;

CREATE TABLE sfp_recipient_commitment_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid NOT NULL REFERENCES sfp_recipient_address_commitments(id) ON DELETE RESTRICT,
  staging_intent_id uuid NOT NULL REFERENCES sfp_campaign_staging_intents(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_reference_id text NOT NULL,
  normalized_value_hash text NOT NULL,
  normalized_value_hash_version integer NOT NULL,
  disposition text NOT NULL,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_recipient_commitment_aliases_source_chk CHECK (source_kind IN ('free','paid','contact')),
  CONSTRAINT sfp_recipient_commitment_aliases_hash_version_chk CHECK (normalized_value_hash_version IN (0,1)),
  CONSTRAINT sfp_recipient_commitment_aliases_disposition_chk CHECK (disposition IN ('initial','reused','held')),
  CONSTRAINT sfp_recipient_commitment_aliases_attempt_uidx
    UNIQUE(staging_intent_id,commitment_id,disposition)
);
CREATE INDEX sfp_recipient_commitment_aliases_commitment_idx
  ON sfp_recipient_commitment_aliases(commitment_id,created_at);

CREATE OR REPLACE FUNCTION sfp_recipient_commitment_aliases_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SFP_RECIPIENT_COMMITMENT_ALIAS_IMMUTABLE';
END $$;
CREATE TRIGGER sfp_recipient_commitment_aliases_append_only
  BEFORE UPDATE OR DELETE ON sfp_recipient_commitment_aliases
  FOR EACH ROW EXECUTE FUNCTION sfp_recipient_commitment_aliases_append_only();

CREATE OR REPLACE FUNCTION sfp_recipient_commitment_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'SFP_RECIPIENT_COMMITMENT_IMMUTABLE';
  END IF;
  IF OLD.program_id IS DISTINCT FROM NEW.program_id
     OR OLD.objective_key IS DISTINCT FROM NEW.objective_key
     OR OLD.recipient_identity_hash IS DISTINCT FROM NEW.recipient_identity_hash
     OR OLD.recipient_identity_hash_version IS DISTINCT FROM NEW.recipient_identity_hash_version
     OR OLD.business_id IS DISTINCT FROM NEW.business_id
     OR OLD.package_version_id IS DISTINCT FROM NEW.package_version_id
     OR OLD.staging_intent_id IS DISTINCT FROM NEW.staging_intent_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.state<>'claimed' OR NEW.state<>'committed'
     OR OLD.contact_id IS NOT NULL OR OLD.contact_business_link_decision_id IS NOT NULL
     OR NEW.contact_id IS NULL OR NEW.contact_business_link_decision_id IS NULL
     OR NEW.committed_at IS NULL THEN
    RAISE EXCEPTION 'SFP_RECIPIENT_COMMITMENT_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sfp_recipient_commitment_transition
  BEFORE UPDATE OR DELETE ON sfp_recipient_address_commitments
  FOR EACH ROW EXECUTE FUNCTION sfp_recipient_commitment_transition();

ALTER TABLE sfp_ready_held_enrollments
  ADD COLUMN contact_business_link_decision_id uuid
    REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN contact_business_link_revision integer,
  ADD COLUMN recipient_commitment_id uuid
    REFERENCES sfp_recipient_address_commitments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX sfp_ready_held_enrollments_commitment_uidx
  ON sfp_ready_held_enrollments(recipient_commitment_id)
  WHERE recipient_commitment_id IS NOT NULL;
CREATE INDEX sfp_ready_held_enrollments_link_pin_idx
  ON sfp_ready_held_enrollments(contact_business_link_decision_id,contact_business_link_revision);

CREATE TABLE sfp_enrollment_bridge_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_intent_id uuid NOT NULL REFERENCES sfp_campaign_staging_intents(id) ON DELETE RESTRICT,
  eligibility_id uuid NOT NULL REFERENCES sfp_outreach_eligibility(id) ON DELETE RESTRICT,
  hold_code text NOT NULL,
  safe_detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sfp_enrollment_bridge_holds_intent_latest_idx
  ON sfp_enrollment_bridge_holds(staging_intent_id,created_at DESC);

CREATE OR REPLACE FUNCTION sfp_enrollment_bridge_holds_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SFP_ENROLLMENT_BRIDGE_HOLD_IMMUTABLE';
END $$;
CREATE TRIGGER sfp_enrollment_bridge_holds_append_only
  BEFORE UPDATE OR DELETE ON sfp_enrollment_bridge_holds
  FOR EACH ROW EXECUTE FUNCTION sfp_enrollment_bridge_holds_append_only();