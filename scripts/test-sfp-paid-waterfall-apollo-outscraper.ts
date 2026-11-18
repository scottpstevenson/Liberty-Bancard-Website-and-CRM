#!/usr/bin/env tsx
/**
 * Task #1999 (C3/C6/C7): proves executeSfpPaidPersonAndIdentityDiscovery
 * writes Apollo/Outscraper results into sfp_paid_candidate_evidence and
 * links them from sfp_stage_items.paidCandidateEvidenceId — never into
 * free_discovery_candidates/cro03c_candidate_evidence — with zero live
 * provider transport (fetchImpl is faked throughout).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "SFP paid waterfall Apollo/Outscraper fake-provider certification",
  requireRedis: false,
});
const { pool } = await import("../server/db");
const { executeSfpPaidPersonAndIdentityDiscovery } = await import("../server/services/cro03/sfp-paid-waterfall");
const { getSfpCohortGapSnapshot } = await import("../server/services/cro03/sfp-cost-preview");
const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } = await import("../server/services/mi09-pilot-authority");

const nonce = randomUUID().slice(0, 8);
const runtimeActorId = `sfp-paid-wf-admin-${nonce}`;
await (await import("./helpers/sfp-runtime-test-identity"))
  .selectSfpRuntimeTestRelease(runtimeActorId);
let assertionCount = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertionCount++;
  console.log(`✓ ${message}`);
};

let debugNonce = nonce;
const oldTransport = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
const oldApolloKey = process.env.APOLLO_API_KEY;
const oldOutscraperKey = process.env.OUTSCRAPER_API_KEY;
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
if (!process.env.APOLLO_API_KEY) process.env.APOLLO_API_KEY = "test-fake-key";
if (!process.env.OUTSCRAPER_API_KEY) process.env.OUTSCRAPER_API_KEY = "test-fake-key";

let liveNetworkCalls = 0;
// Current Apollo contract: employer-scoped search returns people IDs, then a
// separately accounted bulk enrichment returns business email. Outscraper must
// match the pinned name AND returned locality; query labels are not evidence.
const apolloOrgName = `sfp-paid-wf-nodomain-${nonce}`.toLowerCase();
const fetchImpl: typeof fetch = async (url: any,init) => {
  liveNetworkCalls++;
  const u = String(url),body=JSON.parse(String(init?.body??'{}'));
  const response=(data:any,credits:string)=>new Response(JSON.stringify({...data,credits_consumed:credits}),{status:200,headers:{'x-request-id':`fixture-${nonce}-${liveNetworkCalls}`}});
  if (u.includes("mixed_companies/search")) {
    const known=!!body.q_organization_domains||String(body.q_organization_name??'').includes('-domain-');
    return response({organizations:[{id:known?'org-known':'org-1',name:known?`sfp-paid-wf-domain-${nonce}`:apolloOrgName,
      ...(known?{primary_domain:`already-known-${nonce}.example`}:{}),city:'Miami',state:'FL'}]},'1');
  }
  if (u.includes("mixed_people/api_search")) {
    assert.equal(body.organization_ids.length,1);const id=body.organization_ids[0];
    assert(['org-1','org-known'].includes(id));
    return response({people:[{id:`person-${id}`,organization:{id},first_name:'Jane',last_name:'Owner',title:'Owner',has_email:true}]},'0');
  }
  if(u.includes('/people/bulk_match')){
    assert(!/reveal_personal_emails|reveal_phone_number|run_waterfall/.test(JSON.stringify(body)));
    return response({matches:body.details.map((person:any)=>({id:person.id,organization_id:person.id.slice('person-'.length),first_name:'Jane',last_name:'Owner',title:'Owner',email:`jane.${person.id}@qa-dental.net`}))},'0.3');
  }
  if (u.includes("outscraper")) {
    return new Response(JSON.stringify([[{name:apolloOrgName,phone:'+13055551234',full_address:'1 Main St, Miami, FL',city:'Miami',state:'FL',place_id:`fixture-${nonce}`}]]),{status:200});
  }
  throw new Error(`unexpected fixture endpoint: ${new URL(u).pathname}`);
};

async function main() {
  await pool.query(`UPDATE provider_controls SET enabled=true, circuit_state='closed',
      local_budget_units=1000, reserved_units=0, consumed_units=0
    WHERE provider IN ('apollo','outscraper')`);

  await authorizePaidBudget({ authorizedBy: runtimeActorId, typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION });

  const businessNoDomain = (await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, record_class)
     VALUES ($1,$1,'dental','Miami','FL','33101','canonical') RETURNING id`,
    [`sfp-paid-wf-nodomain-${nonce}`],
  )).rows[0].id as number;
  const businessWithDomain = (await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, record_class, website_domain)
     VALUES ($1,$1,'dental','Miami','FL','33101','canonical',$2) RETURNING id`,
    [`sfp-paid-wf-domain-${nonce}`, `already-known-${nonce}.example`],
  )).rows[0].id as number;

  const programId = (await pool.query(
    `INSERT INTO sfp_programs (name, county_fips, vertical_ids, is_active, created_by)
     VALUES ($1, ARRAY['12086'], ARRAY['dental'], true, 'test') RETURNING id`,
    [`sfp-paid-wf-program-${nonce}`],
  )).rows[0].id as string;
  const cohortRunId = (await pool.query(
    `INSERT INTO sfp_cohort_runs (program_id, idempotency_key, status, cohort_size, actor_id, cohort_state)
      VALUES ($1, $2, 'freezing', 2, $3, 'freezing') RETURNING id`,
    [programId, `sfp-paid-wf-cohort-${nonce}`, runtimeActorId],
  )).rows[0].id as string;
  for (const businessId of [businessNoDomain, businessWithDomain]) {
    await pool.query(
      `INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source)
       VALUES ($1, $2, 50, 'confirmed', 'canonical')`,
      [cohortRunId, businessId],
    );
  }
  await pool.query(
    `UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW(), completed_at=NOW() WHERE id=$1`,
    [cohortRunId],
  );

  const result = await executeSfpPaidPersonAndIdentityDiscovery(
    {
      cohortRunId, idempotencyKey: `sfp-paid-wf-run-${nonce}`, actorId: runtimeActorId,
      previewSnapshotHash: (await getSfpCohortGapSnapshot(cohortRunId)).snapshotHash,
    },
    { fetchImpl },
  );
  check(result.processed === 2, "processes both cohort members");
  check(result.succeeded >= 1, "at least one provider call succeeds (Apollo person, Outscraper on the no-domain business)");
  check(liveNetworkCalls >= 1 && liveNetworkCalls <= 10, `only the faked fetchImpl services calls, no real network path (saw ${liveNetworkCalls})`);

  const paidEvidence = (await pool.query(
    `SELECT provider, business_id, subject_type FROM sfp_paid_candidate_evidence WHERE business_id = ANY($1::int[]) ORDER BY provider`,
    [[businessNoDomain, businessWithDomain]],
  )).rows;
  check(paidEvidence.some((r: any) => r.provider === "apollo"), "an Apollo result is written to sfp_paid_candidate_evidence");
  check(paidEvidence.some((r: any) => r.provider === "outscraper" && r.business_id === businessNoDomain), "Outscraper only ran for the business missing a known domain");
  check(!paidEvidence.some((r: any) => r.provider === "outscraper" && r.business_id === businessWithDomain), "Outscraper is skipped for the business with an already-known domain (C6: dimension-specific stop condition)");
  const knownDomainOutscraperReservations = (await pool.query(
    `SELECT id FROM provider_operations
      WHERE provider='outscraper' AND purpose='sfp_business_identity_discovery'
        AND target_fingerprint=$1`,
    [`business:${businessWithDomain}`],
  )).rows;
  check(knownDomainOutscraperReservations.length === 0, "known-domain business creates no Outscraper reservation (not merely a no-result)");

  const stageItems = (await pool.query(
    `SELECT provider, business_id, outcome_code, paid_candidate_evidence_id, candidate_id FROM sfp_stage_items
      WHERE stage_run_id IN (SELECT id FROM sfp_stage_runs WHERE cohort_run_id=$1)`,
    [cohortRunId],
  )).rows;
  check(stageItems.some((r: any) => r.paid_candidate_evidence_id !== null && r.outcome_code === "candidate_found"), "a stage item links paidCandidateEvidenceId and is marked candidate_found");
  check(stageItems.every((r: any) => !(r.paid_candidate_evidence_id !== null && r.candidate_id !== null)), "no stage item ever populates both candidateId and paidCandidateEvidenceId (CHECK-consistent)");

  const freeTableLeak = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM free_discovery_candidates WHERE business_id = ANY($1::int[])`,
    [[businessNoDomain, businessWithDomain]],
  )).rows[0].n;
  check(Number(freeTableLeak) === 0, "no paid-provider result is ever written into free_discovery_candidates");

  console.log(`\nSFP paid-waterfall Apollo/Outscraper wiring: ${assertionCount} assertions passed.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    if (oldTransport === undefined) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED; else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = oldTransport;
    if (oldApolloKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = oldApolloKey;
    if (oldOutscraperKey === undefined) delete process.env.OUTSCRAPER_API_KEY; else process.env.OUTSCRAPER_API_KEY = oldOutscraperKey;
    await pool.end();
  });
