-- Consolidation of all raw SQL that was previously run in server/services/migrations.ts
-- Every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards so this is
-- safe to apply against both fresh and existing databases.

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE partners ADD COLUMN IF NOT EXISTS invite_token TEXT;
--> statement-breakpoint
ALTER TABLE partners ADD COLUMN IF NOT EXISTS invite_token_expires_at TIMESTAMP;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS virtual_terminal_transactions (
  id serial PRIMARY KEY,
  gateway_transaction_id text,
  auth_code text,
  status text NOT NULL DEFAULT 'pending',
  amount text NOT NULL,
  refunded_amount text DEFAULT '0',
  card_type text,
  last_four text,
  cardholder_name text,
  billing_zip text,
  memo text,
  response_code text,
  response_text text,
  processed_by text,
  refunded_by text,
  refunded_at timestamp,
  raw_response jsonb,
  created_at timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vt_transactions_status_idx ON virtual_terminal_transactions(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vt_transactions_created_at_idx ON virtual_terminal_transactions(created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vt_transactions_processed_by_idx ON virtual_terminal_transactions(processed_by);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id),
  scenario TEXT NOT NULL,
  persona TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  total_exchanges INTEGER DEFAULT 0,
  overall_score INTEGER,
  coaching_summary TEXT,
  strengths TEXT[],
  gaps TEXT[],
  suggested_phrasing TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS roleplay_exchanges (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES roleplay_sessions(id),
  rep_message TEXT NOT NULL,
  merchant_reply TEXT NOT NULL,
  tone_score INTEGER,
  clarity_score INTEGER,
  objection_addressed BOOLEAN,
  feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS roleplay_exchanges_session_id_idx ON roleplay_exchanges(session_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS leaderboard_settings (
  id SERIAL PRIMARY KEY,
  show_deals BOOLEAN DEFAULT true,
  show_revenue BOOLEAN DEFAULT true,
  show_proposals BOOLEAN DEFAULT true,
  show_calls_made BOOLEAN DEFAULT true,
  show_response_rate BOOLEAN DEFAULT false,
  visible_to_agents BOOLEAN DEFAULT true,
  monthly_deal_goal INTEGER DEFAULT 10,
  monthly_revenue_goal TEXT DEFAULT '50000',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS partner_organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#2563eb',
  commission_rate REAL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'active',
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  tagline TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS partner_org_users (
  id SERIAL PRIMARY KEY,
  partner_org_id INTEGER NOT NULL REFERENCES partner_organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id);
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id);
--> statement-breakpoint

ALTER TABLE agent_merchants ADD COLUMN IF NOT EXISTS mid TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_merchants_mid_idx ON agent_merchants(mid);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS testimonial_submissions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  business_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  industry TEXT,
  video_link TEXT,
  savings_amount TEXT,
  story TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  publish BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  contact_id INTEGER REFERENCES contacts(id),
  deal_id INTEGER REFERENCES deals(id),
  created_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS testimonial_submissions_status_idx ON testimonial_submissions(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS testimonial_submissions_created_at_idx ON testimonial_submissions(created_at);
--> statement-breakpoint

ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP;
--> statement-breakpoint

ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS underwriting_notes_log JSONB DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS author_id INTEGER;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS pillar TEXT;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS cluster TEXT;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS seo_title TEXT;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS og_image TEXT;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS internal_links JSONB;
--> statement-breakpoint
ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gbp_status_scheduled_idx ON generated_blog_posts(status, scheduled_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gbp_pillar_idx ON generated_blog_posts(pillar);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS content_authors (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  bio TEXT NOT NULL,
  long_bio TEXT,
  avatar_url TEXT,
  linkedin_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  expertise TEXT[],
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS social_posts (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'linkedin',
  body TEXT NOT NULL,
  hashtags TEXT[],
  link_url TEXT,
  image_url TEXT,
  author_id INTEGER,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMP,
  published_at TIMESTAMP,
  external_post_id TEXT,
  external_post_url TEXT,
  pillar TEXT,
  cluster TEXT,
  reviewer_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON social_posts(status, scheduled_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS document_access_log (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  user_id TEXT NOT NULL,
  ip TEXT,
  accessed_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_access_log_document_id_idx ON document_access_log(document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_access_log_accessed_at_idx ON document_access_log(accessed_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS background_jobs (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'idle',
  last_started_at TIMESTAMP,
  last_finished_at TIMESTAMP,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS background_jobs_job_name_idx ON background_jobs(job_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS background_jobs_status_idx ON background_jobs(status);
--> statement-breakpoint

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  field_name TEXT NOT NULL,
  internal_value TEXT,
  ghl_value TEXT,
  internal_updated_at TIMESTAMP,
  ghl_updated_at TIMESTAMP,
  resolution TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_conflicts_contact_id_idx ON sync_conflicts(contact_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_conflicts_resolution_idx ON sync_conflicts(resolution);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_conflicts_created_at_idx ON sync_conflicts(created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS review_queue (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checklist_state JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  approved_by TEXT,
  approved_at TIMESTAMP,
  ghl_workflow_id TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_queue_status_idx ON review_queue(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_queue_source_idx ON review_queue(source_type, source_id);
--> statement-breakpoint

ALTER TABLE chargebacks ADD COLUMN IF NOT EXISTS ai_evidence_packet jsonb DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE partner_organizations ADD COLUMN IF NOT EXISTS tagline TEXT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS co_branded_proposals (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id),
  contact_id INTEGER REFERENCES contacts(id),
  partner_org_id INTEGER REFERENCES partner_organizations(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'draft',
  pricing_plan TEXT,
  proposal_data JSONB,
  merchant_name TEXT,
  merchant_monthly_volume TEXT,
  merchant_effective_rate TEXT,
  merchant_email TEXT,
  custom_message TEXT,
  delivered_at TIMESTAMP,
  viewed_at TIMESTAMP,
  view_count INTEGER DEFAULT 0,
  accepted_at TIMESTAMP,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS co_branded_proposals_partner_org_id_idx ON co_branded_proposals(partner_org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS co_branded_proposals_deal_id_idx ON co_branded_proposals(deal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS co_branded_proposals_token_idx ON co_branded_proposals(token);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS entity_relationships (
  id SERIAL PRIMARY KEY,
  source_entity_type TEXT NOT NULL,
  source_entity_id INTEGER NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'system',
  risk_flag BOOLEAN DEFAULT FALSE,
  risk_reason TEXT,
  note TEXT,
  dismissed_at TIMESTAMP,
  dismissed_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_relationships_source_idx ON entity_relationships(source_entity_type, source_entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_relationships_target_idx ON entity_relationships(target_entity_type, target_entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_relationships_type_idx ON entity_relationships(relationship_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_relationships_risk_flag_idx ON entity_relationships(risk_flag);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS entity_relationships_unique_idx ON entity_relationships(source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type);
--> statement-breakpoint

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_state JSONB;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_state JSONB;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_type_check;
--> statement-breakpoint
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('user', 'ai', 'system'));
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id TEXT;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_key TEXT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_logs_entity_key_idx ON audit_logs(entity_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_actor_type_idx ON audit_logs(actor_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_entity_id_idx ON audit_logs(entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id SERIAL PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_cents REAL DEFAULT 0,
  response_summary TEXT,
  error TEXT,
  duration_ms INTEGER,
  prompt_hash TEXT,
  confidence_score REAL DEFAULT 0,
  flagged BOOLEAN DEFAULT false,
  raw_prompt TEXT,
  raw_response TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_audit_logs_trigger_type_idx ON ai_audit_logs(trigger_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_audit_logs_created_at_idx ON ai_audit_logs(created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_audit_logs_flagged_idx ON ai_audit_logs(flagged) WHERE flagged = true;
--> statement-breakpoint

-- user_sessions: sourced from migrations/0012_user_sessions.sql (journal idx 13).
-- Included here to guarantee convergence on existing databases where that migration
-- file was not applied before the drizzle migration system was adopted.
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" varchar NOT NULL,
  "ip" varchar,
  "user_agent" text,
  "created_at" timestamp DEFAULT now(),
  "last_active_at" timestamp DEFAULT now(),
  "is_invalidated" boolean DEFAULT false,
  "invalidated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_session_id_idx" ON "user_sessions" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_last_active_idx" ON "user_sessions" ("last_active_at");
