#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { runPreCohortClassificationBridge, getLatestAdmissibleClassificationEvidence } from "../server/services/cro03/sfp-classification-bridge";

const nonce = randomUUID();
const programName = `sfp-c1-bridge-${nonce}`;
const actorId = `sfp-c1-test-${nonce}`;
const businessIds: number[] = [];
let programId: string | null = null;
let assertionCount = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertionCount++;
  console.log(`✓ ${message}`);
};

async function addBusiness(name: string, vertical: string, zip = "33101", city = "Miami", fips = "12086") {
  const result = await pool.query(
    `INSERT INTO businesses (canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
     VALUES ($1,$1,$2,$3,'FL',$4,'active','canonical') RETURNING id`,
    [`${name}-${nonce}`, vertical, city, zip],
  );
  const id = Number(result.rows[0].id);
  businessIds.push(id);
  await pool.query(
    `INSERT INTO business_locations (business_id,is_primary,city,state,postal_code,county_fips)
     VALUES ($1,true,$2,'FL',$3,$4)`,
    [id, city, zip, fips],
  );
  return id;
}

async function protectedCounts() {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM sfp_stage_runs r JOIN sfp_stage_items i ON i.stage_run_id=r.id WHERE i.business_id=ANY($1::int[])) AS stage_runs,
       (SELECT COUNT(*)::int FROM sfp_cohort_runs r JOIN sfp_cohort_members m ON m.cohort_run_id=r.id WHERE m.business_id=ANY($1::int[])) AS cohort_runs,
       (SELECT COUNT(*)::int FROM sfp_cohort_members WHERE business_id=ANY($1::int[])) AS cohort_members,
       (SELECT COUNT(*)::int FROM sfp_cohort_decisions WHERE business_id=ANY($1::int[])) AS cohort_decisions`,
    [businessIds],
  );
  return result.rows[0];
}

async function main() {
  const program = await pool.query(
    `INSERT INTO sfp_programs (name,county_fips,vertical_ids,max_cohort_size,policy_version,is_active,created_by)
     VALUES ($1,$2,$3,100,1,false,$4) RETURNING id`,
    [programName, ["12011", "12086", "12099"], ["Dental"], actorId],
  );
  programId = String(program.rows[0].id);
  const bridgeProgramId = programId;

  const outsideId = await addBusiness("outside", "dental", "30301", "Atlanta", "13089");
  const dentalId = await addBusiness("dental", "dental");
  const ambiguousFakeId = await addBusiness("ambiguous-fake", "healthcare");
  const ambiguousNoAdapterId = await addBusiness("ambiguous-no-adapter", "healthcare");

  const noProtectedRowsBefore = await protectedCounts();
  const firstKey = `c1-${nonce}-dental`;
  const openAiCalls: number[] = [];
  // Scope selection to exactly these fixture businesses (businessIdFilter):
  // this dev database already has hundreds of real South-Florida-resolvable
  // canonical businesses awaiting classification, which would otherwise fill
  // every bounded run (ORDER BY id ASC) and starve out these newly-inserted,
  // higher-id fixtures. See sfp-classification-bridge.ts's businessIdFilter
  // doc comment for the production rationale.
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Dental"], policyVersion: 1,
    businessIdFilter: businessIds,
  }, { openAiClassify: async ({ businessId }) => {
    openAiCalls.push(businessId);
    return businessId === ambiguousFakeId || businessId === ambiguousNoAdapterId ? {
      outcome: "target", confidence: 0.91, reasonCodes: ["TEST_FAKE_OPENAI"], modelVersion: "test-model",
      promptVersion: "test-prompt", costMicros: 0,
    } : null;
  } });
  const evidenceBefore = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  const replay = await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Dental"], policyVersion: 1,
    businessIdFilter: businessIds,
  });
  const evidenceAfter = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  check(replay.replayed, "same-key/same-config run is reported as replayed");
  check(Number(evidenceBefore.rows[0].n) === Number(evidenceAfter.rows[0].n), "idempotent replay creates no evidence rows");
  check(!openAiCalls.includes(dentalId), "exact dental alias does not invoke OpenAI");

  await assert.rejects(
    runPreCohortClassificationBridge({
      programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 99, targetIds: ["Dental"], policyVersion: 1,
      businessIdFilter: businessIds,
    }),
    /SFP_CLASSIFICATION_DIVERGENT_REPLAY/,
  );
  assertionCount++;
  console.log("✓ divergent maxBusinesses replay is rejected");
  await assert.rejects(
    runPreCohortClassificationBridge({
      programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Restaurant"], policyVersion: 1,
      businessIdFilter: businessIds,
    }),
    /SFP_CLASSIFICATION_DIVERGENT_REPLAY/,
  );
  assertionCount++;
  console.log("✓ divergent targetIds replay is rejected");

  check(openAiCalls.includes(ambiguousFakeId), "ambiguous fixture escalated through the injected classifier");

  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-ambiguous-no-adapter`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 2, businessIdFilter: businessIds,
  });

  const fixtures = await pool.query(
    `SELECT business_id,outcome,reason_codes,policy_version FROM sfp_classification_evidence
      WHERE business_id=ANY($1::int[]) AND policy_version IN (1,2) ORDER BY created_at ASC`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  const fixtureRows = fixtures.rows;
  check(!fixtureRows.some((r: any) => Number(r.business_id) === outsideId), "outside-county business receives no classification evidence");
  const dentalEvidence = fixtureRows.find((r: any) => Number(r.business_id) === dentalId);
  check(dentalEvidence?.outcome === "target", "exact dental alias deterministically classifies as target");
  const fakeEvidence = fixtureRows.find((r: any) => Number(r.business_id) === ambiguousFakeId && Number(r.policy_version) === 1);
  check(fakeEvidence?.outcome === "target", "fake OpenAI target outcome is persisted");
  const noAdapterEvidence = fixtureRows.find((r: any) => Number(r.business_id) === ambiguousNoAdapterId && Number(r.policy_version) === 2);
  const noAdapterReasons = Array.isArray(noAdapterEvidence?.reason_codes)
    ? noAdapterEvidence.reason_codes : JSON.parse(noAdapterEvidence?.reason_codes ?? "[]");
  check(noAdapterEvidence?.outcome === "review_required", "ambiguous classification without adapter remains review_required");
  check(noAdapterReasons.includes("OPENAI_ESCALATION_NOT_CONFIGURED"), "no-adapter evidence records explicit reason code");

  // Two admissible rows at one policy version prove latest timestamp wins;
  // a still-newer row at a different policy version must not leak into lookup.
  const older = await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,1,7,'review_required',0.2,'[]'::jsonb,$3,NOW()-INTERVAL '1 day') RETURNING id,evidence_hash`,
    [dentalId, `older-${nonce}`, `older-${nonce}`],
  );
  const newer = await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,2,7,'target',0.9,'[]'::jsonb,$3,NOW()) RETURNING id,evidence_hash`,
    [dentalId, `newer-${nonce}`, `newer-${nonce}`],
  );
  await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,9,8,'non_target',0.9,'[]'::jsonb,$3,NOW()+INTERVAL '1 day')`,
    [dentalId, `other-policy-${nonce}`, `other-policy-${nonce}`],
  );
  const latest = await getLatestAdmissibleClassificationEvidence(dentalId, 7);
  check(latest?.id === String(newer.rows[0].id), "latest evidence is deterministic at exact policy version and ignores other policies");
  check(String(older.rows[0].evidence_hash) !== String(newer.rows[0].evidence_hash), "lookup fixture contains distinct evidence hashes");

  const itemRows = await pool.query(
    `SELECT business_id FROM sfp_classification_items WHERE business_id=ANY($1::int[])`,
    [businessIds],
  );
  check(!itemRows.rows.some((r: any) => Number(r.business_id) === outsideId), "outside-county business has no classification item");
  const protectedRowsAfter = await protectedCounts();
  check(JSON.stringify(noProtectedRowsBefore) === JSON.stringify(protectedRowsAfter), "bridge writes no stage/cohort run, member, or decision rows");

  // Governed Serper domain discovery: only invoked when explicitly enabled
  // and only for a business missing a domain; discovered domain is
  // persisted so a later run never re-spends on the same business.
  const noDomainId = await addBusiness("no-domain-dental", "dental", "33101", "Miami", "12086");
  const discoveryCalls: number[] = [];
  const fakeLookup = async (lookupInput: { businessId: number }) => {
    discoveryCalls.push(lookupInput.businessId);
    return { domain: "example-dental-clinic.test", costMicros: 4000, reasonCode: "SERPER_DOMAIN_DISCOVERED" };
  };
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-disabled`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 3, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: false,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.length === 0, "domain discovery is never invoked unless explicitly authorized");

  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-enabled`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 4, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: true,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.includes(noDomainId), "authorized domain discovery invokes the injected lookup for the domain-less business");
  const discoveredBiz = await pool.query(`SELECT website_domain FROM businesses WHERE id=$1`, [noDomainId]);
  check(discoveredBiz.rows[0]?.website_domain === "example-dental-clinic.test", "discovered domain is persisted onto the business");
  const discoveryEvidence = await pool.query(
    `SELECT cost_micros, reason_codes FROM sfp_classification_evidence WHERE business_id=$1 AND policy_version=4`,
    [noDomainId],
  );
  check(Number(discoveryEvidence.rows[0]?.cost_micros) === 4000, "discovery cost is folded into the classification evidence cost ledger");
  const discoveryReasons = Array.isArray(discoveryEvidence.rows[0]?.reason_codes)
    ? discoveryEvidence.rows[0].reason_codes : JSON.parse(discoveryEvidence.rows[0]?.reason_codes ?? "[]");
  check(discoveryReasons.includes("SERPER_DOMAIN_DISCOVERED"), "discovery reason code is recorded on the evidence row");

  const discoveryCallsBeforeReplay = discoveryCalls.length;
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-rerun`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 5, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: true,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.length === discoveryCallsBeforeReplay, "a later run never re-discovers a domain the business already has on file");

  console.log(`\nSFP classification bridge: ${assertionCount} assertions passed.`);
}

try {
  await main();
} finally {
  if (businessIds.length) {
    await pool.query(`DELETE FROM sfp_classification_items WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    if (programId) {
      await pool.query(`DELETE FROM sfp_classification_items WHERE run_id IN (SELECT id FROM sfp_classification_runs WHERE program_id=$1)`, [programId]).catch(() => {});
      await pool.query(`DELETE FROM sfp_classification_runs WHERE program_id=$1`, [programId]).catch((error: any) => {
        console.error("cleanup: failed to delete sfp_classification_runs", error?.message ?? error);
      });
    }
    await pool.query(`DELETE FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    await pool.query(`DELETE FROM business_locations WHERE business_id=ANY($1::int[])`, [businessIds]);
    await pool.query(`DELETE FROM businesses WHERE id=ANY($1::int[])`, [businessIds]);
  }
  if (programId) await pool.query(`DELETE FROM sfp_programs WHERE id=$1`, [programId]);
  await pool.end();
}