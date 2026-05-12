import { pool } from "../db";

export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

      ALTER TABLE partners ADD COLUMN IF NOT EXISTS invite_token TEXT;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS invite_token_expires_at TIMESTAMP;

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

      CREATE INDEX IF NOT EXISTS vt_transactions_status_idx ON virtual_terminal_transactions(status);
      CREATE INDEX IF NOT EXISTS vt_transactions_created_at_idx ON virtual_terminal_transactions(created_at);
      CREATE INDEX IF NOT EXISTS vt_transactions_processed_by_idx ON virtual_terminal_transactions(processed_by);

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

      CREATE INDEX IF NOT EXISTS roleplay_exchanges_session_id_idx ON roleplay_exchanges(session_id);

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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

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

      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id);

      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id);

      ALTER TABLE agent_merchants
        ADD COLUMN IF NOT EXISTS mid TEXT;
      CREATE INDEX IF NOT EXISTS agent_merchants_mid_idx ON agent_merchants(mid);

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
      CREATE INDEX IF NOT EXISTS testimonial_submissions_status_idx ON testimonial_submissions(status);
      CREATE INDEX IF NOT EXISTS testimonial_submissions_created_at_idx ON testimonial_submissions(created_at);

      ALTER TABLE email_logs
        ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP;

      ALTER TABLE merchant_applications
        ADD COLUMN IF NOT EXISTS underwriting_notes_log JSONB DEFAULT '[]'::jsonb;

      -- Task #179 Content Engine: blog post extensions
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS author_id INTEGER;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS pillar TEXT;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS cluster TEXT;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS seo_title TEXT;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS og_image TEXT;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS internal_links JSONB;
      ALTER TABLE generated_blog_posts ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;
      CREATE INDEX IF NOT EXISTS gbp_status_scheduled_idx ON generated_blog_posts(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS gbp_pillar_idx ON generated_blog_posts(pillar);

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
      CREATE INDEX IF NOT EXISTS social_posts_status_idx ON social_posts(status, scheduled_at);

      CREATE TABLE IF NOT EXISTS document_access_log (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        user_id TEXT NOT NULL,
        ip TEXT,
        accessed_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS document_access_log_document_id_idx ON document_access_log(document_id);
      CREATE INDEX IF NOT EXISTS document_access_log_accessed_at_idx ON document_access_log(accessed_at);
    `);
    console.log("[Migrations] Startup migrations applied successfully.");
  } catch (err: any) {
    console.error("[Migrations] Error applying startup migrations:", err.message);
    throw err;
  } finally {
    client.release();
  }
}
