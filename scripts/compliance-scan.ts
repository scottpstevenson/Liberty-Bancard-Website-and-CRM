#!/usr/bin/env tsx
/**
 * Wave 12 — Static Compliance Scanner
 *
 * Scans the server source tree for known compliance anti-patterns:
 *
 *   1. Outbound send calls (sendGhlEmail, sendGhlSms, sendGhlCall,
 *      sdrSendEmail, sdrSendSms) that are NOT inside a file that
 *      also calls evaluateContactability — meaning the contactability
 *      gate may be missing.
 *
 *   2. Direct doNotContact bypass: code that sets doNotContact=false
 *      or ignores doNotContact without an explicit admin-action flag.
 *
 *   3. SMS send calls in files that do NOT import featureFlags or
 *      check SMS_ENABLED.
 *
 *   4. Voice AI / ringless-VM calls in files that do NOT check
 *      VOICE_AI_ENABLED / RINGLESS_VM_ENABLED.
 *
 *   5. Hardcoded consent-tier upgrades to "pewc_full_automation"
 *      without going through recordPewcDecision().
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more violations found
 *
 * Run:
 *   npx tsx scripts/compliance-scan.ts
 *   npx tsx scripts/compliance-scan.ts --strict  (treats warnings as errors)
 */

import fs from "fs";
import path from "path";

const STRICT = process.argv.includes("--strict");

// Directories to scan (relative to project root)
const SCAN_DIRS = [
  "server/services",
  "server/routes",
];

// Directories / files to skip entirely
const SKIP_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  /compliance-engine\.ts$/,   // compliance engine IS the gate — expected to reference all channels
  /contactability\.ts$/,       // the gate itself
  /consent-evidence\.ts$/,     // consent write path — authoritative
  /ghl-workflow-enrollment\.ts$/, // contains the gate wrapper — already audited
  /sequence-worker\.ts$/,      // contains both Gate (a) and Gate (b) — already audited
];

interface Violation {
  severity: "error" | "warning";
  rule: string;
  file: string;
  lines: number[];
  detail: string;
}

const violations: Violation[] = [];

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

function getLines(content: string): string[] {
  return content.split("\n");
}

function findLineNumbers(lines: string[], regex: RegExp): number[] {
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (regex.test(line)) hits.push(i + 1);
  });
  return hits;
}

