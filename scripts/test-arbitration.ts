#!/usr/bin/env tsx
/**
 * scripts/test-arbitration.ts — Communication Arbitration Engine gate
 *
 * All tests are non-mutating: they use the _logsForTest and _configOverrideForTest
 * parameters so NO database reads or writes occur.
 *
 * Scenarios tested:
 *  1.  Human-touch via note_added (human actorType) suppresses send
 *  2.  Human-touch via email_sent_via_composer (actual composer action) suppresses send
 *  3.  Baseline — no logs → no suppression
 *  4.  Auto-send cooldown on same channel (sms_sent → SMS blocked)
 *  5.  skipHumanTouchCheck=true bypasses human-touch signal
 *  6.  Old human-touch log (beyond window) does NOT suppress
 *  7.  Cross-channel: recent email auto-send does NOT suppress SMS
 *  8.  Zero humanTouchWindowHours disables the gate (even with recent log)
 *  9.  Zero autoSendWindowMinutes disables the auto-send cooldown gate
 * 10.  Unanswered inbound reply suppresses with reply_pending signal
 * 11.  email_logged (manual email activity record) counts as human touch
 * 12.  resumeAfter is correctly calculated as touchedAt + window
 *
 * Exits 0 on success, 1 on any failure.
 */

import { shouldSuppress } from "../server/services/communication-arbitration";

// ── Helpers ───────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function ok(label: string) {
  console.log(`  ✓ ${label}`);
  pass++;
}

function ko(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  fail++;
}

/** Returns a Date that is `minutes` minutes in the past. */
function minsAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

/** Returns a Date that is `hours` hours in the past. */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// Sentinel contactId — DB is never queried when _logsForTest is supplied.
const CONTACT_ID = 0;

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function test1_humanTouchViaNote() {
  console.log("\n[1] Human-touch via note_added (actorType=human)");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "note_added", actorType: "human", createdAt: minsAgo(30) },
    ],
  });
  if (result.suppressed && result.signal === "human_touch") {
    ok("suppressed=true, signal=human_touch");
  } else {
    ko("expected suppression on recent human note", JSON.stringify(result));
  }
  if (result.resumeAfter instanceof Date) {
    ok("resumeAfter is a Date");
  } else {
    ko("expected resumeAfter to be set", String(result.resumeAfter));
  }
  if (result.reason && result.reason.length > 0) {
    ok("reason message is non-empty");
  } else {
    ko("expected reason to be set");
  }
}

async function test2_humanTouchViaComposer() {
  console.log("\n[2] Human-touch via email_sent_via_composer (real composer action)");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      // actorType defaults to 'user' in the route; action name is the key signal
      { action: "email_sent_via_composer", actorType: "user", createdAt: minsAgo(45) },
    ],
  });
  if (result.suppressed && result.signal === "human_touch") {
    ok("email_sent_via_composer correctly identified as human touch");
  } else {
    ko("email_sent_via_composer did not trigger human_touch suppression", JSON.stringify(result));
  }
}

async function test3_baselinePassesThrough() {
  console.log("\n[3] Baseline — no logs → no suppression");
  const result = await shouldSuppress(CONTACT_ID, "email", { _logsForTest: [] });
  if (!result.suppressed) {
    ok("suppressed=false when no recent activity");
  } else {
    ko("unexpected suppression on empty log list", JSON.stringify(result));
  }
}

async function test4_autoSendCooldown() {
  console.log("\n[4] Auto-send cooldown — recent automated SMS on same channel");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "sms_sent", actorType: "system", createdAt: minsAgo(10) },
    ],
  });
  if (result.suppressed && result.signal === "recent_auto_send") {
    ok("suppressed=true, signal=recent_auto_send");
  } else {
    ko("expected auto-send cooldown suppression on SMS", JSON.stringify(result));
  }
}

async function test5_skipHumanTouchFlag() {
  console.log("\n[5] skipHumanTouchCheck=true bypasses human-touch signal");
  const result = await shouldSuppress(CONTACT_ID, "email", {
    skipHumanTouchCheck: true,
    _logsForTest: [
      { action: "note_added", actorType: "human", createdAt: minsAgo(30) },
    ],
  });
  if (!result.suppressed || result.signal !== "human_touch") {
    ok("human_touch signal correctly bypassed when skipHumanTouchCheck=true");
  } else {
    ko("human_touch signal fired despite skipHumanTouchCheck=true", JSON.stringify(result));
  }
}

