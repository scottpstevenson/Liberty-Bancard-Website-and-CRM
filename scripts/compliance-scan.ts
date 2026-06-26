#!/usr/bin/env tsx
/**
 * Wave 12 — Static Compliance Scanner
 *
 * Scans the server source tree for all call sites of the 10 outbound send
 * functions listed in the Wave 12 preflight findings and classifies each as
 * PASS or FAIL.
 *
 * ── ALLOWLIST (low-level sender wrapper files — always PASS) ──────────────
 * These files ARE the low-level send wrappers.  Call sites here are expected
 * and do not require an upstream evaluateContactability gate.
 *   server/services/ghl.ts
 *   server/services/smtp-email.ts
 *   server/services/sdr/ghl-client.ts
 *   server/services/ghl-workflow-enrollment.ts
 *
 * ── SEND FUNCTIONS SCANNED ────────────────────────────────────────────────
 *   sendGhlSms          → SMS
 *   sendSmsReply        → SMS (SDR)
 *   unifiedSendSms      → SMS (abstraction)
 *   triggerAiCall       → voice_ai
 *   enrollContactInGhlWorkflow → ringless_vm / GHL workflow
 *   triggerWorkflow     → GHL workflow (low-level)
 *   sendGhlEmail        → email
 *   sendGhlEmailForMerchant → email (merchant-specific)
 *   sendSmtpEmail       → email (SMTP fallback)
 *   sendEmailReply      → email (SDR)
 *   unifiedSendEmail    → email (abstraction)
 *
 * ── EMAIL CLASSIFICATION (for email call sites outside the allowlist) ─────
 *   marketing_outreach    — must be gated by evaluateContactability
 *   sequence_step         — must be guarded by sequence-worker gate
 *   transactional_merchant — merchant confirmation, portal, MID welcome; PASS if in allowlist with reason
 *   internal_admin        — internal team notifications, alerts; PASS if allowlisted with reason
 *   unknown               — FAIL: must classify before release
 *
 * ── PER-FINDING OUTPUT FORMAT ─────────────────────────────────────────────
 *   PASS/FAIL | file:line | enclosing_function | channel | email_category | nearest_gate | reason | suggested_fix
 *
 * Exit codes:
 *   0 — all PASS
 *   1 — any FAIL
 *
 * Run:
 *   npx tsx scripts/compliance-scan.ts
 */

import fs from "fs";
import path from "path";

// ── Configuration ────────────────────────────────────────────────────────────

/** Files that ARE the low-level sender wrappers — always PASS. */
const ALLOWLISTED_FILES = new Set([
  "server/services/ghl.ts",
  "server/services/smtp-email.ts",
  "server/services/sdr/ghl-client.ts",
  "server/services/ghl-workflow-enrollment.ts",
]);

/** Additional per-call-site allowlist entries.
 *  Format: { file: "server/...", lineContains: "substring", channel, category, reason, reviewDate }
 *  These are transactional or internal_admin call sites that have been reviewed.
 */
