#!/usr/bin/env tsx
/**
 * Cleanup for orphaned smoke/e2e-test records left by smoke-golive-gate.ts and
 * test-appointment-statement.ts runs whose teardown did not fire.
 *
 * Targets ONLY unambiguous test identifiers:
 *   • contacts whose email matches  glg-contact-%@test.example
 *   • contacts whose ghl_contact_id starts with  wh-test-ghl- , ghl-deal-test- , or c1-test-
 *   • sdr_merchants (and their FK children incl. sdr_lead_state) whose
 *     ghl_contact_id starts with any of the same three prefixes
 *   • agent users whose email matches  glg-agent-%@libertybancard.test
 *
 * The entire deletion sequence runs in a single transaction on a dedicated
 * pool client (BEGIN/COMMIT/ROLLBACK). Tolerated errors (missing table or
 * column on optional child tables) are isolated with SAVEPOINTs so they do
 * not abort the transaction; any other error rolls the whole run back and
 * exits non-zero.
 *
 * Usage:
 *   npx tsx scripts/cleanup-smoke-contacts.ts [--dry-run]
 *
 * --dry-run  Print counts of what would be deleted without touching the DB.
 */

import { pool } from "../server/db";

const DRY_RUN = process.argv.includes("--dry-run");

function assertTestEnvironment(): void {
  const activeDb = process.env.DATABASE_URL;
  const testDb = process.env.TEST_DATABASE_URL;
  if (process.env.NODE_ENV !== "test" || !activeDb || !testDb || activeDb !== testDb) {
    throw new Error("BT-06 KILL LINE: cleanup-smoke-contacts.ts only runs with NODE_ENV=test and DATABASE_URL=TEST_DATABASE_URL.");
  }
  const dbName = new URL(testDb).pathname.toLowerCase();
  if (!/(test|ci)/.test(dbName) || process.env.PRODUCTION_DATABASE_URL === testDb) {
    throw new Error("BT-06 KILL LINE: cleanup-smoke-contacts.ts requires a separate clearly named test/CI database.");
  }
}

// ── Predicates ───────────────────────────────────────────────────────────────
const GHL_ID_PREFIXES = [
  `LIKE 'wh-test-ghl-%'`,
  `LIKE 'ghl-deal-test-%'`,
  `LIKE 'c1-test-%'`,
];

const SMOKE_COND = [
  `email LIKE 'glg-contact-%@test.example'`,
  ...GHL_ID_PREFIXES.map(p => `ghl_contact_id ${p}`),
].join(" OR ");

const SDR_COND = GHL_ID_PREFIXES.map(p => `ghl_contact_id ${p}`).join(" OR ");

const CONTACT_SUBQ = `SELECT id FROM contacts WHERE ${SMOKE_COND}`;
const DEAL_SUBQ    = `SELECT id FROM deals WHERE contact_id IN (${CONTACT_SUBQ})`;
const SDR_SUBQ     = `SELECT id FROM sdr_merchants WHERE ${SDR_COND}`;

