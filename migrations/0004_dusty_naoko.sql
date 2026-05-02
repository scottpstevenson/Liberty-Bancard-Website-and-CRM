CREATE INDEX IF NOT EXISTS "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_ghl_contact_id_idx" ON "contacts" USING btree ("ghl_contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sdr_lead_state_contact_id_idx" ON "sdr_lead_state" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sdr_merchants_ghl_contact_id_idx" ON "sdr_merchants" USING btree ("ghl_contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollments_contact_id_status_idx" ON "sequence_enrollments" USING btree ("contact_id","status");
