#!/usr/bin/env tsx
/**
 * scripts/test-reconciliation-classifier.ts
 *
 * Pure-function tests for the reconciliation classifier.
 * No DB required. Runs unconditionally.
 *
 * ≥ 50 assertions covering all 11 output lanes and all 12 dimensions.
 */

import {
  classifyReconciliation,
  generateProposals,
  ALL_RECONCILIATION_LANES,
  type ReconciliationContactRow,
  type ReconciliationResult,
} from "../server/services/reconciliation-classifier";

// ──────────────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, extra?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, label, ok ? undefined : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────────────────────
const RUN_ID = "00000000-0000-4000-a000-000000000001";

function makeRow(overrides: Partial<ReconciliationContactRow>): ReconciliationContactRow {
  return {
    id: 1,
    firstName: "John",
    lastName: "Smith",
    email: "john@acmecorp.com",
    phone: "(555) 123-4567",
    companyName: "Acme Corp",
    vertical: "restaurant",
    verticalSource: "form",
    manualVerticalOverride: null,
    doNotContact: false,
    suppressionReason: null,
    emailStatus: "valid",
    bounceStatus: null,
    complaintStatus: null,
    consentTier: null,
    recordClass: "production",
    ghlContactId: null,
    leadSource: null,
    businessId: null,
    hasDeal: false,
    censusLane: "NEEDS_BUSINESS_MATERIALIZATION",
    normalizedPhone: "(555) 123-4567",
    isSharedPhone: false,
    sharedPhoneCompanyCount: 0,
    ...overrides,
  };
}

function classify(overrides: Partial<ReconciliationContactRow>): ReconciliationResult {
  return classifyReconciliation(makeRow(overrides), RUN_ID, null);
}

// ──────────────────────────────────────────────────────────────────────────────
// P1 — NON_PRODUCTION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP1 NON_PRODUCTION");
assertEq(classify({ recordClass: "test" }).primaryLane, "NON_PRODUCTION", "test record → NON_PRODUCTION");
assertEq(classify({ recordClass: "demo" }).primaryLane, "NON_PRODUCTION", "demo record → NON_PRODUCTION");
assertEq(classify({ recordClass: "synthetic" }).primaryLane, "NON_PRODUCTION", "synthetic → NON_PRODUCTION");
assertEq(classify({ recordClass: "test" }).overallActionState, "non_production", "test → non_production action");

// ──────────────────────────────────────────────────────────────────────────────
// P2 — BLOCKED
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP2 BLOCKED");
assertEq(classify({ doNotContact: true }).primaryLane, "BLOCKED", "DNC=true → BLOCKED");
assertEq(classify({ suppressionReason: "unsubscribed" }).primaryLane, "BLOCKED", "suppression reason → BLOCKED");
assertEq(classify({ emailStatus: "bounced" }).primaryLane, "BLOCKED", "bounced email → BLOCKED");
assertEq(classify({ emailStatus: "opted_out" }).primaryLane, "BLOCKED", "opted_out email → BLOCKED");
assertEq(classify({ emailStatus: "blocked" }).primaryLane, "BLOCKED", "blocked email → BLOCKED");

// ──────────────────────────────────────────────────────────────────────────────
// P3 — INSUFFICIENT_DATA
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP3 INSUFFICIENT_DATA");
assertEq(
  classify({ firstName: null, lastName: null, email: null, phone: null, companyName: null }).primaryLane,
  "INSUFFICIENT_DATA",
  "no name, no channel → INSUFFICIENT_DATA",
);
assertEq(
  classify({ firstName: "", email: null, phone: null, companyName: null }).primaryLane,
  "INSUFFICIENT_DATA",
  "empty name, no channel → INSUFFICIENT_DATA",
);

