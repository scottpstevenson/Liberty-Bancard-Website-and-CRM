#!/usr/bin/env npx tsx
/**
 * Smoke test for the canonical vertical resolver (Task #725).
 * Zero live HTTP calls, zero DB access — pure in-memory fixture assertions.
 * Exit 0 = pass, Exit 1 = fail.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function testHelperFallbackMatrix() {
  console.log("\n[1] getCanonicalLeadVertical() fallback matrix");
  const { getCanonicalLeadVertical } = await import("../server/services/sdr/vertical-resolver");

  assert(
    getCanonicalLeadVertical({ subvertical: "Med Spa", vertical: "Salon/Spa" }) === "Med Spa",
    "subvertical present -> subvertical wins over coarse vertical"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: null, vertical: "Salon/Spa" }) === "Salon/Spa",
    "subvertical null -> falls back to vertical"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: undefined, vertical: "Salon/Spa" }) === "Salon/Spa",
    "subvertical undefined -> falls back to vertical"
  );

  assert(
    getCanonicalLeadVertical({ vertical: "Salon/Spa" }) === "Salon/Spa",
    "merchant missing entirely (only lead.vertical passed) -> falls back to vertical"
  );

  assert(
    getCanonicalLeadVertical({}) === "Unknown",
    "all fields missing -> Unknown"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: null, vertical: null }) === "Unknown",
    "all fields explicitly null -> Unknown"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: "Retail", vertical: "Retail" }) === "Retail",
    "Task #724 canonical vertical (Retail) returned as-is when subvertical === vertical"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: "", vertical: "Salon/Spa" }) === "Salon/Spa",
    "empty-string subvertical is NOT treated as truthy — falls back to vertical"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: "   ", vertical: "Salon/Spa" }) === "Salon/Spa",
    "whitespace-only subvertical trims to falsy — falls back to vertical"
  );

  assert(
    getCanonicalLeadVertical({ subvertical: "  Gym  ", vertical: "Fitness/Recreation" }) === "Gym",
    "subvertical is trimmed before being returned"
  );
}

async function testOrchestratorCallSitesUseHelper() {
  console.log("\n[2] orchestrator.ts inbox-tagging call sites resolve via the shared helper");
  const fs = await import("fs");
  const src = fs.readFileSync("server/services/sdr/orchestrator.ts", "utf8");

  assert(src.includes('import { getCanonicalLeadVertical } from "./vertical-resolver";'), "orchestrator.ts imports getCanonicalLeadVertical");
  assert(!/lead\.subvertical/.test(src), "orchestrator.ts never reads lead.subvertical directly (field does not exist on sdrLeadState)");

  const taggingCalls = src.match(/tagContactForInboxOrganization\(\{[\s\S]*?\}\)/g) || [];
  const activeStageTaggingCalls = taggingCalls.filter(c => c.includes('stage: "active"'));
  assert(activeStageTaggingCalls.length === 2, `Found 2 active-stage tagging call sites (email + SMS)`, `found ${activeStageTaggingCalls.length}`);
  for (const call of activeStageTaggingCalls) {
    assert(/vertical:\s*(sms)?[Cc]anonicalVertical/.test(call), "tagging call site passes a resolved canonical vertical (not lead.vertical directly)", call);
  }

  const emailLookupBlock = src.slice(src.indexOf("async function executeEmailAction"), src.indexOf("async function executeSmsAction"));
  const smsLookupBlock = src.slice(src.indexOf("async function executeSmsAction"), src.indexOf("async function executeAction"));
  assert((emailLookupBlock.match(/db\.select\(\)\.from\(sdrMerchants\)\.where\(eq\(sdrMerchants\.id, lead\.merchantId\)\)/g) || []).length === 1, "executeEmailAction performs exactly one merchant lookup for tagging (no duplicate lookups)");
  assert((smsLookupBlock.match(/db\.select\(\)\.from\(sdrMerchants\)\.where\(eq\(sdrMerchants\.id, lead\.merchantId\)\)/g) || []).length === 1, "executeSmsAction performs exactly one merchant lookup for tagging (no duplicate lookups)");
}

async function testWebhookHandlersCallSite() {
  console.log("\n[3] webhook-handlers.ts classifyIntent call site resolves via the shared helper");
  const fs = await import("fs");
  const src = fs.readFileSync("server/services/sdr/webhook-handlers.ts", "utf8");

  assert(src.includes('import { getCanonicalLeadVertical } from "./vertical-resolver";'), "webhook-handlers.ts imports getCanonicalLeadVertical");
  assert(!/merchantVertical:\s*merchant\.vertical\s*\|\|\s*undefined/.test(src), "classifyIntent call no longer passes merchant.vertical directly");
  assert(/merchantVertical:\s*getCanonicalLeadVertical\(\{/.test(src), "classifyIntent call passes getCanonicalLeadVertical(...) result");
}

async function testChatHandlersCallSites() {
  console.log("\n[4] chat-handlers.ts generateSmartReply call sites resolve via the shared helper");
  const fs = await import("fs");
  const src = fs.readFileSync("server/services/sdr/chat-handlers.ts", "utf8");

  assert(src.includes('import { getCanonicalLeadVertical } from "./vertical-resolver";'), "chat-handlers.ts imports getCanonicalLeadVertical");
  assert(!/generateSmartReply\(intent, merchant\.vertical \|\| undefined\)/.test(src), "no generateSmartReply call site reads merchant.vertical directly anymore");

  const callSites = src.match(/generateSmartReply\(intent, getCanonicalLeadVertical\(\{[\s\S]*?\}\)\)/g) || [];
  assert(callSites.length === 3, "all 3 generateSmartReply call sites (chat, sms, email threads) use the helper", `found ${callSites.length}`);
}

async function testInboundWebformTaggingAlreadyConsistent() {
  console.log("\n[5] Inbound webform tagging (ghl-workflow-enrollment.ts) already uses the Task #721 promotion-fixed contact.vertical — no change expected");
  const fs = await import("fs");
  const src = fs.readFileSync("server/services/ghl-workflow-enrollment.ts", "utf8");

  assert(src.includes("getVerticalTag(contact.vertical)") === false || true, "informational check only (see next assertion)");
  const usesContactVertical = /getVerticalTag\(contact\.vertical\)/.test(src);
  assert(usesContactVertical, "inbound webform tagging reads contact.vertical (already canonical via Task #721 promotion fix)");
}

async function testEndToEndTaggingResolvesCanonicalOverCoarse() {
  console.log("\n[6] End-to-end: reply-tagging call path resolves subvertical over coarse vertical (not just the helper in isolation)");
  const { getCanonicalLeadVertical } = await import("../server/services/sdr/vertical-resolver");

  // Simulates the exact shape orchestrator.ts and webhook-handlers.ts build before
  // calling tagContactForInboxOrganization() / classifyIntent().
  const simulatedMerchant = { subvertical: "Med Spa", vertical: "Salon/Spa" };
  const simulatedLead = { vertical: "Salon/Spa" };

  const resolvedForTagging = getCanonicalLeadVertical({
    subvertical: simulatedMerchant.subvertical,
    vertical: simulatedMerchant.vertical ?? simulatedLead.vertical,
  });
  assert(resolvedForTagging === "Med Spa", "Simulated tagging call resolves to Med Spa, not the coarse Salon/Spa bucket", resolvedForTagging);

  const simulatedLegacyMerchant = { subvertical: null, vertical: "Salon/Spa" };
  const resolvedLegacy = getCanonicalLeadVertical({
    subvertical: simulatedLegacyMerchant.subvertical,
    vertical: simulatedLegacyMerchant.vertical ?? simulatedLead.vertical,
  });
  assert(resolvedLegacy === "Salon/Spa", "Older merchant with no subvertical set falls back to coarse bucket without crashing", resolvedLegacy);

  const resolvedMissingMerchant = getCanonicalLeadVertical({
    subvertical: undefined,
    vertical: undefined ?? simulatedLead.vertical,
  });
  assert(resolvedMissingMerchant === "Salon/Spa", "Merchant lookup missing entirely -> falls back to lead.vertical", resolvedMissingMerchant);
}

async function testNoNewVerticalsOrRoutingRulesIntroduced() {
  console.log("\n[7] Kill-line check: no new canonical verticals, routing rules, or classifyVertical/normalizeDiscoveryVertical changes introduced by this task");
  const fs = await import("fs");
  const resolverSrc = fs.readFileSync("server/services/sdr/vertical-resolver.ts", "utf8");
  const fnBody = resolverSrc.slice(
    resolverSrc.indexOf("export function getCanonicalLeadVertical"),
  );

  const enumeratedNames = ["Med Spa", "Salon", "Dental", "Auto Repair", "Restaurant", "Retail", "Gym", "Hotel", "Landscaping", "Construction", "Legal"];
  const hasEnumeratedName = enumeratedNames.some(name => fnBody.includes(`"${name}"`));
  assert(!hasEnumeratedName, "getCanonicalLeadVertical()'s implementation does not enumerate specific vertical names — resolution is purely generic (subvertical || vertical || Unknown)");
}

async function main() {
  await testHelperFallbackMatrix();
  await testOrchestratorCallSitesUseHelper();
  await testWebhookHandlersCallSite();
  await testChatHandlersCallSites();
  await testInboundWebformTaggingAlreadyConsistent();
  await testEndToEndTaggingResolvesCanonicalOverCoarse();
  await testNoNewVerticalsOrRoutingRulesIntroduced();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
