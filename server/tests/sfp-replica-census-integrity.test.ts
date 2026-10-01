import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
function contact(id: number) {
  return {
    contactId: id, companyName: null, emailDomain: null, emailHasExactlyOneAt: false, website: null,
    address: null, city: null, state: null, phone: null, rowProvenance: null,
    recordClass: "unknown", emailStatus: "unvalidated", archived: false,
    existingMerchantCustomer: false, doNotContact: false, doNotAutoContact: false,
    optedOutEmail: false, optOutStatus: null, unsubscribeStatus: null,
    bounceStatus: null, complaintStatus: null, suppressionReason: null,
    projectedBusinessId: null, currentDecisionId: null, currentDecision: null,
    currentDecisionBusinessId: null, currentRevision: 0,
    currentDecisionConsistent: false, primarySourceEventId: null,
    sourceEvents: [], businesses: [],
  };
}
function fixture(total: number, watermark: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-replica-integrity-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    total, watermark, startedAt: "2026-10-01T00:00:00.000Z", source: "isolated_test",
  }));
  fs.writeFileSync(path.join(root, "business-0.json"), "[]");
  return { root, report: path.join(root, "report.json") };
}
function run(root: string, report: string) {
  return spawnSync(path.resolve("node_modules/.bin/tsx"), [
    "scripts/sfp-contact-link-replica-census.ts", root, report,
  ], { encoding: "utf8", timeout: 30_000 });
}
try {
  const shuffled = fixture(3, 11);
  // Numeric cursor order differs from lexical filename order.
  fs.writeFileSync(path.join(shuffled.root, "contacts-10.json"), JSON.stringify([contact(11)]));
  fs.writeFileSync(path.join(shuffled.root, "contacts-2.json"), JSON.stringify([contact(3)]));
  fs.writeFileSync(path.join(shuffled.root, "contacts-1.json"), JSON.stringify([contact(2)]));
  const initial = run(shuffled.root, shuffled.report);
  assert.equal(initial.status, 0, initial.stderr);
  const result = JSON.parse(fs.readFileSync(shuffled.report, "utf8"));
  assert.equal(result.processed, 3);
  assert.equal(result.cursor, 11);
  assert.equal(result.complete, true);
  assert.equal(Object.values(result.counts).reduce((a: number, b) => a + Number(b), 0), 3);
  const replay = run(shuffled.root, shuffled.report);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(shuffled.report, "utf8")).counts, result.counts);
  assert.equal(JSON.parse(fs.readFileSync(shuffled.report, "utf8")).processed, 3);

  fs.writeFileSync(path.join(shuffled.root, "contacts-2.json"), JSON.stringify([{ ...contact(3), phone: "modified" }]));
  const modified = run(shuffled.root, shuffled.report);
  assert.notEqual(modified.status, 0);
  assert.match(modified.stderr, /Resume contact shard changed/);

  const duplicate = fixture(2, 3);
  fs.writeFileSync(path.join(duplicate.root, "contacts-0.json"), JSON.stringify([contact(2)]));
  fs.writeFileSync(path.join(duplicate.root, "contacts-2.json"), JSON.stringify([contact(2)]));
  const duplicateResult = run(duplicate.root, duplicate.report);
  assert.notEqual(duplicateResult.status, 0);
  assert.match(duplicateResult.stderr, /Duplicate or non-monotonic/);

  const unordered = fixture(2, 3);
  fs.writeFileSync(path.join(unordered.root, "contacts-0.json"), JSON.stringify([contact(3), contact(2)]));
  const unorderedResult = run(unordered.root, unordered.report);
  assert.notEqual(unorderedResult.status, 0);
  assert.match(unorderedResult.stderr, /Duplicate or non-monotonic/);

  const partial = fixture(2, 3);
  fs.writeFileSync(path.join(partial.root, "contacts-0.json"), JSON.stringify([contact(2)]));
  assert.equal(run(partial.root, partial.report).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(partial.report, "utf8")).complete, false);
  fs.writeFileSync(path.join(partial.root, "contacts-2.json"), JSON.stringify([contact(3)]));
  assert.equal(run(partial.root, partial.report).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(partial.report, "utf8")).complete, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(partial.root, "manifest.json"), "utf8"));
  manifest.startedAt = "2026-10-02T00:00:00.000Z";
  fs.writeFileSync(path.join(partial.root, "manifest.json"), JSON.stringify(manifest));
  const mixedSnapshot = run(partial.root, partial.report);
  assert.notEqual(mixedSnapshot.status, 0);
  assert.match(mixedSnapshot.stderr, /Resume input snapshot changed/);
  const parity = fixture(3, 3);
  const business = {
    businessId: 1, canonicalName: "Fixture Business LLC", normalizedName: "fixture business",
    websiteDomain: "fixture.example", mainPhone: null, streetAddress: null,
    city: null, state: null, postalCode: null, recordClass: "canonical", doNotVisit: false,
    sourceLinks: [{
      sourceLinkId: "fixture-source", businessId: 1, sourceSystem: "sunbiz",
      sourceType: "sunbiz_entity", stableKey: "FIXTURE", rawEvidence: null,
      sourceEntityId: 1, sunbizName: "Fixture Business LLC", sunbizDba: null,
      sunbizWebsite: "https://fixture.example", sunbizFilingNumber: "FIXTURE",
      sunbizAddress: null, sunbizCity: null, sunbizState: null, sunbizZip: null,
      sunbizPhone: null, sunbizOwnerPhone: null, sunbizEntitySource: "cordata",
    }],
  };
  fs.writeFileSync(path.join(parity.root, "business-0.json"), JSON.stringify([business]));
  const strict = {
    ...contact(1), companyName: business.canonicalName, emailDomain: business.websiteDomain,
    website: business.websiteDomain, emailHasExactlyOneAt: true,
  };
  const compact = (id: number, emailFlag: boolean | string) => [
    id, strict.companyName, strict.emailDomain, strict.website,
    null, null, null, null, null, "unknown", "unvalidated", false,
    false, false, false, false, null, null, null, null, null,
    null, null, null, null, 0, false, null, [], emailFlag,
  ];
  fs.writeFileSync(path.join(parity.root, "contacts-0.json"), JSON.stringify([
    strict, compact(2, true), compact(3, "bad@@fixture.example"),
  ]));
  const parityRun = run(parity.root, parity.report);
  assert.equal(parityRun.status, 0, parityRun.stderr);
  const parityResult = JSON.parse(fs.readFileSync(parity.report, "utf8"));
  assert.equal(parityResult.counts.STRICT_AUTO_ELIGIBLE, 2);
  assert.deepEqual(parityResult.strictCandidates.map((c: any) => c.contactId), [1, 2]);
  const alias = fixture(1, 1);
  fs.writeFileSync(path.join(alias.root, "business-0.json"), JSON.stringify([
    business, { ...business, businessId: 2, websiteDomain: "  www.FIXTURE.example  ", sourceLinks: [] },
  ]));
  fs.writeFileSync(path.join(alias.root, "contacts-0.json"), JSON.stringify([strict]));
  assert.equal(run(alias.root, alias.report).status, 0);
  const aliasResult = JSON.parse(fs.readFileSync(alias.report, "utf8"));
  assert.equal(aliasResult.counts.STRICT_AUTO_ELIGIBLE, 0, "www aliases must obey database domain uniqueness");
  const port = fixture(1, 1);
  fs.writeFileSync(path.join(port.root, "business-0.json"), JSON.stringify([{
    ...business, canonicalName: "Unrelated Stored Name", normalizedName: "unrelated stored name",
    websiteDomain: "fixture.example:443", sourceLinks: [{
      ...business.sourceLinks[0], sunbizName: null, sunbizWebsite: null, sourceEntityId: null,
    }],
  }]));
  fs.writeFileSync(path.join(port.root, "contacts-0.json"), JSON.stringify([{
    ...contact(1), website: "fixture.example",
  }]));
  const portRun = run(port.root, port.report);
  assert.equal(portRun.status, 0, portRun.stderr);
  const portResult = JSON.parse(fs.readFileSync(port.report, "utf8"));
  assert.equal(portResult.counts.REQUIRES_REVIEW, 1);
  assert.deepEqual(portResult.representativeIds.REQUIRES_REVIEW[0].businessIds, [1]);
  parityResult.classifierIdentity = "old-classifier";
  fs.writeFileSync(parity.report, JSON.stringify(parityResult));
  assert.match(run(parity.root, parity.report).stderr, /Resume classifier changed/);
  console.log("PASS: shard integrity, resume/snapshot/classifier binding, compact strict parity, malformed email exclusion");
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}