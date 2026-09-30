import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MI09_PRICING_SEED_TABLE } from "../services/cro03/mi09-pricing-seed-data";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const staging = await import("../services/cro03/sfp-campaign-staging-v2");
const providerOps = await import("../services/cro03/sfp-provider-operations");

const email = " Owner@Example.test ";
const normalizedEmail = email.trim().toLowerCase();
const version0Hash = createHash("sha256").update(normalizedEmail).digest("hex");
const version1Hash = createHash("sha256").update(`email\u0000${normalizedEmail}`).digest("hex");

for (const sourceKind of ["free", "paid", "contact"] as const) {
  assert.equal(
    staging.isValidatedSfpSourceEmailUnchanged(sourceKind, email, version1Hash, 1),
    true,
    `${sourceKind} source accepts its unchanged v1 validated email`,
  );
  assert.equal(
    staging.isValidatedSfpSourceEmailUnchanged(sourceKind, "changed@example.test", version1Hash, 1),
    false,
    `${sourceKind} source rejects email drift`,
  );
  assert.equal(
    staging.isValidatedSfpSourceEmailUnchanged(sourceKind, email, version0Hash, 0),
    true,
    `${sourceKind} source continues to accept its unchanged v0 validated email`,
  );
  assert.equal(
    staging.isValidatedSfpSourceEmailUnchanged(sourceKind, email, version1Hash, 99),
    false,
    `${sourceKind} source fails closed for an unknown hash version`,
  );
}

const stagingSource = read("server/services/cro03/sfp-campaign-staging-v2.ts");
assert.match(stagingSource, /SFP_STAGING_CONTACT_LINK_REVISION_DRIFTED/);
assert.match(stagingSource, /contactEmailTokenHash,\s*tokenHashForSuppression/);
assert.match(stagingSource, /isValidatedSfpSourceEmailUnchanged\(\s*reference\.sourceKind/);

const seeded = new Map(MI09_PRICING_SEED_TABLE.map((entry) => [entry.providerKey, entry]));
for (const provider of ["serper", "zerobounce"]) {
  assert.equal(
    providerOps.noResultBillableFromPricingSemantics(seeded.get(provider)?.billingSemantics),
    true,
    `${provider} no-result billing follows the reviewed billable policy`,
  );
}
for (const provider of ["apollo", "outscraper"]) {
  assert.equal(
    providerOps.noResultBillableFromPricingSemantics(seeded.get(provider)?.billingSemantics),
    false,
    `${provider} no-result billing follows the reviewed free policy`,
  );
}
assert.equal(providerOps.noResultBillableFromPricingSemantics(undefined), null);
assert.match(read("server/services/cro03/sfp-provider-operations.ts"), /getCurrentPricingSchedule\(\)/);

const settle = providerOps.calculateSfpSettlementAccounting;
const serperUnitPrice = seeded.get("serper")!.amountMicros;
const apolloUnitPrice = seeded.get("apollo")!.amountMicros;
assert.deepEqual(settle({
  outcome: "no_result", reservedUnits: 2, reviewedUnitPriceMicros: serperUnitPrice,
  noResultBillable: true, notDispatched: false, billingAmbiguous: false,
}), { settledUnits: 2, settledMicros: serperUnitPrice * 2, settledCostMicros: serperUnitPrice * 2 });
assert.deepEqual(settle({
  outcome: "no_result", reservedUnits: 2, reviewedUnitPriceMicros: apolloUnitPrice,
  noResultBillable: false, notDispatched: false, billingAmbiguous: false,
}), { settledUnits: 0, settledMicros: 0, settledCostMicros: 0 });
assert.deepEqual(settle({
  outcome: "no_result", reservedUnits: 1, reviewedUnitPriceMicros: null,
  noResultBillable: true, notDispatched: false, billingAmbiguous: false,
}), { settledUnits: 1, settledMicros: 0, settledCostMicros: null });
assert.deepEqual(settle({
  outcome: "no_result", reservedUnits: 1, reviewedUnitPriceMicros: 1_000,
  noResultBillable: null, notDispatched: false, billingAmbiguous: false,
}), { settledUnits: 1, settledMicros: 0, settledCostMicros: null });
assert.deepEqual(settle({
  outcome: "failed", reservedUnits: 1, reviewedUnitPriceMicros: 1_000,
  noResultBillable: true, notDispatched: false, billingAmbiguous: true,
}), { settledUnits: 0, settledMicros: 0, settledCostMicros: null });
assert.deepEqual(settle({
  outcome: "failed", reservedUnits: 1, reviewedUnitPriceMicros: null,
  noResultBillable: true, notDispatched: true, billingAmbiguous: false,
}), { settledUnits: 0, settledMicros: 0, settledCostMicros: 0 });

console.log("SFP versioned email pins and reviewed no-result billing assertions passed");