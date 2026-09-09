#!/usr/bin/env npx tsx
/**
 * rev06a-operator-manual-command.ts — REV-06A Operator Manual Command
 *
 * Manual-first operator script for the REV-06A lifecycle.
 * Accepts a canonical MID generation + date range, gates on the activation
 * snapshot, and invokes verified Payarc endpoints (GET /charges and
 * GET /merchant_statements) via the adapter using the snapshot-authorized
 * base URL.
 *
 * IMPORTANT: No recurring schedule is registered here. This is a ONE-TIME
 * manually triggered command only. Automation is a separate follow-up task.
 *
 * Usage:
 *   npx tsx scripts/rev06a-operator-manual-command.ts \
 *     --mid-id <merchant_mids.id> \
 *     --start-date 2026-08-01 \
 *     --end-date 2026-08-31
 *
 * Per §13 Completion Rule:
 *   This command preserves HeldResult for all operations that were not
 *   confirmed via a sandbox 2xx. Only get_daily_stats and get_charges are
 *   authorized in the current sandbox_verified snapshot (migration 0238).
 *   getResiduals and submitDisputeEvidence remain HeldResult until their
 *   Payarc endpoints return a verified 2xx.
 *
 * REV-06A §4a Final Probe Results (Sept 9 2026):
 *   PAYARC_MERCHANT_API_KEY (sandbox) on testapi.payarc.net/v1:
 *     GET /accounts/me           → 200 ✓
 *     GET /charges               → 200 ✓  (data[] empty in sandbox account)
 *     GET /merchant_statements   → 200 ✓  (data[] empty in sandbox account)
 *     GET /cases (date range)    → 200 ✓  (dispute listing)
 *     GET /deposits              → 404 ✗
 *     GET /residuals             → 405 ✗  (POST only)
 *     GET /disputes              → 404 ✗
 *   PAYARC_API_KEY (production partner) on api.payarc.net/v1:
 *     GET /accounts/me           → 200 ✓  (identity only)
 *     All data endpoints         → 401 ✗  (permissions not granted)
 */

import { db } from "../server/db";
import { merchantMids } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireConfirmedActivationSnapshot } from "../server/services/processors/registry";
import { getProcessor, getDefaultProcessor } from "../server/services/processors/registry";
import { maskMid } from "../server/utils/mask-mid";

