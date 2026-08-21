/**
 * Cleanup: Remove test contacts, all FK rows, and merchant user accounts.
 *
 * KEEPS: All real leads, admin/agent/manager users, sequences, audit logs.
 * DELETES: wh-test-*, no-op-*, test-ca-*, *@test.internal, *@example.test contacts
 *          + every FK row referencing those contacts
 *          + all users with role = 'merchant'
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

function assertTestEnvironment(): void {
  const activeDb = process.env.DATABASE_URL;
  const testDb = process.env.TEST_DATABASE_URL;
  if (process.env.NODE_ENV !== "test" || !activeDb || !testDb || activeDb !== testDb) {
    throw new Error("BT-06 KILL LINE: cleanup-test-data.ts only runs with NODE_ENV=test and DATABASE_URL=TEST_DATABASE_URL.");
  }
  const dbName = new URL(testDb).pathname.toLowerCase();
  if (!/(test|ci)/.test(dbName) || process.env.PRODUCTION_DATABASE_URL === testDb) {
    throw new Error("BT-06 KILL LINE: cleanup-test-data.ts requires a separate clearly named test/CI database.");
  }
}

async function del(table: string, col: string, idList: string): Promise<number> {
  try {
    const r = await db.execute(
      sql.raw(`DELETE FROM "${table}" WHERE "${col}" IN (${idList}) RETURNING 1`)
    );
    return r.rows.length;
  } catch (e: any) {
    // Table may not exist or col name differs — report but don't crash
    if (!e.message?.includes("does not exist")) {
      console.warn(`  ⚠ ${table}.${col}: ${e.message}`);
    }
    return 0;
  }
}

async function main() {
  assertTestEnvironment();
  console.log("🧹 Liberty Bancard — Test Data Cleanup\n");

  // ── Step 1: Collect test contact IDs ─────────────────────────────────────
  const rows = await db.execute(sql`
    SELECT id FROM contacts
    WHERE
      email ILIKE 'wh-test-%'
      OR email ILIKE 'no-op-%'
      OR email ILIKE 'test-ca-%'
      OR email ILIKE 'playwright-%'
      OR email ILIKE '%@test.internal'
      OR email ILIKE '%@example.test'
      OR (first_name = 'Test' AND last_name IN ('Lead','Update','Contact','User','Merchant'))
  `);
  const ids: number[] = (rows.rows as any[]).map(r => Number(r.id));
  console.log(`📋 Test contacts to remove: ${ids.length}`);

  if (ids.length === 0) {
    console.log("  Nothing to delete.");
  } else {
    const idList = ids.join(",");

    // ── Step 2: Delete all FK rows (leaf → root order) ───────────────────
    console.log("\n🗑  Deleting child records...");
    let total = 0;
    const report = (table: string, n: number) => { if (n > 0) { console.log(`  ✓ ${table}: ${n}`); total += n; } };

    // Activity / log tables
    report("ghl_activity_log",          await del("ghl_activity_log", "contact_id", idList));
    report("outbound_messages",          await del("outbound_messages", "contact_id", idList));
    report("outbound_send_log",          await del("outbound_send_log", "contact_id", idList));
    report("email_logs",                 await del("email_logs", "contact_id", idList));
    report("call_logs",                  await del("call_logs", "contact_id", idList));
    report("calendar_events",            await del("calendar_events", "contact_id", idList));
    report("inbox_items",                await del("inbox_items", "contact_id", idList));
    report("live_chats",                 await del("live_chats", "contact_id", idList));

    // Consent / scoring
    report("consent_audit_logs",         await del("consent_audit_logs", "contact_id", idList));
    report("contact_ai_cache",           await del("contact_ai_cache", "contact_id", idList));
    report("contact_lead_scoring_jobs",  await del("contact_lead_scoring_jobs", "contact_id", idList));
    report("enrichment_runs",            await del("enrichment_runs", "contact_id", idList));
    report("sdr_lead_state",             await del("sdr_lead_state", "contact_id", idList));
    report("sync_conflicts",             await del("sync_conflicts", "contact_id", idList));
    report("health_alerts",              await del("health_alerts", "contact_id", idList));
    report("contact_source_events",      await del("contact_source_events", "contact_id", idList));
    report("contact_companies",          await del("contact_companies", "contact_id", idList));
    report("lead_sources",               await del("lead_sources", "contact_id", idList));
    report("analytics_events",           await del("analytics_events", "contact_id", idList));
    report("analytic_events",            await del("analytic_events", "contact_id", idList));

    // Business records
    report("sequence_enrollments",       await del("sequence_enrollments", "contact_id", idList));
    report("tasks",                      await del("tasks", "contact_id", idList));
    report("tickets",                    await del("tickets", "contact_id", idList));
    report("notes",                      await del("notes", "entity_id", idList));  // notes uses entity_id
    report("documents",                  await del("documents", "contact_id", idList));
    report("chargebacks",                await del("chargebacks", "contact_id", idList));
    report("equipment_orders",           await del("equipment_orders", "contact_id", idList));
    report("promotional_enrollment_jobs",await del("promotional_enrollment_jobs", "contact_id", idList));
    report("rate_review_requests",       await del("rate_review_requests", "contact_id", idList));
    report("review_requests",            await del("review_requests", "contact_id", idList));
    report("nps_responses",              await del("nps_responses", "contact_id", idList));
    report("testimonial_submissions",    await del("testimonial_submissions", "contact_id", idList));
    report("rfis",                       await del("rfis", "contact_id", idList));

    // Statement / financial
    report("statement_proposals",        await del("statement_proposals", "contact_id", idList));
    report("statement_requests",         await del("statement_requests", "contact_id", idList));
    report("statement_reviews",          await del("statement_reviews", "contact_id", idList));
    report("merchant_applications",      await del("merchant_applications", "contact_id", idList));
    report("merchant_profiles",          await del("merchant_profiles", "contact_id", idList));
    report("merchant_health_scores",     await del("merchant_health_scores", "contact_id", idList));
    report("merchant_residuals",         await del("merchant_residuals", "contact_id", idList));
    report("merchant_referrals",         await del("merchant_referrals", "referred_contact_id", idList));
    report("mid_daily_stats",            await del("mid_daily_stats", "contact_id", idList));

    // Proposals / referrals / deals
    report("co_branded_proposals",       await del("co_branded_proposals", "contact_id", idList));
    report("referrals",                  await del("referrals", "contact_id", idList));
    report("ma_events",                  await del("ma_events", "counterparty_contact_id", idList));
    report("prospects",                  await del("prospects", "contact_id", idList));
    report("prospects (conversion)",     await del("prospects", "conversion_contact_id", idList));
    report("deals",                      await del("deals", "contact_id", idList));

    // Circular FK: contacts.primary_source_event_id → contact_source_events.id
    // Must NULL that column on the test contacts BEFORE deleting contact_source_events
    try {
      await db.execute(sql.raw(
        `UPDATE "contacts" SET "primary_source_event_id" = NULL WHERE "id" IN (${idList})`
      ));
    } catch { /* column may not exist */ }
    report("contact_source_events",      await del("contact_source_events", "contact_id", idList));

    // Circular FK: ticket_comments.ticket_id → tickets.id
    // Must delete ticket_comments before tickets
    const ticketIdsResult = await db.execute(
      sql.raw(`SELECT id FROM "tickets" WHERE "contact_id" IN (${idList})`)
    ).catch(() => ({ rows: [] }));
    if (ticketIdsResult.rows.length > 0) {
      const ticketIdList = (ticketIdsResult.rows as any[]).map(r => r.id).join(",");
      report("ticket_comments",          await del("ticket_comments", "ticket_id", ticketIdList));
    }
    report("tickets",                    await del("tickets", "contact_id", idList));

    // Self-referential (children before parents)
    report("contacts (parent_ref)",      await del("contacts", "parent_contact_id", idList));

    console.log(`\n  Total child rows removed: ${total}`);

    // ── Step 3: Delete the test contacts ────────────────────────────────
    const deletedContacts = await db.execute(
      sql.raw(`DELETE FROM "contacts" WHERE "id" IN (${idList}) RETURNING id`)
    );
    console.log(`  ✓ Deleted ${deletedContacts.rows.length} test contacts`);
  }

  // ── Step 4: Delete merchant user accounts ────────────────────────────────
  console.log("\n👤 Cleaning up merchant user accounts...");
  const mu = await db.execute(sql`SELECT id, email FROM users WHERE role = 'merchant'`);
  console.log(`  Found ${mu.rows.length} merchant user accounts`);

  if (mu.rows.length > 0) {
    // Use subquery approach to avoid type-cast issues across different schemas

    // Sessions (sess stores user id as text)
    try {
      await db.execute(sql`
        DELETE FROM session
        WHERE (sess::jsonb->'passport'->>'user') IN (
          SELECT id::text FROM users WHERE role = 'merchant'
        )
      `);
    } catch { /* sessions table may not exist or have different schema */ }

    // Merchant portal records
    const mp = await db.execute(sql`
      DELETE FROM merchants
      WHERE user_id::text IN (SELECT id::text FROM users WHERE role = 'merchant')
      RETURNING id
    `).catch(() => ({ rows: [] }));
    if (mp.rows.length > 0) console.log(`  ✓ merchant portal records: ${mp.rows.length}`);

    // Documents uploaded by merchant users
    const md = await db.execute(sql`
      DELETE FROM documents
      WHERE uploaded_by IN (SELECT id FROM users WHERE role = 'merchant')
      RETURNING id
    `).catch(() => ({ rows: [] }));
    if (md.rows.length > 0) console.log(`  ✓ documents: ${md.rows.length}`);

    // Users themselves
    const du = await db.execute(sql`
      DELETE FROM users WHERE role = 'merchant' RETURNING id, email
    `);
    console.log(`  ✓ Deleted ${du.rows.length} merchant user accounts`);
  }

  // ── Step 5: Final state ───────────────────────────────────────────────────
  console.log("\n📊 Final state:");
  const [fc, fd, ft, fe, fu, leftover] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as n FROM contacts`),
    db.execute(sql`SELECT COUNT(*) as n FROM deals`),
    db.execute(sql`SELECT COUNT(*) as n FROM tasks WHERE deleted_at IS NULL`),
    db.execute(sql`SELECT COUNT(*) as n FROM sequence_enrollments`),
    db.execute(sql`SELECT role, COUNT(*) as n FROM users GROUP BY role ORDER BY n DESC`),
    db.execute(sql`
      SELECT COUNT(*) as n FROM contacts
      WHERE email ILIKE '%@test.internal' OR email ILIKE '%@example.test'
         OR email ILIKE 'wh-test-%' OR email ILIKE 'no-op-%' OR email ILIKE 'test-ca-%'
    `),
  ]);

  console.log(`  Contacts:             ${(fc.rows[0] as any).n}`);
  console.log(`  Deals:                ${(fd.rows[0] as any).n}`);
  console.log(`  Tasks:                ${(ft.rows[0] as any).n}`);
  console.log(`  Sequence enrollments: ${(fe.rows[0] as any).n}`);
  console.log(`  Users:                ${(fu.rows as any[]).map((r: any) => `${r.role}:${r.n}`).join(', ')}`);

  const rem = Number((leftover.rows[0] as any).n);
  console.log(rem === 0
    ? "\n✅ Clean — no test contacts remain."
    : `\n⚠️  ${rem} test contacts still present.`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
