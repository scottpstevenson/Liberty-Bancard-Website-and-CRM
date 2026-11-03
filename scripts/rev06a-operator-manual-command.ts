#!/usr/bin/env npx tsx
/**
 * rev06a-operator-manual-command.ts — REV-06A Operator Manual Command (revised, Task #1777)
 *
 * Manual, read-only, ONE-TIME command. It runs exactly the operation you name, with the
 * explicit scope you give, after the per-operation activation snapshot gate passes.
 * It prints precise holds and masked counts/metadata only — never sample rows, case ids,
 * identifiers, or amounts — and it never ingests, posts, reconciles, pays, uploads evidence,
 * calls Connect/terminal endpoints, or changes lifecycle state. No schedule is registered.
 *
 * Operations (snapshot operation that must authorize each, separately):
 *   transactions              merchant key  GET /charges                    get_charges        (needs --mid-id)
 *   daily-stats               merchant key  GET /merchant_statements        get_daily_stats    (needs --mid-id)
 *   dispute-cases             merchant key  GET /cases                      get_disputes       (--mid-id optional; binds MID)
 *   dispute-chart             merchant key  GET /dispute-chart (aggregate)  get_dispute_chart
 *   batch-reports             partner key   GET /agent/batch/reports        get_batch_reports  (needs --batch-filter-placement)
 *   residual-summary          partner key   GET /agent_residual/summary     get_residual_summary         (needs --bank)
 *   residual-table-summaries  partner key   GET /residual_table_summaries   get_residual_table_summaries
 *   residual-details          partner key   GET /residual-details           get_residual_details
 *
 * Scope flags: --start-date/--end-date (YYYY-MM-DD) or --month YYYY-MM (batch/residual/disputes),
 *   --bank NNNN, --agent-id N, --mid-id <merchant_mids.id>, --batch-filter-placement query|body.
 *
 * With no --operation the legacy pair (daily-stats + transactions) runs, as before.
 *
 * Usage:
 *   npx tsx scripts/rev06a-operator-manual-command.ts --mid-id 12 --start-date 2026-08-01 --end-date 2026-08-31
 *   npx tsx scripts/rev06a-operator-manual-command.ts --operation residual-summary --bank <bank> --month 2026-09
 *   npx tsx scripts/rev06a-operator-manual-command.ts --operation dispute-cases --start-date 2026-10-01 --end-date 2026-10-31
 *
 * A snapshot that does not list an operation blocks that operation; the owner must grant it.
 * A merchant-key response is one merchant account, never portfolio-wide coverage.
 */

import { db } from "../server/db";
import { merchantMids } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireConfirmedActivationSnapshot } from "../server/services/processors/registry";
import { getProcessor, getDefaultProcessor } from "../server/services/processors/registry";
import { maskMid } from "../server/utils/mask-mid";
import { monthToWindow, residualOperationFor } from "../server/services/processors/payarc-reads";
import { summarizeRead } from "../server/services/processors/payarc-read-summary";
import type { BatchFilterPlacement, ResidualSource } from "../server/services/processors/payarc-report-types";

const OPERATIONS = [
  "transactions",
  "daily-stats",
  "dispute-cases",
  "dispute-chart",
  "batch-reports",
  "residual-summary",
  "residual-table-summaries",
  "residual-details",
] as const;
type Operation = (typeof OPERATIONS)[number];

const SNAPSHOT_OP: Record<Operation, string> = {
  transactions: "get_charges",
  "daily-stats": "get_daily_stats",
  "dispute-cases": "get_disputes",
  "dispute-chart": "get_dispute_chart",
  "batch-reports": "get_batch_reports",
  "residual-summary": residualOperationFor("agent_residual_summary"),
  "residual-table-summaries": residualOperationFor("residual_table_summaries"),
  "residual-details": residualOperationFor("residual_details"),
};

// ── CLI Argument Parsing ───────────────────────────────────────────────────────

interface Args {
  operations: Operation[];
  midId?: number;
  startDate: string;
  endDate: string;
  bank?: string;
  agentId?: string;
  placement?: BatchFilterPlacement;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const die = (m: string): never => {
    console.error(m);
    process.exit(1);
  };
  const op = get("--operation");
  if (op !== undefined && !(OPERATIONS as readonly string[]).includes(op)) die(`--operation must be one of: ${OPERATIONS.join(", ")}`);
  const operations: Operation[] = op ? [op as Operation] : ["daily-stats", "transactions"];

