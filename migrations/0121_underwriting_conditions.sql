-- #1403 — Underwriting Orchestration: conditional approval checklists
-- Tracks conditions attached to a conditional approval decision.
-- Each condition represents an item Payarc requires before full approval.

CREATE TABLE IF NOT EXISTS underwriting_conditions (
  id               SERIAL PRIMARY KEY,
  deal_id          INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  decision_id      INTEGER REFERENCES underwriting_decisions(id),
  condition_type   TEXT    NOT NULL,                           -- e.g. voided_check, bank_statements, loe_chargeback
  description      TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',         -- pending | submitted | approved | waived
  merchant_visible BOOLEAN NOT NULL DEFAULT true,
  due_date         TIMESTAMP,
  submitted_at     TIMESTAMP,
  approved_at      TIMESTAMP,
  waived_at        TIMESTAMP,
  waived_reason    TEXT,
  document_id      INTEGER,                                    -- FK to documents when satisfied by upload
  notes            TEXT,
  created_by       INTEGER,
  updated_by       INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_underwriting_conditions_deal_id
  ON underwriting_conditions(deal_id);

CREATE INDEX IF NOT EXISTS idx_underwriting_conditions_status
  ON underwriting_conditions(deal_id, status);
