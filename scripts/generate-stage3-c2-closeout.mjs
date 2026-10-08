import fs from "node:fs";

// Reporting only: no application imports, credentials, DB or provider access.
const dir = "docs/certification/stage3-c2";
const controls = JSON.parse(fs.readFileSync(`${dir}/controls.json`, "utf8"));
const browser = JSON.parse(fs.readFileSync(`${dir}/browser-receipts.json`, "utf8"));
const columns = [
  "kind", "id", "original_owner_crosswalk", "control", "file", "line",
  "role", "fixture_entity_prestate", "request_handler_middleware_result",
  "readback_reload_retry_cancel_conflict_denial", "effects",
  "viewport_theme_keyboard", "candidate_source", "compiled_identity",
  "serving_identity", "verdict", "qualification_remaining_owner", "receipt",
];
const rows = controls.controls.map(control => ({
  kind: "source-inventory", id: control.id,
  original_owner_crosswalk: "ownership.json and control-action-crosswalk.csv",
  control: control.testId || control.element, file: control.file, line: control.line,
  role: "UNTESTED", fixture_entity_prestate: "UNTESTED",
  request_handler_middleware_result: "UNTESTED",
  readback_reload_retry_cancel_conflict_denial: "UNTESTED",
  effects: "Not measured", viewport_theme_keyboard: "UNTESTED",
  candidate_source: "Existing census identity; not refreshed at closeout",
  compiled_identity: "Not attributed", serving_identity: "Not verified",
  verdict: "UNTESTED", qualification_remaining_owner: control.owner,
  receipt: "controls.json; not automatically joined to browser cases",
}));
for (const [index, observation] of browser.receipts.entries()) {
  rows.push({
    kind: "bounded-browser-observation", id: `C2-BROWSER-${index + 1}`,
    original_owner_crosswalk: "ownership.json; individual control attribution remains open",
    control: observation.control || observation.page || "Bounded observation",
    role: observation.role || "See receipt",
    fixture_entity_prestate: "See exact browser-receipts.json observation",
    request_handler_middleware_result: "Real synthetic sessions/CSRF/object middleware; see receipt",
    readback_reload_retry_cancel_conflict_denial: "Only states explicitly recorded in observation",
    effects: `Suite external effects: ${browser.externalEffects}`,
    viewport_theme_keyboard: "Only dimensions/input explicitly recorded in observation",
    candidate_source: browser.identity.sourceHead,
    compiled_identity: `${browser.identity.inputHash}/${browser.identity.outputHash}`,
    serving_identity: "Isolated compiled-client/source-handler construction only",
    verdict: "PASS",
    qualification_remaining_owner: "Bounded case; not unique-control/all-state/final-source acceptance",
    receipt: `browser-receipts.json#/receipts/${index}`,
  });
}
for (const [id, control, verdict, qualification] of [
  ["C2-FINAL-SITE", "Final anonymous-site read/link/draft compatibility", "UNTESTED", "C2/existing live-chat owner; syntax only"],
  ["C2-FINAL-ENTER", "Explicit composer focus before paused Enter", "UNTESTED", "C2 consumer; refinement syntax only"],
  ["C2-HANDLER-WINDOW", "Outside-window fixture assumption", "UNTESTED", "Prior handler run failed; corrected fixture not rerun"],
  ["C1-INPUT-372", "C1 local input timing", "DEFECT", "372 ms exceeds 200 ms; shared C1/C2 performance owner; cause/base not adjudicated"],
  ["C2-TYPECHECK-TIMEOUT", "Final npm run check", "BLOCKED", "60-second timeout without diagnostics; not a typecheck pass"],
]) rows.push({
  kind: "remaining-qualification", id, control, verdict,
  candidate_source: "Final changes follow compiled 4df9b86e",
  qualification_remaining_owner: qualification, serving_identity: "Not verified",
  receipt: "verification-status.md",
});
const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
fs.writeFileSync(`${dir}/actions.csv`,
  [columns, ...rows.map(row => columns.map(column => row[column]))]
    .map(row => row.map(escape).join(",")).join("\n") + "\n");
console.log(JSON.stringify({
  inventoryUntested: controls.controls.length,
  earlierBoundedBrowserObservations: browser.receipts.length,
  remainingQualificationRows: 5,
  completeControlCoverage: false,
  externalEffects: browser.externalEffects,
}));
