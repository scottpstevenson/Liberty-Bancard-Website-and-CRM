import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

async function main() {
  // Contacts breakdown
  const contacts = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE source IN ('test','demo','seed','manual_test') OR email ILIKE '%test%' OR email ILIKE '%demo%') as likely_test,
      COUNT(*) FILTER (WHERE source = 'sdr_discovery') as sdr_scraped,
      COUNT(*) FILTER (WHERE source = 'inbound_form') as inbound,
      COUNT(*) FILTER (WHERE source = 'manual') as manual,
      COUNT(*) FILTER (WHERE source = 'ghl_sync') as ghl_synced,
      COUNT(*) FILTER (WHERE source = 'csv_import') as csv_imported,
      array_agg(DISTINCT source) as sources
    FROM contacts
  `);
  console.log("CONTACTS:", JSON.stringify(contacts.rows[0], null, 2));

  // Sample contacts to see what's real
  const sample = await db.execute(sql`
    SELECT id, first_name, last_name, email, company_name, source, created_at
    FROM contacts ORDER BY created_at DESC LIMIT 20
  `);
  console.log("CONTACTS_SAMPLE (newest 20):", JSON.stringify(sample.rows, null, 2));

  // Deals
  const deals = await db.execute(sql`
    SELECT stage, COUNT(*) as cnt FROM deals GROUP BY stage ORDER BY cnt DESC
  `);
  console.log("DEALS_BY_STAGE:", JSON.stringify(deals.rows, null, 2));

  // Tasks (SLA tasks table)
  const tasks = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status ORDER BY cnt DESC
  `);
  console.log("TASKS_BY_STATUS:", JSON.stringify(tasks.rows, null, 2));

  // Sample tasks
  const taskSample = await db.execute(sql`
    SELECT id, title, status, source, created_at FROM tasks ORDER BY created_at DESC LIMIT 20
  `);
  console.log("TASKS_SAMPLE:", JSON.stringify(taskSample.rows, null, 2));

  // Sequence enrollments
  const enrollments = await db.execute(sql`
    SELECT e.status, s.name, COUNT(*) as cnt
    FROM sequence_enrollments e
    JOIN follow_up_sequences s ON s.id = e.sequence_id
    GROUP BY e.status, s.name ORDER BY cnt DESC LIMIT 20
  `);
  console.log("ENROLLMENTS:", JSON.stringify(enrollments.rows, null, 2));

  // SDR merchants (scraped prospects)
  const sdr = await db.execute(sql`
    SELECT COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'converted') as converted,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'enrolled') as enrolled
    FROM sdr_merchants
  `).catch(() => ({ rows: [{ total: 'TABLE_NOT_FOUND' }] }));
  console.log("SDR_MERCHANTS:", JSON.stringify(sdr.rows[0], null, 2));

  // Users / merchants in portal
  const users = await db.execute(sql`
    SELECT role, COUNT(*) as cnt FROM users GROUP BY role ORDER BY cnt DESC
  `);
  console.log("USERS_BY_ROLE:", JSON.stringify(users.rows, null, 2));

  // Recent audit logs to understand activity
  const recentAudit = await db.execute(sql`
    SELECT DATE(created_at) as day, COUNT(*) as cnt
    FROM audit_logs WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY day ORDER BY day DESC
  `);
  console.log("AUDIT_LOG_7D:", JSON.stringify(recentAudit.rows, null, 2));

  // Analytics events
  const analytics = await db.execute(sql`
    SELECT event_name, COUNT(*) as cnt FROM analytics_events
    GROUP BY event_name ORDER BY cnt DESC LIMIT 10
  `).catch(() => ({ rows: [] }));
  console.log("ANALYTICS_EVENTS:", JSON.stringify(analytics.rows, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
