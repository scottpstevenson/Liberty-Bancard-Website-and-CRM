import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";
await assertDisposableTestInfrastructure({ operation: "Launch retained category recovery", requireRedis: true });
applyCertificationProviderDenyBoundary({ fatal: true });
const { pool } = await import("../../server/db");
const service = await import("../../server/services/scheduled-discovery/service");
const { claimCsvExecution, completeImportExecution } = await import("../../server/services/import-execution");
const actor = `launch-retained-${randomUUID()}`;
let submits = 0, checks = 0;
const check = (condition: unknown, label: string) => { assert(condition, label); checks++; console.log("PASS " + label); };
try {
  process.env.OUTSCRAPER_API_KEY = "synthetic-fixture-only";
  process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
  await pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'private fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
  await pool.query("UPDATE sfp_programs SET is_active=false");
  await pool.query("INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by) VALUES($1,ARRAY['12086'],ARRAY['Healthcare'],2,true,$1)", [actor]);
  await pool.query("INSERT INTO provider_controls(provider,capability,enabled,circuit_state) VALUES('outscraper','business_discovery',true,'closed') ON CONFLICT(provider) DO UPDATE SET enabled=true,circuit_state='closed'");
  const pricing = { outscraper: { version: 1, unitType: "result", amountMicros: 3000, billingSemantics: "per_unit_no_result_free" } };
  await pool.query("INSERT INTO mi09_pricing_schedule_snapshots(composite_hash,artifact_ids,schedule_json,captured_by,expires_at,notes) VALUES($1,'[]',$2::jsonb,$3,now()+interval '1 day','synthetic fixture only')", [createHash("sha256").update(JSON.stringify(pricing)).digest("hex"), JSON.stringify(pricing), actor]);
  await (await import("../helpers/sfp-runtime-test-identity")).selectSfpRuntimeTestRelease(actor);
  await service.initializeDiscoveryDefinitions(actor);
  const def = (await pool.query("SELECT id FROM discovery_definitions ORDER BY query LIMIT 1")).rows[0].id;
  const run = await service.createDiscoveryRun(def, "preview", actor, randomUUID());
  const raw = { name: "Synthetic Physical Therapy Fixture", type: "Physical therapist", city: "Miami", state: "FL", postal_code: "33130", place_id: `retained-${randomUUID()}` };
  const transport = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname === "/google-maps-search") { submits++; return new Response(JSON.stringify({ id: "retained-fixture", status: "Pending" }), { status: 202 }); }
    return new Response(JSON.stringify({ id: "retained-fixture", status: "Success", data: [[raw]] }));
  }) as typeof fetch;
  await service.processDiscoveryTick({ fetchImpl: transport });
  await pool.query("UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1", [run.id]);
  await service.processDiscoveryTick({ fetchImpl: transport });
  // Reconstruct a prior ruleset's completed zero-row import, retaining the real artifact and operation produced above.
  const claim = await claimCsvExecution({ fileHash: createHash("sha256").update(`prior-v3:${run.id}`).digest("hex"), totalRows: 0, actorType: "system", actorId: actor, sourcePayload: [], metadata: { scheduledDiscoveryRunId: run.id, classifierVersion: 3 } });
  await completeImportExecution({ executionId: claim.execution.id, claimToken: claim.claimToken!, expectedRows: 0 });
  await pool.query("UPDATE discovery_runs SET state='completed',completed_at=now(),import_execution_id=$2,totals='{\"importedRows\":0,\"rawRows\":1}',preview='{\"counts\":{\"unresolved\":1}}' WHERE id=$1", [run.id, claim.execution.id]);
  const artifactBefore = (await pool.query("SELECT content_hash,rows FROM discovery_artifacts WHERE run_id=$1", [run.id])).rows[0];
  const operationBefore = (await pool.query("SELECT id,billing_state,settled_cost_micros FROM provider_operations WHERE id=(SELECT operation_id FROM discovery_runs WHERE id=$1)", [run.id])).rows[0];
  await Promise.all([service.requestRetainedDiscoveryImport(run.id, actor), service.requestRetainedDiscoveryImport(run.id, actor)]);
  await service.processDiscoveryTick({ fetchImpl: transport });
  const after = (await pool.query("SELECT * FROM discovery_runs WHERE id=$1", [run.id])).rows[0];
  check(after.state === "completed" && after.totals.importedRows === 1 && after.totals.newBusinesses === 1, "Completed zero-row history is recovered through actual canonical import");
  check(after.import_execution_id !== claim.execution.id && (await pool.query("SELECT status FROM import_executions WHERE id=$1", [claim.execution.id])).rows[0].status === "completed", "Original zero-row import evidence remains intact beside new versioned execution");
  assert.deepEqual((await pool.query("SELECT content_hash,rows FROM discovery_artifacts WHERE run_id=$1", [run.id])).rows[0], artifactBefore);
  assert.deepEqual((await pool.query("SELECT id,billing_state,settled_cost_micros FROM provider_operations WHERE id=$1", [operationBefore.id])).rows[0], operationBefore);
  check(submits === 1, "Recovery never purchases or submits another search and preserves settled operation cost");
  await service.requestRetainedDiscoveryImport(run.id, actor); await service.processDiscoveryTick({ fetchImpl: transport });
  check(Number((await pool.query("SELECT count(*) FROM businesses WHERE google_place_id=$1", [raw.place_id])).rows[0].count) === 1, "Repeated retained-import command never duplicates the business");
  check((await pool.query("SELECT state,epoch FROM outbound_pause_control")).rows.every(r => r.state === "paused" && Number(r.epoch) === 4), "Recovery preserves the outbound pause");
  check((await pool.query("SELECT limit_micros FROM outscraper_budget_policy")).rows.every(r => Number(r.limit_micros) === 50000000), "Recovery preserves the shared $50 cap");
  check(getBlockedCertificationNetworkAttemptCount() === 0, "No real provider network attempt");
  console.log(`LAUNCH_RETAINED_RECOVERY_PASS ${checks}`);
} finally { await pool.end(); }
