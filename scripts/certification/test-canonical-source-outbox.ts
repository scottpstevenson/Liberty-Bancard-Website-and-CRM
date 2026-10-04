import assert from "node:assert/strict";
import fs from "node:fs";
import {randomUUID} from "node:crypto";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
await assertDisposableTestInfrastructure({operation:"canonical source outbox full-membership certification"});
process.env.VG_PROVIDER_DENY_MODE="1";
applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import("../../server/db");
const {initializeCro03aPolicy}=await import("../../server/services/cro03a-policy-initializer");
const {processOutboxCro03aQualificationCommands,processCro03aQualificationRunBatch}=await import("../../server/services/cro03a/qualification-service");
const {hashCro03Evidence}=await import("../../server/services/cro03/source-staging");
const prefix=`source_outbox_${randomUUID()}`;
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;};
const effects=async()=>(await pool.query(`SELECT
  (SELECT count(*) FROM provider_operations) providers,
  (SELECT count(*) FROM validation_intents) validations,
  (SELECT count(*) FROM sequence_enrollments) enrollments,
  (SELECT count(*) FROM communication_events) messages,
  (SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
try {
  await initializeCro03aPolicy();
  await pool.query(`INSERT INTO users(id,email,first_name,last_name,role)
    VALUES('system:cro03a-autowire',$1,'Fixture','System','admin') ON CONFLICT(id) DO NOTHING`,
    [`${prefix}@example.invalid`]);
  await pool.query(`INSERT INTO source_registry_adapters(adapter_key,source_name,source_type,stable_key_column)
    VALUES($1,$1,'stub','fixture_id')`,[prefix]);
  const importRun=(await pool.query(`INSERT INTO source_import_runs(adapter_key,status,completed_at)
    VALUES($1,'completed',NOW()) RETURNING id`,[prefix])).rows[0].id;
  const ids:string[]=[];
  for(const [label,geography] of [
    ["inside",{state:"FL",city:"Miami",zip:"33130"}],
    ["outside",{state:"GA",city:"Atlanta",zip:"30301"}],
    ["unknown",{}],
  ] as const) {
    const payload={businessName:`${prefix}_${label}`,industry:"Automotive",...geography};
    const hash=hashCro03Evidence(payload);
    const subject=(await pool.query(`INSERT INTO cro03_source_subjects(subject_type,subject_key,source_system)
      VALUES('provider_csv_row',$1,'google_maps_outscraper') RETURNING id`,[`${prefix}_${label}`])).rows[0].id;
    const observation=(await pool.query(`INSERT INTO cro03_source_observations
      (source_subject_id,observed_at,observed_by_actor_type,provenance,payload,payload_hash)
      VALUES($1,NOW(),'system','{}',$2::jsonb,$3) RETURNING id`,[subject,JSON.stringify(payload),hash])).rows[0].id;
    const occurrence=(await pool.query(`INSERT INTO cro03_source_occurrences
      (source_subject_id,source_observation_id,source_observed_at,timestamp_provenance,source_event_key,payload_hash)
      VALUES($1,$2,NOW(),'source',$3,$4) RETURNING id`,[subject,observation,`${prefix}_${label}`,hash])).rows[0].id;
    ids.push(occurrence);
  }
  const original=(await pool.query(`SELECT o.id,o.payload,o.payload_hash,o.observed_at::text
    FROM cro03_source_observations o JOIN cro03_source_subjects s ON s.id=o.source_subject_id
    WHERE s.subject_key LIKE $1 ORDER BY o.id`,[`${prefix}%`])).rows;
  const fresh=(await pool.query(`INSERT INTO cro03a_qualification_commands
    (source_import_run_id,chunk_number,selection_hash,occurrence_ids)
    VALUES($1,0,$2,$3::jsonb) RETURNING id`,[importRun,hashCro03Evidence(ids),JSON.stringify(ids)])).rows[0].id;
  const legacy=(await pool.query(`INSERT INTO cro03a_qualification_commands
    (source_import_run_id,chunk_number,selection_hash,occurrence_ids,state,error_text,processed_at)
    VALUES($1,1,$2,$3::jsonb,'completed','geography_pre_filter:0_eligible_of_2',NOW()) RETURNING id`,
    [importRun,hashCro03Evidence(ids.slice(1)),JSON.stringify(ids.slice(1))])).rows[0].id;
  const before=await effects();
  const result=await processOutboxCro03aQualificationCommands();
  check(result.processed===2 && result.failed===0,"Fresh and genuine historical geography-filtered commands are fulfilled");
  const runs=(await pool.query(`SELECT id,total_count,frozen_occurrence_ids FROM cro03a_qualification_runs
    WHERE idempotency_key LIKE $1 ORDER BY total_count DESC`,[`cro03a-autowire:${importRun}:%`])).rows;
  check(runs.length===2 && runs[0].total_count===3 && runs[1].total_count===2,
    "Outside and unknown geography remain in the real qualification run membership");
  assert.deepEqual([...runs[0].frozen_occurrence_ids].sort(),[...ids].sort());checks++;
  for(const run of runs) await processCro03aQualificationRunBatch(run.id);
  const decisions=(await pool.query(`SELECT d.occurrence_id,d.disposition,d.geography_result,d.reason_codes
    FROM cro03a_qualification_decisions d WHERE d.run_id=$1 ORDER BY d.occurrence_id`,[runs[0].id])).rows;
  check(decisions.length===3,"Every original occurrence receives a persisted qualification decision");
  for(const occurrenceId of ids.slice(1)) {
    const decision=decisions.find(row=>row.occurrence_id===occurrenceId);
    check(decision?.disposition!=="selected" && decision?.geography_result?.eligible===false,
      "Full membership never grants outside or unknown geography qualification");
  }
  const commands=(await pool.query(`SELECT id,state,error_text FROM cro03a_qualification_commands
    WHERE id=ANY($1::uuid[]) ORDER BY id`,[[fresh,legacy]])).rows;
  check(commands.every(row=>row.state==="completed"),"Commands complete after durable run creation");
  check(commands.find(row=>row.id===legacy)?.error_text?.startsWith("CANONICAL_OUTBOX_REPLAY:"),
    "Historical filtering diagnostic remains visible after replay");
  const replay=await processOutboxCro03aQualificationCommands();
  check(replay.processed===0 && replay.failed===0,"Completed commands are not repeatedly replayed");
  check(Number((await pool.query(`SELECT count(*) n FROM cro03a_qualification_runs
    WHERE idempotency_key LIKE $1`,[`cro03a-autowire:${importRun}:%`])).rows[0].n)===2,
    "Replay creates no duplicate qualification runs");
  assert.deepEqual((await pool.query(`SELECT o.id,o.payload,o.payload_hash,o.observed_at::text
    FROM cro03_source_observations o JOIN cro03_source_subjects s ON s.id=o.source_subject_id
    WHERE s.subject_key LIKE $1 ORDER BY o.id`,[`${prefix}%`])).rows,original);checks++;
  assert.deepEqual(await effects(),before);checks++;
  check(getBlockedCertificationNetworkAttemptCount()===0,"Source accounting is local; no provider calls, validation purchases or messages");
  fs.writeFileSync("docs/certification/canonical-enrichment-source-outbox.json",JSON.stringify({
    observedAt:new Date().toISOString(),checks,scope:"Disposable source qualification accounting only; not canonical entity projection or whole-task acceptance",
    retainedOccurrences:ids.length,decisions:decisions.length,historicalReplay:true,networkAttempts:0,
    effectsBefore:before,effectsAfter:await effects(),productionExecution:false,taskComplete:false,
  },null,2)+"\n");
  console.log(`PASS: ${checks} canonical source outbox checks; no provider calls, purchases, cohorts or messages`);
} finally {await pool.end();}