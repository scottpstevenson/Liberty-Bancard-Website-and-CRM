import assert from "node:assert/strict";
import { assertProviderActivation } from "../server/services/provider-manifest";

const sourceId = "apollo";
const approvedCaller = "server/services/cro03/sfp-live-provider-adapters.ts";
const unauthorizedCaller = "server/services/cro03/sfp-live-provider-adapters-EVIL.ts";

assert.throws(
  () => assertProviderActivation({
    sourceId, caller: unauthorizedCaller, explicitPaidApproval: true,
  }),
  /Unapproved provider caller/,
  "an unapproved SFP-like file path must remain blocked",
);

assert.doesNotThrow(
  () => assertProviderActivation({
    sourceId, caller: approvedCaller, explicitPaidApproval: true,
  }),
  "the exact SFP adapter path must be admitted by the manifest",
);

// The pre-cohort classification bridge (sfp-classification-bridge.ts) is a
// distinct caller from the SFP paid-waterfall adapters above — it reserves
// against serper and openai_classification directly, before any cohort
// exists. Both providers must admit it explicitly, and a lookalike
// unauthorized path must still be denied.
const precohortCaller = "server/services/cro03/sfp-classification-bridge.ts";
const precohortUnauthorizedCaller = "server/services/cro03/sfp-classification-bridge-EVIL.ts";
for (const precohortSourceId of ["serper", "openai_classification"] as const) {
  assert.throws(
    () => assertProviderActivation({
      sourceId: precohortSourceId, caller: precohortUnauthorizedCaller, explicitPaidApproval: true,
    }),
    /Unapproved provider caller/,
    `${precohortSourceId} must still block an unapproved pre-cohort-bridge-like caller`,
  );
  assert.doesNotThrow(
    () => assertProviderActivation({
      sourceId: precohortSourceId, caller: precohortCaller, explicitPaidApproval: true,
    }),
    `${precohortSourceId} must admit the real pre-cohort classification bridge caller`,
  );
}

console.log("SFP provider manifest kill-line: PASS (unauthorized denied; approved accepted, including pre-cohort bridge callers)");