CREATE TABLE "domain_business_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"business_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "identity_performance_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"sending_identity_id" integer NOT NULL,
	"date" text NOT NULL,
	"emails_sent" integer DEFAULT 0,
	"delivered" integer DEFAULT 0,
	"bounced" integer DEFAULT 0,
	"opened" integer DEFAULT 0,
	"replied" integer DEFAULT 0,
	"complaints" integer DEFAULT 0,
	"meetings_booked" integer DEFAULT 0,
	"positive_replies" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdr_channel_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer,
	"lead_state_id" integer,
	"channel" text NOT NULL,
	"attempt_no" integer DEFAULT 1,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'sent',
	"template_id" text,
	"template_key" text,
	"ghl_message_id" text,
	"subject" text,
	"body" text,
	"error" text,
	"sent_at" timestamp DEFAULT now(),
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"replied_at" timestamp,
	"outcome" text,
	"cost" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdr_compliance_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer NOT NULL,
	"sms_allowed" boolean DEFAULT true,
	"email_allowed" boolean DEFAULT true,
	"call_allowed" boolean DEFAULT true,
	"quiet_hours_block" boolean DEFAULT false,
	"dnc_block" boolean DEFAULT false,
	"complaint_block" boolean DEFAULT false,
	"litigation_block" boolean DEFAULT false,
	"consent_source" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdr_compliance_state_merchant_id_unique" UNIQUE("merchant_id")
);
--> statement-breakpoint
CREATE TABLE "sdr_lead_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer,
	"contact_id" integer,
	"lead_state_id" integer,
	"event_type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"action_type" text,
	"channel" text,
	"actor_type" text,
	"event_at" timestamp DEFAULT now(),
	"payload_json" jsonb,
	"decision_reason" text,
	"metadata" jsonb,
	"model_version" text,
	"compliance_result" text,
	"ghl_ref_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdr_lead_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer NOT NULL,
	"contact_id" integer,
	"current_stage" text DEFAULT 'DISCOVERED' NOT NULL,
	"stage" text DEFAULT 'DISCOVERED' NOT NULL,
	"substage" text,
	"status_reason" text,
	"qualification_tier" text,
	"company_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"vertical" text,
	"city" text,
	"state" text,
	"fit_score" integer DEFAULT 0,
	"revenue_score" integer DEFAULT 0,
	"reachability_score" integer DEFAULT 0,
	"priority_score" integer DEFAULT 0,
	"priority_bucket" text DEFAULT 'C',
	"score_breakdown" jsonb,
	"last_scored_at" timestamp,
	"boarding_probability" real,
	"next_action" text,
	"next_action_type" text,
	"next_action_payload" jsonb,
	"next_action_at" timestamp,
	"assigned_to" text,
	"owner_type" text DEFAULT 'ai',
	"proposal_id" text,
	"meeting_id" text,
	"email_attempts" integer DEFAULT 0,
	"sms_attempts" integer DEFAULT 0,
	"call_attempts" integer DEFAULT 0,
	"last_email_at" timestamp,
	"last_sms_at" timestamp,
	"last_call_at" timestamp,
	"last_reply_at" timestamp,
	"last_touch_at" timestamp,
	"consent_email" boolean DEFAULT true,
	"consent_sms" boolean DEFAULT false,
	"consent_call" boolean DEFAULT false,
	"opted_out_email" boolean DEFAULT false,
	"opted_out_sms" boolean DEFAULT false,
	"ghl_contact_id" text,
	"enrichment_data" jsonb,
	"owner_name" text,
	"owner_email" text,
	"owner_phone" text,
	"location_count" integer DEFAULT 1,
	"estimated_ticket_size" text,
	"estimated_volume" text,
	"service_type" text,
	"has_booking_system" boolean DEFAULT false,
	"has_ecommerce" boolean DEFAULT false,
	"billing_hints" text,
	"website_quality" text,
	"business_maturity" text,
	"contact_quality" text,
	"decision_reason" text,
	"paused_until" timestamp,
	"source_type" text DEFAULT 'import',
	"source_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdr_lead_state_merchant_id_unique" UNIQUE("merchant_id")
);
--> statement-breakpoint
CREATE TABLE "sdr_merchant_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer,
	"contact_name" text,
	"title" text,
	"email" text,
	"mobile" text,
	"direct_phone" text,
	"role_guess" text,
	"primary_contact_flag" boolean DEFAULT false,
	"consent_sms" boolean DEFAULT false,
	"consent_email" boolean DEFAULT false,
	"consent_call" boolean DEFAULT false,
	"consent_source" text,
	"consent_at" timestamp,
	"timezone" text,
	"best_contact_channel" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdr_merchants" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"domain" text,
	"main_phone" text,
	"main_email" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"vertical" text,
	"subvertical" text,
	"source" text,
	"source_ref" text,
	"ghl_contact_id" text,
	"ghl_opportunity_id" text,
	"existing_customer_flag" boolean DEFAULT false,
	"do_not_contact_flag" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sending_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"domain" text NOT NULL,
	"email_address" text NOT NULL,
	"mailbox_type" text DEFAULT 'google_workspace',
	"provider" text,
	"ghl_location_id" text,
	"is_active" boolean DEFAULT true,
	"warmup_status" text DEFAULT 'warming',
	"warmup_started_at" timestamp,
	"daily_limit" integer DEFAULT 30,
	"sent_today" integer DEFAULT 0,
	"bounces_today" integer DEFAULT 0,
	"complaints_today" integer DEFAULT 0,
	"health_score" real DEFAULT 100,
	"vertical_assignment" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "proposal_token" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "proposal_email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "proposal_status" text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "identity_performance_daily" ADD CONSTRAINT "identity_performance_daily_sending_identity_id_sending_identities_id_fk" FOREIGN KEY ("sending_identity_id") REFERENCES "public"."sending_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_channel_attempts" ADD CONSTRAINT "sdr_channel_attempts_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_channel_attempts" ADD CONSTRAINT "sdr_channel_attempts_lead_state_id_sdr_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."sdr_lead_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_compliance_state" ADD CONSTRAINT "sdr_compliance_state_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_contact_id_sdr_merchant_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."sdr_merchant_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_lead_state_id_sdr_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."sdr_lead_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD CONSTRAINT "sdr_lead_state_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD CONSTRAINT "sdr_lead_state_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_merchant_contacts" ADD CONSTRAINT "sdr_merchant_contacts_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;