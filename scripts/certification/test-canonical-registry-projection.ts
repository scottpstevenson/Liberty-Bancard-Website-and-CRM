import assert from "node:assert/strict";
import fs from "node:fs";
import {randomUUID} from "node:crypto";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
await assertDisposableTestInfrastructure({operation:"canonical registry entity projection"});
process.env.VG_PROVIDER_DENY_MODE="1";
applyCertificationProviderDenyBoundary({fatal:true});
// Explicit build metadata solely inside the guarded disposable process.
process.env.NODE_ENV="production";
process.env.REPLIT_DEPLOYMENT="1";
process.env.SFP_PUBLISH_ARTIFACT_SHA=process.env.RELEASE_SHA!;
process.env.SFP_PUBLISH_BUILD_ID=randomUUID();
process.env.SFP_PUBLISH_BUILT_AT=new Date().toISOString();
const {pool}=await import("../../server/db");
const {createCro03SourceBatch}=await import("../../server/services/cro03/source-staging");
const {processCanonicalRegistryProjectionTick}=await import("../../server/services/canonical-registry-projection-worker");
const {readCanonicalEnrichmentStatus}=await import("../../server/services/canonical-enrichment-status");
const prefix=`registry_${randomUUID().replaceAll("-","")}`;
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;};
const effects=async()=>(await pool.query(`SELECT
  (SELECT count(*) FROM contacts) contacts,
  (SELECT count(*) FROM provider_operations) providers,
  (SELECT count(*) FROM validation_intents) validations,
  (SELECT count(*) FROM sequence_enrollments) enrollments,
  (SELECT count(*) FROM communication_events) messages,
  (SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
async function sourceRun(payloads:Record<string,unknown>[],suffix:string,status="completed") {
  const run=(await pool.query(`INSERT INTO source_import_runs(adapter_key,status,records_processed,completed_at)
    VALUES($1,$2,$3,NOW()) RETURNING id`,[prefix,status,payloads.length])).rows[0].id;
  const batch=await createCro03SourceBatch({
    idempotencyKey:`source-registry:${prefix}:${run}:offset-0`,
    actorType:"import",actorId:`source-registry-${prefix}`,purpose:"staging_review",
    subjects:payloads.map((payload,index)=>({
      subjectType:"provider_csv_row" as const,subjectKey:`${prefix}:${String(payload.stableKey ?? suffix+index)}`,
      sourceSystem:prefix,payload,provenance:{runId:run,adapterKey:prefix},
      sourceEventKey:`${prefix}:${suffix}:${index}:${run}`,timestampProvenance:"import",
    })),
  });
  return {run,batch};
}
const sourceFacts=[
  {businessName:`${prefix}_inside`,stableKey:"inside",city:"Miami",state:"FL",postalCode:"33130",vertical:"Automotive",rawPayload:"original-inside"},
  {businessName:`${prefix}_outside`,stableKey:"outside",city:"Atlanta",state:"GA",postalCode:"30301",vertical:"Automotive",rawPayload:"original-outside"},
  {businessName:`${prefix}_unknown`,stableKey:"unknown",vertical:"Automotive",rawPayload:"original-unknown"},
  {stableKey:"missing",city:"Miami",state:"FL",rawPayload:"original-missing-name"},
];
try {
  await pool.query(`INSERT INTO source_registry_adapters(adapter_key,source_name,source_type,stable_key_column)
    VALUES($1,$1,'stub','stableKey')`,[prefix]);
  const first=await sourceRun(sourceFacts,"first");
  const original=(await pool.query(`SELECT o.id,o.payload,o.payload_hash,o.observed_at::text,o.provenance
    FROM cro03_source_observations o JOIN cro03_source_subjects s ON s.id=o.source_subject_id
    WHERE s.source_system=$1 ORDER BY o.id`,[prefix])).rows;
  const before=await effects();
  const results=await Promise.all([processCanonicalRegistryProjectionTick(2),processCanonicalRegistryProjectionTick(2)]);
  check(results.reduce((sum,r)=>sum+r.fulfilled,0)===3,"Concurrent local workers fulfill all supported registry records");
  check(results.reduce((sum,r)=>sum+r.held,0)===1,"Missing business identity is held, not invented");
  check(results.every(r=>r.failed===0),"Parallel source workers retain their claim/runtime fences");
  const businesses=(await pool.query(`SELECT b.id,b.canonical_name,l.stable_key,l.raw_evidence
    FROM businesses b JOIN canonical_source_links l ON l.business_id=b.id WHERE l.source_system=$1
    ORDER BY l.stable_key`,[prefix])).rows;
  check(businesses.length===3,"Inside, outside and unknown geography create genuine canonical businesses");
  check(new Set(businesses.map(b=>b.id)).size===3,"Distinct registry identities are not collapsed into one business");
  check(businesses.every(b=>b.raw_evidence.sourceImportRunId===first.run),"Canonical evidence binds to the actual source import");
  check((await pool.query(`SELECT count(*)::int n FROM cro03_enrichment_items WHERE batch_id=$1
    AND state='completed' AND terminal_code='CANONICAL_REGISTRY_ENTITY_FULFILLED'`,[first.batch.id])).rows[0].n===3,
    "Fulfillment lives on original source items, not fabricated imports");
  const second=await sourceRun(sourceFacts.slice(0,3),"second");
  const replay=await processCanonicalRegistryProjectionTick(10);
  check(replay.fulfilled===3 && replay.failed===0,"A new legitimate source run reuses canonical registry identities");
  check((await pool.query(`SELECT count(*)::int n FROM canonical_source_links WHERE source_system=$1`,
    [prefix])).rows[0].n===3,"Source replay cannot duplicate canonical bindings");
  check((await pool.query(`SELECT count(*)::int n FROM businesses WHERE canonical_name LIKE $1`,
    [`${prefix}%`])).rows[0].n===3,"Source replay cannot duplicate businesses");
  check((await pool.query(`SELECT count(*)::int n FROM cro03_enrichment_items WHERE batch_id=$1
    AND terminal_code='CANONICAL_REGISTRY_ENTITY_FULFILLED'`,[second.batch.id])).rows[0].n===3,
    "Reused immutable observations do not incorrectly bind fulfillment to an older import");
  assert.deepEqual((await pool.query(`SELECT o.id,o.payload,o.payload_hash,o.observed_at::text,o.provenance
    FROM cro03_source_observations o JOIN cro03_source_subjects s ON s.id=o.source_subject_id
    WHERE s.source_system=$1 ORDER BY o.id`,[prefix])).rows,original);checks++;
  await sourceRun([{businessName:`${prefix}_failed_run`,stableKey:"failed"}],"failed","failed");
  check((await processCanonicalRegistryProjectionTick(10)).fulfilled===0,
    "Failed imports retain evidence but never acquire completed-import authority");
  const rollbackName=`${prefix}_rollback`;
  const rollback=await sourceRun([{businessName:rollbackName,stableKey:"rollback",city:"Miami",state:"FL"}],"rollback");
  // Private fixture-only trigger simulates lease expiry between organization
  // insertion and final binding. No production authority/guard is changed.
  await pool.query(`CREATE FUNCTION cert_registry_expire_claim() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN
      IF NEW.canonical_name LIKE '%_rollback' THEN
        UPDATE cro03_enrichment_items SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'
          WHERE state='running' AND current_provider='canonical_local_registry';
      END IF;
      RETURN NEW;
    END $fixture$;
    CREATE TRIGGER cert_registry_expire_claim BEFORE INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION cert_registry_expire_claim()`);
  check((await processCanonicalRegistryProjectionTick(1)).failed===1,"Mid-transaction lease loss is fenced");
  check((await pool.query(`SELECT count(*)::int n FROM businesses WHERE canonical_name=$1`,[rollbackName])).rows[0].n===0,
    "Lost authority rolls back the new business, not just the fulfillment marker");
  check((await pool.query(`SELECT count(*)::int n FROM canonical_source_links WHERE stable_key=$1`,
    [`${prefix}:rollback`])).rows[0].n===0,"Lost authority cannot leave an orphan canonical binding");
  await pool.query(`DROP TRIGGER cert_registry_expire_claim ON businesses; DROP FUNCTION cert_registry_expire_claim()`);
  await pool.query(`UPDATE cro03_enrichment_items SET next_attempt_at=clock_timestamp() WHERE batch_id=$1`,[rollback.batch.id]);
  check((await processCanonicalRegistryProjectionTick(1)).fulfilled===1,"A genuine failed claim resumes automatically");
  const status=await readCanonicalEnrichmentStatus();
  check(status.registryProjection.fulfilled===7 && status.registryProjection.held===1
    && status.registryProjection.pending===0 && status.registryProjection.sourceUnavailable===1,
    "Operating view distinguishes genuine fulfillment, held identity and retained failed-import work");
  check(status.registryProjection.recent.filter(row=>row.state==="completed").every(row=>row.businessId!=null),
    "Operating view exposes committed entity bindings on original source items");
  const conflictName=`${prefix}_conflict`;
  await sourceRun([{businessName:conflictName,stableKey:"conflict",city:"Miami",state:"FL"}],"conflict");
  await pool.query(`CREATE FUNCTION cert_registry_conflicting_binding() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN
      IF NEW.canonical_name LIKE '%_conflict' THEN
        INSERT INTO canonical_source_links(business_id,source_system,source_type,stable_key,registry_id,raw_evidence)
          VALUES(${Number(businesses[0].id)},'${prefix}','public_registry','${prefix}:conflict','${prefix}','{}');
      END IF;
      RETURN NEW;
    END $fixture$;
    CREATE TRIGGER cert_registry_conflicting_binding BEFORE INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION cert_registry_conflicting_binding()`);
  check((await processCanonicalRegistryProjectionTick(1)).held===1,"A concurrently conflicting canonical binding is held");
  check((await pool.query(`SELECT count(*)::int n FROM businesses WHERE canonical_name=$1`,[conflictName])).rows[0].n===0,
    "Canonical binding conflicts roll back the new business, not merely its source marker");
  await pool.query(`DROP TRIGGER cert_registry_conflicting_binding ON businesses;
    DROP FUNCTION cert_registry_conflicting_binding()`);
  const sameName=`${prefix}_same_name_unknown_location`;
  await sourceRun([{businessName:sameName,stableKey:"unknown-location-one"},
    {businessName:sameName,stableKey:"unknown-location-two"}],"weak-name");
  check((await processCanonicalRegistryProjectionTick(2)).fulfilled===2,
    "Distinct genuine registry identifiers remain resolvable without invented location data");
  check((await pool.query(`SELECT count(*)::int n FROM businesses WHERE canonical_name=$1`,[sameName])).rows[0].n===2,
    "A business name alone cannot merge unrelated source identities with unknown geography");
  assert.deepEqual(await effects(),before);checks++;
  check(getBlockedCertificationNetworkAttemptCount()===0,"Local registry projection performs no provider calls");
  await assert.rejects(processCanonicalRegistryProjectionTick(0),/LIMIT_INVALID/);checks++;
  fs.writeFileSync("docs/certification/canonical-enrichment-registry-projection.json",JSON.stringify({
    observedAt:new Date().toISOString(),checks,scope:"Disposable source-registry canonical entity projection",
    concurrentWorkers:true,originalEvidencePreserved:true,leaseLossRollsBackBusiness:true,
    effectsBefore:before,effectsAfter:await effects(),networkAttempts:0,productionExecution:false,taskComplete:false,
  },null,2)+"\n");
  console.log(`PASS: ${checks} canonical registry projection checks; no contacts, providers, paid validation, cohorts or messages`);
} finally {await pool.end();}