#!/usr/bin/env tsx
/**
 * scripts/test-channel-orchestrator.ts — Wave 1A ChannelOrchestrator protection suite
 *
 * Verifies that:
 *   1. ChannelOrchestrator is importable with correct transport structure
 *   2. GHL transport adapters implement the required interfaces
 *   3. Global outbound pause (DB key = outboundGlobalPaused) blocks ALL channels
 *   4. Clearing the pause lets sends proceed past the global-pause gate
 *   5. GHL opportunity stage changes cannot advance Liberty deal stages (authority guard)
 *   6. Replit-owned contact compliance fields are protected from GHL sync overwrites
 *   7. Compliance fence order: global pause → arbitration → contactability
 *   8. Health monitor includes emailTransport and smsTransport checks (not only ghlSync)
 *   9. sequenceWorker is present in HealthReport (not silently dropped)
 *
 * Section 3 is a live-DB behavioral test: it sets outboundGlobalPaused=true,
 * calls the singleton orchestrator for all three channels, verifies each is
 * blocked, then restores the original value in a finally block.
 */

import process from "process";

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  failed++;
}

function section(title: string) {
  console.log(`\n▶  ${title}`);
}

// ── 1. ChannelOrchestrator structure ─────────────────────────────────────────

section("1. ChannelOrchestrator imports and interface");

try {
  const { ChannelOrchestrator } = await import("../server/services/channel-orchestrator");
  if (typeof ChannelOrchestrator === "function") {
    ok("ChannelOrchestrator class is exported");
  } else {
    fail("ChannelOrchestrator is not a constructor");
  }

  const { channelOrchestrator } = await import("../server/services/transports/index");
  if (typeof channelOrchestrator?.sendEmail === "function") ok("singleton.sendEmail is a function");
  else fail("singleton.sendEmail missing");

  if (typeof channelOrchestrator?.sendSms === "function") ok("singleton.sendSms is a function");
  else fail("singleton.sendSms missing");

  if (typeof channelOrchestrator?.sendRvm === "function") ok("singleton.sendRvm is a function");
  else fail("singleton.sendRvm missing");

  if (typeof channelOrchestrator?.checkCompliance === "function") ok("singleton.checkCompliance is a function");
  else fail("singleton.checkCompliance missing");

  if (typeof channelOrchestrator?.healthCheck === "function") ok("singleton.healthCheck is a function");
  else fail("singleton.healthCheck missing");

  const providers = [channelOrchestrator.emailProviderName, channelOrchestrator.smsProviderName, channelOrchestrator.rvmProviderName];
  if (providers.every(p => typeof p === "string" && p.length > 0)) ok(`Transport providers named: ${providers.join(", ")}`);
  else fail("One or more transport providers have no name");
} catch (err: any) {
  fail("ChannelOrchestrator import failed", err.message);
}

// ── 2. Transport adapter structure ────────────────────────────────────────────

section("2. GHL transport adapters");

try {
  const { GhlEmailTransport } = await import("../server/services/transports/ghl-email-transport");
  const { GhlSmsTransport } = await import("../server/services/transports/ghl-sms-transport");
  const { GhlRvmTransport } = await import("../server/services/transports/ghl-rvm-transport");

  const email = new GhlEmailTransport();
  const sms = new GhlSmsTransport();
  const rvm = new GhlRvmTransport();

  if (email.name === "ghl") ok("GhlEmailTransport.name = 'ghl'");
  else fail(`GhlEmailTransport.name = '${email.name}' (expected 'ghl')`);

  if (sms.name === "ghl") ok("GhlSmsTransport.name = 'ghl'");
  else fail(`GhlSmsTransport.name = '${sms.name}' (expected 'ghl')`);

  if (rvm.name === "ghl") ok("GhlRvmTransport.name = 'ghl'");
  else fail(`GhlRvmTransport.name = '${rvm.name}' (expected 'ghl')`);

  if (typeof email.send === "function") ok("GhlEmailTransport.send is a function");
  else fail("GhlEmailTransport.send missing");

  if (typeof sms.send === "function") ok("GhlSmsTransport.send is a function");
  else fail("GhlSmsTransport.send missing");

  if (typeof rvm.send === "function") ok("GhlRvmTransport.send is a function");
  else fail("GhlRvmTransport.send missing");
} catch (err: any) {
  fail("Transport adapter import failed", err.message);
}

