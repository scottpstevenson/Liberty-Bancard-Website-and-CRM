-- #1404 — MID/TID Master Registry
-- Tracks each Merchant ID assigned by Payarc and its current status.
-- The deals.mid column remains the primary fast lookup; this table is the audit registry.

CREATE TABLE IF NOT EXISTS merchant_mids (
  id               SERIAL PRIMARY KEY,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id          INTEGER REFERENCES deals(id),
  mid              TEXT    NOT NULL,
  tids             TEXT[]  NOT NULL DEFAULT '{}',            -- array of Terminal IDs
  processor_name   TEXT    NOT NULL DEFAULT 'payarc',
  status           TEXT    NOT NULL DEFAULT 'assigned',      -- assigned | active | suspended | closed
  monthly_volume_cap DECIMAL(12,2),
  assigned_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at     TIMESTAMP,
  suspended_at     TIMESTAMP,
  closed_at        TIMESTAMP,
  suspension_reason TEXT,
  notes            TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_mids_mid
  ON merchant_mids(mid);

CREATE INDEX IF NOT EXISTS idx_merchant_mids_contact_id
  ON merchant_mids(contact_id);

CREATE INDEX IF NOT EXISTS idx_merchant_mids_deal_id
  ON merchant_mids(deal_id);

-- Equipment shipment tracking for terminal hardware
CREATE TABLE IF NOT EXISTS equipment_shipments (
  id               SERIAL PRIMARY KEY,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id          INTEGER REFERENCES deals(id),
  equipment_order_id INTEGER,
  carrier          TEXT,                                     -- fedex | ups | usps
  tracking_number  TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending',       -- pending | shipped | delivered | returned
  shipped_at       TIMESTAMP,
  estimated_delivery TIMESTAMP,
  delivered_at     TIMESTAMP,
  notes            TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_shipments_contact_id
  ON equipment_shipments(contact_id);

CREATE INDEX IF NOT EXISTS idx_equipment_shipments_deal_id
  ON equipment_shipments(deal_id);