async function test6_oldHumanTouchDoesNotSuppress() {
  console.log("\n[6] Old human-touch log (5h ago, beyond 4h window) — should NOT suppress");
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "note_added", actorType: "human", createdAt: hoursAgo(5) },
    ],
  });
  if (!result.suppressed) {
    ok("suppressed=false for log beyond the suppression window");
  } else {
    ko("unexpectedly suppressed for old human-touch log", JSON.stringify(result));
  }
}

async function test7_crossChannelAutoSendDoesNotSuppress() {
  console.log("\n[7] Cross-channel: recent email auto-send does NOT suppress SMS");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "email_sent", actorType: "system", createdAt: minsAgo(5) },
    ],
  });
  if (!result.suppressed) {
    ok("email auto-send does not block SMS channel");
  } else {
    ko("cross-channel false suppression: email log suppressed SMS", JSON.stringify(result));
  }
}

async function test8_zeroHumanWindowDisablesGate() {
  console.log("\n[8] Zero humanTouchWindowHours=0 disables the human-touch gate");
  // Even with a very recent human note, window=0 means "disabled — never suppress"
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "note_added", actorType: "human", createdAt: minsAgo(1) },
    ],
    _configOverrideForTest: { humanTouchWindowHours: 0 },
  });
  if (!result.suppressed) {
    ok("humanTouchWindowHours=0 disables the human-touch gate");
  } else {
    ko("human-touch gate fired despite humanTouchWindowHours=0", JSON.stringify(result));
  }
}

async function test9_zeroAutoSendWindowDisablesGate() {
  console.log("\n[9] Zero autoSendWindowMinutes=0 disables the auto-send cooldown gate");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "sms_sent", actorType: "system", createdAt: minsAgo(1) },
    ],
    _configOverrideForTest: { autoSendWindowMinutes: 0 },
  });
  if (!result.suppressed) {
    ok("autoSendWindowMinutes=0 disables the auto-send cooldown gate");
  } else {
    ko("auto-send gate fired despite autoSendWindowMinutes=0", JSON.stringify(result));
  }
}

async function test10_inboundReplyPending() {
  console.log("\n[10] Unanswered inbound reply → reply_pending suppression");
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "inbound_message_processed", actorType: "system", createdAt: minsAgo(60) },
      // No subsequent human response
    ],
  });
  if (result.suppressed && result.signal === "reply_pending") {
    ok("suppressed=true, signal=reply_pending for unanswered inbound");
  } else {
    ko("expected reply_pending suppression", JSON.stringify(result));
  }
}

async function test11_emailLoggedCountsAsHumanTouch() {
  console.log("\n[11] email_logged (manual email activity record) counts as human touch");
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "email_logged", actorType: "user", createdAt: minsAgo(90) },
    ],
  });
  if (result.suppressed && result.signal === "human_touch") {
    ok("email_logged correctly triggers human_touch suppression");
  } else {
    ko("email_logged did not trigger human_touch", JSON.stringify(result));
  }
}

async function test12_resumeAfterCalculation() {
  console.log("\n[12] resumeAfter = touchedAt + humanTouchWindowHours");
  const touchTime = minsAgo(30); // 30 min ago
  const windowHours = 2;
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "note_added", actorType: "human", createdAt: touchTime },
    ],
    _configOverrideForTest: { humanTouchWindowHours: windowHours },
  });
  if (!result.suppressed) {
    ko("expected suppression for resume-after calculation test");
    return;
  }
  const expectedResume = new Date(touchTime.getTime() + windowHours * 60 * 60 * 1000);
  const actualResume = result.resumeAfter!;
  const diffMs = Math.abs(actualResume.getTime() - expectedResume.getTime());
  if (diffMs < 5000) {
    ok(`resumeAfter is touchedAt + ${windowHours}h (within 5s tolerance)`);
  } else {
    ko(`resumeAfter off by ${diffMs}ms`, `expected ~${expectedResume.toISOString()}, got ${actualResume.toISOString()}`);
  }
}

