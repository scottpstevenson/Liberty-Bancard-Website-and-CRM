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

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn(); checks++; console.log(`PASS ${name}`);
};

/**
 * This certification deliberately imports only the pure adapter/geography
 * modules. fit.ts currently reaches source-staging.ts for its policy hash, and
 * source-staging.ts is DB-bound. Read its source below rather than importing it
 * so this remains runnable without DATABASE_URL or a database connection.
 */
function runtimeSourceGraph(entryPoints: string[]): string[] {
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const statement of source.matchAll(/^import\s+(?!type\b)[\s\S]*?\sfrom\s+["'](\.[^"']+)["'];?$/gm)) {
      const imported = statement[1];
      const resolved = new URL(imported, `file://${process.cwd()}/${file}`).pathname;
      for (const candidate of [`${resolved}.ts`, `${resolved}/index.ts`]) {
        try {
          readFileSync(candidate, "utf8");
          visit(candidate);
          break;
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  };
  entryPoints.forEach(visit);
  return [...visited].sort();
}

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
check("fit policy and disposition contract are frozen without loading DB-bound code", () => {
  const fit = readFileSync("server/services/cro03a/fit.ts", "utf8");
  assert.match(fit, /targetCanonicalVertical: 25, eligibleGeography: 25, activeEntityEvidence: 15,/);
  assert.match(fit, /operatingFootprintPlausibility: 10, merchantSizeComplexity: 10, sourceFreshness: 10, evidenceCoverage: 5/);
  assert.match(fit, /geography: 20, vertical: 25, active: 15, identity: 15, freshness: 10, complexity: 10, completeness: 5/);
  assert.match(fit, /fitV2\s*\?\s*value\(payload, "entityStatus", "status", "enrichmentStatus", "lifecycle"\)/);
  assert.match(fit, /: value\(payload, "entityStatus", "status", "enrichmentStatus", "lifecycle", "state"\)/);
  assert.match(fit, /const score = Object\.values\(components\)\.reduce\(\(sum, part\) => sum \+ part, 0\)/);
  assert.match(fit, /else if \(!active\) \{ disposition = "inactive_entity";/);
  assert.match(fit, /else if \(relationship\.dnc \|\| relationship\.suppressed\) \{ disposition = "suppressed";/);
  assert.match(fit, /else if \(relationship\.existingCustomer \|\| relationship\.openOpportunity\) \{ disposition = "existing_relationship";/);
  assert.match(fit, /else if \(conflict\.length\) \{ disposition = "review_required";/);
  assert.match(fit, /else if \(exact\.length\) \{ disposition = "existing_relationship";/);
  assert.match(fit, /vertical\.needsReview \|\| weak\.length\) \{ disposition = "review_required";/);
  assert.match(fit, /score >= \(input\.policy\?\.selectedMinimum \?\? 70\).*"selected"/);
  assert.match(fit, /score >= \(input\.policy\?\.reviewMinimum \?\? 50\).*"review_required"/);
});
check("runtime certification import graph excludes qualification and DB-bound modules", () => {
  const graph = runtimeSourceGraph([
    "server/services/cro03a/adapters.ts",
    "server/services/cro03a/geography.ts",
  ]);
  assert.equal(graph.some((file) => /qualification-service|source-staging|(?:^|\/)db\.ts$|storage\.ts$/.test(file)), false);
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