ALTER TABLE users ADD COLUMN IF NOT EXISTS account_state varchar(16) NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_epoch integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE auth_actions ADD COLUMN IF NOT EXISTS issued_auth_epoch integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_account_state_supported CHECK (account_state IN ('active','deactivated'));
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_account_fence_positive CHECK (account_version > 0 AND auth_epoch >= 0);
