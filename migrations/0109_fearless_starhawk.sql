CREATE TABLE "ad_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"platform" text NOT NULL,
	"is_running_ads" boolean DEFAULT false,
	"confidence_score" real DEFAULT 0,
	"ad_count_estimate" integer DEFAULT 0,
	"last_seen_at" timestamp,
	"evidence" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_merchants" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"merchant_name" text,
	"mid" text,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_merchants_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
CREATE TABLE "agent_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_user_id" varchar NOT NULL,
	"partner_user_id" varchar,
	"partner_org_id" integer,
	"period_month" text NOT NULL,
	"gross_residual" text DEFAULT '0' NOT NULL,
	"agent_share" text DEFAULT '0' NOT NULL,
	"partner_share" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
	"vesting_months" integer DEFAULT 3,
	"total_deals" integer DEFAULT 0,
	"total_revenue" text DEFAULT '0',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"cost_cents" real DEFAULT 0,
	"response_summary" text,
	"error" text,
	"duration_ms" integer,
	"prompt_hash" text,
	"confidence_score" real,
	"flagged" boolean DEFAULT false,
	"raw_prompt" text,
	"raw_response" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"event_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"session_id" text,
	"visitor_id" text,
	"booking_tracking_id" text,
	"contact_id" integer,
	"deal_id" integer,
	"sequence_id" integer,
	"page_path" text,
	"landing_page" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"gclid_present" boolean,
	"fbclid_present" boolean,
	"msclkid_present" boolean,
	"offer_route" text,
	"vertical" text,
	"consent_tier" text,
	"lifecycle_stage" text,
	"source_category" text,
	"form_id" text,
	"channel" text,
	"block_reason" text,
	"deal_stage" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"entity_key" text,
	"details" jsonb,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_type" text DEFAULT 'user',
	"actor_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_started_at" timestamp,
	"last_finished_at" timestamp,
	"last_error" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "background_jobs_job_name_unique" UNIQUE("job_name")
);
--> statement-breakpoint
CREATE TABLE "bot_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"context_id" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"faq_items" jsonb DEFAULT '[]'::jsonb,
	"active" boolean DEFAULT true,
	"auto_reply_enabled" boolean DEFAULT false,
	"auto_reply_delay_seconds" integer DEFAULT 180,
	"confidence_threshold" integer DEFAULT 60,
	"channel" text DEFAULT 'all',
	"vertical_key" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "business_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"alias_name" text NOT NULL,
	"alias_type" text DEFAULT 'imported',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "business_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"location_name" text,
	"street_address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"phone" text,
	"email" text,
	"website_url" text,
	"google_place_id" text,
	"rating" real,
	"review_count" integer,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_domain" text,
	"main_phone" text,
	"main_email" text,
	"street_address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US',
	"latitude" real,
	"longitude" real,
	"industry_primary" text,
	"industry_secondary" text,
	"vertical" text,
	"sub_vertical" text,
	"google_place_id" text,
	"facebook_url" text,
	"instagram_url" text,
	"yelp_url" text,
	"is_multi_location" boolean DEFAULT false,
	"location_count_estimate" integer DEFAULT 1,
	"review_count" integer,
	"rating" real,
	"status" text DEFAULT 'new',
	"last_source_type" text,
	"last_enriched_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
