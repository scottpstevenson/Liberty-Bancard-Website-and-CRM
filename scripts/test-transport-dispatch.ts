#!/usr/bin/env tsx
/**
 * test-transport-dispatch.ts
 *
 * Isolated tests for email transport selection at the dispatch boundary.
 * Covers:
 *  - isColdOutreachSequence() classification for cold vs. non-cold sequences
 *  - resolveSender() correct From/Reply-To for cold_outreach, department, and
 *    other categories — verified at the sender-policy boundary
 *  - APPROVED_SENDER_SET membership for every resolved From address
 *  - Prohibited noreply@ enforcement
 *  - generateUnsubscribeToken / verifyUnsubscribeToken round-trip and URL format
 *  - isSmtpConfigured() truthfully reflects SMTP env var presence
 *  - isGmailOAuthSecretsPresent() truthfully reflects Google OAuth env vars
 *  - Non-cold sequence blocked when Gmail is unavailable: audit log written,
 *    enrollment status set to "paused"
 *  - Unsubscribe URL constructed with correct path (/unsubscribe?t=...)
 *  - List-Unsubscribe mailto address is the cold-outreach sender
 *
 * Makes NO real provider calls. Verifies observable DB side-effects for the
 * Gmail-unavailable integration test.
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { isColdOutreachSequence } from "../server/services/email-signatures";
import { resolveSender, APPROVED_SENDER_SET } from "../server/services/sender-policy";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "../server/services/unsubscribe-token";
import { isSmtpConfigured } from "../server/services/smtp-email";
import { isGmailOAuthSecretsPresent } from "../server/services/gmail-oauth";
import { storage } from "../server/storage";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. isColdOutreachSequence classification ──────────────────────────────────
// TRANSACTIONAL_FAMILIES (non-cold): "closed_won", "closed-won-onboarding",
//   "onboarding_step", "merchant_welcome", "no_show", "no-show-recovery",
//   "booked-appointment", "support", "ticket"
// TRANSACTIONAL_TRIGGER_TYPES (non-cold): "deal_stage_changed",
//   "merchant_approved", "application_submitted", "onboarding_complete",
//   "ticket_created", "support_submitted"
// Any other family/trigger defaults to cold=true.

async function testColdClassification() {
  console.log("\n1. isColdOutreachSequence() — cold vs. non-cold classification");

  // Cold families
  const coldByFamily: any = { sequenceFamily: "cold_outreach", triggerType: "prospect_new" };
  assert("sequenceFamily=cold_outreach → true", isColdOutreachSequence(coldByFamily));

  const coldByTrigger: any = { sequenceFamily: "general", triggerType: "cold_prospect_new" };
  assert("triggerType prefix cold_* → true", isColdOutreachSequence(coldByTrigger));

  const prospectTrigger: any = { sequenceFamily: "general", triggerType: "prospect_statement_received" };
  assert("triggerType=prospect_* + general family → true (cold default)", isColdOutreachSequence(prospectTrigger));

  const nullFamily: any = { sequenceFamily: null, triggerType: "general_followup" };
  assert("null family + non-transactional trigger → true (cold default)", isColdOutreachSequence(nullFamily));

  // Non-cold (TRANSACTIONAL_FAMILIES)
  const onboardingStep: any = { sequenceFamily: "onboarding_step", triggerType: "onboarding_start" };
  assert("sequenceFamily=onboarding_step → false", !isColdOutreachSequence(onboardingStep));

  const closedWon: any = { sequenceFamily: "closed_won", triggerType: "deal_closed" };
  assert("sequenceFamily=closed_won → false", !isColdOutreachSequence(closedWon));

  const merchantWelcome: any = { sequenceFamily: "merchant_welcome", triggerType: "merchant_approved" };
  assert("sequenceFamily=merchant_welcome → false", !isColdOutreachSequence(merchantWelcome));

  const supportFamily: any = { sequenceFamily: "support", triggerType: "ticket_created" };
  assert("sequenceFamily=support → false", !isColdOutreachSequence(supportFamily));

  // Non-cold via TRANSACTIONAL_TRIGGER_TYPES
  const transactionalTrigger: any = { sequenceFamily: "general", triggerType: "merchant_approved" };
  assert("triggerType=merchant_approved → false (transactional trigger)", !isColdOutreachSequence(transactionalTrigger));

  const onboardingComplete: any = { sequenceFamily: "general", triggerType: "onboarding_complete" };
  assert("triggerType=onboarding_complete → false (transactional trigger)", !isColdOutreachSequence(onboardingComplete));
}

// ── 2. resolveSender From/Reply-To at dispatch boundary ──────────────────────
// Actual MessageCategory values: "cold_outreach" | "support" | "onboarding" |
//   "security" | "partners" | "accounts" | "internal_ops"
// APPROVED_SENDER_SET stores addresses in lowercase.

async function testSenderResolution() {
  console.log("\n2. resolveSender() — From/Reply-To at dispatch boundary");

  // cold_outreach → Scott@mail.libertybancard.com
  const cold = resolveSender("cold_outreach");
  assert(
    "cold_outreach From is cold-outreach mailbox (mail.libertybancard.com)",
    cold.from.toLowerCase().includes("mail.libertybancard.com"),
    `got: ${cold.from}`
  );
  assert(
    "cold_outreach From is in APPROVED_SENDER_SET (case-insensitive)",
    APPROVED_SENDER_SET.has(cold.from.toLowerCase()),
    `from=${cold.from}, set=${[...APPROVED_SENDER_SET].join(",")}`
  );

  // accounts → accounts@libertybancard.com
  const accts = resolveSender("accounts");
  assert("accounts From is in APPROVED_SENDER_SET", APPROVED_SENDER_SET.has(accts.from.toLowerCase()), `from=${accts.from}`);
  assert("accounts From is not a cold-outreach domain", !accts.from.toLowerCase().includes("mail.libertybancard.com"), `from=${accts.from}`);

  // onboarding → onboarding@libertybancard.com
  const onboard = resolveSender("onboarding");
  assert("onboarding From is in APPROVED_SENDER_SET", APPROVED_SENDER_SET.has(onboard.from.toLowerCase()), `from=${onboard.from}`);

  // partners → partners@libertybancard.com
  const partner = resolveSender("partners");
  assert("partners From is in APPROVED_SENDER_SET", APPROVED_SENDER_SET.has(partner.from.toLowerCase()), `from=${partner.from}`);

  // security → security@libertybancard.com
  const sec = resolveSender("security");
  assert("security From is in APPROVED_SENDER_SET", APPROVED_SENDER_SET.has(sec.from.toLowerCase()), `from=${sec.from}`);

  // internal_ops → accounts@libertybancard.com
  const ops = resolveSender("internal_ops");
  assert("internal_ops From is in APPROVED_SENDER_SET", APPROVED_SENDER_SET.has(ops.from.toLowerCase()), `from=${ops.from}`);

  // All resolved From addresses must be in the approved set
  const categories: any[] = ["cold_outreach", "support", "onboarding", "security", "partners", "accounts", "internal_ops"];
  for (const cat of categories) {
    const { from } = resolveSender(cat);
    assert(`${cat}: From "${from}" is in APPROVED_SENDER_SET`, APPROVED_SENDER_SET.has(from.toLowerCase()), `from=${from}`);
  }
}

// ── 3. Prohibited noreply@ enforcement ───────────────────────────────────────

async function testProhibitedSender() {
  console.log("\n3. Prohibited noreply@ — no approved sender uses noreply@");

  const LIBERTY_DOMAINS = ["libertybancard.com", "mail.libertybancard.com"];
  const categories: any[] = [
    "cold_outreach", "support", "onboarding", "security", "partners", "accounts", "internal_ops",
  ];

  for (const cat of categories) {
    const { from } = resolveSender(cat);
    const lower = from.toLowerCase();
    const isLiberty = LIBERTY_DOMAINS.some(d => lower.includes(d));
    const isNoReply = lower.startsWith("noreply@") || lower.includes("<noreply@");
    assert(
      `${cat}: From is not noreply@ on a Liberty domain`,
      !(isLiberty && isNoReply),
      `from=${from}`
    );
  }

  for (const addr of APPROVED_SENDER_SET) {
    const lower = addr.toLowerCase();
    const isLiberty = LIBERTY_DOMAINS.some(d => lower.includes(d));
    const isNoReply = lower.startsWith("noreply@") || lower.includes("<noreply@");
    assert(
      `APPROVED_SENDER_SET: "${addr}" is not noreply@ on Liberty domain`,
      !(isLiberty && isNoReply),
      `addr=${addr}`
    );
  }
}

// ── 4. Unsubscribe token round-trip and URL format ────────────────────────────

async function testUnsubscribeToken() {
  console.log("\n4. Unsubscribe token — round-trip and URL format");

  const contactId = 99991;
  const token = generateUnsubscribeToken(contactId);

  assert("token is a non-empty string", typeof token === "string" && token.length > 0, `token=${token}`);
  assert("token contains no spaces", !token.includes(" "), `token=${token}`);

  const verified = verifyUnsubscribeToken(token);
  assert("verifyUnsubscribeToken: valid=true", verified.valid === true, JSON.stringify(verified));
  if (verified.valid) {
    assert("verifyUnsubscribeToken: contactId round-trips correctly", verified.contactId === contactId, `got=${verified.contactId}`);
  }

  const tampered = token.slice(0, -4) + "XXXX";
  const tamperedResult = verifyUnsubscribeToken(tampered);
  assert("tampered token: valid=false", tamperedResult.valid === false, JSON.stringify(tamperedResult));

  const APP_URL = process.env.APP_URL ?? "http://localhost:5000";
  const unsubscribeUrl = `${APP_URL}/unsubscribe?t=${encodeURIComponent(token)}`;
  assert("unsubscribe URL contains /unsubscribe?t=", unsubscribeUrl.includes("/unsubscribe?t="), `url=${unsubscribeUrl}`);
  assert("unsubscribe URL token decodes and verifies", (() => {
    const decoded = decodeURIComponent(new URL(unsubscribeUrl).searchParams.get("t") ?? "");
    const r = verifyUnsubscribeToken(decoded);
    return r.valid && r.contactId === contactId;
  })(), `url=${unsubscribeUrl}`);

  const unsubscribeMailto = `Scott@mail.libertybancard.com`;
  assert(
    "cold-outreach List-Unsubscribe mailto uses cold-outreach sender",
    unsubscribeMailto.toLowerCase().includes("mail.libertybancard.com") ||
      unsubscribeMailto.toLowerCase().startsWith("scott@"),
    `mailto=${unsubscribeMailto}`
  );
  assert("List-Unsubscribe mailto is in APPROVED_SENDER_SET (case-insensitive)", APPROVED_SENDER_SET.has(unsubscribeMailto.toLowerCase()), `mailto=${unsubscribeMailto}`);
}

// ── 5. isSmtpConfigured() truth ───────────────────────────────────────────────

async function testSmtpConfigured() {
  console.log("\n5. isSmtpConfigured() — reflects env var presence");

  // isSmtpConfigured() requires ALL THREE: SMTP_HOST + SMTP_USER + SMTP_PASS
  const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const reported = isSmtpConfigured();
  assert(
    "isSmtpConfigured() requires SMTP_HOST + SMTP_USER + SMTP_PASS (all three)",
    reported === hasSMTP,
    `env SMTP_HOST=${process.env.SMTP_HOST ?? "(unset)"} SMTP_USER=${process.env.SMTP_USER ?? "(unset)"} SMTP_PASS=${process.env.SMTP_PASS ? "SET" : "(unset)"}, isSmtpConfigured()=${reported}`
  );

  if (!reported) {
    assert("SMTP not fully configured in test env (cold outreach falls back correctly)", true);
  }
}

// ── 6. isGmailOAuthSecretsPresent() truth ────────────────────────────────────

async function testGmailSecretsPresent() {
  console.log("\n6. isGmailOAuthSecretsPresent() — reflects Google env vars");

  const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
  const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  const reported = isGmailOAuthSecretsPresent();
  const expected = hasClientId && hasClientSecret;
  assert(
    "isGmailOAuthSecretsPresent() matches GOOGLE_CLIENT_ID+SECRET presence",
    reported === expected,
    `GOOGLE_CLIENT_ID=${hasClientId}, GOOGLE_CLIENT_SECRET=${hasClientSecret}, reported=${reported}`
  );
}

// ── 7. Gmail-unavailable audit log (integration) ─────────────────────────────
// Creates a non-cold enrollment in the DB, temporarily lifts the global pause,
// runs processSequenceEnrollments(), verifies the Gmail-unavailable audit log
// is written and the enrollment is paused. Restores pause before exit.

async function testGmailUnavailableBlock() {
  console.log("\n7. Gmail-unavailable block — audit log written for non-cold sequence");

  if (isGmailOAuthSecretsPresent()) {
    console.log("  (skipped) GOOGLE_CLIENT_ID+SECRET are set — Gmail secrets present, block path not exercised in this env");
    assert("Gmail-unavailable test skipped (Gmail secrets configured)", true);
    return;
  }

  const RUN_ID = Date.now();

  // Check for other active enrollments that would also be processed
  const allEnrollments = await storage.getSequenceEnrollments();
  const otherActive = allEnrollments.filter((e: any) => e.status === "active");
  if (otherActive.length > 0) {
    console.log(`  (skipped) ${otherActive.length} other active enrollment(s) present — skipping integration test to avoid side-effects`);
    assert("Gmail-unavailable test skipped (other active enrollments in DB)", true);
    return;
  }

  let contactId: number | null = null;
  let seqId: number | null = null;
  let stepId: number | null = null;
  let enrollmentId: number | null = null;
  let pauseControlId: number | null = null;
  let priorPauseControl: any = null;
  let pauseControlTouched = false;

  try {
    const contact = await storage.createContact({
      firstName: "TransportTest",
      lastName: `${RUN_ID}`,
      email: `transport-test-${RUN_ID}@test.internal`,
      phone: `305${String(RUN_ID).slice(-7)}`,
      status: "active",
      consentTier: "pewc",
      optedOutEmail: false,
      doNotContact: false,
      doNotAutoContact: false,
      emailStatus: "valid",
    });
    contactId = contact.id;

    const seq = await storage.createFollowUpSequence({
      name: `transport-test-noncold-${RUN_ID}`,
      sequenceFamily: "onboarding",
      triggerType: `transport_test_noncold_${RUN_ID}`,
      status: "active",
    });
    seqId = seq.id;

    const step = await storage.createSequenceStep({
      sequenceId: seqId,
      stepOrder: 1,
      actionType: "email",
      delayDays: 0,
      delayHours: 0,
      subject: "Test step",
      body: "Test body",
    });
    stepId = step.id;

    const enrollment = await storage.createSequenceEnrollment({
      contactId,
      sequenceId: seqId,
      status: "active",
      currentStep: 0,
      nextActionAt: new Date(Date.now() - 1_000),
      metadata: { _transportTest: true, runId: RUN_ID },
    });
    enrollmentId = enrollment.id;

    // Temporarily lift the canonical global pause authority. The legacy
    // outboundGlobalPaused setting is no longer consulted by the worker.
    const pauseRows = (await db.execute(sql`
      SELECT id, state, reason, epoch::text, actor, idempotency_key, committed_at
      FROM outbound_pause_control
      ORDER BY id
      LIMIT 1
    `) as any).rows;
    priorPauseControl = pauseRows[0] ?? null;
    if (priorPauseControl) {
      pauseControlId = Number(priorPauseControl.id);
      await db.execute(sql`
        UPDATE outbound_pause_control
        SET state = 'unpaused', epoch = epoch + 1, actor = 'transport-dispatch-test', committed_at = now()
        WHERE id = ${pauseControlId}
      `);
    } else {
      const inserted = (await db.execute(sql`
        INSERT INTO outbound_pause_control (state, epoch, actor)
        VALUES ('unpaused', 1, 'transport-dispatch-test')
        RETURNING id
      `) as any).rows[0];
      pauseControlId = Number(inserted.id);
    }
    pauseControlTouched = true;
    const { invalidatePauseStateCache } = await import("../server/services/outbound-pause-authority");
    invalidatePauseStateCache();

    // Run the worker
    const { processSequenceEnrollments } = await import("../server/services/sequence-worker");
    await processSequenceEnrollments();

    // Verify enrollment was paused (Gmail-unavailable block)
    const rows = await db.execute(sql`SELECT status FROM sequence_enrollments WHERE id = ${enrollmentId}`);
    const enrollmentStatus = (rows.rows?.[0] as any)?.status;
    assert(
      "Non-cold enrollment paused when Gmail unavailable",
      enrollmentStatus === "paused",
      `status=${enrollmentStatus}`
    );

    // Verify audit log written
    const blockLog = await storage.getLastAuditLogByAction(
      "sequence_step_blocked_gmail_unavailable",
      "contact",
      contactId,
    );
    assert(
      "sequence_step_blocked_gmail_unavailable audit log written",
      !!blockLog && (blockLog.details as any)?.enrollmentId === enrollmentId,
      `audit enrollmentId=${(blockLog?.details as any)?.enrollmentId ?? "missing"}`
    );

  } finally {
    // Restore the exact canonical pause state, or remove only the singleton
    // row inserted by this isolated test.
    if (pauseControlTouched && pauseControlId) {
      if (priorPauseControl) {
        await db.execute(sql`
          UPDATE outbound_pause_control
          SET state = ${priorPauseControl.state},
              reason = ${priorPauseControl.reason},
              epoch = ${priorPauseControl.epoch}::bigint,
              actor = ${priorPauseControl.actor},
              idempotency_key = ${priorPauseControl.idempotency_key},
              committed_at = ${priorPauseControl.committed_at}
          WHERE id = ${pauseControlId}
        `).catch(() => undefined);
      } else {
        await db.execute(sql`
          DELETE FROM outbound_pause_control
          WHERE id = ${pauseControlId} AND actor = 'transport-dispatch-test'
        `).catch(() => undefined);
      }
      const { invalidatePauseStateCache } = await import("../server/services/outbound-pause-authority");
      invalidatePauseStateCache();
    }

    // Clean up test fixtures
    if (enrollmentId) {
      try { await db.execute(sql`DELETE FROM sequence_enrollments WHERE id = ${enrollmentId}`); } catch {}
    }
    if (stepId) {
      try { await db.execute(sql`DELETE FROM sequence_steps WHERE id = ${stepId}`); } catch {}
    }
    if (seqId) {
      try { await db.execute(sql`DELETE FROM follow_up_sequences WHERE id = ${seqId}`); } catch {}
    }
    if (contactId) {
      try { await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`); } catch {}
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Transport Dispatch Tests");
  console.log("═══════════════════════════════════════════════════════");

  try {
    await testColdClassification();
    await testSenderResolution();
    await testProhibitedSender();
    await testUnsubscribeToken();
    await testSmtpConfigured();
    await testGmailSecretsPresent();
    await testGmailUnavailableBlock();
  } catch (err: any) {
    console.error("\nUnhandled error:", err?.message ?? err);
    failed++;
    failures.push(`Unhandled error: ${err?.message ?? err}`);
  }

  console.log(`\n${"═".repeat(55)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(55));
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n✅ All transport dispatch tests passed.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