// ──────────────────────────────────────────────────────────────────────────────
// P4 — PENDING_DUPLICATE_RESOLUTION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP4 PENDING_DUPLICATE_RESOLUTION");
assertEq(
  classify({ isSharedPhone: true, sharedPhoneCompanyCount: 3 }).primaryLane,
  "PENDING_DUPLICATE_RESOLUTION",
  "shared phone 3 companies → PENDING_DUPLICATE_RESOLUTION",
);
assertEq(
  classify({ isSharedPhone: true, sharedPhoneCompanyCount: 20 }).primaryLane,
  "PENDING_DUPLICATE_RESOLUTION",
  "shared phone 20 companies → PENDING_DUPLICATE_RESOLUTION",
);
assertEq(
  classify({ isSharedPhone: true, sharedPhoneCompanyCount: 1 }).primaryLane,
  "PENDING_ORG_AGGREGATION",
  "shared phone 1 company → not duplicate (→ org aggregation instead)",
);
// mass shared phone (>20) is still mass_shared_phone not multi_company
assertEq(
  classify({ isSharedPhone: true, sharedPhoneCompanyCount: 21 }).duplicateRiskState,
  "mass_shared_phone",
  "shared phone 21 companies → mass_shared_phone risk",
);

// ──────────────────────────────────────────────────────────────────────────────
// P5 — PENDING_ORG_AGGREGATION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP5 PENDING_ORG_AGGREGATION");
assertEq(
  classify({ businessId: null, censusLane: "NEEDS_BUSINESS_MATERIALIZATION" }).primaryLane,
  "PENDING_ORG_AGGREGATION",
  "no businessId, pipeline_eligible → PENDING_ORG_AGGREGATION",
);
assertEq(
  classify({ businessId: 42 }).primaryLane,
  "CLEAN_NO_ACTION",
  "has businessId → not org aggregation",
);
assertEq(
  classify({ censusLane: "INTERNAL_MATCH_AVAILABLE", businessId: null }).primaryLane,
  "PENDING_ORG_AGGREGATION",
  "internal match available → PENDING_ORG_AGGREGATION",
);

// ──────────────────────────────────────────────────────────────────────────────
// P6 — PENDING_NAME_NORMALIZATION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP6 PENDING_NAME_NORMALIZATION");
assertEq(
  classify({ businessId: 1, firstName: "JOHN", lastName: "SMITH" }).primaryLane,
  "PENDING_NAME_NORMALIZATION",
  "ALL CAPS first name → PENDING_NAME_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "Dr. John" }).primaryLane,
  "PENDING_NAME_NORMALIZATION",
  "title prefix → PENDING_NAME_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "mr. bob" }).primaryLane,
  "PENDING_NAME_NORMALIZATION",
  "mr. prefix → PENDING_NAME_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "john" }).primaryLane,
  "PENDING_NAME_NORMALIZATION",
  "all lower name → PENDING_NAME_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "John", lastName: "SMITH" }).primaryLane,
  "PENDING_NAME_NORMALIZATION",
  "ALL CAPS last name → PENDING_NAME_NORMALIZATION",
);
// Already normalized — should not trigger
assertEq(
  classify({ businessId: 1, firstName: "John", lastName: "Smith", vertical: "restaurant" }).primaryLane,
  "CLEAN_NO_ACTION",
  "properly cased name → no name normalization needed",
);

// ──────────────────────────────────────────────────────────────────────────────
// P7 — PENDING_EMAIL_NORMALIZATION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP7 PENDING_EMAIL_NORMALIZATION");
assertEq(
  classify({ businessId: 1, firstName: "John", lastName: "Smith", email: "noemail@example.com" }).primaryLane,
  "PENDING_EMAIL_NORMALIZATION",
  "noemail placeholder email → PENDING_EMAIL_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "John", email: "notavalidemail" }).primaryLane,
  "PENDING_EMAIL_NORMALIZATION",
  "invalid email format → PENDING_EMAIL_NORMALIZATION",
);
assertEq(
  classify({ businessId: 1, firstName: "John", email: "test@domain.com" }).primaryLane,
  "PENDING_EMAIL_NORMALIZATION",
  "test@ email → PENDING_EMAIL_NORMALIZATION",
);

