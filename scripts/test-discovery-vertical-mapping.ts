#!/usr/bin/env npx tsx
/**
 * Smoke test for the discovery vertical classification mapper (Task #721).
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

async function testMapperExports() {
  console.log("\n[1] normalizeDiscoveryVertical is exported alongside untouched classifyVertical callers");

  const mod = await import("../server/services/sdr/lead-finder");
  assert(typeof mod.normalizeDiscoveryVertical === "function", "normalizeDiscoveryVertical is exported");
  assert(Array.isArray(mod.CANONICAL_DISCOVERY_VERTICALS), "CANONICAL_DISCOVERY_VERTICALS is exported");

  const smartRouterSrc = (await import("fs")).readFileSync("server/services/smart-router.ts", "utf8");
  for (const v of mod.CANONICAL_DISCOVERY_VERTICALS) {
    assert(smartRouterSrc.includes(`"${v}"`), `Canonical vertical "${v}" appears verbatim in smart-router.ts ROUTING_RULES`);
  }
}

async function testMedSpaMapping() {
  console.log("\n[2] Med Spa mapping");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const cases = [
    { businessName: "Glow Medical Spa", rawCategory: "Medical spa" },
    { businessName: "Radiance Med Spa & Aesthetics", rawCategory: null },
    { businessName: "Downtown Botox & Fillers", rawCategory: "Botox clinic" },
    { businessName: "Elite Aesthetics Injectables", rawCategory: "aesthetics" },
    { businessName: "Injectables", rawCategory: "injectables" },
  ];

  for (const c of cases) {
    const result = normalizeDiscoveryVertical({ businessName: c.businessName, rawCategory: c.rawCategory });
    assert(result.canonicalVertical === "Med Spa", `"${c.businessName}" -> Med Spa`, `got ${result.canonicalVertical}`);
    assert(result.rawCategory === c.rawCategory, `rawCategory preserved unmodified for "${c.businessName}"`);
  }

  // Generic business name with no med-spa cue in the name at all — only the raw
  // provider category carries the signal. Proves rawCategory (not just
  // businessName) drives the mapping, which is what the primary discovery
  // insert path (dedupeAndInsert) depends on.
  const genericNameResult = normalizeDiscoveryVertical({ businessName: "ABC Wellness LLC", rawCategory: "medical spa" });
  assert(genericNameResult.canonicalVertical === "Med Spa", "Generic business name + raw category 'medical spa' still maps to Med Spa", genericNameResult.canonicalVertical);

  const injectablesOnlyResult = normalizeDiscoveryVertical({ businessName: "River City Wellness", rawCategory: "injectables" });
  assert(injectablesOnlyResult.canonicalVertical === "Med Spa", "Generic business name + raw category 'injectables' still maps to Med Spa", injectablesOnlyResult.canonicalVertical);
}

async function testSalonMapping() {
  console.log("\n[3] Salon mapping (must not swallow Med Spa)");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const cases = [
    "Sunny Hair Salon",
    "Joe's Barber Shop",
    "Polished Nail Salon",
    "Bella Beauty Salon",
  ];

  for (const businessName of cases) {
    const result = normalizeDiscoveryVertical({ businessName });
    assert(result.canonicalVertical === "Salon", `"${businessName}" -> Salon`, `got ${result.canonicalVertical}`);
  }
}

async function testDentalMapping() {
  console.log("\n[4] Dental mapping");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const cases = ["Bright Smiles Dentist", "Downtown Dental Clinic", "Family Orthodontist", "Advanced Oral Surgeon"];
  for (const businessName of cases) {
    const result = normalizeDiscoveryVertical({ businessName });
    assert(result.canonicalVertical === "Dental", `"${businessName}" -> Dental`, `got ${result.canonicalVertical}`);
  }
}

async function testAutoRepairMapping() {
  console.log("\n[5] Auto Repair mapping");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const cases = ["Precision Auto Repair", "Mike's Mechanic Shop", "Discount Tire Shop", "Downtown Body Shop"];
  for (const businessName of cases) {
    const result = normalizeDiscoveryVertical({ businessName });
    assert(result.canonicalVertical === "Auto Repair", `"${businessName}" -> Auto Repair`, `got ${result.canonicalVertical}`);
  }
}

async function testRestaurantMapping() {
  console.log("\n[6] Restaurant mapping");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const cases = ["The Corner Restaurant", "Tony's Pizza", "Sunset Sushi Bar", "Main Street Cafe"];
  for (const businessName of cases) {
    const result = normalizeDiscoveryVertical({ businessName });
    assert(result.canonicalVertical === "Restaurant", `"${businessName}" -> Restaurant`, `got ${result.canonicalVertical}`);
  }
}

async function testUnknownCategoryFallback() {
  console.log("\n[7] Unknown category falls back without crashing");
  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");

  const result = normalizeDiscoveryVertical({ businessName: "Acme Widget Manufacturing Co", rawCategory: "industrial supplier" });
  assert(typeof result.canonicalVertical === "string" && result.canonicalVertical.length > 0, "Unknown category does not crash and returns a string", JSON.stringify(result));
  assert(result.confidence === "low" || result.confidence === "medium", "Unknown category confidence is low/medium (not falsely high)", result.confidence);
  assert(!["Med Spa", "Salon", "Dental", "Auto Repair", "Restaurant"].includes(result.canonicalVertical), "Unknown category is not force-mapped into one of the 5 canonical verticals", result.canonicalVertical);

  const emptyResult = normalizeDiscoveryVertical({});
  assert(typeof emptyResult.canonicalVertical === "string", "Empty input does not crash");
}

async function testClassifyVerticalUntouched() {
  console.log("\n[8] classifyVertical() callers are unaffected (coarse buckets preserved)");
  const src = (await import("fs")).readFileSync("server/services/sdr/lead-finder.ts", "utf8");

  const classifyMatch = src.match(/function classifyVertical\(category: string \| null, name: string\): string \{[\s\S]*?\n\}/);
  assert(!!classifyMatch, "classifyVertical() function body still present verbatim");
  if (classifyMatch) {
    assert(classifyMatch[0].includes('return "Salon/Spa"'), "classifyVertical() still returns coarse 'Salon/Spa' bucket (untouched)");
    assert(classifyMatch[0].includes('return "Healthcare"'), "classifyVertical() still returns coarse 'Healthcare' bucket (untouched)");
  }

  const callSites = (src.match(/classifyVertical\(/g) || []).length;
  assert(callSites >= 5, `classifyVertical() still has its original call sites (found ${callSites})`, "expected >=5 (4 search fns + resolvedVertical calc)");
}

async function testSubverticalPersistence() {
  console.log("\n[9] subvertical is written at discovery insert time (static check)");
  const src = (await import("fs")).readFileSync("server/services/sdr/lead-finder.ts", "utf8");

  const subverticalWrites = (src.match(/subvertical:\s*discoveryMapping\.canonicalVertical/g) || []).length;
  assert(subverticalWrites === 2, `subvertical: discoveryMapping.canonicalVertical written in both insert paths (found ${subverticalWrites})`, "expected 2 (dedupeAndInsert + dedupeAndInsertFree)");

  assert(src.includes("vertical: biz.vertical,\n        subvertical:") || src.includes("vertical: resolvedVertical,\n        subvertical:"),
    "coarse vertical field remains alongside subvertical (not overwritten)");
}

async function testDedupeAndInsertUsesRealRawCategory() {
  console.log("\n[9b] Primary discovery insert path (dedupeAndInsert) feeds real provider category, not just the coarse bucket");
  const src = (await import("fs")).readFileSync("server/services/sdr/lead-finder.ts", "utf8");

  assert(
    src.includes("rawCategory: biz.category ?? null,\n        businessName: biz.businessName,\n        source: biz.source,\n        classifierBucket: biz.vertical,"),
    "dedupeAndInsert passes biz.category (raw provider category) as rawCategory into normalizeDiscoveryVertical, not just the coarse classifierBucket"
  );

  assert(
    src.includes("category?: string | null;"),
    "NormalizedBusiness interface carries a category field distinct from the coarse 'vertical' bucket"
  );

  const categoryAssignments = (src.match(/category:\s*(place\.category \|\| null|r\.category \?\? null)/g) || []).length;
  assert(categoryAssignments === 4, `All 4 paid-source search functions (serper, outscraper, apify, apollo) populate category from the raw provider payload (found ${categoryAssignments})`, "expected 4");

  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");
  const dedupeAndInsertStyleMapping = normalizeDiscoveryVertical({
    rawCategory: "medical spa",
    businessName: "Generic Wellness Group LLC",
    source: "outscraper",
    classifierBucket: "Salon/Spa",
  });
  assert(
    dedupeAndInsertStyleMapping.canonicalVertical === "Med Spa",
    "Simulated dedupeAndInsert call (raw category='medical spa', coarse bucket='Salon/Spa', generic name) still resolves subvertical to Med Spa, not Salon",
    dedupeAndInsertStyleMapping.canonicalVertical
  );
}

async function testPromotionRoutesOffSubvertical() {
  console.log("\n[10] Lead->contact promotion prefers subvertical over coarse vertical");
  const src = (await import("fs")).readFileSync("server/routes/sdr.ts", "utf8");

  assert(
    src.includes("vertical: merchant?.subvertical ?? lead.vertical ?? merchant?.vertical ?? null"),
    "Promotion path sets contacts.vertical from merchant.subvertical first, falling back to coarse vertical"
  );
}

async function testMedSpaRoutesToMedSpaSequence() {
  console.log("\n[11] Routing test: Med Spa canonicalVertical matches Med Spa sequence, not Salon/Spa");

  const { normalizeDiscoveryVertical } = await import("../server/services/sdr/lead-finder");
  const mapping = normalizeDiscoveryVertical({ businessName: "Radiant Med Spa", rawCategory: "medical spa" });
  assert(mapping.canonicalVertical === "Med Spa", "Med Spa business maps to canonical 'Med Spa'", mapping.canonicalVertical);

  // Simulate matchSequenceToRules() vertical-matching logic from smart-router.ts:
  // rule.verticals.some(v => vertical.toLowerCase().includes(v.toLowerCase()))
  const ROUTING_RULES_FIXTURE = [
    { verticals: ["Salon/Spa", "Salon", "Spa"], sequenceKeywords: ["v-salon", "salon"], priority: 11 },
    { verticals: ["Med Spa", "Medspa", "Medical Spa", "Aesthetic"], sequenceKeywords: ["v-med spa", "med spa"], priority: 12 },
  ];

  const vertical = mapping.canonicalVertical;
  const matchedRules = ROUTING_RULES_FIXTURE.filter(rule => rule.verticals.some(v => vertical.toLowerCase().includes(v.toLowerCase())));
  const topRule = matchedRules.sort((a, b) => b.priority - a.priority)[0];

  assert(!!topRule, "At least one routing rule matches the canonical vertical");
  assert(topRule?.sequenceKeywords.includes("med spa"), "Top-priority matched rule is the Med Spa sequence rule (not the generic Salon/Spa rule)", JSON.stringify(topRule));

  // A generic salon business should NOT match the Med Spa rule.
  const salonMapping = normalizeDiscoveryVertical({ businessName: "Classic Hair Salon" });
  const salonMatches = ROUTING_RULES_FIXTURE.filter(rule => rule.verticals.some(v => salonMapping.canonicalVertical.toLowerCase().includes(v.toLowerCase())));
  assert(salonMatches.length === 1 && salonMatches[0].sequenceKeywords.includes("salon"), "Generic salon maps only to the Salon/Spa rule, not Med Spa", JSON.stringify(salonMatches));
}

async function main() {
  console.log("=== Discovery Vertical Classification Mapping Smoke Test (Task #721) ===");

  await testMapperExports();
  await testMedSpaMapping();
  await testSalonMapping();
  await testDentalMapping();
  await testAutoRepairMapping();
  await testRestaurantMapping();
  await testUnknownCategoryFallback();
  await testClassifyVerticalUntouched();
  await testSubverticalPersistence();
  await testDedupeAndInsertUsesRealRawCategory();
  await testPromotionRoutesOffSubvertical();
  await testMedSpaRoutesToMedSpaSequence();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error running tests:", err);
  process.exit(1);
});
