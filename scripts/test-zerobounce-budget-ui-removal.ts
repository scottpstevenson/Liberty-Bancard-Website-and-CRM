#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const contactsRoutes = read("server/routes/contacts.ts");
const dataQuality = read("client/src/pages/dashboard/DataQuality.tsx");
const campaign = read("client/src/components/ZeroBounceCampaign.tsx");
const operatorDashboard = read("client/src/pages/dashboard/OperatorDashboard.tsx");
const leadOpsCenter = read("client/src/pages/dashboard/LeadOpsCenter.tsx");

const qualitySummaryRoute = contactsRoutes.split('app.get("/api/contacts/quality-summary"')[1]?.split(
  'app.get("/api/contacts/quality-scan"',
)[0] ?? "";
const campaignRoute = contactsRoutes.split('app.get("/api/contacts/validate-emails-campaign"')[1]?.split(
  "// Reconnects the working Serper-backed contact enrichment path",
)[0] ?? "";
const backlogPanel = operatorDashboard.split("// ── ZeroBounce Backlog Panel")[1]?.split(
  "interface ScoringPreview",
)[0] ?? "";

assert.ok(qualitySummaryRoute);
assert.doesNotMatch(qualitySummaryRoute, /checkZeroBounceBudget|remainingToday|dailyLimit|usedToday/);
assert.ok(campaignRoute);
assert.doesNotMatch(campaignRoute, /dailyBudget|checkZeroBounceBudget/);
assert.doesNotMatch(contactsRoutes, /budgetRemaining|daily cap reached/);

assert.doesNotMatch(dataQuality, /summary\??\.zerobounce|remainingToday|daily cap|credits today|fallbackDailyLimit/);
assert.match(dataQuality, /disabled=\{batchMutation\.isPending\}/);

assert.doesNotMatch(campaign, /dailyBudget|dailyLimit|current limit|validations\/day|Daily limit reached|resume tomorrow/);
assert.match(campaign, /cardState === "paused"/);
assert.match(campaign, /disabled=\{isRunning \|\| startMutation\.isPending\}/);

assert.doesNotMatch(backlogPanel, /dailyLimit|remainingToday|usedToday|Daily Limit|Used Today|Est\. Clearance|validations\/day/);
assert.doesNotMatch(leadOpsCenter, /Spend by provider|spendByProvider/);

console.log("ZeroBounce budget UI/API removal checks passed.");