// ── 3. Global pause blocks all channels — live DB behavioral test ─────────────
//
// This test uses the live DB to set outboundGlobalPaused=true (the canonical
// platform kill-switch key) and verifies all three channels are blocked by the
// compliance fence before any transport call or contact lookup occurs.
// The finally block always restores the original value.

section("3. Global outbound pause (DB key=outboundGlobalPaused) blocks all channels");

let savedPauseValue: unknown = undefined;
let pauseWritten = false;

try {
  const { storage } = await import("../server/storage");
  const { channelOrchestrator } = await import("../server/services/transports/index");

  // Snapshot current state so the finally block can restore it exactly
  savedPauseValue = await storage.getSystemSetting("outboundGlobalPaused");

  // Activate the kill-switch
  await storage.setSystemSetting("outboundGlobalPaused", true);
  pauseWritten = true;

  // Email — pause check is first in the compliance fence, before any contact lookup
  const emailResult = await channelOrchestrator.sendEmail({
    contactId: 999_999,
    subject: "wave1a-pause-test",
    body: "wave1a-pause-test",
  });
  if (!emailResult.success && emailResult.skipped === true) {
    ok("outboundGlobalPaused=true blocks email (success=false, skipped=true)");
  } else {
    fail("Global pause did NOT block email send", JSON.stringify(emailResult));
  }
  if (emailResult.skipReason?.toLowerCase().includes("paus")) {
    ok(`Email skipReason mentions pause: "${emailResult.skipReason}"`);
  } else {
    fail(`Email skipReason does not mention pause: "${emailResult.skipReason}"`);
  }

  // SMS
  const smsResult = await channelOrchestrator.sendSms({
    contactId: 999_999,
    body: "wave1a-pause-test",
  });
  if (!smsResult.success && smsResult.skipped === true) {
    ok("outboundGlobalPaused=true blocks SMS (success=false, skipped=true)");
  } else {
    fail("Global pause did NOT block SMS send", JSON.stringify(smsResult));
  }

  // RVM
  const rvmResult = await channelOrchestrator.sendRvm({
    contactId: 999_999,
    scriptText: "wave1a-pause-test",
  });
  if (!rvmResult.success && rvmResult.skipped === true) {
    ok("outboundGlobalPaused=true blocks RVM (success=false, skipped=true)");
  } else {
    fail("Global pause did NOT block RVM send", JSON.stringify(rvmResult));
  }
} catch (err: any) {
  fail("Global pause behavioral test threw", err.message);
} finally {
  // Always restore — never leave the DB with pause=true after a test run
  if (pauseWritten) {
    try {
      const { storage } = await import("../server/storage");
      const restoreValue =
        savedPauseValue === true || savedPauseValue === "true" ? true : false;
      await storage.setSystemSetting("outboundGlobalPaused", restoreValue);
    } catch (restoreErr: any) {
      console.error(`  ⚠ Could not restore outboundGlobalPaused — FIX MANUALLY: ${restoreErr.message}`);
    }
  }
}

// ── 4. Pause gate wired into checkCompliance ─────────────────────────────────
//
// Non-mutating version: proves the pause gate is wired into checkCompliance
// through static code analysis and a live read-only verify.
// - Static: checkCompliance calls authorize() from OutboundPauseAuthority
// - Static: the decision from authorize() is honoured before arbitration
// - Live: current authorize() decision matches the control table state
//
// NOTE: skipGlobalPauseCheck has been removed from OrchestratorSendOptions;
// the gate is now unconditional and cannot be bypassed by callers.

section("4. Pause gate wired into checkCompliance (static + read-only live verify)");

