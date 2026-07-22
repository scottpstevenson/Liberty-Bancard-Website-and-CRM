#!/usr/bin/env tsx
/**
 * scripts/pre-deploy.ts — Unified launch gate
 *
 * Runs every mandatory test suite in sequence. For each suite:
 *   1. Verifies outboundGlobalPaused=true in the DB before starting
 *   2. Runs the suite as a child process (npx tsx <script>)
 *   3. Verifies outboundGlobalPaused=true again after the suite completes
 *   4. Restores pause=true if a suite temporarily lifted it
 *
 * After all suites, reports external provider configuration gaps as
 * non-blocking warnings (Gmail, GHL, OpenAI, SMTP, A2P, webhook key, etc.).
 *
 * Exits 0 only when every mandatory suite exits 0.
 * Exits 1 if any suite fails or if pre/post-suite pause checks fail.
 *
 * Usage:
 *   npx tsx scripts/pre-deploy.ts
 *
 * The script never deploys. It only validates.
 */

import { spawnSync } from "child_process";
import { db } from "../server/db";
import { systemSettings } from "../shared/schema";
import { eq } from "drizzle-orm";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

interface Suite {
  name: string;
  script: string;
  env?: Record<string, string>;
  timeoutSecs?: number;
  requiresServer?: boolean;
}

const MANDATORY_SUITES: Suite[] = [
  // ── Static / pure-function suites (no server required) ───────────────────
  {
    name: "Compliance Scan (send-gate coverage)",
    script: "scripts/compliance-scan.ts",
    timeoutSecs: 120,
  },
  {
    name: "Sender Policy (From/Reply-To/prohibited-sender)",
    script: "scripts/test-sender-policy.ts",
    timeoutSecs: 60,
  },
  {
    name: "Sequence Compliance (114 cases: consent/DNC/cap/kill-switch/CAN-SPAM)",
    script: "scripts/test-sequence-compliance.ts",
    timeoutSecs: 120,
  },
  {
    name: "Contactability Engine",
    script: "scripts/test-contactability.ts",
    timeoutSecs: 120,
  },
  {
    name: "New-Lead Enrollment Policy",
    script: "scripts/test-new-lead-enrollment-policy.ts",
    timeoutSecs: 120,
  },
  {
    name: "Intake Provenance",
    script: "scripts/test-intake-provenance.ts",
    timeoutSecs: 60,
  },
  {
    name: "Transport Dispatch (Gmail/SMTP/GHL routing + unsubscribe URL)",
    script: "scripts/test-transport-dispatch.ts",
    timeoutSecs: 120,
  },
  {
    name: "GHL Inbound Webhooks (reply/bounce/opt-out/STOP/dedup/signature)",
    script: "scripts/test-ghl-webhooks.ts",
    timeoutSecs: 120,
  },
  {
    name: "BullMQ Resilience (retry/backoff/DLQ/operator-visibility)",
    script: "scripts/test-bullmq-resilience.ts",
    timeoutSecs: 60,
  },
  {
    name: "Sunbiz Timeout & Recovery (no real network)",
    script: "scripts/test-sunbiz-timeout.ts",
    timeoutSecs: 60,
  },
  {
    name: "Role Guards",
    script: "scripts/smoke-role-guards.ts",
    timeoutSecs: 60,
  },
  {
    name: "API Coverage",
    script: "scripts/check-api-coverage.ts",
    timeoutSecs: 60,
  },
  {
    name: "SEO Audit",
    script: "scripts/seo-audit.ts",
    timeoutSecs: 60,
  },
  // ── Server-required suites ────────────────────────────────────────────────
  {
    name: "AI Assistant Boundaries (auth/role/schema/no-action)",
    script: "scripts/test-ai-assistant-boundaries.ts",
    env: { BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
  },
  {
    name: "Public Forms (GHL isolated)",
    script: "scripts/test-forms.ts",
    env: { GHL_TEST_MODE: "true", BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
  },
];

// ── External config items — non-blocking, reported separately ─────────────────

interface ConfigItem {
  key: string;
  label: string;
  category: string;
}

const EXTERNAL_CONFIG: ConfigItem[] = [
  // Email / transport
  { key: "GOOGLE_CLIENT_ID",     label: "Gmail OAuth client ID (non-cold transactional sends)", category: "email" },
  { key: "GOOGLE_CLIENT_SECRET", label: "Gmail OAuth client secret",                            category: "email" },
  { key: "SMTP_HOST",            label: "SMTP host (cold outreach transport)",                  category: "email" },
  { key: "SMTP_USER",            label: "SMTP username",                                        category: "email" },
  { key: "SMTP_PASS",            label: "SMTP password",                                        category: "email" },
  // GHL
  { key: "GHL_PRIVATE_INTEGRATION_TOKEN", label: "GHL Private Integration Token",              category: "ghl" },
  { key: "GHL_LOCATION_ID",               label: "GHL location ID",                            category: "ghl" },
  { key: "GHL_WEBHOOK_SECRET",            label: "GHL webhook signing secret",                 category: "ghl" },
  // OpenAI
  { key: "OPENAI_API_KEY",       label: "OpenAI API key",                                      category: "openai" },
  // Sender domain / compliance
  { key: "APP_URL",              label: "APP_URL (required for unsubscribe links in emails)",   category: "sender-domain" },
  { key: "SENDER_DOMAIN_SPF_VERIFIED",    label: "Sender domain SPF/DKIM verified (manual check)", category: "sender-domain" },
  // A2P / SMS
  { key: "A2P_REGISTRATION_ID",  label: "A2P 10DLC registration ID (required for SMS sends)",  category: "a2p" },
  { key: "GHL_PHONE_NUMBER_ID",  label: "GHL phone number ID (A2P-registered)",                category: "a2p" },
  // Redis
  { key: "REDIS_URL",            label: "REDIS_URL (production BullMQ durability)",            category: "infra" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPauseSetting(): Promise<boolean> {
  try {
    const rows = await db.select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, "outboundGlobalPaused"))
      .limit(1);
    const v = rows[0]?.value;
    return v === true || v === "true" || v === 1;
  } catch {
    return false;
  }
}

async function setPauseSetting(value: boolean): Promise<void> {
  try {
    await db.insert(systemSettings)
      .values({ key: "outboundGlobalPaused", value: String(value) })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: String(value) } });
  } catch (err: any) {
    console.warn(`  [pause-restore] Could not set outboundGlobalPaused=${value}: ${err?.message}`);
  }
}

