#!/usr/bin/env tsx
/**
 * Task #1999 (C3/C6/C7): proves executeSfpPaidPersonAndIdentityDiscovery
 * writes Apollo/Outscraper results into sfp_paid_candidate_evidence and
 * links them from sfp_stage_items.paidCandidateEvidenceId — never into
 * free_discovery_candidates/cro03c_candidate_evidence — with zero live
 * provider transport (fetchImpl is faked throughout).
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "../server/db";
import { executeSfpPaidPersonAndIdentityDiscovery } from "../server/services/cro03/sfp-paid-waterfall";
import { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } from "../server/services/mi09-pilot-authority";

const nonce = randomUUID().slice(0, 8);
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
// Apollo's search is a strict two-step, identity-matched flow: an org search
// (matched by exact normalized name/domain + city/state) followed by a
// people search scoped to the matched organization id. The fake below
// mirrors that contract exactly so performApolloSearch's real matching logic
// (never bypassed by this test) resolves to a real "success" outcome.
const apolloOrgName = `sfp-paid-wf-nodomain-${nonce}`.toLowerCase();
const fetchImpl: typeof fetch = async (url: any) => {
  liveNetworkCalls++;
  const u = String(url);
  if (u.includes("mixed_companies/search")) {
    return new Response(JSON.stringify({
      organizations: [{ id: "org-1", name: apolloOrgName, city: "miami", state: "fl" }],
    }), { status: 200, headers: { "x-credits-used": "1" } });
  }
  if (u.includes("mixed_people/api_search")) {
    return new Response(JSON.stringify({
      people: [{ id: "p-1", organization: { id: "org-1" }, first_name: "Jane", last_name: "Owner", title: "Owner", email: "jane@fake-dental.example" }],
    }), { status: 200, headers: { "x-credits-used": "1" } });
  }
  if (u.includes("outscraper")) {
    return new Response(JSON.stringify([[{ name: "Fake Dental", phone: "+13055551234", full_address: "1 Main St, Miami, FL" }]]), { status: 200 });
  }
  throw new Error(`unexpected live network call in test: ${u}`);
};

async function main() {
  await pool.query(`UPDATE provider_controls SET enabled=true, circuit_state='closed',
      local_budget_units=1000, reserved_units=0, consumed_units=0
    WHERE provider IN ('apollo','outscraper')`);

  // A live runtime attestation is required by assertSfpRuntimeAuthority before any
  // paid reservation; fabricate a fresh, valid one scoped to this test run only.
  await pool.query(`
    INSERT INTO cro03c_runtime_attestations
      (idempotency_key, artifact_sha, migration_head, deployment_identity,
       environment_identity, web_boot_identity, worker_boot_identity,
       queue_topology_hash, worker_heartbeat_at, db_healthy, redis_healthy,
       captured_at, expires_at, attestation_hash, created_by)
    VALUES ($1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'test-migration-head', 'test-deploy', 'test-env', 'test-web',
            'test-worker', 'test-topo', NOW(), true, true, NOW(), NOW() + INTERVAL '1 hour',
            $2, 'test')
  `, [`sfp-paid-wf-attestation-${nonce}`, createHash("sha256").update(`sfp-paid-wf-attestation-${nonce}`).digest("hex")]);

  await authorizePaidBudget({ authorizedBy: "test", typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION });

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
     VALUES ($1, $2, 'freezing', 2, 'test', 'freezing') RETURNING id`,
    [programId, `sfp-paid-wf-cohort-${nonce}`],
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
    { cohortRunId, idempotencyKey: `sfp-paid-wf-run-${nonce}`, actorId: "test" },
    { fetchImpl },
  );
  check(result.processed === 2, "processes both cohort members");
  check(result.succeeded >= 1, "at least one provider call succeeds (Apollo person, Outscraper on the no-domain business)");
  check(liveNetworkCalls >= 1 && liveNetworkCalls <= 6, `only the faked fetchImpl services calls, no real network path (saw ${liveNetworkCalls})`);

  const paidEvidence = (await pool.query(
    `SELECT provider, business_id, subject_type FROM sfp_paid_candidate_evidence WHERE business_id = ANY($1::int[]) ORDER BY provider`,
    [[businessNoDomain, businessWithDomain]],
  )).rows;
  check(paidEvidence.some((r: any) => r.provider === "apollo"), "an Apollo result is written to sfp_paid_candidate_evidence");
  check(paidEvidence.some((r: any) => r.provider === "outscraper" && r.business_id === businessNoDomain), "Outscraper only ran for the business missing a known domain");
  check(!paidEvidence.some((r: any) => r.provider === "outscraper" && r.business_id === businessWithDomain), "Outscraper is skipped for the business with an already-known domain (C6: dimension-specific stop condition)");

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
