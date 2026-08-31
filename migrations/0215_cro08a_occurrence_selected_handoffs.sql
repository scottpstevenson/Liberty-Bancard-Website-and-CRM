-- CRO-08A remediation (post-review Correction): a schedule occurrence's
-- frozen enumeration previously persisted only a selected_count integer and
-- a receipt hash, so createCro03cCommand had no way to constrain which
-- specific handoffs a continuous_occurrence command could touch -- any
-- caller-supplied handoffIds list up to that count was accepted, even one
-- containing handoffs outside the occurrence's actual selected population.
--
-- This table durably records the exact selected-handoff membership at
-- enumeration-commit time, so command creation can validate exact
-- authorized-set membership instead of trusting a bare count.
CREATE TABLE IF NOT EXISTS cro08a_occurrence_selected_handoffs (
  occurrence_id UUID NOT NULL REFERENCES cro08a_schedule_occurrences(id) ON DELETE RESTRICT,
  handoff_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (occurrence_id, handoff_id)
);
CREATE INDEX IF NOT EXISTS cro08a_occurrence_selected_handoffs_occurrence_idx
  ON cro08a_occurrence_selected_handoffs (occurrence_id);
