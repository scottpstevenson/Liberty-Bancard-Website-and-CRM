/**
 * Focused positive/negative unit tests for the outbound pause static scanner.
 * Validates the updated NORMALIZED_PAUSE_PATTERN, hasKey logic, and stripComments.
 * Run: npx tsx scripts/_pause-scan-test.ts
 */

// Exact replication of the scanner logic from scripts/pre-deploy.ts

const NORMALIZED_PAUSE_PATTERN =
  /=== true|=== "true"|=== 'true'|await authorize\s*\(|await canExecute\s*\(/;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")  // block comments
    .replace(/\/\/[^\n]*/g, "");         // line comments
}

function assess(src: string): "PASS" | "FAIL_KEY" | "FAIL_NORM" {
  const stripped = stripComments(src);
  const hasKey =
    stripped.includes("outboundGlobalPaused") ||
    stripped.includes("outbound-pause-authority") ||
    /\bcanExecute\s*\(/.test(stripped);
  const hasNorm = NORMALIZED_PAUSE_PATTERN.test(stripped);
  if (!hasKey) return "FAIL_KEY";
  if (!hasNorm) return "FAIL_NORM";
  return "PASS";
}

const cases: Array<{ label: string; src: string; want: "PASS" | "FAIL_KEY" | "FAIL_NORM" }> = [
  // ── Positive: legacy pattern ────────────────────────────────────────────────
  {
    label: "legacy: getSystemSetting + === true",
    src: `const paused = await storage.getSystemSetting("outboundGlobalPaused");
if (paused === true || paused === "true") return;`,
    want: "PASS",
  },
  {
    label: "legacy: getSystemSetting + === 'true'",
    src: `const raw = await getSystemSetting("outboundGlobalPaused");
if (raw === 'true') return;
sendSmtpEmail({});`,
    want: "PASS",
  },
  // ── Positive: canonical authority pattern ────────────────────────────────────
  {
    label: "canonical: import outbound-pause-authority + await authorize(",
    src: `const { authorize } = await import("./outbound-pause-authority");
const decision = await authorize({});
if (!decision.allowed) return;`,
    want: "PASS",
  },
  {
    label: "canonical: subdirectory import (../) + await authorize(",
    src: `const { authorize } = await import("../outbound-pause-authority");
const decision = await authorize({});
if (!decision.allowed) return;`,
    want: "PASS",
  },
  // ── Positive: coordinator canExecute pattern ─────────────────────────────────
  {
    label: "canonical: canExecute call present",
    src: `const { canExecute } = await import("./outbound-queue-coordinator");
const ok = await canExecute("sequences");
if (!ok) return;`,
    want: "PASS",
  },
  // ── Positive: both authority + coordinator ────────────────────────────────────
  {
    label: "canonical: authorize + canExecute both present",
    src: `const { authorize } = await import("./outbound-pause-authority");
const { canExecute } = await import("./outbound-queue-coordinator");
const decision = await authorize({});
const coordOk = decision.allowed ? await canExecute("sequences") : false;
if (!decision.allowed || !coordOk) return;`,
    want: "PASS",
  },
  // ── Positive: actual file snippets matching real files ───────────────────────
  {
    label: "real: ghl-workflows.ts pattern",
    src: `const { authorize } = await import("./outbound-pause-authority");
const { canExecute } = await import("./outbound-queue-coordinator");
const decision = await authorize({});
if (!decision.allowed) { return { success: false, skipped: true }; }
const coordOk = await canExecute("ghl-workflows-marketing");`,
    want: "PASS",
  },
  {
    label: "real: sdr/orchestrator.ts pattern (../ import)",
    src: `const { authorize } = await import("../outbound-pause-authority");
const { canExecute } = await import("../outbound-queue-coordinator");
const decision = await authorize({});
const coordOk = await canExecute("sdr-orchestrator");`,
    want: "PASS",
  },
  // ── Negative: gate only in // line comment (must FAIL_KEY) ───────────────────
  {
    label: "negative: authorize only in // line comment",
    src: `// const { authorize } = await import("./outbound-pause-authority"); await authorize({});
sendSmtpEmail({ to: "x@y.com" });`,
    want: "FAIL_KEY",
  },
  {
    label: "negative: outboundGlobalPaused only in // line comment",
    src: `// const paused = await storage.getSystemSetting("outboundGlobalPaused"); if (paused === true) return;
sendSmtpEmail({ to: "x@y.com" });`,
    want: "FAIL_KEY",
  },
  {
    label: "negative: canExecute only in // line comment",
    src: `// await canExecute("sequences");
sendSmtpEmail({ to: "x@y.com" });`,
    want: "FAIL_KEY",
  },
  // ── Negative: gate only in /* block comment */ (must FAIL_KEY) ───────────────
  {
    label: "negative: outbound-pause-authority only in /* block comment */",
    src: `/* import("./outbound-pause-authority") authorize({}) */
sendSmtpEmail({ to: "x@y.com" });`,
    want: "FAIL_KEY",
  },
  {
    label: "negative: canExecute only in /* block comment */",
    src: `/* const ok = await canExecute("foo"); */
sendSmtpEmail({ to: "x@y.com" });`,
    want: "FAIL_KEY",
  },
  // ── Negative: key present but no normalized comparison (legacy path only) ────
  {
    label: "negative: outboundGlobalPaused without normalized comparison (bare if)",
    src: `const paused = await storage.getSystemSetting("outboundGlobalPaused");
if (paused) return;
sendSmtpEmail({});`,
    want: "FAIL_NORM",
  },
  // ── Negative: unused import only — no actual call (FAIL_KEY because
  //    `outbound-pause-authority` doesn't appear in code, only authorize) ───────
  {
    label: "negative: import string in comment, authorize only in log message string",
    src: `console.log("authorize() threw: " + err.message);
sendSmtpEmail({});`,
    want: "FAIL_KEY",
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = assess(c.src);
  if (got === c.want) {
    console.log(`  ✓ ${c.label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${c.label}`);
    console.error(`      want=${c.want}  got=${got}`);
    console.error(`      stripped: ${stripComments(c.src).replace(/\n/g, " ").trim().slice(0, 120)}`);
    failed++;
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
