CREATE TABLE IF NOT EXISTS cro03b_terminal_hook_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_terminal_hook_state_chk CHECK (state IN ('pending','claimed','completed'))
);