async function test13_replyPendingWithWindowAbove48Hours() {
  console.log("\n[13] Reply 60h ago is suppressed when replyPendingWindowHours=72");
  // When admins configure a reply-pending window > 48h, a reply that is between
  // 48h and the configured ceiling must still be detected and suppress automation.
  // The production query lookback must use max(replyWindowMs, 48h), not a fixed 48h cap.
  const replyTime = hoursAgo(60); // 60h ago — beyond 48h but within 72h window
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "inbound_message_processed", actorType: "system", createdAt: replyTime },
    ],
    _configOverrideForTest: {
      replyPendingWindowHours: 72,
      humanTouchWindowHours: 0,
      autoSendWindowMinutes: 0,
    },
  });
  if (result.suppressed && result.signal === "reply_pending") {
    ok("60h-old reply suppresses automation when window=72h");
  } else {
    ko(
      "expected reply_pending suppression for 60h-old reply with 72h window",
      `suppressed=${result.suppressed}, signal=${result.signal}`,
    );
  }
}

async function test14_failedGhlSendDoesNotTriggerAutoSendCooldown() {
  console.log("\n[13] Failed GHL send (status=failed) does NOT trigger auto-send cooldown");
  // A transient GHL failure writes an activity row with status="failed".
  // It must not suppress subsequent automated sends — no message was delivered.
  const failedTime = minsAgo(10); // recent, within any cooldown window
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "sequence_email_sent", actorType: "system", createdAt: failedTime, status: "failed" },
    ],
    _configOverrideForTest: {
      autoSendWindowMinutes: 60,
      humanTouchWindowHours: 0,
      replyPendingWindowHours: 0,
    },
  });
  if (!result.suppressed) {
    ok("status=failed send does not trigger recent_auto_send suppression");
  } else {
    ko(
      "expected no suppression for a failed send attempt",
      `signal=${result.signal}, reason=${result.reason}`,
    );
  }
}

async function test15_successfulGhlSendDoesTrigerAutoSendCooldown() {
  console.log("\n[14] Successful GHL send (status=sent) DOES trigger auto-send cooldown");
  // A delivered send must still suppress the cooldown gate — baseline check.
  const sentTime = minsAgo(10);
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "sequence_email_sent", actorType: "system", createdAt: sentTime, status: "sent" },
    ],
    _configOverrideForTest: {
      autoSendWindowMinutes: 60,
      humanTouchWindowHours: 0,
      replyPendingWindowHours: 0,
    },
  });
  if (result.suppressed && result.signal === "recent_auto_send") {
    ok("status=sent send triggers recent_auto_send suppression");
  } else {
    ko(
      "expected recent_auto_send suppression for a successful send",
      `suppressed=${result.suppressed}, signal=${result.signal}`,
    );
  }
}

async function test16_deferredSequenceResumesAfterWindowClears() {
  console.log("\n[13] Deferred sequence email can resume after auto-send window expires");
  // sequence_step_deferred_arbitration is a deferral-only audit record — it must NOT
  // count as an automated send. If it did, each deferred tick would reset the cooldown
  // and the sequence would remain stuck indefinitely.
  // Here: deferral log is 90 min old, auto-send window is 60 min → should NOT suppress.
  const deferralTime = minsAgo(90); // beyond the 60-min auto-send window
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "sequence_step_deferred_arbitration", actorType: "system", createdAt: deferralTime },
    ],
    _configOverrideForTest: {
      autoSendWindowMinutes: 60,
      humanTouchWindowHours: 0, // isolate auto-send gate
      replyPendingWindowHours: 0,
    },
  });
  if (!result.suppressed) {
    ok("sequence_step_deferred_arbitration does not block resumption after window expires");
  } else {
    ko(
      "expected no suppression: deferral log is outside window and must not count as an automated send",
      `signal=${result.signal}, reason=${result.reason}`,
    );
  }
}

async function test18_replyResolvedByComposerActorAdmin() {
  console.log("\n[13] Reply resolved by email_sent_via_composer (actorType=admin)");
  // Dashboard routes write actorType="admin" for admin users — NOT "human".
  // The arbitration engine must recognise the action string regardless of actor type.
  // Disable the human-touch and auto-send checks so ONLY the reply_pending gate is active.
  const replyTime = minsAgo(60);
  const composerTime = minsAgo(30); // after the reply
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "inbound_message_processed", actorType: "system", createdAt: replyTime },
      { action: "email_sent_via_composer",   actorType: "admin",  createdAt: composerTime },
    ],
    _configOverrideForTest: {
      replyPendingWindowHours: 24,
      humanTouchWindowHours: 0,  // isolate reply_pending gate
      autoSendWindowMinutes: 0,  // isolate reply_pending gate
    },
  });
  if (!result.suppressed) {
    ok("email_sent_via_composer (actorType=admin) clears reply_pending suppression");
  } else {
    ko(
      "expected reply_pending suppression to be cleared by email_sent_via_composer with actorType=admin",
      `signal=${result.signal}, reason=${result.reason}`,
    );
  }
}

