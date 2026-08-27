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
 * ── SERVER REQUIREMENT ────────────────────────────────────────────────────────
 * Four suites (Role Guards, SEO Audit, Sequence Compliance, New-Lead Enrollment
 * Policy) connect to the dev server at localhost:5000 and CANNOT be skipped.
 * If the server is not reachable when this gate runs, those suites will cause a
 * hard failure (exit 1) rather than being silently skipped.
 *
 * Run the gate through the provided wrapper instead of calling this script
 * directly — the wrapper starts the server, waits for readiness, then runs the
 * gate and tears the server down on exit:
 *
 *   bash scripts/run-pre-deploy.sh
 *
 * Alternatively, start the dev server first and then run this script:
 *
 *   npm run dev &           # or use the "Start application" workflow
 *   npx tsx scripts/pre-deploy.ts
 *
 * Three suites (Chat Business Hours, AI Assistant Boundaries, Public Forms) are
 * also server-dependent but are skipped when the server is not in live mode —
 * they test provider integrations that require real credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The script never deploys. It only validates.
 */

import { spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
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
  /**
   * When true, the suite is silently skipped if the server is unreachable (e.g.
   * it tests live-mode provider integrations that need real credentials).
   * When false/absent and requiresServer is true, an unreachable server causes
   * a hard gate failure — the suite must not be silently skipped.
   */
  skipWhenServerDown?: boolean;
}

