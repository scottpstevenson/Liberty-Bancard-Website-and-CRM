-- Additive, forward-only click measurement. No historical consent or conversion backfill.
CREATE TABLE ads_measurement_revocations (revoke_hash text PRIMARY KEY CHECK(revoke_hash ~ '^[0-9a-f]{64}$'), revoked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ads_attribution_snapshots (
 request_id uuid PRIMARY KEY CONSTRAINT ads_attribution_snapshots_request_id_inbound_requests_id_fk REFERENCES inbound_requests(id) ON DELETE RESTRICT,
 contact_id integer NOT NULL CONSTRAINT ads_attribution_snapshots_contact_id_contacts_id_fk REFERENCES contacts(id) ON DELETE RESTRICT,
 click_ids_ciphertext text NOT NULL CHECK (click_ids_ciphertext LIKE 'enc_v1:%'),
 consent_version text NOT NULL CHECK (consent_version='ads-measurement-v1'),
 revoke_hash text NOT NULL CHECK (revoke_hash ~ '^[0-9a-f]{64}$'),
 captured_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX ads_attribution_revoke_idx ON ads_attribution_snapshots(revoke_hash);
CREATE TABLE ads_offline_conversions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_key text NOT NULL CONSTRAINT ads_offline_conversions_event_key_unique UNIQUE,
 kind text NOT NULL CHECK(kind IN ('qualified_lead','closed_won')),
 source_id text NOT NULL,
 attribution_request_id uuid NOT NULL CONSTRAINT ads_offline_attribution_fk REFERENCES ads_attribution_snapshots(request_id) ON DELETE RESTRICT,
 deal_id integer NOT NULL CONSTRAINT ads_offline_conversions_deal_id_deals_id_fk REFERENCES deals(id) ON DELETE RESTRICT,
 occurred_at timestamptz NOT NULL,
 actor_id text,
 reason text,
 customer_id text NOT NULL DEFAULT '3455118578' CHECK(customer_id='3455118578'),
 action_id text CHECK(action_id ~ '^[0-9]+$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempting','submitted','processed','processed_with_warnings','failed','uncertain','revoked')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 claim_token uuid,
 lease_expires_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 dispatched_at timestamptz,
 provider_request_id text,
 provider_status text,
 diagnostic jsonb,
 last_error text,
 validated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(deal_id,kind),
 CONSTRAINT ads_offline_conversions_claim_check CHECK(state<>'attempting' OR (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CONSTRAINT ads_offline_conversions_receipt_check CHECK(state NOT IN ('submitted','processed','processed_with_warnings') OR (provider_request_id IS NOT NULL AND action_id IS NOT NULL))
);
CREATE INDEX ads_offline_due_idx ON ads_offline_conversions(next_attempt_at,created_at) WHERE state IN ('pending','submitted','attempting');