  const midIdStr = get("--mid-id");
  const month = get("--month");
  let startDate = get("--start-date");
  let endDate = get("--end-date");
  if (month) {
    const w = monthToWindow(month);
    if (!w) die("--month must be YYYY-MM");
    if (startDate || endDate) die("use either --month or --start-date/--end-date, not both");
    startDate = w!.fromDate;
    endDate = w!.toDate;
  }
  if (!startDate || !endDate) {
    die("Usage: --start-date YYYY-MM-DD --end-date YYYY-MM-DD (or --month YYYY-MM) is required; reads are always bounded");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate!)) die("--start-date must be YYYY-MM-DD");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate!)) die("--end-date must be YYYY-MM-DD");
  if (startDate! > endDate!) die("--start-date must be <= --end-date");

  let midId: number | undefined;
  if (midIdStr !== undefined) {
    midId = parseInt(midIdStr, 10);
    if (Number.isNaN(midId)) die("--mid-id must be a number");
  }
  if ((operations.includes("transactions") || operations.includes("daily-stats")) && midId === undefined) {
    die("--mid-id is required for transactions and daily-stats");
  }
  const placement = get("--batch-filter-placement");
  if (placement !== undefined && placement !== "query" && placement !== "body") die("--batch-filter-placement must be query or body");
  const bank = get("--bank");
  if (bank !== undefined && !/^\d{4}$/.test(bank)) die("--bank must be four digits");
  const agentId = get("--agent-id");
  if (agentId !== undefined && !/^\d+$/.test(agentId)) die("--agent-id must be digits");

  return { operations, midId, startDate: startDate!, endDate: endDate!, bank, agentId, placement: placement as BatchFilterPlacement | undefined };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { operations, midId, startDate, endDate, bank, agentId, placement } = parseArgs();

  console.log("\n[REV-06A] Operator Manual Command (read-only)");
  console.log(`  Operations: ${operations.join(", ")}`);
  console.log(`  Date range: ${startDate} → ${endDate}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log("─".repeat(70));

  // ── Step 1: Optional MID row (binds results to one canonical MID generation) ──
  let mid: string | undefined;
  let processorName = "payarc";
  let midMasked: string | null = null;
  if (midId !== undefined) {
    const rows = await db.select().from(merchantMids).where(eq(merchantMids.id, midId)).limit(1);
    if (rows.length === 0) {
      console.error(`[FAIL] MID row ${midId} not found in merchant_mids`);
      process.exit(1);
    }
    mid = rows[0].mid;
    midMasked = maskMid(mid);
    processorName = rows[0].processorName || "payarc";
    console.log(`[OK] MID row ${midId}: ${midMasked} (status=${rows[0].status}, processor=${processorName})`);
  }

  const adapter = getProcessor(processorName) ?? getDefaultProcessor();
  const window = { fromDate: startDate, toDate: endDate };
  const results: Record<string, unknown> = {};

  for (const operation of operations) {
    const snapshotOp = SNAPSHOT_OP[operation];
    console.log(`\n[${operation}] snapshot operation: ${snapshotOp}`);

    // ── Per-operation activation snapshot gate (revocation honored per operation) ──
    let baseUrl: string | null;
    try {
      baseUrl = (await requireConfirmedActivationSnapshot(processorName, snapshotOp)).authorizedBaseUrl;
      console.log("  ✓ AUTHORIZED by activation snapshot");
    } catch (e: any) {
      const reason = e?.code ?? e?.message?.slice(0, 80) ?? "error";
      console.log(`  ✗ BLOCKED — ${reason} (owner must grant this operation in an activation snapshot)`);
      results[operation] = { status: "held", code: "snapshot_not_authorized", reason };
      continue;
    }
    const options = { snapshotAuthorizedBaseUrl: baseUrl };

    try {
      let summary;
      switch (operation) {
        case "daily-stats": {
          const r = await adapter.getDailyStats(mid!, startDate, endDate, options);
          summary = Array.isArray(r)
            ? { status: "ok", recordCount: r.length, notes: ["empty is not reconciliation proof"] }
            : { status: "held", reason: r.reason, code: r.code };
          break;
        }
        case "transactions": {
          const r = await adapter.getTransactions(mid!, startDate, endDate, options);
          summary = Array.isArray(r)
            ? { status: "ok", recordCount: r.length, notes: ["empty is not reconciliation proof"] }
            : { status: "held", reason: r.reason, code: r.code };
          break;
        }
        case "dispute-cases":
          summary = summarizeRead(await adapter.listDisputeCases({ ...window, mid }, options));
          break;
        case "dispute-chart":
          summary = summarizeRead(await adapter.getDisputeChart(window, options));
          break;
        case "batch-reports":
          if (!placement) {
            summary = { status: "held", code: "filter_placement_unverified", reason: "pass --batch-filter-placement query|body (provider docs conflict)" };
          } else {
            summary = summarizeRead(await adapter.getBatchReports({ ...window, filterPlacement: placement, merchantAccountNumber: mid }, options));
          }
          break;
        default: {
          const source: ResidualSource =
            operation === "residual-summary"
              ? "agent_residual_summary"
              : operation === "residual-table-summaries"
                ? "residual_table_summaries"
                : "residual_details";
          summary = summarizeRead(await adapter.getResidualReport({ source, ...window, bank, mid, agentId }, options));
        }
      }
      results[operation] = summary;
    } catch (err: any) {
      results[operation] = { status: "error", error: String(err?.message ?? err).slice(0, 120) };
    }
  }

  console.log("\n[REV-06A] Execution Summary (masked; counts and metadata only):");
  console.log(`  MID (masked): ${midMasked ?? "not bound"}`);
  console.log(`  Processor:    ${processorName}`);
  console.log(JSON.stringify(results, null, 2));
  console.log("\n[REV-06A] Notes:");
  console.log("  • Read-only. Nothing was ingested, posted, reconciled, paid, uploaded, or scheduled.");
  console.log("  • Empty HTTP 200 responses show access only, not financial reconciliation.");
  console.log("  • submitDisputeEvidence stays held; webhook handling and Connect calls are out of scope.");
  console.log("─".repeat(70) + "\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("[REV-06A] Fatal error:", e?.message ?? e);
  process.exit(1);
});
