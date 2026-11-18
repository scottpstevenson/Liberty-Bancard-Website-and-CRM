/** Real crawler/parser/materializer/preparation/validation owners, with only socket/provider I/O replaced. */
import assert from 'node:assert/strict';
import https from 'node:https';
import {Resolver} from 'node:dns/promises';
import {promises as dns} from 'node:dns';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import type {Pool} from 'pg';
export async function verifyDiscoveryDownstream(pool:Pool,businessId:number,actorId:string){
 const q=(s:string,p:any[]=[])=>pool.query(s,p);
 const b=(await q('SELECT * FROM businesses WHERE id=$1',[businessId])).rows[0];
 const domain=b.website_domain;const email=`info@${domain}`;
 const before=(await q(`SELECT (SELECT count(*) FROM communication_events)::int communications,
 (SELECT count(*) FROM sfp_cohort_runs)::int cohorts,
 (SELECT value FROM system_settings WHERE key='zerobounce_auto_run_enabled') legacy_setting`)).rows[0];
 const original={request:https.request,resolve4:dns.resolve4,resolve6:dns.resolve6,fetch:globalThis.fetch};let sockets=0;
 const html=`<html><a href="/contact">Contact</a><a href="mailto:${email}">Email</a><script type="application/ld+json">{"@type":"Dentist","name":"Private fixture dental","email":"${email}"}</script></html>`;
 dns.resolve4=(async(host:string)=>{assert.equal(host,domain);return ['93.184.216.34'];}) as any;
 dns.resolve6=(async(host:string)=>{assert.equal(host,domain);return [];}) as any;
 https.request=((options:any,callback:any)=>{
  assert.equal(options.servername,domain);assert.equal(options.host,'93.184.216.34');sockets++;
  const request=new EventEmitter() as any;request.destroy=()=>request;
  request.end=()=>queueMicrotask(()=>{const response=Readable.from([Buffer.from(html)]) as any;response.statusCode=200;response.headers={'content-type':'text/html'};callback(response);});
  return request;
 }) as any;
 globalThis.fetch=(async(input:any,init:any)=>{
  const u=new URL(String(input));if(u.pathname.endsWith(`/domain/${domain}`))return new Response('{}',{status:404});
  return original.fetch(input,init);
 }) as typeof fetch;
 try{
  const {runFreeBusinessEnrichmentForBusiness}=await import('../../../server/services/queue-manager');
  await runFreeBusinessEnrichmentForBusiness(businessId);
 }finally{https.request=original.request;dns.resolve4=original.resolve4;dns.resolve6=original.resolve6;globalThis.fetch=original.fetch;}
 assert(sockets>0,'Actual SSRF-safe crawler consumed captured HTML through fake socket');
 assert.equal((await q('SELECT free_enrichment_status FROM businesses WHERE id=$1',[businessId])).rows[0].free_enrichment_status,'enriched');
 const candidates=(await q("SELECT id FROM free_discovery_candidates WHERE business_id=$1 AND disposition='staged'",[businessId])).rows;
 assert(candidates.length>0,'Crawler retained encrypted email evidence');
 const {runStagedEmailMaterialization}=await import('../../../server/services/free-discovery/staged-email-materialization');
 await runStagedEmailMaterialization({limit:25,actorId,candidateIds:candidates.map(c=>c.id)});
 const contact=(await q('SELECT id,business_id,record_class FROM contacts WHERE email=$1',[email])).rows[0];
 assert(contact&&contact.business_id===businessId&&contact.record_class==='production','Staged evidence materialized genuine linked contact');
 const program=(await q('SELECT id FROM sfp_programs WHERE is_active AND taxonomy_version=2')).rows[0];
 const sequence=(await q("INSERT INTO follow_up_sequences(name,status,trigger_config) VALUES('Task2161 synthetic paused preparation','paused',$1::jsonb) RETURNING id",[JSON.stringify({canonicalProgramId:program.id,canonicalVerticals:['Healthcare']})])).rows[0];
 const {processEffectiveVerticalProjectionTick}=await import('../../../server/services/crm-effective-vertical-projection');await processEffectiveVerticalProjectionTick();
 const {prepareCanonicalRecipient}=await import('../../../server/services/canonical-recipient-preparation');
 const prepare=()=>prepareCanonicalRecipient({contactId:contact.id,businessId,programId:program.id,sequenceId:sequence.id,actor:{role:'admin',actorId,email:null},source:'task2161_synthetic_acceptance'});
 const prepared=await prepare();assert.equal(prepared.preparationState,'pending_validation');
 const intent=(await q("SELECT id FROM validation_intents WHERE contact_id=$1 AND state='pending'",[contact.id])).rows[0];assert(intent);
 await q("UPDATE provider_controls SET enabled=true,circuit_state='closed' WHERE provider='zerobounce'");
 const {recoverValidationIntents}=await import('../../../server/services/provider-readiness-control');
 const {getQueueManager,shutdownQueueManager}=await import('../../../server/services/queue-manager');
 const {selectSfpRuntimeTestRelease}=await import('../../helpers/sfp-runtime-test-identity');
 const {claimSfpRuntimeDeploymentOwner}=await import('../../../server/services/cro03/sfp-provider-operations');
 const profile=process.env.BACKGROUND_JOB_PROFILE,key=process.env.ZEROBOUNCE_API_KEY,fetchBefore=globalThis.fetch;
 const originalMx=Resolver.prototype.resolveMx;let calls=0;
 Resolver.prototype.resolveMx=(async()=>[{exchange:'mx.synthetic.invalid',priority:10}]) as any;
 process.env.BACKGROUND_JOB_PROFILE='selective:email-validation';process.env.ZEROBOUNCE_API_KEY='task2161-disposable-zerobounce-only';
 globalThis.fetch=(async(input:any,init:any)=>{
  const url=new URL(String(input));if(url.hostname==='api.zerobounce.net'&&url.pathname==='/v2/validate'){
   assert.equal(url.searchParams.get('email'),email);calls++;return new Response(JSON.stringify({status:'valid',sub_status:''}));
  }
  return fetchBefore(input,init);
 }) as typeof fetch;
 try{
  await selectSfpRuntimeTestRelease(actorId);await claimSfpRuntimeDeploymentOwner();
  const manager=await getQueueManager();assert(manager.getQueue('zerobounce-batch-validate')&&!manager.getQueue('sequences'));
  assert.equal(await recoverValidationIntents(10),1,'Existing recovery owner enqueues the current selected intent');
  let row:any;for(let n=0;n<150;n++){
   row=(await q('SELECT state,enqueue_state,terminal_code FROM validation_intents WHERE id=$1',[intent.id])).rows[0];
   if(row.state==='completed'||row.state==='blocked'||row.state==='failed')break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(row?.enqueue_state,'enqueued');assert.equal(row?.state,'completed',JSON.stringify(row));
 }finally{
  await shutdownQueueManager();Resolver.prototype.resolveMx=originalMx;globalThis.fetch=fetchBefore;
  if(profile===undefined)delete process.env.BACKGROUND_JOB_PROFILE;else process.env.BACKGROUND_JOB_PROFILE=profile;
  if(key===undefined)delete process.env.ZEROBOUNCE_API_KEY;else process.env.ZEROBOUNCE_API_KEY=key;
  await selectSfpRuntimeTestRelease(actorId);
 }
 assert.equal(calls,1);
 const receipt=(await q("SELECT operation_id,outcome FROM provider_observations WHERE subject_type='contact' AND subject_id=$1 ORDER BY observed_at DESC LIMIT 1",[contact.id])).rows[0];assert.equal(receipt?.outcome,'valid');
 assert.equal((await prepare()).preparationState,'ready_held');
 const after=(await q(`SELECT (SELECT count(*) FROM communication_events)::int communications,
 (SELECT count(*) FROM sfp_cohort_runs)::int cohorts,
 (SELECT value FROM system_settings WHERE key='zerobounce_auto_run_enabled') legacy_setting`)).rows[0];assert.deepEqual(after,before);
 console.log('TASK2161_DOWNSTREAM_PASS',JSON.stringify({businessId,contactId:contact.id,candidates:candidates.length,htmlSockets:sockets,intentId:intent.id,receiptOperation:receipt.operation_id,fakeValidationCalls:calls,realQueue:'zerobounce-batch-validate',outboundEffects:0,legacyActivation:false}));
}
