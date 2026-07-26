-- Merchant onboarding workflow stages (10-stage pipeline tracking)
-- Separate from onboarding_checklist_items (document tracking)

CREATE TABLE IF NOT EXISTS merchant_onboarding_stages (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  stage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  owner TEXT,
  due_date TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT,
  equipment_order_ref TEXT,
  ghl_stage_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS merchant_onboarding_stages_deal_id_idx ON merchant_onboarding_stages(deal_id);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_onboarding_stages_deal_key_unique ON merchant_onboarding_stages(deal_id, stage_key);

-- Extend partners table with new tracking fields
ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_owner TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_status TEXT DEFAULT 'pending';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMP;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_category TEXT DEFAULT 'referral';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS referred_count INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pipeline_value TEXT DEFAULT '0';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS next_followup_task_id INTEGER;