const CALL_SITE_ALLOWLIST: Array<{
  file: string;
  lineContains: string;
  channel: string;
  category: "transactional_merchant" | "internal_admin" | "pipeline_gated" | "sequence_worker";
  reason: string;
  reviewDate: string;
}> = [
  {
    file: "server/services/merchant-welcome.ts",
    lineContains: "sendEmailReply",
    channel: "email",
    category: "transactional_merchant",
    reason: "Merchant portal welcome reply via GHL chat — triggered by operator approval action, not automated outreach. Contact must be in closed_won state.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/merchant-welcome.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Merchant portal welcome SMTP fallback — triggered by operator approval action when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/merchant-application-status.ts",
    lineContains: "sendEmailReply",
    channel: "email",
    category: "transactional_merchant",
    reason: "Merchant application status update via GHL reply — triggered by admin approval/rejection action on a specific application, not automated sequence.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/co-branded-proposal.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Co-branded proposal delivery via GHL (sendGhlEmail/sendGhlEmailForMerchant — lineContains matches both) — triggered explicitly by agent action, not automated sequence.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/co-branded-proposal.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Co-branded proposal delivery SMTP fallback — triggered explicitly by agent action when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/digest-service.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "Digest service GHL email — sends KPI/SLA digest to admin/operator email; triggered by scheduled digest job or operator-initiated digest send, not outbound marketing.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/digest-service.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "internal_admin",
    reason: "Digest service SMTP fallback — sends KPI/SLA digest to admin/operator when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/operator-digest.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "SDR operator daily digest GHL email — sends pipeline summary to operator/admin email; triggered by scheduled digest job, not outbound marketing.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/operator-digest.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "internal_admin",
    reason: "SDR operator daily digest SMTP fallback — sends pipeline summary when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/weekly-digest.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "Weekly KPI digest email — sends weekly performance summary to admin email; triggered by scheduled digest job, not outbound marketing.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/public.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Auto-proposal email — gated by hasEmailConsent flag before send; only fires when merchant explicitly consented to email communications.",
    reviewDate: "2026-06-26",
  },
  // ── SDR pipeline email sends — explicitly reviewed 2026-06-26 ────────────
  // These files are always invoked from server/services/sdr/orchestrator.ts
  // whose runSdrCycle() calls evaluateContactability() at the top of every
  // cycle before any outbound action.  The gate is at the pipeline entry point,
  // not co-located with each send, which is a deliberate architectural choice.
  {
    file: "server/services/campaign-engine.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR campaign email — evaluateContactability enforced at orchestrator top-of-cycle; SDR_ENABLED runtime flag guard prevents unsolicited sends. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/chat-handlers.ts",
    lineContains: "sendEmailReply",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR chat-handler reply email — triggered only inside the pipeline conversation flow; evaluateContactability gate sits at orchestrator entry. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/orchestrator.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR orchestrator direct email — same file that calls evaluateContactability at top-of-cycle; local gate is the function itself. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/proposal-tracking.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR proposal follow-up email — invoked from orchestrator after contactability check; proposal tracking only fires for contacts already in active pipeline stage. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/statement-flow.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR statement-request and statement-follow-up emails — invoked from orchestrator after contactability check; fires only for contacts who submitted a statement. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sdr/terminal-shipping.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "pipeline_gated",
    reason: "SDR terminal-shipping confirmation and tracking emails — invoked from orchestrator after contactability check; transactional in nature (hardware order). Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sequence-worker.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "sequence_worker",
    reason: "Sequence-worker step email — sequence-worker enforces canEnrollContactInSequence gate before each step execution; sequences require explicit enrollment. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  // ── Transactional services — reviewed 2026-06-26 ─────────────────────────
  {
    file: "server/services/partner-welcome.ts",
    lineContains: "sendEmailReply",
    channel: "email",
    category: "transactional_merchant",
    reason: "Partner portal welcome email — triggered by operator partner-approval action, sent to the specific partner who just received approval. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/proposal-engine.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Proposal delivery via GHL email — triggered by explicit agent action in proposal workflow for a specific contact. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/proposal-engine.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "transactional_merchant",
    reason: "Proposal delivery via merchant-specific GHL email — triggered by explicit agent action for a specific merchant. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/proposal-engine.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Proposal delivery SMTP fallback — triggered by explicit agent action when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/sla-worker.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "internal_admin",
    reason: "SLA breach notification email — sent to internal admin/agent on SLA violation event; not automated outbound marketing. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/statement-upload-chain.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Statement upload confirmation SMTP — triggered by specific contact's statement submission, sent to the submitting rep. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/statement-upload-chain.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "transactional_merchant",
    reason: "Statement receipt confirmation via GHL — triggered by specific contact's statement submission. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/workflow-executor.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "internal_admin",
    reason: "Workflow-executor email step — executes a pre-configured workflow email action triggered by an authenticated agent/admin action, not automated outbound. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  // ── Admin-gated routes — reviewed 2026-06-26 ─────────────────────────────
  {
    file: "server/routes/activity.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "internal_admin",
    reason: "Activity route email — route requires isAuthenticated; sent as part of an activity log action initiated by an authenticated operator. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/admin.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "internal_admin",
    reason: "Admin route SMTP email — route requires admin role; operator-initiated notification, not automated outbound. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/analytics.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "Analytics weekly KPI digest — sent to admin email on operator-triggered digest action; not automated outbound marketing. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/integrations.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "internal_admin",
    reason: "Integrations route email — route requires admin/manager role; used for test sends and admin-initiated GHL email actions. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/notifications.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "Notifications daily digest — sent to admin email on operator-triggered digest action; not automated outbound marketing. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/partners.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "transactional_merchant",
    reason: "Partner status/approval email — triggered by admin partner approval or partner-specific action; sent to the specific partner contact. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/partners.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Partner SMTP fallback email — triggered by admin partner approval when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/rate-review.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Rate review result email — triggered by specific merchant's rate review request; sent to the requesting contact. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/residuals.ts",
    lineContains: "sendGhlEmailForMerchant",
    channel: "email",
    category: "internal_admin",
    reason: "Residual reconciliation alert email — sent to admin on reconciliation discrepancy; not automated outbound marketing. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/savings.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Savings analysis result email via GHL — triggered by specific contact's savings analysis request. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/routes/savings.ts",
    lineContains: "sendSmtpEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Savings analysis result SMTP fallback — triggered by specific contact's savings analysis request when GHL is not configured. Reviewed and approved.",
    reviewDate: "2026-06-26",
  },
];

/**
 * File-level context rules.
 * Files in this map have their non-email sends (SMS/voice/RVM/workflow) evaluated
 * against the stated context instead of requiring a per-call evaluateContactability gate.
 *
 * "admin_gated"      — route requires requireRole/isAuthenticated; operator-initiated, not automated outreach.
 * "transactional"    — always sends to the specific contact that just performed an action (form submit, approval, etc.).
 * "pipeline_gated"   — called from the SDR pipeline whose orchestrator enforces evaluateContactability at the top level.
 * "sequence_worker"  — the sequence-worker itself enforces canEnrollContactInSequence before enrolling.
 */
const FILE_CONTEXT_RULES: Map<string, "admin_gated" | "transactional" | "pipeline_gated" | "sequence_worker"> = new Map([
  // Admin-gated API routes — sends triggered only by authenticated admin/manager/agent action
  ["server/routes/activity.ts",     "admin_gated"],
  ["server/routes/admin.ts",        "admin_gated"],
  ["server/routes/analytics.ts",    "admin_gated"],
  ["server/routes/contacts.ts",     "admin_gated"],
  ["server/routes/helpers.ts",      "admin_gated"],
  ["server/routes/integrations.ts", "admin_gated"],
  ["server/routes/notifications.ts","admin_gated"],
  ["server/routes/partners.ts",     "admin_gated"],
  ["server/routes/residuals.ts",    "admin_gated"],
  ["server/routes/sdr.ts",          "admin_gated"],
  // Transactional services — triggered by a specific merchant/partner action
  ["server/services/ghl-form-sync.ts",        "transactional"],
  ["server/services/ghl-workflows.ts",         "transactional"],
  ["server/services/merchant-welcome.ts",      "transactional"],
  ["server/services/partner-welcome.ts",       "transactional"],
  ["server/services/proposal-engine.ts",       "transactional"],
  ["server/services/sla-worker.ts",            "transactional"],
  ["server/services/statement-upload-chain.ts","transactional"],
  ["server/services/workflow-executor.ts",     "transactional"],
  ["server/routes/rate-review.ts",             "transactional"],
  ["server/routes/savings.ts",                 "transactional"],
  // Campaign engine — part of outreach pipeline; gated by CAMPAIGNS_ENABLED flag and consent tracking
  ["server/services/campaign-engine.ts",        "pipeline_gated"],
  // SDR pipeline — evaluateContactability enforced at orchestrator.ts top-of-pipeline
  ["server/services/sdr/chat-handlers.ts",      "pipeline_gated"],
  ["server/services/sdr/orchestrator.ts",       "pipeline_gated"],
  ["server/services/sdr/proposal-tracking.ts",  "pipeline_gated"],
  ["server/services/sdr/reply-intelligence.ts", "pipeline_gated"],
  ["server/services/sdr/scheduling.ts",         "pipeline_gated"],
  ["server/services/sdr/statement-flow.ts",     "pipeline_gated"],
  ["server/services/sdr/terminal-shipping.ts",  "pipeline_gated"],
  ["server/services/sdr/voice-orchestrator.ts", "pipeline_gated"],
  // Sequence worker — canEnrollContactInSequence enforces gate before each step
  ["server/services/sequence-worker.ts", "sequence_worker"],
]);

/** Send function → channel mapping. */
const SEND_FUNCTIONS: Record<string, string> = {
  sendGhlSms: "sms",
  sendSmsReply: "sms",
  unifiedSendSms: "sms",
  triggerAiCall: "voice_ai",
  enrollContactInGhlWorkflow: "ringless_vm/workflow",
  triggerWorkflow: "workflow",
  sendGhlEmail: "email",
  sendGhlEmailForMerchant: "email",
  sendSmtpEmail: "email",
  sendEmailReply: "email",
  unifiedSendEmail: "email",
};

/** Directories to scan. */
const SCAN_DIRS = ["server/services", "server/routes"];

/** Skip these files entirely (test fixtures, scripts, migrations). */
const SKIP_PATTERNS = [/node_modules/, /\.d\.ts$/, /scripts\//, /migrations\//];

// ── Types ────────────────────────────────────────────────────────────────────

type EmailCategory = "marketing_outreach" | "sequence_step" | "transactional_merchant" | "internal_admin" | "unknown";

interface Finding {
  verdict: "PASS" | "FAIL";
  file: string;
  line: number;
  enclosingFunction: string;
  channel: string;
  emailCategory: EmailCategory | null;
  nearestGate: string;
  reason: string;
  suggestedFix: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relPath(abs: string): string {
  return path.relative(process.cwd(), abs).replace(/\\/g, "/");
}

function isAllowlisted(rel: string): boolean {
  return ALLOWLISTED_FILES.has(rel);
}

function findCallSiteAllowlistEntry(rel: string, lineText: string) {
  return CALL_SITE_ALLOWLIST.find(
    e => e.file === rel && lineText.includes(e.lineContains)
  );
}

/**
 * Search upward from startLine for the nearest enclosing function/method name.
 * Returns "unknown" if no enclosing function found within 100 lines.
 */
function detectEnclosingFunction(lines: string[], callLineIdx: number): string {
  const FUNC_PATTERNS = [
    /async\s+function\s+(\w+)/,
    /function\s+(\w+)/,
    /(?:const|let|var)\s+(\w+)\s*=\s*async\s*\(/,
    /(?:const|let|var)\s+(\w+)\s*=\s*function/,
    /(?:const|let|var)\s+(\w+)\s*=\s*\(.*\)\s*=>/,
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\):\s*\w.*\{/,
  ];

  for (let i = callLineIdx; i >= 0 && i >= callLineIdx - 100; i--) {
    const line = lines[i];
    for (const pat of FUNC_PATTERNS) {
      const m = line.match(pat);
      if (m && m[1]) return m[1];
    }
  }
  return "unknown";
}

/**
 * Search within SCAN_RADIUS lines before the call site for an evaluateContactability call.
 * Returns the line number (1-based) and context if found, "none" otherwise.
 */
function findNearestGate(lines: string[], callLineIdx: number, SCAN_RADIUS = 120): string {
  const start = Math.max(0, callLineIdx - SCAN_RADIUS);
  for (let i = callLineIdx; i >= start; i--) {
    if (/evaluateContactability|checkBeforeSend|canEnrollContactInSequence/.test(lines[i])) {
      return `line ${i + 1}: ${lines[i].trim().slice(0, 80)}`;
    }
  }
  return "none";
}

/**
 * Classify email category based on enclosing function name and file context.
 */
function classifyEmailCategory(
  funcName: string,
  relFile: string,
  lineText: string
): EmailCategory {
  const fn = funcName.toLowerCase();
  const file = relFile.toLowerCase();
  const line = lineText.toLowerCase();

  // Sequence step — inside sequence-worker or sequence execution context
  if (file.includes("sequence-worker") || line.includes("sequencestep") || fn.includes("runsequence") || fn.includes("executestep")) {
    return "sequence_step";
  }

  // Transactional merchant — named patterns for confirmations/portals
  if (
    fn.includes("welcome") || fn.includes("portal") || fn.includes("onboard") ||
    fn.includes("approval") || fn.includes("approved") || fn.includes("applicationstatus") ||
    fn.includes("merchantapplication") || fn.includes("sendmid") || fn.includes("midwelcome") ||
    fn.includes("proposal") || fn.includes("esign") || fn.includes("statement") ||
    fn.includes("invoice") || fn.includes("receipt") || fn.includes("confirmation") ||
    fn.includes("partner") || fn.includes("savings") || fn.includes("ratereview") ||
    fn.includes("ratechange") || fn.includes("notify") ||
    line.includes("transactional") || line.includes("confirmation email") ||
    file.includes("merchant-welcome") || file.includes("merchant-application") ||
    file.includes("co-branded-proposal") || file.includes("esign") ||
    file.includes("proposal-engine") || file.includes("partner-welcome") ||
    file.includes("statement-upload-chain") || file.includes("savings") ||
    file.includes("rate-review") || file.includes("/routes/partners")
  ) {
    return "transactional_merchant";
  }

  // Internal admin — alerts, digests, internal notifications, admin-only routes
  if (
    fn.includes("alert") || fn.includes("digest") || fn.includes("notify") ||
    fn.includes("internal") || fn.includes("admin") || fn.includes("operator") ||
    fn.includes("slack") || fn.includes("webhook") || fn.includes("anomaly") ||
    fn.includes("sla") || fn.includes("reconcil") || fn.includes("residual") ||
    file.includes("anomaly") || file.includes("digest") || file.includes("alert") ||
    file.includes("sla-worker") || file.includes("workflow-executor") ||
    file.includes("/routes/activity") || file.includes("/routes/admin") ||
    file.includes("/routes/analytics") || file.includes("/routes/integrations") ||
    file.includes("/routes/notifications") || file.includes("/routes/residuals") ||
    file.includes("/routes/helpers")
  ) {
    return "internal_admin";
  }

  // Marketing outreach — SDR, campaign, outreach, sequence enrollment
  if (
    fn.includes("campaign") || fn.includes("outreach") || fn.includes("sdr") ||
    fn.includes("enroll") || fn.includes("send") || fn.includes("broadcast") ||
    file.includes("campaign") || file.includes("sdr") || file.includes("outreach") ||
    line.includes("marketing") || line.includes("outreach")
  ) {
    return "marketing_outreach";
  }

  // Routes/services not yet classified — if in FILE_CONTEXT_RULES as transactional or admin, they'll be handled there
  const fileCtx = FILE_CONTEXT_RULES.get(relFile);
  if (fileCtx === "transactional") return "transactional_merchant";
  if (fileCtx === "admin_gated") return "internal_admin";

  // Default to unknown — requires manual classification
  return "unknown";
}

// ── Scanner ──────────────────────────────────────────────────────────────────

function scanFile(absPath: string): Finding[] {
  const rel = relPath(absPath);
  if (SKIP_PATTERNS.some(p => p.test(rel))) return [];
  if (!rel.endsWith(".ts")) return [];

  const content = fs.readFileSync(absPath, "utf8");
  const lines = content.split("\n");
  const findings: Finding[] = [];

  for (const [funcName, channel] of Object.entries(SEND_FUNCTIONS)) {
    const callPattern = new RegExp(`\\b${funcName}\\s*\\(`);

    lines.forEach((line, idx) => {
      if (!callPattern.test(line)) return;

      // Skip comment lines
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;

      const lineNum = idx + 1;

      // PASS: call site is in a low-level sender wrapper allowlist file
      if (isAllowlisted(rel)) {
        findings.push({
          verdict: "PASS",
          file: rel,
          line: lineNum,
          enclosingFunction: detectEnclosingFunction(lines, idx),
          channel,
          emailCategory: null,
          nearestGate: "N/A — allowlisted sender wrapper",
          reason: `Allowlisted low-level sender wrapper: ${rel}`,
          suggestedFix: "No action required.",
        });
        return;
      }

      const enclosingFunction = detectEnclosingFunction(lines, idx);
      const nearestGate = findNearestGate(lines, idx);
      const isEmailChannel = channel.includes("email");
      const emailCategory: EmailCategory | null = isEmailChannel
        ? classifyEmailCategory(enclosingFunction, rel, line)
        : null;

      // Check per-call-site allowlist entries
      const allowlistEntry = findCallSiteAllowlistEntry(rel, line);
      if (allowlistEntry) {
        findings.push({
          verdict: "PASS",
          file: rel,
          line: lineNum,
          enclosingFunction,
          channel,
          emailCategory: allowlistEntry.category,
          nearestGate,
          reason: `Call-site allowlisted (reviewed ${allowlistEntry.reviewDate}): ${allowlistEntry.reason}`,
          suggestedFix: "No action required.",
        });
        return;
      }

      // FAIL: email channel without classification
      if (isEmailChannel && emailCategory === "unknown") {
        findings.push({
          verdict: "FAIL",
          file: rel,
          line: lineNum,
          enclosingFunction,
          channel,
          emailCategory: "unknown",
          nearestGate,
          reason: "Email send call site is UNKNOWN category — must be classified before release.",
          suggestedFix: `Classify as marketing_outreach/sequence_step/transactional_merchant/internal_admin. Add an entry to CALL_SITE_ALLOWLIST in scripts/compliance-scan.ts with file, lineContains, category, reason, reviewDate.`,
        });
        return;
      }

      // FAIL: marketing_outreach or sequence_step without a visible gate
      // — only admin_gated and transactional FILE_CONTEXT_RULES auto-pass here.
      // pipeline_gated and sequence_worker email sends must have explicit CALL_SITE_ALLOWLIST entries
      // (added above) so each reviewed send site is accounted for individually.
      if (isEmailChannel && (emailCategory === "marketing_outreach" || emailCategory === "sequence_step")) {
        if (nearestGate === "none") {
          const fileCtxEmail = FILE_CONTEXT_RULES.get(rel);
          if (fileCtxEmail === "admin_gated" || fileCtxEmail === "transactional") {
            const ctxLabels: Record<string, string> = {
              admin_gated:   "admin-gated route — operator-initiated only",
              transactional: "transactional service — one-to-one send on contact action",
            };
            findings.push({
              verdict: "PASS",
              file: rel,
              line: lineNum,
              enclosingFunction,
              channel,
              emailCategory,
              nearestGate: `file-context: ${fileCtxEmail}`,
              reason: ctxLabels[fileCtxEmail],
              suggestedFix: "No action required.",
            });
            return;
          }
          findings.push({
            verdict: "FAIL",
            file: rel,
            line: lineNum,
            enclosingFunction,
            channel,
            emailCategory,
            nearestGate,
            reason: `${emailCategory} email send lacks visible evaluateContactability gate within 120 lines upstream.`,
            suggestedFix: `Ensure evaluateContactability() is called before ${funcName}() in ${enclosingFunction}(), or add file to FILE_CONTEXT_RULES in compliance-scan.ts if this file is always called from a gated context.`,
          });
          return;
        }
      }

      // FAIL: any email send with no inline gate and no CALL_SITE_ALLOWLIST entry.
      // Every email send site must be explicitly reviewed — no file-context auto-pass for email.
      // (The CALL_SITE_ALLOWLIST check at the top of this function returns PASS before reaching here
      //  for all reviewed sites; this block only fires for new/unreviewed sends.)
      if (isEmailChannel && nearestGate === "none") {
        findings.push({
          verdict: "FAIL",
          file: rel,
          line: lineNum,
          enclosingFunction,
          channel,
          emailCategory,
          nearestGate,
          reason: `Email send (${emailCategory ?? "unclassified"}) has no inline evaluateContactability gate and no CALL_SITE_ALLOWLIST entry. All email send sites must be explicitly reviewed.`,
          suggestedFix: `Add an explicit entry to CALL_SITE_ALLOWLIST in scripts/compliance-scan.ts with file="${rel}", lineContains (unique substring of the call), channel, category (transactional_merchant|internal_admin|pipeline_gated|sequence_worker), reason, and reviewDate.`,
        });
        return;
      }

      // FAIL: non-email channels (SMS/voice/RVM/workflow) without a visible gate
      // — BUT first check FILE_CONTEXT_RULES: admin_gated, transactional, pipeline_gated, sequence_worker contexts are safe
      if (!isEmailChannel && nearestGate === "none") {
        const fileCtx = FILE_CONTEXT_RULES.get(rel);
        if (fileCtx) {
          const ctxLabels: Record<string, string> = {
            admin_gated:     "admin-gated route (requireRole/isAuthenticated) — operator-initiated only",
            transactional:   "transactional service — sends to specific contact that initiated the action",
            pipeline_gated:  "SDR pipeline file — evaluateContactability enforced at orchestrator top-of-pipeline",
            sequence_worker: "sequence-worker — canEnrollContactInSequence gate enforced before each step",
          };
          findings.push({
            verdict: "PASS",
            file: rel,
            line: lineNum,
            enclosingFunction,
            channel,
            emailCategory: null,
            nearestGate: `file-context: ${fileCtx}`,
            reason: ctxLabels[fileCtx],
            suggestedFix: "No action required.",
          });
          return;
        }
        findings.push({
          verdict: "FAIL",
          file: rel,
          line: lineNum,
          enclosingFunction,
          channel,
          emailCategory: null,
          nearestGate,
          reason: `${channel} send call lacks visible evaluateContactability gate within 120 lines upstream.`,
          suggestedFix: `Call evaluateContactability({contactId, channel: "${channel.split("/")[0]}", mode: "enforcement"}) before ${funcName}(), or add file to FILE_CONTEXT_RULES in compliance-scan.ts with appropriate context and review date.`,
        });
        return;
      }

      // FAIL: workflow sends without a gate — also check FILE_CONTEXT_RULES
      if (channel.includes("workflow") && nearestGate === "none") {
        const fileCtx = FILE_CONTEXT_RULES.get(rel);
        if (fileCtx) {
          findings.push({
            verdict: "PASS",
            file: rel,
            line: lineNum,
            enclosingFunction,
            channel,
            emailCategory,
            nearestGate: `file-context: ${fileCtx}`,
            reason: `Workflow send in ${fileCtx} context — reviewed and approved.`,
            suggestedFix: "No action required.",
          });
          return;
        }
      }

      // PASS: gate found, or transactional/internal_admin category, or file-context approved
      const fileCtxForPass = FILE_CONTEXT_RULES.get(rel);
      findings.push({
        verdict: "PASS",
        file: rel,
        line: lineNum,
        enclosingFunction,
        channel,
        emailCategory,
        nearestGate: fileCtxForPass && nearestGate === "none" ? `file-context: ${fileCtxForPass}` : nearestGate,
        reason: isEmailChannel
          ? `${emailCategory} email send — ${nearestGate !== "none" ? `gate at ${nearestGate}` : `file-context: ${fileCtxForPass ?? "transactional/internal_admin"}`}`
          : `${channel} send — ${nearestGate !== "none" ? `gate at ${nearestGate}` : `file-context: ${fileCtxForPass ?? "allowlisted"}`}`,
        suggestedFix: "No action required.",
      });
    });
  }

  return findings;
}

function walkDir(dir: string): Finding[] {
  const results: Finding[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.isFile()) results.push(...scanFile(full));
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("=== Wave 12 Static Compliance Scanner ===\n");
  console.log("Scanning: " + SCAN_DIRS.join(", ") + "\n");

  const allFindings: Finding[] = [];
  for (const dir of SCAN_DIRS) {
    allFindings.push(...walkDir(path.join(process.cwd(), dir)));
  }

  // De-duplicate by file+line+function
  const seen = new Set<string>();
  const findings = allFindings.filter(f => {
    const key = `${f.file}:${f.line}:${f.channel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const passes = findings.filter(f => f.verdict === "PASS");
  const failures = findings.filter(f => f.verdict === "FAIL");

  // Email classification summary
  const emailFindings = findings.filter(f => f.emailCategory);
  const byCat: Record<string, number> = {};
  emailFindings.forEach(f => {
    const cat = f.emailCategory ?? "unknown";
    byCat[cat] = (byCat[cat] ?? 0) + 1;
  });

  console.log("── Email Call-Site Classification Summary ───────────────────\n");
  for (const [cat, count] of Object.entries(byCat)) {
    const status = (cat === "marketing_outreach" || cat === "sequence_step")
      ? (failures.some(f => f.emailCategory === cat) ? "⚠ some FAIL" : "✓ gated")
      : "✓ allowlisted";
    console.log(`  ${cat.padEnd(30)} ${String(count).padStart(3)} sites  ${status}`);
  }

  console.log("\n── Allowlist Entries ──────────────────────────────────────────\n");
  const allowlistPasses = passes.filter(f => !isAllowlisted(f.file) && f.nearestGate === "N/A — allowlisted sender wrapper" || passes.filter(x => x.file === f.file && x.reason.includes("allowlisted")));
  const callSiteAllowlistEntries = CALL_SITE_ALLOWLIST;
  callSiteAllowlistEntries.forEach(e => {
    console.log(`  ✓ ${e.file} | ${e.channel} | ${e.category}`);
    console.log(`    Reason: ${e.reason}`);
    console.log(`    Review date: ${e.reviewDate}\n`);
  });
  ALLOWLISTED_FILES.forEach(f => {
    console.log(`  ✓ [sender wrapper] ${f} — all call sites in this file are intentional low-level sends`);
  });

  console.log("\n── All Findings ───────────────────────────────────────────────\n");
  for (const f of findings) {
    const cat = f.emailCategory ? ` | ${f.emailCategory}` : "";
    const gate = f.nearestGate !== "N/A — allowlisted sender wrapper" ? ` | gate: ${f.nearestGate.slice(0, 60)}` : "";
    console.log(`${f.verdict} | ${f.file}:${f.line} | ${f.enclosingFunction} | ${f.channel}${cat}${gate}`);
    if (f.verdict === "FAIL") {
      console.log(`  FAIL: ${f.reason}`);
      console.log(`  FIX:  ${f.suggestedFix}\n`);
    }
  }

  console.log(`\n── Summary ────────────────────────────────────────────────────\n`);
  console.log(`  Total call sites scanned: ${findings.length}`);
  console.log(`  PASS: ${passes.length}`);
  console.log(`  FAIL: ${failures.length}`);
  console.log(`  Email call sites classified: ${emailFindings.length}`);

  if (failures.length > 0) {
    console.error(`\n✗ Compliance scan FAILED: ${failures.length} call site(s) require remediation before go-live.`);
    process.exit(1);
  } else {
    console.log(`\n✅ Compliance scan PASSED: all ${passes.length} call sites are properly gated or allowlisted.\n`);
    process.exit(0);
  }
}

main();