CREATE TABLE "campaign_previews" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"eligible_count" integer,
	"total_in_verticals" integer,
	"blocked_count" integer,
	"block_reasons" jsonb DEFAULT '{}'::jsonb,
	"sample_contacts" jsonb DEFAULT '[]'::jsonb,
	"target_verticals" text[] DEFAULT '{}',
	"targeting_hash" text NOT NULL,
	"requested_by" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"expires_at" timestamp,
	"consumed_at" timestamp,
	"readiness_threshold" integer,
	"readiness_model_version" integer,
	"readiness_breakdown" jsonb
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
	"updated_at" timestamp DEFAULT now(),
	"readiness_threshold" integer
);
--> statement-breakpoint
CREATE TABLE "channel_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"action" text NOT NULL,
	"checklist_snapshot" jsonb,
	"actor_user_id" text,
	"actor_email" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chargebacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"transaction_date" timestamp NOT NULL,
	"amount" real NOT NULL,
	"card_brand" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_description" text,
	"status" text DEFAULT 'New' NOT NULL,
	"response_deadline" timestamp,
	"evidence_files" jsonb DEFAULT '[]'::jsonb,
	"responded_at" timestamp,
	"outcome" text,
	"notes" text,
	"ai_evidence_packet" jsonb DEFAULT 'null'::jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "churn_score_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_key" text NOT NULL,
	"label" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "churn_score_weights_signal_key_unique" UNIQUE("signal_key")
);
--> statement-breakpoint
CREATE TABLE "co_branded_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"partner_org_id" integer,
	"token" text NOT NULL,
	"status" text DEFAULT 'draft',
	"pricing_plan" text,
	"proposal_data" jsonb,
	"merchant_name" text,
	"merchant_monthly_volume" text,
	"merchant_effective_rate" text,
	"merchant_email" text,
	"custom_message" text,
	"delivered_at" timestamp,
	"viewed_at" timestamp,
	"view_count" integer DEFAULT 0,
	"accepted_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "co_branded_proposals_token_unique" UNIQUE("token")
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
	"management_type" text DEFAULT 'unknown' NOT NULL,
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
	"consent_type" text DEFAULT 'general_optin',
	"source" text,
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"disclosure_version" text,
	"disclosure_text" text,
	"form_id" text,
	"consented_phone" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_ai_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"cache_key" text NOT NULL,
	"output" jsonb NOT NULL,
	"model" text,
	"generated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "contact_lead_scoring_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"requested_generation" integer DEFAULT 1 NOT NULL,
	"processed_generation" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"trigger_sources" text[],
	"input_version_snapshot" timestamp with time zone,
	"enqueue_attempts" integer DEFAULT 0 NOT NULL,
	"execution_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_readiness_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"model_version" integer NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"total_eligible" integer,
	"processed" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"last_processed_contact_id" integer,
	"started_at" timestamp DEFAULT now(),
	"last_heartbeat_at" timestamp,
	"completed_at" timestamp,
	"last_error" text,
	CONSTRAINT "contact_readiness_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "contact_source_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"event_key" text NOT NULL,
	"source_category" text NOT NULL,
	"source_type" text NOT NULL,
	"source_external_id" text,
	"import_execution_id" uuid,
	"source_row_number" integer,
	"row_fingerprint" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"metadata" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"gclid" text,
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
	"linkedin_enriched_at" timestamp,
	"linkedin_enrichment_log" jsonb,
	"industry" text,
	"lead_source" text,
	"employee_count" integer,
	"annual_revenue" text,
	"business_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp,
	"partner_org_id" integer,
	"last_synced_at" timestamp,
	"churn_risk_tier" text,
	"is_parent_account" boolean DEFAULT false,
	"parent_contact_id" integer,
	"location_name" text,
	"email_status" text DEFAULT 'active' NOT NULL,
	"bounced_at" timestamp,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"decision_maker_confidence" integer DEFAULT 0 NOT NULL,
	"management_type" text DEFAULT 'unknown' NOT NULL,
	"sms_status" text DEFAULT 'active' NOT NULL,
	"last_voicemail_at" timestamp,
	"reachability_score" integer DEFAULT 100 NOT NULL,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"do_not_auto_contact" boolean DEFAULT false NOT NULL,
	"phone_type" text,
	"consent_tier" text DEFAULT 'cold_no_consent' NOT NULL,
	"lifecycle_stage" text DEFAULT 'prospect' NOT NULL,
	"timezone" text,
	"source_category" text,
	"offer_confidence" integer,
	"recommended_next_action" text,
	"offer_reasoning" text,
	"offer_routing_source" text,
	"processor_detected" text,
	"offer_routed_at" timestamp,
	"offer_matched_signals" jsonb,
	"opted_out_email" boolean DEFAULT false,
	"data_completeness_score" integer,
	"data_readiness_score" integer,
	"data_readiness_grade" text,
	"readiness_breakdown" jsonb,
	"readiness_updated_at" timestamp,
	"readiness_model_version" integer,
	"last_meaningful_contact_mutation_at" timestamp,
	"primary_source_category" text,
	"primary_source_type" text,
	"primary_source_event_id" integer,
	"vertical_source" text,
	"vertical_confidence" integer,
	"manual_vertical_override" boolean,
	"lead_consent_level" text DEFAULT 'unknown',
	"email_readiness" text DEFAULT 'unknown',
	"sms_consent_status" text DEFAULT 'not_collected',
	"opt_out_status" text DEFAULT 'active',
	"opt_out_date" timestamp,
	"opt_out_channel" text,
	"unsubscribe_status" text DEFAULT 'active',
	"unsubscribe_date" timestamp,
	"bounce_status" text DEFAULT 'none',
	"bounce_date" timestamp,
	"bounce_reason" text,
	"complaint_status" text DEFAULT 'none',
	"complaint_date" timestamp,
	"dnc_date" timestamp,
	"dnc_source" text,
	"existing_merchant_customer" boolean DEFAULT false,
	"suppression_reason" text,
	"suppression_history" jsonb DEFAULT '[]'::jsonb,
	"next_allowed_contact_date" timestamp,
	"consent_audit_trail" jsonb DEFAULT '[]'::jsonb,
	"referrer_url" text,
	"source_path" text,
	"import_batch_id" text,
	"row_provenance" jsonb,
	CONSTRAINT "contacts_vertical_confidence_range" CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100))
);
--> statement-breakpoint
CREATE TABLE "content_authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"bio" text NOT NULL,
	"long_bio" text,
	"avatar_url" text,
	"linkedin_url" text,
	"twitter_url" text,
	"website_url" text,
	"expertise" text[],
	"email" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "content_authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "csv_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"source_format" text DEFAULT 'custom',
	"total_rows" integer DEFAULT 0,
	"new_records" integer DEFAULT 0,
	"duplicates_skipped" integer DEFAULT 0,
	"updated_records" integer DEFAULT 0,
	"invalid_rows" integer DEFAULT 0,
	"skipped_rows" integer DEFAULT 0,
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
	"completed_at" timestamp,
	"processed_rows" integer,
	"last_progress_at" timestamp,
	"stale_reason" text,
	"opt_out_preserved" integer DEFAULT 0,
	"opt_out_applied" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "daily_funnel_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"vertical" text,
	"state" text,
	"source_type" text,
	"leads_found" integer DEFAULT 0,
	"leads_enriched" integer DEFAULT 0,
	"hot_created" integer DEFAULT 0,
	"warm_created" integer DEFAULT 0,
	"emails_sent" integer DEFAULT 0,
	"sms_sent" integer DEFAULT 0,
	"calls_made" integer DEFAULT 0,
	"replies" integer DEFAULT 0,
	"positive_replies" integer DEFAULT 0,
	"meetings_booked" integer DEFAULT 0,
	"statements_received" integer DEFAULT 0,
	"proposals_sent" integer DEFAULT 0,
	"proposals_viewed" integer DEFAULT 0,
	"apps_started" integer DEFAULT 0,
	"apps_completed" integer DEFAULT 0,
	"closed_won" integer DEFAULT 0,
	"closed_lost" integer DEFAULT 0,
	"revenue" text,
	"created_at" timestamp DEFAULT now()
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
	"terminal_approval_status" text DEFAULT 'not_required',
	"terminal_approval_task_id" integer,
	"terminal_cost_at_order" real,
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
	"proposal_token" text,
	"proposal_email_sent_at" timestamp,
	"proposal_status" text DEFAULT 'none',
	"analysis_status" text DEFAULT 'none',
	"statement_received" boolean DEFAULT false,
	"voided_check_received" boolean DEFAULT false,
	"id_received" boolean DEFAULT false,
	"app_completed" boolean DEFAULT false,
	"doc_readiness_score" integer DEFAULT 0,
	"last_nudge_at" timestamp,
	"next_nudge_at" timestamp,
	"blueprint_generated_at" timestamp,
	"closed_at" timestamp,
	"processor_application_id" text,
	"mid" text,
	"boarding_status" text DEFAULT 'not_submitted',
	"boarding_log" jsonb,
	"boarding_submitted_at" timestamp,
	"boarding_approved_at" timestamp,
	"share_token" varchar(64),
	"share_data" jsonb,
	"share_view_count" integer DEFAULT 0,
	"share_last_viewed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp,
	"partner_org_id" integer,
	"vertical" text,
	"auto_enrollment_suppressed_at" timestamp,
	"auto_enrollment_suppressed_reason" text,
	"sales_deal_id" integer,
	"attribution_gclid" text,
	"attribution_source" text,
	"attribution_medium" text,
	"attribution_campaign" text,
	"booking_attributed_at" timestamp,
	"conversion_attributed_at" timestamp,
	"ghl_opportunity_id" text,
	CONSTRAINT "deals_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "document_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"ip" text,
	"accessed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"type" text NOT NULL,
	"category" text DEFAULT 'Other',
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" text,
	"storage_key" text,
	"access_scope" text DEFAULT 'internal',
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "domain_business_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"business_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now()
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
	"clicked_at" timestamp,
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
CREATE TABLE "enrichment_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer,
	"contact_id" integer,
	"provider" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued',
	"input_payload" jsonb,
	"output_payload" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "entity_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" integer NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" integer NOT NULL,
	"relationship_type" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"risk_flag" boolean DEFAULT false,
	"risk_reason" text,
	"note" text,
	"dismissed_at" timestamp,
	"dismissed_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "equipment_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'Terminal',
	"description" text,
	"msrp" real DEFAULT 0 NOT NULL,
	"liberty_cost" real DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
	"liberty_cost" numeric,
	"estimated_monthly_gp" numeric,
	"payback_months" numeric,
	"approval_tier" text,
	"manager_approved" boolean DEFAULT false,
	"approved_at" timestamp,
	"approved_by_user_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "executive_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" numeric(15, 4) NOT NULL,
	"period" text DEFAULT 'weekly' NOT NULL,
	"label" text,
	"set_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "executive_goals_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "executive_weekly_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"closed_won_volume" numeric(15, 2) DEFAULT '0' NOT NULL,
	"closed_won_count" integer DEFAULT 0 NOT NULL,
	"gross_profit_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_profit_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross_margin_pct" numeric(8, 4) DEFAULT '0' NOT NULL,
	"net_margin_pct" numeric(8, 4) DEFAULT '0' NOT NULL,
	"pipeline_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"pipeline_deal_count" integer DEFAULT 0 NOT NULL,
	"new_leads" integer DEFAULT 0 NOT NULL,
	"proposals_sent" integer DEFAULT 0 NOT NULL,
	"statements_received" integer DEFAULT 0 NOT NULL,
	"meetings_booked" integer DEFAULT 0 NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"sms_sent" integer DEFAULT 0 NOT NULL,
	"calls_made" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"goals_snapshot" jsonb,
	"goals_vs_actuals" jsonb,
	"rep_breakdown" jsonb,
	"gpt_briefing" text,
	"claude_coaching" jsonb,
	"ai_generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "executive_weekly_snapshots_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"trigger_config" jsonb,
	"total_steps" integer DEFAULT 0,
	"status" text DEFAULT 'paused',
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"sequence_family" text,
	"eligible_consent_tiers" text[],
	"channels_allowed" text[],
	"offer_routes" text[],
	"lifecycle_stages_allowed" text[]
);
--> statement-breakpoint
CREATE TABLE "generated_blog_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"category" text NOT NULL,
	"author" text DEFAULT 'Liberty Bancard Team' NOT NULL,
	"author_id" integer,
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
	"pillar" text,
	"cluster" text,
	"seo_title" text,
	"og_image" text,
	"internal_links" jsonb,
	"reviewer_notes" text,
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
CREATE TABLE "ghl_sync_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_direction" text,
	"synced_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"last_error" text,
	"local_count" integer DEFAULT 0,
	"ghl_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ghl_workflow_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_name" text NOT NULL,
	"ghl_workflow_id" text,
	"category" text,
	"description" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true,
	"description" text,
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
CREATE TABLE "import_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_type" text NOT NULL,
	"file_hash" text,
	"status" text DEFAULT 'running' NOT NULL,
	"total_rows" integer,
	"inserted_rows" integer,
	"updated_rows" integer,
	"skipped_rows" integer,
	"error_rows" integer,
	"actor_type" text,
	"actor_id" text,
	"metadata" jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_item_id" text NOT NULL,
	"source_item_type" text DEFAULT 'email' NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"owner_id" text,
	"owner_name" text,
	"department" text DEFAULT 'sales',
	"status" text DEFAULT 'new',
	"priority" text DEFAULT 'normal',
	"sla_due_at" timestamp,
	"next_action" text,
	"escalation_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
