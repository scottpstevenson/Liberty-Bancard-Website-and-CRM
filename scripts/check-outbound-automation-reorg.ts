#!/usr/bin/env tsx
/**
 * scripts/check-outbound-automation-reorg.ts
 *
 * Task #1963 — static structural checks for the Outbound Center / Automation
 * / Lead Command Center reorganization. These assert on source text rather
 * than rendering the pages, matching this repo's existing static-check
 * scripts (e.g. scripts/check-api-coverage.ts) — the pages under test pull
 * live query data that isn't safe or meaningful to fabricate here, but the
 * structural facts below (labels, presence/absence of controls, route
 * wiring) are exactly what regresses silently if someone reverts part of
 * this reorg.
 *
 * Run:  npx tsx scripts/check-outbound-automation-reorg.ts
 * Exit: 0 = all pass, 1 = any fail
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
    failures.push(`${label}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

// ── 1. Outbound Center re-engagement tab + legacy alias ─────────────────────
console.log("\n1. Outbound Center re-engagement tab");
{
  const src = read("client/src/pages/dashboard/OutboundCenter.tsx");
  assert("prospects TabsTrigger keeps value=\"prospects\" (legacy ?tab=prospects alias)", /TabsTrigger value="prospects"/.test(src));
  assert("prospects tab is now labeled \"Re-engagement\", not \"Prospects\"", /Re-engagement/.test(src) && !/>\s*Prospects\s*</.test(src));
  assert("TabsContent for prospects still renders ColdLeads", /<TabsContent value="prospects"[\s\S]{0,200}ColdLeads/.test(src));
}

// ── 2. OutreachCommand narrowing ─────────────────────────────────────────────
console.log("\n2. OutreachCommand narrowed to read-only pipeline visibility");
{
  const src = read("client/src/pages/dashboard/OutreachCommand.tsx");
  const removedControls = [
    "import-corevt-full",
    "import-cordata",
    "startWorkerMutation",
    "stopWorkerMutation",
    "runDailyMutation",
    "syncToGhlMutation",
    "syncFromGhlMutation",
    "enrollHotLeadsMutation",
    "reEnrichMutation",
    "promoteMutation",
  ];
  for (const token of removedControls) {
    assert(`removed control/mutation "${token}" no longer present`, !src.includes(token));
  }
  assert("links out to Lead Ops Imports", src.includes("/dashboard/lead-ops?tab=imports"));
  assert("links out to Lead Ops enrichment/promotion", src.includes("/dashboard/lead-ops?tab=businesses"));
  assert("links out to standalone GHL Integration screen", src.includes("/dashboard/ghl-integration"));
  assert("signatures tab retained (live campaign-engine send path reads it)", src.includes('value="signatures"'));
  assert("outreach-sources read-only tab retained", src.includes('value="outreach-sources"'));
}
{
  const engine = read("server/services/campaign-engine.ts");
  assert(
    "campaign-engine.ts still reads stored email signatures on a live send path (justifies keeping the Signatures tab)",
    /getEmailSignatureHtml|getStoredSignature/.test(engine)
  );
}

// ── 3. OutboundCenter no longer mounts arbitrary workflow execution ────────
console.log("\n3. No arbitrary workflow execution added to Outbound Center");
{
  const outbound = read("client/src/pages/dashboard/OutboundCenter.tsx");
  const command = read("client/src/pages/dashboard/OutreachCommand.tsx");
  assert("OutboundCenter.tsx does not call /api/workflows/:id/run", !/\/api\/workflows\/.*\/run/.test(outbound));
  assert("OutreachCommand.tsx does not call /api/workflows/:id/run", !/\/api\/workflows\/.*\/run/.test(command));
}

// ── 4. LeadCommandCenter parity disposition ─────────────────────────────────
console.log("\n4. LeadCommandCenter direct sequence-enrollment + workflow-run loops disabled");
{
  const src = read("client/src/pages/dashboard/LeadCommandCenter.tsx");
  assert("enrollSequenceMutation removed (dead mutation deleted, not just unused)", !src.includes("enrollSequenceMutation"));
  assert("addToWorkflowMutation removed (dead mutation deleted, not just unused)", !src.includes("addToWorkflowMutation"));
  assert("\"Enroll in Sequence\" button is disabled with truthful retired copy", /button-enroll-sequence[\s\S]{0,50}/.test(src) && /Enroll in Sequence \(retired\)/.test(src));
  assert("\"Add to Workflow\" button is disabled with truthful retired copy", /Add to Workflow \(retired\)/.test(src));
  assert("no direct POST to /api/sequence-enrollments left in this legacy page", !src.includes('"/api/sequence-enrollments"'));
  assert("no direct POST to /api/workflows/:id/run left in this legacy page", !/\/api\/workflows\/\$\{.*\}\/run/.test(src));
}
{
  const appSrc = read("client/src/App.tsx");
  assert(
    "LeadCommandCenter is only reachable via the non-admin/manager legacy fallback (confirms the disable applies to the only live render path)",
    /function LegacyLeadCommandCenterRedirect[\s\S]{0,600}<LeadCommandCenter \/>/.test(appSrc)
  );
}

// ── 5. Automation.tsx reorganized in place, no new destination page ────────
console.log("\n5. Automation.tsx sections relabeled in place");
{
  const src = read("client/src/pages/dashboard/Automation.tsx");
  for (const label of ["Proposal Settings", "AI Command Center", "Run History", "Workflow Definitions", "Message Templates", "Sales Collateral"]) {
    assert(`section labeled "${label}" present`, src.includes(label));
  }
  const appSrc = read("client/src/App.tsx");
  const automationMounts = appSrc.match(/component=\{Automation\}/g) || [];
  assert("exactly one route mounts Automation.tsx (no duplicate mount created)", automationMounts.length === 1, `found ${automationMounts.length}`);
  assert("no new 'System Operations automation' page/route was introduced", !/system-operations.*automation|automation.*system-operations/i.test(appSrc));
}

// ── 6. Legacy bookmarks still resolve ───────────────────────────────────────
console.log("\n6. Legacy bookmarks still resolve");
{
  const appSrc = read("client/src/App.tsx");
  assert("/dashboard/outreach-command still redirects into Outbound Center", /outreach-command["\s\S]{0,200}outbound-center\?tab=command/.test(appSrc));
  assert("/dashboard/automation route still present", /path="\/dashboard\/automation"/.test(appSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFailures:");
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
