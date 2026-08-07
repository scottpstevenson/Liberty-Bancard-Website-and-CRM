/**
 * test-dedup-send.ts
 *
 * Verifies that the outbound-send-log duplicate-send protection works correctly:
 *   1. hasSentStep() returns false before any send record exists
 *   2. openSendAttempt() inserts a pending row; a second call is silently ignored (ON CONFLICT)
 *   3. markSendSent() moves the row to "sent"
 *   4. hasSentStep() returns true after markSendSent() — blocking any retry
 *   5. markSendSent() on an already-sent key is idempotent (no throw)
 *
 * Exit 0 = all assertions pass. Exit 1 = failure.
 */

import {
  buildIdempotencyKey,
  hasSentStep,
  openSendAttempt,
  markSendSent,
  markSendFailed,
  getSendLogByKey,
} from "../server/services/outbound-send-log";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

// These are filled in at runtime once we create a real test sequence
let TEST_SEQUENCE_ID = 0;
const FAKE_ENROLLMENT_ID = -99_999; // no FK on enrollment_id (ON DELETE SET NULL)
const FAKE_STEP_ORDER    = 1;

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function cleanup(key: string) {
  await db.execute(sql`DELETE FROM outbound_send_log WHERE idempotency_key = ${key}`);
}

async function run() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" Duplicate-Send Protection Tests");
  console.log("═══════════════════════════════════════════════════════\n");

  // Create a real sequence so the sequence_id FK is satisfied
  const seqRows = await db.execute(sql`
    INSERT INTO follow_up_sequences (name, status)
    VALUES ('__test_dedup_send__', 'paused')
    RETURNING id
  `);
  TEST_SEQUENCE_ID = Number((seqRows.rows[0] as any).id);

  const emailKey = buildIdempotencyKey(FAKE_ENROLLMENT_ID, FAKE_STEP_ORDER);
  const smsKey   = buildIdempotencyKey(FAKE_ENROLLMENT_ID, FAKE_STEP_ORDER + 1);

  await cleanup(emailKey);
  await cleanup(smsKey);

  // ── 1. hasSentStep before any record ─────────────────────────────
  console.log("1. hasSentStep() before any record");
  assert("email key → false (no record)", !(await hasSentStep(emailKey)));
  assert("sms key   → false (no record)", !(await hasSentStep(smsKey)));

  // ── 2. openSendAttempt inserts pending row ────────────────────────
  console.log("\n2. openSendAttempt() inserts a pending row");
  const emailSlot = await openSendAttempt({
    idempotencyKey: emailKey,
    sequenceId: TEST_SEQUENCE_ID,
    sequenceEnrollmentId: undefined, // nullable — no FK risk
    channel: "email_smtp",
    toAddress: "test@example.com",
  });
  assert("email slot claimed (non-null id returned)", emailSlot !== null);

  const emailLog1 = await getSendLogByKey(emailKey);
  assert("email pending row exists", emailLog1?.status === "pending");

  // ── 3. Second openSendAttempt is silently ignored (ON CONFLICT) ───
  console.log("\n3. Concurrent openSendAttempt() is silently ignored");
  const emailSlot2 = await openSendAttempt({
    idempotencyKey: emailKey,
    sequenceId: TEST_SEQUENCE_ID,
    channel: "email_smtp",
    toAddress: "test@example.com",
  });
  assert("second claim returns null (slot already taken)", emailSlot2 === null);

  // ── 4. hasSentStep still false while pending ──────────────────────
  console.log("\n4. hasSentStep() is false while status = pending");
  assert("email key still false (pending ≠ sent)", !(await hasSentStep(emailKey)));

  // ── 5. markSendSent moves to sent ────────────────────────────────
  console.log("\n5. markSendSent() transitions pending → sent");
  await markSendSent({ idempotencyKey: emailKey, providerMessageId: "fake-msg-id", fromAddress: "sender@example.com" });
  const emailLog2 = await getSendLogByKey(emailKey);
  assert("email status = sent", emailLog2?.status === "sent");
  assert("provider message id recorded", emailLog2?.providerMessageId === "fake-msg-id");

  // ── 6. hasSentStep true after sent ───────────────────────────────
  console.log("\n6. hasSentStep() returns true after markSendSent()");
  assert("email key → true (retry would be blocked)", await hasSentStep(emailKey));

  // ── 7. markSendSent is idempotent ────────────────────────────────
  console.log("\n7. markSendSent() is idempotent (no throw on second call)");
  let idempotentOk = true;
  try {
    await markSendSent({ idempotencyKey: emailKey, providerMessageId: "fake-msg-id-2", fromAddress: "sender@example.com" });
  } catch {
    idempotentOk = false;
  }
  assert("second markSendSent() does not throw", idempotentOk);
  const emailLog3 = await getSendLogByKey(emailKey);
  assert("status is still sent (not overwritten)", emailLog3?.status === "sent");

  // ── 8. SMS path: openSendAttempt + markSendSent ───────────────────
  console.log("\n8. SMS path: openSendAttempt() + markSendSent()");
  const smsSlot = await openSendAttempt({
    idempotencyKey: smsKey,
    sequenceId: TEST_SEQUENCE_ID,
    channel: "sms_ghl",
    toAddress: "+15555550100",
  });
  assert("sms slot claimed", smsSlot !== null);
  await markSendSent({ idempotencyKey: smsKey, providerMessageId: "sms-id-1", fromAddress: "ghl_sms" });
  assert("sms key → true after markSendSent()", await hasSentStep(smsKey));

  // ── 9. markSendFailed then hasSentStep still false ────────────────
  console.log("\n9. markSendFailed() → hasSentStep() remains false (allow retry)");
  const failKey = buildIdempotencyKey(FAKE_ENROLLMENT_ID, FAKE_STEP_ORDER + 2);
  await cleanup(failKey);
  await openSendAttempt({ idempotencyKey: failKey, sequenceId: TEST_SEQUENCE_ID, channel: "email_smtp", toAddress: "fail@example.com" });
  await markSendFailed({ idempotencyKey: failKey, failureReason: "provider error" });
  const failLog = await getSendLogByKey(failKey);
  assert("status = failed", failLog?.status === "failed");
  assert("hasSentStep false after failure (retry allowed)", !(await hasSentStep(failKey)));
  await cleanup(failKey);

  // ── Cleanup ───────────────────────────────────────────────────────
  await cleanup(emailKey);
  await cleanup(smsKey);
  await db.execute(sql`DELETE FROM follow_up_sequences WHERE id = ${TEST_SEQUENCE_ID}`);

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