// ──────────────────────────────────────────────────────────────────────────────
// P8 — PENDING_PHONE_NORMALIZATION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP8 PENDING_PHONE_NORMALIZATION");
assertEq(
  classify({
    businessId: 1, firstName: "John", lastName: "Smith",
    email: "john@real.com", phone: "5551234567",
    normalizedPhone: "5551234567", isSharedPhone: false,
  }).primaryLane,
  "PENDING_PHONE_NORMALIZATION",
  "unformatted 10-digit phone → PENDING_PHONE_NORMALIZATION",
);
assertEq(
  classify({
    businessId: 1, firstName: "John", lastName: "Smith",
    email: "john@real.com", phone: "15551234567",
    normalizedPhone: "15551234567", isSharedPhone: false,
  }).primaryLane,
  "PENDING_PHONE_NORMALIZATION",
  "11-digit with leading 1, no format → PENDING_PHONE_NORMALIZATION",
);

// ──────────────────────────────────────────────────────────────────────────────
// P9 — PENDING_VERTICAL_ASSIGNMENT
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP9 PENDING_VERTICAL_ASSIGNMENT");
assertEq(
  classify({
    businessId: 1, vertical: null, verticalSource: null,
    firstName: "John", lastName: "Smith", email: "john@real.com",
    phone: "(555) 123-4567",
  }).primaryLane,
  "PENDING_VERTICAL_ASSIGNMENT",
  "missing vertical with full contact data → PENDING_VERTICAL_ASSIGNMENT",
);
assertEq(
  classify({ businessId: 1, vertical: null, manualVerticalOverride: true }).verticalState,
  "manual_override",
  "manual override → verticalState=manual_override",
);

// ──────────────────────────────────────────────────────────────────────────────
// P10 — CLEAN_NO_ACTION
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nP10 CLEAN_NO_ACTION");
assertEq(
  classify({
    businessId: 42,
    firstName: "John",
    lastName: "Smith",
    email: "john@legit.com",
    phone: "(555) 123-4567",
    vertical: "restaurant",
    verticalSource: "form",
    isSharedPhone: false,
    sharedPhoneCompanyCount: 0,
  }).primaryLane,
  "CLEAN_NO_ACTION",
  "all fields clean with businessId → CLEAN_NO_ACTION",
);

// ──────────────────────────────────────────────────────────────────────────────
// Dimension coverage
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nDimension coverage");

// R1 name states
assertEq(classify({ firstName: null, lastName: null }).nameQualityState, "missing_name", "R1 missing_name");
assertEq(classify({ firstName: "JOHN" }).nameQualityState, "needs_normalization", "R1 needs_normalization (caps)");
assertEq(classify({ firstName: "John" }).nameQualityState, "clean", "R1 clean");

// R2 email states
assertEq(classify({ email: null }).emailQualityState, "missing", "R2 email missing");
assertEq(classify({ email: "noemail@domain.com" }).emailQualityState, "suspicious", "R2 suspicious");
assertEq(classify({ email: "badformat" }).emailQualityState, "invalid_format", "R2 invalid_format");
assertEq(classify({ email: "good@domain.com" }).emailQualityState, "clean", "R2 clean");

// R3 phone states
assertEq(classify({ phone: null }).phoneQualityState, "missing", "R3 phone missing");
assertEq(classify({ phone: "5551234567", normalizedPhone: "5551234567" }).phoneQualityState, "needs_formatting", "R3 needs_formatting");
assertEq(classify({ phone: "(555) 123-4567", normalizedPhone: "(555) 123-4567" }).phoneQualityState, "clean", "R3 clean");
assertEq(classify({ phone: "0000000000", normalizedPhone: "0000000000" }).phoneQualityState, "placeholder", "R3 placeholder (0000)");

// R4 company states
assertEq(classify({ companyName: null }).companyQualityState, "missing", "R4 company missing");
assertEq(classify({ companyName: "ACME CORP" }).companyQualityState, "needs_normalization", "R4 needs_normalization");
assertEq(classify({ companyName: "Acme Corp" }).companyQualityState, "clean", "R4 clean");