async function main() {
  assertTestEnvironment();
  console.log(`\n=== Cleanup smoke-test orphan records ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  const client = await pool.connect();

  const count = async (raw: string): Promise<number> => {
    const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${raw}`);
    return Number(res.rows[0]?.count ?? 0);
  };

  try {
    // ── Inventory (always read-only) ────────────────────────────────────────
    const contactsBefore = await count(`contacts WHERE ${SMOKE_COND}`);
    const dealsBefore    = await count(`deals WHERE contact_id IN (${CONTACT_SUBQ})`);
    const sdrBefore      = await count(`sdr_merchants WHERE ${SDR_COND}`);
    const sdrLeadBefore  = await count(`sdr_lead_state WHERE merchant_id IN (${SDR_SUBQ})`);
    const usersBefore    = await count(`users WHERE email LIKE 'glg-agent-%@libertybancard.test'`);

    console.log(`Smoke-test contacts found:       ${contactsBefore}`);
    console.log(`Associated deals found:          ${dealsBefore}`);
    console.log(`Smoke-test sdr_merchants found:  ${sdrBefore}`);
    console.log(`Associated sdr_lead_state found: ${sdrLeadBefore}`);
    console.log(`Smoke-test agent users found:    ${usersBefore}`);

    if (contactsBefore === 0 && sdrBefore === 0 && usersBefore === 0) {
      console.log("\n✓ Nothing to clean up — no orphan smoke records found.");
      return;
    }

    if (DRY_RUN) {
      console.log("\n── DRY RUN — no records deleted ───────────────────────────────");
      return;
    }

    // ── Transactional deletion ─────────────────────────────────────────────
    await client.query("BEGIN");
    // Large cascades can exceed the pool's default 30 s statement timeout.
    await client.query("SET LOCAL statement_timeout = 0");

    let spN = 0;
    /**
     * Run a DELETE/UPDATE inside a savepoint. Missing-table / missing-column
     * errors on optional child tables are tolerated (rolled back to the
     * savepoint); anything else aborts the whole transaction.
     */
    const run = async (label: string, sqlText: string, tolerant = true): Promise<number> => {
      const sp = `sp_${++spN}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const res = await client.query(sqlText);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        const n = res.rowCount ?? 0;
        if (n > 0) console.log(`  ${label}: ${n}`);
        return n;
      } catch (e: any) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        // 42P01 undefined_table, 42703 undefined_column
        if (tolerant && (e.code === "42P01" || e.code === "42703")) {
          return 0;
        }
        throw new Error(`${label} failed: ${e.message}`);
      }
    };

    // ── SDR tables (children of sdr_merchants, then sdr_merchants) ─────────
    await run("[sdr child] sdr_lead_events (by lead_state)", `DELETE FROM sdr_lead_events WHERE lead_state_id IN (SELECT id FROM sdr_lead_state WHERE merchant_id IN (${SDR_SUBQ}))`);
    await run("[sdr child] sdr_lead_events", `DELETE FROM sdr_lead_events WHERE merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] sdr_channel_attempts", `DELETE FROM sdr_channel_attempts WHERE merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] sdr_compliance_state", `DELETE FROM sdr_compliance_state WHERE merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] sdr_merchant_contacts", `DELETE FROM sdr_merchant_contacts WHERE merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] sdr_lead_state", `DELETE FROM sdr_lead_state WHERE merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] registry_import_log (matched)", `UPDATE registry_import_log SET matched_merchant_id = NULL WHERE matched_merchant_id IN (${SDR_SUBQ})`);
    await run("[sdr child] registry_import_log (runner-up)", `UPDATE registry_import_log SET runner_up_merchant_id = NULL WHERE runner_up_merchant_id IN (${SDR_SUBQ})`);
    const sdrDeleted = await run("sdr_merchants deleted", `DELETE FROM sdr_merchants WHERE ${SDR_COND}`, false);

    // ── Deal children ──────────────────────────────────────────────────────
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
      await run(`[deal child] ${tbl}`, `DELETE FROM ${tbl} WHERE deal_id IN (${DEAL_SUBQ})`);
    }

    // ── Deals ──────────────────────────────────────────────────────────────
    const dealsDeleted = await run("deals deleted", `DELETE FROM deals WHERE contact_id IN (${CONTACT_SUBQ})`, false);

    // ── Contact children ───────────────────────────────────────────────────
    const contactChildren: [string, string][] = [
      ["sync_conflicts",                 "contact_id"],
      ["ghl_activity_log",               "contact_id"],
      ["sequence_enrollments",           "contact_id"],
      ["consent_audit_logs",             "contact_id"],
      ["sdr_lead_state",                 "contact_id"],
      ["referrals",                      "contact_id"],
      ["merchant_referrals",             "referred_contact_id"],
      ["documents",                      "contact_id"],
      ["merchant_applications",          "contact_id"],
      ["contact_ai_cache",               "contact_id"],
      ["contact_companies",              "contact_id"],
      ["contact_lead_scoring_jobs",      "contact_id"],
      ["enrichment_runs",                "contact_id"],
      ["outbound_messages",              "contact_id"],
      ["outbound_send_log",              "contact_id"],
      ["promotional_enrollment_jobs",    "contact_id"],
      ["tasks",                          "contact_id"],
      ["tickets",                        "contact_id"],
      ["email_logs",                     "contact_id"],
      ["lead_sources",                   "contact_id"],
      ["call_logs",                      "contact_id"],
      ["health_alerts",                  "contact_id"],
      ["nps_responses",                  "contact_id"],
      ["review_requests",                "contact_id"],
      ["rfis",                           "contact_id"],
      ["merchant_health_scores",         "contact_id"],
      ["merchant_profiles",              "contact_id"],
      ["merchant_residuals",             "contact_id"],
      ["mid_daily_stats",                "contact_id"],
      ["rate_review_requests",           "contact_id"],
      ["chargebacks",                    "contact_id"],
      ["testimonial_submissions",        "contact_id"],
      ["calendar_events",                "contact_id"],
      ["live_chats",                     "contact_id"],
      ["prospects",                      "contact_id"],
      ["ma_events",                      "counterparty_contact_id"],
    ];

    for (const [tbl, col] of contactChildren) {
      await run(`[contact child] ${tbl}.${col}`, `DELETE FROM ${tbl} WHERE ${col} IN (${CONTACT_SUBQ})`);
    }

    // NULL out self-referential parent_contact_id
    await run("contacts parent_contact_id nulled", `UPDATE contacts SET parent_contact_id = NULL WHERE parent_contact_id IN (${CONTACT_SUBQ})`);

    // Break circular FK: contacts.primary_source_event_id → contact_source_events
    await run("contacts primary_source_event_id nulled", `UPDATE contacts SET primary_source_event_id = NULL WHERE ${SMOKE_COND}`);
    await run("[contact child] contact_source_events", `DELETE FROM contact_source_events WHERE contact_id IN (${CONTACT_SUBQ})`);

    // ── Contacts ───────────────────────────────────────────────────────────
    const contactsDeleted = await run("contacts deleted", `DELETE FROM contacts WHERE ${SMOKE_COND}`, false);

    // ── Agent users ────────────────────────────────────────────────────────
    await run("agent users deleted", `DELETE FROM users WHERE email LIKE 'glg-agent-%@libertybancard.test'`, false);

    // ── Verify inside the transaction before committing ────────────────────
    const remainContacts = await count(`contacts WHERE ${SMOKE_COND}`);
    const remainSdr      = await count(`sdr_merchants WHERE ${SDR_COND}`);
    const remainSdrLead  = await count(`sdr_lead_state WHERE merchant_id IN (${SDR_SUBQ})`);

    if (remainContacts > 0 || remainSdr > 0 || remainSdrLead > 0) {
      throw new Error(
        `Post-delete check failed inside transaction: contacts=${remainContacts}, sdr_merchants=${remainSdr}, sdr_lead_state=${remainSdrLead} — rolling back.`
      );
    }

    await client.query("COMMIT");

    console.log(`\n  contacts deleted:      ${contactsDeleted}`);
    console.log(`  deals deleted:         ${dealsDeleted}`);
    console.log(`  sdr_merchants deleted: ${sdrDeleted}`);
    console.log(`\nRemaining smoke contacts: 0`);
    console.log("✓ Cleanup complete. GHL circuit breaker should recover on the next sync tick.");
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch { /* not in txn */ }
    console.error(`\n✗ Cleanup aborted — transaction rolled back.\n${e.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
