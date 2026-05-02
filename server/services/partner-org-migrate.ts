import { pool } from "../db";

export async function runPartnerOrgMigration() {
  const client = await pool.connect();
  try {
    await client.query(`
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
      )
    `);

    await client.query(`
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
      )
    `);

    await client.query(`
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id)
    `);

    await client.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS partner_org_id INTEGER REFERENCES partner_organizations(id)
    `);
  } finally {
    client.release();
  }
}
