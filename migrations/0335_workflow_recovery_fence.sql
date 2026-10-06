ALTER TABLE workflows ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS retired_at timestamp;
--> statement-breakpoint
ALTER TABLE workflows ADD CONSTRAINT workflows_version_positive CHECK (version > 0);