async function test19_replyResolvedByCallLoggedActorUser() {
  console.log("\n[14] Reply resolved by call_logged (actorType=user)");
  // Dashboard activity logged by a rep — actorType defaults to "user".
  // Must clear the reply_pending gate the same way actorType="human" does.
  // Disable the human-touch and auto-send checks so ONLY the reply_pending gate is active.
  const replyTime = minsAgo(90);
  const callTime  = minsAgo(45);
  const result = await shouldSuppress(CONTACT_ID, "sms", {
    _logsForTest: [
      { action: "inbound_message_processed", actorType: "system", createdAt: replyTime },
      { action: "call_logged",               actorType: "user",   createdAt: callTime },
    ],
    _configOverrideForTest: {
      replyPendingWindowHours: 24,
      humanTouchWindowHours: 0,  // isolate reply_pending gate
      autoSendWindowMinutes: 0,  // isolate reply_pending gate
    },
  });
  if (!result.suppressed) {
    ok("call_logged (actorType=user) clears reply_pending suppression");
  } else {
    ko(
      "expected reply_pending suppression to be cleared by call_logged with actorType=user",
      `signal=${result.signal}, reason=${result.reason}`,
    );
  }
}

async function test20_replyStillPendingWhenOnlyAutoActivityAfter() {
  console.log("\n[15] Reply still pending when only automated activity follows");
  // An automated sequence send after the reply must NOT resolve the gate —
  // only human/manual-touch actions should clear it.
  // Disable human-touch and auto-send checks so ONLY reply_pending is active.
  const replyTime = minsAgo(60);
  const autoTime  = minsAgo(30);
  const result = await shouldSuppress(CONTACT_ID, "email", {
    _logsForTest: [
      { action: "inbound_message_processed", actorType: "system", createdAt: replyTime },
      { action: "sequence_email_sent",       actorType: "system", createdAt: autoTime },
    ],
    _configOverrideForTest: {
      replyPendingWindowHours: 24,
      humanTouchWindowHours: 0,  // isolate reply_pending gate
      autoSendWindowMinutes: 0,  // isolate reply_pending gate
    },
  });
  if (result.suppressed && result.signal === "reply_pending") {
    ok("automated sequence send does NOT resolve reply_pending gate");
  } else {
    ko(
      "expected reply_pending suppression to persist when only automated activity follows",
      `suppressed=${result.suppressed}, signal=${result.signal}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Communication Arbitration Engine — gate check (non-mutating)");
  console.log("─".repeat(60));

  await test1_humanTouchViaNote();
  await test2_humanTouchViaComposer();
  await test3_baselinePassesThrough();
  await test4_autoSendCooldown();
  await test5_skipHumanTouchFlag();
  await test6_oldHumanTouchDoesNotSuppress();
  await test7_crossChannelAutoSendDoesNotSuppress();
  await test8_zeroHumanWindowDisablesGate();
  await test9_zeroAutoSendWindowDisablesGate();
  await test10_inboundReplyPending();
  await test11_emailLoggedCountsAsHumanTouch();
  await test12_resumeAfterCalculation();
  await test13_replyPendingWithWindowAbove48Hours();
  await test14_failedGhlSendDoesNotTriggerAutoSendCooldown();
  await test15_successfulGhlSendDoesTrigerAutoSendCooldown();
  await test16_deferredSequenceResumesAfterWindowClears();
  await test18_replyResolvedByComposerActorAdmin();
  await test19_replyResolvedByCallLoggedActorUser();
  await test20_replyStillPendingWhenOnlyAutoActivityAfter();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Results: ${pass} passed, ${fail} failed`);

  if (fail > 0) {
    console.error(`\n❌  Arbitration gate FAILED — ${fail} check(s) did not pass.\n`);
    process.exit(1);
  }

  console.log("\n✅  Arbitration gate PASSED\n");
  process.exit(0);
}

main().catch(err => {
  console.error("\nFatal error in arbitration test:", err?.message ?? err);
  process.exit(1);
});
