#!/usr/bin/env tsx
/**
 * Speed-to-Lead Pipeline Smoke Test
 *
 * Creates a synthetic high-score lead, runs processNewLead(), and asserts:
 *   1. Lead is scored (leadScore set)
 *   2. Lifecycle advanced to at least ENGAGED
 *   3. NBA row exists in contact_nba
 *   4. next_sla_due_at is set (score meets threshold)
 *   5. All steps complete within 60 seconds
 *
 * Run: npx tsx scripts/test-speed-to-lead.ts
 * Exits 0 if all pass, 1 if any fail.
 */

import { pool, db } from "../server/db";
import { contacts, contactNba } from "../shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { processNewLead, LEAD_SLA_SCORE_THRESHOLD } from "../server/services/process-new-lead";

const MAX_DURATION_MS = 60_000;

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function cleanup(contactId: number) {
  // audit_logs is append-only (UPDATE and DELETE prohibited by DB policy) —
  // skip it. The smoke test contact uses a unique internal domain email so
  // orphaned audit rows do not affect production data.
  const steps: Array<{ sql: string; label: string }> = [
    { sql: "DELETE FROM contact_nba WHERE contact_id = $1", label: "contact_nba" },
    { sql: "DELETE FROM nba_recommendation_history WHERE contact_id = $1", label: "nba_history" },
    { sql: "DELETE FROM contact_lifecycle_history WHERE contact_id = $1", label: "lifecycle_history" },
    { sql: "DELETE FROM contact_source_events WHERE contact_id = $1", label: "source_events" },
    { sql: "DELETE FROM tasks WHERE contact_id = $1", label: "tasks" },
    { sql: "DELETE FROM sequence_enrollments WHERE contact_id = $1", label: "sequence_enrollments" },
    { sql: "DELETE FROM contacts WHERE id = $1", label: "contacts" },
  ];
  for (const step of steps) {
    try {
      await pool.query(step.sql, [contactId]);
    } catch (err: any) {
      console.warn(`[cleanup] Failed to remove ${step.label} for #${contactId}:`, err.message);
    }
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Speed-to-Lead Pipeline Smoke Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  const ts = Date.now();
  const testEmail = `stl-smoke-${ts}@test.libertybancard.internal`;

  // ── 1. Create synthetic contact ──────────────────────────────────────────
  let contactId: number;
  try {
    const [row] = await db
      .insert(contacts)
      .values({
        firstName: "SpeedToLead",
        lastName: "SmokeTest",
        email: testEmail,
        phone: `+1555${String(ts).slice(-7)}`,
        companyName: "Smoke Test Merchant LLC",
        vertical: "restaurants",
        monthlyVolume: "50000",
        leadScore: 0, // will be set by scoreContact
        consentEmail: true,
        consentSms: false,
        status: "New",
        lifecycleState: "PROSPECT",
      })
      .returning({ id: contacts.id });
    contactId = row.id;
    console.log(`  [setup] Created test contact #${contactId} (${testEmail})`);
  } catch (err: any) {
    console.error(`  ✗ FATAL: Could not create test contact — ${err.message}`);
    process.exit(1);
  }

  // ── 2. Run processNewLead ────────────────────────────────────────────────
  console.log(`\n─── Running processNewLead ───────────────────────────────`);
  const t0 = Date.now();
  let result: Awaited<ReturnType<typeof processNewLead>>;
  try {
    result = await processNewLead(contactId, { source: "smoke_test", trigger: "pre_deploy_gate" });
  } catch (err: any) {
    console.error(`  ✗ FATAL: processNewLead threw — ${err.message}`);
    await cleanup(contactId);
    process.exit(1);
  }
  const elapsed = Date.now() - t0;

  console.log(`\n─── Assertions ───────────────────────────────────────────`);

  // ── Assertion 1: Duration under 60 seconds ───────────────────────────────
  assert(
    `Pipeline completed within ${MAX_DURATION_MS / 1000}s`,
    elapsed < MAX_DURATION_MS,
    `took ${elapsed}ms`,
  );

  // ── Assertion 2: No fatal errors ─────────────────────────────────────────
  // Pipeline errors are tolerated (steps are independent) but we report them
  const fatalErrors = result.errors.filter(
    e => !e.includes("Backwards transition") && !e.includes("not found"),
  );
  assert(
    "No unexpected pipeline errors",
    fatalErrors.length === 0,
    fatalErrors.length ? fatalErrors[0] : undefined,
  );

  // ── Assertion 3: Lead score set ──────────────────────────────────────────
  const [freshContact] = await db
    .select({
      leadScore: contacts.leadScore,
      lifecycleState: contacts.lifecycleState,
      nextSlaDueAt: contacts.nextSlaDueAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  assert(
    "Lead score was computed",
    typeof freshContact?.leadScore === "number",
    `score=${freshContact?.leadScore}`,
  );

  // ── Assertion 4: Lifecycle advanced ─────────────────────────────────────
  const lifecycleOk =
    freshContact?.lifecycleState !== undefined &&
    freshContact.lifecycleState !== "PROSPECT";
  assert(
    "Lifecycle advanced past PROSPECT",
    lifecycleOk,
    `state=${freshContact?.lifecycleState}`,
  );

  // ── Assertion 5: NBA row exists ───────────────────────────────────────────
  const [nbaRow] = await db
    .select({ id: contactNba.id, actionType: contactNba.actionType })
    .from(contactNba)
    .where(eq(contactNba.contactId, contactId))
    .limit(1);
  assert(
    "NBA row computed and persisted",
    !!nbaRow,
    nbaRow ? `action=${nbaRow.actionType}` : "no row found",
  );

  // ── Assertion 6: SLA timer set for qualifying leads ───────────────────────
  const scoreQualifies = (freshContact?.leadScore ?? 0) >= LEAD_SLA_SCORE_THRESHOLD;
  if (scoreQualifies) {
    assert(
      "next_sla_due_at set for qualifying lead",
      !!freshContact?.nextSlaDueAt,
      `slaDue=${freshContact?.nextSlaDueAt?.toISOString() ?? "null"}`,
    );
    if (freshContact?.nextSlaDueAt) {
      const slaDueMs = freshContact.nextSlaDueAt.getTime() - Date.now();
      assert(
        "SLA timer is in the future",
        slaDueMs > 0,
        `slaDue in ${Math.round(slaDueMs / 60000)}m`,
      );
    }
  } else {
    console.log(
      `  ○ SLA timer check skipped — score ${freshContact?.leadScore ?? 0} < threshold ${LEAD_SLA_SCORE_THRESHOLD}`,
    );
  }

  // ── Assertion 7: API stats endpoint responds ──────────────────────────────
  // Only check if the dev server is running
  try {
    const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
    const health = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (health.ok) {
      // Server is up — check the stats endpoint (as admin via cookie would require auth;
      // just verify the endpoint exists and returns 401/403, not 404)
      const statsResp = await fetch(`${BASE_URL}/api/admin/lead-queue-stats`, {
        signal: AbortSignal.timeout(5000),
      });
      assert(
        "GET /api/admin/lead-queue-stats endpoint exists (not 404)",
        statsResp.status !== 404,
        `status=${statsResp.status}`,
      );
    } else {
      console.log("  ○ Server not reachable — skipping stats endpoint check");
    }
  } catch {
    console.log("  ○ Server not reachable — skipping stats endpoint check");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup(contactId);
  console.log(`\n  [cleanup] Test contact #${contactId} removed`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n─── Results ──────────────────────────────────────────────`);
  console.log(`  Passed: ${passed}  Failed: ${failed}  Duration: ${elapsed}ms`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
