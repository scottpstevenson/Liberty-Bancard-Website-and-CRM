import { pool } from "../server/db";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS churn_risk_tier text;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS churn_score_weights (
        id serial PRIMARY KEY,
        signal_key text NOT NULL UNIQUE,
        label text NOT NULL,
        weight real NOT NULL DEFAULT 1.0,
        description text,
        updated_at timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS merchant_health_scores (
        id serial PRIMARY KEY,
        contact_id integer NOT NULL REFERENCES contacts(id),
        churn_score real NOT NULL DEFAULT 0,
        risk_tier text NOT NULL DEFAULT 'Low',
        volume_trend_score real DEFAULT 0,
        chargeback_trend_score real DEFAULT 0,
        ticket_velocity_score real DEFAULT 0,
        nps_score real DEFAULT 0,
        portal_activity_score real DEFAULT 0,
        outreach_response_score real DEFAULT 0,
        override_score real,
        override_note text,
        overridden_at timestamp,
        overridden_by text,
        retention_campaign_triggered boolean DEFAULT false,
        agent_notified boolean DEFAULT false,
        computed_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS merchant_health_scores_contact_id_idx ON merchant_health_scores(contact_id);
      CREATE INDEX IF NOT EXISTS merchant_health_scores_risk_tier_idx ON merchant_health_scores(risk_tier);
      CREATE INDEX IF NOT EXISTS merchant_health_scores_computed_at_idx ON merchant_health_scores(computed_at);
    `);
    console.log("Churn tables created successfully");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
