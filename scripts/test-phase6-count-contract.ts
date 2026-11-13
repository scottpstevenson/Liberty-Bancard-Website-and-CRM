/**
 * Phase 6 CRM-12: count contract (unit, scope, exclusions, as-of, completeness, authority, availability, history).
 *
 * Source/fixture proof only. It renders pure client components to static markup and reads source text. It reads no live
 * data and queries no database, so it proves the contract and the screen structure, not any production number.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import {
  POPULATION_STAGES, PEOPLE_TOTAL_NOTE, asOfLabel, contractLines, countHeadline, readCount, type CountContract,
} from "../client/src/lib/count-contract";
import { CountTile, NamedDisclosure, PopulationStagesGuide } from "../client/src/components/crm/CountContractCard";

// The client components use the classic JSX transform, so React must be a global while they render.
(globalThis as any).React = React;

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const contract = (over: Partial<CountContract> = {}): CountContract => ({
  unit: "widgets", scope: "all widgets", exclusions: "gadgets", asOf: "2026-11-11T15:04:00.000Z",
  completeness: "complete", authority: "the widget ledger", temporal: "current", ...over,
});

// ── unavailable is never zero ───────────────────────────────────────────────────────────────────────────────
for (const [label, value, available] of [
  ["a failed source with a zero value", 0, false],
  ["a failed source with a null value", null, false],
  ["an unspecified availability", 5, undefined],
  ["NaN", Number.NaN, true],
  ["Infinity", Number.POSITIVE_INFINITY, true],
  ["a negative number", -1, true],
  ["a string", "12", true],
  ["undefined", undefined, true],
] as const) {
  const reading = readCount(value, available, contract());
  eq(reading.availability, "unavailable", `${label} is unavailable`);
  eq(reading.value, null, `${label} carries no number`);
  eq(countHeadline(reading), "Unavailable", `${label} reads as words, never as 0`);
}
eq(countHeadline(readCount(0, true, contract())), "0", "a successfully read zero is a real zero");
eq(countHeadline(readCount(160581, true, contract())), "160,581", "a count is grouped for reading");
eq(readCount(7, true, contract()).availability, "available", "a finite non-negative number from an answering source is available");

// ── as-of and the contract lines ─────────────────────────────────────────────────────────────────────────────
ok(/^as of /.test(asOfLabel("2026-11-11T15:04:00.000Z")), "a real time is labelled 'as of'");
eq(asOfLabel(null), "as-of time not reported", "a missing time is reported as missing");
eq(asOfLabel("not a time"), "as-of time not reported", "an unparsable time is not invented");
eq(asOfLabel(undefined), "as-of time not reported", "an undefined time is not invented");
const lines = contractLines(contract());
eq(lines.map(l => l.label), ["Unit", "Scope", "Leaves out", "When", "Completeness", "Authority"], "every count says the same six things in the same order");
ok(lines.every(l => l.text.length > 0), "no contract line is empty");
ok(contractLines(contract({ temporal: "historical" })).find(l => l.label === "When")!.text.startsWith("Historical total."), "a historical total says so before its time");
ok(!contractLines(contract({ temporal: "current" })).find(l => l.label === "When")!.text.includes("Historical"), "a current total is not called historical");
ok(/Partial/.test(contractLines(contract({ completeness: "partial" })).find(l => l.label === "Completeness")!.text), "partial completeness is stated");
ok(/not reported/i.test(contractLines(contract({ completeness: "unknown" })).find(l => l.label === "Completeness")!.text), "unknown completeness is stated, not assumed whole");
ok(/Not read/.test(contractLines(contract(), "unavailable").find(l => l.label === "Completeness")!.text), "an unavailable count says it was not read, even if the contract was complete");

// ── CountTile renders the contract and never a zero for a failure ─────────────────────────────────────────
const failedHtml = renderToStaticMarkup(React.createElement(CountTile, { label: "Staged", testId: "t", reading: readCount(0, false, contract()) }));
ok(failedHtml.includes('data-availability="unavailable"'), "the tile marks an unavailable count");
ok(failedHtml.includes(">Unavailable<"), "the tile shows the word Unavailable");
ok(!/>0</.test(failedHtml), "the tile shows no zero for a failed read");
ok(failedHtml.includes("What this counts") && failedHtml.includes("the widget ledger"), "the contract is behind the tile");
const histHtml = renderToStaticMarkup(React.createElement(CountTile, { label: "Old", testId: "h", reading: readCount(3, true, contract({ temporal: "historical" })) }));
ok(histHtml.includes('data-temporal="historical"') && histHtml.includes("Historical"), "a historical total is visibly labelled historical");
const pctHtml = renderToStaticMarkup(React.createElement(CountTile, { label: "Rate", testId: "r", suffix: "%", reading: readCount(80, true, contract()) }));
ok(pctHtml.includes("80%"), "a unit suffix follows an available number");
const pctFailed = renderToStaticMarkup(React.createElement(CountTile, { label: "Rate", testId: "r", suffix: "%", reading: readCount(null, true, contract()) }));
ok(!pctFailed.includes("%</div>") && pctFailed.includes("Unavailable"), "a unit suffix is never attached to an unavailable count");

// ── the eight population words ───────────────────────────────────────────────────────────────────────────────
eq(POPULATION_STAGES.map(s => s.key), ["discovered", "linked", "classified", "selected", "validated", "prepared_held", "admitted", "sent"], "the eight words, in funnel order");
eq(new Set(POPULATION_STAGES.map(s => s.key)).size, 8, "no word is defined twice");
for (const stage of POPULATION_STAGES) {
  ok(stage.meaning.length > 20 && stage.notThis.length > 20 && stage.unit && stage.authority, `${stage.key} states meaning, what it is not, unit and authority`);
  ok(/^\/dashboard\/[a-z-]+/.test(stage.owner.href), `${stage.key} drills to a dashboard screen`);
  ok(!/\d{2,}/.test(`${stage.meaning} ${stage.notThis}`.replace(/\b180\b/g, "")), `${stage.key} carries no invented number`);
}
ok(POPULATION_STAGES.find(s => s.key === "admitted")!.notThis.includes("not admitted to send"), "admitted to validation is not read as admitted to send");
ok(POPULATION_STAGES.find(s => s.key === "sent")!.notThis.includes("held population has sent nothing"), "a held population has sent nothing");
ok(POPULATION_STAGES.find(s => s.key === "prepared_held")!.notThis.includes("Held means not sent"), "held means not sent");
ok(POPULATION_STAGES.find(s => s.key === "linked")!.notThis.includes("ownership evidence"), "directory and government domains need ownership evidence to count as linked");
ok(POPULATION_STAGES.find(s => s.key === "discovered")!.unit !== POPULATION_STAGES.find(s => s.key === "selected")!.unit, "discovered candidates and selected recipients are different units");
const guideHtml = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(PopulationStagesGuide, {})));
for (const stage of POPULATION_STAGES) ok(guideHtml.includes(`data-testid="population-stages-${stage.key}"`), `${stage.key} is rendered in the guide`);
ok(!/\b\d{1,3}(,\d{3})+\b/.test(guideHtml), "the guide shows no numbers, so no two populations can be made to look equal");
ok(PEOPLE_TOTAL_NOTE.includes("production records only") && PEOPLE_TOTAL_NOTE.includes("same record class"), "the People total note names the production scope and the condition for agreement");
const disclosureHtml = renderToStaticMarkup(React.createElement(NamedDisclosure, { testId: "d", title: "Raw", summary: "Reference only" }, React.createElement("p", {}, "inner")));
ok(disclosureHtml.includes("<details") && !disclosureHtml.includes("<details open"), "raw material opens collapsed");

// ── Program Health: summary first, raw behind named disclosures, controls stay visible ─────────────────────────
const panel = read("client/src/pages/dashboard/LeadOps/ProgramHealthPanel.tsx");
const at = (needle: string) => { const i = panel.indexOf(needle); assert.ok(i >= 0, `ProgramHealthPanel contains ${needle}`); checks++; return i; };
const summaryAt = at('data-testid="program-health-summary"');
const promotionAt = at("Routine SFP Candidate Promotion");
const heartbeatAt = at("Per-named-worker heartbeats");
const historicalAt = at('testId="disclosure-historical-counts"');
const diagnosticsAt = at('testId="disclosure-provider-diagnostics"');
const paidAt = at("<PaidProviderControlsPanel");
ok(summaryAt < promotionAt && promotionAt < heartbeatAt && heartbeatAt < historicalAt && historicalAt < diagnosticsAt && diagnosticsAt < paidAt,
  "order: current summary, promotion gate, heartbeats, historical disclosure, diagnostics disclosure, provider controls");
const historicalBody = panel.slice(historicalAt, diagnosticsAt);
ok(historicalBody.includes("Legacy Master-Lead Staging Counts") && historicalBody.includes("Legacy Sunbiz Enrichment Throughput"), "legacy staging and Sunbiz throughput sit behind the historical disclosure");
ok(historicalBody.includes("not the current South Florida population"), "the legacy staging card says it is not the current population");
ok(historicalBody.includes("temporal") === false && panel.includes('temporal: "historical"'), "legacy figures are marked historical through their contract");
const diagnosticsBody = panel.slice(diagnosticsAt, paidAt);
ok(diagnosticsBody.includes("Free Enrichment Scheduler") && diagnosticsBody.includes("CRO-03C Readiness"), "scheduler and provider-gate checks sit behind the diagnostics disclosure");
const beforePaid = panel.slice(0, paidAt);
eq((beforePaid.match(/<NamedDisclosure\b/g) ?? []).length, (beforePaid.match(/<\/NamedDisclosure>/g) ?? []).length, "every disclosure is closed before the provider controls");
ok(!diagnosticsBody.includes("<PaidProviderControlsPanel"), "the provider emergency stop stays visible and is not hidden in a disclosure");
ok(panel.includes("readCount(") && !/value\s*\?\?\s*0\b/.test(panel) && !/\|\|\s*0\)/.test(summaryBlock(panel)), "the summary reads through readCount and never substitutes 0");
function summaryBlock(source: string) { const a = source.indexOf("const summaryReadings"); return source.slice(a, source.indexOf("] as const;", a)); }
ok(panel.includes("QueueDepthCell") && panel.includes("never 0"), "queue depths are typed as availability-carrying cells");
ok(panel.includes('data-testid="program-health-asof"') && panel.includes("asOfLabel(asOf)"), "the page states when it was read");
ok(panel.includes("summary-unavailable-sources") && panel.includes("none is treated as zero"), "failed sources are listed, not zeroed");
ok(panel.includes("PopulationStagesGuide"), "the eight populations are explained on the page");
ok(!panel.includes("Candidate funnel data unavailable"), "the promotion gate is not hidden when the candidate counts fail");

// ── server: the health response names the snapshot time ─────────────────────────────────────────────────────
const leadOps = read("server/routes/lead-ops.ts");
ok(/const asOf = _healthCache \? new Date\(_healthCache\.ts\)\.toISOString\(\) : null;/.test(leadOps), "the health route derives asOf from the cached snapshot time");
ok(/res\.json\(\{\s*\.\.\.data,\s*asOf,/.test(leadOps), "asOf is returned with the health response");

// ── Canonical backlog: glossary first, raw receipts behind a named disclosure ───────────────────────────────
const backlog = read("client/src/pages/dashboard/CanonicalBacklog.tsx");
const glossaryAt = backlog.indexOf('testId="disclosure-population-words"');
const inventoryAt = backlog.indexOf("<LaunchInventory key=\"launch-inventory\" isAdmin={isAdmin} />");
const funnelAt = backlog.indexOf("<Funnel data={data} />");
const rawAt = backlog.indexOf('testId="disclosure-raw-receipts"');
ok(glossaryAt > 0 && glossaryAt < inventoryAt && inventoryAt < funnelAt && funnelAt < rawAt, "backlog order: glossary, launch inventory, funnel, raw receipts disclosure");
ok(backlog.slice(rawAt).includes("Original-row receipts") && backlog.slice(rawAt).includes("Provider operations"), "original-row receipts and provider operations sit inside the raw disclosure");
ok(!backlog.slice(0, rawAt).includes("<h3 className=\"font-semibold\">Original-row receipts</h3>"), "original-row receipts are not shown inline above the disclosure");

// ── People totals: desktop and mobile share the production default and say so ───────────────────────────────
const mobile = read("client/src/pages/mobile/MobileHome.tsx");
ok(/useContactsFacets\(\{ recordClass: "production" \}\)/.test(mobile), "mobile Home reads the production record class like desktop People");
ok(mobile.includes("People · production records") && !mobile.includes("scoped total"), "mobile Home labels its scope");
ok(mobile.includes("text-total-contacts-scope") && mobile.includes("Test, demo and synthetic records are not counted here"), "mobile Home says what it leaves out");
const contacts = read("client/src/pages/dashboard/Contacts.tsx");
ok(contacts.includes('const recordClassFilter = peopleParams.get("recordClass") ?? "production";'), "desktop People defaults to production records");
ok(contacts.includes('"all record classes"') && contacts.includes("records`})"), "desktop People names its record class beside the total");
ok(read("scripts/test-stage3-c4-browser.ts").includes("/api/contacts/facets?recordClass=production"), "the browser suite reads the same scope the mobile tile displays");

// ── R08: routine context first; maintenance and raw failure text behind named disclosures; no behavior change ────────────
const leadOpsSource = read("client/src/pages/dashboard/LeadOpsCenter.tsx");
const maintStart = leadOpsSource.indexOf('data-testid="lead-ops-maintenance"');
const maintEnd = leadOpsSource.indexOf("</details>", maintStart);
ok(maintStart > 0 && maintEnd > maintStart, "Lead Operations has a named Maintenance tools disclosure");
const maintenance = leadOpsSource.slice(maintStart, maintEnd);
ok(!/<details[^>]*\bopen\b/.test(leadOpsSource.slice(maintStart - 120, maintStart + 120)), "the maintenance disclosure starts closed");
ok(maintenance.includes("Maintenance tools") && maintenance.includes("Sync Owner Data") && maintenance.includes("Clear SLA Flood"), "both maintenance actions are inside it");
ok(/user\?\.role === "admin" && \(\s*<AlertDialog>/.test(maintenance), "Clear SLA Flood keeps its admin-only role check and confirmation dialog");
ok(maintenance.includes("writebackMutation.mutate()") && maintenance.includes("clearSlaMutation.mutate()"), "the same mutations are called");
const outsideMaintenance = leadOpsSource.slice(0, maintStart) + leadOpsSource.slice(maintEnd);
ok(!outsideMaintenance.includes("Sync Owner Data") && !outsideMaintenance.includes("Clear SLA Flood</"), "neither action is offered in the main flow any more");
ok(leadOpsSource.includes("AREA_ENTRY[prospectingAreaForTab(activeTab)]") && leadOpsSource.includes("<CrmAreaNav"), "the Prospecting area navigation is unchanged");
const health = read("client/src/pages/dashboard/LeadOps/ProgramHealthPanel.tsx");
ok(health.includes("Program Health could not be read right now") && health.includes('data-testid="program-health-retry"'), "Program Health states unavailability plainly with Retry");
ok(!/<p[^>]*>\{healthQuery\.error/.test(health) && !/\{pc\.error\}|\{h\?\.pipelineCounts\?\.error\}/.test(health.replace(/text=\{[^}]*\}/g, "")), "raw failure text is never a visible sentence");
ok(health.includes('testId="program-health-technical-details"') && health.includes('testId="legacy-pipeline-technical-details"'), "raw failure text goes to named Technical details disclosures");
ok(health.includes("<PaidProviderControlsPanel />"), "the paid-provider controls remain mounted");
const providerPanel = read("client/src/pages/dashboard/LeadOps/PaidProviderControlsPanel.tsx");
const stopAt = providerPanel.indexOf('data-testid="button-paid-provider-emergency-stop"');
const disclosureAt = providerPanel.indexOf('testId="disclosure-provider-controls"');
ok(stopAt > 0 && disclosureAt > stopAt, "the emergency stop is rendered before, and outside, the provider-state disclosure");
ok(providerPanel.includes('apiRequest("POST", "/api/lead-ops/pilot/emergency-stop-paid", { reason: "operator_emergency_stop" })'), "the emergency stop still calls the same admin route");
ok(providerPanel.includes('testId="paid-provider-controls-technical-details"') && providerPanel.includes("button-paid-provider-controls-retry"), "provider failures offer Retry and name their Technical details");

console.log(`Phase 6 count contract: ${checks} checks passed`);