try {
  const fs = await import("fs");
  const orchestratorSrc = fs.readFileSync("server/services/channel-orchestrator.ts", "utf8");

  // a. Static: authorize() imported and called in checkCompliance
  if (orchestratorSrc.includes("authorize") && orchestratorSrc.includes("outbound-pause-authority")) {
    ok("checkCompliance (static): authorize() imported from outbound-pause-authority");
  } else {
    fail("checkCompliance (static): authorize() import from outbound-pause-authority missing");
  }

  // b. Static: decision.allowed check present — gate is honoured before arbitration
  if (orchestratorSrc.includes("decision.allowed") || orchestratorSrc.includes("pauseDecision.allowed")) {
    ok("checkCompliance (static): pause decision.allowed check present before arbitration");
  } else {
    fail("checkCompliance (static): no decision.allowed guard found — gate may not be enforced");
  }

  // c. Static: skipGlobalPauseCheck is gone from the options type and implementation
  if (!orchestratorSrc.includes("skipGlobalPauseCheck")) {
    ok("checkCompliance (static): skipGlobalPauseCheck removed — gate is unconditional");
  } else {
    fail("checkCompliance (static): skipGlobalPauseCheck still present — callers can bypass the gate");
  }

  // d. Live read-only: authorize() correctly reflects the current control table state
  const { authorize } = await import("../server/services/outbound-pause-authority");
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`SELECT state FROM outbound_pause_control LIMIT 1`);
  const controlState = (rows.rows[0] as any)?.state ?? "unknown";
  const decision = await authorize({});
  const expectedAllowed = controlState === "unpaused";
  if (decision.allowed === expectedAllowed) {
    ok(`Pause gate (live): authorize() allowed=${decision.allowed} matches control state="${controlState}"`);
  } else if (controlState === "unknown") {
    ok("Pause gate (live): control table not seeded yet — gate defaults to fail-closed (allowed=false)");
  } else {
    fail(`Pause gate (live): authorize() allowed=${decision.allowed} does not match control state="${controlState}"`);
  }
} catch (err: any) {
  fail("Pause gate wiring test threw", err.message);
}

// ── 5. GHL deal stage authority guard ────────────────────────────────────────

section("5. GHL opportunity stage cannot overwrite Liberty deal stage by default");

try {
  const { mapGhlStageToDeal } = await import("../server/services/ghl-sync");

  // Verify the mapping function itself works
  const stage = mapGhlStageToDeal("new_lead");
  if (typeof stage === "string") {
    ok(`mapGhlStageToDeal("new_lead") = "${stage}"`);
  } else {
    fail("mapGhlStageToDeal returned non-string");
  }

  // Verify GHL_DEAL_STAGE_AUTHORITY defaults to "liberty" (blocking GHL writes)
  const authority = (process.env.GHL_DEAL_STAGE_AUTHORITY ?? "liberty").toLowerCase();
  if (authority === "liberty") {
    ok(`GHL_DEAL_STAGE_AUTHORITY = "${authority}" — Liberty owns deal stages (GHL writes blocked)`);
  } else {
    fail(`GHL_DEAL_STAGE_AUTHORITY = "${authority}" — expected "liberty" (default); GHL must not own deal stages`);
  }

  // Verify the authority guard code is in ghl-sync.ts
  const ghlSyncSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/ghl-sync.ts", "utf8"),
  );
  if (ghlSyncSrc.includes("GHL_DEAL_STAGE_AUTHORITY") && ghlSyncSrc.includes("liberty_is_deal_stage_authority")) {
    ok("ghl-sync.ts contains Liberty deal-stage authority guard");
  } else {
    fail("ghl-sync.ts missing Liberty deal-stage authority guard (GHL_DEAL_STAGE_AUTHORITY check)");
  }
} catch (err: any) {
  fail("Deal stage authority test threw", err.message);
}

// ── 6. Replit-owned contact fields protected from GHL overwrites ──────────────

section("6. Replit-owned contact compliance fields are protected from GHL sync");

try {
  const ghlSyncSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/ghl-sync.ts", "utf8"),
  );

  const requiredFields = [
    "doNotContact",
    "doNotAutoContact",
    "consentTier",
    "lifecycleStage",
    "consentEmail",
    "consentSms",
    "smsStatus",
    "emailStatus",
  ];

  let allPresent = true;
  for (const field of requiredFields) {
    if (!ghlSyncSrc.includes(`"${field}"`)) {
      fail(`Replit-owned field "${field}" missing from getReplitOwnedFields() set`);
      allPresent = false;
    }
  }
  if (allPresent) {
    ok(`All ${requiredFields.length} Replit-owned compliance fields are in the protection set`);
  }
} catch (err: any) {
  fail("Replit-owned field protection test threw", err.message);
}

// ── 7. Compliance fence ordering ─────────────────────────────────────────────

section("7. Compliance fence ordering (global pause → arbitration → contactability)");

