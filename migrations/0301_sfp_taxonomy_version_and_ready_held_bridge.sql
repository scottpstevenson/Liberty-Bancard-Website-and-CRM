-- 0301: separate taxonomy_version from classifier_version on
-- sfp_classification_evidence, and add the ready_held -> paused-enrollment
-- bridge ledger table.

ALTER TABLE sfp_classification_evidence
  ADD COLUMN IF NOT EXISTS taxonomy_version integer NOT NULL DEFAULT 1;

-- Backfill: every row written before this migration stored the TAXONOMY
-- version in classifier_version (the ruleset version was never actually
-- distinct from it until now), so taxonomy_version = classifier_version for
-- all pre-existing rows. New rows will always set both explicitly.
UPDATE sfp_classification_evidence
   SET taxonomy_version = classifier_version
 WHERE taxonomy_version = 1 AND classifier_version <> 1;

DROP INDEX IF EXISTS sfp_classification_evidence_resolved_vertical_idx;
CREATE INDEX IF NOT EXISTS sfp_classification_evidence_resolved_vertical_idx
  ON sfp_classification_evidence (business_id, classifier_version, taxonomy_version, policy_version, resolved_vertical_id);

CREATE TABLE IF NOT EXISTS sfp_ready_held_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_intent_id uuid NOT NULL REFERENCES sfp_campaign_staging_intents(id) ON DELETE RESTRICT,
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  sequence_enrollment_id integer NOT NULL REFERENCES sequence_enrollments(id) ON DELETE RESTRICT,
  contact_resolution text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_ready_held_enrollments_resolution_chk CHECK (contact_resolution IN ('matched_existing', 'created_new'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sfp_ready_held_enrollments_intent_uidx ON sfp_ready_held_enrollments (staging_intent_id);
CREATE INDEX IF NOT EXISTS sfp_ready_held_enrollments_contact_idx ON sfp_ready_held_enrollments (contact_id);
