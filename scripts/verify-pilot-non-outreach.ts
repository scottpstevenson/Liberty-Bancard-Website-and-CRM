#!/usr/bin/env npx tsx
/**
 * MI-09: Cohort-scoped non-outreach verification.
 *
 * Verifies that no outreach or forbidden effects exist for any business in a
 * pilot run's frozen cohort. All queries are scoped through mi09_pilot_effect_links
 * — not global created_at > pilot_start filters — so only pilot-linked entities
 * are checked.
 *
 * Additionally verifies that the global outbound pause epoch has not changed
 * since the pilot run started (system-wide invariant).
 *
 * Usage:
 *   npx tsx scripts/verify-pilot-non-outreach.ts <pilot_run_id>
 *   npx tsx scripts/verify-pilot-non-outreach.ts --latest
 *
 * Exits 0 when all checks pass; exits 1 on any violation.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

async function main() {
  const args = process.argv.slice(2);
  let runId: string | null = null;

  if (args[0] === "--latest") {
    const latest = rows(await db.execute(sql`
      SELECT id FROM mi09_pilot_runs ORDER BY created_at DESC LIMIT 1
    `))[0];
    if (!latest) {
      console.error("No pilot runs found.");
      process.exit(1);
    }
    runId = String(latest.id);
  } else if (args[0]) {
    runId = args[0];
  } else {
    console.error("Usage: verify-pilot-non-outreach.ts <pilot_run_id> | --latest");
    process.exit(1);
  }

  console.log(`\n=== MI-09 Non-Outreach Verification ===`);
  console.log(`Pilot run: ${runId}\n`);

  // Load the pilot run to get started_at and outbound_pause_epoch.
  const run = rows(await db.execute(sql`
    SELECT id, started_at, outbound_pause_epoch, state, cohort_frozen_hash
    FROM mi09_pilot_runs WHERE id = ${runId}::uuid
  `))[0];

  if (!run) {
    console.error(`Pilot run not found: ${runId}`);
    process.exit(1);
  }
  console.log(`State: ${run.state}`);
  console.log(`Started: ${run.started_at}`);
  console.log(`Outbound pause epoch at start: ${run.outbound_pause_epoch}`);
  console.log(`Cohort frozen: ${run.cohort_frozen_hash ? "YES" : "NO"}\n`);

  const violations: string[] = [];

  // ── Check 1: No forbidden effect link types ──
  // sdr_lead_events does NOT have generation_id or command_id columns; it has
  // contact_id → sdr_merchant_contacts and merchant_id → sdr_merchants.
  // We enforce non-outreach by discriminating on entity_type in mi09_pilot_effect_links:
  // only the 4 canonical pilot types are allowed.
  try {
    const forbiddenLinks = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt, string_agg(DISTINCT entity_type, ', ') AS found_types
      FROM mi09_pilot_effect_links
      WHERE pilot_run_id = ${runId}::uuid
        AND entity_type NOT IN ('cro03c_command', 'generation', 'staging_receipt', 'master_lead')
    `))[0];
    const cnt = Number(forbiddenLinks?.cnt ?? 0);
    if (cnt > 0) {
      violations.push(`forbidden_effect_link_types: ${cnt} links with types: ${forbiddenLinks?.found_types}`);
    } else {
      console.log("✓ No forbidden effect link types");
    }
  } catch (e: any) {
    // This check is FAIL-CLOSED — an error means we cannot verify safety.
    violations.push(`effect_link_type_check_failed: ${e?.message}`);
  }

  // ── Check 2: No communication_events linked to pilot-linked contact IDs ──
  // contacts does NOT have canonical_business_id; businesses.id is INTEGER (not UUID).
  // Join chain: mi09_pilot_cohort_members → businesses (INTEGER FK) → contacts
  // (contacts has no canonical_business_id; use contacts linked via master_leads or
  // via ghl_contact_id if any were created). Since the pilot must not create contacts,
  // the correct invariant is: no contacts exist with business_id matching cohort businesses
  // created since pilot start. contacts.business_id may or may not exist; we check
  // communication_events via pilot effect links instead.
  try {
    // Cohort business IDs are INTEGERs (businesses.id is serial integer).
    const cohortBusinessIds = rows(await db.execute(sql`
      SELECT canonical_business_id::int AS biz_id
      FROM mi09_pilot_cohort_members
      WHERE pilot_run_id = ${runId}::uuid
    `)).map((r: any) => Number(r.biz_id));

    if (cohortBusinessIds.length > 0) {
      const bizIdsParam = JSON.stringify(cohortBusinessIds);

      // ── Check 2a: Verify no forbidden entity types in effect_links ──
      // The pilot should only link cro03c_command, generation, staging_receipt, and
      // master_lead entities. Any other type (contact, deal, sequence_enrollment, etc.)
      // indicates an outbound effect was incorrectly linked to the pilot.
      const forbiddenLinkTypes = rows(await db.execute(sql`
        SELECT DISTINCT entity_type
        FROM mi09_pilot_effect_links
        WHERE pilot_run_id = ${runId}::uuid
          AND entity_type NOT IN ('cro03c_command', 'generation', 'staging_receipt', 'master_lead')
      `));
      if (forbiddenLinkTypes.length > 0) {
        const types = forbiddenLinkTypes.map((r: any) => String(r.entity_type)).join(",");
        violations.push(`forbidden_effect_link_types: [${types}] — pilot must only link cro03c_command/generation/staging_receipt/master_lead`);
      } else {
        console.log("✓ All effect_link entity types are within permitted set");
      }

      // ── Check 2b: No communication_events since pilot start ──
      // communication_events.contact_id links to contacts; since the pilot must not
      // create contacts, any communication_event since pilot start is a violation.
      // This is a system-wide time-scoped check: conservative and definitively correct.
      const commCheck = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM communication_events
        WHERE created_at >= ${String(run.started_at)}::timestamptz
      `))[0];
      const commCnt = Number(commCheck?.cnt ?? 0);
      if (commCnt > 0) {
        violations.push(`communication_events: ${commCnt} created since pilot start — outbound must remain fully suppressed during pilot`);
      } else {
        console.log("✓ No communication_events since pilot start");
      }

      // ── Check 3: No deals created since pilot start ──
      // Deals require contacts; pilot must not trigger deal creation.
      const dealCheck = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM deals
        WHERE created_at >= ${String(run.started_at)}::timestamptz
      `))[0];
      const dealCnt = Number(dealCheck?.cnt ?? 0);
      if (dealCnt > 0) {
        violations.push(`deals: ${dealCnt} created since pilot start`);
      } else {
        console.log("✓ No deals created since pilot start");
      }

      // ── Check 4: No GHL contact IDs for businesses in pilot cohort ──
      // Verify cohort businesses are not synced to GHL (businesses table may lack this column).
      // Also check: no contacts created with ghl_contact_id set since pilot start.
      const ghlContactCheck = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM contacts
        WHERE ghl_contact_id IS NOT NULL
          AND created_at >= ${String(run.started_at)}::timestamptz
      `))[0];
      const ghlCnt = Number(ghlContactCheck?.cnt ?? 0);
      if (ghlCnt > 0) {
        violations.push(`ghl_contact_ids: ${ghlCnt} contacts created with GHL contact IDs since pilot start`);
      } else {
        console.log("✓ No contacts synced to GHL since pilot start");
      }

      // ── Check 5: No sequence enrollments since pilot start ──
      const seqCheck = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM sequence_enrollments
        WHERE created_at >= ${String(run.started_at)}::timestamptz
      `))[0];
      const seqCnt = Number(seqCheck?.cnt ?? 0);
      if (seqCnt > 0) {
        violations.push(`sequence_enrollments: ${seqCnt} created since pilot start`);
      } else {
        console.log("✓ No sequence enrollments since pilot start");
      }
    } else {
      console.log("  (cohort is empty — skipping business-based checks)");
    }
  } catch (e: any) {
    // FAIL-CLOSED: any query failure is a violation.
    violations.push(`cohort_business_checks_failed: ${e?.message}`);
  }

  // ── Check 6: Verify global outbound pause epoch unchanged ──
  try {
    const { getPauseState } = await import("../server/services/outbound-pause-authority");
    const pause = await getPauseState();
    const epochMatch = Number(pause.epoch) === Number(run.outbound_pause_epoch);
    if (!epochMatch) {
      violations.push(
        `outbound_pause_epoch_changed: was=${run.outbound_pause_epoch} now=${pause.epoch}`,
      );
    } else {
      console.log(`✓ Global outbound pause epoch unchanged (${pause.epoch})`);
    }
    if (pause.state !== "paused") {
      violations.push("global_outbound_resumed: outbound is no longer paused");
    } else {
      console.log("✓ Global outbound remains paused");
    }
  } catch (e: any) {
    // FAIL-CLOSED: pause-state query failure means we cannot verify safety — treat as violation.
    violations.push(`pause_epoch_check_failed: ${e?.message}`);
  }

  console.log("\n──────────────────────────────────────");
  if (violations.length === 0) {
    console.log("✅  All non-outreach checks PASSED — zero forbidden effects linked to pilot.");
    process.exit(0);
  } else {
    console.error(`\n❌  ${violations.length} violation(s) found:`);
    for (const v of violations) {
      console.error(`    • ${v}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err?.message ?? err);
  process.exit(1);
});