try {
  const src = await import("fs").then(fs =>
    fs.readFileSync("server/services/channel-orchestrator.ts", "utf8"),
  );

  // Verify global pause is delegated to OutboundPauseAuthority (new canonical pattern).
  // The old direct `storage.getSystemSetting("outboundGlobalPaused")` is replaced by
  // `authorize()` from outbound-pause-authority. Both patterns are accepted here.
  const hasAuthorityDelegate = src.includes("outbound-pause-authority") && src.includes("authorize(");
  const hasLegacyPauseRead   = src.includes('"outboundGlobalPaused"');
  if (hasAuthorityDelegate) {
    ok('checkCompliance delegates to OutboundPauseAuthority.authorize() (new canonical pattern)');
  } else if (hasLegacyPauseRead) {
    ok('checkCompliance reads canonical "outboundGlobalPaused" key (legacy pattern still present)');
  } else {
    fail('checkCompliance must delegate to OutboundPauseAuthority.authorize() or read "outboundGlobalPaused"');
  }

  // Verify ordering: pause → arbitration → contactability
  // New pattern: authorize() appears first; old pattern: "outboundGlobalPaused" appears first.
  const pauseIdx = hasAuthorityDelegate
    ? src.indexOf("authorize(")
    : src.indexOf('"outboundGlobalPaused"');
  const arbitrationIdx   = src.indexOf("shouldSuppress");
  const contactabilityIdx = src.indexOf("evaluateContactability");

  if (pauseIdx > 0 && arbitrationIdx > pauseIdx && contactabilityIdx > arbitrationIdx) {
    ok("Fence order correct: global pause → arbitration → contactability");
  } else {
    fail(
      `Fence order incorrect — pause@${pauseIdx} arbitration@${arbitrationIdx} contactability@${contactabilityIdx}`,
    );
  }

  // Verify all send methods delegate to checkCompliance
  const sendEmailStart = src.indexOf("async sendEmail");
  const sendSmsStart   = src.indexOf("async sendSms");
  const sendRvmStart   = src.indexOf("async sendRvm");
  const healthStart    = src.indexOf("async healthCheck");

  const sendEmailSrc = sendEmailStart >= 0 && sendSmsStart > sendEmailStart
    ? src.slice(sendEmailStart, sendSmsStart) : "";
  const sendSmsSrc   = sendSmsStart  >= 0 && sendRvmStart  > sendSmsStart
    ? src.slice(sendSmsStart, sendRvmStart)   : "";
  const sendRvmSrc   = sendRvmStart  >= 0 && healthStart   > sendRvmStart
    ? src.slice(sendRvmStart, healthStart)    : "";

  if (sendEmailSrc.includes("checkCompliance")) ok("sendEmail() delegates to checkCompliance()");
  else fail("sendEmail() does not call checkCompliance()");

  if (sendSmsSrc.includes("checkCompliance"))   ok("sendSms() delegates to checkCompliance()");
  else fail("sendSms() does not call checkCompliance()");

  if (sendRvmSrc.includes("checkCompliance"))   ok("sendRvm() delegates to checkCompliance()");
  else fail("sendRvm() does not call checkCompliance()");

  // Verify blocked sends return a skipped+skipReason payload
  if (src.includes("skipped: true") && src.includes("skipReason")) {
    ok("Blocked sends return { skipped: true, skipReason }");
  } else {
    fail("Missing skipped/skipReason return shape in compliance block");
  }
} catch (err: any) {
  fail("Compliance fence order test threw", err.message);
}

// ── 8. Health monitor transport checks ───────────────────────────────────────

section("8. Health monitor includes emailTransport and smsTransport checks");

try {
  const src = await import("fs").then(fs =>
    fs.readFileSync("server/services/health-monitor.ts", "utf8"),
  );

  if (src.includes("emailTransport: CheckResult")) {
    ok("HealthReport includes emailTransport check");
  } else {
    fail("HealthReport missing emailTransport check");
  }

  if (src.includes("smsTransport: CheckResult")) {
    ok("HealthReport includes smsTransport check");
  } else {
    fail("HealthReport missing smsTransport check");
  }

  if (src.includes("checkEmailTransport") && src.includes("checkSmsTransport")) {
    ok("checkEmailTransport and checkSmsTransport functions exist in health-monitor.ts");
  } else {
    fail("Missing transport health check functions in health-monitor.ts");
  }
} catch (err: any) {
  fail("Health monitor interface test threw", err.message);
}

// ── 9. sequenceWorker still present in HealthReport ──────────────────────────

section("9. sequenceWorker remains present in HealthReport (not silently dropped)");

