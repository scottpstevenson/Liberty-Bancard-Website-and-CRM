import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRO03A_SOURCE_CENSUS,
  leadDiscoverySourceSubject,
  linkedDiscoveryEvidence,
  sunbizSourceSubject,
} from "../server/services/cro03a/adapters";
import {
  CRO03A_COUNTY_FIPS,
  CRO03A_DISABLED_COUNTY_FIPS,
  evaluateSouthFloridaGeography,
} from "../server/services/cro03a/geography";
import {
  CRO03A_FIT_COMPONENT_WEIGHTS,
  CRO03A_FIT_V2_COMPONENT_WEIGHTS,
  CRO03A_FIT_V2_POLICY_IDENTITY_HASH,
  evaluateCro03aCandidate,
} from "../server/services/cro03a/fit";

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn(); checks++; console.log(`PASS ${name}`);
};
const active = (overrides: Record<string, unknown> = {}) => ({
  businessName: "South Florida Auto", vertical: "Auto", entityStatus: "Active",
  state: "FL", zip: "33101", website: "https://example.test", locationCount: 2, ...overrides,
});
const evaluate = (payload: Record<string, unknown>, extras: Partial<Parameters<typeof evaluateCro03aCandidate>[0]> = {}) =>
  evaluateCro03aCandidate({ payload, sourceSystem: "fixture", observedAt: "2026-08-29T12:00:00.000Z", now: "2026-08-29T12:00:00.000Z", ...extras });

