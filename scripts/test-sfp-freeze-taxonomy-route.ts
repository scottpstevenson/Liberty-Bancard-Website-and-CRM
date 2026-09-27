#!/usr/bin/env tsx
/**
 * test-sfp-freeze-taxonomy-route.ts
 *
 * HTTP-level proof for the freeze-route taxonomy fix: business 33277
 * previewed as a v2 Construction/Trades target, but a freeze request that
 * omitted `taxonomyVersion` used to silently default to v1 and classify it
 * non-target at $0. This starts an isolated loopback Express server,
 * mounts the real lead-ops routes, and hits the real freeze endpoint with
 * an authenticated admin session against a disposable database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import express from "express";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

process.env.NODE_ENV = "test";

await assertDisposableTestInfrastructure({ operation: "sfp-freeze-taxonomy-route", requireRedis: false });

const { pool } = await import("../server/db");
const { registerLeadOpsRoutes } = await import("../server/routes/lead-ops");

let assertionCount = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertionCount++;
  console.log(`✓ ${message}`);
};

const nonce = randomUUID();
const businessIds: number[] = [];
let programId: string | null = null;
let server: http.Server | null = null;

async function addNullVerticalBusiness(name: string, zip = "33101", city = "Miami", fips = "12086") {
  const result = await pool.query(
    `INSERT INTO businesses (canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
     VALUES ($1,$1,NULL,$2,'FL',$3,'active','canonical') RETURNING id`,
    [`${name}-${nonce}`, city, zip],
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

async function main() {
  const app = express();
  app.use(express.json());
  // Fake authenticated admin session — bypasses the real login flow but
  // exercises the exact same requireRole("admin") gate and route handler
  // the production server runs.
  app.use((req: any, _res, next) => {
    req.user = { id: `sfp-freeze-taxonomy-test-${nonce}`, role: "admin" };
    req.isAuthenticated = () => true;
    next();
  });
  registerLeadOpsRoutes(app);

  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  const program = await pool.query(
    `INSERT INTO sfp_programs (name,county_fips,vertical_ids,max_cohort_size,policy_version,taxonomy_version,is_active,created_by)
     VALUES ($1,$2,$3,100,40,2,false,$4) RETURNING id`,
    [`sfp-freeze-taxonomy-route-${nonce}`, ["12086"], ["Construction/Trades/Home Services"], `sfp-freeze-taxonomy-test-${nonce}`],
  );
  programId = String(program.rows[0].id);

  // This is business 33277's shape: a real roofing business, name-only
  // (vertical=NULL), that only resolves to a v2 target — under v1's
  // five-package taxonomy it has no Construction/Trades target at all.
  const roofingId = await addNullVerticalBusiness("Sunshine Roofing Contractors LLC");

  // ── Missing taxonomyVersion must be REJECTED, not silently defaulted ──
  const missingRes = await fetch(`${base}/api/lead-ops/sfp/classification/snapshot/freeze`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      programId, businessIds: [roofingId], targetIds: ["Construction/Trades/Home Services"],
      policyVersion: 40, freeOnly: true,
      // taxonomyVersion intentionally omitted -- the production defect.
    }),
  });
  check(missingRes.status === 400, "a freeze request missing taxonomyVersion is rejected with 400, never silently defaulted to v1");
  const missingBody = await missingRes.json();
  check(/taxonomyVersion/i.test(String(missingBody?.error ?? "")), "the 400 response names taxonomyVersion as the problem");

  // ── Stale taxonomyVersion (client cached an old program value) must be REJECTED ──
  const staleRes = await fetch(`${base}/api/lead-ops/sfp/classification/snapshot/freeze`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      programId, businessIds: [roofingId], targetIds: ["Construction/Trades/Home Services"],
      policyVersion: 40, taxonomyVersion: 1, freeOnly: true,
    }),
  });
  check(staleRes.status === 409, "a freeze request with a taxonomyVersion that disagrees with the live program setting is rejected with 409");
  const staleBody = await staleRes.json();
  check(staleBody?.error === "SFP_SNAPSHOT_PROGRAM_CONFIG_CHANGED", "the 409 response identifies the cause as a program-config mismatch");

  // No evidence row must exist yet -- neither rejected attempt should have
  // reached freezeClassificationSnapshot or written anything.
  const noEvidenceYet = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_classification_snapshots WHERE program_id=$1`,
    [programId],
  );
  check(Number(noEvidenceYet.rows[0].n) === 0, "no snapshot row is created by either rejected request");

  // ── Correct taxonomyVersion (matching the live program) succeeds and
  // classifies the roofing business as a v2 target with zero provider cost ──
  const okRes = await fetch(`${base}/api/lead-ops/sfp/classification/snapshot/freeze`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      programId, businessIds: [roofingId], targetIds: ["Construction/Trades/Home Services"],
      policyVersion: 40, taxonomyVersion: 2, freeOnly: true,
    }),
  });
  check(okRes.status === 200, "a freeze request with the correct, live-matching taxonomyVersion succeeds");
  const okBody = await okRes.json();
  check(okBody.businessIds?.includes(roofingId), "the roofing business survives freeze under the correct v2 taxonomy");
  check(Array.isArray(okBody.rejectedAtFreeze) && okBody.rejectedAtFreeze.length === 0, "no rejections at freeze for the v2-eligible roofing business");

  const { runFrozenClassificationSnapshot } = await import("../server/services/cro03/sfp-classification-bridge");
  let providerCalls = 0;
  const run = await runFrozenClassificationSnapshot({ snapshotId: okBody.snapshotId, actorId: `sfp-freeze-taxonomy-test-${nonce}` }, {
    openAiClassify: async () => { providerCalls++; return { outcome: "target", confidence: 0.9, reasonCodes: ["SHOULD_NEVER_BE_CALLED"], modelVersion: "x", promptVersion: "x", costMicros: 5000 }; },
    serperDomainLookup: async () => { providerCalls++; return { domain: "should-never-be-called.test", costMicros: 1000, reasonCode: "SHOULD_NEVER_BE_CALLED" }; },
  });
  check(providerCalls === 0, "running the correctly-frozen v2 snapshot makes zero provider calls");
  check(run.costMicros === 0, "running the correctly-frozen v2 snapshot reports zero cost");

  const evidenceRows = await pool.query(
    `SELECT outcome, admission_tier, resolved_vertical_id, cost_micros, taxonomy_version
       FROM sfp_classification_evidence WHERE business_id=$1 AND policy_version=40`,
    [roofingId],
  );
  const evidence = evidenceRows.rows[0];
  check(evidence?.outcome === "target", "the roofing business is now correctly classified as target under v2, not non-target");
  check(Number(evidence?.taxonomy_version) === 2, "the persisted evidence row is recorded under taxonomy_version=2");
  check(Number(evidence?.cost_micros) === 0, "the corrected classification still incurs zero cost");

  console.log(`\nSFP freeze-route taxonomy fix: ${assertionCount} assertions passed.`);
}

try {
  await main();
} finally {
  if (server) await new Promise((resolve) => server!.close(resolve));
  if (businessIds.length) {
    await pool.query(`DELETE FROM sfp_classification_items WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    await pool.query(`ALTER TABLE sfp_classification_evidence DISABLE TRIGGER sfp_classification_evidence_immutable_trg`).catch(() => {});
    await pool.query(`DELETE FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`, [businessIds]).catch(() => {});
    await pool.query(`ALTER TABLE sfp_classification_evidence ENABLE TRIGGER sfp_classification_evidence_immutable_trg`).catch(() => {});
    await pool.query(`DELETE FROM sfp_classification_snapshots WHERE program_id=$1`, [programId]).catch(() => {});
    await pool.query(`DELETE FROM business_locations WHERE business_id=ANY($1::int[])`, [businessIds]);
    await pool.query(`DELETE FROM businesses WHERE id=ANY($1::int[])`, [businessIds]);
  }
  if (programId) await pool.query(`DELETE FROM sfp_programs WHERE id=$1`, [programId]).catch(() => {});
  await pool.end();
}