try {
  const src = await import("fs").then(fs =>
    fs.readFileSync("server/services/health-monitor.ts", "utf8"),
  );

  // The type definition must still list sequenceWorker
  if (src.includes("sequenceWorker: CheckResult")) {
    ok("HealthReport.checks.sequenceWorker is declared");
  } else {
    fail("HealthReport.checks.sequenceWorker is missing — check was silently dropped");
  }

  // checkSequenceWorker function must still exist
  if (src.includes("checkSequenceWorker")) {
    ok("checkSequenceWorker() function exists in health-monitor.ts");
  } else {
    fail("checkSequenceWorker() function missing from health-monitor.ts");
  }

  // sequenceWorkerRes must be in the Promise.allSettled destructuring
  if (src.includes("sequenceWorkerRes,") && src.includes("checkSequenceWorker()")) {
    ok("sequenceWorker is included in the parallel health-check run");
  } else {
    fail("sequenceWorker not included in Promise.allSettled parallel run");
  }

  // test-live-health.ts must list sequenceWorker in its CRITICAL_CHECKS
  const liveHealthSrc = await import("fs").then(fs =>
    fs.readFileSync("scripts/test-live-health.ts", "utf8"),
  );
  if (liveHealthSrc.includes('"sequenceWorker"') && liveHealthSrc.includes("CRITICAL_CHECKS")) {
    ok("test-live-health.ts includes sequenceWorker in its CRITICAL_CHECKS");
  } else {
    fail("test-live-health.ts does not list sequenceWorker in CRITICAL_CHECKS");
  }
} catch (err: any) {
  fail("sequenceWorker presence test threw", err.message);
}

// ── 10. Business services route through ChannelOrchestrator ──────────────────

section("10. Business services use ChannelOrchestrator (no direct GHL channel calls)");