check("source census is exact and complete", () => {
  assert.deepEqual(CRO03A_SOURCE_CENSUS, ["prospects", "sunbiz_entities", "provider_csv_rows", "sdr_merchants", "lead_discovery_results", "master_leads", "public_web"]);
});
check("Sunbiz adapter uses real fields and never defaults Florida", () => {
  const row = sunbizSourceSubject({ id: 8, filingNumber: "P1", entityName: "A", entityStatus: "Active", principalCity: "Miami", principalZip: "33101" });
  assert.equal(row.candidateValues.entity_status, "Active");
  assert.equal(row.candidateValues.city, "Miami");
  assert.equal(row.candidateValues.postal_code, "33101");
  assert.equal(row.candidateValues.state, undefined);
});
check("linked discovery collapses to SDR merchant evidence", () => {
  assert.equal(leadDiscoverySourceSubject({ id: 1, merchantId: 2 }), null);
  const linked = linkedDiscoveryEvidence({ id: 1, merchantId: 2, businessName: "A" });
  assert.equal(linked?.subjectType, "sdr_merchant");
  assert.equal(linked?.subjectKey, "row:2");
});
check("three enabled county FIPS and Monroe denial are frozen", () => {
  assert.deepEqual(CRO03A_COUNTY_FIPS, { Broward: "12011", "Miami-Dade": "12086", "Palm Beach": "12099" });
  assert.deepEqual(CRO03A_DISABLED_COUNTY_FIPS, { Monroe: "12087" });
  assert.equal(evaluateSouthFloridaGeography({ countyFips: "12087", state: "FL" }).eligible, false);
});
check("all five geography evidence classes are reachable", () => {
  assert.equal(evaluateSouthFloridaGeography({ countyFips: "12086", state: "FL" }).evidenceClass, "verified");
  assert.equal(evaluateSouthFloridaGeography({ zip: "33301", state: "FL" }).evidenceClass, "zip_inferred");
  assert.equal(evaluateSouthFloridaGeography({ city: "Boca Raton", state: "FL" }).evidenceClass, "city_inferred");
  assert.equal(evaluateSouthFloridaGeography({ county: "Broward", zip: "33101", state: "FL" }).evidenceClass, "conflicting");
  assert.equal(evaluateSouthFloridaGeography({ state: null }).evidenceClass, "unknown");
});
check("fit components total exactly 100", () => {
  assert.equal(Object.values(CRO03A_FIT_COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  const result = evaluate(active());
  assert.equal(result.score, 100);
  assert.equal(result.disposition, "selected");
  assert.equal(result.vertical.algorithmVersion, "v1");
  assert.equal(result.vertical.subverticalMapVersion, "1");
});
check("fit boundaries are deterministic", () => {
  assert.equal(evaluate(active({ locationCount: undefined, website: undefined })).score, 90);
  assert.equal(evaluate(active({ vertical: "Unknown", locationCount: undefined })).disposition, "review_required");
  assert.equal(evaluate({ businessName: "Thin", state: "FL" }).disposition, "review_required");
});
check("fit-v2 identity is complete and never infers activity from geography", () => {
  assert.equal(Object.values(CRO03A_FIT_V2_COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.match(CRO03A_FIT_V2_POLICY_IDENTITY_HASH, /^[a-f0-9]{64}$/);
  const v2 = evaluate(active({ entityStatus: undefined, status: undefined }), { policy: { fitVersion: "fit-v2" } });
  assert.equal(v2.activeStateEvidence.active, false);
  assert.equal(v2.disposition, "inactive_entity");
  assert.equal(evaluate(active({ entityStatus: undefined, status: undefined })).activeStateEvidence.active, true);
});
check("block and review gates outrank score", () => {
  assert.equal(evaluate(active({ entityStatus: "Dissolved" })).disposition, "inactive_entity");
  assert.equal(evaluate(active(), { relationship: { dnc: true } }).disposition, "suppressed");
  assert.equal(evaluate(active(), { relationship: { existingCustomer: true } }).disposition, "existing_relationship");
  assert.equal(evaluate(active(), { relationship: { openOpportunity: true } }).disposition, "existing_relationship");
  assert.equal(evaluate(active(), { identity: { exactMatches: ["registry:hash"] } }).disposition, "existing_relationship");
  assert.equal(evaluate(active(), { identity: { conflictingExactMatches: ["ein:a", "ein:b"] } }).disposition, "review_required");
  assert.equal(evaluate(active(), { identity: { weakMatches: ["name_phone_address"] } }).disposition, "review_required");
});
check("migration freezes source identity, occurrence replay and denied effects", () => {
  const migration = readFileSync("migrations/0187_cro03a_candidate_qualification.sql", "utf8");
  assert.match(migration, /UNIQUE \(subject_type,\s*source_system,\s*subject_key\)/);
  assert.match(migration, /UNIQUE \(source_subject_id,\s*source_event_key\)/);
  assert.match(migration, /effect_authorized = FALSE/);
  assert.match(migration, /cro03a_append_only_guard/);
});
check("preview and execution share one evaluator and routes are strict", () => {
  const service = readFileSync("server/services/cro03a/qualification-service.ts", "utf8");
  const routes = readFileSync("server/routes/cro03.ts", "utf8");
  assert.match(service, /function evaluateOccurrenceSet/);
  assert.equal((service.match(/evaluateOccurrenceSet\(/g) ?? []).length >= 3, true);
  assert.doesNotMatch(service, /void processCro03aQualificationRun/);
  assert.match(service, /processCro03aQualificationRunQueueSafe/);
  assert.match(routes, /cro03a\/preview"[\s\S]*requireRole\("admin", "manager"\)/);
  assert.match(routes, /cro03a\/runs"[\s\S]*requireRole\("admin", "manager"\)/);
  assert.match(routes, /cro03a\/policies\/activate"[\s\S]*requireRole\("admin"\)/);
});
check("qualification module imports no provider, SDR scoring, canonical writer, outbound or pause authority", () => {
  const files = ["adapters.ts", "geography.ts", "vertical.ts", "fit.ts", "qualification-service.ts"]
    .map((name) => readFileSync(`server/services/cro03a/${name}`, "utf8")).join("\n");
  assert.doesNotMatch(files, /(?:from|import\()\s*["'][^"']*(?:services\/sdr\/scoring|serper|outscraper|apollo|zerobounce|openai|ghl|cr04|cr06|outbound|pause)[^"']*["']/i);
  assert.doesNotMatch(files, /\b(?:createContact|updateContact|createDeal|createCohort|applyPauseMutation)\s*\(/);
});
check("legacy promotion and writeback are retired", () => {
  const prospects = readFileSync("server/routes/prospects.ts", "utf8");
  const leadOps = readFileSync("server/routes/lead-ops.ts", "utf8");
  assert.match(prospects, /sunbiz\/promote-qualified[\s\S]{0,400}CRO03A_GOVERNED_HANDOFF_REQUIRED/);
  assert.match(leadOps, /lead-ops\/run-writeback[\s\S]{0,400}CRO03A_GOVERNED_HANDOFF_REQUIRED/);
});

console.log(`\nCRO-03A static certification passed: ${checks} checks`);