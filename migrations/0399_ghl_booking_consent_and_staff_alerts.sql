CREATE TABLE ghl_booking_sms_consent_checks (
 appointment_id text PRIMARY KEY REFERENCES ghl_appointment_state(appointment_id) ON DELETE CASCADE,
 request_id uuid NOT NULL UNIQUE REFERENCES inbound_requests(id) ON DELETE CASCADE,
 booking_created_at timestamptz NOT NULL,
 booking_start_time timestamptz NOT NULL,
 submission_id text UNIQUE,
 consent_event_id integer REFERENCES consent_audit_logs(id),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','opted_in','not_opted_in','review_required','cancelled')),
 reason text,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ghl_booking_sms_consent_due_idx ON ghl_booking_sms_consent_checks(next_check_at)
 WHERE state = 'pending';

ALTER TABLE team_intake_alerts DROP CONSTRAINT team_intake_alert_source_check;
ALTER TABLE team_intake_alerts ADD CONSTRAINT team_intake_alert_source_check CHECK
 (source_kind IN ('application','introduction','referral','merchant_referral','inbound','merchant_application','ghl_activity','ghl_booking'));
ALTER TABLE team_intake_alerts DROP CONSTRAINT team_intake_alert_event_check;
ALTER TABLE team_intake_alerts ADD CONSTRAINT team_intake_alert_event_check CHECK (
 (source_kind='application' AND event_kind IN ('sales_agent_application','referral_partner_application')) OR
 (source_kind='inbound' AND event_kind='website_submission') OR
 (source_kind='merchant_application' AND event_kind='merchant_application') OR
 (source_kind IN ('introduction','referral','merchant_referral') AND event_kind='merchant_referral') OR
 (source_kind='ghl_activity' AND event_kind IN ('ghl_inbound_call','ghl_inbound_sms')) OR
 (source_kind='ghl_booking' AND event_kind='ghl_appointment_booked')
);
