-- Additive intake follow-up ledger. No historical activation or receipt backfill.
CREATE TABLE intake_operations (
 source_kind text NOT NULL CHECK(source_kind IN ('forms','merchants','applications','introductions','referrals','merchant_referrals')),
 source_id text NOT NULL,
 request_id uuid REFERENCES inbound_requests(id),
 task_id integer REFERENCES tasks(id),
 notification_id integer REFERENCES notifications(id),
 ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_kind,source_id)
);
ALTER TABLE team_intake_alerts DROP CONSTRAINT team_intake_alert_source_check;
ALTER TABLE team_intake_alerts ADD CONSTRAINT team_intake_alert_source_check CHECK(source_kind IN ('application','introduction','referral','merchant_referral','inbound','merchant_application'));
ALTER TABLE team_intake_alerts DROP CONSTRAINT team_intake_alert_event_check;
ALTER TABLE team_intake_alerts ADD CONSTRAINT team_intake_alert_event_check CHECK (
 (source_kind='application' AND event_kind IN ('sales_agent_application','referral_partner_application')) OR
 (source_kind='inbound' AND event_kind='website_submission') OR
 (source_kind='merchant_application' AND event_kind='merchant_application') OR
 (source_kind IN ('introduction','referral','merchant_referral') AND event_kind='merchant_referral')
);