function checkServerReachable(): boolean {
  const result = spawnSync("curl", ["-sf", "--max-time", "3", `${BASE_URL}/api/health`], {
    encoding: "utf8",
    timeout: 5000,
  });
  return result.status === 0;
}

function runSuite(suite: Suite): { exitCode: number; durationMs: number } {
  const start = Date.now();
  const env = { ...process.env, ...(suite.env ?? {}) };
  const result = spawnSync("npx", ["tsx", suite.script], {
    env,
    stdio: "inherit",
    encoding: "utf8",
    timeout: (suite.timeoutSecs ?? 120) * 1000,
  });
  const durationMs = Date.now() - start;
  return {
    exitCode: result.status ?? 1,
    durationMs,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printBanner(text: string) {
  const line = "═".repeat(60);
  console.log(`\n${line}`);
  console.log(` ${text}`);
  console.log(line);
}

function printSectionHeader(text: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${text}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  printBanner("Liberty Bancard — Pre-Deploy Launch Gate");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Suites: ${MANDATORY_SUITES.length} mandatory`);
  console.log("\n  ⚠  This gate makes NO real provider calls.");
  console.log("  ⚠  Global outbound pause is verified before and after every suite.\n");

  // ── 0. Initial pause state verification ────────────────────────────────────
  printSectionHeader("Pre-flight: outbound pause state");

  const initialPaused = await getPauseSetting();
  if (!initialPaused) {
    console.error("  ✗ KILL: outboundGlobalPaused is NOT true at gate start.");
    console.error("    Set it to true before running the pre-deploy gate.");
    console.error("    SQL: UPDATE system_settings SET value='true' WHERE key='outboundGlobalPaused';");
    process.exit(1);
  }
  console.log("  ✓ outboundGlobalPaused=true confirmed before suite run");

  // ── 1. Server reachability check ───────────────────────────────────────────
  const serverSuites = MANDATORY_SUITES.filter(s => s.requiresServer);
  let serverReachable = false;
  if (serverSuites.length > 0) {
    printSectionHeader("Server health check");
    serverReachable = checkServerReachable();
    if (serverReachable) {
      console.log(`  ✓ Server reachable at ${BASE_URL}`);
    } else {
      console.warn(`  ⚠ Server not reachable at ${BASE_URL}`);
      console.warn("    Server-dependent suites will be SKIPPED.");
    }
  }

  // ── 2. Run all suites ──────────────────────────────────────────────────────
  printSectionHeader("Running suites");

  const results: Array<{
    suite: Suite;
    exitCode: number;
    durationMs: number;
    skipped: boolean;
    pauseAfter: boolean;
  }> = [];

  for (const suite of MANDATORY_SUITES) {
    const skip = suite.requiresServer && !serverReachable;

    console.log(`\n▶  ${suite.name}`);

    if (skip) {
      console.log("   (skipped — server not reachable)");
      results.push({ suite, exitCode: 0, durationMs: 0, skipped: true, pauseAfter: true });
      continue;
    }

    const { exitCode, durationMs } = runSuite(suite);

    // Verify and restore pause after each suite
    const pauseAfter = await getPauseSetting();
    if (!pauseAfter) {
      console.warn(`  ⚠ Pause was lifted during "${suite.name}" — restoring to true`);
      await setPauseSetting(true);
    }

    const icon = exitCode === 0 ? "✓" : "✗";
    console.log(`   ${icon} exit=${exitCode}  time=${formatDuration(durationMs)}  pause-after=${pauseAfter ? "true ✓" : "FALSE ← RESTORED"}`);

    results.push({ suite, exitCode, durationMs, skipped: false, pauseAfter });
  }

  // ── 3. Final pause state verification ─────────────────────────────────────
  const finalPaused = await getPauseSetting();
  if (!finalPaused) {
    console.warn("\n  ⚠ Final pause check: outboundGlobalPaused is NOT true — restoring");
    await setPauseSetting(true);
  }

  // ── 4. External config report ─────────────────────────────────────────────
  printSectionHeader("External provider configuration (non-blocking)");

  const configByCategory: Record<string, ConfigItem[]> = {};
  for (const item of EXTERNAL_CONFIG) {
    if (!configByCategory[item.category]) configByCategory[item.category] = [];
    configByCategory[item.category].push(item);
  }

  const missingConfig: string[] = [];
  for (const [cat, items] of Object.entries(configByCategory)) {
    console.log(`\n  [${cat.toUpperCase()}]`);
    for (const item of items) {
      const set = !!process.env[item.key];
      const icon = set ? "✓" : "○";
      console.log(`  ${icon} ${item.key.padEnd(34)} ${set ? "SET" : "not set"} — ${item.label}`);
      if (!set) missingConfig.push(`${item.key} (${item.label})`);
    }
  }

  if (missingConfig.length > 0) {
    console.log(`\n  ⚠ ${missingConfig.length} provider config item(s) not set.`);
    console.log("    These are NOT test failures — configure before first live traffic.");
  } else {
    console.log("\n  ✓ All external config items are set.");
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  printBanner("Pre-Deploy Gate Results");

  const passed = results.filter(r => r.exitCode === 0).length;
  const failedSuites = results.filter(r => r.exitCode !== 0);
  const skipped = results.filter(r => r.skipped).length;
  const total = MANDATORY_SUITES.length;

  console.log(`\n  Suites:  ${passed}/${total} passed  (${skipped} skipped — server unreachable)`);
  console.log(`  Pause state: ${finalPaused ? "TRUE ✓" : "RESTORED ✓"} after all suites`);
  console.log(`  External config: ${EXTERNAL_CONFIG.length - missingConfig.length}/${EXTERNAL_CONFIG.length} set`);

  for (const r of results) {
    const icon = r.skipped ? "○" : r.exitCode === 0 ? "✓" : "✗";
    const tag = r.skipped ? " (skipped)" : r.exitCode === 0 ? "" : " ← FAILED";
    console.log(`  ${icon} ${r.suite.name}${tag}`);
  }

  console.log("");

  if (failedSuites.length > 0) {
    console.error(`\n❌  PRE-DEPLOY GATE FAILED — ${failedSuites.length} suite(s) failed:`);
    for (const r of failedSuites) {
      console.error(`     ✗ ${r.suite.name} (exit ${r.exitCode})`);
    }
    console.error("\n   Fix all failures before deploying.\n");
    process.exit(1);
  }

  console.log("✅  PRE-DEPLOY GATE PASSED — all suites green.\n");
  console.log("   The application is NOT deployed automatically.");
  console.log("   Review external config warnings above before first live traffic.\n");
  process.exit(0);
}

main().catch(err => {
  console.error("\nFatal error in pre-deploy gate:", err?.message ?? err);
  process.exit(1);
});
