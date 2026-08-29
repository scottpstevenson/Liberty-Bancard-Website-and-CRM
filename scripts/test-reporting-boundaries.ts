#!/usr/bin/env tsx
/**
 * Structural reporting boundary check. No server or database is required.
 * Run: npx tsx scripts/test-reporting-boundaries.ts
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assertions: Array<[string, boolean]> = [
  ["nested reporting URL keeps parent tab", read("client/src/pages/dashboard/ReportingHub.tsx").includes('params.set("tab", v)')],
  ["financial URL state is namespaced", read("client/src/pages/dashboard/FinancialHub.tsx").includes('get("financialTab")')],
  ["financial navigation preserves reporting parent", read("client/src/pages/dashboard/FinancialHub.tsx").includes('params.set("tab", "financial")')],
  ["reporting analytics exclude agents", ["/api/analytics/pipeline", "/api/analytics/support", "/api/analytics/tasks"].every(
    route => new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", requireRole\\("admin", "manager"\\)`).test(read("server/routes/analytics.ts")),
  )],
  ["operations reporting excludes agents", read("server/routes/acquisition.ts").includes('app.get("/api/reporting/operations", requireRole("admin", "manager")')],
  ["campaign/A-B route ownership is untouched", !read("server/routes/analytics.ts").includes("/api/sequences/trigger-ab-check")],
  ["support aggregate never uses capped ticket storage", !read("server/routes/analytics.ts").includes("storage.getTickets({ limit: 500 })")],
  ["task aggregate never uses array storage", !read("server/routes/analytics.ts").includes("storage.getTasks()")],
  ["support and task aggregates declare exact metadata", ["scope: \"all tickets\"", "scope: \"non-deleted tasks\""].every(
    marker => read("server/routes/analytics.ts").includes(marker),
  )],
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