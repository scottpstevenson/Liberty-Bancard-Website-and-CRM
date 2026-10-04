import assert from "node:assert/strict";
import fs from "node:fs";
import {randomUUID} from "node:crypto";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
await assertDisposableTestInfrastructure({operation:"canonical full-population projection coverage"});
process.env.VG_PROVIDER_DENY_MODE="1";
applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import("../../server/db");
const {processEffectiveVerticalProjectionTick}=await import("../../server/services/crm-effective-vertical-projection");
const {readCanonicalEnrichmentStatus}=await import("../../server/services/canonical-enrichment-status");
const prefix=`projection_${randomUUID()}`;
const key="crm_effective_vertical_projection_v1";
let checks=0;
const check=(value:unknown,message:string)=>{assert(value,message);checks++;};
const effects=async()=>(await pool.query(`SELECT
  (SELECT count(*) FROM provider_operations) operations,
  (SELECT count(*) FROM validation_intents) validation,
  (SELECT count(*) FROM communication_events) communications,
  (SELECT count(*) FROM sequence_enrollments) enrollments,
  (SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
try {
  const before=await effects();
  await pool.query(`INSERT INTO businesses(canonical_name,normalized_name,record_class,vertical)
    VALUES($1,$1,'canonical','Automotive'),($2,$2,'test','Automotive')`,[`${prefix}_canonical`,`${prefix}_test`]);
  await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,vertical)
    VALUES($1,'',$1||'@example.invalid', '','production','Automotive'),
      ($2,'',$2||'@example.invalid', '','test','Automotive')`,
    [`${prefix}_production`,`${prefix}_test`]);
  await pool.query(`INSERT INTO system_settings(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key,JSON.stringify({businessCursor:999999999,contactCursor:999999999,cycles:7})]);
  let result=await processEffectiveVerticalProjectionTick(1);
  check(result.coverageVersion===2 && result.verifiedCycles===0 && result.cycles===7,
    "Legacy cursor/cycle counters never fabricate verified coverage");
  check(result.businessesScanned===1 && result.contactsScanned===1,
    "Existing worker begins a real keyset pass with committed row accounting");
  const frozenBusiness=result.businessHighWater,frozenContact=result.contactHighWater;
  const lateBusiness=(await pool.query(`INSERT INTO businesses(canonical_name,normalized_name,record_class,vertical)
    VALUES($1,$1,'canonical','Automotive') RETURNING id`,[`${prefix}_late`])).rows[0].id;
  const lateContact=(await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,vertical)
    VALUES($1,'',$1||'@example.invalid','','production','Automotive') RETURNING id`,[`${prefix}_late`])).rows[0].id;
  const lateBefore=(await pool.query(`SELECT
    (SELECT effective_vertical_status FROM businesses WHERE id=$1) business_status,
    (SELECT effective_vertical_status FROM contacts WHERE id=$2) contact_status`,[lateBusiness,lateContact])).rows[0];
  for(let tick=0;tick<1000 && result.verifiedCycles===0;tick++) result=await processEffectiveVerticalProjectionTick(50);
  check(result.verifiedCycles===1 && result.scanStartedAt===null,"A frozen-range pass terminates despite new arrivals");
  const completed=result.lastCompletedCoverage;
  check(completed.businessHighWater===frozenBusiness && completed.contactHighWater===frozenContact,
    "Completed coverage preserves the captured watermarks");
  const expected=(await pool.query(`SELECT
    (SELECT count(*)::integer FROM businesses WHERE id<=$1) businesses,
    (SELECT count(*)::integer FROM contacts WHERE id<=$2) contacts`,[frozenBusiness,frozenContact])).rows[0];
  check(completed.businessesScanned===expected.businesses && completed.contactsScanned===expected.contacts,
    "Every stored record in the frozen range is counted, including explicit non-production classes");
  const late=(await pool.query(`SELECT
    (SELECT effective_vertical_status FROM businesses WHERE id=$1) business_status,
    (SELECT effective_vertical_status FROM contacts WHERE id=$2) contact_status`,[lateBusiness,lateContact])).rows[0];
  assert.deepEqual(late,lateBefore);checks++;
  result=await processEffectiveVerticalProjectionTick(5000);
  check(result.businessHighWater>=lateBusiness && result.contactHighWater>=lateContact,
    "The next ordinary pass automatically captures new arrivals");
  for(let tick=0;tick<1000 && result.verifiedCycles===1;tick++) result=await processEffectiveVerticalProjectionTick(5000);
  check(result.verifiedCycles===2,"Two actual disposable worker passes have independent committed coverage");
  const status=await readCanonicalEnrichmentStatus();
  check(status.automaticProgress.projection.observed && status.automaticProgress.projection.verifiedCycles===2,
    "Operating status reports real coverage, not legacy cycles");
  check(status.automaticProgress.projection.lastCompletedCoverage?.contactsScanned===result.lastCompletedCoverage.contactsScanned,
    "Completed coverage is read from the durable worker receipt");
  await assert.rejects(processEffectiveVerticalProjectionTick(Number.NaN),/PAGE_LIMIT_INVALID/);checks++;
  assert.deepEqual(await effects(),before);checks++;
  check(getBlockedCertificationNetworkAttemptCount()===0,"Full-population local projection never buys validation or contacts a provider");
  fs.writeFileSync("docs/certification/canonical-enrichment-projection-coverage.json",JSON.stringify({
    observedAt:new Date().toISOString(),checks,
    scope:"Disposable full-population local projection only; not deployed scheduled cycles or whole-task acceptance",
    completedLocalPasses:result.verifiedCycles,lastCompletedCoverage:result.lastCompletedCoverage,
    networkAttempts:getBlockedCertificationNetworkAttemptCount(),effectsBefore:before,effectsAfter:await effects(),
  },null,2)+"\n");
  console.log(`PASS: ${checks} canonical full-population projection coverage checks; no paid queues, cohorts or messages`);
} finally {await pool.end();}