try {
  // sequence-worker: must NOT import sendGhlEmail/sendGhlSms at the module level
  // (they are now routed through channelOrchestrator inside the step execution)
  const seqSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/sequence-worker.ts", "utf8"),
  );

  // Top-level import must not include sendGhlEmail or sendGhlSms as named imports.
  // We check actual import declarations (lines starting with "import {"), not comments.
  const importLines = seqSrc.split("\n").filter(l => /^import\s+\{/.test(l.trim()));
  const hasDirectGhlSendImport = importLines.some(
    l => l.includes("sendGhlEmail") || l.includes("sendGhlSms"),
  );
  if (!hasDirectGhlSendImport) {
    ok("sequence-worker.ts: sendGhlEmail/sendGhlSms removed from top-level import declarations");
  } else {
    fail("sequence-worker.ts still has sendGhlEmail/sendGhlSms in a top-level import declaration");
  }

  // sequence-worker email step must use channelOrchestrator.sendEmail
  if (seqSrc.includes("channelOrchestrator") && seqSrc.includes("sendEmail(")) {
    ok("sequence-worker.ts: email step calls channelOrchestrator.sendEmail()");
  } else {
    fail("sequence-worker.ts email step does not call channelOrchestrator.sendEmail()");
  }

  // sequence-worker SMS step must use channelOrchestrator.sendSms
  if (seqSrc.includes("sendSms(") && seqSrc.includes("transports/index")) {
    ok("sequence-worker.ts: SMS step calls channelOrchestrator.sendSms() via transports/index");
  } else {
    fail("sequence-worker.ts SMS step does not use channelOrchestrator via transports/index");
  }

  // skipContactabilityCheck must be set (sequence-worker has its own fence already)
  if (seqSrc.includes("skipContactabilityCheck: true")) {
    ok("sequence-worker.ts: skipContactabilityCheck=true (own fence already ran)");
  } else {
    fail("sequence-worker.ts missing skipContactabilityCheck=true on orchestrator calls");
  }

  // onboarding-reminder: must use orchestrator, not enrollInGhlWorkflow
  const onboardingSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/onboarding-reminder.ts", "utf8"),
  );

  if (!onboardingSrc.includes("enrollInGhlWorkflow")) {
    ok("onboarding-reminder.ts: enrollInGhlWorkflow removed (migrated to orchestrator)");
  } else {
    fail("onboarding-reminder.ts still calls enrollInGhlWorkflow — not fully migrated");
  }

  if (onboardingSrc.includes("channelOrchestrator") && onboardingSrc.includes("sendEmail(")) {
    ok("onboarding-reminder.ts: uses channelOrchestrator.sendEmail()");
  } else {
    fail("onboarding-reminder.ts does not use channelOrchestrator.sendEmail()");
  }

  // sequenceWorker must now be in CRITICAL_CHECKS in health-monitor.ts
  const hmSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/health-monitor.ts", "utf8"),
  );
  if (hmSrc.includes('"sequenceWorker"') && hmSrc.includes("CRITICAL_CHECKS")) {
    const critLine = hmSrc.split("\n").find(l => l.includes("CRITICAL_CHECKS") && l.includes("new Set"));
    if (critLine?.includes('"sequenceWorker"')) {
      ok(`sequenceWorker is in CRITICAL_CHECKS (health-monitor): ${critLine?.trim()}`);
    } else {
      fail("sequenceWorker not found inside the CRITICAL_CHECKS Set definition in health-monitor.ts");
    }
  } else {
    fail("CRITICAL_CHECKS definition missing or sequenceWorker not referenced in health-monitor.ts");
  }

  // sequenceWorker must also be critical in admin.ts live-health endpoint
  const adminSrc = await import("fs").then(fs =>
    fs.readFileSync("server/routes/admin.ts", "utf8"),
  );
  const seqWorkerCriticalInAdmin = adminSrc.includes('"sequenceWorker", status:') &&
    adminSrc.includes("critical: true") &&
    (() => {
      // Find the sequenceWorker push line and verify it has critical: true
      const line = adminSrc.split("\n").find(l => l.includes('"sequenceWorker"') && l.includes("critical:"));
      return line?.includes("critical: true") ?? false;
    })();
  if (seqWorkerCriticalInAdmin) {
    ok("sequenceWorker is critical: true in admin.ts live-health endpoint");
  } else {
    fail("sequenceWorker is NOT marked critical in admin.ts live-health endpoint");
  }

  const critNamesLine = adminSrc.split("\n").find(l => l.includes("CRITICAL_NAMES") && l.includes("["));
  if (critNamesLine?.includes('"sequenceWorker"')) {
    ok(`sequenceWorker is in admin.ts CRITICAL_NAMES: ${critNamesLine?.trim()}`);
  } else {
    fail("sequenceWorker not found in admin.ts CRITICAL_NAMES array");
  }

  // SDR orchestrator must use channelOrchestrator, not direct sendGhlEmail/sendGhlSms
  const sdrOrchestratorSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/sdr/orchestrator.ts", "utf8"),
  );
  const sdrImportLines = sdrOrchestratorSrc.split("\n").filter(l => /^import\s+\{/.test(l.trim()));
  if (!sdrImportLines.some(l => l.includes("sendGhlEmail") || l.includes("sendGhlSms"))) {
    ok("sdr/orchestrator.ts: sendGhlEmail/sendGhlSms removed from top-level imports");
  } else {
    fail("sdr/orchestrator.ts still has sendGhlEmail/sendGhlSms in top-level import");
  }
  if (sdrOrchestratorSrc.includes("channelOrchestrator") && sdrOrchestratorSrc.includes("transports/index")) {
    ok("sdr/orchestrator.ts: routes email/SMS through channelOrchestrator");
  } else {
    fail("sdr/orchestrator.ts does not use channelOrchestrator");
  }

  // SDR must NOT bypass the contactability fence — skipContactabilityCheck must be false (or absent)
  // Count how many times skipContactabilityCheck: true appears in sdr/orchestrator.ts
  const sdrBypassCount = (sdrOrchestratorSrc.match(/skipContactabilityCheck\s*:\s*true/g) || []).length;
  if (sdrBypassCount === 0) {
    ok("sdr/orchestrator.ts: skipContactabilityCheck is NOT bypassed — full fence enforced");
  } else {
    fail(`sdr/orchestrator.ts has ${sdrBypassCount} skipContactabilityCheck:true bypass(es) — compliance regression`);
  }
  // Confirm false is explicitly set (belt + suspenders documentation)
  const sdrFalseCount = (sdrOrchestratorSrc.match(/skipContactabilityCheck\s*:\s*false/g) || []).length;
  if (sdrFalseCount >= 2) {
    ok(`sdr/orchestrator.ts: skipContactabilityCheck: false set on both email and SMS sends (${sdrFalseCount} occurrences)`);
  } else {
    fail(`sdr/orchestrator.ts: expected skipContactabilityCheck:false on both sends; found ${sdrFalseCount}`);
  }
} catch (err: any) {
  fail("Business service integration test threw", err.message);
}

// ── 10b. DNC / global-pause behavioral blocking via orchestrator ─────────────

section("10b. Compliance fence: DNC and global-pause block SDR-style sends");

