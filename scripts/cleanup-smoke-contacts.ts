#!/usr/bin/env tsx
/**
 * One-time cleanup for orphaned smoke-test records left by smoke-golive-gate.ts
 * runs that pre-date the teardown fix (task #1422).
 *
 * Targets ONLY unambiguous smoke-test identifiers:
 *   • contacts whose email matches  glg-contact-%@test.example
 *   • contacts whose ghl_contact_id starts with  wh-test-ghl-  or  ghl-deal-test-
 *   • agent users whose email matches  glg-agent-%@libertybancard.test
 *
 * Uses the same dependency-aware deletion order as scripts/purge-test-contacts.ts
 * (deal children → deals → contact children → contacts → users) so FK constraints
 * are never violated.
 *
 * Usage:
 *   npx tsx scripts/cleanup-smoke-contacts.ts [--dry-run]
 *
 * --dry-run  Print counts of what would be deleted without touching the DB.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function run(raw: string): Promise<number> {
  if (DRY_RUN) return 0;
  const res = await db.execute(sql.raw(raw));
  return (res as any).rowCount ?? (res as any).rows?.length ?? 0;
}

async function count(raw: string): Promise<number> {
  const res = await db.execute(sql.raw(raw));
  const rows = (res as any).rows ?? res;
  return Number(rows?.[0]?.count ?? rows?.[0]?.cnt ?? 0);
}

async function purge() {
  console.log(`\n=== Cleanup smoke-test orphan records ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  // ── Identify target contacts ───────────────────────────────────────────────
  // Scope is intentionally narrow: only the exact email prefix written by
  // smoke-golive-gate.ts, plus the fake GHL ID prefixes used in older runs.
  const SMOKE_COND = [
    `email  LIKE 'glg-contact-%@test.example'`,
    `ghl_contact_id LIKE 'wh-test-ghl-%'`,
    `ghl_contact_id LIKE 'ghl-deal-test-%'`,
  ].join(" OR ");

  const CONTACT_SUBQ = `SELECT id FROM contacts WHERE ${SMOKE_COND}`;
  const DEAL_SUBQ    = `SELECT id FROM deals WHERE contact_id IN (${CONTACT_SUBQ})`;

  const before = await count(`SELECT COUNT(*)::text AS count FROM contacts WHERE ${SMOKE_COND}`);
  console.log(`Smoke-test contacts found: ${before}`);

  const usersBefore = await count(`SELECT COUNT(*)::text AS count FROM users WHERE email LIKE 'glg-agent-%@libertybancard.test'`);
  console.log(`Smoke-test agent users found: ${usersBefore}`);

  if (before === 0 && usersBefore === 0) {
    console.log("\n✓ Nothing to clean up — no orphan smoke records found.");
    process.exit(0);
  }

  if (DRY_RUN) {
    // In dry-run mode, also show which deals would be hit
    const dealsBefore = await count(`SELECT COUNT(*)::text AS count FROM deals WHERE contact_id IN (${CONTACT_SUBQ})`);
    console.log(`Associated deals found: ${dealsBefore}`);
    console.log("\n── DRY RUN — no records deleted ───────────────────────────────");
    process.exit(0);
  }

  // ── Deal children ──────────────────────────────────────────────────────────
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
      if (n > 0) console.log(`  [deal child] ${tbl}: ${n}`);
    } catch (e: any) {
      const msg = String(e.message);
      if (!msg.includes("does not exist") && !msg.includes("column"))
        console.log(`  [deal child] ${tbl}: SKIP — ${msg.slice(0, 80)}`);
    }
  }

  // ── Deals ──────────────────────────────────────────────────────────────────
  const dealsDeleted = await run(`DELETE FROM deals WHERE contact_id IN (${CONTACT_SUBQ})`);
  if (dealsDeleted > 0) console.log(`  deals: ${dealsDeleted}`);

  // ── Contact children ───────────────────────────────────────────────────────
  const contactChildren: [string, string][] = [
    ["sync_conflicts",                 "contact_id"],
    ["ghl_activity_log",               "contact_id"],
    ["sequence_enrollments",           "contact_id"],
    ["consent_audit_logs",             "contact_id"],
    ["sdr_lead_state",                 "contact_id"],
    ["sdr_lead_events",                "merchant_id"],
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
    try {
      const n = await run(`DELETE FROM ${tbl} WHERE ${col} IN (${CONTACT_SUBQ})`);
      if (n > 0) console.log(`  [contact child] ${tbl}.${col}: ${n}`);
    } catch (e: any) {
      const msg = String(e.message);
      if (!msg.includes("does not exist") && !msg.includes("column"))
        console.log(`  [contact child] ${tbl}.${col}: SKIP — ${msg.slice(0, 80)}`);
    }
  }

  // NULL out self-referential parent_contact_id
  await run(`UPDATE contacts SET parent_contact_id = NULL WHERE parent_contact_id IN (${CONTACT_SUBQ})`);

  // Break circular FK: contacts.primary_source_event_id → contact_source_events
  await run(`UPDATE contacts SET primary_source_event_id = NULL WHERE ${SMOKE_COND}`);

  try {
    const n = await run(`DELETE FROM contact_source_events WHERE contact_id IN (${CONTACT_SUBQ})`);
    if (n > 0) console.log(`  [contact child] contact_source_events (post-null): ${n}`);
  } catch (e: any) {
    console.log(`  [contact child] contact_source_events: SKIP — ${String(e.message).slice(0, 120)}`);
  }

  // ── Contacts ───────────────────────────────────────────────────────────────
  const contactsDeleted = await run(`DELETE FROM contacts WHERE ${SMOKE_COND}`);
  console.log(`  contacts deleted: ${contactsDeleted}`);

  // ── Agent users ────────────────────────────────────────────────────────────
  // glg-agent-* users are created directly in `users` — no FK children to worry about.
  const usersDeleted = await run(`DELETE FROM users WHERE email LIKE 'glg-agent-%@libertybancard.test'`);
  if (usersDeleted > 0) console.log(`  agent users deleted: ${usersDeleted}`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  const after = await count(`SELECT COUNT(*)::text AS count FROM contacts WHERE ${SMOKE_COND}`);
  console.log(`\nRemaining smoke contacts: ${after}`);

  if (after > 0) {
    console.error("WARN: some smoke contacts remain — check FK constraints above.");
    process.exit(1);
  }

  console.log("✓ Cleanup complete. GHL circuit breaker should recover on the next sync tick.");
}

purge().catch(e => { console.error(e); process.exit(1); });
