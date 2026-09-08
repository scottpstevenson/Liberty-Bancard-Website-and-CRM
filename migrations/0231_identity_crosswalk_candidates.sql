-- Migration 0231: Identity Crosswalk Candidates, Evidence, Decisions, Vertical Candidates
-- All tables are append-only for evidence and decisions; no UPDATE/DELETE expected on those.

-- ─── Candidates table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_identity_candidates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            uuid NOT NULL REFERENCES contact_identity_subjects(id),
  run_id                uuid NOT NULL REFERENCES contact_identity_reconciliation_runs(id),
  candidate_type        text NOT NULL,
  -- candidate_type: 'contact' | 'business'
  candidate_id          int NOT NULL,
  -- contacts.id or businesses.id
  candidate_updated_at  timestamptz NOT NULL,
  -- frozen snapshot of candidate's updated_at for stale-approval detection
  evidence_class        text NOT NULL,
  -- EXPLICIT_LINK | DETERMINISTIC_MATCH | STRONG_REVIEW_CANDIDATE |
  -- AMBIGUOUS_MATCH | SOURCE_CONFLICT | INSUFFICIENT_EVIDENCE
  confidence_score      int NOT NULL,
  -- 0–100
  match_tier            int NOT NULL,
  -- 1–8 per evidence hierarchy
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_candidates_subject_idx
  ON contact_identity_candidates (subject_id);

CREATE INDEX IF NOT EXISTS identity_candidates_run_class_idx
  ON contact_identity_candidates (run_id, evidence_class);

-- ─── Evidence table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_identity_evidence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES contact_identity_candidates(id),
  run_id                uuid NOT NULL REFERENCES contact_identity_reconciliation_runs(id),
  root_source_table     text NOT NULL,
  root_source_id        text NOT NULL,
  evidence_provider     text NOT NULL,
  -- 'fk_chain' | 'exact_email' | 'filing_number' | 'domain_company' |
  -- 'company_address' | 'company_domain_phone' | 'fuzzy_review'
  evidence_fingerprint  text NOT NULL,
  -- versioned HMAC digest of normalized signal; no raw PII stored
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate signals within a generation
  UNIQUE (candidate_id, root_source_table, root_source_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS identity_evidence_candidate_idx
  ON contact_identity_evidence (candidate_id);

-- ─── Decisions table (append-only) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_identity_decisions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                        uuid NOT NULL REFERENCES contact_identity_reconciliation_runs(id),
  -- Exactly one target type must be populated (enforced by CHECK below)
  subject_id                    uuid REFERENCES contact_identity_subjects(id),
  candidate_id                  uuid REFERENCES contact_identity_candidates(id),
  organization_candidate_id     bigint REFERENCES contact_organization_candidates(id),
  target_type                   text NOT NULL,
  -- 'identity_candidate' | 'org_candidate'
  actor_user_id                 text NOT NULL REFERENCES users(id),
  decision                      text NOT NULL,
  -- 'confirm' | 'reject' | 'defer' | 'supersede'
  -- 'grouping_confirmed' | 'grouping_rejected'
  -- 'existing_business_link_confirmed' | 'proposed_business_match_confirmed'
  -- 'business_materialization_deferred' | 'contact_to_business_mutation_deferred'
  evidence_class_at_decision    text NOT NULL,
  rationale                     text,
  -- Staleness computed at insert time; never updated
  stale_at_decision             boolean NOT NULL DEFAULT false,
  candidate_updated_at_snapshot timestamptz,
  current_candidate_updated_at  timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_decisions_target_check CHECK (
    (target_type = 'identity_candidate' AND candidate_id IS NOT NULL AND organization_candidate_id IS NULL)
    OR
    (target_type = 'org_candidate' AND organization_candidate_id IS NOT NULL AND candidate_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_decisions_run_idx
  ON contact_identity_decisions (run_id);

CREATE INDEX IF NOT EXISTS identity_decisions_candidate_idx
  ON contact_identity_decisions (candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_decisions_org_candidate_idx
  ON contact_identity_decisions (organization_candidate_id)
  WHERE organization_candidate_id IS NOT NULL;

-- ─── Vertical candidates table (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_vertical_candidates (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                            uuid NOT NULL REFERENCES contact_identity_reconciliation_runs(id),
  contact_id                        int NOT NULL REFERENCES contacts(id),
  source_table                      text NOT NULL,
  source_id                         text NOT NULL,
  source_vertical                   text,
  source_vertical_provenance        text,
  current_contact_vertical          text,
  current_contact_vertical_source   text,
  current_contact_vertical_confidence int,
  current_contact_manual_override   boolean,
  resolver_input                    jsonb NOT NULL,
  resolver_output                   jsonb NOT NULL,
  conflict_state                    text NOT NULL,
  -- 'agree' | 'proposed_upgrade' | 'proposed_change' | 'resolver_null' | 'no_source_vertical'
  created_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vertical_candidates_run_idx
  ON contact_vertical_candidates (run_id);

CREATE INDEX IF NOT EXISTS vertical_candidates_contact_idx
  ON contact_vertical_candidates (contact_id);
