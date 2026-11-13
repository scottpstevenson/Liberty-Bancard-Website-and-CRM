import { spawnSync } from "node:child_process";

// Phase 6 mounted-component behavior with injected fetch (jsdom): real component code, URL state, actor transitions,
// late responses and state branches. No real sessions, handlers, database or providers; those are in the disposable-DB suites.
const suites: Array<{ file: string; marker: string }> = [
  { file: "client/src/components/work/SelectedTaskPanel.test.tsx", marker: "SELECTED_TASK_EVIDENCE_UI_PASS" },
  { file: "client/src/pages/dashboard/Notifications.test.tsx", marker: "NOTIFICATION_LIST_UI_PASS" },
  { file: "client/src/components/crm/WorkspaceTitle.test.tsx", marker: "WORKSPACE_TITLE_UI_PASS" },
  { file: "client/src/pages/dashboard/LeadOps/MaintenanceDisclosures.test.tsx", marker: "MAINTENANCE_DISCLOSURES_UI_PASS" },
];
let failed = false;
for (const suite of suites) {
  const run = spawnSync("npx", ["tsx", suite.file], { encoding: "utf8", timeout: 180_000 });
  const ok = run.status === 0 && run.stdout.includes(suite.marker);
  console.log(`${ok ? "PASS" : "FAIL"} ${suite.file}`);
  if (!ok) { failed = true; console.error(run.stdout.slice(-1500), run.stderr.slice(-1500)); }
}
if (failed) process.exit(1);
console.log("Phase 6 mounted component behavior: all suites passed (injected fetch; no sessions, DB or providers).");