// R5 vertical states
assertEq(classify({ vertical: null }).verticalState, "missing", "R5 missing");
assertEq(classify({ vertical: "restaurant" }).verticalState, "resolved", "R5 resolved");
assertEq(classify({ vertical: null, manualVerticalOverride: true }).verticalState, "manual_override", "R5 manual_override");

// R6 duplicate risk
assertEq(classify({ isSharedPhone: false }).duplicateRiskState, "none", "R6 none");
assertEq(classify({ isSharedPhone: true, sharedPhoneCompanyCount: 5 }).duplicateRiskState, "shared_phone_multi_company", "R6 shared_phone_multi_company");
assertEq(classify({ isSharedPhone: true, sharedPhoneCompanyCount: 25 }).duplicateRiskState, "mass_shared_phone", "R6 mass_shared_phone");

// R7 business gap
assertEq(classify({ businessId: 1 }).businessGapState, "linked", "R7 linked");
assertEq(classify({ businessId: null, censusLane: "NEEDS_BUSINESS_MATERIALIZATION" }).businessGapState, "pipeline_eligible", "R7 pipeline_eligible");
assertEq(classify({ businessId: null, censusLane: "INTERNAL_MATCH_AVAILABLE" }).businessGapState, "candidate_match", "R7 candidate_match");
assertEq(classify({ businessId: null, companyName: null }).businessGapState, "no_company", "R7 no_company");

// R8 org aggregation
assertEq(classify({ businessId: null }).orgAggregationState, "aggregatable", "R8 aggregatable");
assertEq(classify({ businessId: 1 }).orgAggregationState, "not_eligible", "R8 not_eligible (has businessId)");
assertEq(classify({ businessId: null, censusLane: "INTERNAL_MATCH_AVAILABLE" }).orgAggregationState, "internal_match_possible", "R8 internal_match_possible");

// R9 normalization opportunity
assertEq(
  classify({ businessId: 1, firstName: "JOHN", vertical: "restaurant" }).normalizationOpportunity,
  "has_opportunity",
  "R9 has_opportunity (name)",
);
assertEq(
  classify({
    businessId: 1, firstName: "John", lastName: "Smith",
    email: "john@legit.com", phone: "(555) 123-4567",
    vertical: "restaurant", isSharedPhone: false,
  }).normalizationOpportunity,
  "none",
  "R9 none",
);

// R10 cluster candidacy
assertEq(classify({ isSharedPhone: true, sharedPhoneCompanyCount: 3 }).clusterCandidacyState, "candidate", "R10 candidate");
assertEq(classify({ isSharedPhone: false }).clusterCandidacyState, "clean", "R10 clean");

// ──────────────────────────────────────────────────────────────────────────────
// ALL_RECONCILIATION_LANES exhaustiveness
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nLane exhaustiveness");
assert(ALL_RECONCILIATION_LANES.length === 11, "11 lanes defined");
assert(ALL_RECONCILIATION_LANES.includes("CLEAN_NO_ACTION"), "CLEAN_NO_ACTION in list");
assert(ALL_RECONCILIATION_LANES.includes("UNCLASSIFIED"), "UNCLASSIFIED in list");
assert(ALL_RECONCILIATION_LANES.includes("PENDING_ORG_AGGREGATION"), "PENDING_ORG_AGGREGATION in list");

// ──────────────────────────────────────────────────────────────────────────────
// generateProposals — pure function tests
// ──────────────────────────────────────────────────────────────────────────────
console.log("\ngenerateProposals");

{
  const row = makeRow({ firstName: "JOHN", businessId: 1 });
  const result = classifyReconciliation(row, RUN_ID, null);
  const proposals = generateProposals(row, result, new Date());
  const nameProposal = proposals.find(p => p.fieldName === "first_name");
  assert(nameProposal !== undefined, "generates first_name proposal for ALL CAPS name");
  assertEq(nameProposal?.proposedValue, "John", "ALL CAPS → John");
  assertEq(nameProposal?.proposalType, "name_normalization", "correct proposal type");
  assert((nameProposal?.confidence ?? 0) >= 70, "confidence ≥ 70");
}

