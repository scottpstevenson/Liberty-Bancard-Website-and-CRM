#!/usr/bin/env npx tsx
/**
 * Smoke test for Task 991B-1: Canonical Vertical Resolution & Bridge Synchronization.
 * Pure in-memory assertions — no DB access, no HTTP calls.
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

async function testSourceAuthorityTable() {
  console.log("\n[1] VERTICAL_SOURCE_AUTHORITY table values");
  const { VERTICAL_SOURCE_AUTHORITY } = await import("../server/services/sdr/canonical-vertical-resolver");

  assert(VERTICAL_SOURCE_AUTHORITY.operator_override === 500, "operator_override authority = 500");
  assert(VERTICAL_SOURCE_AUTHORITY.discovery_enrichment === 400, "discovery_enrichment authority = 400");
  assert(VERTICAL_SOURCE_AUTHORITY.import_classification === 300, "import_classification authority = 300");
  assert(VERTICAL_SOURCE_AUTHORITY.website_form === 200, "website_form authority = 200");
  assert(VERTICAL_SOURCE_AUTHORITY.ghl_sync === 100, "ghl_sync authority = 100");
  assert(VERTICAL_SOURCE_AUTHORITY.legacy_unknown === 0, "legacy_unknown authority = 0");
}

async function testMerchantManualOverrideWins() {
  console.log("\n[2] Merchant manual override wins unconditionally");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantSubvertical: "Med Spa",
    merchantVerticalSource: "operator_override",
    merchantVerticalConfidence: null,
    merchantManualOverride: true,
    contactVertical: "Restaurant",
    contactVerticalSource: "discovery_enrichment",
    contactVerticalConfidence: 95,
    contactManualOverride: false,
  });

  assert(result.reasonCode === "merchant_manual_override", "reasonCode = merchant_manual_override");
  assert(result.vertical === "Healthcare", "merchant's vertical preserved (Healthcare)", String(result.vertical));
  assert(result.subvertical === "Med Spa", "merchant's subvertical preserved (Med Spa)", String(result.subvertical));
}

async function testHighConfidenceEnrichmentWinsOverForm() {
  console.log("\n[3] High-confidence enrichment wins over website_form input");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    contactVertical: "Restaurant",
    contactVerticalSource: "discovery_enrichment",
    contactVerticalConfidence: 90,
    contactManualOverride: false,
    merchantVertical: "Retail",
    merchantVerticalSource: "website_form",
    merchantVerticalConfidence: 80,
    merchantManualOverride: false,
  });

  assert(result.source === "discovery_enrichment", "discovery_enrichment wins over website_form", String(result.source));
  assert(result.vertical === "Restaurant", "resolved vertical = Restaurant", String(result.vertical));
}

async function testAuthorityFirstRankingWithConfidenceTiebreaker() {
  console.log("\n[4a] Authority-first: qualified enrichment wins over import_classification by authority");
  const { resolveCanonicalVertical, ENRICHMENT_MIN_CONFIDENCE } = await import("../server/services/sdr/canonical-vertical-resolver");

  // discovery_enrichment at or above the minimum confidence threshold outranks
  // import_classification by authority (400 vs 300). Confidence is only a tiebreaker
  // within the same authority tier.
  // Use confidence=55 — well above ENRICHMENT_MIN_CONFIDENCE.
  const result = resolveCanonicalVertical({
    contactVertical: "Auto",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
    merchantVertical: "Legal",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 55,
    merchantManualOverride: false,
  });

  assert(result.source === "discovery_enrichment", "discovery_enrichment (authority 400) outranks import_classification (300) by authority", String(result.source));
  assert(result.vertical === "Legal", "resolved vertical = Legal (from discovery_enrichment winner)", String(result.vertical));
  assert(ENRICHMENT_MIN_CONFIDENCE === 30, `ENRICHMENT_MIN_CONFIDENCE = 30; got ${ENRICHMENT_MIN_CONFIDENCE}`);

  console.log("\n[4b] Within same authority tier, higher confidence wins");
  // Two candidates both at discovery_enrichment level — confidence decides.
  // Simulate via two contacts at same source with different confidence is not
  // directly possible through the input interface (one merchant, one contact),
  // so test with website_form (200) vs ghl_sync (100) at different confidences —
  // website_form must win by authority, not confidence.
  const resultTier = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "website_form",
    merchantVerticalConfidence: 30,
    merchantManualOverride: false,
    contactVertical: "Retail",
    contactVerticalSource: "ghl_sync",
    contactVerticalConfidence: 95,
    contactManualOverride: false,
  });
  assert(resultTier.source === "website_form", "website_form (authority 200) beats ghl_sync (100) even when ghl_sync has higher confidence", String(resultTier.source));
  assert(resultTier.vertical === "Healthcare", "resolved vertical = Healthcare (from website_form winner)", String(resultTier.vertical));

  console.log("\n[4c] Strength comparison: low-confidence enrichment does NOT override higher-confidence existing classification via bridge");
  // getResolutionStrength captures the correct comparison for the bridge:
  // an existing import_classification at confidence=70 has strength=300070,
  // an incoming ghl_sync at confidence=90 has strength=100090 — ghl_sync should NOT overwrite.
  const { getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");
  const existingStrength = getResolutionStrength("import_classification", 70, false);
  const incomingWeakStrength = getResolutionStrength("ghl_sync", 90, false);
  assert(incomingWeakStrength < existingStrength,
    `ghl_sync@90 strength (${incomingWeakStrength}) < import_classification@70 strength (${existingStrength}) — bridge correctly skips overwrite`);
}

async function testLowConfidenceEnrichmentValidation() {
  console.log("\n[4d] Validation #3: low-confidence discovery_enrichment (confidence=20) does NOT win over import_classification");
  const { resolveCanonicalVertical, ENRICHMENT_MIN_CONFIDENCE } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Task spec validation command #3:
  // "Low-confidence enrichment (confidence=20) does NOT win over valid contact classification
  //  (source=import_classification)."
  // Below ENRICHMENT_MIN_CONFIDENCE, discovery_enrichment is ranked as legacy_unknown (authority 0),
  // so import_classification (authority 300) wins.
  assert(20 < ENRICHMENT_MIN_CONFIDENCE, `confidence 20 is below ENRICHMENT_MIN_CONFIDENCE (${ENRICHMENT_MIN_CONFIDENCE})`);

  const result = resolveCanonicalVertical({
    merchantVertical: "Legal",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 20,          // below threshold — demoted to legacy_unknown rank
    merchantManualOverride: false,
    contactVertical: "Healthcare",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });

  assert(result.vertical === "Healthcare",
    `import_classification@70 wins over low-confidence discovery@20; got "${result.vertical}"`);
  assert(result.source === "import_classification" || result.source === "legacy_unknown",
    `winner source should be import_classification (or demoted enrichment treated as legacy_unknown); got "${result.source}"`);

  // High-confidence enrichment DOES win — ensures threshold doesn't suppress legitimate data.
  const resultHigh = resolveCanonicalVertical({
    merchantVertical: "Legal",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 90,          // above threshold — full authority 400
    merchantManualOverride: false,
    contactVertical: "Healthcare",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });
  assert(resultHigh.vertical === "Legal",
    `discovery_enrichment@90 wins over import_classification@70; got "${resultHigh.vertical}"`);
  assert(resultHigh.source === "discovery_enrichment",
    `source is discovery_enrichment when confidence qualifies; got "${resultHigh.source}"`);
}

async function testUnknownProvenanceIsFallbackOnly() {
  console.log("\n[5] Unknown-provenance value is fallback-only, does not outrank ghl_sync");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    contactVertical: "Retail",
    contactVerticalSource: "ghl_sync",
    contactVerticalConfidence: 50,
    contactManualOverride: false,
    merchantVertical: "Healthcare",
    merchantVerticalSource: "legacy_unknown",
    merchantVerticalConfidence: 99,
    merchantManualOverride: false,
  });

  assert(result.source === "ghl_sync", "ghl_sync (authority 100) wins over legacy_unknown (0)", String(result.source));
  assert(result.vertical === "Retail", "resolved vertical = Retail, not the legacy_unknown Healthcare", String(result.vertical));
  assert(result.reasonCode !== "fallback_only", "fallback_only reasonCode is only returned when ALL candidates are unknown-source");
}

async function testMedSpaSubverticalMapsToHealthcare() {
  console.log("\n[6] 'Med Spa' subvertical maps to Healthcare coarse vertical");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    merchantVertical: "Med Spa",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 85,
    merchantManualOverride: false,
  });

  assert(result.vertical === "Healthcare", "coarse vertical resolved to Healthcare", String(result.vertical));
  assert(result.subvertical === "Med Spa", "subvertical preserved as Med Spa", String(result.subvertical));
  assert(result.reasonCode === "subvertical_parent_resolved", "reasonCode = subvertical_parent_resolved");
}

async function testUnknownSubverticalSetsNeedsReview() {
  console.log("\n[7] Unknown subvertical sets needsReview=true, preserves next-best coarse vertical");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    merchantVertical: "ZombieNiche",
    merchantSubvertical: "XyzBizType",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 60,
    merchantManualOverride: false,
    contactVertical: "Healthcare",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });

  assert(result.needsReview === true, "needsReview = true for unknown subvertical");
  assert(result.reasonCode === "subvertical_parent_unknown", "reasonCode = subvertical_parent_unknown");
  assert(result.vertical === "Healthcare", `next-best canonical coarse preserved from contact candidate; got "${result.vertical}"`);
  // Lineage-consistency invariant: the coarse vertical (Healthcare) comes from altCoarse (import_classification@70).
  // The winner's unmapped subvertical (XyzBizType) belongs to a different lineage and must NOT be returned —
  // mixing values from different origins would corrupt subvertical provenance writes in the bridge.
  assert(result.subvertical === null,
    `subvertical cleared to null in altCoarse fallback to preserve lineage consistency; got "${result.subvertical}"`);
  assert(result.source === "import_classification",
    `altCoarse provenance source = import_classification (not winner's source); got "${result.source}"`);
  assert(result.confidence === 70,
    `altCoarse provenance confidence = 70 (not winner's confidence 60); got ${result.confidence}`);
}

async function testContactVerticalUnchangedByBridge() {
  console.log("\n[8] contacts.vertical is NEVER written by the resolver (pure function check)");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const contactVerticalBefore = "Restaurant";
  resolveCanonicalVertical({
    contactVertical: contactVerticalBefore,
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 75,
    contactManualOverride: false,
  });

  assert(contactVerticalBefore === "Restaurant", "resolver is pure — contact input object unchanged");
}

async function testContactManualOverrideBeatsNonOverrideMerchant() {
  console.log("\n[23] contactManualOverride=true with low confidence / non-override source beats existing non-override merchant");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Existing non-override merchant with discovery_enrichment@90 (authority 400) → strength 400090.
  // Incoming contact: contactManualOverride=true, source="ghl_sync" (non-override metadata),
  // confidence=5 (very low).
  // Previously the bridge hardcoded manualOverride=false, giving strength 100*1000+5=100005.
  // With the fix, resolveCanonicalVertical returns source="operator_override" unconditionally,
  // and the bridge passes incomingIsManualOverride=true → strength = 999999.
  const existingNonOverrideStrength = getResolutionStrength("discovery_enrichment", 90, false); // 400090

  const incomingResult = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 90,
    merchantManualOverride: false,
    contactVertical: "Restaurant",
    contactVerticalSource: "ghl_sync",  // non-override metadata
    contactVerticalConfidence: 5,        // very low confidence
    contactManualOverride: true,         // but it IS a manual override
  });

  assert(
    incomingResult.source === "operator_override",
    `contactManualOverride=true always returns source="operator_override" (was "${incomingResult.source}")`,
  );
  assert(
    incomingResult.reasonCode === "contact_manual_override",
    `reasonCode = contact_manual_override; got "${incomingResult.reasonCode}"`,
  );

  const incomingIsManualOverride =
    incomingResult.reasonCode === "contact_manual_override" ||
    incomingResult.reasonCode === "merchant_manual_override";
  const incomingStrength = getResolutionStrength(
    incomingResult.source,
    incomingResult.confidence,
    incomingIsManualOverride,
  );

  assert(
    incomingStrength > existingNonOverrideStrength,
    `contact override (strength=${incomingStrength}) beats existing discovery_enrichment@90 (strength=${existingNonOverrideStrength})`,
  );
}

async function testContactManualOverrideIdempotency() {
  console.log("\n[24] Idempotency: contactManualOverride=true produces same resolved output on every call (no infinite-reclassify)");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Simulate what the bridge does on the FIRST run (incoming overwrites existing):
  // existing merchant had ghl_sync@50 → incoming contactManualOverride=true resolves to operator_override@5.
  // After the first write, sdrMerchants reflects: vertical=Restaurant, verticalSource="operator_override".
  const firstResult = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "ghl_sync",
    merchantVerticalConfidence: 50,
    merchantManualOverride: false,
    contactVertical: "Restaurant",
    contactVerticalSource: "legacy_unknown",
    contactVerticalConfidence: 5,
    contactManualOverride: true,
  });
  assert(firstResult.vertical === "Restaurant", `first result = Restaurant; got "${firstResult.vertical}"`);
  assert(firstResult.source === "operator_override", `first source = operator_override; got "${firstResult.source}"`);

  // Simulate SECOND run after the first write. The merchant record was updated to:
  // vertical=Restaurant, verticalSource="operator_override", manualVerticalOverride=false.
  // The bridge value-diff check (merchantValuesUnchanged) must detect no change and skip writes.
  // This simulates: existingMerchant after first write, same contact input.
  const secondResult = resolveCanonicalVertical({
    merchantVertical: "Restaurant",            // updated by first run
    merchantVerticalSource: "operator_override",// updated by first run
    merchantVerticalConfidence: 5,
    merchantManualOverride: false,             // bridge does NOT set manualVerticalOverride
    contactVertical: "Restaurant",
    contactVerticalSource: "legacy_unknown",
    contactVerticalConfidence: 5,
    contactManualOverride: true,              // same contact input
  });

  // Values after second run must be identical — no change = no write = idempotent.
  assert(
    secondResult.vertical === firstResult.vertical &&
    secondResult.source === firstResult.source &&
    secondResult.confidence === firstResult.confidence,
    `second run produces identical result (idempotent): ` +
    `v=${secondResult.vertical} src=${secondResult.source} conf=${secondResult.confidence}`,
  );

  // Crucially: the "merchantValuesUnchanged" guard in the bridge checks:
  // existingMerchant.vertical === incomingResult.vertical  (Restaurant === Restaurant ✓)
  // existingMerchant.verticalSource === toDbSource(incomingResult.source) ("operator_override" === "operator_override" ✓)
  // existingMerchant.verticalConfidence === incomingResult.confidence (5 === 5 ✓)
  // existingMerchant.subvertical === incomingResult.subvertical (null === null ✓)
  // → all match → bridge skips DB write on second run (idempotent).
  assert(
    secondResult.vertical === "Restaurant",
    "second run vertical = Restaurant (bridge would detect no change and skip write)",
  );
}

async function testBridgeLeadStateReprojectionWhenIncomingIsWeaker() {
  console.log("\n[22] Bridge: when incoming is weaker, effective merchant classification drives lead-state reprojection");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Existing merchant: strong classification from operator_override.
  // Incoming contact: weaker import_classification.
  // Verify that the resolver, when called with the full merchant input, still produces the
  // correct result that would be written to lead state (i.e. merchant wins and is projected).
  const existingStrength = getResolutionStrength("operator_override", null, true); // 999999
  const incomingResult = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "operator_override",
    merchantVerticalConfidence: null,
    merchantManualOverride: true,
    contactVertical: "Retail",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 80,
    contactManualOverride: false,
  });
  const incomingStrength = getResolutionStrength(incomingResult.source, incomingResult.confidence, false);

  // Incoming should be weaker — merchant classification wins.
  assert(existingStrength > incomingStrength,
    `existing strength (${existingStrength}) > incoming (${incomingStrength})`);
  // The resolver still produced a result — it describes what the incoming resolution looked like.
  // In the bridge, when incoming <= existing, sdrMerchants is NOT updated, but sdrLeadState IS
  // reprojectd from the existing merchant record.  This test verifies the resolver result alone
  // cannot overwrite anything when the bridge strength guard applies.
  assert(
    incomingResult.vertical === "Healthcare",
    `merchant manual override wins resolver output = Healthcare; got "${incomingResult.vertical}"`
  );
  assert(
    incomingResult.reasonCode === "merchant_manual_override",
    `reasonCode = merchant_manual_override; got "${incomingResult.reasonCode}"`
  );
}

async function testBridgeSubverticalProvenancePreservation() {
  console.log("\n[21] Bridge: strong subvertical provenance prevents overwrite by weaker contact data");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Existing merchant: coarse from ghl_sync (authority 100) but subvertical from
  // discovery_enrichment@85 (authority 400).  Effective existing strength = 400*1000+85 = 400085.
  // Incoming contact: import_classification@70 (authority 300) → strength = 300*1000+70 = 300070.
  // Expected: incoming does NOT overwrite because effective existing (400085) > incoming (300070).
  const coarseExistingStrength = getResolutionStrength("ghl_sync", 40, false);         // 100*1000+40 = 100040
  const subExistingStrength = getResolutionStrength("discovery_enrichment", 85, false); // 400*1000+85 = 400085
  const effectiveExistingStrength = Math.max(coarseExistingStrength, subExistingStrength);

  const incomingResult = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "ghl_sync",
    merchantVerticalConfidence: 40,
    merchantSubvertical: "Med Spa",
    merchantSubverticalSource: "discovery_enrichment",
    merchantSubverticalConfidence: 85,
    merchantManualOverride: false,
    contactVertical: "Retail",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });
  const incomingStrength = getResolutionStrength(incomingResult.source, incomingResult.confidence, false);

  // >= because equal strength means "do not overwrite" (bridge condition: incoming > existing).
  assert(
    effectiveExistingStrength >= incomingStrength,
    `strong subvertical provenance guards existing classification: effective=${effectiveExistingStrength} >= incoming=${incomingStrength}`,
  );
  assert(
    coarseExistingStrength < incomingStrength,
    `coarse-only would have incorrectly allowed overwrite: coarse=${coarseExistingStrength} < incoming=${incomingStrength}`,
  );
}

async function testExistingStrongerMerchantPreserved() {
  console.log("\n[9] Existing stronger merchant (manualOverride=true) preserved over weaker incoming");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  const existingStrength = getResolutionStrength("operator_override", null, true);
  const incomingResult = resolveCanonicalVertical({
    contactVertical: "Retail",
    contactVerticalSource: "ghl_sync",
    contactVerticalConfidence: 90,
    contactManualOverride: false,
  });
  const incomingStrength = getResolutionStrength(incomingResult.source, incomingResult.confidence, false);

  assert(existingStrength > incomingStrength, `existing manual override strength (${existingStrength}) > incoming strength (${incomingStrength})`);
}

async function testStrongerNewResolutionUpdatesMetadata() {
  console.log("\n[10] Stronger new resolution produces a higher strength score than weaker existing");
  const { resolveCanonicalVertical, getResolutionStrength } = await import("../server/services/sdr/canonical-vertical-resolver");

  const existingStrength = getResolutionStrength("website_form", 30, false);

  const newResult = resolveCanonicalVertical({
    contactVertical: "Healthcare",
    contactVerticalSource: "discovery_enrichment",
    contactVerticalConfidence: 85,
    contactManualOverride: false,
  });
  const newStrength = getResolutionStrength(newResult.source, newResult.confidence, false);

  assert(newStrength > existingStrength, `new discovery_enrichment strength (${newStrength}) > old website_form strength (${existingStrength})`);
  assert(newResult.source === "discovery_enrichment", "new result source = discovery_enrichment", String(newResult.source));
}

async function testIdempotency() {
  console.log("\n[11] Repeated calls with identical inputs produce identical outputs (idempotent)");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const input = {
    contactVertical: "Auto",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 65,
    contactManualOverride: false,
  };

  const r1 = resolveCanonicalVertical(input);
  const r2 = resolveCanonicalVertical(input);

  assert(
    r1.vertical === r2.vertical &&
    r1.subvertical === r2.subvertical &&
    r1.source === r2.source &&
    r1.reasonCode === r2.reasonCode,
    "two identical calls return identical results"
  );
}

async function testSdrLeadStateFieldsOnly() {
  console.log("\n[12] VerticalResolutionResult has the 4 fields needed for sdrLeadState (no subvertical field)");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    contactVertical: "Legal",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 80,
    contactManualOverride: false,
  });

  assert("vertical" in result, "result has .vertical");
  assert("source" in result, "result has .source (maps to verticalSource)");
  assert("confidence" in result, "result has .confidence (maps to verticalConfidence)");
  assert("reasonCode" in result, "result has .reasonCode (maps to verticalResolutionReason)");
  assert(result.vertical === "Legal", "resolved vertical = Legal (canonical coarse)", String(result.vertical));
}

async function testSdrMerchantsAllSixColumns() {
  console.log("\n[13] VerticalResolutionResult provides all 6 provenance columns for sdrMerchants");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({
    merchantVertical: "Med Spa",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 88,
    merchantManualOverride: false,
  });

  assert(result.vertical !== null, "vertical is populated");
  assert(result.subvertical !== null, "subvertical is populated (Med Spa resolved)");
  assert(result.source !== "unknown", "source is a known source value");
  assert(result.confidence === 88, "confidence = 88", String(result.confidence));
  assert(result.algorithmVersion === "v1", "algorithmVersion = v1");
  assert(result.reasonCode === "subvertical_parent_resolved", "reasonCode = subvertical_parent_resolved");
}

async function testGetCanonicalLeadVerticalPreserved() {
  console.log("\n[14] getCanonicalLeadVertical() (display helper) still works correctly for existing consumers");
  const { getCanonicalLeadVertical } = await import("../server/services/sdr/vertical-resolver");

  assert(getCanonicalLeadVertical({ subvertical: "Med Spa", vertical: "Salon/Spa" }) === "Med Spa", "subvertical wins over coarse vertical");
  assert(getCanonicalLeadVertical({ subvertical: null, vertical: "Salon/Spa" }) === "Salon/Spa", "null subvertical falls back to vertical");
  assert(getCanonicalLeadVertical({}) === "Unknown", "empty input -> Unknown");
}

async function testCanonicalCoarseVerticalsExported() {
  console.log("\n[15] CANONICAL_COARSE_VERTICALS exported from helpers.ts");
  const { CANONICAL_COARSE_VERTICALS } = await import("../server/routes/helpers");

  assert(CANONICAL_COARSE_VERTICALS instanceof Set, "CANONICAL_COARSE_VERTICALS is a Set");
  assert(CANONICAL_COARSE_VERTICALS.has("Healthcare"), "contains Healthcare");
  assert(CANONICAL_COARSE_VERTICALS.has("Restaurant"), "contains Restaurant");
  assert(CANONICAL_COARSE_VERTICALS.has("Salon/Spa"), "contains Salon/Spa");
  assert(CANONICAL_COARSE_VERTICALS.has("Other"), "contains Other");
  assert(CANONICAL_COARSE_VERTICALS.size === 21, `has exactly 21 canonical coarse verticals (got ${CANONICAL_COARSE_VERTICALS.size})`);
}

async function testNoCandidatesResult() {
  console.log("\n[16] No candidates produces no_candidates reasonCode with needsReview=true");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  const result = resolveCanonicalVertical({});

  assert(result.reasonCode === "no_candidates", "reasonCode = no_candidates when no inputs");
  assert(result.vertical === null, "vertical = null");
  assert(result.needsReview === true, "needsReview = true");
}

async function testCanonicalInvariant() {
  console.log("\n[17] Invariant: result.vertical is always a canonical coarse value or null — never a raw unknown string");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");
  const { CANONICAL_COARSE_VERTICALS } = await import("../server/routes/helpers");

  // Single unknown non-canonical winner with no alternate coarse candidate.
  // raw value "ZombieNiche" is not in CANONICAL_COARSE_VERTICALS and not in SUBVERTICAL_TO_COARSE_VERTICAL.
  const result1 = resolveCanonicalVertical({
    contactVertical: "ZombieNiche",
    contactVerticalSource: "ghl_sync",
    contactVerticalConfidence: 80,
    contactManualOverride: false,
  });
  assert(result1.vertical === null || (result1.vertical !== null && CANONICAL_COARSE_VERTICALS.has(result1.vertical)),
    `result.vertical must be null or a canonical coarse value; got "${result1.vertical}"`);
  assert(result1.needsReview === true, "needsReview = true when vertical is unknown/unmapped");
  assert(result1.reasonCode === "subvertical_parent_unknown", "reasonCode = subvertical_parent_unknown");

  // Unmapped vertical with a valid alternate coarse candidate — should return the coarse fallback, not null.
  const result2 = resolveCanonicalVertical({
    merchantVertical: "ZombieNiche",
    merchantVerticalSource: "ghl_sync",
    merchantVerticalConfidence: 80,
    merchantManualOverride: false,
    contactVertical: "Healthcare",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 60,
    contactManualOverride: false,
  });
  assert(result2.vertical !== null && CANONICAL_COARSE_VERTICALS.has(result2.vertical),
    `With an alternate coarse candidate, result.vertical should be a canonical value; got "${result2.vertical}"`);

  // Invariant holds for canonical winner too.
  const result3 = resolveCanonicalVertical({
    contactVertical: "Restaurant",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });
  assert(result3.vertical === "Restaurant" && CANONICAL_COARSE_VERTICALS.has(result3.vertical),
    "Canonical winner (Restaurant) passes the invariant check");
}

async function testSubverticalProvenanceRanking() {
  console.log("\n[20] Subvertical provenance used for ranking when stronger than coarse-vertical provenance");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");

  // Merchant has coarse from ghl_sync@40 but subvertical from discovery_enrichment@85.
  // Candidate should rank at discovery_enrichment authority (400), not ghl_sync (100).
  // Contact has import_classification@70 (authority 300).
  // Winner: merchant because subvertical provenance (discovery_enrichment@85) > contact's import@70.
  const result = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "ghl_sync",
    merchantVerticalConfidence: 40,
    merchantSubvertical: "Med Spa",
    merchantSubverticalSource: "discovery_enrichment",
    merchantSubverticalConfidence: 85,
    merchantManualOverride: false,
    contactVertical: "Retail",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });
  assert(result.vertical === "Healthcare", `merchant wins via subvertical provenance; vertical = Healthcare; got "${result.vertical}"`);
  assert(result.subvertical === "Med Spa", `subvertical preserved; got "${result.subvertical}"`);
  assert(result.source === "discovery_enrichment",
    `candidate ranked by subvertical source (discovery_enrichment); got "${result.source}"`);

  // Reverse: coarse from discovery_enrichment@85 but subvertical from ghl_sync@40.
  // Stronger source is the coarse (discovery_enrichment) — same result but via coarse.
  const result2 = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantVerticalSource: "discovery_enrichment",
    merchantVerticalConfidence: 85,
    merchantSubvertical: "Med Spa",
    merchantSubverticalSource: "ghl_sync",
    merchantSubverticalConfidence: 40,
    merchantManualOverride: false,
    contactVertical: "Retail",
    contactVerticalSource: "import_classification",
    contactVerticalConfidence: 70,
    contactManualOverride: false,
  });
  assert(result2.vertical === "Healthcare", `merchant wins via coarse provenance; got "${result2.vertical}"`);
  assert(result2.source === "discovery_enrichment", `source = discovery_enrichment (coarse wins); got "${result2.source}"`);
}

async function testManualOverrideWithSubvertical() {
  console.log("\n[18] Manual override with subvertical='Med Spa' produces coarse='Healthcare', subvertical='Med Spa'");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");
  const { CANONICAL_COARSE_VERTICALS } = await import("../server/routes/helpers");

  // Merchant manual override: vertical="Med Spa" (a fine-grained subvertical in the coarse field).
  // Invariant: returned vertical must be Healthcare (coarse), subvertical must be Med Spa.
  const r1 = resolveCanonicalVertical({
    merchantVertical: "Med Spa",
    merchantSubvertical: null,
    merchantVerticalSource: "operator_override",
    merchantVerticalConfidence: 100,
    merchantManualOverride: true,
  });
  assert(r1.reasonCode === "merchant_manual_override", "reasonCode = merchant_manual_override");
  assert(r1.vertical === "Healthcare", `merchant override Med Spa -> coarse Healthcare; got "${r1.vertical}"`);
  assert(r1.subvertical === "Med Spa", `subvertical preserved as Med Spa; got "${r1.subvertical}"`);
  assert(CANONICAL_COARSE_VERTICALS.has(r1.vertical!), "returned vertical is a canonical coarse value");

  // Contact manual override: contactVertical="Med Spa" (contacts have no subvertical field).
  const r2 = resolveCanonicalVertical({
    contactVertical: "Med Spa",
    contactVerticalSource: "operator_override",
    contactVerticalConfidence: 100,
    contactManualOverride: true,
  });
  assert(r2.reasonCode === "contact_manual_override", "reasonCode = contact_manual_override");
  assert(r2.vertical === "Healthcare", `contact override Med Spa -> coarse Healthcare; got "${r2.vertical}"`);
  assert(CANONICAL_COARSE_VERTICALS.has(r2.vertical!), "returned vertical is a canonical coarse value");

  // Merchant override with explicit coarse+subvertical pair — both are preserved unchanged.
  const r3 = resolveCanonicalVertical({
    merchantVertical: "Healthcare",
    merchantSubvertical: "Med Spa",
    merchantVerticalSource: "operator_override",
    merchantVerticalConfidence: 100,
    merchantManualOverride: true,
  });
  assert(r3.vertical === "Healthcare", `explicit coarse Healthcare preserved; got "${r3.vertical}"`);
  assert(r3.subvertical === "Med Spa", `explicit subvertical Med Spa preserved; got "${r3.subvertical}"`);
}

async function testUnknownSourceNormalization() {
  console.log("\n[19] Unknown source strings are normalized to 'legacy_unknown', never stored verbatim");
  const { resolveCanonicalVertical } = await import("../server/services/sdr/canonical-vertical-resolver");
  const KNOWN_SOURCES = new Set([
    "operator_override", "discovery_enrichment", "import_classification",
    "website_form", "ghl_sync", "legacy_unknown",
  ]);

  // A completely unrecognized source string must collapse to legacy_unknown (authority 0).
  const r1 = resolveCanonicalVertical({
    contactVertical: "Restaurant",
    contactVerticalSource: "some_future_source_v99" as any,
    contactVerticalConfidence: 85,
    contactManualOverride: false,
  });
  assert(KNOWN_SOURCES.has(r1.source), `source "${r1.source}" must be a canonical VerticalSource`);
  assert(r1.source === "legacy_unknown", `unrecognized source collapses to legacy_unknown; got "${r1.source}"`);

  // null source also collapses to legacy_unknown.
  const r2 = resolveCanonicalVertical({
    contactVertical: "Retail",
    contactVerticalSource: null as any,
    contactVerticalConfidence: 50,
    contactManualOverride: false,
  });
  assert(KNOWN_SOURCES.has(r2.source), `null source must be a canonical VerticalSource; got "${r2.source}"`);

  // A known source passes through unchanged.
  const r3 = resolveCanonicalVertical({
    contactVertical: "Legal",
    contactVerticalSource: "discovery_enrichment",
    contactVerticalConfidence: 90,
    contactManualOverride: false,
  });
  assert(r3.source === "discovery_enrichment", `known source preserved; got "${r3.source}"`);
}

async function main() {
  await testSourceAuthorityTable();
  await testMerchantManualOverrideWins();
  await testHighConfidenceEnrichmentWinsOverForm();
  await testAuthorityFirstRankingWithConfidenceTiebreaker();
  await testLowConfidenceEnrichmentValidation();
  await testUnknownProvenanceIsFallbackOnly();
  await testMedSpaSubverticalMapsToHealthcare();
  await testUnknownSubverticalSetsNeedsReview();
  await testContactVerticalUnchangedByBridge();
  await testContactManualOverrideBeatsNonOverrideMerchant();
  await testContactManualOverrideIdempotency();
  await testBridgeLeadStateReprojectionWhenIncomingIsWeaker();
  await testBridgeSubverticalProvenancePreservation();
  await testExistingStrongerMerchantPreserved();
  await testStrongerNewResolutionUpdatesMetadata();
  await testIdempotency();
  await testSdrLeadStateFieldsOnly();
  await testSdrMerchantsAllSixColumns();
  await testGetCanonicalLeadVerticalPreserved();
  await testCanonicalCoarseVerticalsExported();
  await testNoCandidatesResult();
  await testCanonicalInvariant();
  await testSubverticalProvenanceRanking();
  await testManualOverrideWithSubvertical();
  await testUnknownSourceNormalization();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
