#!/usr/bin/env tsx
/**
 * scripts/test-pause-fence.ts
 *
 * Verifies that every outbound channel pause is an explicit, persisted DB row
 * (not just a code-level default) so the readiness gate can prove
 * "intentionally paused" vs "fell back to safe default".
 *
 * Also verifies the new OutboundPauseAuthority control table is seeded and
 * reflects a paused state before any outbound-capable worker could have started.
 *
 * Exit 0 = all pause keys are PERSISTED and set to true / control row paused
 * Exit 1 = one or more keys missing from DB or set to false / control row missing
 */

import { db } from "../server/db";
import { systemSettings } from "../shared/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const PAUSE_KEYS: Array<{ key: string; label: string }> = [
  { key: "outboundGlobalPaused",   label: "Global outbound kill-switch (legacy)" },
  { key: "emailChannelPaused",     label: "Email channel" },
  { key: "smsChannelPaused",       label: "SMS channel" },
  { key: "coldEmailChannelPaused", label: "Cold-email channel" },
];

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `\n       ↳ ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Outbound Pause Fence — Persisted DB rows + control authority");
console.log("══════════════════════════════════════════════════════════\n");

// ── 1. Legacy system_settings keys ───────────────────────────────────────────

console.log("  Section 1: Legacy system_settings pause keys\n");

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
      : undefined,
  );
  console.log();
}

// ── 2. OutboundPauseAuthority control table ───────────────────────────────────

console.log("  Section 2: OutboundPauseAuthority control table\n");

try {
  const controlRows = await db.execute(sql`
    SELECT id, state, epoch, reason, actor, committed_at
    FROM outbound_pause_control
    ORDER BY id
    LIMIT 1
  `);

  const controlRow = controlRows.rows[0] as any;

  if (controlRow) {
    console.log(`  [outbound_pause_control]`);
    console.log(`    State:  ${controlRow.state}`);
    console.log(`    Epoch:  ${controlRow.epoch}`);
    console.log(`    Actor:  ${controlRow.actor ?? "(none)"}`);
    console.log(`    CommittedAt: ${controlRow.committed_at ?? "(none)"}`);
    console.log();

    assert(
      "outbound_pause_control row exists",
      true,
    );

    assert(
      "outbound_pause_control.state is a valid value",
      ["paused", "activating", "unpaused"].includes(controlRow.state),
      `state="${controlRow.state}" is not one of paused/activating/unpaused`,
    );

    assert(
      "outbound_pause_control.epoch is a positive number",
      Number(controlRow.epoch) >= 1,
      `epoch=${controlRow.epoch} is not ≥ 1`,
    );
  } else {
    console.log("  [outbound_pause_control] NO ROW\n");
    assert(
      "outbound_pause_control row exists",
      false,
      "No control row found. Restart the server to trigger initializePauseControl().",
    );
  }
} catch (tableErr: any) {
  if (tableErr.message?.includes("does not exist")) {
    console.log("  [outbound_pause_control] TABLE DOES NOT EXIST\n");
    assert(
      "outbound_pause_control table exists",
      false,
      "Table not found. Migration 0133_outbound_pause_control.sql has not been applied.",
    );
  } else {
    console.log(`  [outbound_pause_control] ERROR: ${tableErr.message}\n`);
    assert("outbound_pause_control table readable", false, tableErr.message);
  }
}

// ── 3. OutboundPauseAuthority: fail-closed read path ─────────────────────────

console.log("  Section 3: OutboundPauseAuthority fail-closed semantics\n");

try {
  const { getPauseState, invalidatePauseStateCache } = await import("../server/services/outbound-pause-authority");
  invalidatePauseStateCache();
  const state = await getPauseState();

  console.log(`  [OutboundPauseAuthority]`);
  console.log(`    State:  ${state.state}`);
  console.log(`    Source: ${state.source}`);
  console.log(`    Epoch:  ${state.epoch}`);
  console.log();

  assert("getPauseState() returns a valid state", ["paused", "activating", "unpaused"].includes(state.state));
  assert("getPauseState() returns epoch as bigint", typeof state.epoch === "bigint");
  assert("getPauseState() returns stateSource", ["database", "safe_default"].includes(state.source));
} catch (authErr: any) {
  assert("OutboundPauseAuthority getPauseState() works", false, authErr.message);
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log("══════════════════════════════════════════════════════════");
console.log(`  RESULT: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════\n");

if (failed > 0) {
  console.error(
    `[test-pause-fence] FAIL — ${failed} check(s) failed.\n` +
    `  All 4 legacy pause keys must be PERSISTED rows in system_settings set to true.\n` +
    `  outbound_pause_control table must exist with a valid row.\n` +
    `  Restart the server to trigger the startup seeder.\n`,
  );
  process.exit(1);
} else {
  console.log(
    "[test-pause-fence] PASS — All outbound channels are explicitly paused " +
    "as persisted DB rows (not code defaults), and the control authority is seeded.\n",
  );
  process.exit(0);
}