// ── CLI Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(): { midId: number; startDate: string; endDate: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const midIdStr = get("--mid-id");
  const startDate = get("--start-date");
  const endDate = get("--end-date");

  if (!midIdStr || !startDate || !endDate) {
    console.error("Usage: npx tsx scripts/rev06a-operator-manual-command.ts --mid-id <id> --start-date YYYY-MM-DD --end-date YYYY-MM-DD");
    process.exit(1);
  }

  const midId = parseInt(midIdStr, 10);
  if (isNaN(midId)) { console.error("--mid-id must be a number"); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { console.error("--start-date must be YYYY-MM-DD"); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { console.error("--end-date must be YYYY-MM-DD"); process.exit(1); }
  if (startDate > endDate) { console.error("--start-date must be ≤ --end-date"); process.exit(1); }

  return { midId, startDate, endDate };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { midId, startDate, endDate } = parseArgs();

  console.log("\n[REV-06A] Operator Manual Command");
  console.log(`  MID row ID: ${midId}`);
  console.log(`  Date range: ${startDate} → ${endDate}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log("─".repeat(70));

  // ── Step 1: Load MID row ───────────────────────────────────────────────────

  const rows = await db.select().from(merchantMids).where(eq(merchantMids.id, midId)).limit(1);
  if (rows.length === 0) {
    console.error(`[FAIL] MID row ${midId} not found in merchant_mids`);
    process.exit(1);
  }
  const midRow = rows[0];
  const midMasked = maskMid(midRow.mid);
  const processorName = midRow.processorName || "payarc";
  console.log(`[OK] MID row found: ${midMasked} (status=${midRow.status}, processor=${processorName})`);

  // ── Step 2: Activation snapshot gate ──────────────────────────────────────

  console.log("\n[REV-06A] Checking activation snapshot gate...");

  // Sandbox_verified snapshot (migration 0238) authorizes:
  //   get_charges, get_daily_stats, get_disputes
  // HeldResult operations: get_residuals, submit_dispute_evidence
  const candidateOps = ["get_charges", "get_daily_stats", "get_disputes", "get_residuals", "submit_dispute_evidence"];
  const snapshotResults: Record<string, { granted: boolean; reason: string; authorizedBaseUrl?: string | null }> = {};

  let dailyStatsBaseUrl: string | null = null;
  let chargesBaseUrl: string | null = null;

  for (const op of candidateOps) {
    try {
      const snap = await requireConfirmedActivationSnapshot(processorName, op);
      snapshotResults[op] = { granted: true, reason: "snapshot_authorized", authorizedBaseUrl: snap.authorizedBaseUrl };
      console.log(`  ✓ ${op}: AUTHORIZED (base=${snap.authorizedBaseUrl ?? "null"})`);
      if (op === "get_daily_stats") dailyStatsBaseUrl = snap.authorizedBaseUrl;
      if (op === "get_charges") chargesBaseUrl = snap.authorizedBaseUrl;
    } catch (e: any) {
      snapshotResults[op] = { granted: false, reason: e?.code ?? e?.message?.slice(0, 80) ?? "error" };
      console.log(`  ✗ ${op}: BLOCKED — ${snapshotResults[op].reason}`);
    }
  }

  const grantedOps = Object.entries(snapshotResults).filter(([, v]) => v.granted).map(([k]) => k);

  // ── Step 3: Invoke adapter for authorized operations ───────────────────────

  console.log(`\n[REV-06A] Executing ${grantedOps.length} authorized operation(s)...`);

  const adapter = getProcessor(processorName) ?? getDefaultProcessor();
  const results: Record<string, unknown> = {};

  if (snapshotResults["get_daily_stats"]?.granted) {
    console.log(`\n  → getDailyStats(${midMasked}, ${startDate}, ${endDate})`);
    try {
      const stats = await adapter.getDailyStats(midRow.mid, startDate, endDate, {
        snapshotAuthorizedBaseUrl: dailyStatsBaseUrl,
      });
      if (Array.isArray(stats)) {
        console.log(`     Result: ${stats.length} statement(s)`);
        if (stats.length === 0) {
          console.log("     (Sandbox account has no statement data for this date range — empty is correct, not an error)");
        }
        results["get_daily_stats"] = { status: "ok", count: stats.length, sample: stats.slice(0, 2) };
      } else {
        console.log(`     HeldResult: ${(stats as any).reason}`);
        results["get_daily_stats"] = { status: "held", reason: (stats as any).reason };
      }
    } catch (err: any) {
      console.error(`     Error: ${err?.message}`);
      results["get_daily_stats"] = { status: "error", error: err?.message };
    }
  }

  if (snapshotResults["get_charges"]?.granted) {
    console.log(`\n  → getTransactions(${midMasked}, ${startDate}, ${endDate})`);
    try {
      const txns = await adapter.getTransactions(midRow.mid, startDate, endDate, {
        snapshotAuthorizedBaseUrl: chargesBaseUrl,
      });
      if (Array.isArray(txns)) {
        console.log(`     Result: ${txns.length} charge(s)`);
        if (txns.length === 0) {
          console.log("     (Sandbox account has no charge data for this date range — empty is correct, not an error)");
        }
        results["get_charges"] = { status: "ok", count: txns.length, sample: txns.slice(0, 2) };
      } else {
        console.log(`     HeldResult: ${(txns as any).reason}`);
        results["get_charges"] = { status: "held", reason: (txns as any).reason };
      }
    } catch (err: any) {
      console.error(`     Error: ${err?.message}`);
      results["get_charges"] = { status: "error", error: err?.message };
    }
  }

  // Report held operations
  for (const op of ["get_residuals", "submit_dispute_evidence"]) {
    if (!snapshotResults[op]?.granted) {
      results[op] = { status: "held", reason: snapshotResults[op]?.reason ?? "not authorized" };
    }
  }

  // ── Step 4: Summary ────────────────────────────────────────────────────────

  console.log("\n[REV-06A] Execution Summary:");
  console.log(`  MID (masked):       ${midMasked}`);
  console.log(`  Processor:          ${processorName}`);
  console.log(`  Date range:         ${startDate} → ${endDate}`);
  console.log(`  Authorized ops:     ${grantedOps.join(", ") || "none"}`);
  console.log(`  Completed at:       ${new Date().toISOString()}`);
  console.log("\n  Per-operation results:");
  for (const [op, result] of Object.entries(results)) {
    const r = result as any;
    if (r.status === "ok") {
      console.log(`    ✓ ${op}: ${r.count} record(s)`);
    } else {
      console.log(`    ✗ ${op}: ${r.status} — ${r.reason ?? r.error ?? ""}`);
    }
  }

  console.log("\n[REV-06A] Notes:");
  console.log("  • No recurring schedule was registered in this command.");
  console.log("  • Sandbox data arrays are expected to be empty — the sandbox merchant");
  console.log("    account has no processed transactions.");
  console.log("  • Production data requires a production_authorized snapshot and a");
  console.log("    production PAYARC_MERCHANT_API_KEY.");
  console.log("  • getResiduals: held — GET /residuals returns 405 (POST only); POST schema unknown.");
  console.log("  • submitDisputeEvidence: held — POST /cases/{id}/upload not yet probed.");
  console.log("─".repeat(70) + "\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("[REV-06A] Fatal error:", e?.message ?? e);
  process.exit(1);
});
