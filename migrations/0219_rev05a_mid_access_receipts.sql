-- REV-05A: MID Access Receipts
-- Every full-MID read from a role-authorized endpoint writes a receipt.
-- Full MID returned only via dedicated purpose-bound, role-authorized endpoint.

CREATE TABLE IF NOT EXISTS merchant_mid_access_receipts (
  id          SERIAL PRIMARY KEY,
  mid_id      INTEGER REFERENCES merchant_mids(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  user_id     TEXT,
  endpoint    TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'manual_lookup',
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_mid_access_receipts_mid_id_idx
  ON merchant_mid_access_receipts (mid_id);

CREATE INDEX IF NOT EXISTS merchant_mid_access_receipts_user_id_idx
  ON merchant_mid_access_receipts (user_id);

CREATE INDEX IF NOT EXISTS merchant_mid_access_receipts_accessed_at_idx
  ON merchant_mid_access_receipts (accessed_at DESC);
