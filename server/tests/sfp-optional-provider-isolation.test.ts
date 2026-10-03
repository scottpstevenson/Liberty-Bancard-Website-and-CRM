import assert from "node:assert/strict";
import fs from "node:fs";
import {
  hasSfpValidationProgress,
  readIndependentSfpDiscoveryReadiness,
  sfpUnavailableHttpReason,
} from "../services/cro03/sfp-continuous-progress";

const ready = { ready: true, reason: null };
const unavailable = { ready: false, reason: "provider_unavailable:apollo:http_402" };

for (const apolloState of ["unavailable", "throws"] as const) {
  const checked: string[] = [];
  const result = await readIndependentSfpDiscoveryReadiness(async (provider) => {
    checked.push(provider);
    if (provider === "outscraper") return ready;
    if (apolloState === "throws") throw new Error("DO_NOT_ECHO_PROVIDER_PAYLOAD");
    return unavailable;
  });
  assert.deepEqual(result.outscraper, ready);
  assert.equal(result.apollo.ready, false);
  assert.deepEqual(checked.sort(), ["apollo", "outscraper"]);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_ECHO"));
  assert.deepEqual(
    Object.entries(result).filter(([, status]) => status.ready).map(([provider]) => provider),
    ["outscraper"],
    "healthy discovery remains available without Apollo",
  );
}
const reverse = await readIndependentSfpDiscoveryReadiness(async (provider) => {
  if (provider === "outscraper") throw new Error("unavailable");
  return ready;
});
assert.equal(reverse.outscraper.ready, false);
assert.equal(reverse.apollo.ready, true);
for (const status of [401, 402, 403, "402"]) {
  assert.ok(sfpUnavailableHttpReason("apollo", status));
}
for (const status of [null, undefined, 0, 200, 400, 404, 429, 500, "not_a_status"]) {
  assert.equal(sfpUnavailableHttpReason("apollo", status), null);
}

assert.equal(hasSfpValidationProgress({
  addressesValidated: 0, providerRequests: 0, eligibilityRowsCreated: 1,
}), true, "terminal prechecks advance selection, without paid calls");
assert.equal(hasSfpValidationProgress({
  addressesValidated: 1, providerRequests: 1, eligibilityRowsCreated: 0,
}), true);
assert.equal(hasSfpValidationProgress({
  addressesValidated: 0, providerRequests: 0, eligibilityRowsCreated: 0,
}), false, "empty batches terminate, not spin");

// Execute the production progress decision against a precheck-only batch,
// then a valid-address batch. Apollo never participates in this drain.
const batches = [
  { addressesValidated: 0, providerRequests: 0, eligibilityRowsCreated: 2 },
  { addressesValidated: 1, providerRequests: 1, eligibilityRowsCreated: 1 },
  { addressesValidated: 0, providerRequests: 0, eligibilityRowsCreated: 0 },
];
let previews = 0, validations = 0;
for (const batch of batches) {
  previews++;
  validations += batch.addressesValidated;
  if (!hasSfpValidationProgress(batch)) break;
}
assert.equal(previews, 3);
assert.equal(validations, 1, "zero-call prechecks must not starve the next valid batch");

const worker = fs.readFileSync(new URL("../services/cro03/sfp-continuous-discovery.ts", import.meta.url), "utf8");
assert.match(worker, /readIndependentSfpDiscoveryReadiness\(getSfpProviderReadiness\)/);
assert.match(worker, /if \(!advanced\) exhaustedCohorts\.add\(cohortRunId\)/);
assert.doesNotMatch(worker, /if \(result\.addressesValidated === 0\)/);
const validationWorker = worker.slice(worker.indexOf("export async function processSfpContinuousValidationTick"));
assert.match(validationWorker, /getSfpProviderReadiness\("zerobounce"\)/);
assert.doesNotMatch(validationWorker, /getSfpProviderReadiness\("apollo"\)/);
const waterfall = fs.readFileSync(new URL("../services/cro03/sfp-paid-waterfall.ts", import.meta.url), "utf8");
assert.match(waterfall, /enabledProviders\.delete\("apollo"\)/);
console.log("SFP optional-provider isolation and zero-call batch progress tests passed");