import assert from "node:assert/strict";
import { runCanonicalTransaction } from "../server/services/canonical-transaction-retry";
import { safeCanonicalEnrichmentFailureDiagnostics } from "../server/services/cro03/sfp-failure-diagnostics";

let calls=0;
const wrapped=Object.assign(new Error("private SQL and parameters must not be logged"), {
  cause:Object.assign(new Error("deadlock detected"),{code:"40P01"}),
});
assert.equal(await runCanonicalTransaction("preparation_commit",async()=>{
  if (++calls===1) throw wrapped;
  return "committed";
}),"committed");
assert.equal(calls,2);
assert.equal(safeCanonicalEnrichmentFailureDiagnostics(wrapped).transactionPhase,"preparation_commit");
assert(!JSON.stringify(safeCanonicalEnrichmentFailureDiagnostics(wrapped)).includes("private SQL"));
for (const failure of [
  Object.assign(new Error("connection terminated"),{code:"08006"}),
  new Error("CANONICAL_PREPARATION_CURSOR_LEASE_LOST"),
  new Error("CANONICAL_PREPARATION_RUNTIME_OWNER_CHANGED"),
  Object.assign(new Error("constraint"),{code:"23514"}),
]) {
  calls=0;
  await assert.rejects(runCanonicalTransaction("preparation_commit",async()=>{
    calls++;throw failure;
  }),error=>error===failure);
  assert.equal(calls,1);
}
calls=0;
await assert.rejects(runCanonicalTransaction("preparation_cursor_claim",async()=>{
  calls++;throw wrapped;
}),error=>error===wrapped);
assert.equal(calls,3);
console.log("Canonical transaction retry: bounded deadlock recovery, safe phases and fail-closed denials PASS");
