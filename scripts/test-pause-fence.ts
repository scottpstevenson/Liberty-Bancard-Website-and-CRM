#!/usr/bin/env tsx
/**
 * scripts/test-pause-fence.ts
 *
 * Verifies that every outbound channel pause is an explicit, persisted DB row
 * (not just a code-level default) so the readiness gate can prove
 * "intentionally paused" vs "fell back to safe default".
 *
 * Each key is seeded fail-closed (true=paused) on server startup via
 * server/index.ts → seedOutboundPauseSettings(). After the first server boot
 * every key must be a real row in system_settings.
 *
 * Exit 0 = all pause keys are PERSISTED and set to true
 * Exit 1 = one or more keys missing from DB or set to false
 */

import { db } from "../server/db";
import { systemSettings } from "../shared/schema";
import { eq } from "drizzle-orm";

const PAUSE_KEYS: Array<{ key: string; label: string }> = [
  { key: "outboundGlobalPaused",   label: "Global outbound kill-switch" },
  { key: "emailChannelPaused",     label: "Email channel" },
  { key: "smsChannelPaused",       label: "SMS channel" },
  { key: "coldEmailChannelPaused", label: "Cold-email channel" },
];

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `\n       ↳ ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Outbound Pause Fence — Persisted DB rows vs code default");
console.log("══════════════════════════════════════════════════════════\n");

for (const { key, label } of PAUSE_KEYS) {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key));

  const persisted = !!row;
  const value = row?.value;
  const isPaused = value === true || value === "true";

  const stateTag = persisted ? "PERSISTED" : "CODE-DEFAULT (no DB row)";
  const valueTag = isPaused
    ? "paused=true ✓"
    : `paused=${JSON.stringify(value)} — channel is NOT paused`;

  console.log(`  [${label}]`);
  console.log(`    Storage: ${stateTag}`);
  console.log(`    Value:   ${valueTag}`);

  assert(
    `${label}: PERSISTED and paused=true`,
    persisted && isPaused,
    !persisted
      ? `No DB row for key="${key}". Restart the server to trigger the startup seeder.`
      : !isPaused
      ? `Row exists but value=${JSON.stringify(value)} — channel is currently unpaused!`
      : undefined
  );
  console.log();
}

console.log("══════════════════════════════════════════════════════════");
console.log(`  RESULT: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════\n");

if (failed > 0) {
  console.error(
    `[test-pause-fence] FAIL — ${failed} pause key(s) are missing from DB or unpaused.\n` +
    `  All 4 keys must be PERSISTED rows in system_settings set to true.\n` +
    `  Restart the server to trigger the startup seeder.\n`
  );
  process.exit(1);
} else {
  console.log(
    "[test-pause-fence] PASS — All outbound channels are explicitly paused " +
    "as persisted DB rows (not code defaults).\n"
  );
  process.exit(0);
}