function scanFile(filePath: string): void {
  if (shouldSkip(filePath)) return;
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = getLines(content);
  const rel = path.relative(process.cwd(), filePath);

  // ── Rule 1: outbound send calls without contactability gate ───────────
  const SEND_PATTERNS = [
    /\bsendGhlEmail\s*\(/,
    /\bsendGhlSms\s*\(/,
    /\bsendGhlCall\s*\(/,
    /\bsdrSendEmail\s*\(/,
    /\bsdrSendSms\s*\(/,
    /\bsendEmailReply\s*\(/,
    /\bsendSmsReply\s*\(/,
  ];
  const hasSendCall = SEND_PATTERNS.some((p) => p.test(content));
  const hasContactabilityGate = /evaluateContactability|canEnrollContactInSequence/.test(content);

  if (hasSendCall && !hasContactabilityGate) {
    const sendLines: number[] = [];
    for (const p of SEND_PATTERNS) {
      sendLines.push(...findLineNumbers(lines, p));
    }
    violations.push({
      severity: "warning",
      rule: "MISSING_CONTACTABILITY_GATE",
      file: rel,
      lines: sendLines,
      detail: "File calls outbound send functions but does not call evaluateContactability(). Verify the gate is enforced upstream.",
    });
  }

  // ── Rule 2: SMS send without SMS_ENABLED check ────────────────────────
  const hasSmsCall = /\bsendGhlSms\b|\bsdrSendSms\b|\bsendSmsReply\b/.test(content);
  const hasSmsFlag = /SMS_ENABLED|featureFlags\.SMS_ENABLED/.test(content);
  if (hasSmsCall && !hasSmsFlag) {
    const smsLines = findLineNumbers(lines, /\bsendGhlSms\b|\bsdrSendSms\b|\bsendSmsReply\b/);
    violations.push({
      severity: "warning",
      rule: "SMS_WITHOUT_FLAG_CHECK",
      file: rel,
      lines: smsLines,
      detail: "SMS send called but SMS_ENABLED feature-flag is not checked in this file. Ensure upstream gate enforces it.",
    });
  }

  // ── Rule 3: Voice AI / ringless VM without flag check ─────────────────
  const hasVoiceCall = /\btriggerVoiceCall\b|\bvoiceAiCall\b|\bringlessVoicemail\b|\bdropRinglessVoicemail\b/.test(content);
  const hasVoiceFlag = /VOICE_AI_ENABLED|RINGLESS_VM_ENABLED|featureFlags\.VOICE/.test(content);
  if (hasVoiceCall && !hasVoiceFlag) {
    const voiceLines = findLineNumbers(lines, /\btriggerVoiceCall\b|\bvoiceAiCall\b|\bringlessVoicemail\b/);
    violations.push({
      severity: "error",
      rule: "VOICE_WITHOUT_FLAG_CHECK",
      file: rel,
      lines: voiceLines,
      detail: "Voice AI or ringless VM call found without VOICE_AI_ENABLED/RINGLESS_VM_ENABLED flag check.",
    });
  }

  // ── Rule 4: Hardcoded consent-tier upgrade to pewc_full_automation ─────
  // Legitimate: contactability.ts, consent-evidence.ts (already skipped above)
  const pewcHardcoded = findLineNumbers(lines, /"pewc_full_automation"\s*(?!==|!==|as\s|:)/);
  const isPewcWritePath = /recordPewcDecision|consentTier.*pewc/.test(content);
  if (pewcHardcoded.length > 0 && !isPewcWritePath) {
    violations.push({
      severity: "error",
      rule: "HARDCODED_PEWC_UPGRADE",
      file: rel,
      lines: pewcHardcoded,
      detail: "Direct 'pewc_full_automation' string found outside the canonical recordPewcDecision() write path. All PEWC upgrades must go through consent-evidence.ts.",
    });
  }

  // ── Rule 5: doNotContact force-set to false outside admin endpoints ────
  const dncForceOff = findLineNumbers(lines, /doNotContact\s*:\s*false(?!\s*\/\/\s*safe)/);
  // Only flag in service files, not schema definitions or test fixtures
  if (
    dncForceOff.length > 0 &&
    !rel.includes("schema") &&
    !rel.includes("scripts/") &&
    !rel.includes("seed") &&
    !rel.includes("admin")
  ) {
    violations.push({
      severity: "warning",
      rule: "DNC_FORCE_OFF",
      file: rel,
      lines: dncForceOff,
      detail: "doNotContact is being set to false. Verify this is an intentional admin action and not an accidental suppression list bypass.",
    });
  }
}

function walkDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full);
    } else if (entry.isFile()) {
      scanFile(full);
    }
  }
}

function main(): void {
  console.log("=== Wave 12 Static Compliance Scanner ===\n");
  console.log(`Scanning: ${SCAN_DIRS.join(", ")}\n`);

  for (const dir of SCAN_DIRS) {
    walkDir(path.join(process.cwd(), dir));
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warning");

  if (violations.length === 0) {
    console.log("✅ No compliance violations found.\n");
    process.exit(0);
  }

  console.log(`Found ${errors.length} error(s) and ${warnings.length} warning(s):\n`);

  for (const v of violations) {
    const icon = v.severity === "error" ? "✗" : "⚠";
    const lineStr = v.lines.length > 0 ? ` (lines: ${v.lines.slice(0, 5).join(", ")}${v.lines.length > 5 ? "…" : ""})` : "";
    console.log(`${icon} [${v.rule}] ${v.file}${lineStr}`);
    console.log(`    ${v.detail}\n`);
  }

  if (STRICT) {
    console.error(`STRICT mode: ${errors.length + warnings.length} total violation(s) → exit 1`);
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(`Compliance scan FAILED: ${errors.length} error(s) require remediation.`);
    process.exit(1);
  }

  console.log(`Compliance scan PASSED with ${warnings.length} warning(s) to review.`);
  process.exit(0);
}

main();
