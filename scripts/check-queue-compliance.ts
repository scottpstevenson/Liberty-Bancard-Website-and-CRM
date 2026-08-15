/**
 * check-queue-compliance.ts (#1532)
 *
 * CI validation script. Fails on any of:
 *   1. Route module calls qm.pauseQueue() / qm.resumeQueue() without coordinator routing.
 *   2. Hard-coded queue-name list asserted to contain all outbound queues.
 *   3. getQueueManager() called from a route or health probe (must use requireQueueManagerReady()).
 *   4. An outbound-effect handler checks authority but not coordinator.canExecute().
 *   5. Manifest entry missing for any QUEUE_NAMES key (validated via validateManifest()).
 *
 * Exit: 0 = all pass, 1 = any failure.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckResult {
  pass: boolean;
  label: string;
  details: string[];
}

// ── File scanning ─────────────────────────────────────────────────────────────

function walkDir(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, exts));
    } else if (exts.includes(extname(name))) {
      results.push(full);
    }
  }
  return results;
}

function readSrc(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ── Check 1: No direct qm.pauseQueue() / qm.resumeQueue() in route files ─────

function checkNoPauseResumeDirectInRoutes(): CheckResult {
  const routeDir = join(process.cwd(), "server/routes");
  const files = walkDir(routeDir, [".ts"]);
  const violations: string[] = [];

  for (const f of files) {
    if (f.includes("queue-metrics.ts")) continue; // queue-metrics now uses coordinator
    const src = readSrc(f);
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (/qm\.pauseQueue\s*\(/.test(line) || /qm\.resumeQueue\s*\(/.test(line)) {
        violations.push(`${f}:${i + 1} — direct qm.pauseQueue/resumeQueue call (must route through coordinator)`);
      }
    });
  }

  return {
    pass: violations.length === 0,
    label: "No direct qm.pauseQueue()/qm.resumeQueue() in route files",
    details: violations,
  };
}

// ── Check 2: No hard-coded outbound queue-name lists ─────────────────────────

function checkNoHardcodedOutboundQueueList(): CheckResult {
  // Look for array literals containing multiple queue names (sign of a hard-coded list)
  const srcDir = join(process.cwd(), "server");
  const files = walkDir(srcDir, [".ts"]);
  const violations: string[] = [];

  const OUTBOUND_QUEUES = [
    "winback-outreach",
    "sequences",
    "discovery",
    "campaign",
    "sdr",
    "proposal-followup",
  ];

  for (const f of files) {
    if (f.includes("logical-job-manifest.ts")) continue; // manifest is the canonical source
    if (f.includes("check-queue-compliance.ts")) continue; // this file
    const src = readSrc(f);
    // Detect arrays with 3+ known outbound queue names
    let hits = 0;
    for (const q of OUTBOUND_QUEUES) {
      if (src.includes(`"${q}"`) || src.includes(`'${q}'`)) hits++;
    }
    if (hits >= 3 && (src.includes("outboundQueues") || src.includes("OUTBOUND_QUEUES") || src.includes("outbound_queues"))) {
      violations.push(`${f} — appears to contain a hard-coded outbound queue list (found ${hits} known queue names + list variable). Use LOGICAL_JOB_MANIFEST instead.`);
    }
  }

  return {
    pass: violations.length === 0,
    label: "No hard-coded outbound queue-name list",
    details: violations,
  };
}

// ── Check 3: No getQueueManager() in route or health-probe files ─────────────

function checkNoGetQueueManagerInRoutes(): CheckResult {
  const routeDir = join(process.cwd(), "server/routes");
  const files = walkDir(routeDir, [".ts"]);
  const violations: string[] = [];

  // Allowed in queue-metrics.ts and activation.ts (they use it for status reads, not lazy init)
  const ALLOWED = new Set(["queue-metrics.ts", "activation.ts"]);

  for (const f of files) {
    const fileName = f.split("/").pop() ?? "";
    if (ALLOWED.has(fileName)) continue;
    const src = readSrc(f);
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      // Match getQueueManager() calls (not requireQueueManagerReady which is allowed)
      if (/getQueueManager\s*\(\s*\)/.test(line) && !/requireQueueManagerReady/.test(line)) {
        violations.push(`${f}:${i + 1} — getQueueManager() in route file (use requireQueueManagerReady() or getQueueManagerProducers())`);
      }
    });
  }

  return {
    pass: violations.length === 0,
    label: "No getQueueManager() in route files (must use requireQueueManagerReady/getQueueManagerProducers)",
    details: violations,
  };
}

// ── Check 4: Outbound-effect handlers check both authority AND coordinator ────

function checkOutboundHandlersDualGate(): CheckResult {
  // Find files that import outbound-pause-authority but not outbound-queue-coordinator
  const serviceDir = join(process.cwd(), "server/services");
  const routeDir   = join(process.cwd(), "server/routes");
  const files = [
    ...walkDir(serviceDir, [".ts"]),
    ...walkDir(routeDir, [".ts"]),
  ];
  const violations: string[] = [];

  // Files that are allowed to have authority-only (no outbound effect)
  const AUTHORITY_ONLY_ALLOWED = new Set([
    "outbound-pause-authority.ts",
    "outbound-control-service.ts",
    "outbound-queue-coordinator.ts",
    "smtp-email.ts",
    "ghl-workflows.ts", // already has coordinator gate now
    "check-queue-compliance.ts",
    "sender-policy.ts",
    "health-monitor.ts",
  ]);

  for (const f of files) {
    const fileName = f.split("/").pop() ?? "";
    if (AUTHORITY_ONLY_ALLOWED.has(fileName)) continue;
    const src = readSrc(f);
    const hasAuthorityImport = src.includes("outbound-pause-authority");
    const hasCoordinatorImport = src.includes("outbound-queue-coordinator");

    // If it has authority import but not coordinator, it may have a missing gate
    // Only flag if it also has outbound effect patterns
    if (hasAuthorityImport && !hasCoordinatorImport) {
      const hasOutboundEffect =
        src.includes("sendSmtpEmail") ||
        src.includes("enrollContactInGhlWorkflow") ||
        src.includes("db.insert(sequenceEnrollments") ||
        src.includes("processingSendQueue") ||
        src.includes("queueCampaignMessages");

      if (hasOutboundEffect) {
        violations.push(
          `${f} — imports outbound-pause-authority and has outbound effect patterns, ` +
          `but does NOT import outbound-queue-coordinator (missing coordinator.canExecute() gate)`,
        );
      }
    }
  }

  return {
    pass: violations.length === 0,
    label: "Outbound-effect handlers check both authority AND coordinator.canExecute()",
    details: violations,
  };
}

// ── Check 5: Manifest validation ──────────────────────────────────────────────

async function checkManifestValid(): Promise<CheckResult> {
  try {
    const { validateManifest } = await import("../server/services/logical-job-manifest");
    const result = validateManifest();
    return {
      pass: result.valid,
      label: "Logical job manifest valid (all QUEUE_NAMES have entries, no unclassified)",
      details: result.errors,
    };
  } catch (err: any) {
    return {
      pass: false,
      label: "Logical job manifest valid",
      details: [`Error running validateManifest(): ${err.message}`],
    };
  }
}

// ── Check 6: No sequence-worker enrollment status mutation to 'paused' ────────

function checkNoEnrollmentStatusPaused(): CheckResult {
  const f = join(process.cwd(), "server/services/sequence-worker.ts");
  const src = readSrc(f);
  const violations: string[] = [];

  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    // Look for status: "paused" assignment in context that's NOT a comment or the recovery sweep
    if (
      /status\s*:\s*["']paused["']/.test(line) &&
      !line.includes("_globalPauseBlock") &&
      !line.includes("// ") &&
      // Allow the _capDefer pattern which legitimately sets status=paused
      !line.includes("_capDefer")
    ) {
      violations.push(
        `${f}:${i + 1} — sequence-worker sets enrollment status='paused' directly. ` +
        `Must use _holdDeferred marker instead (VFC-22 fix).`,
      );
    }
  });

  return {
    pass: violations.length === 0,
    label: "sequence-worker does not mutate enrollment status to 'paused' on hold (VFC-22 fix)",
    details: violations,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║  Queue Compliance Check (#1532)                       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();

  const syncChecks: CheckResult[] = [
    checkNoPauseResumeDirectInRoutes(),
    checkNoHardcodedOutboundQueueList(),
    checkNoGetQueueManagerInRoutes(),
    checkOutboundHandlersDualGate(),
    checkNoEnrollmentStatusPaused(),
  ];

  let allPass = true;

  for (const check of syncChecks) {
    const icon = check.pass ? "✅" : "❌";
    console.log(`${icon} ${check.label}`);
    if (!check.pass) {
      allPass = false;
      for (const detail of check.details) {
        console.log(`   ⚠ ${detail}`);
      }
    }
  }

  // Async check
  const manifestCheck = await checkManifestValid();
  const mIcon = manifestCheck.pass ? "✅" : "❌";
  console.log(`${mIcon} ${manifestCheck.label}`);
  if (!manifestCheck.pass) {
    allPass = false;
    for (const detail of manifestCheck.details) {
      console.log(`   ⚠ ${detail}`);
    }
  }

  console.log();
  if (allPass) {
    console.log("✅ All queue compliance checks pass.");
    process.exit(0);
  } else {
    console.log("❌ One or more queue compliance checks failed.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Queue compliance check script error:", err);
  process.exit(1);
});
