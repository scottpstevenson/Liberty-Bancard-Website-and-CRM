#!/usr/bin/env node
/** Dependency-free regression guard for the final Task #1999 closeout. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const files = {
  gaps: read("server/services/cro03/sfp-contact-gap-vector.ts"),
  preview: read("server/services/cro03/sfp-cost-preview.ts"),
  waterfall: read("server/services/cro03/sfp-paid-waterfall.ts"),
  providerOps: read("server/services/cro03/sfp-provider-operations.ts"),
  certification: read("scripts/test-sfp1999-postmerge-audit-certification.ts"),
};

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`);
    process.exitCode = 1;
  }
};
const has = (source, value) => assert.ok(source.includes(value), `missing: ${value}`);
const count = (source, value) => source.split(value).length - 1;

console.log("\nTask #1999 final closeout regression suite\n");

test("both settlement paths use operation state, billing, and claim fences", () => {
  assert.ok(count(files.providerOps, "AND state='running' AND billing_state='reserved'") >= 2);
  assert.ok(count(files.providerOps, "AND claim_token=${input.reservation.claimToken}::uuid") >= 2);
  assert.ok(count(files.providerOps, "SFP_PROVIDER_SETTLEMENT_FENCE_LOST") >= 2);
});

test("terminal settlement replay is an explicit no-op", () => {
  assert.ok(count(files.providerOps, "return { settledMicros: 0, replayed: true }") >= 2);
  assert.ok(count(files.providerOps, "return { settledMicros, replayed: false }") >= 2);
  assert.ok(count(files.providerOps, "AND completed_at IS NULL") >= 2);
});

test("aggregate headroom includes pre-cohort reservations", () => {
  has(files.preview, "FROM sfp_classification_runs WHERE state IN ('authorized','running')");
  has(files.preview, "Number(classificationReservations?.reserved ?? 0)");
});

test("business identity is a distinct gap dimension", () => {
  has(files.gaps, '| "business_identity"');
  has(files.gaps, "hasResolvedBusinessIdentity");
  has(files.waterfall, 'gapOpen("business_identity")');
  has(files.waterfall, '"business_identity_gap_closed"');
});

test("Apollo person evidence closes the decision-maker gap", () => {
  has(files.gaps, "hasPaidNamedDecisionMaker");
  has(files.gaps, '"paid_named_decision_maker_evidence"');
  has(files.waterfall, "provider='apollo' AND subject_type='person'");
  has(files.waterfall, "person_name_evidence");
  has(files.waterfall, "person_title_evidence");
});

test("geography closes only on the positive resolver outcome", () => {
  has(files.gaps, 'String(outcome ?? "") === "resolved"');
  has(files.waterfall, "isResolvedSouthFloridaGeographyOutcome(decision?.geography_outcome)");
  has(files.preview, "isResolvedSouthFloridaGeographyOutcome(m.geography_outcome)");
});

test("disposable certification exercises accounting replay and gap closure", () => {
  has(files.certification, "pre-cohort settlement replay is a fenced no-op");
  has(files.certification, "cohort-bound settlement replay is a fenced no-op");
  has(files.certification, "cost preview includes in-flight pre-cohort classification reservations");
  has(files.certification, "persisted Apollo person evidence closes the live decision-maker gap");
});

console.log(`\n${passed} assertions passed${process.exitCode ? " (failures present)" : ""}.\n`);
if (process.exitCode) process.exit(process.exitCode);
