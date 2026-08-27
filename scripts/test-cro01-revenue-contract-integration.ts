#!/usr/bin/env tsx
/** CRO-01 disposable-PostgreSQL SQL contract; all fixture work is TEMP + ROLLBACK. */
import assert from "node:assert/strict";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required; CRO-01 never falls back to DATABASE_URL.");
const parsed = new URL(url);
if (!/(test|testing|ci|tmp|disposable)/i.test(`${parsed.hostname}${parsed.pathname}${parsed.search}`)) {
  throw new Error("TEST_DATABASE_URL must clearly name a test/disposable database; refusing to connect.");
}
let assertions = 0;
const check = (value: unknown, message: string) => { assertions++; assert.ok(value, message); };
const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE cro_contacts (id int primary key, owner text, archived boolean default false, class text default 'production');
    CREATE TEMP TABLE cro_deals (id int primary key, contact_id int, owner text, stage text, updated_at timestamptz, archived boolean default false, class text default 'production');
    CREATE TEMP TABLE cro_mids (id int primary key, contact_id int, status text, activated_at timestamptz);
    INSERT INTO cro_contacts VALUES (1,'agent-a@test',false,'production'),(2,'agent-b@test',false,'production'),(3,'agent-a@test',true,'production'),(4,'agent-a@test',false,'test');
    INSERT INTO cro_deals VALUES
      (10,1,'agent-a@test','New Lead','2026-01-01T00:00:00Z'),(11,1,'agent-a@test','Proposal Sent','2026-01-02T00:00:00Z'),
      (12,2,'agent-b@test','Closed Won','2026-01-03T00:00:00Z'),(13,2,'agent-b@test','New Lead','2026-01-02T00:00:00Z'),
      (14,3,'agent-a@test','New Lead','2026-01-04T00:00:00Z'),(15,4,'agent-a@test','New Lead','2026-01-04T00:00:00Z'),
      (16,1,'agent-a@test','Call Booked','2026-01-02T00:00:00Z'),(17,1,'agent-a@test','Call Booked','2026-01-02T00:00:00Z');
    INSERT INTO cro_mids VALUES (1,1,'active','2026-01-01'),(2,1,'active','2026-01-02'),(3,2,'assigned',null),(4,2,'active','2026-01-02');
  `);
  const stages = ["New Lead", "Enriched", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Promise to Submit"];
  const leadSql = `SELECT c.id, d.id AS deal_id FROM cro_contacts c JOIN LATERAL (
    SELECT * FROM cro_deals d WHERE d.contact_id=c.id AND NOT d.archived AND d.class='production'
    AND d.stage = ANY($1::text[]) ORDER BY d.updated_at DESC, d.id DESC LIMIT 1
  ) d ON true WHERE NOT c.archived AND c.class='production' ORDER BY d.updated_at DESC,d.id DESC,c.id DESC`;
  const leads = await client.query(leadSql, [stages]);
  check(leads.rows.length === 2, "distinct lead cardinality remains one row per contact despite multiple deals");
  check(leads.rows.map((r) => r.id).join(",") === "1,2", "canonical lead stage table excludes archived and non-production contacts");
  check(leads.rows[0].deal_id === 17, "equal updated_at primary-deal ties break by descending deal id");
  const agentScope = await client.query(`${leadSql.replace("WHERE NOT c.archived", "WHERE NOT c.archived AND c.owner = $2")} `, [stages, "agent-a@test"]);
  check(agentScope.rows.length === 1 && agentScope.rows[0].id === 1, "ownership scope does not expose another agent's lead");
  const page = await client.query(`${leadSql} LIMIT 1 OFFSET 1`, [stages]);
  check(page.rows.length === 1 && page.rows[0].id === 2, "pagination remains stable above a one-row page size");
  const recon = await client.query(`SELECT
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cro_deals d WHERE d.contact_id=c.id AND NOT d.archived AND d.class='production' AND d.stage=ANY($1::text[])))::int AS leads,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cro_mids m WHERE m.contact_id=c.id AND m.status='active' AND m.activated_at IS NOT NULL))::int AS mids
    FROM cro_contacts c WHERE NOT c.archived AND c.class='production'`, [stages]);
  check(
    Number(recon.rows[0].leads) === 2 && Number(recon.rows[0].mids) === 2,
    `reconciliation counts distinct contacts and permits overlapping aggregate buckets (${JSON.stringify(recon.rows[0])})`,
  );
  const midCounts = await client.query("SELECT count(*)::int AS active_mid_rows, count(DISTINCT contact_id)::int AS active_mid_contacts FROM cro_mids WHERE status='active' AND activated_at IS NOT NULL");
  check(Number(midCounts.rows[0].active_mid_rows) === 3 && Number(midCounts.rows[0].active_mid_contacts) === 2, "merchant distinct-contact count is not inflated by active MID membership");
  check(assertions > 0, "integration suite has core assertions");
  console.log(`CRO-01 PostgreSQL contract passed (${assertions} assertions; TEMP tables rolled back; no providers).`);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}