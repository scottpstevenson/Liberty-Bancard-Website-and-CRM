import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

async function main() {
  // Enrollment breakdown — which sequences, contact lead sources
  const enrollBreakdown = await db.execute(sql`
    SELECT
      s.name as sequence_name,
      s.status as seq_status,
      e.status as enrollment_status,
      c.lead_source,
      COUNT(*) as cnt
    FROM sequence_enrollments e
    JOIN follow_up_sequences s ON s.id = e.sequence_id
    JOIN contacts c ON c.id = e.contact_id
    GROUP BY s.name, s.status, e.status, c.lead_source
    ORDER BY cnt DESC
    LIMIT 30
  `);
  console.log("ENROLLMENTS_BREAKDOWN:", JSON.stringify(enrollBreakdown.rows, null, 2));

  // Sample enrolled contacts — are they from lead files?
  const enrollSample = await db.execute(sql`
    SELECT c.first_name, c.last_name, c.email, c.company_name,
           c.lead_source, c.lifecycle_stage, e.status as enrollment_status,
           s.name as sequence_name, e.created_at
    FROM sequence_enrollments e
    JOIN contacts c ON c.id = e.contact_id
    JOIN follow_up_sequences s ON s.id = e.sequence_id
    WHERE e.status = 'active'
    ORDER BY e.created_at DESC
    LIMIT 15
  `);
  console.log("\nACTIVE_ENROLLMENT_SAMPLE:", JSON.stringify(enrollSample.rows, null, 2));

  // Deal breakdown — by stage and lead source of contact
  const dealBreakdown = await db.execute(sql`
    SELECT d.stage, c.lead_source, COUNT(*) as cnt
    FROM deals d
    JOIN contacts c ON c.id = d.contact_id
    GROUP BY d.stage, c.lead_source
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log("\nDEALS_BREAKDOWN:", JSON.stringify(dealBreakdown.rows, null, 2));

  // Sample deals — names, companies, stages
  const dealSample = await db.execute(sql`
    SELECT d.id, d.title, d.stage, d.value, d.created_at,
           c.first_name, c.last_name, c.company_name, c.email, c.lead_source
    FROM deals d
    JOIN contacts c ON c.id = d.contact_id
    ORDER BY d.created_at DESC
    LIMIT 15
  `);
  console.log("\nDEAL_SAMPLE (newest 15):", JSON.stringify(dealSample.rows, null, 2));

  // Any deals beyond "New Lead" stage?
  const advancedDeals = await db.execute(sql`
    SELECT d.id, d.title, d.stage, d.value, d.created_at,
           c.first_name, c.last_name, c.company_name, c.email
    FROM deals d
    JOIN contacts c ON c.id = d.contact_id
    WHERE d.stage NOT IN ('New Lead', 'new_lead', 'new lead')
    ORDER BY d.created_at DESC
    LIMIT 20
  `);
  console.log("\nDEALS_BEYOND_NEW_LEAD:", JSON.stringify(advancedDeals.rows, null, 2));

  // Task breakdown by source and type
  const taskBreakdown = await db.execute(sql`
    SELECT source, status, LEFT(title, 60) as title_sample, COUNT(*) as cnt
    FROM tasks
    WHERE deleted_at IS NULL
    GROUP BY source, status, LEFT(title, 60)
    ORDER BY cnt DESC
    LIMIT 25
  `);
  console.log("\nTASK_BREAKDOWN:", JSON.stringify(taskBreakdown.rows, null, 2));

  // Any tasks linked to real contacts (non-test)?
  const taskSample = await db.execute(sql`
    SELECT t.id, t.title, t.status, t.source, t.created_at,
           c.first_name, c.last_name, c.company_name, c.email, c.lead_source
    FROM tasks t
    LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.created_at DESC
    LIMIT 15
  `);
  console.log("\nTASK_SAMPLE (newest 15):", JSON.stringify(taskSample.rows, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
