-- Migration 0252: CRO-03C native durable candidate evidence table (MI-05).
--
-- Stores encrypted per-field candidate evidence produced by live CRO-03C
-- provider executors before canonical projection. This is the bridge between
-- provider transport and the businesses table — no PII ever reaches
-- cro03c_receipts.redacted_metadata.
--
-- Design: Option B (separate table).  cro03_candidates has a NOT NULL FK to
-- cro03_enrichment_items (legacy enrichment path) and cannot be extended for
-- CRO-03C-native records without breaking that invariant.  A sibling table
-- avoids the coupling while reusing the same envelope encryption pattern.
--
-- Idempotency unit: UNIQUE(generation_id, stage_key, field)
-- One record per field per provider stage per generation.
-- subject_type = 'business' → eligible for businesses.mainEmail projection.
-- subject_type = 'person'   → Apollo person reveal, held for MI-06 validation.

CREATE TABLE IF NOT EXISTS cro03c_candidate_evidence (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id        UUID         NOT NULL
                                    REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  stage_key            TEXT         NOT NULL,
  field                TEXT         NOT NULL,
  source_rank          INTEGER      NOT NULL DEFAULT 100,
  subject_type         TEXT         NOT NULL
                                    CHECK (subject_type IN ('business', 'person')),
  -- Disposition tracks lifecycle: staged → accepted/rejected/quarantined.
  disposition          TEXT         NOT NULL DEFAULT 'staged'
                                    CHECK (disposition IN ('staged','accepted','rejected','quarantined','superseded')),
  confidence           INTEGER      NOT NULL DEFAULT 0,
  -- Envelope encryption — same pattern as cro03_candidates.
  envelope_ciphertext  TEXT         NOT NULL,
  envelope_nonce       TEXT         NOT NULL,
  envelope_tag         TEXT         NOT NULL,
  envelope_key_version INTEGER      NOT NULL DEFAULT 1,
  -- Non-PII audit columns (safe for receipts / audit_logs).
  normalized_value_hash TEXT        NOT NULL,
  masked_value         TEXT         NOT NULL,
  -- Apollo-specific: match_confidence level from People Match endpoint.
  -- NULL for non-Apollo or org-level candidates.
  apollo_match_confidence TEXT      CHECK (apollo_match_confidence IN ('high','medium','low','none')),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotency key: one record per distinct value per field per provider stage
-- per generation. Including normalized_value_hash allows multiple email
-- candidates per (generation, stage, field) while still preventing exact
-- duplicates on retry.
CREATE UNIQUE INDEX IF NOT EXISTS cro03c_candidate_evidence_gen_stage_field_value_uniq
  ON cro03c_candidate_evidence (generation_id, stage_key, field, normalized_value_hash);

-- Support: look up all evidence for a generation quickly.
CREATE INDEX IF NOT EXISTS cro03c_candidate_evidence_generation_idx
  ON cro03c_candidate_evidence (generation_id);

-- Support: filter by disposition (e.g. find all staged business-level candidates).
CREATE INDEX IF NOT EXISTS cro03c_candidate_evidence_disposition_idx
  ON cro03c_candidate_evidence (disposition)
  WHERE disposition = 'staged';

-- ── MI-05: businesses enrichment provenance (CAS tracking) ──────────────────
-- Tracks which CRO-03C generation and candidate last wrote each enrichment
-- field on a businesses row. Required for CAS in projectBusinessEnrichmentFields().
--
-- One row per (business_id, field) — upserted on each successful projection.
CREATE TABLE IF NOT EXISTS businesses_enrichment_provenance (
  id             SERIAL       PRIMARY KEY,
  business_id    INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  field          TEXT         NOT NULL,
  generation_id  UUID         NOT NULL,
  stage_key      TEXT         NOT NULL,
  confidence     INTEGER      NOT NULL DEFAULT 0,
  written_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS businesses_enrichment_provenance_business_field_uniq
  ON businesses_enrichment_provenance (business_id, field);

CREATE INDEX IF NOT EXISTS businesses_enrichment_provenance_generation_idx
  ON businesses_enrichment_provenance (generation_id);