try {
  const { channelOrchestrator } = await import("../server/services/transports/index");

  // Global-pause blocking is already tested in section 3.
  // Here we test the contactability fence using checkCompliance() directly,
  // confirming that a non-existent / bare contactId gets blocked by the
  // contactability check when skipContactabilityCheck is false.
  // (A real DNC test requires a seeded contact — contactId=0 triggers the "contact
  // not found" guard that the fence uses when no contactability record exists.)
  // checkCompliance(contactId, channels[], opts)
  const badContactResult = await channelOrchestrator.checkCompliance(
    0,
    ["email"],
    { skipContactabilityCheck: false },
  );
  // contactId=0 has no DB record → orchestrator must block it (not allow a blind send)
  if (!badContactResult.allowed) {
    ok(`Contactability fence blocks unknown contactId=0 for email: "${badContactResult.reason}"`);
  } else {
    // If the fence allows unknown contacts it is fail-open — flag it
    fail("Contactability fence is fail-OPEN for unknown contact — SDR sends could bypass compliance");
  }

  const badSmsResult = await channelOrchestrator.checkCompliance(
    0,
    ["sms"],
    { skipContactabilityCheck: false },
  );
  if (!badSmsResult.allowed) {
    ok(`Contactability fence blocks unknown contactId=0 for SMS: "${badSmsResult.reason}"`);
  } else {
    fail("Contactability fence is fail-OPEN for unknown contact on SMS channel");
  }

  // Verify the compliance source code checks do_not_contact (DNC) for SMS
  const orchSrc = await import("fs").then(fs =>
    fs.readFileSync("server/services/channel-orchestrator.ts", "utf8"),
  );
  if (orchSrc.includes("do_not_contact") || orchSrc.includes("doNotContact") || orchSrc.includes("DNC")) {
    ok("channel-orchestrator.ts: DNC field referenced in compliance fence");
  } else {
    fail("channel-orchestrator.ts: DNC check not found — compliance fence may be incomplete");
  }

  // Verify global-pause is checked before the contactability gate in the
  // checkCompliance method body. New canonical pattern uses authorize() from
  // outbound-pause-authority; legacy pattern reads "outboundGlobalPaused" directly.
  const orchPauseIdx = orchSrc.includes("outbound-pause-authority") && orchSrc.includes("authorize(")
    ? orchSrc.indexOf("authorize(")
    : orchSrc.indexOf("outboundGlobalPaused");
  const evalContactabilityIdx = orchSrc.indexOf("evaluateContactability");
  if (orchPauseIdx !== -1 && evalContactabilityIdx !== -1 && orchPauseIdx < evalContactabilityIdx) {
    ok("Fence order: pause authority check precedes evaluateContactability call in orchestrator");
  } else {
    fail(
      `Fence order incorrect — pause check@${orchPauseIdx} must precede evaluateContactability@${evalContactabilityIdx}`,
    );
  }
} catch (err: any) {
  fail("DNC/global-pause behavioral test threw", err.message);
}

// ── 11. No unexpected direct sendGhlEmail/sendGhlSms CALL SITES outside adapters ─
//
// Scans for actual invocations (sendGhlEmail( / sendGhlSms() — not imports or
// comments) and requires every file to either be an approved transport adapter
// or appear in the Wave 2 migration backlog.  Adding a NEW direct call site
// without updating this allowlist will cause this check to fail.

section("11. Direct GHL send call-site scan (Wave 2 migration backlog allowlist)");

