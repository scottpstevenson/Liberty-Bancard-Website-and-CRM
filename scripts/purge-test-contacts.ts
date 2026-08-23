/**
 * purge-test-contacts.ts
 * One-shot cleanup: removes all synthetic QA/pre-deploy-gate contacts
 * (*.libertybancard.test and *.test.internal) from the database.
 * Safe: only touches rows whose email matches the two synthetic test domains.
 *
 * BT-06 KILL-LINE GUARD: This script will refuse to run unless:
 *   1. NODE_ENV === 'test'
 *   2. DATABASE_URL and TEST_DATABASE_URL identify the same disposable database
 */
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "purge-test-contacts" });
const { db } = await import("../server/db");
const { sql } = await import("drizzle-orm");

async function run(raw: string): Promise<number> {
  const res = await db.execute(sql.raw(raw));
  return (res as any).rowCount ?? (res as any).rows?.length ?? 0;
}

async function count(raw: string): Promise<number> {
  const res = await db.execute(sql.raw(raw));
  const rows = (res as any).rows ?? res;
  return Number(rows?.[0]?.count ?? rows?.[0]?.cnt ?? 0);
}

async function purge() {
  console.log("=== Test Contact Purge ===\n");

  const TEST_COND = `email LIKE '%@libertybancard.test' OR email LIKE '%@test.internal'`;
  const TEST_SUBQ = `SELECT id FROM contacts WHERE ${TEST_COND}`;
  const DEAL_SUBQ = `SELECT id FROM deals WHERE contact_id IN (${TEST_SUBQ})`;

  const before = await count(`SELECT COUNT(*)::text AS count FROM contacts WHERE ${TEST_COND}`);
  console.log(`Test contacts before: ${before}`);
  if (before === 0) { console.log("Nothing to purge."); process.exit(0); }

  // ── DEAL CHILDREN ────────────────────────────────────────────────────────
  for (const tbl of [
    "statement_proposals", "statement_requests", "co_branded_proposals",
    "equipment_orders", "ghl_activity_log", "calendar_events", "call_logs",
    "chargebacks", "documents", "email_logs", "health_alerts",
    "merchant_applications", "merchant_profiles", "merchant_referrals",
    "merchant_residuals", "mid_daily_stats", "nps_responses",
    "onboarding_checklist_items", "onboarding_steps", "rate_review_requests",
    "referrals", "residual_import_rows", "review_requests", "rfis",
    "sequence_enrollments", "tasks", "testimonial_submissions",
    "underwriting_decisions", "agent_merchants", "deal_competitors",
  ]) {
    try {
      const n = await run(`DELETE FROM ${tbl} WHERE deal_id IN (${DEAL_SUBQ})`);
      if (n > 0) console.log(`  [deal] ${tbl}: ${n}`);
    } catch (e: any) {
      if (!String(e.message).includes("does not exist") && !String(e.message).includes("column") )
        console.log(`  [deal] ${tbl}: SKIP — ${String(e.message).slice(0, 80)}`);
    }
  }

  // ── DEALS ────────────────────────────────────────────────────────────────
  const deals = await run(`DELETE FROM deals WHERE contact_id IN (${TEST_SUBQ})`);
  console.log(`  deals: ${deals}`);

  // ── CONTACT CHILDREN ────────────────────────────────────────────────────
  const contactChildren: [string, string][] = [
    ["sync_conflicts", "contact_id"], ["ghl_activity_log", "contact_id"],
    ["sequence_enrollments", "contact_id"], ["consent_audit_logs", "contact_id"],
    ["sdr_lead_state", "contact_id"], ["sdr_lead_events", "merchant_id"],
    ["referrals", "contact_id"], ["merchant_referrals", "referred_contact_id"],
    ["documents", "contact_id"], ["merchant_applications", "contact_id"],
    ["contact_source_events", "contact_id"], ["contact_ai_cache", "contact_id"],
    ["contact_companies", "contact_id"], ["contact_lead_scoring_jobs", "contact_id"],
    ["enrichment_runs", "contact_id"], ["outbound_messages", "contact_id"],
    ["outbound_send_log", "contact_id"], ["promotional_enrollment_jobs", "contact_id"],
    ["tasks", "contact_id"], ["tickets", "contact_id"],
    ["email_logs", "contact_id"], ["lead_sources", "contact_id"],
    ["call_logs", "contact_id"], ["health_alerts", "contact_id"],
    ["nps_responses", "contact_id"], ["review_requests", "contact_id"],
    ["rfis", "contact_id"], ["merchant_health_scores", "contact_id"],
    ["merchant_profiles", "contact_id"], ["merchant_residuals", "contact_id"],
    ["mid_daily_stats", "contact_id"], ["rate_review_requests", "contact_id"],
    ["chargebacks", "contact_id"], ["testimonial_submissions", "contact_id"],
    ["calendar_events", "contact_id"], ["live_chats", "contact_id"],
    ["prospects", "contact_id"], ["ma_events", "counterparty_contact_id"],
  ];

  for (const [tbl, col] of contactChildren) {
    try {
      const n = await run(`DELETE FROM ${tbl} WHERE ${col} IN (${TEST_SUBQ})`);
      if (n > 0) console.log(`  [contact] ${tbl}.${col}: ${n}`);
    } catch (e: any) {
      if (!String(e.message).includes("does not exist") && !String(e.message).includes("column"))
        console.log(`  [contact] ${tbl}.${col}: SKIP — ${String(e.message).slice(0, 80)}`);
    }
  }

  // NULL out self-referential parent_contact_id
  await run(`UPDATE contacts SET parent_contact_id = NULL WHERE parent_contact_id IN (${TEST_SUBQ})`);

  // NULL out circular FK: contacts.primary_source_event_id → contact_source_events
  // (contact_source_events also FKs back to contacts — must break circle before delete)
  await run(`UPDATE contacts SET primary_source_event_id = NULL WHERE ${TEST_COND}`);

  // Now safe to delete contact_source_events
  try {
    const n = await run(`DELETE FROM contact_source_events WHERE contact_id IN (${TEST_SUBQ})`);
    if (n > 0) console.log(`  [contact] contact_source_events (post-null): ${n}`);
  } catch(e: any) {
    console.log(`  [contact] contact_source_events: SKIP — ${String(e.message).slice(0, 120)}`);
  }

  // ── CONTACTS ─────────────────────────────────────────────────────────────
  const contacts = await run(`DELETE FROM contacts WHERE ${TEST_COND}`);
  console.log(`  contacts deleted: ${contacts}`);

  const after = await count(`SELECT COUNT(*)::text AS count FROM contacts WHERE ${TEST_COND}`);
  console.log(`\nRemaining test contacts: ${after}`);

  if (after > 0) {
    console.error("WARN: some test contacts remain — check FK constraints above.");
    process.exit(1);
  }
  console.log("✅ Purge complete.");
}

purge().catch(e => { console.error(e); process.exit(1); });
