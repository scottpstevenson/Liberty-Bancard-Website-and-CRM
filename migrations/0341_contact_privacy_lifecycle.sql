ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE data_delete_requests ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE data_delete_requests ADD COLUMN IF NOT EXISTS subject_contact_id integer REFERENCES contacts(id);
--> statement-breakpoint
ALTER TABLE data_delete_requests ADD COLUMN IF NOT EXISTS review_evidence text;
--> statement-breakpoint
ALTER TABLE data_delete_requests ADD COLUMN IF NOT EXISTS retention_reason text;
--> statement-breakpoint
ALTER TABLE data_delete_requests ADD COLUMN IF NOT EXISTS execution_state text NOT NULL DEFAULT 'not_executed';
