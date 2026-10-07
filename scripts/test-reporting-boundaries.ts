#!/usr/bin/env tsx
/**
 * Structural reporting boundary check. No server or database is required.
 * Run: npx tsx scripts/test-reporting-boundaries.ts
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { financialState, financialUrl } from "../client/src/lib/crm-destination-state";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const financialHub = read("client/src/pages/dashboard/FinancialHub.tsx");
const financialNavigation = new URL(financialUrl("tab=financial&financialTab=revenue&dealId=42", "#history", "forecasting"), "http://candidate.test");
const assertions: Array<[string, boolean]> = [
  ["nested reporting URL keeps parent tab", read("client/src/pages/dashboard/ReportingHub.tsx").includes('params.set("tab", v)')],
  ["financial URL state is namespaced", financialHub.includes("financialState(search)")
    && financialState("tab=financial&financialTab=forecasting").value === "forecasting"],
  ["financial navigation preserves reporting parent", financialHub.includes("financialUrl(search, window.location.hash, v as Tab)")
    && financialNavigation.pathname === "/dashboard/reporting"
    && financialNavigation.searchParams.getAll("tab").join() === "financial"
    && financialNavigation.searchParams.getAll("financialTab").join() === "forecasting"
    && financialNavigation.searchParams.get("dealId") === "42"
    && financialNavigation.hash === "#history"],
  ["reporting analytics exclude agents", ["/api/analytics/pipeline", "/api/analytics/support", "/api/analytics/tasks"].every(
    route => new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", requireRole\\("admin", "manager"\\)`).test(read("server/routes/analytics.ts")),
  )],
  ["operations reporting excludes agents", read("server/routes/acquisition.ts").includes('app.get("/api/reporting/operations", requireRole("admin", "manager")')],
  ["campaign/A-B route ownership is untouched", !read("server/routes/analytics.ts").includes("/api/sequences/trigger-ab-check")],
  ["support aggregate never uses capped ticket storage", !read("server/routes/analytics.ts").includes("storage.getTickets({ limit: 500 })")],
  ["task aggregate never uses array storage", !read("server/routes/analytics.ts").includes("storage.getTasks()")],
  ["support and shared task aggregates declare exact metadata",
    read("server/routes/analytics.ts").includes('scope: "all tickets"')
    && read("server/routes/analytics.ts").includes("meta: summaryRows.meta")
    && read("server/services/task-read-authority.ts").includes('population: "scoped_non_deleted_tasks"')
    && read("server/services/task-read-authority.ts").includes('snapshot: "statement"')],
  ["operations production aggregate excludes top-N truncation", !read("server/routes/acquisition.ts").includes("GROUP BY source ORDER BY leads::int DESC LIMIT 20")],
  ["operations does not use mutable lifecycle labels", !read("server/routes/acquisition.ts").includes("lifecycle_stage")],
  ["operations does not proxy conversions as replies", !read("server/routes/acquisition.ts").includes("converted ÷ enrolled")],
  ["operations declares production fact completeness", read("server/routes/acquisition.ts").includes("sequenceReplies: \"unavailable: no authoritative sequence-to-reply relation\"")],
  ["operations does not claim a shared snapshot", read("server/routes/acquisition.ts").includes('snapshotConsistency: "unavailable"')],
  ["operations exposes per-source capture limitations", read("server/routes/acquisition.ts").includes("sourceCapture:") && read("server/routes/acquisition.ts").includes("no shared transaction snapshot")],
  ["spend allocation is explicitly an estimate", read("server/routes/acquisition.ts").includes('kind: "estimate"') && read("client/src/pages/dashboard/OperationsReport.tsx").includes("Spend estimate assumption:")],
];

let failed = false;
for (const [label, passed] of assertions) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  failed ||= !passed;
}
process.exit(failed ? 1 : 0);