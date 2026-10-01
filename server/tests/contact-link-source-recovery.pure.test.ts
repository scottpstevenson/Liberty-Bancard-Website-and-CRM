import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const { evaluateExactSunbizSourceNameBinding } = await import("../services/contact-link-source-recovery");

const exactDbaBridge = evaluateExactSunbizSourceNameBinding({
  contactCompanyName: "Sunrise Family Dentistry",
  sourceEntityName: "Sunrise Dental Incorporated",
  sourceDba: "Sunrise Family Dentistry Corp",
  canonicalName: "Sunrise Dental LLC",
  normalizedName: "sunrise dental",
  candidateBusinessIds: [41],
  targetBusinessId: 41,
});
assert.deepEqual(exactDbaBridge.reasonCodes, [],
  "the contact DBA and canonical legal name may bridge through separate exact source keys");
assert.equal(exactDbaBridge.contactMatchedNameKey, "sunrise family dentistry");
assert.deepEqual(exactDbaBridge.businessMatchedNameKeys, ["sunrise dental"]);

const weakFuzzyName = evaluateExactSunbizSourceNameBinding({
  contactCompanyName: "Sunrise Family",
  sourceEntityName: "Sunrise Dental Incorporated",
  sourceDba: "Sunrise Family Dentistry",
  canonicalName: "Sunrise Dental LLC",
  normalizedName: "sunrise dental",
  candidateBusinessIds: [41],
  targetBusinessId: 41,
});
assert.ok(weakFuzzyName.reasonCodes.includes("contact_raw_sunbiz_name_identity_not_exact"),
  "token overlap cannot satisfy raw-source recovery");

const ambiguousCanonical = evaluateExactSunbizSourceNameBinding({
  contactCompanyName: "Sunrise Family Dentistry",
  sourceEntityName: "Sunrise Dental Incorporated",
  sourceDba: "Sunrise Family Dentistry",
  canonicalName: "Sunrise Dental LLC",
  normalizedName: "sunrise dental",
  candidateBusinessIds: [41, 42],
  targetBusinessId: 41,
});
assert.ok(ambiguousCanonical.reasonCodes.includes("raw_sunbiz_identity_maps_to_multiple_canonical_businesses"));

const unsupportedBridge = evaluateExactSunbizSourceNameBinding({
  contactCompanyName: "Unrelated Dental",
  sourceEntityName: "Sunrise Dental Incorporated",
  sourceDba: "Sunrise Family Dentistry",
  canonicalName: "Sunrise Dental LLC",
  normalizedName: "sunrise dental",
  candidateBusinessIds: [41],
  targetBusinessId: 41,
});
assert.ok(unsupportedBridge.reasonCodes.includes("contact_raw_sunbiz_name_identity_not_exact"));

console.log("contact-link source recovery pure tests passed");