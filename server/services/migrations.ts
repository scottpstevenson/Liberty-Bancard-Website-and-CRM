import { pool } from "../db";

export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

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
    `);
    console.log("[Migrations] Startup migrations applied successfully.");
  } catch (err: any) {
    console.error("[Migrations] Error applying startup migrations:", err.message);
    throw err;
  } finally {
    client.release();
  }
}
