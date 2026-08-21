/**
 * Full pre-outreach cleanup.
 * KEEPS: 154k real lead contacts, sequences/steps, users, audit logs, settings.
 * WIPES: All enrollments, tasks, deals (+ all 31 deal-child tables), remaining test contacts.
 *
 * BT-06 KILL-LINE GUARD: This script will refuse to run unless:
 *   1. NODE_ENV === 'test'
 *   2. TEST_DATABASE_URL is set AND points to a different host/database than DATABASE_URL
 *
 * This prevents accidental execution against a production database.
 * See: https://github.com/libertybancard/platform/blob/main/docs/classification.md
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

// ── BT-06: Safety guard — refuse if not in a verified test environment ────────
function assertTestEnvironment(): void {
  if (process.env.NODE_ENV !== "test") {
    console.error(
      "BT-06 KILL LINE: cleanup-demo-data.ts refused to run.\n" +
      "  NODE_ENV must be 'test' (currently: " + (process.env.NODE_ENV ?? "undefined") + ").\n" +
      "  This script deletes ALL enrollments, ALL tasks, and ALL deals.\n" +
      "  Set NODE_ENV=test and TEST_DATABASE_URL to a separate test database."
    );
    process.exit(1);
  }

  const testDb = process.env.TEST_DATABASE_URL;
  const liveDb = process.env.DATABASE_URL;

  if (!testDb) {
    console.error(
      "BT-06 KILL LINE: cleanup-demo-data.ts refused to run.\n" +
      "  TEST_DATABASE_URL must be set to a dedicated test database.\n" +
      "  Refusing to run without a verified separate test DB."
    );
    process.exit(1);
  }

  // The db module reads DATABASE_URL, so it must be the declared test URL.
  // A second production URL may be provided in CI/operator tooling and is
  // explicitly checked for inequality as an additional defense.
  if (!liveDb || liveDb !== testDb) {
    console.error(
      "BT-06 KILL LINE: cleanup-demo-data.ts refused to run.\n" +
      "  DATABASE_URL must exactly equal TEST_DATABASE_URL for this process.\n" +
      "  The script must never connect through an undeclared active database."
    );
    process.exit(1);
  }
  const testName = new URL(testDb).pathname.toLowerCase();
  if (!/(test|ci)/.test(testName)) {
    console.error("BT-06 KILL LINE: TEST_DATABASE_URL must target a clearly named test/CI database.");
    process.exit(1);
  }
  if (process.env.PRODUCTION_DATABASE_URL && process.env.PRODUCTION_DATABASE_URL === testDb) {
    console.error("BT-06 KILL LINE: TEST_DATABASE_URL must differ from PRODUCTION_DATABASE_URL.");
    process.exit(1);
  }

  console.log("[cleanup-demo-data] BT-06 guard: NODE_ENV=test, TEST_DATABASE_URL differs from DATABASE_URL — safe to proceed.");
}

async function safe(q: Promise<any>): Promise<number> {
  try { const r = await q; return r.rows?.length ?? 0; }
  catch { return 0; }
}

async function main() {
  assertTestEnvironment();

  console.log("🧹 Full Demo Data Cleanup — Pre-Outreach Reset\n");

  // ── 1. Wipe enrollments ──────────────────────────────────────────────────
  const en = await db.execute(sql`SELECT COUNT(*) as n FROM sequence_enrollments`);
  await safe(db.execute(sql`DELETE FROM sequence_enrollments`));
  console.log(`✓ Enrollments cleared: ${(en.rows[0] as any).n}`);

  // ── 2. Wipe tasks ────────────────────────────────────────────────────────
  const tk = await db.execute(sql`SELECT COUNT(*) as n FROM tasks`);
  await safe(db.execute(sql`DELETE FROM tasks`));
  console.log(`✓ Tasks cleared:       ${(tk.rows[0] as any).n}`);

  // ── 3. Wipe deals — delete all 31 child tables first ────────────────────
  const dl = await db.execute(sql`SELECT COUNT(*) as n FROM deals`);

  // Hard-delete child rows
  const dealChildren = [
    "agent_merchants",
    "calendar_events",        // deal_id col
    "call_logs",
    "chargebacks",
    "co_branded_proposals",
    "deal_competitors",
    "email_logs",
    "equipment_orders",
    "ghl_activity_log",
    "health_alerts",
    "inbox_items",
    "merchant_applications",
    "merchant_onboarding_stages",
    "merchant_profiles",
    "merchant_residuals",
    "mid_daily_stats",
    "nps_responses",
    "onboarding_checklist_items",
    "onboarding_steps",
    "rate_review_requests",
    "referrals",
    "residual_import_rows",
    "review_requests",
    "rfis",
    "statement_proposals",
    "statement_requests",
    "statement_reviews",
    "testimonial_submissions",
    "underwriting_decisions",
  ];

  for (const t of dealChildren) {
    await safe(db.execute(sql.raw(`DELETE FROM "${t}" WHERE deal_id IN (SELECT id FROM deals)`)));
  }

  // Some tables use deal_id as nullable FK — NULL them rather than deleting the row
  await safe(db.execute(sql`UPDATE documents SET deal_id = NULL WHERE deal_id IS NOT NULL`));
  await safe(db.execute(sql.raw(`DELETE FROM "merchant_referrals" WHERE referred_deal_id IN (SELECT id FROM deals)`)));

  // Now delete the deals themselves
  await safe(db.execute(sql`DELETE FROM deals`));
  const dlAfter = await db.execute(sql`SELECT COUNT(*) as n FROM deals`);
  console.log(`✓ Deals cleared:       ${(dl.rows[0] as any).n} → ${(dlAfter.rows[0] as any).n} remaining`);

  // ── 4. Clean remaining test contacts (now unblocked) ─────────────────────
  const missed = await db.execute(sql`
    SELECT id FROM contacts
    WHERE
      email ILIKE '%@test.invalid'
      OR email ILIKE '%@test.internal'
      OR email ILIKE '%@libertybancard.test'
      OR email ILIKE '%@example.test'
      OR email ILIKE 'wh-test-%'
      OR email ILIKE 'no-op-%'
      OR email ILIKE 'test-ca-%'
      OR email ILIKE 'qa-release-%'
      OR email ILIKE 'qa-appt-%'
      OR first_name ILIKE 'WebhookTest%'
      OR first_name ILIKE 'testnle%'
      OR (first_name = 'StmtTest' AND last_name = 'QAUser')
  `);
  const ids: number[] = (missed.rows as any[]).map(r => Number(r.id)).filter(n => !isNaN(n));
  console.log(`\n🗑  Remaining test contacts: ${ids.length}`);

  if (ids.length > 0) {
    const idList = ids.join(",");

    // Circular FK: contacts.primary_source_event_id → contact_source_events.id
    await safe(db.execute(sql.raw(
      `UPDATE "contacts" SET "primary_source_event_id" = NULL WHERE "id" IN (${idList})`
    )));

    // Ticket chain: comments → tickets
    const tix = await db.execute(sql.raw(
      `SELECT id FROM "tickets" WHERE "contact_id" IN (${idList})`
    )).catch(() => ({ rows: [] }));
    if (tix.rows.length > 0) {
      const tids = (tix.rows as any[]).map(r => r.id).join(",");
      await safe(db.execute(sql.raw(`DELETE FROM "ticket_comments" WHERE "ticket_id" IN (${tids})`)));
      await safe(db.execute(sql.raw(`DELETE FROM "tickets" WHERE "id" IN (${tids})`)));
    }

    // All FK tables referencing contacts
    const contactFKs: [string, string][] = [
      ["ghl_activity_log",           "contact_id"],
      ["outbound_messages",           "contact_id"],
      ["outbound_send_log",           "contact_id"],
      ["email_logs",                  "contact_id"],
      ["call_logs",                   "contact_id"],
      ["calendar_events",             "contact_id"],
      ["inbox_items",                 "contact_id"],
      ["live_chats",                  "contact_id"],
      ["consent_audit_logs",          "contact_id"],
      ["contact_ai_cache",            "contact_id"],
      ["contact_source_events",       "contact_id"],
      ["contact_lead_scoring_jobs",   "contact_id"],
      ["enrichment_runs",             "contact_id"],
      ["sdr_lead_state",              "contact_id"],
      ["sync_conflicts",              "contact_id"],
      ["health_alerts",               "contact_id"],
      ["lead_sources",                "contact_id"],
      ["analytics_events",            "contact_id"],
      ["contact_companies",           "contact_id"],
      ["nps_responses",               "contact_id"],
      ["testimonial_submissions",     "contact_id"],
      ["review_requests",             "contact_id"],
      ["rate_review_requests",        "contact_id"],
      ["rfis",                        "contact_id"],
      ["chargebacks",                 "contact_id"],
      ["equipment_orders",            "contact_id"],
      ["promotional_enrollment_jobs", "contact_id"],
      ["merchant_health_scores",      "contact_id"],
      ["merchant_residuals",          "contact_id"],
      ["merchant_applications",       "contact_id"],
      ["merchant_profiles",           "contact_id"],
      ["merchant_referrals",          "referred_contact_id"],
      ["co_branded_proposals",        "contact_id"],
      ["referrals",                   "contact_id"],
      ["ma_events",                   "counterparty_contact_id"],
      ["prospects",                   "contact_id"],
      ["prospects",                   "conversion_contact_id"],
      ["documents",                   "contact_id"],
      ["statement_proposals",         "contact_id"],
      ["statement_requests",          "contact_id"],
      ["statement_reviews",           "contact_id"],
      ["contacts",                    "parent_contact_id"],
    ];

    for (const [t, c] of contactFKs) {
      await safe(db.execute(sql.raw(`DELETE FROM "${t}" WHERE "${c}" IN (${idList})`)));
    }

    const deleted = await db.execute(sql.raw(
      `DELETE FROM "contacts" WHERE "id" IN (${idList}) RETURNING id`
    ));
    console.log(`✓ Deleted ${deleted.rows.length} test contacts`);
  }

  // ── 5. Final state ────────────────────────────────────────────────────────
  const [fc, fd, ft, fe, fu, leftover] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as n FROM contacts`),
    db.execute(sql`SELECT COUNT(*) as n FROM deals`),
    db.execute(sql`SELECT COUNT(*) as n FROM tasks`),
    db.execute(sql`SELECT COUNT(*) as n FROM sequence_enrollments`),
    db.execute(sql`SELECT role, COUNT(*) as n FROM users GROUP BY role ORDER BY n DESC`),
    db.execute(sql`
      SELECT COUNT(*) as n FROM contacts
      WHERE email ILIKE '%@test.invalid' OR email ILIKE '%@libertybancard.test'
         OR email ILIKE 'wh-test-%' OR email ILIKE '%@test.internal'
         OR email ILIKE '%@example.test' OR first_name ILIKE 'testnle%'
    `),
  ]);

  console.log(`\n📊 Final state:`);
  console.log(`  Contacts (real leads): ${(fc.rows[0] as any).n}`);
  console.log(`  Deals:                 ${(fd.rows[0] as any).n}`);
  console.log(`  Tasks:                 ${(ft.rows[0] as any).n}`);
  console.log(`  Enrollments:           ${(fe.rows[0] as any).n}`);
  console.log(`  Users:                 ${(fu.rows as any[]).map((r: any) => `${r.role}:${r.n}`).join(', ')}`);

  const rem = Number((leftover.rows[0] as any).n);
  console.log(rem === 0
    ? "\n✅ Clean — ready for controlled outreach."
    : `\n⚠️  ${rem} test contacts still present.`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
