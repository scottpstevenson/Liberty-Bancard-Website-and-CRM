import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

async function main() {
  // Deals beyond New Lead
  const adv = await db.execute(sql`
    SELECT d.id, d.title, d.stage, d.value, d.created_at,
           c.first_name, c.last_name, c.company_name, c.email, c.lead_source
    FROM deals d JOIN contacts c ON c.id = d.contact_id
    WHERE d.stage NOT IN ('New Lead','new_lead')
    ORDER BY d.created_at DESC
  `);
  console.log("ADVANCED_DEALS:", JSON.stringify(adv.rows, null, 2));

  // Newest 10 deals
  const ds = await db.execute(sql`
    SELECT d.id, d.title, d.stage, d.value, d.created_at,
           c.first_name, c.last_name, c.company_name, c.email, c.lead_source
    FROM deals d JOIN contacts c ON c.id = d.contact_id
    ORDER BY d.created_at DESC LIMIT 10
  `);
  console.log("DEALS_NEWEST:", JSON.stringify(ds.rows, null, 2));

  // Task breakdown
  const tb = await db.execute(sql`
    SELECT source, status, LEFT(title,70) as title, COUNT(*) as cnt
    FROM tasks WHERE deleted_at IS NULL
    GROUP BY source, status, LEFT(title,70)
    ORDER BY cnt DESC LIMIT 20
  `);
  console.log("TASK_BREAKDOWN:", JSON.stringify(tb.rows, null, 2));

  // Newest tasks sample
  const ts = await db.execute(sql`
    SELECT t.id, t.title, t.status, t.source, t.due_date, t.created_at,
           c.first_name, c.last_name, c.company_name, c.lead_source
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.created_at DESC LIMIT 15
  `);
  console.log("TASKS_NEWEST:", JSON.stringify(ts.rows, null, 2));

  // TestNLE contacts still in DB (@test.invalid)
  const nle = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts WHERE email ILIKE '%@test.invalid'
  `);
  console.log("TESTNLE_CONTACTS_REMAINING:", (nle.rows[0] as any).cnt);
}
main().catch(e => { console.error(e.message); process.exit(1); });
