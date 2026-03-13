CREATE TABLE "agent_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"target_deals" integer DEFAULT 0,
	"target_revenue" text DEFAULT '0',
	"target_volume" text DEFAULT '0',
	"actual_deals" integer DEFAULT 0,
	"actual_revenue" text DEFAULT '0',
	"actual_volume" text DEFAULT '0',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'sales_rep',
	"manager_id" integer,
	"commission_split_percent" integer DEFAULT 50,
	"status" text DEFAULT 'active',
	"territory" text,
	"hire_date" timestamp,
	"total_deals" integer DEFAULT 0,
	"total_revenue" text DEFAULT '0',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"all_day" boolean DEFAULT false,
	"type" text DEFAULT 'meeting',
	"contact_id" integer,
	"deal_id" integer,
	"owner_id" text,
	"location" text,
	"ghl_event_id" text,
	"status" text DEFAULT 'scheduled',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"duration" integer,
	"outcome" text,
	"summary" text,
	"ai_summary" text,
	"recording_url" text,
	"caller_name" text,
	"next_steps" text,
	"sentiment" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"step_order" integer NOT NULL,
	"step_type" text NOT NULL,
	"delay_days" integer DEFAULT 0,
	"subject" text,
	"body_template" text,
	"ai_prompt" text,
	"use_ai_personalization" boolean DEFAULT true,
	"channel" text DEFAULT 'email',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_list_id" integer,
	"target_verticals" text[],
	"target_scores" text[],
	"filter_criteria" jsonb,
	"ai_personalization" boolean DEFAULT true,
	"total_steps" integer DEFAULT 3,
	"status" text DEFAULT 'draft',
	"daily_send_limit" integer DEFAULT 200,
	"total_sent" integer DEFAULT 0,
	"total_opened" integer DEFAULT 0,
	"total_replied" integer DEFAULT 0,
	"total_bounced" integer DEFAULT 0,
	"total_unsubscribed" integer DEFAULT 0,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collateral_packets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"offer_path" text,
	"vertical" text,
	"tags" text[],
	"pages" text[],
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"parent_id" integer,
	"content" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"mentions" jsonb,
	"pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commission_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"min_referrals" integer DEFAULT 1 NOT NULL,
	"max_referrals" integer,
	"commission_amount" text DEFAULT '100' NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"dba" text,
	"vertical" text,
	"address" text,
	"website" text,
	"volume_range" text,
	"current_provider" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "consent_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"user_id" text,
	"channel" text NOT NULL,
	"action" text NOT NULL,
	"consented" boolean NOT NULL,
	"source" text,
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"company_id" integer,
	"role" text DEFAULT 'Owner',
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"company_name" text,
	"vertical" text,
	"monthly_volume" text,
	"estimated_processing_volume" text,
	"estimated_residual" text,
	"volume_confidence" text,
	"primary_offer_path" text,
	"interested_in_0_percent" boolean DEFAULT false,
	"need_terminal" boolean DEFAULT false,
	"current_provider" text,
	"preferred_channel" text,
	"consent_sms" boolean DEFAULT false,
	"consent_email" boolean DEFAULT false,
	"do_not_contact" boolean DEFAULT false,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"landing_page" text,
	"promo_code" text,
	"tags" text[],
	"notes" text,
	"status" text DEFAULT 'New',
	"ghl_contact_id" text,
	"lead_score" integer DEFAULT 0,
	"rev_potential_score" integer DEFAULT 0,
	"switchability_score" integer DEFAULT 0,
	"uw_confidence_score" integer DEFAULT 0,
	"engagement_score" integer DEFAULT 0,
	"score_breakdown" jsonb,
	"last_scored_at" timestamp,
	"pain_points" text[],
	"contract_status" text,
	"looking_reason" text,
	"referral_source" text,
	"avg_ticket" text,
	"location_count" integer DEFAULT 1,
	"business_age" text,
	"sms_opt_in_at" timestamp,
	"email_opt_in_at" timestamp,
	"dnc_reason" text,
	"contact_attempts" integer DEFAULT 0,
	"last_contacted_at" timestamp,
	"last_contact_channel" text,
	"cooling_until" timestamp,
	"title" text,
	"address" text,
	"city" text,
	"state" text,
	"website" text,
	"linkedin_url" text,
	"facebook_url" text,
	"industry" text,
	"lead_source" text,
	"employee_count" integer,
	"annual_revenue" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "csv_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"source_format" text DEFAULT 'custom',
	"total_rows" integer DEFAULT 0,
	"new_records" integer DEFAULT 0,
	"duplicates_skipped" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"vertical_breakdown" jsonb,
	"import_source" text,
	"status" text DEFAULT 'processing',
	"imported_by" text,
	"deals_created" integer DEFAULT 0,
	"hot_leads" integer DEFAULT 0,
	"warm_leads" integer DEFAULT 0,
	"cold_leads" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "data_delete_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"request_type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending',
	"processed_by" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"competitor_name" text NOT NULL,
	"competitor_rate" text,
	"competitor_program" text,
	"result" text,
	"loss_reason" text,
	"win_factor" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"company_id" integer,
	"pipeline" text DEFAULT 'sales' NOT NULL,
	"stage" text DEFAULT 'New Lead' NOT NULL,
	"owner" text,
	"priority_score" integer DEFAULT 0,
	"offer_path" text,
	"next_follow_up" timestamp,
	"effective_rate" text,
	"total_volume" text,
	"total_fees" text,
	"avg_ticket" text,
	"highest_ticket" text,
	"estimated_gross_profit_bps" integer,
	"estimated_gross_profit_monthly" text,
	"estimated_net_profit_monthly" text,
	"merchant_tier" text,
	"risk_tier" text,
	"health_score" text,
	"churn_risk_flag" text,
	"top_cost_drivers" text[],
	"recommended_path" text,
	"terminal_recommendation" text,
	"terminal_status" text,
	"funding_notes" text,
	"expected_go_live_date" timestamp,
	"go_live_date" timestamp,
	"last_statement_review_date" timestamp,
	"next_statement_review_date" timestamp,
	"onboarding_status_notes" text,
	"lead_source" text,
	"promo_code" text,
	"referred_by" text,
	"partner_type" text,
	"campaign_name" text,
	"notes" text,
	"deal_blueprint" jsonb,
	"savings_proposal" jsonb,
	"proposal_generated_at" timestamp,
	"recommended_program" text,
	"hardware_package" text,
	"est_monthly_revenue" text,
	"underwriting_path" text,
	"competitive_positioning" text,
	"rep_briefing" text,
	"rep_opener" text,
	"likely_objections" text[],
	"statement_received" boolean DEFAULT false,
	"voided_check_received" boolean DEFAULT false,
	"id_received" boolean DEFAULT false,
	"app_completed" boolean DEFAULT false,
	"doc_readiness_score" integer DEFAULT 0,
	"last_nudge_at" timestamp,
	"next_nudge_at" timestamp,
	"blueprint_generated_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"type" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text,
	"access_scope" text DEFAULT 'internal',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"from_address" text,
	"to_address" text,
	"subject" text,
	"body" text,
	"snippet" text,
	"template_id" integer,
	"status" text DEFAULT 'sent',
	"opened_at" timestamp,
	"replied_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enrichment_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer,
	"prospect_id" integer,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"total_count" integer DEFAULT 0,
	"processed_count" integer DEFAULT 0,
	"result" jsonb,
	"error" text,
	"error_log" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "equipment_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"deal_id" integer,
	"contact_id" integer,
	"equipment_type" text NOT NULL,
	"quantity" integer DEFAULT 1,
	"shipping_address" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_zip" text,
	"tracking_number" text,
	"status" text DEFAULT 'pending',
	"ordered_at" timestamp,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"trigger_config" jsonb,
	"total_steps" integer DEFAULT 0,
	"status" text DEFAULT 'active',
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "generated_blog_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"category" text NOT NULL,
	"author" text DEFAULT 'Liberty Bancard Team' NOT NULL,
	"read_time" text NOT NULL,
	"publish_date" text NOT NULL,
	"published_iso" text NOT NULL,
	"modified_iso" text NOT NULL,
	"keywords" text NOT NULL,
	"meta_description" text NOT NULL,
	"content" jsonb NOT NULL,
	"faqs" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"created_by" integer,
	CONSTRAINT "generated_blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ghl_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"template_id" integer,
	"subject" text,
	"body" text,
	"status" text DEFAULT 'sent',
	"ghl_message_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "health_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'warning',
	"title" text NOT NULL,
	"description" text,
	"metric" text,
	"current_value" text,
	"previous_value" text,
	"threshold" text,
	"status" text DEFAULT 'active',
	"acknowledged_at" timestamp,
	"acknowledged_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" text[],
	"sort_order" integer DEFAULT 0,
	"is_published" boolean DEFAULT true,
	"view_count" integer DEFAULT 0,
	"helpful_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"contact_id" integer,
	"company_id" integer,
	"deal_id" integer,
	"status" text DEFAULT 'draft',
	"current_step" integer DEFAULT 1,
	"total_steps" integer DEFAULT 6,
	"legal_business_name" text,
	"dba" text,
	"ein" text,
	"business_type" text,
	"business_start_date" text,
	"business_address" text,
	"business_city" text,
	"business_state" text,
	"business_zip" text,
	"business_phone" text,
	"business_email" text,
	"website" text,
	"vertical" text,
	"owner_first_name" text,
	"owner_last_name" text,
	"owner_email" text,
	"owner_phone" text,
	"owner_dob" text,
	"owner_ssn" text,
	"owner_address" text,
	"owner_city" text,
	"owner_state" text,
	"owner_zip" text,
	"ownership_percent" integer,
	"additional_owners" jsonb,
	"bank_name" text,
	"bank_routing_number" text,
	"bank_account_number" text,
	"bank_account_type" text,
	"estimated_monthly_volume" text,
	"estimated_avg_ticket" text,
	"highest_ticket" text,
	"current_processor" text,
	"current_rate" text,
	"accepted_card_types" text[],
	"terminal_needed" boolean DEFAULT false,
	"terminal_type" text,
	"terminal_quantity" integer DEFAULT 1,
	"ecommerce_needed" boolean DEFAULT false,
	"preferred_program" text,
	"referral_source" text,
	"referral_code" text,
	"esign_status" text DEFAULT 'pending',
	"esign_document_id" text,
	"esign_signing_url" text,
	"esigned_at" timestamp,
	"esign_ip" text,
	"underwriting_status" text DEFAULT 'pending',
	"underwriting_notes" text,
	"approved_at" timestamp,
	"declined_at" timestamp,
	"decline_reason" text,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"contact_id" integer,
	"company_id" integer,
	"deal_id" integer,
	"application_id" integer,
	"merchant_mid" text,
	"account_status" text DEFAULT 'pending',
	"go_live_date" timestamp,
	"current_monthly_volume" text,
	"last_statement_date" timestamp,
	"next_statement_date" timestamp,
	"program_type" text,
	"terminal_info" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_residuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer,
	"deal_id" integer,
	"contact_id" integer,
	"merchant_mid" text,
	"merchant_name" text,
	"month" text NOT NULL,
	"volume" text DEFAULT '0',
	"transactions" integer DEFAULT 0,
	"revenue" text DEFAULT '0',
	"cost" text DEFAULT '0',
	"net_revenue" text DEFAULT '0',
	"agent_id" integer,
	"agent_commission" text DEFAULT '0',
	"volume_change" text,
	"revenue_change" text,
	"flags" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"merge_fields" text[],
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"content" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"email_enabled" boolean DEFAULT false,
	"digest_daily" boolean DEFAULT true,
	"digest_weekly" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"recipient_id" text,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info',
	"read" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"application_id" integer,
	"step_name" text NOT NULL,
	"step_order" integer NOT NULL,
	"status" text DEFAULT 'pending',
	"completed_at" timestamp,
	"completed_by" text,
	"notes" text,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"step_id" integer,
	"prospect_id" integer,
	"contact_id" integer,
	"channel" text DEFAULT 'email',
	"to_email" text,
	"to_phone" text,
	"subject" text,
	"body" text,
	"personalized_subject" text,
	"personalized_body" text,
	"status" text DEFAULT 'queued',
	"scheduled_for" timestamp,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"replied_at" timestamp,
	"bounced_at" timestamp,
	"ghl_message_id" text,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"password_hash" text,
	"partner_type" text DEFAULT 'referral',
	"affiliate_code" text,
	"commission_percent" integer DEFAULT 10,
	"status" text DEFAULT 'pending',
	"total_referrals" integer DEFAULT 0,
	"total_conversions" integer DEFAULT 0,
	"total_payouts" text DEFAULT '0',
	"total_clicks" integer DEFAULT 0,
	"agreement_date" timestamp,
	"paypal_email" text,
	"website" text,
	"how_heard" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "partners_affiliate_code_unique" UNIQUE("affiliate_code")
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline" text NOT NULL,
	"stage_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#6366f1',
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospect_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_name" text,
	"total_records" integer DEFAULT 0,
	"enriched_records" integer DEFAULT 0,
	"qualified_records" integer DEFAULT 0,
	"status" text DEFAULT 'processing',
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer,
	"contact_id" integer,
	"company_name" text,
	"dba" text,
	"website" text,
	"phone" text,
	"email" text,
	"owner_first_name" text,
	"owner_last_name" text,
	"owner_email" text,
	"owner_phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"vertical" text,
	"estimated_volume" text,
	"estimated_residual" text,
	"estimated_avg_ticket" text,
	"estimated_processor" text,
	"employee_count" text,
	"year_established" text,
	"google_rating" text,
	"google_reviews" text,
	"estimated_revenue" text,
	"score" text DEFAULT 'cold',
	"qualification_score" text DEFAULT 'C',
	"qualification_reason" text,
	"status" text DEFAULT 'raw',
	"enrichment_data" jsonb,
	"enriched_at" timestamp,
	"ai_summary" text,
	"ai_pitch_angle" text,
	"notes" text,
	"tags" text[],
	"do_not_contact" boolean DEFAULT false,
	"last_contacted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer,
	"contact_id" integer,
	"deal_id" integer,
	"referred_name" text,
	"referred_email" text,
	"referred_phone" text,
	"referred_company" text,
	"status" text DEFAULT 'pending',
	"incentive_type" text DEFAULT 'commission',
	"incentive_amount" text,
	"commission_amount" text,
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "residual_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"processor" text,
	"total_merchants" integer DEFAULT 0,
	"total_volume" text DEFAULT '0',
	"total_transactions" integer DEFAULT 0,
	"total_revenue" text DEFAULT '0',
	"total_cost" text DEFAULT '0',
	"net_revenue" text DEFAULT '0',
	"avg_revenue_per_merchant" text DEFAULT '0',
	"new_merchants" integer DEFAULT 0,
	"lost_merchants" integer DEFAULT 0,
	"attrition_rate" text,
	"imported_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"channel" text DEFAULT 'email',
	"status" text DEFAULT 'pending',
	"sent_at" timestamp,
	"responded_at" timestamp,
	"rating" integer,
	"review_text" text,
	"platform" text,
	"review_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rfis" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"subject" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'General',
	"priority" text DEFAULT 'Normal',
	"status" text DEFAULT 'Open',
	"assigned_to" text,
	"requested_by" text,
	"due_date" timestamp,
	"response" text,
	"responded_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"filters" jsonb NOT NULL,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer,
	"contact_id" integer,
	"deal_id" integer,
	"current_step" integer DEFAULT 0,
	"status" text DEFAULT 'active',
	"next_action_at" timestamp,
	"completed_at" timestamp,
	"paused_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer,
	"step_order" integer NOT NULL,
	"action_type" text NOT NULL,
	"delay_days" integer DEFAULT 0,
	"delay_hours" integer DEFAULT 0,
	"subject" text,
	"body" text,
	"template_id" integer,
	"config" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sla_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"stage" text,
	"max_duration_minutes" integer NOT NULL,
	"escalation_action" text NOT NULL,
	"escalation_config" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stage_automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pipeline" text DEFAULT 'sales' NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT true,
	"priority" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sunbiz_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"filing_number" text,
	"fei_ein_number" text,
	"entity_name" text NOT NULL,
	"dba" text,
	"entity_type" text,
	"filing_date" text,
	"entity_status" text,
	"last_event" text,
	"last_event_date" text,
	"principal_address" text,
	"principal_city" text,
	"principal_state" text,
	"principal_zip" text,
	"mailing_address" text,
	"registered_agent_name" text,
	"registered_agent_address" text,
	"officers" jsonb,
	"website" text,
	"email" text,
	"phone" text,
	"owner_name" text,
	"owner_email" text,
	"owner_phone" text,
	"vertical" text,
	"score" text DEFAULT 'raw',
	"enrichment_status" text DEFAULT 'pending',
	"enrichment_data" jsonb,
	"enriched_at" timestamp,
	"ai_summary" text,
	"list_id" integer,
	"prospect_id" integer,
	"notes" text,
	"tags" text[],
	"source" text DEFAULT 'sunbiz',
	"search_query" text,
	"detail_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"ticket_id" integer,
	"title" text NOT NULL,
	"description" text,
	"assigned_to" text,
	"due_date" timestamp,
	"status" text DEFAULT 'pending',
	"priority" text DEFAULT 'normal',
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"content" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"is_internal" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'New Ticket',
	"priority" text DEFAULT 'Normal',
	"category" text DEFAULT 'Other',
	"assigned_to" text,
	"sla_deadline" timestamp,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"status" text DEFAULT 'running',
	"current_step" integer DEFAULT 0,
	"next_run_at" timestamp,
	"completed_at" timestamp,
	"log" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb,
	"actions" jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"password_hash" varchar,
	"role" varchar DEFAULT 'merchant',
	"auth_provider" varchar DEFAULT 'local',
	"email_verified" timestamp,
	"verification_token" varchar,
	"verification_expires_at" timestamp,
	"reset_token" varchar,
	"reset_expires_at" timestamp,
	"agent_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_quotas" ADD CONSTRAINT "agent_quotas_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_target_list_id_prospect_lists_id_fk" FOREIGN KEY ("target_list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ADD CONSTRAINT "consent_audit_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_competitors" ADD CONSTRAINT "deal_competitors_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_activity_log" ADD CONSTRAINT "ghl_activity_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_activity_log" ADD CONSTRAINT "ghl_activity_log_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_report_id_residual_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."residual_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunbiz_entities" ADD CONSTRAINT "sunbiz_entities_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunbiz_entities" ADD CONSTRAINT "sunbiz_entities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");