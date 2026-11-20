-- Versioned Traditional application ownership. No transport activation or backfill.
CREATE TABLE payarc_preparations (
 application_id integer PRIMARY KEY REFERENCES merchant_applications(id),
 application_revision text NOT NULL,
 payload_ciphertext text NOT NULL,
 prepared_by text NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payarc_cases (
 deal_id integer PRIMARY KEY REFERENCES deals(id),
 application_id integer NOT NULL REFERENCES merchant_applications(id),
 contract_version text NOT NULL CHECK(contract_version='traditional-apply-v1'),
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 merchant_code text NOT NULL,
 owner_fingerprint text NOT NULL,
 phase text NOT NULL DEFAULT 'lead_created',
 observation jsonb NOT NULL DEFAULT '{}'::jsonb,
 signature_state text NOT NULL DEFAULT 'pending' CHECK(signature_state IN ('pending','attempting','sent','uncertain','failed')),
 signature_attempts integer NOT NULL DEFAULT 0 CHECK(signature_attempts BETWEEN 0 AND 5),
 signature_lease uuid,
 signature_started_at timestamptz,
 signature_sent_at timestamptz,
 poll_lease uuid,
 poll_lease_expires_at timestamptz,
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 last_polled_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,merchant_code)
);
CREATE INDEX payarc_cases_due_idx ON payarc_cases(next_poll_at);
CREATE TABLE payarc_correction_commands (
 id uuid PRIMARY KEY,
 deal_id integer NOT NULL REFERENCES payarc_cases(deal_id),
 application_revision text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempting','updated','uncertain','failed')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 settled_at timestamptz
);
CREATE UNIQUE INDEX payarc_correction_active_idx ON payarc_correction_commands(deal_id) WHERE state IN ('pending','attempting','uncertain');
