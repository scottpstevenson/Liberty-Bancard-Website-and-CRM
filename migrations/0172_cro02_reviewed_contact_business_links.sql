-- Automatic contact/business discovery is an append-only candidate axis. It is
-- deliberately separate from decision-maker relationship candidates and never
-- updates contacts.business_id or contact_business_link_decisions.
CREATE TABLE contact_business_link_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (
    source IN ('csv_import','legacy_import','sdr_dedupe','sdr_orchestration')
  ),
  source_version text,
  candidate_key text NOT NULL UNIQUE,
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 99),
  supersedes_candidate_id uuid REFERENCES contact_business_link_candidates(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_business_link_candidate_subject_idx
  ON contact_business_link_candidates(contact_id,business_id,created_at);
CREATE UNIQUE INDEX contact_business_link_candidate_superseded_once_uidx
  ON contact_business_link_candidates(supersedes_candidate_id)
  WHERE supersedes_candidate_id IS NOT NULL;

-- Current candidates are rows for which no later append-only row names them as
-- superseded. Callers currently append observations without promoting them.
CREATE VIEW current_contact_business_link_candidates AS
SELECT candidate.*
  FROM contact_business_link_candidates candidate
 WHERE NOT EXISTS (
   SELECT 1 FROM contact_business_link_candidates successor
    WHERE successor.supersedes_candidate_id = candidate.id
 );

CREATE OR REPLACE FUNCTION cro02_contact_business_candidate_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRO02_IMMUTABLE_CONTACT_BUSINESS_LINK_CANDIDATE';
END $$;
CREATE TRIGGER contact_business_link_candidate_append_only
  BEFORE UPDATE OR DELETE ON contact_business_link_candidates
  FOR EACH ROW EXECUTE FUNCTION cro02_contact_business_candidate_append_only();

-- The initial reviewed-link evidence vocabulary is intentionally frozen to
-- one retained typed source: an existing contact_source_event.
ALTER TABLE contact_business_link_decisions
  ADD COLUMN evidence_source_event_id integer
    REFERENCES contact_source_events(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_by text REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION enforce_reviewed_contact_business_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_contact_id integer;
  evidence_actor_type text;
  evidence_actor_id text;
  reviewer_role text;
BEGIN
  IF NEW.decision = 'verified' AND NEW.superseded_at IS NULL THEN
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
  RETURN NEW;
END $$;
CREATE TRIGGER contact_business_link_review_contract
  BEFORE INSERT OR UPDATE ON contact_business_link_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_contact_business_link();