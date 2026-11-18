import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Task 2161 persistence and concurrency',requireRedis:true});
applyCertificationProviderDenyBoundary({fatal:true});process.env.OUTSCRAPER_API_KEY='task2161-disposable-only';process.env.CRO03_PROVIDER_TRANSPORT_ENABLED='true';
const {pool,db}=await import('../../server/db');
const {selectSfpRuntimeTestRelease}=await import('../helpers/sfp-runtime-test-identity');
const service=await import('../../server/services/scheduled-discovery/service');
const actor=`task2161-${randomUUID()}`;
let checks=0,submits=0,polls=0;const check=(v:unknown,m:string)=>{assert(v,m);checks++;console.log(`PASS ${m}`);};
const q=async(sql:string,args:any[]=[])=>pool.query(sql,args);const scalar=async(sql:string,args:any[]=[])=>Object.values((await q(sql,args)).rows[0])[0];
const beforeMaterialization=async()=> (await q(`SELECT
 (SELECT count(*) FROM businesses)::int businesses,(SELECT count(*) FROM contacts)::int contacts,
 (SELECT count(*) FROM canonical_source_links)::int sources,(SELECT count(*) FROM validation_intents)::int validation,
 (SELECT count(*) FROM cro03_enrichment_batches)::int batches,
 (SELECT count(*) FROM free_discovery_candidates)::int crawler_candidates,(SELECT count(*) FROM free_discovery_generations)::int crawler_generations,
 (SELECT count(*) FROM cr04_enrollment_intents)::int preparation,(SELECT count(*) FROM business_locations)::int locations`)).rows[0];
const runState=async(id:string)=>(await q('SELECT * FROM discovery_runs WHERE id=$1',[id])).rows[0];
const data=[{name:'Task2161 Dental LLC',type:'dentist',site:'https://task2161-dental.net',full_address:'123 Main Street',city:'Miami',state:'FL',postal_code:'33130',place_id:'task2161-place',google_id:'task2161-google',emails:['task2161-one@gmail.com','task2161-two@gmail.com']},
 {name:'Task2161 Dental Inc',type:'dentist',site:'https://task2161-dental.net',full_address:'123 Main Street',city:'Miami',state:'FL',postal_code:'33130',place_id:'task2161-place'},
 {name:'Northern Dental',type:'dentist',city:'Atlanta',state:'GA',postal_code:'30301',place_id:'outside-place'},
 {name:'Nameless location',type:'dentist'},{},{name:'Task2161 Business Only Dental',type:'dentist',full_address:'456 Solo Street',city:'Miami',state:'FL',postal_code:'33130',google_id:'task2161-google-only'}];
