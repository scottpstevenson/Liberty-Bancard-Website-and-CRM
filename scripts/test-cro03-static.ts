import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log(`PASS ${name}`);
  });
}

async function main() {
  process.env.MERCHANT_DATA_ENCRYPTION_KEY ||= "cro03-static-test-key-not-for-production";
  const contracts = await import("../server/services/cro03/contracts");
  const vault = await import("../server/services/cro03/candidate-vault");
  const routing = await import("../server/services/cro03/routing-policy");
  const { SafeEgress, assertSafeHostname } = await import("../server/services/cro03/safe-egress");

  await check("four governed providers are frozen", () => {
    assert.deepEqual(contracts.CRO03_PROVIDERS, ["zerobounce", "serper", "outscraper", "apollo"]);
  });
  await check("selection hash is order-stable", () => {
    assert.equal(contracts.stableSelectionHash([3, 1, 2]), contracts.stableSelectionHash([2, 3, 1]));
  });
  await check("command idempotency includes purpose and policy", () => {
    const base = { subjectIds: [3, 1], purpose: "provider_pre_spend", selectionPolicyVersion: 1, routingPolicyVersion: 1 };
    assert.equal(contracts.stableCro03CommandFingerprint(base), contracts.stableCro03CommandFingerprint({ ...base, subjectIds: [1, 3] }));
    assert.notEqual(contracts.stableCro03CommandFingerprint(base), contracts.stableCro03CommandFingerprint({ ...base, purpose: "internal_test" }));
  });
  await check("routing is selective", () => {
    const result = routing.selectCro03Route({
      hasWebsite: false, hasPhone: false, hasEmail: false,
      needsBusinessDiscovery: true, needsContactEnrichment: false, needsEmailValidation: false,
    });
    assert.deepEqual(result.providers, ["outscraper"]);
  });
  await check("canaries are non-executable", () => {
    assert.ok(routing.CRO03_CANARY_DEFINITIONS.every((entry) => entry.executable === false));
  });
  await check("candidate envelope authenticates context", () => {
    const sealed = vault.sealCandidate({ field: "email", value: "Owner@Example.com", subjectId: 42, subjectGeneration: 3 });
    assert.equal(sealed.maskedValue, "o***@ex***");
    assert.equal(vault.openCandidate({
      field: "email", subjectId: 42, subjectGeneration: 3, envelope: sealed,
    }), "Owner@Example.com");
    assert.throws(() => vault.openCandidate({
      field: "email", subjectId: 43, subjectGeneration: 3, envelope: sealed,
    }));
    assert.ok(!JSON.stringify(sealed).includes("owner@example.com"));
  });
  await check("private and metadata addresses are denied", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:172.16.1.1"]) {
      assert.throws(() => assertSafeHostname("example.test", [address]));
    }
  });
  await check("redirect targets are DNS revalidated", async () => {
    const lookups: string[] = [];
    const egress = new SafeEgress(
      async (url) => url.includes("one.example")
        ? new Response("", { status: 302, headers: { location: "https://two.example/x" } })
        : new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      async (host) => { lookups.push(host); return ["93.184.216.34"]; },
    );
    assert.equal((await egress.get({ url: "https://one.example", purpose: "test", callSite: "test" })).body, "ok");
    assert.deepEqual(lookups, ["one.example", "two.example"]);
  });
  await check("response bytes and content type are bounded", async () => {
    const tooLarge = new SafeEgress(
      async () => new Response("12345", { headers: { "content-type": "text/plain" } }),
      async () => ["93.184.216.34"],
    );
    await assert.rejects(tooLarge.get({ url: "https://example.com", purpose: "test", callSite: "test", maxBytes: 2 }));
    const binary = new SafeEgress(
      async () => new Response("x", { headers: { "content-type": "application/octet-stream" } }),
      async () => ["93.184.216.34"],
    );
    await assert.rejects(binary.get({ url: "https://example.com", purpose: "test", callSite: "test" }));
  });

  const migration = fs.readFileSync("migrations/0174_cro03_durable_enrichment_factory.sql", "utf8");
  const completionMigration = fs.readFileSync("migrations/0175_cro03_frozen_subject_plans.sql", "utf8");
  const factory = fs.readFileSync("server/services/cro03/enrichment-factory.ts", "utf8");
  const routes = fs.readFileSync("server/routes/cro03.ts", "utf8");
  const queue = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  const sla = fs.readFileSync("server/services/sla-worker.ts", "utf8");
  const prospects = fs.readFileSync("server/routes/prospects.ts", "utf8");
  const imports = fs.readFileSync("server/routes/imports.ts", "utf8");
  await check("membership and immutable evidence have guards", () => {
    assert.match(migration, /cro03_membership_immutable/);
    assert.match(migration, /cro03_candidate_immutable/);
    assert.match(migration, /cro03_receipt_immutable/);
    assert.match(migration, /UNIQUE \(item_id, field\)/);
  });
  await check("versioned subject identity and full route recipe are frozen", () => {
    assert.match(completionMigration, /subject_snapshot JSONB/);
    assert.match(completionMigration, /frozen_route_plan JSONB/);
    assert.match(completionMigration, /subject_snapshot_hash/);
    assert.match(factory, /frozenSubjectSnapshot/);
    assert.match(factory, /frozenRouteForMembership/);
  });
  await check("superseded work is terminally accounted in the total equation", () => {
    assert.match(completionMigration, /superseded_count/);
    assert.match(completionMigration, /outstanding_count/);
    assert.match(factory, /accountingEquation/);
  });
  await check("provider response selection requires a unique frozen-identity match", () => {
    assert.match(factory, /selectFrozenIdentityMatch/);
    assert.match(factory, /score < 4/);
    assert.match(factory, /scored\[1\]\?\.score === scored\[0\]\.score/);
  });
  await check("provider lineage records attempts, observations, receipts, and validation backlinks", () => {
    assert.match(completionMigration, /provider_attempt_id/);
    assert.match(completionMigration, /validation_intent_id/);
    assert.match(factory, /recordProviderOutcomeEvidence/);
    assert.match(factory, /provider_observations/);
    assert.match(factory, /receipt_id/);
    assert.match(factory, /validation_pending/);
  });
  await check("provider-export evidence is an immutable source-row snapshot", () => {
    assert.match(imports, /__cro03EvidenceValues/);
    assert.match(imports, /rowFingerprint: r\._rowFingerprint/);
    assert.match(imports, /evidence: cro03ImportEvidence/);
    const importEvidenceFunction = factory.slice(factory.indexOf("export async function recordCro03ImportEvidence"));
    assert.match(importEvidenceFunction, /evidence\.rowFingerprint/);
    assert.match(importEvidenceFunction, /createZeroSpendOperation/);
    assert.match(importEvidenceFunction, /recordProviderOutcomeEvidence/);
    assert.doesNotMatch(importEvidenceFunction, /await contactRow/);
    assert.doesNotMatch(importEvidenceFunction, /contact\.company_name/);
  });
  await check("only frozen discovery bypasses the commercial fence", () => {
    assert.match(factory, /provider !== "outscraper"/);
    assert.match(factory, /provider === "outscraper" \? \{ allowed: true \}/);
    assert.match(factory, /discovery_identity_insufficient/);
  });
  await check("paid controls ship disabled and budgetless", () => {
    assert.match(migration, /\('apollo'.*FALSE.*0/s);
    assert.match(migration, /ON CONFLICT \(provider\) DO UPDATE SET\s+enabled = FALSE/s);
  });
  await check("pre-transport and pre-mutation fences exist", () => {
    assert.ok((factory.match(/expectedFingerprint:/g) ?? []).length >= 4);
    assert.match(factory, /stale_before_transport/);
    assert.match(factory, /stale_after_transport/);
  });
  await check("live provider transport is compile-time denied", () => {
    assert.match(factory, /CRO03_PROVIDER_TRANSPORT_ENABLED = false as const/);
    assert.match(factory, /certification_transport_denied/);
  });
  await check("single scheduler owns durable processing and projection recovery", () => {
    assert.match(queue, /processNextCro03Item/);
    assert.match(queue, /processNextCro03Mutation/);
    assert.doesNotMatch(sla, /processEnrichmentQueue\(/);
  });
  await check("batch cancellation fences provider and mutation work", () => {
    assert.match(factory, /BATCH_CANCELLED/);
    assert.match(factory, /i\.state <> 'cancelled'[\s\S]{0,100}b\.state IN \('queued','running'\)/);
    assert.match(factory, /i\.state = 'running'[\s\S]{0,100}b\.state IN \('queued','running'\)/);
    assert.match(migration, /CRO03_MUTATION_AUTHORITY_INACTIVE/);
    assert.match(factory, /i\.state NOT IN \('blocked','cancelled'\)/);
  });
  await check("legacy request-detached paths are retired", () => {
    assert.doesNotMatch(prospects, /enrichProspect\(/);
    assert.doesNotMatch(prospects, /runEnrichmentJob\(/);
    assert.doesNotMatch(prospects, /processEnrichmentQueue\(/);
    assert.match(prospects, /CRO03_LEGACY_PATH_RETIRED/);
  });
  await check("strict role routes and strict DTO exist", () => {
    assert.match(routes, /requireRole\("admin", "manager"\)/);
    assert.match(routes, /\.strict\(\)/);
    assert.match(routes, /statusUrl/);
  });
  await check("CSV exports converge without provider transport", () => {
    const imports = fs.readFileSync("server/routes/imports.ts", "utf8");
    assert.match(imports, /recordCro03ImportEvidence/);
    assert.match(factory, /'import_observation'/);
    assert.match(factory, /recordCro03ImportEvidence[\s\S]*arbitrateField/);
    assert.match(factory, /recordCro03ImportEvidence[\s\S]*createMutationForWinner/);
  });
  console.log(`\nCRO-03 static certification passed: ${passed} checks`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
