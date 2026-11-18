/** Current selected-recipient handoff certification. The routine fleet-certificate
 * TTL and frozen-cohort validation scheduler were retired; asserting their old
 * source text would demand reactivating a deliberately contained spend path. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {assertDisposableTestInfrastructure} from './test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from './certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Current SFP validation handoff certification'});
applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import('../server/db');
const {claimCsvExecution}=await import('../server/services/import-execution');
const {materializeCanonicalProviderImportRow}=await import('../server/services/canonical-provider-import');
const {selectSfpRuntimeTestRelease}=await import('./helpers/sfp-runtime-test-identity');
const {verifyDiscoveryDownstream}=await import('./certification/fixtures/task2161-downstream');
const actor=`selected-handoff-${randomUUID()}`;const domain=`selected-${randomUUID().slice(0,8)}.net`;
try{
 await selectSfpRuntimeTestRelease(actor);
 await pool.query('UPDATE sfp_programs SET is_active=false');
 await pool.query("INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by) VALUES($1,ARRAY['12086'],ARRAY['Healthcare'],2,true,$1)",[actor]);
 const raw={name:`${actor} Dental`,website:`https://${domain}`,address:'123 Current Fixture Street',city:'Miami',state:'FL',postal_code:'33130',type:'dentist',place_id:`${actor}-place`};
 const claim=await claimCsvExecution({fileHash:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),totalRows:1,actorType:'system',actorId:actor,sourcePayload:[raw],metadata:{sourceFormat:'google_maps_outscraper'}});
 const imported=await materializeCanonicalProviderImportRow({executionId:claim.execution.id,claimToken:claim.claimToken!,sourceRowNumber:1,sourceFormat:'google_maps_outscraper',actorId:actor,rawRow:raw});
 assert(imported.businessId&&imported.contactIds.length===0,'Business-only canonical intake precedes actual crawl evidence');
 const before=Number((await pool.query('SELECT count(*) n FROM provider_operations')).rows[0].n);
 const {processSfpAttestationRefreshTick}=await import('../server/services/cro03/sfp-attestation-refresh');
 assert.deepEqual(await processSfpAttestationRefreshTick(),{refreshed:false,reason:'ROUTINE_SFP_ATTESTATION_REFRESH_RETIRED'});
 const {runZeroBounceAutoRun,ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED}=await import('../server/services/zerobounce-campaign-worker');
 assert.equal(ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED,true);
 assert.deepEqual(await runZeroBounceAutoRun(),{outcome:'skipped',reason:'broad_universe_auto_run_contained'});
 assert.equal(Number((await pool.query('SELECT count(*) n FROM provider_operations')).rows[0].n),before,'Retired refresh/broad auto-run makes zero purchases');
 await verifyDiscoveryDownstream(pool,imported.businessId,actor);
 assert.equal(getBlockedCertificationNetworkAttemptCount(),0);
 console.log('PASS SFP_VALIDATION_HANDOFF_REPAIR_CERTIFICATION_PASS currentSelectedReceipt=true retiredRefresh=true broadAutoRunContained=true outboundEffects=0');
}finally{await pool.end();}
process.exit(0);
