import { pool } from "../server/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'active';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_bounced_at timestamp;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_decision_maker boolean DEFAULT false;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS decision_maker_confidence integer DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS management_type text DEFAULT 'unknown';
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS management_type text DEFAULT 'unknown';
    `);
    console.log("[Schema] contacts + companies columns added");

    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_contexts (
        id serial PRIMARY KEY,
        context_id text NOT NULL,
        name text NOT NULL,
        system_prompt text NOT NULL,
        faq_items jsonb DEFAULT '[]',
        active boolean DEFAULT true,
        auto_reply_enabled boolean DEFAULT false,
        auto_reply_delay_seconds integer DEFAULT 180,
        confidence_threshold integer DEFAULT 60,
        channel text DEFAULT 'all',
        vertical_key text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bot_contexts_context_id_idx ON bot_contexts(context_id);
    `);
    console.log("[Schema] bot_contexts table created");

    await client.query(`
      CREATE TABLE IF NOT EXISTS handoff_rules (
        id serial PRIMARY KEY,
        pattern text NOT NULL,
        type text NOT NULL,
        active boolean DEFAULT true,
        description text,
        created_at timestamp DEFAULT now()
      );
    `);
    console.log("[Schema] handoff_rules table created");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ma_events (
        id serial PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id integer NOT NULL,
        event_type text NOT NULL,
        counterparty_name text,
        counterparty_contact_id integer REFERENCES contacts(id),
        event_date timestamp,
        note text,
        created_by text,
        created_at timestamp DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ma_events_entity_idx ON ma_events(entity_type, entity_id);
    `);
    console.log("[Schema] ma_events table created");

    console.log("[Schema] All done.");
  } catch (err: any) {
    console.error("[Schema] Error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
