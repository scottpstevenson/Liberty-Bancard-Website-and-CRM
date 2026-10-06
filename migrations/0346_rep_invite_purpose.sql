ALTER TABLE auth_actions DROP CONSTRAINT IF EXISTS auth_actions_purpose_check;
--> statement-breakpoint
ALTER TABLE auth_actions ADD CONSTRAINT auth_actions_purpose_check CHECK (purpose IN (
  'user_password_reset','user_email_verification','merchant_activation',
  'partner_password_reset','partner_invite','partner_org_activation',
  'partner_org_password_reset','agent_rep_invite'
));