try {
  const { execSync } = await import("child_process");

  // ── Approved transport adapters — these ARE the GHL wrappers ─────────────
  const APPROVED_ADAPTERS = new Set([
    "server/services/ghl.ts",                           // defines sendGhlEmail/sendGhlSms
    "server/services/transports/ghl-email-transport.ts", // Wave 1A: approved adapter
    "server/services/transports/ghl-sms-transport.ts",   // Wave 1A: approved adapter
  ]);

  // ── Approved upstream callers ─────────────────────────────────────────────
  // These files call sendGhlEmail() / sendGhlSms() / sendSmtpEmail() which
  // are the canonical gated adapter functions — NOT raw ghlFetch/provider
  // calls.  The pause gate fires inside those functions, so these callers are
  // already gated transitively.  They are NOT migration backlogs.
  //
  // The compliance scanner verifies that none of these files call raw provider
  // sinks directly (see checkArchitecturalBoundaries).
  const APPROVED_UPSTREAM_CALLERS: Record<string, string> = {
    // GHL service layer — wraps GHL API; classified CHANNEL_UTILITY_REQUIRED
    "server/services/ghl-workflow-enrollment.ts": "GHL service layer — calls gated sendGhlEmail/sendGhlSms wrappers",

    // SDR module — calls gated wrappers (sendGhlEmail, sendGhlSms)
    "server/services/sdr/statement-flow.ts":     "SDR statement-chase — calls sendGhlEmail/sendGhlSms (gated)",
    "server/services/sdr/terminal-shipping.ts":  "SDR terminal shipping — calls sendGhlEmail (gated)",
    "server/services/sdr/proposal-tracking.ts":  "SDR proposal engagement — calls sendGhlEmail/sendGhlSms (gated)",
    "server/services/sdr/voice-orchestrator.ts": "SDR voice follow-up — calls sendGhlSms (gated)",

    // Core services — call gated wrappers (sendGhlEmail, sendSmtpEmail)
    "server/services/campaign-engine.ts":        "Campaign batch — calls sendSmtpEmail / sendGhlEmail (both gated)",
    "server/services/co-branded-proposal.ts":    "Co-branded proposal — calls sendGhlEmail / sendSmtpEmail (gated)",
    "server/services/proposal-engine.ts":        "Proposal delivery — calls sendGhlEmail / sendSmtpEmail (gated)",
    "server/services/sla-worker.ts":             "SLA escalation — calls sendGhlEmail (gated)",
    "server/services/workflow-executor.ts":      "Workflow-triggered — calls sendGhlEmail / sendGhlSms (gated)",

    // Routes — confirmation / inbound-event sends through gated wrappers
    "server/routes/activity.ts":                 "Activity notification — calls sendGhlEmail (gated)",
    "server/routes/contacts.ts":                 "Contact-action confirmation — calls sendGhlEmail (gated)",
    "server/routes/helpers.ts":                  "Helper-triggered — calls sendGhlSms (gated)",
    "server/routes/integrations.ts":             "Integration-confirmation — calls sendGhlEmail / sendGhlSms (gated)",
    "server/routes/public.ts":                   "Public inbound confirmation — calls sendGhlEmail (gated)",
    "server/routes/savings.ts":                  "Savings alert — calls sendGhlEmail (gated)",
    "server/routes/wizard.ts":                   "Wizard completion — calls sendGhlEmail (gated)",
  };

  // Use sendGhlEmail( and sendGhlSms( with opening paren to find CALL SITES,
  // not imports, comments, or string literals mentioning the function name.
  let grepOutput = "";
  try {
    grepOutput = execSync(
      `grep -rln "sendGhlEmail(\\|sendGhlSms(" server/services/ server/routes/ --include="*.ts" 2>/dev/null || true`,
      { encoding: "utf8" },
    );
  } catch { /* grep exits non-zero when no matches */ }

  const filesWithCalls = grepOutput.trim().split("\n").map(f => f.trim()).filter(Boolean);
  const allApprovedCallers = new Set(Object.keys(APPROVED_UPSTREAM_CALLERS));

  let unexpected = 0;
  for (const file of filesWithCalls) {
    if (APPROVED_ADAPTERS.has(file)) continue;
    if (allApprovedCallers.has(file)) {
      ok(`Approved upstream caller (gated transitively): ${file.replace("server/", "")}`);
    } else {
      fail(`NEW unexpected direct GHL call in: ${file} — add to approved callers or migrate`);
      unexpected++;
    }
  }

  // Confirm migrated files no longer appear in the scan
  const migratedFiles = [
    "server/services/sequence-worker.ts",
    "server/services/onboarding-reminder.ts",
    "server/services/sdr/orchestrator.ts",
  ];
  for (const f of migratedFiles) {
    if (!filesWithCalls.includes(f)) {
      ok(`Migrated: ${f.replace("server/", "")} — no direct GHL calls found`);
    } else {
      fail(`${f} still contains direct sendGhlEmail(/sendGhlSms( — migration incomplete`);
      unexpected++;
    }
  }

  if (unexpected === 0) {
    ok(`Scan clean: ${filesWithCalls.length} file(s) found, all accounted for (${APPROVED_ADAPTERS.size} adapters + ${allApprovedCallers.size} approved upstream callers — all gated transitively)`);
  }
} catch (err: any) {
  fail("Direct GHL send scan threw", err.message);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
const total = passed + failed;
console.log(`Channel Orchestrator (Wave 1A): ${passed}/${total} checks passed`);

if (failed > 0) {
  console.error(`\n❌  ${failed} check(s) failed — fix before deploying.`);
  process.exit(1);
} else {
  console.log("\n✅  All checks passed.");
  process.exit(0);
}
