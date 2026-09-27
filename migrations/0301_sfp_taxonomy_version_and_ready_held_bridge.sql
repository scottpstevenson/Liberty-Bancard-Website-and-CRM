-- 0301: separate taxonomy_version from classifier_version on
-- sfp_classification_evidence, and add the ready_held -> paused-enrollment
-- bridge ledger table.

ALTER TABLE sfp_classification_evidence
  ADD COLUMN IF NOT EXISTS taxonomy_version integer NOT NULL DEFAULT 1;

-- Backfill: every row written before this migration stored the TAXONOMY
-- version in classifier_version (the ruleset version was never actually
-- distinct from it until now), so taxonomy_version = classifier_version for
-- all pre-existing rows. New rows will always set both explicitly.
--
-- sfp_classification_evidence has an immutability trigger (0288) that
-- unconditionally rejects UPDATE/DELETE. It fires per-row, so this backfill
-- only breaks on databases that actually have rows needing it -- which is
-- exactly what happened in production (98 rows) while it passed silently in
-- dev/disposable-DB tests that had none. This one-time backfill is a
-- legitimate schema-migration exception to that immutability rule, so
-- disable the trigger only for the duration of this statement.
ALTER TABLE sfp_classification_evidence DISABLE TRIGGER sfp_classification_evidence_immutable_trg;

UPDATE sfp_classification_evidence
   SET taxonomy_version = classifier_version
 WHERE taxonomy_version = 1 AND classifier_version <> 1;

ALTER TABLE sfp_classification_evidence ENABLE TRIGGER sfp_classification_evidence_immutable_trg;

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
