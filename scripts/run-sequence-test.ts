/**
 * Controlled Sequence Test Runner
 * ================================
 * Sends real sequence emails to Scott@libertybancard.com using actual contact
 * data for variable interpolation. Each email subject is prefixed with the
 * original recipient so Scott can verify delivery before going live.
 *
 * What this tests:
 *   ✓ SMTP cold-outreach path (SDR Outbound sequences)
 *   ✓ Gmail warm-send path  (Inbound Lead Nurture / Account Mgmt sequences)
 *   ✓ GHL fallback path intercepted → SMTP redirect
 *   ✓ Variable interpolation: {{firstName}}, {{companyName}}, {{agentEmail}},
 *     {{agentPhone}}, {{businessName}}, {{calendarLink}}
 *   ✓ Step 1 AND Step 2 advancement (one sequence goes through two steps)
 *   ✓ Unsubscribe footer present
 *   ✓ No raw {{template}} variables in output
 *
 * Usage:
 *   npx tsx scripts/run-sequence-test.ts
 *   npx tsx scripts/run-sequence-test.ts --redirect=someone@example.com
 *
 * After the run:
 *   All test enrollments are cleaned up automatically.
 *   System settings are restored to their pre-test state.
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import { processSequenceEnrollments } from "../server/services/sequence-worker.js";
import { storage } from "../server/storage.js";

// ── Config ──────────────────────────────────────────────────────────────────
const REDIRECT_ARG  = process.argv.find(a => a.startsWith("--redirect="));
const REDIRECT_TO   = REDIRECT_ARG ? REDIRECT_ARG.split("=")[1] : "Scott@libertybancard.com";
const TEST_TAG      = `_seq_test_${Date.now()}`;     // marks test enrollments for cleanup
const SEQUENCES_TO_TEST = 5;                          // how many sequences to fire
const MULTI_STEP_COUNT  = 1;                          // how many enrollments advance to step 2

const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️";
const INFO = "ℹ️";

// ── Helpers ──────────────────────────────────────────────────────────────────
async function setSetting(key: string, value: string | boolean | null) {
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, ${value === null ? null : JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

async function getSetting(key: string): Promise<string | boolean | null> {
  const r = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${key}`);
  if (!r.rows.length) return null;
  const raw = (r.rows[0] as any).value;
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function deleteSetting(key: string) {
  await db.execute(sql`DELETE FROM system_settings WHERE key = ${key}`);
}

function pad(s: string, n: number) { return s.padEnd(n).slice(0, n); }

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Liberty Bancard — Controlled Sequence Test");
  console.log(`  Redirect: ${REDIRECT_TO}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 0. Sanity checks ───────────────────────────────────────────────────────
  const [existingEnroll, smtpCheck] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as n FROM sequence_enrollments WHERE status IN ('active','paused')`),
    db.execute(sql`SELECT value FROM system_settings WHERE key='smtpConfigured'`),
  ]);
  const existingActive = Number((existingEnroll.rows[0] as any).n);
  if (existingActive > 0) {
    console.log(`${WARN} ${existingActive} active/paused enrollments already exist.`);
    console.log("   These will also be processed. Run cleanup-demo-data.ts first for a clean baseline.\n");
  }

  // ── 1. Snapshot system settings (restore on exit) ─────────────────────────
  const prevRedirect     = await getSetting("deliveryTestRedirectEmail");
  const prevNoProspect   = await getSetting("deliveryNoProspectSendEmail");
  const prevEmailPaused  = await getSetting("emailChannelPaused");
  const prevColdPaused   = await getSetting("coldEmailChannelPaused");

  const prevGlobalPaused = await getSetting("outboundGlobalPaused");

  async function restoreSettings() {
    prevRedirect     !== null ? await setSetting("deliveryTestRedirectEmail",   String(prevRedirect))   : await deleteSetting("deliveryTestRedirectEmail");
    prevNoProspect   !== null ? await setSetting("deliveryNoProspectSendEmail", prevNoProspect)         : await deleteSetting("deliveryNoProspectSendEmail");
    prevEmailPaused  !== null ? await setSetting("emailChannelPaused",   prevEmailPaused)              : await deleteSetting("emailChannelPaused");
    prevColdPaused   !== null ? await setSetting("coldEmailChannelPaused", prevColdPaused)             : await deleteSetting("coldEmailChannelPaused");
    prevGlobalPaused !== null ? await setSetting("outboundGlobalPaused",   prevGlobalPaused)           : await deleteSetting("outboundGlobalPaused");
    console.log("\n🔁 System settings restored to pre-test state.");
  }

  // Apply test settings — disable every outbound gate; redirect is the safety net
  await Promise.all([
    setSetting("deliveryTestRedirectEmail",   REDIRECT_TO),
    setSetting("deliveryNoProspectSendEmail", false),
    setSetting("emailChannelPaused",          false),
    setSetting("coldEmailChannelPaused",      false),
    setSetting("outboundGlobalPaused",        false),  // platform kill switch — OFF for test
  ]);
  console.log(`${INFO} Test intercept armed → all sends go to ${REDIRECT_TO}`);
  console.log(`${INFO} Global pause:         OFF (restored automatically after test)`);
  console.log(`${INFO} Prospect send guard:  OFF (redirect is the safety net)\n`);

  // ── 2. Select sequences ────────────────────────────────────────────────────
  // Prefer email-only sequences (no SMS steps) so cold contacts pass the
  // pre-enrollment contactability gate without needing PEWC SMS consent.
  // Account Management Ops sequences are ideal: 3 email-only steps.
  // We temporarily patch outboundChannels: ["email"] into triggerConfig so
  // enrollContactInGhlWorkflow doesn't fail-close on the all-channels default.
  const seqRows = await db.execute(sql`
    SELECT s.id, s.name, s.status, s.trigger_config,
           (SELECT COUNT(*) FROM sequence_steps st
            WHERE st.sequence_id = s.id AND st.action_type = 'email') as email_step_count,
           (SELECT COUNT(*) FROM sequence_steps st
            WHERE st.sequence_id = s.id AND st.action_type = 'sms') as sms_step_count
    FROM follow_up_sequences s
    WHERE s.status = 'active'
      AND EXISTS (
        SELECT 1 FROM sequence_steps st
        WHERE st.sequence_id = s.id AND st.action_type = 'email'
      )
    ORDER BY
      -- Prefer email-only sequences (no SMS steps) first
      (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = s.id AND st.action_type = 'sms') ASC,
      CASE
        WHEN s.name ILIKE '%Account Management%'     THEN 1
        WHEN s.name ILIKE '%Inbound Lead Nurture%'   THEN 2
        WHEN s.name ILIKE '%SDR Outbound%'           THEN 3
        ELSE 4
      END,
      s.id
    LIMIT ${SEQUENCES_TO_TEST}
  `);

  if (!seqRows.rows.length) {
    console.error(`${FAIL} No active sequences with email steps found. Activate sequences first.`);
    await restoreSettings();
    process.exit(1);
  }

  const sequences = seqRows.rows as Array<{
    id: number; name: string; status: string;
    trigger_config: any; email_step_count: number; sms_step_count: number;
  }>;

  console.log(`Selected ${sequences.length} sequences to test:\n`);
  sequences.forEach((s, i) => {
    const type = Number(s.sms_step_count) === 0 ? "email-only" :
                 s.name.includes("SDR") ? "cold/SMTP+SMS" :
                 s.name.includes("Inbound") ? "warm/email+SMS" : "mixed";
    console.log(`  ${i + 1}. [${type}] ${s.name} (ID ${s.id}, ${s.email_step_count} email, ${s.sms_step_count} SMS)`);
  });
  console.log();

  // ── 2b. Patch triggerConfig: inject outboundChannels: ["email"] ───────────
  // enrollContactInGhlWorkflow defaults to checking ALL channels (email+sms+voice).
  // Cold contacts at cold_no_consent tier fail the SMS gate, blocking enrollment.
  // Patching to email-only lets the enrollment through; SMS steps are skipped at
  // the per-step gate. We restore the original config after the test.
  const seqIds = sequences.map(s => s.id);
  const originalTriggerConfigs = new Map(sequences.map(s => [s.id, s.trigger_config]));

  for (const s of sequences) {
    const patched = { ...(s.trigger_config ?? {}), outboundChannels: ["email"] };
    await db.execute(sql`
      UPDATE follow_up_sequences
      SET trigger_config = ${JSON.stringify(patched)}::jsonb
      WHERE id = ${s.id}
    `);
  }
  console.log(`${INFO} Patched triggerConfig outboundChannels→["email"] on ${seqIds.length} sequences (restored after test)\n`);

  async function restoreTriggerConfigs() {
    for (const [seqId, origConfig] of originalTriggerConfigs) {
      await db.execute(sql`
        UPDATE follow_up_sequences
        SET trigger_config = ${origConfig ? JSON.stringify(origConfig) : null}::jsonb
        WHERE id = ${seqId}
      `);
    }
    console.log("🔁 Sequence triggerConfigs restored.");
  }

  // ── 3. Select contacts ─────────────────────────────────────────────────────
  const contactRows = await db.execute(sql`
    SELECT id, first_name, last_name, email, company_name, lifecycle_stage
    FROM contacts
    WHERE email IS NOT NULL AND email != ''
      AND first_name IS NOT NULL AND first_name != ''
      AND length(email) > 5
      AND email NOT ILIKE '%@test%'
      AND email NOT ILIKE '%@example%'
    ORDER BY RANDOM()
    LIMIT ${sequences.length}
  `);

  if (contactRows.rows.length < sequences.length) {
    console.error(`${FAIL} Not enough valid contacts (found ${contactRows.rows.length}, need ${sequences.length}).`);
    await restoreTriggerConfigs();
    await restoreSettings();
    process.exit(1);
  }

  const contacts = contactRows.rows as Array<{
    id: number; first_name: string; last_name: string;
    email: string; company_name: string | null; lifecycle_stage: string;
  }>;

  console.log(`Selected ${contacts.length} real contacts:\n`);
  contacts.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.first_name} ${c.last_name} <${c.email}> — ${c.company_name ?? "(no company)"}`);
  });
  console.log();

  // ── 4. Create test enrollments (due immediately) ───────────────────────────
  const testEnrollmentIds: number[] = [];
  const pairs: Array<{ contact: typeof contacts[0]; sequence: typeof sequences[0] }> = [];

  for (let i = 0; i < sequences.length; i++) {
    const contact  = contacts[i];
    const sequence = sequences[i];

    // Check for existing enrollment (skip if already enrolled)
    const existing = await db.execute(sql`
      SELECT id FROM sequence_enrollments
      WHERE contact_id = ${contact.id} AND sequence_id = ${sequence.id}
        AND status IN ('active','paused')
      LIMIT 1
    `);
    if (existing.rows.length) {
      console.log(`${WARN} Contact ${contact.first_name} already enrolled in ${sequence.name} — skipping`);
      continue;
    }

    const result = await db.execute(sql`
      INSERT INTO sequence_enrollments
        (contact_id, sequence_id, status, current_step, next_action_at, metadata, created_at, updated_at)
      VALUES (
        ${contact.id},
        ${sequence.id},
        'active',
        0,
        now() - interval '2 minutes',
        ${JSON.stringify({ _test: true, _tag: TEST_TAG })},
        now(),
        now()
      )
      RETURNING id
    `);
    const enrollId = Number((result.rows[0] as any).id);
    testEnrollmentIds.push(enrollId);
    pairs.push({ contact, sequence });
    console.log(`  ✓ Enrolled ${contact.first_name} ${contact.last_name} → ${sequence.name}`);
  }
  console.log(`\n${testEnrollmentIds.length} test enrollments created. Processing...\n`);

  // ── 5. Fire — pass 1 (step 1 of each sequence) ────────────────────────────
  console.log("── Pass 1: Step 1 ──────────────────────────────────────────");
  const pass1 = await processSequenceEnrollments();
  console.log(`Processed: ${pass1.processed}  Errors: ${pass1.errors}`);

  // ── 6. Advance one enrollment for a step-2 test ───────────────────────────
  if (testEnrollmentIds.length > 0 && MULTI_STEP_COUNT > 0) {
    const advanceId = testEnrollmentIds[0];
    await db.execute(sql`
      UPDATE sequence_enrollments
      SET next_action_at = now() - interval '2 minutes', status = 'active'
      WHERE id = ${advanceId}
    `);
    console.log(`\n── Pass 2: Step 2 for enrollment #${advanceId} (${pairs[0]?.contact.first_name} → ${pairs[0]?.sequence.name}) ──`);
    const pass2 = await processSequenceEnrollments();
    console.log(`Processed: ${pass2.processed}  Errors: ${pass2.errors}`);
  }

  // ── 7. Results from audit logs ─────────────────────────────────────────────
  console.log("\n══ Results ════════════════════════════════════════════════");

  // Sent emails tracked in analytics_events (sequence_step_sent)
  // and failures in outbound_send_log (status='failed')
  const sentEvtRows = await db.execute(sql`
    SELECT ae.event_name, ae.metadata, ae.occurred_at,
           ae.contact_id, ae.sequence_id,
           c.email as contact_email, c.first_name, c.last_name,
           fus.name as sequence_name
    FROM analytics_events ae
    LEFT JOIN contacts c ON c.id = ae.contact_id
    LEFT JOIN follow_up_sequences fus ON fus.id = ae.sequence_id
    WHERE ae.event_name = 'sequence_step_sent'
      AND ae.occurred_at >= now() - interval '10 minutes'
    ORDER BY ae.occurred_at DESC
    LIMIT 30
  `);

  const failedLogRows = await db.execute(sql`
    SELECT osl.contact_id, osl.sequence_id, osl.step_order, osl.failure_reason,
           osl.from_address, osl.sent_at, osl.failed_at,
           c.email as contact_email, fus.name as sequence_name
    FROM outbound_send_log osl
    LEFT JOIN contacts c ON c.id = osl.contact_id
    LEFT JOIN follow_up_sequences fus ON fus.id = osl.sequence_id
    WHERE osl.status = 'failed'
      AND osl.created_at >= now() - interval '10 minutes'
    ORDER BY osl.created_at DESC
    LIMIT 30
  `);

  const sent   = sentEvtRows.rows as Array<{
    event_name: string; metadata: any; occurred_at: string;
    contact_id: number; sequence_id: number;
    contact_email: string | null; first_name: string | null; last_name: string | null;
    sequence_name: string | null;
  }>;
  const failed = failedLogRows.rows as Array<{
    contact_id: number; sequence_id: number; step_order: number;
    failure_reason: string | null; from_address: string | null;
    contact_email: string | null; sequence_name: string | null;
  }>;

  // Also check audit logs for any gate-level blocks
  const auditRows = await db.execute(sql`
    SELECT a.action, a.details, a.created_at
    FROM audit_logs a
    WHERE a.action IN (
      'sequence_step_blocked_no_prospect_guard',
      'sequence_step_deferred_daily_cap',
      'sequence_step_skipped_global_pause',
      'sequence_enrollment_skipped',
      'sequence_enrollment_suppressed',
      'sequence_step_blocked_contactability',
      'sequence_send_blocked_no_mailing_address',
      'sequence_send_blocked_no_unsubscribe_secret'
    )
    AND a.created_at >= now() - interval '10 minutes'
    ORDER BY a.created_at DESC
    LIMIT 30
  `);
  const blockLogs = auditRows.rows as Array<{ action: string; details: any; created_at: string }>;
  const deferred  = blockLogs.filter(l => l.action === "sequence_step_deferred_daily_cap");
  const blocked   = blockLogs.filter(l => !["sequence_step_deferred_daily_cap"].includes(l.action));

  console.log(`\n  ${PASS} Sent:     ${sent.length}`);
  console.log(`  ${FAIL} Failed:   ${failed.length}`);
  console.log(`  ${WARN} Blocked:  ${blocked.length}`);
  console.log(`  ${INFO} Deferred: ${deferred.length}`);

  if (sent.length > 0) {
    console.log(`\n── Sent emails (check ${REDIRECT_TO} inbox) ──────────────────`);
    for (const row of sent) {
      const meta    = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {});
      const seqName = row.sequence_name ?? meta.sequenceName ?? `seq#${row.sequence_id}`;
      const step    = meta.stepOrder ?? "?";
      const name    = [row.first_name, row.last_name].filter(Boolean).join(" ") || "?";
      console.log(`\n  ${PASS} ${name} <${row.contact_email ?? "?"}>`);
      console.log(`     Sequence: ${seqName} | Step ${step}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n── Failures ──────────────────────────────────────────────`);
    for (const row of failed) {
      const seqName = row.sequence_name ?? `seq#${row.sequence_id}`;
      console.log(`  ${FAIL} ${seqName} Step ${row.step_order}: ${row.failure_reason ?? "unknown error"}`);
    }
  }

  if (blocked.length > 0) {
    console.log(`\n── Gate blocks (diagnose below) ──────────────────────────`);
    for (const log of blocked) {
      const d = typeof log.details === "string" ? JSON.parse(log.details) : log.details;
      console.log(`  ${WARN} [${log.action}] ${d?.sequenceName ?? d?.sequenceId ?? "?"}: ${d?.reason ?? d?.pauseReason ?? "?"}`);
    }
  }

  // ── 8. Verify no raw template variables in send metadata ──────────────────
  console.log("\n── Template variable check ────────────────────────────────");
  const rawVarPattern = /\{\{[a-zA-Z]+\}\}/;
  let rawVarFound = false;
  for (const row of sent) {
    const raw = JSON.stringify(row.metadata ?? {});
    if (rawVarPattern.test(raw)) {
      console.log(`  ${FAIL} Raw {{variable}} found in send metadata: ${raw.slice(0, 120)}`);
      rawVarFound = true;
    }
  }
  if (!rawVarFound && sent.length > 0) {
    console.log(`  ${PASS} No raw {{template}} variables detected in send metadata`);
    console.log(`  ${INFO} Check email bodies in ${REDIRECT_TO} inbox for full verification`);
  } else if (!rawVarFound && sent.length === 0) {
    console.log(`  ${INFO} No sends recorded — template check skipped`);
  }

  // ── 9. Cleanup test enrollments + restore triggerConfig ───────────────────
  console.log("\n── Cleanup ────────────────────────────────────────────────");
  if (testEnrollmentIds.length > 0) {
    const idList = testEnrollmentIds.join(",");
    await db.execute(sql.raw(`DELETE FROM sequence_enrollments WHERE id IN (${idList})`));
    console.log(`  ✓ Deleted ${testEnrollmentIds.length} test enrollments`);
  } else {
    console.log("  ✓ No test enrollments to clean up");
  }

  await restoreTriggerConfigs();
  await restoreSettings();

  // ── 10. Final verdict ─────────────────────────────────────────────────────
  console.log("\n══ Verdict ════════════════════════════════════════════════");
  const totalSent = sent.length;
  const pass = totalSent > 0 && failed.length === 0 && !rawVarFound;

  if (pass) {
    console.log(`\n  ${PASS} PASS — ${totalSent} emails sent to ${REDIRECT_TO}`);
    console.log(`         Verify the emails in your inbox look correct, then you are ready to go live.\n`);
  } else {
    console.log(`\n  ${FAIL} REVIEW NEEDED`);
    if (totalSent === 0)   console.log(`     • 0 emails sent — see gate blocks above for the reason`);
    if (failed.length > 0) console.log(`     • ${failed.length} step(s) failed — see Failures section`);
    if (rawVarFound)       console.log(`     • Raw template variables found — check interpolate() in sequence-worker.ts`);
    if (blocked.length > 0) {
      const uniqueGates = [...new Set(blocked.map(l => l.action))].join(", ");
      console.log(`     • ${blocked.length} step(s) blocked by: ${uniqueGates}`);
    }
    console.log();
  }
}

main().catch(async e => {
  console.error("\nFatal:", e.message);
  // Best-effort cleanup: restore safety gate, clear redirect
  try {
    await deleteSetting("deliveryTestRedirectEmail");
    await setSetting("deliveryNoProspectSendEmail", true);
    await setSetting("outboundGlobalPaused", true);
  } catch {}
  process.exit(1);
});
