#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const leadOpsUi = read("client/src/pages/dashboard/LeadOpsCenter.tsx");
const programHealth = read("client/src/pages/dashboard/LeadOps/ProgramHealthPanel.tsx");
const sfpUi = read("client/src/components/lead-ops/SouthFloridaProspectingPanel.tsx");
const routes = read("server/routes/lead-ops.ts");
const providerControls = read("server/services/paid-provider-control.ts");

assert.doesNotMatch(leadOpsUi, /BudgetPreviewModal|useBudgetPreview|Aggregate Paid Budget|\$50|aggregatePaidBudget|spendCapMicros/);
assert.match(leadOpsUi, /AUTHORIZE PAID PILOT/);
assert.match(leadOpsUi, /paid-provider-approval/);
assert.match(leadOpsUi, /button-paid-provider-emergency-stop/);
assert.doesNotMatch(programHealth, /Provider Spend|Provider Budget|budgetCapUnits|dailyCap|apolloDailySpend/);
assert.doesNotMatch(sfpUi, /cost-preview|Estimated cost|Worst-case cost|Max \(hard cap\)|\$\{serperBatchSize/);
assert.match(sfpUi, /Approve Serper provider for this cohort/);
assert.match(sfpUi, /does not change its configured limit/);
assert.match(routes, /app\.post\("\/api\/lead-ops\/pilot\/paid-provider-approval"/);
assert.match(routes, /app\.post\("\/api\/lead-ops\/pilot\/emergency-stop-paid"/);
assert.match(routes, /circuit_state !== "closed"/);
assert.doesNotMatch(routes, /assertAggregatePaidBudgetAvailable/);
assert.doesNotMatch(routes, /local_budget_units=\$\{cap\}|local_budget_units=\$\{finalCap\}/);
assert.doesNotMatch(routes, /maxUsdMicros must be|spendCapMicros: level/);
assert.doesNotMatch(providerControls, /budgetCapUnits|dailyCap:/);

console.log("Lead Ops budget removal checks passed.");