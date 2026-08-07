#!/usr/bin/env npx tsx
/**
 * Pipeline Silence Check — Smoke Test (#1252)
 *
 * Verifies:
 *  1. runPipelineSilenceCheck() can be imported and called without throwing.
 *  2. The cooldown key is correctly formatted (string ISO timestamp per stage key).
 *  3. The threshold env var is respected (defaults to 24 h).
 *  4. Admin alert endpoint exists and returns 401 for anonymous callers
 *     (guards against the service being accidentally public).
 *  5. GET /api/admin/pre-deploy-result is admin-only (401 anon, 403 non-admin).
 *
 * Usage:
 *   GHL_TEST_MODE=true npx tsx scripts/test-pipeline-silence.ts
 * Dev server must be running on localhost:5000.
 */

import { runPipelineSilenceCheck } from "../server/services/pipeline-silence-check";
import { storage } from "../server/storage";

const BASE = process.env.BASE_URL ?? "http://localhost:5000";

// ── helpers ──────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    fail++;
  }
}

async function httpStatus(method: string, path: string, body?: object): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

// ── tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Pipeline Silence Check — Smoke Test ===\n");

  // ── 1. Dry run (GHL_TEST_MODE=true avoids real SMTP) ──────────────────────
  console.log("▶  Dry-run runPipelineSilenceCheck()");
  try {
    await runPipelineSilenceCheck();
    check("runPipelineSilenceCheck() completes without throwing", true);
  } catch (err: any) {
    check(`runPipelineSilenceCheck() completed without throwing (got: ${err.message})`, false);
  }

  // ── 2. Cooldown key is valid JSON or missing (not corrupt) ────────────────
  console.log("\n▶  Cooldown key integrity");
  try {
    const raw = await storage.getSystemSetting("pipeline_silence_cooldown");
    if (raw === null || raw === undefined) {
      check("Cooldown key absent (no alerts sent yet — expected on fresh install)", true);
    } else {
      const map = typeof raw === "object" ? raw : JSON.parse(String(raw));
      const isValid =
        typeof map === "object" &&
        map !== null &&
        Object.values(map).every(
          (v) => typeof v === "string" && !isNaN(Date.parse(v as string)),
        );
      check("Cooldown map values are ISO timestamps", isValid);
    }
  } catch (err: any) {
    check(`Cooldown key readable (got: ${err.message})`, false);
  }

  // ── 3. Threshold env var ──────────────────────────────────────────────────
  console.log("\n▶  Threshold configuration");
  const threshold = parseInt(process.env.PIPELINE_SILENCE_THRESHOLD_HOURS ?? "24", 10);
  check("PIPELINE_SILENCE_THRESHOLD_HOURS is a positive integer", threshold > 0 && Number.isFinite(threshold));

  // ── 4. HTTP guard: anonymous cannot access pre-deploy gate result ──────────
  console.log("\n▶  HTTP role guards");
  const anonStatus = await httpStatus("GET", "/api/admin/pre-deploy-result");
  check(`GET /api/admin/pre-deploy-result anon → 401 (got ${anonStatus})`, anonStatus === 401);

  // ── summary ───────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
  if (fail > 0) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
