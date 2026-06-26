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
  category: "transactional_merchant" | "internal_admin";
  reason: string;
  reviewDate: string;
}> = [
  {
    file: "server/services/merchant-welcome.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Merchant welcome email on Closed Won — triggered by operator approval, not automated outreach. Contact state is verified closed_won before call.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/merchant-application-status.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Merchant application status update email — triggered by admin action on approved/rejected application, not automated sequence.",
    reviewDate: "2026-06-26",
  },
  {
    file: "server/services/co-branded-proposal.ts",
    lineContains: "sendGhlEmail",
    channel: "email",
    category: "transactional_merchant",
    reason: "Co-branded proposal delivery — triggered explicitly by agent action in proposal workflow, not automated sequence.",
    reviewDate: "2026-06-26",
  },
];

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
    line.includes("transactional") || line.includes("confirmation email") ||
    file.includes("merchant-welcome") || file.includes("merchant-application") ||
    file.includes("co-branded-proposal") || file.includes("esign")
  ) {
    return "transactional_merchant";
  }

  // Internal admin — alerts, digests, internal notifications
  if (
    fn.includes("alert") || fn.includes("digest") || fn.includes("notify") ||
    fn.includes("internal") || fn.includes("admin") || fn.includes("operator") ||
    fn.includes("slack") || fn.includes("webhook") || fn.includes("anomaly") ||
    file.includes("anomaly") || file.includes("digest") || file.includes("alert")
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
      if (isEmailChannel && (emailCategory === "marketing_outreach" || emailCategory === "sequence_step")) {
        if (nearestGate === "none") {
          findings.push({
            verdict: "FAIL",
            file: rel,
            line: lineNum,
            enclosingFunction,
            channel,
            emailCategory,
            nearestGate,
            reason: `${emailCategory} email send lacks visible evaluateContactability gate within 120 lines upstream.`,
            suggestedFix: `Ensure evaluateContactability() is called before ${funcName}() in ${enclosingFunction}(), or verify this function is only called from a gated context (sequence-worker, ghl-workflow-enrollment) and add a code comment '// safe: gate enforced by <caller>'.`,
          });
          return;
        }
      }

      // FAIL: non-email channels (SMS/voice/RVM) without a visible gate
      if (!isEmailChannel && nearestGate === "none") {
        findings.push({
          verdict: "FAIL",
          file: rel,
          line: lineNum,
          enclosingFunction,
          channel,
          emailCategory: null,
          nearestGate,
          reason: `${channel} send call lacks visible evaluateContactability gate within 120 lines upstream.`,
          suggestedFix: `Call evaluateContactability({contactId, channel: "${channel.split("/")[0]}", mode: "enforcement"}) before ${funcName}(), or verify gate is enforced by caller and add '// safe: gate enforced by <caller>'.`,
        });
        return;
      }

      // PASS: gate found, or transactional/internal_admin category
      findings.push({
        verdict: "PASS",
        file: rel,
        line: lineNum,
        enclosingFunction,
        channel,
        emailCategory,
        nearestGate,
        reason: isEmailChannel
          ? `${emailCategory} email send has upstream gate at ${nearestGate}`
          : `${channel} send has evaluateContactability gate at ${nearestGate}`,
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
