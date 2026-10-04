import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import fs from "node:fs";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
await assertDisposableTestInfrastructure({operation:"source registry full original retention"});
process.env.VG_PROVIDER_DENY_MODE="1";
applyCertificationProviderDenyBoundary({fatal:true});
process.env.NODE_ENV="production";
process.env.REPLIT_DEPLOYMENT="1";
process.env.SFP_PUBLISH_ARTIFACT_SHA=process.env.RELEASE_SHA!;
process.env.SFP_PUBLISH_BUILD_ID=randomUUID();
process.env.SFP_PUBLISH_BUILT_AT=new Date().toISOString();
const {pool}=await import("../../server/db");
const {runSourceImport}=await import("../../server/services/source-registry/import-runner");
const {encryptRawPayload}=await import("../../server/services/source-registry/adapter");
const {processCanonicalRegistryProjectionTick}=await import("../../server/services/canonical-registry-projection-worker");
const prefix=`original_${randomUUID()}`;
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;};
const raw=[
  {Account_Number:prefix,Business_Name:`${prefix}\nMultiline Business`,Receipt_Status:"Active",
    Business_Address:"100 Fixture Road",City:"Miami",Phone:"",Email:"fixture@example.invalid",
    Zip_Code:"33130",Unexpected_Column:"retain every column"},
  {Account_Number:"",Business_Name:`${prefix} skipped`,Receipt_Status:"Active",
    Business_Address:"200 Fixture Road",City:"Miami",Phone:"",Email:"skipped@example.invalid",
    Zip_Code:"33130",Unexpected_Column:"retain skipped original"},
];
const fields=Object.keys(raw[0]);
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
const csv=Buffer.from([fields.map(quote).join(","),...raw.map(row=>fields.map(field=>quote(row[field as keyof typeof row])).join(","))].join("\n"));
try {
  await pool.query(`INSERT INTO source_registry_adapters
    (adapter_key,source_name,source_type,county_fips,stable_key_column)
    VALUES('mdade-lbt','Fixture Miami-Dade LBT','county_lbt','12086','Account_Number')
    ON CONFLICT(adapter_key) DO NOTHING`);
  const run=(await pool.query(`INSERT INTO source_import_runs
    (adapter_key,csv_data,is_full_snapshot,requested_adapter_key)
    VALUES('mdade-lbt',$1,FALSE,'mdade-lbt') RETURNING id`,[csv])).rows[0].id;
  const before=(await pool.query(`SELECT
    (SELECT count(*) FROM contacts) contacts,(SELECT count(*) FROM provider_operations) providers,
    (SELECT count(*) FROM validation_intents) validations,(SELECT count(*) FROM communication_events) messages,
    (SELECT count(*) FROM sequence_enrollments) enrollments,(SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
  const result=await runSourceImport({runId:run});
  check(result.status==="completed" && result.recordsProcessed===1,"Adapter-selected accounting remains separate from all original rows");
  const manifest=(await pool.query(`SELECT source_row_count,csv_data FROM source_import_runs WHERE id=$1`,[run])).rows[0];
  check(manifest.source_row_count===2,"Quoted multiline cells do not fabricate extra source rows");
  check(manifest.csv_data===null,"Transient CSV cleanup still works after original retention");
  const originals=(await pool.query(`SELECT o.payload,item.state,item.terminal_code
    FROM cro03_enrichment_batches batch JOIN cro03_batch_memberships member ON member.batch_id=batch.id
    JOIN cro03_source_observations o ON o.id=member.source_observation_id
    JOIN cro03_enrichment_items item ON item.membership_id=member.id
    WHERE batch.idempotency_key=$1 ORDER BY (o.payload->>'sourceRowNumber')::int`,
    [`source-registry-original:mdade-lbt:${run}:offset-0`])).rows;
  check(originals.length===2,"Every input row retains an original evidence occurrence, including skipped rows");
  for(const [index,original] of originals.entries()) {
    check(original.payload.rawPayload===encryptRawPayload(raw[index]),"Original ciphertext includes every raw column without exposing registry PII");
    check(original.state==="completed" && original.terminal_code==="SOURCE_REGISTRY_ORIGINAL_EVIDENCE_RETAINED",
      "Evidence retention is not misreported as an unfinished enrichment job");
  }
  const normalized=(await pool.query(`SELECT o.payload FROM cro03_enrichment_batches batch
    JOIN cro03_batch_memberships member ON member.batch_id=batch.id
    JOIN cro03_source_observations o ON o.id=member.source_observation_id WHERE batch.idempotency_key=$1`,
    [`source-registry:mdade-lbt:${run}:offset-0`])).rows[0].payload;
  check(normalized.city==="Miami" && normalized.state==="FL" && normalized.address==="100 Fixture Road",
    "Canonical projection receives public organization/location evidence, not only opaque raw ciphertext");
  check((await processCanonicalRegistryProjectionTick(10)).fulfilled===1,
    "The actual registry import progresses to a committed canonical business, not just a staged batch");
  const business=(await pool.query(`SELECT b.postal_code,b.city,b.state,b.street_address FROM businesses b
    JOIN canonical_source_links l ON l.business_id=b.id WHERE l.source_system='mdade-lbt' AND l.stable_key=$1`,
    [`mdade-lbt:${prefix}`])).rows[0];
  check(business?.postal_code==="33130" && business.city==="Miami" && business.state==="FL"
    && business.street_address==="100 Fixture Road","Actual-source entity projection preserves address/ZIP/city/state evidence");
  const after=(await pool.query(`SELECT
    (SELECT count(*) FROM contacts) contacts,(SELECT count(*) FROM provider_operations) providers,
    (SELECT count(*) FROM validation_intents) validations,(SELECT count(*) FROM communication_events) messages,
    (SELECT count(*) FROM sequence_enrollments) enrollments,(SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
  assert.deepEqual(after,before);checks++;
  check(getBlockedCertificationNetworkAttemptCount()===0,"Full source retention never contacts providers or creates fictitious people");
  fs.writeFileSync("docs/certification/canonical-enrichment-registry-originals.json",JSON.stringify({
    observedAt:new Date().toISOString(),checks,rawRows:2,selectedRows:1,
    scope:"Disposable actual source-registry importer; all-column retention and CSV record accounting",
    effectsBefore:before,effectsAfter:after,networkAttempts:0,productionExecution:false,taskComplete:false,
  },null,2)+"\n");
  console.log(`PASS: ${checks} source-registry original evidence checks`);
} finally {await pool.end();}