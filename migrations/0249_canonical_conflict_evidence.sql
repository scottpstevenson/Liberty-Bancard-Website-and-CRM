-- MI-03: canonical_conflict_evidence — append-only conflict log written by projectBusinessOnly().
-- Admin resolution UI and merge/promotion authority belong to MI-07.

CREATE TABLE IF NOT EXISTS canonical_conflict_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id_a   INTEGER NOT NULL REFERENCES businesses(id),
  business_id_b   INTEGER REFERENCES businesses(id),
  conflict_type   TEXT NOT NULL,
  field           TEXT,
  evidence_payload JSONB,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS canonical_conflict_evidence_status_idx
  ON canonical_conflict_evidence (status) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS canonical_conflict_evidence_business_a_idx
  ON canonical_conflict_evidence (business_id_a);

CREATE INDEX IF NOT EXISTS canonical_conflict_evidence_created_at_idx
  ON canonical_conflict_evidence (created_at DESC);
