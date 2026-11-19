CREATE TABLE team_intake_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_key text NOT NULL,
 event_kind text NOT NULL,
 source_kind text NOT NULL,
 source_id text NOT NULL,
 recipient text NOT NULL DEFAULT 'scott@libertybancard.com',
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending',
 attempt_count integer NOT NULL DEFAULT 0,
 attempt_token uuid,
 lease_expires_at timestamptz,
 dispatched_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 provider_message_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT team_intake_alerts_event_key_unique UNIQUE(event_key),
 CONSTRAINT team_intake_alert_recipient_check CHECK (recipient='scott@libertybancard.com'),
 CONSTRAINT team_intake_alert_source_check CHECK (source_kind IN ('application','introduction','referral','merchant_referral')),
 CONSTRAINT team_intake_alert_event_check CHECK ((source_kind='application' AND event_kind IN ('sales_agent_application','referral_partner_application')) OR (source_kind<>'application' AND event_kind='merchant_referral')),
 CONSTRAINT team_intake_alert_key_check CHECK (event_key=source_kind||':'||source_id),
 CONSTRAINT team_intake_alert_payload_check CHECK (jsonb_typeof(payload)='object'),
 CONSTRAINT team_intake_alert_state_check CHECK (state IN ('pending','attempting','sent','uncertain','failed')),
 CONSTRAINT team_intake_alert_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 5),
 CONSTRAINT team_intake_alert_claim_check CHECK (state<>'attempting' OR (attempt_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX team_intake_alert_due_idx ON team_intake_alerts(next_attempt_at,created_at) WHERE state='pending';
CREATE INDEX team_intake_alert_stale_idx ON team_intake_alerts(lease_expires_at) WHERE state='attempting';
-- No backfill: historical applications/referrals must not generate a catch-up email burst.
