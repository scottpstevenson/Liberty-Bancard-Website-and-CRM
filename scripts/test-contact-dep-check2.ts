import { pool } from "../server/db";

const PREFIXES = ["wh-test-ghl-%","ghl-deal-test-%","c1-test-%","venroll-test-%","go-live-check-%"];
const P = PREFIXES;

async function run() {
  // entity_memory: entity_id may be integer (contact.id), not text
  try {
    const r = await pool.query(
      `SELECT COUNT(*) n FROM entity_memory
       WHERE entity_id = ANY(
         SELECT id FROM contacts WHERE
           ghl_contact_id ILIKE $1 OR ghl_contact_id ILIKE $2 OR
           ghl_contact_id ILIKE $3 OR ghl_contact_id ILIKE $4 OR
           ghl_contact_id ILIKE $5
       )`, P);
    console.log("entity_memory (by contact id):", r.rows[0].n);
  } catch (e: unknown) { console.log("entity_memory ERR:", e instanceof Error ? e.message : e); }

  // Check sdr_merchants FK children by looking at FK graph
  try {
    const r = await pool.query(`
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON kcu.constraint_name = rc.constraint_name
      JOIN information_schema.key_column_usage kcu2
        ON rc.unique_constraint_name = kcu2.constraint_name
      WHERE kcu2.table_name = 'sdr_merchants'
      LIMIT 20`);
    console.log("FK children of sdr_merchants:", JSON.stringify(r.rows));
  } catch (e: unknown) { console.log("FK graph ERR:", e instanceof Error ? e.message : e); }

  // Deals with merchant_id set (so sdr_merchants deletion must precede or follow carefully)
  try {
    const r = await pool.query(`
      SELECT COUNT(*) n FROM deals
      WHERE contact_id = ANY(
        SELECT id FROM contacts WHERE
          ghl_contact_id ILIKE $1 OR ghl_contact_id ILIKE $2 OR
          ghl_contact_id ILIKE $3 OR ghl_contact_id ILIKE $4 OR
          ghl_contact_id ILIKE $5
      ) AND merchant_id IS NOT NULL`, P);
    console.log("stale deals with merchant_id:", r.rows[0].n);
  } catch (e: unknown) { console.log("deals+merchant ERR:", e instanceof Error ? e.message : e); }

  // sdr_merchants column list (to confirm ghl_contact_id column name)
  try {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sdr_merchants' AND column_name ILIKE '%contact%'`);
    console.log("sdr_merchants contact columns:", JSON.stringify(r.rows));
  } catch (e: unknown) { console.log("sdr_merchants cols ERR:", e instanceof Error ? e.message : e); }

  // tasks table: confirm column name (contact_id vs related_contact_id etc.)
  try {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name ILIKE '%contact%'`);
    console.log("tasks contact columns:", JSON.stringify(r.rows));
  } catch (e: unknown) { console.log("tasks cols ERR:", e instanceof Error ? e.message : e); }

  await pool.end();
}
run().catch(e => { console.error("FATAL:", e); process.exit(1); });