{
  const row = makeRow({ phone: "5551234567", normalizedPhone: "5551234567", businessId: 1, isSharedPhone: false });
  const result = classifyReconciliation(row, RUN_ID, null);
  const proposals = generateProposals(row, result, new Date());
  const phoneProposal = proposals.find(p => p.fieldName === "phone");
  assert(phoneProposal !== undefined, "generates phone proposal for unformatted number");
  assertEq(phoneProposal?.proposedValue, "(555) 123-4567", "formats to (555) 123-4567");
  assertEq(phoneProposal?.proposalType, "phone_normalization", "correct proposal type");
}

{
  const row = makeRow({ firstName: "Dr. Jane", lastName: "SMITH", businessId: 1 });
  const result = classifyReconciliation(row, RUN_ID, null);
  const proposals = generateProposals(row, result, new Date());
  const firstNameP = proposals.find(p => p.fieldName === "first_name");
  const lastNameP = proposals.find(p => p.fieldName === "last_name");
  assert(firstNameP !== undefined, "generates first_name proposal for Dr. prefix");
  assert(lastNameP !== undefined, "generates last_name proposal for ALL CAPS last name");
  assertEq(lastNameP?.proposedValue, "Smith", "ALL CAPS Smith → Smith");
}

{
  const row = makeRow({ companyName: "ACME CORPORATION", businessId: 1 });
  const result = classifyReconciliation(row, RUN_ID, null);
  const proposals = generateProposals(row, result, new Date());
  const companyP = proposals.find(p => p.fieldName === "company_name");
  assert(companyP !== undefined, "generates company_name proposal for ALL CAPS company");
  assertEq(companyP?.proposalType, "company_normalization", "correct proposal type");
}

{
  // Clean contact — no proposals
  const row = makeRow({
    businessId: 42, firstName: "John", lastName: "Smith",
    email: "john@legit.com", phone: "(555) 123-4567",
    vertical: "restaurant", isSharedPhone: false, companyName: "Acme Corp",
  });
  const result = classifyReconciliation(row, RUN_ID, null);
  const proposals = generateProposals(row, result, new Date());
  assertEq(proposals.length, 0, "clean contact generates no proposals");
}

// ──────────────────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────────────────
console.log("\nEdge cases");

// Blocked takes precedence over duplicate
assertEq(
  classify({ doNotContact: true, isSharedPhone: true, sharedPhoneCompanyCount: 5 }).primaryLane,
  "BLOCKED",
  "BLOCKED wins over PENDING_DUPLICATE_RESOLUTION",
);

// Non-production wins over everything
assertEq(
  classify({ recordClass: "test", doNotContact: true, isSharedPhone: true, sharedPhoneCompanyCount: 5 }).primaryLane,
  "NON_PRODUCTION",
  "NON_PRODUCTION wins over BLOCKED and DUPLICATE",
);

// BLOCKED wins over org aggregation
assertEq(
  classify({ doNotContact: true, businessId: null }).primaryLane,
  "BLOCKED",
  "BLOCKED wins over PENDING_ORG_AGGREGATION",
);

// Phone placeholder
assertEq(
  classify({ phone: "5550001234", normalizedPhone: "5550001234" }).phoneQualityState,
  "placeholder",
  "0000 suffix → placeholder phone",
);

// Short phone (not placeholder but too short)
assertEq(
  classify({ phone: "12345", normalizedPhone: "12345" }).phoneQualityState,
  "too_short",
  "5 digit phone → too_short",
);

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n── Reconciliation Classifier Tests ──────────────────────────`);
console.log(`   ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
console.log(`─────────────────────────────────────────────────────────────\n`);

if (failed > 0) {
  process.exit(1);
}