CREATE TABLE "lead_discovery_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"search_verticals" text[],
	"search_metros" text[],
	"data_sources" text[],
	"raw_found" integer DEFAULT 0,
	"new_inserted" integer DEFAULT 0,
	"duplicates_skipped" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"enrichment_queued" integer DEFAULT 0,
	"cost_estimate" real DEFAULT 0,
	"error_log" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_discovery_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"source" text NOT NULL,
	"vertical" text,
	"metro" text,
	"business_name" text NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"rating" real,
	"review_count" integer,
	"place_id" text,
	"raw_data" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"merchant_id" integer,
	"dedup_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer,
	"contact_id" integer,
	"source_type" text NOT NULL,
	"source_label" text,
	"source_external_id" text,
	"source_url" text,
	"campaign_tag" text,
	"import_batch_id" text,
	"discovered_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leaderboard_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"show_deals" boolean DEFAULT true,
	"show_revenue" boolean DEFAULT true,
	"show_proposals" boolean DEFAULT true,
	"show_calls_made" boolean DEFAULT true,
	"show_response_rate" boolean DEFAULT false,
	"visible_to_agents" boolean DEFAULT true,
	"monthly_deal_goal" integer DEFAULT 10,
	"monthly_revenue_goal" text DEFAULT '50000',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "live_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"visitor_name" text,
	"visitor_email" text,
	"page_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"contact_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "live_chats_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "ma_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"counterparty_name" text,
	"counterparty_contact_id" integer,
	"event_date" timestamp,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "master_lead_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_name" text NOT NULL,
	"sheet_id" text,
	"sheet_name" text,
	"tab_name" text,
	"source_method" text DEFAULT 'csv_upload' NOT NULL,
	"total_rows" integer DEFAULT 0,
	"staged_count" integer DEFAULT 0,
	"duplicate_count" integer DEFAULT 0,
	"suppressed_count" integer DEFAULT 0,
	"invalid_count" integer DEFAULT 0,
	"promoted_count" integer DEFAULT 0,
	"ready_count" integer DEFAULT 0,
	"status" text DEFAULT 'processing' NOT NULL,
	"error_message" text,
	"imported_by" text,
	"imported_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "master_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid,
	"status" text DEFAULT 'staged' NOT NULL,
	"company" text,
	"normalized_company" text,
	"domain" text,
	"email" text,
	"email_type" text,
	"phone" text,
	"normalized_phone" text,
	"contact_name" text,
	"contact_title" text,
	"vertical" text,
	"quality_score" real,
	"fit_tier" text,
	"outreach_readiness" text,
	"readiness_reason" text,
	"source" text,
	"source_path" text,
	"source_modified_date" text,
	"address" text,
	"city" text,
	"state" text,
	"website" text,
	"email_valid" boolean,
	"phone_valid" boolean,
	"sms_eligible" boolean,
	"sheet_id" text,
	"sheet_name" text,
	"tab_name" text,
	"row_number" integer,
	"canonical_lead_id" uuid,
	"duplicate_of_id" uuid,
	"suppression_reason" text,
	"promoted_at" timestamp,
	"promoted_by" text,
	"notes" text,
	"imported_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
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
	"underwriting_notes_log" jsonb DEFAULT '[]'::jsonb,
	"approved_at" timestamp,
	"declined_at" timestamp,
	"decline_reason" text,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"draft_token_hash" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_health_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"churn_score" real DEFAULT 0 NOT NULL,
	"risk_tier" text DEFAULT 'Low' NOT NULL,
	"volume_trend_score" real DEFAULT 0,
	"chargeback_trend_score" real DEFAULT 0,
	"ticket_velocity_score" real DEFAULT 0,
	"nps_score" real DEFAULT 0,
	"portal_activity_score" real DEFAULT 0,
	"outreach_response_score" real DEFAULT 0,
	"override_score" real,
	"override_note" text,
	"overridden_at" timestamp,
	"overridden_by" text,
	"retention_campaign_triggered" boolean DEFAULT false,
	"agent_notified" boolean DEFAULT false,
	"computed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_onboarding_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"stage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"equipment_order_ref" text,
	"ghl_stage_synced_at" timestamp,
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
	"referral_code" text,
	"referral_credits" text DEFAULT '0',
	"referral_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "merchant_profiles_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "merchant_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_profile_id" integer,
	"referred_email" text NOT NULL,
	"referred_name" text,
	"referred_company" text,
	"referral_code" text NOT NULL,
	"status" text DEFAULT 'pending',
	"credit_amount" text DEFAULT '0',
	"credit_paid_at" timestamp,
	"referred_contact_id" integer,
	"referred_deal_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_residuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer,
	"import_id" integer,
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
	"partner_commission" text DEFAULT '0',
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
CREATE TABLE "mid_daily_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"mid" text NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"date" text NOT NULL,
	"volume" real DEFAULT 0,
	"tx_count" integer DEFAULT 0,
	"avg_ticket" real DEFAULT 0,
	"effective_rate" real DEFAULT 0,
	"chargeback_count" integer DEFAULT 0,
	"chargeback_amount" real DEFAULT 0,
	"refund_count" integer DEFAULT 0,
	"fetched_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
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
CREATE TABLE "nps_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"merchant_profile_id" integer,
	"day_trigger" integer NOT NULL,
	"score" integer,
	"comment" text,
	"submitted_at" timestamp,
	"email_sent_at" timestamp,
	"send_attempted_at" timestamp,
	"review_request_queued" boolean DEFAULT false,
	"health_alert_created" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "nps_responses_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"status" text DEFAULT 'not_requested',
	"document_id" integer,
	"notes" text,
	"updated_at" timestamp DEFAULT now(),
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
	"sending_at" timestamp,
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
CREATE TABLE "outbound_send_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_send_counters_date_channel_scope_uidx" UNIQUE("date","channel","scope")
);
--> statement-breakpoint
CREATE TABLE "partner_org_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_org_id" integer NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '',
	"password_hash" text,
	"role" text DEFAULT 'member',
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partner_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"primary_color" text DEFAULT '#2563eb',
	"tagline" text,
	"commission_rate" real DEFAULT 10,
	"status" text DEFAULT 'active',
	"contact_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "partner_organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"password_hash" text,
	"password_reset_token" text,
	"password_reset_expires_at" timestamp,
	"invite_token" text,
	"invite_token_expires_at" timestamp,
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
	"referral_owner" text,
	"commission_status" text DEFAULT 'pending',
	"last_contact_at" timestamp,
	"partner_category" text DEFAULT 'referral',
	"referred_count" integer DEFAULT 0,
	"pipeline_value" text DEFAULT '0',
	"next_followup_task_id" integer,
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
CREATE TABLE "processor_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"signal_type" text NOT NULL,
	"vendor_name" text NOT NULL,
	"detection_method" text NOT NULL,
	"confidence_score" real DEFAULT 0,
	"evidence" text,
	"detected_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "promotional_enrollment_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_event_id" text NOT NULL,
	"contact_id" integer NOT NULL,
	"trigger_type" text NOT NULL,
	"form_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_codes" text[],
	"enrollment_ids" integer[],
	"attempts" integer DEFAULT 0 NOT NULL,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "promotional_enrollment_jobs_source_event_id_unique" UNIQUE("source_event_id")
);
--> statement-breakpoint
CREATE TABLE "prospect_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_name" text,
	"file_hash" text,
	"import_type" text,
	"total_records" integer DEFAULT 0,
	"enriched_records" integer DEFAULT 0,
	"qualified_records" integer DEFAULT 0,
	"inserted_rows" integer DEFAULT 0,
	"skipped_within_file" integer DEFAULT 0,
	"skipped_existing" integer DEFAULT 0,
	"conflict_rows" integer DEFAULT 0,
	"actor" text,
	"status" text DEFAULT 'processing',
	"uploaded_by" text,
	"archived_at" timestamp,
	"archived_reason" text,
	"readiness_state" text DEFAULT 'uploaded' NOT NULL,
	"lead_source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer,
	"import_execution_id" integer,
	"source_row_index" integer,
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
	"conversion_claim_id" text,
	"conversion_claimed_at" timestamp,
	"conversion_claim_owner_id" text,
	"conversion_contact_id" integer,
	"conversion_last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"auth" text NOT NULL,
	"p256dh" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_review_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"document_id" integer,
	"status" text DEFAULT 'requested',
	"analysis_result" jsonb,
	"is_optimal_pricing" boolean,
	"request_notes" text,
	"rep_viewed_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution" text,
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
	"converted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "registry_import_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"raw_row" jsonb NOT NULL,
	"matched_merchant_id" integer,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"match_confidence" integer,
	"match_basis" jsonb,
	"contradictions" jsonb,
	"runner_up_merchant_id" integer,
	"runner_up_confidence" integer,
	"match_algorithm_version" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "residual_import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"mid" text NOT NULL,
	"merchant_name" text,
	"volume" text DEFAULT '0',
	"gross_residual" text DEFAULT '0',
	"net_residual" text DEFAULT '0',
	"expected_residual" text DEFAULT '0',
	"variance" text DEFAULT '0',
	"variance_pct" text DEFAULT '0',
	"variance_status" text DEFAULT 'in_range',
	"is_matched" boolean DEFAULT false,
	"matched_deal_id" integer,
	"matched_profile_id" integer,
	"agent_id" integer,
	"agent_name" text,
	"raw_data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "residual_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"imported_by" text,
	"total_rows" integer DEFAULT 0,
	"matched_rows" integer DEFAULT 0,
	"unmatched_rows" integer DEFAULT 0,
	"flagged_rows" integer DEFAULT 0,
	"total_gross_residual" text DEFAULT '0',
	"total_net_residual" text DEFAULT '0',
	"total_variance" text DEFAULT '0',
	"variance_threshold_pct" real DEFAULT 5,
	"variance_threshold_amt" real DEFAULT 50,
	"confirmed_at" timestamp,
	"confirmed_by" text,
	"created_at" timestamp DEFAULT now()
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
CREATE TABLE "retention_campaign_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"campaign_name" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"suggested_message" text,
	"task_priority" text DEFAULT 'high',
	"task_due_days" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checklist_state" jsonb DEFAULT '{}'::jsonb,
	"approved_by" text,
	"approved_at" timestamp,
	"ghl_workflow_id" text,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
	"google_clicked_at" timestamp,
	"trustpilot_clicked_at" timestamp,
	"nps_response_id" integer,
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
CREATE TABLE "roleplay_exchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"rep_message" text NOT NULL,
	"merchant_reply" text NOT NULL,
	"tone_score" integer,
	"clarity_score" integer,
	"objection_addressed" boolean,
	"feedback" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "roleplay_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"scenario" text NOT NULL,
	"persona" text NOT NULL,
	"difficulty" text DEFAULT 'standard',
	"status" text DEFAULT 'active',
	"total_exchanges" integer DEFAULT 0,
	"overall_score" integer,
	"coaching_summary" text,
	"strengths" text[],
	"gaps" text[],
	"suggested_phrasing" text[],
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
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
	"business_id" integer,
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
	"processor_score" integer DEFAULT 0,
	"growth_score" integer DEFAULT 0,
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
	"statement_upload_token" text,
	"statement_requested_at" timestamp,
	"statement_reminder_count" integer DEFAULT 0,
	"proposal_tracking_id" text,
	"proposal_viewed_at" timestamp,
	"proposal_clicked_at" timestamp,
	"proposal_resend_count" integer DEFAULT 0,
	"assigned_user_id" text,
	"assigned_owner_type" text DEFAULT 'ai',
	"human_handoff_at" timestamp,
	"human_handoff_note" text,
	"no_show_count" integer DEFAULT 0,
	"deal_id" integer,
	"vertical_source" text,
	"vertical_confidence" integer,
	"vertical_resolution_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdr_lead_state_merchant_id_unique" UNIQUE("merchant_id"),
	CONSTRAINT "sdr_lead_state_vertical_confidence_range" CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100))
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
	"email_confidence" integer DEFAULT 0,
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
	"business_id" integer,
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
	"owner_first_name" text,
	"owner_last_name" text,
	"formation_date" date,
	"years_in_business" integer,
	"registry_source" text,
	"license_number" text,
	"bbb_accredited" boolean DEFAULT false,
	"source_count" integer DEFAULT 1,
	"sourced_via" text,
	"owner_enrichment_status" text DEFAULT 'pending',
	"vertical_source" text,
	"vertical_confidence" integer,
	"subvertical_source" text,
	"subvertical_confidence" integer,
	"manual_vertical_override" boolean,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdr_merchants_vertical_confidence_range" CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100)),
	CONSTRAINT "sdr_merchants_subvertical_confidence_range" CHECK (subvertical_confidence IS NULL OR (subvertical_confidence BETWEEN 0 AND 100))
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
	"variant_b_subject" text,
	"variant_b_body" text,
	"ab_test_config" jsonb,
	"ab_test_results" jsonb,
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
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text DEFAULT 'linkedin' NOT NULL,
	"body" text NOT NULL,
	"hashtags" text[],
	"link_url" text,
	"image_url" text,
	"author_id" integer,
	"author_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"external_post_id" text,
	"external_post_url" text,
	"pillar" text,
	"cluster" text,
	"reviewer_notes" text,
	"created_at" timestamp DEFAULT now(),
	"created_by" integer
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
CREATE TABLE "statement_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"contact_id" integer,
	"status" text DEFAULT 'draft',
	"merchant_name" text,
	"source" text,
	"statement_file_name" text,
	"plans" jsonb,
	"savings_estimate" text,
	"effective_rate" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "statement_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"deal_id" integer,
	"sdr_lead_state_id" integer,
	"status" text DEFAULT 'requested' NOT NULL,
	"upload_token" text NOT NULL,
	"upload_url" text NOT NULL,
	"requested_at" timestamp NOT NULL,
	"uploaded_at" timestamp,
	"reviewed_at" timestamp,
	"abandoned_at" timestamp,
	"last_reminder_task_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"contact_id" integer,
	"deal_id" integer,
	"status" text DEFAULT 'received',
	"analyst_id" text,
	"analyst_name" text,
	"ai_summary" jsonb,
	"analyst_notes" text,
	"savings_estimate_override" text,
	"follow_up_draft" text,
	"follow_up_sent_at" timestamp,
	"reviewed_at" timestamp,
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
	"import_execution_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"internal_value" text,
	"ghl_value" text,
	"internal_updated_at" timestamp,
	"ghl_updated_at" timestamp,
	"resolution" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_audit_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overall_score" integer,
	"probe_results" jsonb,
	"claude_narrative" text,
	"slack_status" text DEFAULT 'skipped' NOT NULL,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"ghl_task_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"source" text,
	"automation_key" text
);
--> statement-breakpoint
CREATE TABLE "testimonial_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"email" text NOT NULL,
	"phone" text,
	"industry" text,
	"video_link" text,
	"savings_amount" text,
	"story" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"publish" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_notes" text,
	"contact_id" integer,
	"deal_id" integer,
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
CREATE TABLE "tool_click_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"tool_title" text,
	"source" text DEFAULT 'sales-tools-hub',
	"user_id" text,
	"session_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "underwriting_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"decision" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"reasons" text[],
	"rules_snapshot" jsonb,
	"decided_at" timestamp DEFAULT now(),
	"overridden_by" text,
	"overridden_at" timestamp,
	"override_action" text,
	"override_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "underwriting_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"min_monthly_volume" numeric DEFAULT '5000',
	"max_monthly_volume" numeric DEFAULT '500000',
	"effective_rate_ceiling" numeric DEFAULT '3.5',
	"chargeback_rate_limit" numeric DEFAULT '1.0',
	"chargeback_rate_hard_limit" numeric DEFAULT '2.0',
	"volume_hard_deviation_pct" numeric DEFAULT '50',
	"allowed_processors" text[],
	"blocked_processors" text[],
	"auto_approve_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "virtual_terminal_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"gateway_transaction_id" text,
	"auth_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" text NOT NULL,
	"refunded_amount" text DEFAULT '0',
	"card_type" text,
	"last_four" text,
	"cardholder_name" text,
	"billing_zip" text,
	"memo" text,
	"response_code" text,
	"response_text" text,
	"processed_by" text,
	"refunded_by" text,
	"refunded_at" timestamp,
	"raw_response" jsonb,
	"created_at" timestamp DEFAULT now()
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
	"trigger_conditions" jsonb,
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
CREATE TABLE "user_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"session_id" varchar NOT NULL,
	"ip" varchar,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	"last_active_at" timestamp DEFAULT now(),
	"is_invalidated" boolean DEFAULT false,
	"invalidated_at" timestamp
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
	"totp_secret" varchar,
	"totp_enabled" boolean DEFAULT false,
	"totp_backup_codes" jsonb,
	"trusted_devices" jsonb,
	"permissions" jsonb DEFAULT '[]'::jsonb,
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
CREATE TABLE "assistant_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"flagged_injection" boolean DEFAULT false NOT NULL,
	"flagged_pii" boolean DEFAULT false NOT NULL,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"audience" text DEFAULT 'public' NOT NULL,
	"user_id" integer,
	"contact_id" integer,
	"ip_hash" text,
	"metadata" jsonb,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_unanswered" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"audience" text DEFAULT 'public' NOT NULL,
	"question" text NOT NULL,
	"ai_response" text,
	"reviewed_at" timestamp,
	"reviewer_id" integer,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb,
	"token_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_type" text DEFAULT 'text_block' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience" text DEFAULT 'public' NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp,
	"last_indexed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_signals" ADD CONSTRAINT "ad_signals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_merchants" ADD CONSTRAINT "agent_merchants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_merchants" ADD CONSTRAINT "agent_merchants_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_partner_org_id_partner_organizations_id_fk" FOREIGN KEY ("partner_org_id") REFERENCES "public"."partner_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quotas" ADD CONSTRAINT "agent_quotas_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_aliases" ADD CONSTRAINT "business_aliases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_previews" ADD CONSTRAINT "campaign_previews_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_target_list_id_prospect_lists_id_fk" FOREIGN KEY ("target_list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_branded_proposals" ADD CONSTRAINT "co_branded_proposals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_branded_proposals" ADD CONSTRAINT "co_branded_proposals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_branded_proposals" ADD CONSTRAINT "co_branded_proposals_partner_org_id_partner_organizations_id_fk" FOREIGN KEY ("partner_org_id") REFERENCES "public"."partner_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ADD CONSTRAINT "consent_audit_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_ai_cache" ADD CONSTRAINT "contact_ai_cache_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lead_scoring_jobs" ADD CONSTRAINT "contact_lead_scoring_jobs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_source_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_source_events_import_execution_id_import_executions_id_fk" FOREIGN KEY ("import_execution_id") REFERENCES "public"."import_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_primary_source_event_id_contact_source_events_id_fk" FOREIGN KEY ("primary_source_event_id") REFERENCES "public"."contact_source_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_competitors" ADD CONSTRAINT "deal_competitors_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sales_deal_id_deals_id_fk" FOREIGN KEY ("sales_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_orders" ADD CONSTRAINT "equipment_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_activity_log" ADD CONSTRAINT "ghl_activity_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_activity_log" ADD CONSTRAINT "ghl_activity_log_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_performance_daily" ADD CONSTRAINT "identity_performance_daily_sending_identity_id_sending_identities_id_fk" FOREIGN KEY ("sending_identity_id") REFERENCES "public"."sending_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_discovery_results" ADD CONSTRAINT "lead_discovery_results_job_id_lead_discovery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."lead_discovery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_chat_id_live_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."live_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_chats" ADD CONSTRAINT "live_chats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ma_events" ADD CONSTRAINT "ma_events_counterparty_contact_id_contacts_id_fk" FOREIGN KEY ("counterparty_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_leads" ADD CONSTRAINT "master_leads_import_batch_id_master_lead_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."master_lead_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_leads" ADD CONSTRAINT "master_leads_duplicate_of_id_master_leads_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."master_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_health_scores" ADD CONSTRAINT "merchant_health_scores_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_onboarding_stages" ADD CONSTRAINT "merchant_onboarding_stages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_referrals" ADD CONSTRAINT "merchant_referrals_referrer_profile_id_merchant_profiles_id_fk" FOREIGN KEY ("referrer_profile_id") REFERENCES "public"."merchant_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_referrals" ADD CONSTRAINT "merchant_referrals_referred_contact_id_contacts_id_fk" FOREIGN KEY ("referred_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_referrals" ADD CONSTRAINT "merchant_referrals_referred_deal_id_deals_id_fk" FOREIGN KEY ("referred_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_report_id_residual_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."residual_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_import_id_residual_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."residual_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_residuals" ADD CONSTRAINT "merchant_residuals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mid_daily_stats" ADD CONSTRAINT "mid_daily_stats_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mid_daily_stats" ADD CONSTRAINT "mid_daily_stats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_merchant_profile_id_merchant_profiles_id_fk" FOREIGN KEY ("merchant_profile_id") REFERENCES "public"."merchant_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_org_users" ADD CONSTRAINT "partner_org_users_partner_org_id_partner_organizations_id_fk" FOREIGN KEY ("partner_org_id") REFERENCES "public"."partner_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processor_signals" ADD CONSTRAINT "processor_signals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotional_enrollment_jobs" ADD CONSTRAINT "promotional_enrollment_jobs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_import_execution_id_prospect_lists_id_fk" FOREIGN KEY ("import_execution_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_conversion_contact_id_contacts_id_fk" FOREIGN KEY ("conversion_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_review_requests" ADD CONSTRAINT "rate_review_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_review_requests" ADD CONSTRAINT "rate_review_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_review_requests" ADD CONSTRAINT "rate_review_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_import_log" ADD CONSTRAINT "registry_import_log_matched_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("matched_merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_import_log" ADD CONSTRAINT "registry_import_log_runner_up_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("runner_up_merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_import_id_residual_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."residual_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_matched_deal_id_deals_id_fk" FOREIGN KEY ("matched_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roleplay_exchanges" ADD CONSTRAINT "roleplay_exchanges_session_id_roleplay_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."roleplay_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_channel_attempts" ADD CONSTRAINT "sdr_channel_attempts_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_channel_attempts" ADD CONSTRAINT "sdr_channel_attempts_lead_state_id_sdr_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."sdr_lead_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_compliance_state" ADD CONSTRAINT "sdr_compliance_state_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_contact_id_sdr_merchant_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."sdr_merchant_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_events" ADD CONSTRAINT "sdr_lead_events_lead_state_id_sdr_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."sdr_lead_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD CONSTRAINT "sdr_lead_state_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD CONSTRAINT "sdr_lead_state_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD CONSTRAINT "sdr_lead_state_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_merchant_contacts" ADD CONSTRAINT "sdr_merchant_contacts_merchant_id_sdr_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."sdr_merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_merchants" ADD CONSTRAINT "sdr_merchants_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_proposals" ADD CONSTRAINT "statement_proposals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_proposals" ADD CONSTRAINT "statement_proposals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_requests" ADD CONSTRAINT "statement_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_requests" ADD CONSTRAINT "statement_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_requests" ADD CONSTRAINT "statement_requests_sdr_lead_state_id_sdr_lead_state_id_fk" FOREIGN KEY ("sdr_lead_state_id") REFERENCES "public"."sdr_lead_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reviews" ADD CONSTRAINT "statement_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reviews" ADD CONSTRAINT "statement_reviews_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reviews" ADD CONSTRAINT "statement_reviews_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunbiz_entities" ADD CONSTRAINT "sunbiz_entities_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunbiz_entities" ADD CONSTRAINT "sunbiz_entities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunbiz_entities" ADD CONSTRAINT "sunbiz_entities_import_execution_id_import_executions_id_fk" FOREIGN KEY ("import_execution_id") REFERENCES "public"."import_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial_submissions" ADD CONSTRAINT "testimonial_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial_submissions" ADD CONSTRAINT "testimonial_submissions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "underwriting_decisions" ADD CONSTRAINT "underwriting_decisions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_signals_business_id_idx" ON "ad_signals" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "ad_signals_platform_idx" ON "ad_signals" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "agent_merchants_agent_id_idx" ON "agent_merchants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_merchants_mid_idx" ON "agent_merchants" USING btree ("mid");--> statement-breakpoint
CREATE INDEX "agent_payouts_agent_user_id_idx" ON "agent_payouts" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "agent_payouts_status_idx" ON "agent_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_payouts_partner_org_idx" ON "agent_payouts" USING btree ("partner_org_id");--> statement-breakpoint
CREATE INDEX "ai_audit_logs_trigger_type_idx" ON "ai_audit_logs" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "ai_audit_logs_created_at_idx" ON "ai_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_audit_logs_flagged_idx" ON "ai_audit_logs" USING btree ("flagged");--> statement-breakpoint
CREATE INDEX "analytics_events_event_name_idx" ON "analytics_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_contact_id_idx" ON "analytics_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "analytics_events_utm_source_campaign_idx" ON "analytics_events" USING btree ("utm_source","utm_campaign");--> statement-breakpoint
CREATE INDEX "analytics_events_page_path_idx" ON "analytics_events" USING btree ("page_path");--> statement-breakpoint
CREATE INDEX "analytics_events_booking_tracking_id_idx" ON "analytics_events" USING btree ("booking_tracking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_event_id_idx" ON "analytics_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_key_idx" ON "audit_logs" USING btree ("entity_key");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_type_idx" ON "audit_logs" USING btree ("actor_type");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "background_jobs_job_name_idx" ON "background_jobs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_contexts_context_id_idx" ON "bot_contexts" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "businesses_normalized_name_city_state_idx" ON "businesses" USING btree ("normalized_name","city","state");--> statement-breakpoint
CREATE INDEX "businesses_website_domain_idx" ON "businesses" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "businesses_main_phone_idx" ON "businesses" USING btree ("main_phone");--> statement-breakpoint
CREATE INDEX "businesses_google_place_id_idx" ON "businesses" USING btree ("google_place_id");--> statement-breakpoint
CREATE INDEX "chargebacks_contact_id_idx" ON "chargebacks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "chargebacks_deal_id_idx" ON "chargebacks" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "chargebacks_status_idx" ON "chargebacks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chargebacks_response_deadline_idx" ON "chargebacks" USING btree ("response_deadline");--> statement-breakpoint
CREATE INDEX "chargebacks_created_at_idx" ON "chargebacks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "co_branded_proposals_partner_org_id_idx" ON "co_branded_proposals" USING btree ("partner_org_id");--> statement-breakpoint
CREATE INDEX "co_branded_proposals_deal_id_idx" ON "co_branded_proposals" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "co_branded_proposals_token_idx" ON "co_branded_proposals" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_ai_cache_contact_key_idx" ON "contact_ai_cache" USING btree ("contact_id","cache_key");--> statement-breakpoint
CREATE INDEX "contact_ai_cache_contact_id_idx" ON "contact_ai_cache" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_lead_scoring_jobs_contact_id_idx" ON "contact_lead_scoring_jobs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_lead_scoring_jobs_status_idx" ON "contact_lead_scoring_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_source_events_contact_key_uidx" ON "contact_source_events" USING btree ("contact_id","event_key");--> statement-breakpoint
CREATE INDEX "contact_source_events_contact_id_idx" ON "contact_source_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_source_events_import_execution_idx" ON "contact_source_events" USING btree ("import_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique_idx" ON "contacts" USING btree ("email") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_ghl_contact_id_unique" ON "contacts" USING btree ("ghl_contact_id") WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> '';--> statement-breakpoint
CREATE INDEX "contacts_created_at_idx" ON "contacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contacts_email_archived_at_idx" ON "contacts" USING btree ("email","archived_at");--> statement-breakpoint
CREATE INDEX "contacts_phone_archived_at_idx" ON "contacts" USING btree ("phone","archived_at");--> statement-breakpoint
CREATE INDEX "daily_funnel_metrics_date_idx" ON "daily_funnel_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "daily_funnel_metrics_date_vertical_idx" ON "daily_funnel_metrics" USING btree ("date","vertical");--> statement-breakpoint
CREATE INDEX "deals_contact_id_idx" ON "deals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "deals_pipeline_idx" ON "deals" USING btree ("pipeline");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "deals_pipeline_stage_idx" ON "deals" USING btree ("pipeline","stage");--> statement-breakpoint
CREATE INDEX "deals_created_at_idx" ON "deals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deals_sales_deal_id_idx" ON "deals" USING btree ("sales_deal_id");--> statement-breakpoint
CREATE INDEX "document_access_log_document_id_idx" ON "document_access_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_access_log_accessed_at_idx" ON "document_access_log" USING btree ("accessed_at");--> statement-breakpoint
CREATE INDEX "documents_contact_id_idx" ON "documents" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "documents_created_at_idx" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_logs_created_at_idx" ON "email_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_logs_contact_id_idx" ON "email_logs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_source_idx" ON "entity_relationships" USING btree ("source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_target_idx" ON "entity_relationships" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_type_idx" ON "entity_relationships" USING btree ("relationship_type");--> statement-breakpoint
CREATE INDEX "entity_relationships_risk_flag_idx" ON "entity_relationships" USING btree ("risk_flag");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relationships_unique_idx" ON "entity_relationships" USING btree ("source_entity_type","source_entity_id","target_entity_type","target_entity_id","relationship_type");--> statement-breakpoint
CREATE INDEX "exec_snapshots_week_start_idx" ON "executive_weekly_snapshots" USING btree ("week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "ghl_sync_status_entity_type_idx" ON "ghl_sync_status" USING btree ("entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ghl_workflow_mappings_sequence_name_idx" ON "ghl_workflow_mappings" USING btree ("sequence_name");--> statement-breakpoint
CREATE UNIQUE INDEX "import_executions_type_hash_completed_uidx" ON "import_executions" USING btree ("import_type","file_hash") WHERE file_hash IS NOT NULL AND status = 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_source_item_id_uidx" ON "inbox_items" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inbox_items_contact_id_idx" ON "inbox_items" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "inbox_items_sla_due_at_idx" ON "inbox_items" USING btree ("sla_due_at");--> statement-breakpoint
CREATE INDEX "live_chat_messages_chat_id_idx" ON "live_chat_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "live_chats_session_id_idx" ON "live_chats" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "live_chats_status_idx" ON "live_chats" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ma_events_entity_idx" ON "ma_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "master_leads_batch_id_idx" ON "master_leads" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "master_leads_domain_idx" ON "master_leads" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "master_leads_email_idx" ON "master_leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "master_leads_status_idx" ON "master_leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "master_leads_status_source_idx" ON "master_leads" USING btree ("status","source");--> statement-breakpoint
CREATE INDEX "master_leads_vertical_idx" ON "master_leads" USING btree ("vertical");--> statement-breakpoint
CREATE INDEX "master_leads_fit_tier_idx" ON "master_leads" USING btree ("fit_tier");--> statement-breakpoint
CREATE INDEX "master_leads_promoted_at_idx" ON "master_leads" USING btree ("promoted_at");--> statement-breakpoint
CREATE INDEX "merchant_health_scores_contact_id_idx" ON "merchant_health_scores" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "merchant_health_scores_risk_tier_idx" ON "merchant_health_scores" USING btree ("risk_tier");--> statement-breakpoint
CREATE INDEX "merchant_health_scores_computed_at_idx" ON "merchant_health_scores" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "merchant_onboarding_stages_deal_id_idx" ON "merchant_onboarding_stages" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_onboarding_stages_deal_key_unique" ON "merchant_onboarding_stages" USING btree ("deal_id","stage_key");--> statement-breakpoint
CREATE INDEX "merchant_referrals_referrer_idx" ON "merchant_referrals" USING btree ("referrer_profile_id");--> statement-breakpoint
CREATE INDEX "merchant_referrals_code_idx" ON "merchant_referrals" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "mid_daily_stats_mid_idx" ON "mid_daily_stats" USING btree ("mid");--> statement-breakpoint
CREATE INDEX "mid_daily_stats_date_idx" ON "mid_daily_stats" USING btree ("date");--> statement-breakpoint
CREATE INDEX "mid_daily_stats_deal_id_idx" ON "mid_daily_stats" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mid_daily_stats_mid_date_unique" ON "mid_daily_stats" USING btree ("mid","date");--> statement-breakpoint
CREATE INDEX "nps_responses_token_idx" ON "nps_responses" USING btree ("token");--> statement-breakpoint
CREATE INDEX "nps_responses_contact_id_idx" ON "nps_responses" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "checklist_deal_id_idx" ON "onboarding_checklist_items" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_deal_item_unique_idx" ON "onboarding_checklist_items" USING btree ("deal_id","item_key");--> statement-breakpoint
CREATE INDEX "outbound_messages_campaign_id_idx" ON "outbound_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbound_messages_campaign_status_idx" ON "outbound_messages" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "outbound_messages_scheduled_for_idx" ON "outbound_messages" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "outbound_send_counters_date_idx" ON "outbound_send_counters" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_org_users_email_org_idx" ON "partner_org_users" USING btree ("email","partner_org_id");--> statement-breakpoint
CREATE INDEX "partner_orgs_slug_idx" ON "partner_organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "processor_signals_business_id_idx" ON "processor_signals" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "processor_signals_vendor_name_idx" ON "processor_signals" USING btree ("vendor_name");--> statement-breakpoint
CREATE INDEX "promotional_enrollment_jobs_contact_id_idx" ON "promotional_enrollment_jobs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "promotional_enrollment_jobs_status_idx" ON "promotional_enrollment_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_lists_import_type_hash_uidx" ON "prospect_lists" USING btree ("import_type","file_hash") WHERE status IN ('running', 'complete');--> statement-breakpoint
CREATE INDEX "prospect_lists_archived_at_idx" ON "prospect_lists" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "prospects_list_id_idx" ON "prospects" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "prospects_status_idx" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prospects_created_at_idx" ON "prospects" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_execution_row_uidx" ON "prospects" USING btree ("import_execution_id","source_row_index") WHERE import_execution_id IS NOT NULL AND source_row_index IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_email_import_unique_idx" ON "prospects" USING btree ("email") WHERE email IS NOT NULL AND import_execution_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "rate_review_requests_contact_id_idx" ON "rate_review_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "rate_review_requests_status_idx" ON "rate_review_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rate_review_requests_created_at_idx" ON "rate_review_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "registry_import_log_import_id_idx" ON "registry_import_log" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "registry_import_log_status_idx" ON "registry_import_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "residual_import_rows_import_id_idx" ON "residual_import_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "residual_import_rows_mid_idx" ON "residual_import_rows" USING btree ("mid");--> statement-breakpoint
CREATE INDEX "review_queue_status_idx" ON "review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_queue_source_type_idx" ON "review_queue" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "review_queue_created_at_idx" ON "review_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "roleplay_exchanges_session_id_idx" ON "roleplay_exchanges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sdr_channel_attempts_merchant_id_channel_idx" ON "sdr_channel_attempts" USING btree ("merchant_id","channel");--> statement-breakpoint
CREATE INDEX "sdr_lead_events_event_type_created_at_idx" ON "sdr_lead_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "sdr_lead_events_created_at_idx" ON "sdr_lead_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_stage_idx" ON "sdr_lead_state" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_priority_bucket_idx" ON "sdr_lead_state" USING btree ("priority_bucket");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_merchant_id_idx" ON "sdr_lead_state" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_contact_id_idx" ON "sdr_lead_state" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_next_action_at_idx" ON "sdr_lead_state" USING btree ("next_action_at");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_stage_updated_at_idx" ON "sdr_lead_state" USING btree ("stage","updated_at");--> statement-breakpoint
CREATE INDEX "sdr_lead_state_current_stage_updated_at_idx" ON "sdr_lead_state" USING btree ("current_stage","updated_at");--> statement-breakpoint
CREATE INDEX "sdr_merchants_ghl_contact_id_idx" ON "sdr_merchants" USING btree ("ghl_contact_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_contact_id_status_idx" ON "sequence_enrollments" USING btree ("contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sequence_enrollments_active_unique" ON "sequence_enrollments" USING btree ("contact_id","sequence_id") WHERE status IN ('active', 'paused');--> statement-breakpoint
CREATE INDEX "statement_proposals_deal_id_idx" ON "statement_proposals" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "statement_proposals_contact_id_idx" ON "statement_proposals" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_requests_upload_token_idx" ON "statement_requests" USING btree ("upload_token");--> statement-breakpoint
CREATE INDEX "statement_requests_contact_id_idx" ON "statement_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "statement_requests_status_idx" ON "statement_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "statement_reviews_contact_id_idx" ON "statement_reviews" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "statement_reviews_status_idx" ON "statement_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "statement_reviews_document_id_idx" ON "statement_reviews" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sunbiz_entities_source_fn_unique" ON "sunbiz_entities" USING btree ("source","filing_number") WHERE source IS NOT NULL AND filing_number IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sunbiz_entities_entity_name_idx" ON "sunbiz_entities" USING btree ("entity_name");--> statement-breakpoint
CREATE INDEX "sunbiz_entities_enrichment_status_idx" ON "sunbiz_entities" USING btree ("enrichment_status");--> statement-breakpoint
CREATE INDEX "sunbiz_entities_list_id_idx" ON "sunbiz_entities" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "sunbiz_entities_created_at_idx" ON "sunbiz_entities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_contact_id_idx" ON "sync_conflicts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_resolution_idx" ON "sync_conflicts" USING btree ("resolution");--> statement-breakpoint
CREATE INDEX "sync_conflicts_created_at_idx" ON "sync_conflicts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_audit_runs_ran_at_idx" ON "system_audit_runs" USING btree ("ran_at");--> statement-breakpoint
CREATE INDEX "system_audit_runs_triggered_idx" ON "system_audit_runs" USING btree ("triggered_by");--> statement-breakpoint
CREATE INDEX "testimonial_submissions_status_idx" ON "testimonial_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "testimonial_submissions_created_at_idx" ON "testimonial_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tool_click_events_tool_id_idx" ON "tool_click_events" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tool_click_events_created_at_idx" ON "tool_click_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_deal_id_idx" ON "underwriting_decisions" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_decision_idx" ON "underwriting_decisions" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_created_at_idx" ON "underwriting_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vt_transactions_status_idx" ON "virtual_terminal_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vt_transactions_created_at_idx" ON "virtual_terminal_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vt_transactions_processed_by_idx" ON "virtual_terminal_transactions" USING btree ("processed_by");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_session_id_idx" ON "user_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "user_sessions_last_active_idx" ON "user_sessions" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_session_id_idx" ON "assistant_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assistant_messages_created_at_idx" ON "assistant_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_sessions_user_id_idx" ON "assistant_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_source_id_idx" ON "knowledge_chunks" USING btree ("source_id");