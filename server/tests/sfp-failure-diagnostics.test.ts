import assert from "node:assert/strict";
import { safeSfpFailureDiagnostics, safeCanonicalEnrichmentFailureDiagnostics } from "../services/cro03/sfp-failure-diagnostics";

const diagnostics = safeSfpFailureDiagnostics({
  message: "Failed query: confidential SQL and parameters",
  cause: {
    code: "23503",
    constraint: "sfp_cohort_decisions_business_id_fkey",
    table: "sfp_cohort_decisions",
    column: "business_id",
    message: "confidential provider address",
    detail: "confidential values",
  },
});
assert.deepEqual(diagnostics, {
  sqlState: "23503",
  constraint: "sfp_cohort_decisions_business_id_fkey",
  table: "sfp_cohort_decisions",
  column: "business_id",
  domainCode: null,
});
assert.doesNotMatch(JSON.stringify(diagnostics), /confidential|parameters|query/);
assert.equal(safeSfpFailureDiagnostics({ message: "SFP_FROZEN_IMMUTABLE: private details" }).domainCode,
  "SFP_FROZEN_IMMUTABLE");
assert.deepEqual(safeSfpFailureDiagnostics({
  code: "secret-value", constraint: "private@example.com", table: "x".repeat(129), column: "unsafe column",
}), { sqlState: null, constraint: null, table: null, column: null, domainCode: null });
const cycle: any = { message: "unknown" };
cycle.cause = cycle;
assert.equal(safeSfpFailureDiagnostics(cycle).sqlState, null);
const canonical = safeCanonicalEnrichmentFailureDiagnostics({
  message: "Failed query: private@example.com confidential SQL params",
  cause: { code:"55P03", message:"could not obtain lock on confidential table" },
});
assert.equal(canonical.sqlState,"55P03");
assert.doesNotMatch(JSON.stringify(canonical),/confidential|private@|params|query/);
assert.equal(safeCanonicalEnrichmentFailureDiagnostics({
  message:"Failed query: confidential params",cause:{message:"Connection terminated due to connection timeout"},
}).failureKind,"connection_timeout");
assert.equal(safeCanonicalEnrichmentFailureDiagnostics({
  message:"CANONICAL_PREPARATION_CURSOR_LEASE_LOST",
}).domainCode,"CANONICAL_PREPARATION_CURSOR_LEASE_LOST");
assert.equal(safeCanonicalEnrichmentFailureDiagnostics(cycle).failureKind,null);
console.log("SFP bounded driver diagnostics preserve causes without query/value leakage");