let pollResult:any={id:'task2161-task',status:'Pending'};
const fetchImpl=(async(url:any)=>{
 const u=new URL(String(url));assert.equal(u.hostname,'api.outscraper.com');
 if(u.pathname==='/google-maps-search'){submits++;assert.equal(u.searchParams.get('limit'),u.searchParams.get('query')?.includes('interrupted import')?'2':'100');return new Response(JSON.stringify({id:`task2161-task-${submits}`,status:'Pending'}),{status:202});}
 assert.match(u.pathname,/^\/requests\/task2161-task-/);polls++;
 return new Response(JSON.stringify({...pollResult,id:u.pathname.split('/').at(-1)}));
}) as typeof fetch;
try{
 const {verifyDiscoverySchema}=await import('./fixtures/task2161-schema');await verifyDiscoverySchema(pool);checks++;
 await q(`UPDATE sfp_programs SET is_active=false`);
 await q(`INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by) VALUES($1,ARRAY['12086'],ARRAY['Healthcare'],2,true,$1)`,[actor]);
 await q(`INSERT INTO provider_controls(provider,capability,enabled,circuit_state) VALUES('outscraper','business_discovery',true,'closed') ON CONFLICT(provider) DO UPDATE SET enabled=true,circuit_state='closed'`);
 // Synthetic reviewed-rate fixture in this disposable database only. The
 // production path still requires an unexpired real pricing observation.
 const pricing={outscraper:{version:1,unitType:'result',amountMicros:3000,billingSemantics:'per_unit_no_result_free'}};
 await q(`INSERT INTO mi09_pricing_schedule_snapshots(composite_hash,artifact_ids,schedule_json,captured_by,expires_at,notes)
 VALUES($1,'[]',$2::jsonb,$3,now()+interval '1 day','disposable Task2161 price fixture')`,
 [createHash('sha256').update(JSON.stringify(pricing)).digest('hex'),JSON.stringify(pricing),actor]);
 await selectSfpRuntimeTestRelease(actor);
 await service.initializeDiscoveryDefinitions(actor);
 check(Number(await scalar('SELECT count(*) FROM discovery_definitions'))===4,'T09 definitions from actual v2 program, useful Healthcare terms');
 check(await scalar('SELECT enabled FROM discovery_schedules')===false,'Schedule defaults disabled');
 const defs=(await q('SELECT * FROM discovery_definitions ORDER BY query')).rows;
 // Shared financial contention is certified separately by the real global-budget suite.
 const {readOutscraperMonthlyBudget,updateOutscraperMonthlyBudget}=await import('../../server/services/outscraper-monthly-budget');
 check((await readOutscraperMonthlyBudget()).limitMicros===50000000,'CRM-wide Outscraper ceiling defaults to authorized $50');
 await updateOutscraperMonthlyBudget(actor,{leadsQuote:{unitPriceMicros:3000,unit:'domain',expiresAt:new Date(Date.now()+86400000).toISOString(),evidence:'Synthetic disposable Task2161 enrichment quote; no provider billing claim'}});
 const baseline=await beforeMaterialization();
 const pilot=await service.createDiscoveryRun(defs[0].id,'preview',actor,randomUUID());
 const duplicate=await service.createDiscoveryRun(defs[0].id,'scheduled',actor,randomUUID());
 check(pilot.id===duplicate.id,'T01 pilot/scheduled race share active definition occurrence');
 const outcomes=await Promise.all([service.processDiscoveryTick({fetchImpl}),service.processDiscoveryTick({fetchImpl})]);
 check(submits===1&&outcomes.some(x=>x.state==='busy'),'T01 two workers produce exactly one actual submit');
 let r=await runState(pilot.id);check(r.state==='pending'&&!!r.provider_task_id&&!!r.operation_id,'T03 task ID and operation retained');
 check(Number(await scalar('SELECT count(*) FROM provider_attempts WHERE dispatch_marked_at IS NOT NULL'))===1,'Canonical pre-I/O dispatch marker persisted');
 await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[r.id]);await service.processDiscoveryTick({fetchImpl});
 r=await runState(pilot.id);check(r.state==='pending'&&polls===1,'T03 same-ID pending recovery');
 await q('UPDATE sfp_programs SET is_active=false WHERE is_active');
 await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[r.id]);await service.processDiscoveryTick({fetchImpl});
 check((await runState(pilot.id)).state==='pending'&&polls===2,'T03/T09 known task continues recovery after active program removal');
 await q('UPDATE sfp_programs SET is_active=true WHERE created_by=$1',[actor]);
 await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[r.id]);
 await service.processDiscoveryTick({fetchImpl:(async()=>new Response('unavailable',{status:503})) as typeof fetch});
 check((await runState(pilot.id)).state==='pending'&&(await runState(pilot.id)).provider_task_id===r.provider_task_id,'T03 transient poll failure retains the accepted ID for retry');
 await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[r.id]);
 const pausedDefinition=await service.updateDiscoveryDefinition(defs[0].id,actor,{enabled:false});check(pausedDefinition.revision===defs[0].revision,'T03 definition pause does not change its query revision');
 pollResult={status:'Success',data:[data]};await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[r.id]);await service.processDiscoveryTick({fetchImpl});
 r=await runState(pilot.id);check(r.state==='results_retained','T02 artifact retained before local fulfillment');
 await service.processDiscoveryTick({fetchImpl});r=await runState(pilot.id);
 check(r.state==='preview_ready',`T04 retained preview ready: ${r.state} ${r.last_error??''}`);
 assert.deepEqual(await beforeMaterialization(),baseline);checks++;console.log('PASS T04 preview has zero materialization/validation changes');
 check(r.preview.counts.wouldCreate===2&&r.preview.counts.duplicates===1&&r.preview.counts.outOfScope===1,'T08 intra-result duplicates and out-of-scope preview counts');
 check(r.preview.counts.invalid===1&&r.preview.counts.unresolved===1,'T09 malformed and unresolved retained separately');
 await service.requestRetainedDiscoveryImport(r.id,actor);await service.processDiscoveryTick({fetchImpl});r=await runState(pilot.id);
 if(r.state!=='completed')console.log('IMPORT_DEBUG',r.state,r.last_error);
 check(r.state==='completed','T04 retained import finishes through cold-start canonical provider processor');
 check(submits===1,'T04 retained import makes no second paid search');
 check(r.totals.newBusinesses===2&&r.totals.matchedBusinesses===0&&r.totals.contacts===2,'T08 durable distinct business/contact totals');
 check(await scalar("SELECT website_domain FROM businesses WHERE google_place_id='task2161-place'")==='task2161-dental.net','T06 website survives to canonical business');
 check(await scalar("SELECT street_address FROM businesses WHERE google_place_id='task2161-place'")==='123 Main Street','T06 street address survives');
 check(Number(await scalar("SELECT count(*) FROM canonical_source_links WHERE source_type='google_id' AND stable_key='task2161-google-only'"))===1,'T06 Google-only stable ID retains its true namespace');
 const businessOnly=(await q("SELECT b.id,b.google_place_id,(SELECT count(*) FROM contacts c WHERE c.business_id=b.id)::int contacts FROM businesses b JOIN canonical_source_links l ON l.business_id=b.id WHERE l.source_type='google_id' AND l.stable_key='task2161-google-only'")).rows[0];
 check(businessOnly.google_place_id===null&&businessOnly.contacts===0,'T06 business-only row creates no fabricated mailbox or place ID');
 check(Number(await scalar('SELECT count(*) FROM import_executions'))===1,'T04 one deterministic execution');
 const totals=r.totals;await service.requestRetainedDiscoveryImport(r.id,actor);await service.processDiscoveryTick({fetchImpl});assert.deepEqual((await runState(r.id)).totals,totals);checks++;
 check(Number(await scalar("SELECT count(*) FROM contacts WHERE email LIKE 'task2161-%@gmail.com'"))===2,'T06 all distinct mailboxes materialize exactly once');
 await service.updateDiscoveryDefinition(defs[0].id,actor,{enabled:true});
 const lost=await service.createDiscoveryRun(defs[1].id,'preview',actor,randomUUID());
 await service.processDiscoveryTick({fetchImpl,afterDispatch:async()=>{throw new Error('SIMULATED_POST_DISPATCH_CRASH');}});
 check((await runState(lost.id)).state==='submission_unknown','T02 lost acceptance/ID is submission_unknown');
 const count=submits;await service.processDiscoveryTick({fetchImpl});check(submits===count,'T03 unknown never automatically resubmits');
 await service.reconcileDiscoverySubmission(lost.id,actor,{taskId:'task2161-task-reconciled',evidence:'Synthetic provider task-ID verification receipt from controlled fake transport.'});
 pollResult={status:'Success',data:[[]]};await service.processDiscoveryTick({fetchImpl});await service.processDiscoveryTick({fetchImpl});
 check((await runState(lost.id)).state==='preview_ready','T03 verified ID resumes result retrieval without purchase');
 const zero=await runState(lost.id);check(zero.preview.counts.rawRows===0,'T07 explicit zero-row receipt has no fabricated placeholder');
 await service.requestRetainedDiscoveryImport(lost.id,actor);await service.processDiscoveryTick({fetchImpl});
 check((await runState(lost.id)).state==='completed','T07 zero-row history compatible with shared import completion');
 const known=await service.createDiscoveryRun(defs[2].id,'preview',actor,randomUUID());
 await service.processDiscoveryTick({fetchImpl,afterTaskId:async()=>{throw new Error('SIMULATED_AFTER_ID');}});
 check((await runState(known.id)).state==='pending','T02 crash after ID preserves known task');
 await q("UPDATE discovery_runs SET next_poll_at=now(),results_expires_at=now()-interval '1 second' WHERE id=$1",[known.id]);await service.processDiscoveryTick({fetchImpl});
 check((await runState(known.id)).state==='expired','T03 expired task is explicit and does not repurchase');
 const coverage=await service.recordDiscoveryCoverage(defs[3].id,actor,{coveredThrough:new Date(Date.now()+86400000).toISOString(),reference:'Synthetic exact-area coverage'});
 check(coverage.definition_revision===defs[3].revision&&coverage.area_key===defs[3].area_key,'T09 manual coverage pins exact revision and area');
 const {verifyDiscoveryDownstream}=await import('./fixtures/task2161-downstream');
 await verifyDiscoveryDownstream(pool,Number(await scalar("SELECT id FROM businesses WHERE google_place_id='task2161-place'")),actor);checks++;
 // Real process death/restart exercises persisted records rather than exception-only recovery.
 await q('CREATE TABLE task2161_fake_requests(id serial PRIMARY KEY,path text NOT NULL)');
 const worker=(point='')=>new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/certification/fixtures/task2161-worker.ts'],
   {env:{...process.env,PROCESS_IDENTITY:`task2161-child-${randomUUID()}`,TASK2161_CRASH_POINT:point},stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>resolve(code??1));
 });
 const midDefinition=await service.updateDiscoveryDefinition(defs[0].id,actor,{areaType:'city',areaKey:'Miami',query:'dentist in Miami interrupted import',resultLimit:2});
 const mid=await service.createDiscoveryRun(midDefinition.id,'preview',actor,randomUUID());await service.processDiscoveryTick({fetchImpl});
 pollResult={status:'Success',data:[[{...data[0],emails:['task2161-mid-one@gmail.com']},{...data[0],emails:['task2161-mid-two@gmail.com']}]]};
 await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[mid.id]);await service.processDiscoveryTick({fetchImpl});await service.processDiscoveryTick({fetchImpl});
 check((await runState(mid.id)).saturated===true,'T09 full result limit is saturated and not complete territory coverage');
 await q("UPDATE sfp_programs SET county_fips=ARRAY['12011'] WHERE is_active");
 await assert.rejects(service.requestRetainedDiscoveryImport(mid.id,actor),/DISCOVERY_IMPORT_SCOPE_CHANGED/);checks++;
 await q("UPDATE sfp_programs SET county_fips=ARRAY['12086'] WHERE is_active");
 await service.requestRetainedDiscoveryImport(mid.id,actor);
 check(await worker('mid-import')===74,'T02 actual process exits after the first contact commit during retained import');
 const partial=await runState(mid.id);check(partial.state==='importing','T02 incomplete import keeps its same execution');
 check(Number(await scalar("SELECT count(*) FROM contacts WHERE email LIKE 'task2161-mid-%'"))===1,'T02 the first mailbox committed before process exit');
 await q("UPDATE import_executions SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[partial.import_execution_id]);
 await worker();const resumed=await runState(mid.id);
 check(resumed.state==='completed'&&resumed.import_execution_id===partial.import_execution_id,'T02 fresh worker completes the original deterministic execution');
 check(resumed.totals.newBusinesses===0&&resumed.totals.matchedBusinesses===1&&resumed.totals.contacts===2,'T08 existing business plus new mailboxes has exact distinct counts after restart');
 check(Number(await scalar("SELECT count(*) FROM contacts WHERE email LIKE 'task2161-mid-%'"))===2,'T02 restart never duplicates the committed mailbox');
 for(const [point,code] of [['before-dispatch',71],['accepted-before-id',72],['after-id',73]] as const){
  const slice=await service.updateDiscoveryDefinition(defs[0].id,actor,{areaType:'city',areaKey:'Miami',query:`dentist in Miami ${point}`});
  const crash=await service.createDiscoveryRun(slice.id,'preview',actor,randomUUID());
  check(await worker(point)===code,`T02 process terminated at ${point}`);
  await worker();let recovered=await runState(crash.id);
  if(point==='before-dispatch')check(recovered.state==='failed','T02 unmarked reservation recovers without purchase');
  else if(point==='accepted-before-id'){
   check(recovered.state==='submission_unknown','T02 provider acceptance before ID survives actual process restart');
   const before=await scalar('SELECT count(*) FROM task2161_fake_requests');await worker();
   check(await scalar('SELECT count(*) FROM task2161_fake_requests')===before,'T03 restart never repurchases unknown acceptance');
   await service.reconcileDiscoverySubmission(crash.id,actor,{provenNotDispatched:true,evidence:'Synthetic fixture reconciliation; original ambiguous hold remains explicit.'});
  }else{
   check(recovered.state==='pending','T02 ID remains available after actual process exit');
   await q('UPDATE discovery_runs SET next_poll_at=now() WHERE id=$1',[crash.id]);await worker();await worker();
   check((await runState(crash.id)).state==='preview_ready','T02 fresh process recovers same-ID result and retained artifact');
  }
 }
 const concurrentSlice=await service.updateDiscoveryDefinition(defs[0].id,actor,{areaType:'city',areaKey:'Miami',query:'dentist in Miami replica race'});
 const race=await service.createDiscoveryRun(concurrentSlice.id,'preview',actor,randomUUID());
 const beforeRace=Number(await scalar("SELECT count(*) FROM task2161_fake_requests WHERE path='/google-maps-search'"));
 await Promise.all([worker(),worker()]);
 check(Number(await scalar("SELECT count(*) FROM task2161_fake_requests WHERE path='/google-maps-search'"))===beforeRace+1,'T01 independent worker processes submit exactly once');
 await q("UPDATE discovery_runs SET next_poll_at=now(),results_expires_at=now()-interval '1 second' WHERE id=$1",[race.id]);await worker();
 const unavailableDefinition=await service.updateDiscoveryDefinition(defs[0].id,actor,{areaType:'city',areaKey:'Miami',query:'dentist in Miami unavailable submission'});
 const unavailable=await service.createDiscoveryRun(unavailableDefinition.id,'preview',actor,randomUUID());let unavailableCalls=0;
 const unavailableFetch=(async()=>{unavailableCalls++;return new Response('unavailable',{status:503});}) as typeof fetch;
 await service.processDiscoveryTick({fetchImpl:unavailableFetch});await service.processDiscoveryTick({fetchImpl:unavailableFetch});
 check((await runState(unavailable.id)).state==='submission_unknown'&&unavailableCalls===1,'T03 ambiguous 5xx submission holds the lane and never repurchases');
 await service.reconcileDiscoverySubmission(unavailable.id,actor,{provenNotDispatched:true,evidence:'Controlled synthetic 503 fixture; retained billing hold remains unknown.'});
 // Production-sized population: inspect the actual relaxed retrieval SQL, not a substitute query.
 await q(`INSERT INTO businesses(canonical_name,normalized_name,record_class,city,state,website_domain)
  SELECT 'Scale dental '||n,'scale dental '||n,'canonical','Miami','FL','scale-'||n||'.net' FROM generate_series(1,100000) n`);
 await q('ANALYZE businesses');
 const {discoveryCandidateIdsSql,peekOrganizationResolution}=await import('../../server/services/organization-resolver');
 const {PgDialect}=await import('drizzle-orm/pg-core');
 const identity={canonicalName:'Scale dental 50000 LLC',websiteDomain:'scale-50000.net',city:'miami',state:'FL',matchingPolicy:'scheduled-discovery-v1' as const};
 const statement=new PgDialect().sqlToQuery(discoveryCandidateIdsSql(identity));
 const plan=(await q(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement.sql}`,statement.params)).rows[0]['QUERY PLAN'][0];
 const nodes=(n:any):any[]=>[n,...(n.Plans??[]).flatMap(nodes)];
 check(nodes(plan.Plan).some(n=>n['Index Name']==='canonical_link_business_name_lookup_idx'),'T11 actual suffix-name lookup uses existing canonical index at 100k scale');
 check(!nodes(plan.Plan).some(n=>n['Node Type']==='Seq Scan'&&n['Relation Name']==='businesses'),'T11 candidate query does not scan the business population');
 const memory=process.memoryUsage().heapUsed;check((await peekOrganizationResolution(identity)).kind==='matched','T11 real indexed preview resolves the correct scale row');
 check(process.memoryUsage().heapUsed-memory<64*1024*1024,'T11 lookup memory stays bounded');
 console.log('TASK2161_SCALE',JSON.stringify({businesses:await scalar('SELECT count(*) FROM businesses'),executionMs:plan['Execution Time'],heapDelta:process.memoryUsage().heapUsed-memory,indexes:nodes(plan.Plan).map(n=>n['Index Name']).filter(Boolean)}));
 await q("UPDATE businesses SET website_domain='shared-scale.net' WHERE id IN (SELECT id FROM businesses WHERE canonical_name LIKE 'Scale dental %' LIMIT 300)");
 const overflow=await peekOrganizationResolution({...identity,canonicalName:'Unknown scale name',websiteDomain:'shared-scale.net'});
 check(overflow.kind==='deferred'&&overflow.candidateIds.length===201,'T11 oversized brand population is bounded and held instead of silently truncated into a match');
 await q("UPDATE businesses SET google_place_id='scale-owned-place' WHERE id=(SELECT min(id) FROM businesses WHERE website_domain='shared-scale.net')");
 check((await peekOrganizationResolution({canonicalName:'Changed branch display',googlePlaceId:'scale-owned-place',websiteDomain:'shared-scale.net',city:'Miami',state:'FL',matchingPolicy:'scheduled-discovery-v1'})).kind==='matched','T05/T11 unique place ownership remains automatic across a large shared brand');
 const mutationBefore=submits;await q("UPDATE provider_controls SET enabled=false WHERE provider='outscraper'");
 const blocked=await service.createDiscoveryRun(defs[3].id,'preview',actor,randomUUID());await service.processDiscoveryTick({fetchImpl});
 check(submits===mutationBefore&&(await runState(blocked.id)).state==='failed','Provider disabled blocks actual I/O');
 // Install only the new capability and execute through the real BullMQ worker.
 const profileBefore=process.env.BACKGROUND_JOB_PROFILE;process.env.BACKGROUND_JOB_PROFILE='selective:scheduled-discovery';
 await selectSfpRuntimeTestRelease(actor);
 const {getQueueManager,shutdownQueueManager}=await import('../../server/services/queue-manager');
 try{
  const manager=await getQueueManager();const queue=manager.getQueue('scheduled-discovery');
  check(!!queue&&!manager.getQueue('sequences')&&!manager.getQueue('sfp-continuous-discovery'),'T15 real narrow worker installs no unrelated queue');
  const schedules=await queue!.getRepeatableJobs();check(schedules.length===1,'T15 one owned BullMQ recovery schedule installed');
  await q('UPDATE discovery_schedules SET worker_heartbeat_at=NULL');await queue!.add('tick',{}, {jobId:`task2161-acceptance-${randomUUID()}`});
  let heartbeat=null;for(let n=0;n<100&&!heartbeat;n++){heartbeat=await scalar('SELECT worker_heartbeat_at FROM discovery_schedules');if(!heartbeat)await new Promise(r=>setTimeout(r,100));}
  check(!!heartbeat,'T15 actual BullMQ handler updates durable discovery heartbeat with schedule off');
 }finally{await shutdownQueueManager();process.env.BACKGROUND_JOB_PROFILE=profileBefore;}
 const {verifyManualImportCompatibility}=await import('./fixtures/task2161-manual-imports');await verifyManualImportCompatibility(pool,actor);checks++;
 const {verifyDiscoveryHttp}=await import('./fixtures/task2161-http');await verifyDiscoveryHttp(pool);checks++;
 check(getBlockedCertificationNetworkAttemptCount()===0,'No live provider/network calls');
 const lineage=(await q(`SELECT r.id run_id,r.provider_task_id,r.operation_id,r.import_execution_id,a.content_hash,a.mapper_version,a.matching_policy,r.totals,c.id import_history_id,o.billing_state,o.provider_usage_status,o.provider_usage_quantity,o.provider_usage_unit,o.settled_cost_micros FROM discovery_runs r JOIN discovery_artifacts a ON a.run_id=r.id JOIN provider_operations o ON o.id=r.operation_id JOIN csv_imports c ON c.execution_id=r.import_execution_id WHERE r.id=$1`,[pilot.id])).rows[0];
 assert(lineage?.content_hash&&lineage.import_history_id,'Completed acceptance lineage is durable');
 console.log('TASK2161_ACCEPTANCE_LINEAGE',JSON.stringify(lineage));
 console.log(`TASK2161_PERSISTENCE_PASS ${checks}`);
}finally{await pool.end();}

process.exit(0);
