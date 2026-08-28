CREATE TABLE IF NOT EXISTS auth_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose varchar(64) NOT NULL,
  subject_type varchar(64) NOT NULL,
  subject_id varchar(128) NOT NULL,
  token_hash varchar(64) NOT NULL,
  version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  delivery_disposition varchar(32) NOT NULL DEFAULT 'pending',
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_actions_purpose_check CHECK (purpose IN (
    'user_password_reset', 'user_email_verification', 'merchant_activation',
    'partner_password_reset', 'partner_invite', 'partner_org_activation',
    'partner_org_password_reset'
  )),
  CONSTRAINT auth_actions_delivery_disposition_check CHECK (delivery_disposition IN (
    'pending', 'sent', 'definite_failure', 'ambiguous'
  )),
  CONSTRAINT auth_actions_token_hash_length_check CHECK (char_length(token_hash) = 64),
  CONSTRAINT auth_actions_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_actions_token_hash_uidx ON auth_actions (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS auth_actions_subject_purpose_version_uidx
  ON auth_actions (subject_type, subject_id, purpose, version);
CREATE INDEX IF NOT EXISTS auth_actions_subject_purpose_idx
  ON auth_actions (subject_type, subject_id, purpose, version);
CREATE INDEX IF NOT EXISTS auth_actions_consume_idx
  ON auth_actions (token_hash, purpose, expires_at);

ALTER TABLE partner_org_users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;