// Capability classification for all suites is in scripts/ci-suite-manifest.ts.
// That file classifies each suite as: deterministic-static, deterministic-integration,
// server-required, or server-optional. CI jobs must run only the deterministic classes.
// To verify the manifest: npx tsx scripts/ci-suite-manifest.ts --check
const MANDATORY_SUITES: Suite[] = [
  // ── Static / pure-function suites (no server required) ───────────────────
  {
    name: "Migration Integrity Check (journal consistency, unjournaled files, high-water enforcement)",
    script: "scripts/check-migration-integrity.ts",
    timeoutSecs: 60,
  },
  {
    name: "BT-12 Revenue State Reconciliation Authority Guard",
    script: "scripts/test-bt12-revenue-state-reconciliation.ts",
    timeoutSecs: 60,
  },
  {
    name: "Fresh Snapshot Completion Guard",
    script: "scripts/test-fresh-snapshot-completion.ts",
    timeoutSecs: 60,
  },
  {
    name: "BT-12 Revenue State Reconciliation Integration",
    script: "scripts/test-bt12-revenue-state-reconciliation-integration.ts",
    timeoutSecs: 120,
  },
  {
    name: "Canonical Identity Writer Guard (all production identity writers observed)",
    script: "scripts/check-contact-identity-writers.ts",
    timeoutSecs: 60,
  },
  {
    name: "Canonical Intake Authority (local-first contact, durable import, provider projection)",
    script: "scripts/test-canonical-intake-authority.ts",
    timeoutSecs: 60,
  },
  {
    name: "CSV Import Reconciliation (durable execution replay and ledger totals)",
    script: "scripts/test-import-reconciliation.ts",
    timeoutSecs: 180,
  },
  {
    name: "Canonical Merge Manifest Guard (complete relationship disposition)",
    script: "scripts/check-contact-merge-manifest.ts",
    timeoutSecs: 60,
  },
  {
    name: "Canonical Identity Merge Contract",
    script: "scripts/test-canonical-identity-merge.ts",
    env: { GHL_TRANSPORT_FAILFAST: "true" },
    timeoutSecs: 60,
  },
  {
    name: "CSRF Fetch Scanner (authenticated raw fetch() mutations must attach getCsrfToken())",
    script: "scripts/scan-csrf-fetch.ts",
    timeoutSecs: 60,
  },
  {
    name: "Tracked-File Exposure Scan (no backups/exports/dumps in git)",
    script: "scripts/scan-tracked-files.ts",
    timeoutSecs: 60,
  },
  {
    name: "CSP, CORS, JSON-LD Security Controls (source-backed CSP, typed CORS denial, safe structured data)",
    script: "scripts/test-security-controls.ts",
    timeoutSecs: 60,
  },
  {
    name: "Release Artifact Gate (typecheck, production build, redacting artifact secret scan)",
    script: "scripts/release-artifact-gate.ts",
    timeoutSecs: 300,
  },
  {
    name: "Merchant Migration Safety (dual-auth, no-value-logging, envelope inventory, restart-safe)",
    script: "scripts/test-merchant-migration-safety.ts",
    timeoutSecs: 60,
  },
  {
    name: "Compliance Scan (send-gate coverage)",
    script: "scripts/compliance-scan.ts",
    timeoutSecs: 120,
  },
  {
    name: "GHL Route Pause Gates (#1629: typed denial + per-call-site regression)",
    script: "scripts/test-ghl-route-pause-gates-1629.ts",
    timeoutSecs: 60,
  },
  {
    name: "Sender Policy (From/Reply-To/prohibited-sender)",
    script: "scripts/test-sender-policy.ts",
    timeoutSecs: 60,
  },
  {
    name: "Serper Raw-Fetch Scan (canonical gateway compliance)",
    script: "scripts/scan-serper-raw-fetch.ts",
    timeoutSecs: 60,
  },
  {
    name: "Paid Provider Adapter Scan (manifest-only provider URLs/imports)",
    script: "scripts/scan-paid-provider-adapters.ts",
    timeoutSecs: 60,
  },
  {
    name: "Provider Health and Readiness Kill Lines",
    script: "scripts/test-provider-readiness-controls.ts",
    timeoutSecs: 60,
  },
  {
    name: "Serper Gateway (circuit breaker / budget / rollover — fake transports)",
    script: "scripts/test-serper-gateway.ts",
    timeoutSecs: 120,
  },
  {
    name: "Sequence Compliance (114 cases: consent/DNC/cap/kill-switch/CAN-SPAM)",
    script: "scripts/test-sequence-compliance.ts",
    timeoutSecs: 120,
    requiresServer: true,
  },
  {
    name: "Sequence Terminalization Advisory-Lock Race",
    script: "scripts/test-sequence-terminalization-race.ts",
    timeoutSecs: 60,
  },
  {
    name: "Contactability Engine",
    script: "scripts/test-contactability.ts",
    timeoutSecs: 120,
  },
  {
    name: "Commercial Classification (unknown quarantine, approval, replay, evidence safety)",
    script: "scripts/test-commercial-classification.ts",
    timeoutSecs: 120,
  },
  {
    name: "New-Lead Enrollment Policy",
    script: "scripts/test-new-lead-enrollment-policy.ts",
    timeoutSecs: 120,
    requiresServer: true,
  },
  {
    name: "Intake Provenance",
    script: "scripts/test-intake-provenance.ts",
    timeoutSecs: 60,
  },
  {
    name: "Speed-to-Lead Pipeline (score → lifecycle → NBA → SLA timer within 60s)",
    script: "scripts/test-speed-to-lead.ts",
    timeoutSecs: 90,
  },
  {
    name: "Lifecycle State Machine (all transitions, prohibited moves, idempotency, history rows)",
    script: "scripts/test-lifecycle.ts",
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
    name: "GHL CRM Decoupling (shadow-mode gate, Liberty data integrity, no-op disabled mode)",
    script: "scripts/test-ghl-decoupling.ts",
    timeoutSecs: 60,
  },
  {
    name: "Appointment-to-Statement (positive call outcome auto-triggers statement request)",
    script: "scripts/test-appointment-statement.ts",
    timeoutSecs: 180,
  },
  {
    name: "BullMQ Resilience (retry/backoff/DLQ/operator-visibility)",
    script: "scripts/test-bullmq-resilience.ts",
    timeoutSecs: 60,
  },
  {
    name: "Queue Lease Fencing (stale takeover and telemetry isolation)",
    script: "scripts/test-stale-job-lock.ts",
    timeoutSecs: 60,
  },
  {
    name: "Statement Command Durability (missing upload, duplicate delivery, lease takeover)",
    script: "server/tests/statement-command-worker.test.ts",
    timeoutSecs: 60,
  },
  {
    name: "Redis Queue Topology (24-config ownership contract)",
    script: "scripts/test-redis-topology.ts",
    timeoutSecs: 60,
  },
  {
    name: "Sunbiz Timeout & Recovery (no real network)",
    script: "scripts/test-sunbiz-timeout.ts",
    timeoutSecs: 60,
  },
  {
    name: "Commercial Classification Static Gates (authority boundary, cleanup denial, public-schema protection)",
    script: "scripts/test-commercial-classification-static.ts",
    timeoutSecs: 60,
  },
  {
    name: "Commercial Cleanup Guard (destructive utility scripts refuse non-test databases)",
    script: "scripts/test-cleanup-guard.ts",
    timeoutSecs: 60,
  },
  {
    name: "CRO-01 Revenue Contract Static (canonical stages, cardinality, reconciliation, conversion authority)",
    script: "scripts/test-cro01-revenue-contract-static.ts",
    timeoutSecs: 60,
  },
  {
    name: "CRO-01 Revenue Contract Integration (disposable PostgreSQL aggregate semantics)",
    script: "scripts/test-cro01-revenue-contract-integration.ts",
    timeoutSecs: 60,
  },
  {
    name: "Role Guards",
    script: "scripts/smoke-role-guards.ts",
    timeoutSecs: 120,
    requiresServer: true,
  },
  {
    name: "CRM Operator Experience",
    script: "scripts/test-crm-operator-experience.ts",
    timeoutSecs: 60,
    requiresServer: true,
  },
  {
    name: "CRO-01 Provider/Staging Denial (isolated auth; no provider or queue effects)",
    script: "scripts/test-cro01-provider-denial.ts",
    timeoutSecs: 60,
    requiresServer: true,
  },
  {
    name: "API Coverage",
    script: "scripts/check-api-coverage.ts",
    timeoutSecs: 60,
  },
  {
    name: "Live Health Monitor (background workers + AI responding)",
    script: "scripts/test-live-health.ts",
    timeoutSecs: 120,
    requiresServer: true,
    // Requires live server + real credentials (OpenAI probe, DB, Redis).
    // Skipped when server is down so a cold-start env doesn't block the gate.
    skipWhenServerDown: true,
    env: { BASE_URL },
  },
  {
    name: "SEO Audit",
    script: "scripts/seo-audit.ts",
    timeoutSecs: 60,
    requiresServer: true,
  },
  {
    name: "Chat Business Hours (AI 24/7, human-handoff hours-gated)",
    script: "scripts/test-chat-business-hours.ts",
    timeoutSecs: 30,
    requiresServer: true,
    skipWhenServerDown: true, // tests live-mode handoff timing; skipped when server absent
  },
  {
    name: "Outbound Pause Fence (persisted DB rows, not code defaults, + control authority table)",
    script: "scripts/test-pause-fence.ts",
    timeoutSecs: 30,
  },
  {
    name: "Outbound Pause Authority (#1531: fail-closed semantics, epoch, atomicity, no skipGlobalPauseCheck)",
    script: "scripts/test-outbound-pause-authority.ts",
    timeoutSecs: 60,
  },
  {
    name: "Outbound Boundary Denial (#1626: form-sync/delete/SMTP pause denial, drain fail-closed, epoch interleaving, audit sanitizer)",
    script: "scripts/test-outbound-boundary-1626.ts",
    timeoutSecs: 60,
  },
  {
    name: "Email Signature Coverage (all 6 types, CAN-SPAM footer, sender policy, call-site checks)",
    script: "scripts/test-email-signatures.ts",
    timeoutSecs: 30,
  },
  {
    name: "Communication Arbitration (human-touch suppression, auto-send cooldown, skip flags)",
    script: "scripts/test-arbitration.ts",
    timeoutSecs: 60,
  },
  {
    name: "Statement Acquisition (STATEMENT_REQUESTED → enrollment → stop on upload → STATEMENT_ANALYZED)",
    script: "scripts/test-statement-acquisition.ts",
    timeoutSecs: 60,
  },
  {
    name: "Channel Orchestrator (Wave 1A: transport interfaces, global-pause fence, deal-stage authority guard)",
    script: "scripts/test-channel-orchestrator.ts",
    timeoutSecs: 60,
  },
  {
    name: "NBA Engine (Wave 1B: 12 cases — lifecycle→action, DNC, pause, sequence collision, execute/dismiss, history, priority queue)",
    script: "scripts/test-nba.ts",
    timeoutSecs: 90,
  },
  // ── Server-required suites (skipped when server absent; need live credentials) ─
  {
    name: "AI Assistant Boundaries (auth/role/schema/no-action)",
    script: "scripts/test-ai-assistant-boundaries.ts",
    env: { BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
    skipWhenServerDown: true, // tests live AI provider responses; skipped when server absent
  },
  {
    name: "Public Forms (GHL isolated via fail-fast test transport)",
    script: "scripts/test-forms.ts",
    // C-03 (#1626): GHL isolation is enforced by the server-level fail-fast
    // transport (GHL_TRANSPORT_FAILFAST, installed by run-pre-deploy.sh) and
    // VERIFIED by test-forms.ts against /api/health — no acknowledgment flag.
    env: { BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
    skipWhenServerDown: true, // tests GHL-isolated form submission; skipped when server absent
  },
  // ── #1320 — Portfolio scoping smoke (ownership boundaries, hostile ?owner= override) ──
  {
    name: "Portfolio Scoping (agent sees only own merchants; admin sees all)",
    script: "scripts/smoke-portfolio.ts",
    env: { BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
    skipWhenServerDown: true,
  },
  // ── #1297 — Go-Live gate smoke (422 gate + admin override path) ──────────────
  {
    name: "Go-Live Gate (422 on missing MID/checklist; admin override writes audit log)",
    script: "scripts/smoke-golive-gate.ts",
    env: { BASE_URL },
    timeoutSecs: 120,
    requiresServer: true,
    skipWhenServerDown: true,
  },
  // ── #1338 — Attrition monitor cooldown (30-day per-merchant suppression) ─────
  {
    name: "Attrition Monitor Cooldown (30-day per-merchant, per-type suppression)",
    script: "scripts/smoke-attrition-cooldown.ts",
    timeoutSecs: 60,
  },
  // ── #1552 — Backlog preview (per-source envelopes, step-index mapping, schema_missing) ──
  {
    name: "Backlog Preview (per-source envelopes, next_action_at, schema_missing, non-additive)",
    script: "scripts/test-backlog-preview.ts",
    timeoutSecs: 60,
  },
];

// ── External config items — non-blocking, reported separately ─────────────────

interface ConfigItem {
  key: string;
  label: string;
  category: string;
  /** Alternative env var whose presence satisfies this requirement (e.g. Replit integration key). */
  satisfiedByEnv?: string;
  /** When this env var is set, the item is optional (not a gap) — shown as covered, not missing. */
  optionalWhenEnv?: string;
  /** Note displayed when optionalWhenEnv is present. */
  optionalNote?: string;
}

const EXTERNAL_CONFIG: ConfigItem[] = [
  // Email / transport
  { key: "GOOGLE_CLIENT_ID",     label: "Gmail OAuth client ID (staff transactional sends)",   category: "email" },
  { key: "GOOGLE_CLIENT_SECRET", label: "Gmail OAuth client secret",                            category: "email" },
  // SMTP is the cold-email fallback when GHL is the primary transport.
  // When GHL_PRIVATE_INTEGRATION_TOKEN is set, SMTP items are optional — not gaps.
  { key: "SMTP_HOST",            label: "SMTP host (cold-email fallback; optional when GHL configured)",  category: "email",
    optionalWhenEnv: "GHL_PRIVATE_INTEGRATION_TOKEN", optionalNote: "GHL is primary cold-email transport" },
  { key: "SMTP_USER",            label: "SMTP username (optional when GHL configured)",         category: "email",
    optionalWhenEnv: "GHL_PRIVATE_INTEGRATION_TOKEN", optionalNote: "GHL is primary cold-email transport" },
  { key: "SMTP_PASS",            label: "SMTP password (optional when GHL configured)",         category: "email",
    optionalWhenEnv: "GHL_PRIVATE_INTEGRATION_TOKEN", optionalNote: "GHL is primary cold-email transport" },
  // GHL
  { key: "GHL_PRIVATE_INTEGRATION_TOKEN", label: "GHL Private Integration Token",              category: "ghl" },
  { key: "GHL_LOCATION_ID",               label: "GHL location ID",                            category: "ghl" },
  { key: "GHL_WEBHOOK_SECRET",            label: "GHL webhook signing secret",                 category: "ghl" },
  // OpenAI — Replit AI integration (AI_INTEGRATIONS_OPENAI_API_KEY) satisfies this requirement.
  { key: "OPENAI_API_KEY",       label: "OpenAI API key",                                      category: "openai",
    satisfiedByEnv: "AI_INTEGRATIONS_OPENAI_API_KEY" },
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
  // ── RELEASE_SHA assertion — must pass before any other gate work ─────────────
  // RELEASE_SHA must identify the exact checked-out revision that these gates
  // test. A syntactically valid but unrelated SHA would make post-deploy health
  // verification meaningless, so bind it to `git rev-parse HEAD` first.
  const SHA_PATTERN = /^[0-9a-f]{40}$/i;
  const releaseSha = process.env.RELEASE_SHA ?? "";
  if (!SHA_PATTERN.test(releaseSha)) {
    console.error("╔══════════════════════════════════════════════════════════════╗");
    console.error("║  KILL: RELEASE_SHA assertion failed                          ║");
    console.error("╚══════════════════════════════════════════════════════════════╝");
    console.error("");
    console.error("  RELEASE_SHA must be a 40-character hex SHA (e.g. git rev-parse HEAD).");
    console.error("  Set it in the deployment environment before running the pre-deploy gate.");
    console.error("");
    console.error("  Example:");
    console.error("    RELEASE_SHA=$(git rev-parse HEAD) bash scripts/run-pre-deploy.sh");
    console.error("");
    console.error(`  Current value: ${releaseSha ? JSON.stringify(releaseSha) : "(not set)"}`);
    process.exit(1);
  }
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const checkedOutSha = gitHead.status === 0 ? gitHead.stdout.trim() : "";
  if (!SHA_PATTERN.test(checkedOutSha) || checkedOutSha.toLowerCase() !== releaseSha.toLowerCase()) {
    console.error("╔══════════════════════════════════════════════════════════════╗");
    console.error("║  KILL: RELEASE_SHA does not match the tested checkout        ║");
    console.error("╚══════════════════════════════════════════════════════════════╝");
    console.error("  Set RELEASE_SHA to the current checked-out SHA before release validation.");
    console.error("  Example: RELEASE_SHA=$(git rev-parse HEAD) bash scripts/run-pre-deploy.sh");
    process.exit(1);
  }
  console.log(`\n  ✓ RELEASE_SHA matches checked-out tested commit: ${releaseSha}`);

  // ── MERCHANT_DATA_ENCRYPTION_KEY assertion (production release gate) ──────
  // Required for production release: the merchant key must be present and valid.
  // Dev builds do NOT require this key — only the pre-deploy gate enforces it.
  // The key value is NEVER printed.
  const merchantKey = process.env.MERCHANT_DATA_ENCRYPTION_KEY ?? "";
  const isMerchantKeyValid =
    /^[0-9a-fA-F]{64}$/.test(merchantKey.trim()) ||
    Buffer.from(merchantKey.trim(), "base64").length === 32;
  if (!merchantKey || !isMerchantKeyValid) {
    console.error("╔══════════════════════════════════════════════════════════════╗");
    console.error("║  KILL: MERCHANT_DATA_ENCRYPTION_KEY assertion failed         ║");
    console.error("╚══════════════════════════════════════════════════════════════╝");
    console.error("");
    console.error("  MERCHANT_DATA_ENCRYPTION_KEY must be a valid 32-byte key:");
    console.error("    • 64-character hex string, OR");
    console.error("    • 44-character base64 string");
    console.error("");
    console.error("  This key is required to encrypt/decrypt merchant protected data");
    console.error("  (EIN, SSN, DOB, bank routing/account numbers).");
    console.error("");
    console.error("  Add it to Secrets and restart before running the pre-deploy gate.");
    console.error("  See docs/merchant-data-key-rotation.md for key generation and");
    console.error("  rotation procedures.");
    console.error("");
    console.error(`  Current status: ${merchantKey ? "SET but invalid format" : "NOT SET"}`);
    // Note: key value is never printed.
    process.exit(1);
  }
  console.log("  ✓ MERCHANT_DATA_ENCRYPTION_KEY present and valid (value not printed)");

  printBanner("Liberty Bancard — Pre-Deploy Launch Gate");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Suites: ${MANDATORY_SUITES.length} mandatory`);
  console.log("\n  ⚠  This gate makes NO real provider calls.");
  console.log("  ⚠  Global outbound pause is verified before and after every suite.\n");

  // ── 0. Initial pause state verification & channel pause seeding ───────────
  printSectionHeader("Pre-flight: outbound pause state");

  // Seed all channel pause keys (fail-closed). Mirrors the startup seeder in
  // server/index.ts so the pre-deploy gate doesn't require a server restart
  // before the test-pause-fence suite can verify persisted rows.
  const CHANNEL_PAUSE_KEYS = [
    "outboundGlobalPaused",
    "emailChannelPaused",
    "smsChannelPaused",
    "coldEmailChannelPaused",
  ] as const;

  for (const key of CHANNEL_PAUSE_KEYS) {
    try {
      const existing = await db.select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);
      // Always ensure the key is present and set to true before running suites.
      // If missing → insert; if already true → no-op via onConflict; if false → update to true.
      await db.insert(systemSettings)
        .values({ key, value: "true" })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: "true" } });
      if (!existing[0]) {
        console.log(`  [seed] ${key}=true seeded (fail-closed default)`);
      } else if (existing[0].value !== "true" && existing[0].value !== true) {
        console.log(`  [seed] ${key} was ${JSON.stringify(existing[0].value)} — restored to true for gate`);
      }
    } catch (err: any) {
      console.warn(`  [seed] Could not seed ${key}: ${err?.message}`);
    }
  }

  const initialPaused = await getPauseSetting();
  if (!initialPaused) {
    console.error("  ✗ KILL: outboundGlobalPaused is NOT true at gate start.");
    console.error("    Set it to true before running the pre-deploy gate.");
    console.error("    SQL: UPDATE system_settings SET value='true' WHERE key='outboundGlobalPaused';");
    process.exit(1);
  }
  console.log("  ✓ outboundGlobalPaused=true confirmed before suite run");

  // ── 0b. Static scan: global-pause gates in outbound workers ───────────────
  // Task #1377 — Dynamic discovery: instead of a fixed list of 3 worker
  // files, we scan ALL TypeScript files under server/services/ (and
  // server/routes/) that contain at least one outbound send call.
  // Any file that sends without the normalised outboundGlobalPaused check
  // automatically fails the gate, even if it was added after this script.
  //
  // EXEMPTIONS:
  //   • Files in the PAUSE_CHECK_EXEMPTIONS set are deliberate bypasses:
  //     transport adapters, recovery paths, admin test routes, unsubscribe
  //     handlers, and inbound webhook acknowledgements.  Add new exemptions
  //     here with a one-line justification comment — DO NOT add exemptions
  //     silently.
  //   • Pattern: normalized comparison required (=== true | === "true" etc.)
  //     A bare `if (raw)` truthy test treats the string "false" as paused.

  printSectionHeader("Static scan: outboundGlobalPaused in all outbound workers");

  // Outbound send call tokens — same set used by compliance-scan.ts.
  const OUTBOUND_SEND_TOKENS = [
    "sendGhlSms",
    "sendSmsReply",
    "unifiedSendSms",
    "triggerAiCall",
    "enrollContactInGhlWorkflow",
    "triggerWorkflow",
    "sendGhlEmail",
    "sendGhlEmailForMerchant",
    "sendSmtpEmail",
    "sendEmailReply",
    "unifiedSendEmail",
    "enrollInGhlWorkflow(",         // direct enrollment (not compliant wrapper)
    "enrollInGhlWorkflowCompliant(",
  ];

  // Files that intentionally bypass the global pause gate — each entry
  // must carry a justification.
  const PAUSE_CHECK_EXEMPTIONS = new Set<string>([
    // ── Transport adapters — raw send API wrappers; callers own the gate ─────
    "server/services/transports/ghl-email-transport.ts",
    "server/services/transports/ghl-sms-transport.ts",
    "server/services/transports/ghl-rvm-transport.ts",
    "server/services/transports/index.ts",        // ChannelOrchestrator — gate is applied by callers
    "server/services/transports/sms-transport.ts",
    "server/services/transports/email-transport.ts",
    "server/services/smtp-email.ts",              // Raw SMTP transport; callers gate
    // ── GHL CRM utilities — sync, enrollment API wrappers, not marketing sends ─
    "server/services/ghl.ts",                     // Unsubscribe handler + inbound webhook ack
    "server/services/ghl-enrollment-recovery.ts", // Recovery path — intentional bypass
    "server/services/ghl-sync.ts",                // CRM field sync, not marketing
    "server/services/ghl-form-sync.ts",           // Form sync utility
    "server/services/ghl-workflow-enrollment.ts", // Low-level enrollment wrapper
    // ── Compliance / contactability — gating layer itself ────────────────────
    "server/services/contactability.ts",
    // ── Campaign engine — gated via evaluateContactability() which checks global pause ──
    "server/services/campaign-engine.ts",
    // ── Transactional notification services — not marketing automation ───────
    "server/services/co-branded-proposal.ts",     // Proposal delivery (accounts/transactional)
    "server/services/merchant-application-status.ts",
    "server/services/merchant-portal-invite.ts",
    "server/services/merchant-welcome.ts",        // Onboarding welcome (triggered by rep action)
    "server/services/partner-notifications.ts",   // Partner alerts (transactional)
    "server/services/partner-welcome.ts",
    "server/services/nps-email.ts",               // NPS survey (lifecycle, not cold outreach)
    "server/services/pipeline-silence-check.ts",  // Internal rep alert, not contact-facing
    "server/services/statement-analyzer.ts",      // Analysis utility — no contact-facing sends
    "server/services/statement-upload-chain.ts",  // Statement processing — transactional
    "server/services/sla-worker.ts",              // SLA escalation — internal alerts to reps
    "server/services/workflow-executor.ts",       // Workflow runner — pause gate in orchestration
    // ── Digest / reporting — internal sends only ─────────────────────────────
    "server/services/digest-service.ts",
    "server/services/weekly-digest.ts",
    // ── Serper gateway — has its own enabled/disabled gate that fires before any provider call ──
    "server/services/serper-gateway.ts",   // enable flag at line 203 is structurally equivalent to the global pause gate
    // ── SDR utilities — called from the SDR orchestrator which owns the gate ─
    "server/services/sdr/chat-handlers.ts",
    "server/services/sdr/ghl-client.ts",
    "server/services/sdr/operator-digest.ts",
    "server/services/sdr/reply-intelligence.ts",
    "server/services/sdr/scheduling.ts",          // Scheduling helper — gate in orchestrator
    "server/services/sdr/statement-flow.ts",
    "server/services/sdr/terminal-shipping.ts",   // Terminal order — transactional
    "server/services/sdr/voice-orchestrator.ts",  // Voice AI — own gate mechanism
    // ── Inbound webhook / reply handlers ─────────────────────────────────────
    "server/routes/sdr.ts",
    "server/routes/ghl.ts",
    // ── All route files — HTTP request handlers are human-initiated, not automated workers ──
    // The global pause gate applies to scheduled/queue workers, not per-request routes.
    // Routes that call enrollInGhlWorkflowCompliant already go through the compliance wrapper.
    "server/routes/acquisition.ts", "server/routes/activation.ts", "server/routes/activity.ts",
    "server/routes/admin.ts", "server/routes/ai.ts", "server/routes/analytics.ts",
    "server/routes/boarding.ts", "server/routes/campaigns.ts", "server/routes/chargebacks.ts",
    "server/routes/chat-assistant.ts", "server/routes/churn.ts", "server/routes/contacts.ts",
    "server/routes/content.ts", "server/routes/conversation-ai-config.ts",
    "server/routes/crm-operations.ts", "server/routes/deals.ts", "server/routes/documents.ts",
    "server/routes/executive.ts", "server/routes/glossary.ts", "server/routes/gmail-oauth.ts",
    "server/routes/helpers.ts", "server/routes/imports.ts", "server/routes/inbox-ownership.ts",
    "server/routes/inbox.ts", "server/routes/information-flow.ts", "server/routes/integrations.ts",
    "server/routes/knowledge-admin.ts", "server/routes/lifecycle.ts", "server/routes/live-chat.ts",
    "server/routes/merchant-portal-invite.ts", "server/routes/merchants.ts",
    "server/routes/my-day.ts", "server/routes/nba.ts", "server/routes/notifications.ts",
    "server/routes/og.ts", "server/routes/onboarding-stages.ts", "server/routes/partner-orgs.ts",
    "server/routes/partners.ts", "server/routes/permissions-audit.ts", "server/routes/portfolio.ts",
    "server/routes/prospects.ts", "server/routes/public.ts", "server/routes/push.ts",
    "server/routes/queue-metrics.ts", "server/routes/rate-review.ts",
    "server/routes/registry-import.ts", "server/routes/relationships.ts",
    "server/routes/residuals.ts", "server/routes/review-queue.ts", "server/routes/savings.ts",
    "server/routes/sdr.ts", "server/routes/search.ts", "server/routes/seo-admin.ts",
    "server/routes/social.ts", "server/routes/ssr-routes.ts",
    "server/routes/statement-review.ts", "server/routes/system-audit.ts",
    "server/routes/templates-settings.ts", "server/routes/terminal-economics.ts",
    "server/routes/tickets-tasks.ts", "server/routes/toolkit.ts", "server/routes/training.ts",
    "server/routes/underwriting.ts", "server/routes/virtual-terminal.ts",
    "server/routes/widget.ts", "server/routes/wizard.ts", "server/routes/workflows.ts",
    "server/routes/ghl.ts",
    // ── SDR sub-services — outbound gated by the SDR orchestrator ─────────────
    "server/services/sdr/ghl-sync-rules.ts",
    "server/services/sdr/proposal-tracking.ts",
    "server/services/sdr/webhook-handlers.ts",    // Inbound webhook processing, not marketing
    // ── Proposal / transactional services ─────────────────────────────────────
    "server/services/proposal-engine.ts",         // Transactional proposal delivery (accounts)
    "server/services/daily-outreach.ts",          // Legacy daily-outreach (replaced by orchestrator)
    // ── Reply / unsubscribe handlers ─────────────────────────────────────────
    "server/services/email-reply-handler.ts",
    "server/services/sms-reply-handler.ts",
  ]);

  // Matches the legacy normalized comparison OR a canonical authorize()/canExecute() call.
  // The authority/coordinator pattern: `await authorize(` or `await canExecute(` in non-comment
  // source is sufficient evidence that the pause gate is applied correctly.
  const NORMALIZED_PAUSE_PATTERN =
    /=== true|=== "true"|=== 'true'|await authorize\s*\(|await canExecute\s*\(/;

  // Strip single-line (//) and block (/* */) TypeScript/JS comments so that
  // commented-out code, log messages, and import-path strings inside comments
  // cannot satisfy the gate detectors.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, " ")  // block comments
      .replace(/\/\/[^\n]*/g, "");         // line comments
  }

  // Discover all .ts files under server/services/ and server/routes/
  function walkDir(dir: string, files: string[] = []): string[] {
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        walkDir(full, files);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        files.push(full);
      }
    }
    return files;
  }

  const candidateFiles = [
    ...walkDir("server/services"),
    ...walkDir("server/routes"),
  ];

  // Files that contain at least one outbound send token
  const outboundFiles: string[] = [];
  for (const filePath of candidateFiles) {
    const relPath = filePath.replace(/^\.\//, "");
    if (PAUSE_CHECK_EXEMPTIONS.has(relPath)) continue;
    let src: string;
    try {
      src = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const stripped = stripComments(src);
    const hasSend = OUTBOUND_SEND_TOKENS.some(t => stripped.includes(t));
    if (hasSend) outboundFiles.push(filePath);
  }

  // Assess each outbound file
  let staticScanFailed = false;
  const pausedFiles: string[] = [];
  const missingPause: string[] = [];
  const missingNorm: string[] = [];

  for (const filePath of outboundFiles) {
    const src = readFileSync(filePath, "utf8");
    const stripped = stripComments(src);
    // hasKey: legacy outboundGlobalPaused key, or canonical authority import, or coordinator call.
    // All three are checked on comment-stripped source so that commented-out code and
    // log messages cannot satisfy the detector.
    const hasKey =
      stripped.includes("outboundGlobalPaused") ||
      stripped.includes("outbound-pause-authority") ||
      /\bcanExecute\s*\(/.test(stripped);
    const hasNorm = NORMALIZED_PAUSE_PATTERN.test(stripped);
    const label = filePath.replace("server/", "");

    if (!hasKey) {
      missingPause.push(label);
      staticScanFailed = true;
    } else if (!hasNorm) {
      missingNorm.push(label);
      staticScanFailed = true;
    } else {
      pausedFiles.push(label);
    }
  }

  for (const f of pausedFiles) {
    console.log(`  ✓ ${f} — pause gate confirmed (outboundGlobalPaused or OutboundPauseAuthority/coordinator)`);
  }
  for (const f of missingPause) {
    console.error(`  ✗ KILL: ${f} — no pause gate found (neither outboundGlobalPaused nor OutboundPauseAuthority.authorize / coordinator.canExecute)`);
    console.error(`    Legacy:    const paused = await storage.getSystemSetting("outboundGlobalPaused"); if (paused === true || paused === "true") return;`);
    console.error(`    Canonical: const { authorize } = await import("./outbound-pause-authority"); const decision = await authorize({}); if (!decision.allowed) return;`);
  }
  for (const f of missingNorm) {
    console.error(`  ✗ KILL: ${f} — outboundGlobalPaused found but normalized comparison (=== true | === "true") MISSING`);
    console.error(`    Use: raw === true || raw === "true"  (not bare if (raw) which treats "false" as paused).`);
    console.error(`    Or upgrade to canonical: const { authorize } = await import("./outbound-pause-authority"); const decision = await authorize({}); if (!decision.allowed) return;`);
  }

  if (staticScanFailed) {
    console.error(
      `\n  ✗ KILL: ${missingPause.length + missingNorm.length} outbound file(s) missing the global-pause gate.` +
      `\n    To exempt a file (transport adapters, recovery paths, admin test routes), add it to` +
      `\n    PAUSE_CHECK_EXEMPTIONS in scripts/pre-deploy.ts with a one-line justification.\n`
    );
    process.exit(1);
  }
  console.log(
    `  ✓ All ${pausedFiles.length} discovered outbound file(s) have a recognised pause gate` +
    ` (${PAUSE_CHECK_EXEMPTIONS.size} files explicitly exempted)`
  );

  // ── 1. Server reachability check ───────────────────────────────────────────
  // Suites with requiresServer:true but skipWhenServerDown:false MUST run —
  // an unreachable server is a hard gate failure, not a silent skip.
  const serverSuites = MANDATORY_SUITES.filter(s => s.requiresServer);
  const mandatoryServerSuites = serverSuites.filter(s => !s.skipWhenServerDown);
  let serverReachable = false;
  if (serverSuites.length > 0) {
    printSectionHeader("Server health check");
    serverReachable = checkServerReachable();
    if (serverReachable) {
      console.log(`  ✓ Server reachable at ${BASE_URL}`);
    } else {
      console.warn(`  ⚠ Server not reachable at ${BASE_URL}`);
      if (mandatoryServerSuites.length > 0) {
        console.error("\n  ✗ KILL: The following suites REQUIRE a running server and cannot be skipped:");
        for (const s of mandatoryServerSuites) {
          console.error(`      • ${s.name}`);
        }
        console.error("\n  Start the dev server before running this gate, or use the wrapper:");
        console.error("    bash scripts/run-pre-deploy.sh");
        console.error("  See the header comment in scripts/pre-deploy.ts for details.\n");
        process.exit(1);
      }
      console.warn("    Remaining server-dependent suites (live-mode only) will be SKIPPED.");
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
    // Only suites explicitly marked skipWhenServerDown may be skipped when the
    // server is absent.  Suites without that flag that require a server have
    // already caused a hard exit above, so this path is only reached for the
    // soft-skip candidates.
    const skip = suite.requiresServer && !serverReachable && !!suite.skipWhenServerDown;

    console.log(`\n▶  ${suite.name}`);

    if (skip) {
      console.log("   (skipped — server not reachable; live-mode suite)");
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

  // ── 4. Opt-in: Isolated Pause State-Machine test ─────────────────────────
  // This test mutates an isolated test namespace and requires TEST_DATABASE_URL,
  // TEST_REDIS_PREFIX, and NODE_ENV=test to be set by the caller.
  //
  // IMPORTANT: scripts/run-pre-deploy.sh must NOT set INTEGRATION_TESTS_OPT_IN.
  // This test is NEVER executed in ordinary CI without explicit operator action.
  //
  // Kill lines enforced by the test itself:
  //   - Refuses to run unless all four isolation guards are set
  //   - Provider fakes throw on any accidental outbound call
  //   - Cleanup leaves test namespace paused (not shared) on failure
  if (process.env.INTEGRATION_TESTS_OPT_IN === "1") {
    printSectionHeader("Opt-in: Isolated Pause State-Machine test (#1548B)");
    console.log("  INTEGRATION_TESTS_OPT_IN=1 detected — running isolated pause cycle unit test");
    console.log("  ⚠  This test uses TEST_DATABASE_URL and TEST_REDIS_PREFIX (isolated namespace).");
    console.log("  ⚠  It does NOT touch the shared development database or pause state.\n");

    const isolatedResult = spawnSync(
      "npx",
      ["tsx", "scripts/test-pause-cycle-unit.ts"],
      {
        env: { ...process.env },
        stdio: "inherit",
        encoding: "utf8",
        timeout: 120 * 1000,
      },
    );

    if ((isolatedResult.status ?? 1) !== 0) {
      console.error("\n  ✗ KILL: Isolated Pause State-Machine test FAILED");
      console.error("    Review the output above. Fix the state-machine regression before deploying.");
      process.exit(1);
    }
    console.log("\n  ✓ Isolated Pause State-Machine test passed");
  } else {
    console.log("\n▶  Isolated Pause State-Machine test (opt-in)");
    console.log("   SKIPPED — INTEGRATION_TESTS_OPT_IN is not set.");
    console.log("   To run: set NODE_ENV=test TEST_DATABASE_URL=<test-db> TEST_REDIS_PREFIX=<prefix>");
    console.log("           INTEGRATION_TESTS_OPT_IN=1 npx tsx scripts/pre-deploy.ts");
  }

  // ── 5. External config report ─────────────────────────────────────────────
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
      // Alternative env var (e.g. Replit integration key) satisfies the requirement
      const satisfiedByAlt = !set && item.satisfiedByEnv && !!process.env[item.satisfiedByEnv];
      // Item is optional when a gating env var is present (e.g. GHL configured → SMTP optional)
      const coveredByPrimary = !set && !satisfiedByAlt && item.optionalWhenEnv && !!process.env[item.optionalWhenEnv];

      let icon: string;
      let status: string;

      if (set) {
        icon = "✓"; status = "SET";
      } else if (satisfiedByAlt) {
        icon = "✓"; status = `SET via ${item.satisfiedByEnv}`;
      } else if (coveredByPrimary) {
        icon = "◌"; status = `optional — ${item.optionalNote ?? item.optionalWhenEnv + " is configured"}`;
      } else {
        icon = "○"; status = "not set";
        missingConfig.push(`${item.key} (${item.label})`);
      }
      console.log(`  ${icon} ${item.key.padEnd(34)} ${status} — ${item.label}`);
    }
  }

  if (missingConfig.length > 0) {
    console.log(`\n  ⚠ ${missingConfig.length} provider config item(s) not set.`);
    console.log("    These are NOT test failures — configure before first live traffic.");
  } else {
    console.log("\n  ✓ All required external config items are set or covered.");
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  printBanner("Pre-Deploy Gate Results");

  const passed = results.filter(r => r.exitCode === 0).length;
  const failedSuites = results.filter(r => r.exitCode !== 0);
  const skipped = results.filter(r => r.skipped).length;
  const total = MANDATORY_SUITES.length;

  console.log(`\n  Suites:  ${passed}/${total} passed  (${skipped} skipped — live-mode server suites)`);
  console.log(`  Pause state: ${finalPaused ? "TRUE ✓" : "RESTORED ✓"} after all suites`);
  console.log(`  External config: ${EXTERNAL_CONFIG.length - missingConfig.length}/${EXTERNAL_CONFIG.length} set`);

  for (const r of results) {
    const icon = r.skipped ? "○" : r.exitCode === 0 ? "✓" : "✗";
    const tag = r.skipped ? " (skipped)" : r.exitCode === 0 ? "" : " ← FAILED";
    console.log(`  ${icon} ${r.suite.name}${tag}`);
  }

  console.log("");

  // ── 6. Persist gate result to system_settings ─────────────────────────────
  const gateResult = {
    ranAt: new Date().toISOString(),
    passed: failedSuites.length === 0,
    passedCount: passed,
    totalCount: total,
    skippedCount: skipped,
    suites: results.map(r => ({
      name: r.suite.name,
      passed: r.exitCode === 0,
      skipped: r.skipped,
      durationMs: r.durationMs,
    })),
  };
  try {
    const { systemSettings } = await import("@shared/schema");
    await db.insert(systemSettings)
      .values({ key: "pre_deploy_last_result", value: gateResult as any })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: gateResult as any, updatedAt: new Date() },
      });
    console.log("  ✓ Gate result written to system_settings.pre_deploy_last_result");
  } catch (persistErr: any) {
    console.warn(`  ⚠ Could not persist gate result: ${persistErr?.message}`);
  }

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
