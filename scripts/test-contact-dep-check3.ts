/**
 * Count FK children of the 352 stale sdr_merchants rows.
 * READ ONLY.
 */
import { pool } from "../server/db";

const PREFIXES = ["wh-test-ghl-%","ghl-deal-test-%","c1-test-%","venroll-test-%","go-live-check-%"];

async function q(label: string, sql: string, params: unknown[] = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`${label}: ${JSON.stringify(r.rows[0] ?? r.rows)}`);
  } catch (e: unknown) { console.log(`${label} ERR: ${e instanceof Error ? e.message : e}`); }
}

async function run() {
  // Get merchant IDs for the 352 stale sdr_merchants
  const mRes = await pool.query(`
    SELECT id FROM sdr_merchants
    WHERE ghl_contact_id = ANY(
      SELECT ghl_contact_id FROM contacts WHERE
        ghl_contact_id ILIKE $1 OR ghl_contact_id ILIKE $2 OR
        ghl_contact_id ILIKE $3 OR ghl_contact_id ILIKE $4 OR
        ghl_contact_id ILIKE $5
    )`, PREFIXES);
  const mIds = mRes.rows.map((r: { id: number }) => r.id);
  console.log(`stale merchant IDs count: ${mIds.length}`);
  if (mIds.length === 0) { await pool.end(); return; }

  await q("sdr_channel_attempts",
    `SELECT COUNT(*) n FROM sdr_channel_attempts WHERE merchant_id = ANY($1::int[])`, [mIds]);

  await q("sdr_compliance_state",
    `SELECT COUNT(*) n FROM sdr_compliance_state WHERE merchant_id = ANY($1::int[])`, [mIds]);

  await q("sdr_lead_events (via merchant)",
    `SELECT COUNT(*) n FROM sdr_lead_events WHERE merchant_id = ANY($1::int[])`, [mIds]);

  await q("sdr_lead_state (via merchant)",
    `SELECT COUNT(*) n FROM sdr_lead_state WHERE merchant_id = ANY($1::int[])`, [mIds]);

  await q("sdr_merchant_contacts",
    `SELECT COUNT(*) n FROM sdr_merchant_contacts WHERE merchant_id = ANY($1::int[])`, [mIds]);

  await q("registry_import_log (matched)",
    `SELECT COUNT(*) n FROM registry_import_log WHERE matched_merchant_id = ANY($1::int[])`, [mIds]);

  await q("registry_import_log (runner_up)",
    `SELECT COUNT(*) n FROM registry_import_log WHERE runner_up_merchant_id = ANY($1::int[])`, [mIds]);

  // sdr_lead_state overlap: how many of the 174 contact-matched rows are ALSO merchant-matched?
  await q("sdr_lead_state OVERLAP (contact AND merchant)",
    `SELECT COUNT(*) n FROM sdr_lead_state
     WHERE contact_id = ANY(
       SELECT id FROM contacts WHERE
         ghl_contact_id ILIKE $1 OR ghl_contact_id ILIKE $2 OR
         ghl_contact_id ILIKE $3 OR ghl_contact_id ILIKE $4 OR
         ghl_contact_id ILIKE $5
     ) AND merchant_id = ANY($6::int[])`, [...PREFIXES, mIds]);

  await pool.end();
}
run().catch(e => { console.error("FATAL:", e); process.exit(1); });
