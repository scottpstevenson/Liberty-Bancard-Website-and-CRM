-- Strict automatic contact→business evidence, separate from admin-reviewed
-- decisions. This migration is additive and must only run through the normal
-- migration/publish deployment path (never replayed manually on production).
CREATE TABLE contact_business_system_link_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_key text NOT NULL UNIQUE,
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source_link_id uuid NOT NULL REFERENCES canonical_source_links(id) ON DELETE RESTRICT,
  source_entity_id integer NOT NULL REFERENCES sunbiz_entities(id) ON DELETE RESTRICT,
  rule_version text NOT NULL,
  facts_hash text NOT NULL,
  facts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contact_business_link_decisions
  ADD COLUMN system_evidence_id uuid
    REFERENCES contact_business_system_link_evidence(id) ON DELETE RESTRICT;
CREATE INDEX contact_business_system_link_evidence_subject_idx
  ON contact_business_system_link_evidence(contact_id,business_id,created_at);

CREATE OR REPLACE FUNCTION cro02_system_link_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'COMMERCIAL_SYSTEM_LINK_EVIDENCE_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS contact_business_system_link_evidence_append_only
  ON contact_business_system_link_evidence;
CREATE TRIGGER contact_business_system_link_evidence_append_only
  BEFORE UPDATE OR DELETE ON contact_business_system_link_evidence
  FOR EACH ROW EXECUTE FUNCTION cro02_system_link_evidence_append_only();

-- Preserve the existing admin-reviewed contract exactly; the separate system
-- branch is intentionally explicit and verifies the retained Sunbiz lineage.
CREATE OR REPLACE FUNCTION enforce_reviewed_contact_business_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_contact_id integer;
  evidence_actor_type text;
  evidence_actor_id text;
  reviewer_role text;
  evidence_row contact_business_system_link_evidence%ROWTYPE;
BEGIN
  IF NEW.decision = 'verified' AND NEW.superseded_at IS NULL THEN
    IF NEW.actor_id = 'system' THEN
      IF NEW.business_id IS NULL OR NEW.system_evidence_id IS NULL
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
      -- Existing admin-reviewed decision contract; do not weaken or reinterpret.
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