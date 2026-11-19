import {sanitizeAuditPayload} from "../audit-sanitizer";
import {readOutscraperMonthlyBudget,updateOutscraperMonthlyBudget} from '../outscraper-monthly-budget';
import {resolveGeographyFromCandidates} from '../cro03/sfp-geography-resolver';
import {isSfpValidationPromotionEnabled} from '../cro03/south-florida-prospecting';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db,pool} from '../../db';
import {discoveryProgramPinSql} from '../cro03/sfp-discovery-scope';
import {executeSfpOutscraperDiscovery} from '../cro03/sfp-live-provider-adapters';
import {performOutscraperTaskResults,type OutscraperSearchResult} from '../sdr/outscraper';
import {deriveOutscraperResultRetentionBound} from '../sdr/sfp-provider-contracts';
import {reserveSearchProviderOperation,markSearchProviderDispatchBoundary,settleSearchProviderOperation,getSfpProviderReadiness,getSfpDeploymentOwnerReadiness,currentSfpReviewedPricing,type SfpSearchReservation} from '../cro03/sfp-provider-operations';
import {peekOrganizationResolution} from '../organization-resolver';
import {decideOrganizationIdentity,type OrganizationCandidate} from '../organization-resolution-policy';
import {claimCsvExecution} from '../import-execution';
import {processPersistedCsvImport} from '../csv-import-processor';
import {storage} from '../../storage';
import {getBackgroundProfile,getSelectiveGroups,WORKER_CAPABILITY_GROUPS} from '../background-profile';
import {TERMS,COUNTIES,MATCHING_POLICY,MAPPER_VERSION,contentHash,normalizeDiscoveryRow,type ArtifactRow} from './policy';
const rows=(r:any):any[]=>r?.rows??[];
const query=async(q:any,executor:any=db)=>rows(await executor.execute(q));
const one=async(q:any,executor:any=db)=>(await query(q,executor))[0];
const json=(v:unknown)=>JSON.stringify(v);
const currentProgram=async(executor:any=db)=>{
 const programs=await query(sql`SELECT p.*,${discoveryProgramPinSql} AS pin FROM sfp_programs p WHERE is_active AND taxonomy_version=2 ORDER BY id`,executor);
 if(programs.length!==1)throw new Error(`DISCOVERY_ACTIVE_V2_PROGRAM_COUNT:${programs.length}`);return programs[0];
};
export async function assertDiscoveryImportScope(tx:any,runId:string) {
 const program=await currentProgram(tx);
 const run=await one(sql`SELECT r.snapshot,d.revision,d.enabled FROM discovery_runs r JOIN discovery_definitions d ON d.id=r.definition_id WHERE r.id=${runId}::uuid FOR SHARE OF r,d`,tx);
 if(!run||run.snapshot.program_pin!==program.pin||run.snapshot.revision!==run.revision)throw new Error('DISCOVERY_IMPORT_SCOPE_CHANGED');
 return program;
}
export async function initializeDiscoveryDefinitions(actorId:string) {
 return db.transaction(async tx=>{
  const p=await currentProgram(tx);
  await tx.execute(sql`INSERT INTO discovery_schedules(id,updated_by) VALUES(true,${actorId}) ON CONFLICT DO NOTHING`);
  await tx.execute(sql`INSERT INTO discovery_lane(id) VALUES(true) ON CONFLICT DO NOTHING`);
  const values=[];
  for(const county of p.county_fips){if(!COUNTIES[county])throw new Error('DISCOVERY_COUNTY_MAPPING_UNSUPPORTED');
   for(const vertical of p.vertical_ids){if(!TERMS[vertical])throw new Error('DISCOVERY_VERTICAL_MAPPING_UNSUPPORTED');
    for(const term of TERMS[vertical])values.push(sql`(${p.id}::uuid,${p.pin},${vertical},${county},'county',${county},${`${term} in ${COUNTIES[county]}, Florida`})`);
   }
  }
  const count=values.length?(await query(sql`INSERT INTO discovery_definitions(program_id,program_pin,vertical,county_fips,area_type,area_key,query)
    VALUES ${sql.join(values,sql`, `)} ON CONFLICT DO NOTHING RETURNING id`,tx)).length:0;
  return {created:count,programId:p.id,programPin:p.pin};
 });
}
export async function discoveryStatus(filter='',page=1) {
 let p:any=null,programReason:string|null=null;try{p=await currentProgram();}catch(e:any){programReason=e.message;}
 const schedule=await one(sql`SELECT * FROM discovery_schedules WHERE id`);
 const definitionScope=sql`d.program_id=${p?.id??null}::uuid AND d.program_pin=${p?.pin??null} AND (${filter}='' OR concat_ws(' ',d.query,d.vertical,d.area_key,d.county_fips) ILIKE ${'%'+filter+'%'})`;
 const definitionCount=await one(sql`SELECT count(*)::integer n FROM discovery_definitions d WHERE ${definitionScope}`);
 const definitions=await query(sql`SELECT d.*,latest.id AS last_run_id,latest.state AS last_state,latest.saturated,latest.preview,latest.totals,
   coverage.covered_through,coverage.reference AS coverage_reference
   FROM discovery_definitions d LEFT JOIN LATERAL(SELECT id,state,saturated,preview - 'rows' AS preview,totals FROM discovery_runs r WHERE r.definition_id=d.id ORDER BY created_at DESC LIMIT 1) latest ON true
   LEFT JOIN LATERAL(SELECT covered_through,reference FROM discovery_coverage c WHERE c.definition_id=d.id AND c.definition_revision=d.revision AND c.area_type=d.area_type AND c.area_key=d.area_key ORDER BY covered_through DESC LIMIT 1) coverage ON true
   WHERE ${definitionScope} ORDER BY d.vertical,d.county_fips,d.query,d.id LIMIT 10 OFFSET ${(page-1)*10}`);
 const runs=await query(sql`SELECT r.id,r.definition_id,r.mode,r.state,r.created_at,r.submitted_at,r.last_pending_at,r.next_poll_at,r.results_expires_at,r.provider_task_id,r.operation_id,r.import_execution_id,r.saturated,r.preview - 'rows' AS preview,r.totals,r.last_error,r.completed_at,
  a.content_hash,a.mapper_version,a.matching_policy,o.billing_state,o.provider_usage_quantity,o.provider_usage_unit,o.settled_cost_micros,
  o.unit_price_micros,o.unit_price_unit,c.id AS import_id FROM discovery_runs r LEFT JOIN discovery_artifacts a ON a.run_id=r.id
  LEFT JOIN provider_operations o ON o.id=r.operation_id LEFT JOIN csv_imports c ON c.execution_id=r.import_execution_id ORDER BY r.created_at DESC LIMIT 100`);
 const validationPromotionEnabled=await isSfpValidationPromotionEnabled();const zeroBounce=await getSfpProviderReadiness('zerobounce');
 const provider=await getSfpProviderReadiness('outscraper');const runtime=await getSfpDeploymentOwnerReadiness();
 const legacyHolds=await query(sql`SELECT purpose,state,billing_state,count(*)::integer operations,sum(reserved_units)::integer units FROM provider_operations
  WHERE provider='outscraper' AND operation_type<>'scheduled_discovery' AND billing_state IN ('reserved','ambiguous') GROUP BY purpose,state,billing_state`);
 const today=await one(sql`SELECT count(*)::integer n FROM discovery_runs WHERE submitted_at IS NOT NULL AND (submitted_at AT TIME ZONE ${schedule?.timezone??'America/New_York'})::date=(clock_timestamp() AT TIME ZONE ${schedule?.timezone??'America/New_York'})::date`);
 const monthlyBudget=await readOutscraperMonthlyBudget();
 const profile=getBackgroundProfile();const groups=getSelectiveGroups();
 const selected=profile==='full'||profile==='selective'&&groups.includes('scheduled-discovery' as any);
 return {monthlyBudget,program:p?{id:p.id,taxonomyVersion:p.taxonomy_version,counties:p.county_fips,verticals:p.vertical_ids,pin:p.pin}:null,programReason,
  downstreamReadiness:{validationPromotionEnabled,zeroBounce},schedule:schedule??{enabled:false,daily_dispatch_count:1,repeat_days:30,timezone:'America/New_York'},definitions,totalDefinitions:definitionCount.n,definitionPage:page,definitionPageSize:10,runs,provider,runtime,
  worker:{profile,selected,heartbeat:schedule?.worker_heartbeat_at??null,redisConfigured:!!process.env.REDIS_URL},dailyDispatches:today.n,legacyHolds,
  countPolicy:'Scheduled and pilot dispatches count. The daily setting limits scheduled work only. Polling and retained imports do not count.'};
}
export async function discoveryRunDetail(id:string,offset=0) {
 const r=await one(sql`SELECT r.id,r.definition_id,r.provider_task_id,r.import_execution_id,r.state,r.preview - 'rows' AS preview,r.totals,r.last_error,
  a.content_hash,a.mapper_version,a.matching_policy FROM discovery_runs r LEFT JOIN discovery_artifacts a ON a.run_id=r.id WHERE r.id=${id}::uuid`);
 if(!r)throw new Error('DISCOVERY_RUN_NOT_FOUND');
 const page=await one(sql`SELECT COALESCE(jsonb_agg(value ORDER BY ord),'[]'::jsonb) AS rows FROM (
  SELECT value,ord FROM discovery_runs r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.preview->'rows','[]'::jsonb)) WITH ORDINALITY e(value,ord)
  WHERE r.id=${id}::uuid AND ord>${offset} AND ord<=${offset+25}) p`);
 const usage=await query(sql`SELECT purpose,provider_usage_unit AS unit,provider_usage_status AS certainty,count(*)::integer operations,
  sum(provider_usage_quantity) AS observed_quantity,sum(settled_cost_micros) AS estimate_micros,
  count(*) FILTER(WHERE settled_cost_micros IS NULL)::integer unknown_estimates
  FROM provider_operations WHERE operation_type='scheduled_discovery' AND target_fingerprint=${`search-run:${id}`}
  GROUP BY purpose,provider_usage_unit,provider_usage_status`);
 const population=sql`SELECT DISTINCT (value->>'businessId')::integer id FROM import_executions e
  CROSS JOIN LATERAL jsonb_each(COALESCE(e.metadata->'discoveryBusinessOutcomes','{}'::jsonb)) f
  WHERE e.id=${r.import_execution_id}::uuid`;
 const crawl=await query(sql`WITH selected AS (${population}) SELECT COALESCE(b.free_enrichment_status,'eligible_not_processed') state,
  (b.website_domain IS NOT NULL) has_website,count(*)::integer businesses FROM businesses b JOIN selected s ON s.id=b.id GROUP BY 1,2`);
 const materialization=await query(sql`WITH selected AS (${population}) SELECT COALESCE(m.outcome,'not_materialized') state,count(*)::integer candidates
  FROM free_discovery_candidates c JOIN selected s ON s.id=c.business_id LEFT JOIN free_discovery_materialization_outcomes m ON m.candidate_id=c.id GROUP BY 1`);
 const preparation=await query(sql`WITH selected AS (${population}) SELECT i.preparation_state state,count(DISTINCT i.contact_id)::integer contacts
  FROM cr04_enrollment_intents i JOIN selected s ON s.id=i.business_id WHERE i.preparation_state IS NOT NULL GROUP BY 1`);
 const validation=await query(sql`WITH selected AS (${population}) SELECT v.state,count(DISTINCT v.id)::integer intents
  FROM validation_intents v JOIN contacts c ON c.id=v.contact_id JOIN selected s ON s.id=c.business_id GROUP BY 1`);
 return {...r,rows:page.rows,offset,pageSize:25,usage,downstream:{population:'Current state of businesses touched by this import; existing contacts and later work can be included.',crawl,materialization,preparation,validation}};
}
export async function updateDiscoverySchedule(actorId:string,input:{enabled:boolean;monthlyBudgetUsd?:number;dailyDispatchCount:number;repeatDays:number;timezone:string}) {
 await initializeDiscoveryDefinitions(actorId);
 if(input.monthlyBudgetUsd!=null)await updateOutscraperMonthlyBudget(actorId,{monthlyBudgetUsd:input.monthlyBudgetUsd});
 return one(sql`UPDATE discovery_schedules SET enabled=${input.enabled},daily_dispatch_count=${input.dailyDispatchCount},repeat_days=${input.repeatDays},timezone=${input.timezone},updated_by=${actorId},updated_at=now() WHERE id RETURNING *`);
}
export async function updateDiscoveryDefinition(id:string,actorId:string,input:{enabled?:boolean;resultLimit?:number;areaType?:'city'|'zip';areaKey?:string;query?:string}) {
 return db.transaction(async tx=>{
  const p=await currentProgram(tx);const d=await one(sql`SELECT * FROM discovery_definitions WHERE id=${id}::uuid AND program_id=${p.id}::uuid AND program_pin=${p.pin} FOR UPDATE`,tx);
  if(!d)throw new Error('DISCOVERY_DEFINITION_NOT_FOUND');
  if(input.areaType){
   if(!input.areaKey||!input.query)throw new Error('DISCOVERY_SLICE_FIELDS_REQUIRED');
   const geo=resolveGeographyFromCandidates([{locationId:null,isPrimary:true,state:'FL',city:input.areaType==='city'?input.areaKey:null,postalCode:input.areaType==='zip'?input.areaKey:null,countyFips:null}]);
   if(!geo.eligible||geo.countyFips!==d.county_fips)throw new Error('DISCOVERY_SLICE_OUTSIDE_OR_UNRESOLVED_PARENT_COUNTY');
   return one(sql`INSERT INTO discovery_definitions(program_id,program_pin,vertical,county_fips,area_type,area_key,query,result_limit)
    VALUES(${d.program_id}::uuid,${d.program_pin},${d.vertical},${d.county_fips},${input.areaType},${input.areaKey},${input.query},${input.resultLimit??d.result_limit}) RETURNING *`,tx);
  }
  const result=await one(sql`UPDATE discovery_definitions SET enabled=${input.enabled??d.enabled},result_limit=${input.resultLimit??d.result_limit},revision=revision+${input.resultLimit!==undefined&&input.resultLimit!==d.result_limit?1:0},updated_at=now() WHERE id=${id}::uuid RETURNING *`,tx);
  await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details) VALUES('discovery_definition_updated','discovery_definition',${id},'user',${actorId},${json(sanitizeAuditPayload(input))}::jsonb)`);return result;
 });
}
export async function recordDiscoveryCoverage(id:string,actorId:string,input:{coveredThrough:string;reference?:string}) {
 return db.transaction(async tx=>{
  const p=await currentProgram(tx);const d=await one(sql`SELECT * FROM discovery_definitions WHERE id=${id}::uuid AND program_id=${p.id}::uuid AND program_pin=${p.pin} FOR UPDATE`,tx);
  if(!d)throw new Error('DISCOVERY_DEFINITION_NOT_FOUND');
  return one(sql`INSERT INTO discovery_coverage(definition_id,definition_revision,area_type,area_key,covered_through,actor_id,reference)
   VALUES(${id}::uuid,${d.revision},${d.area_type},${d.area_key},${input.coveredThrough}::timestamptz,${actorId},${input.reference??null}) RETURNING *`,tx);
 });
}
export async function createDiscoveryRun(definitionId:string,mode:'preview'|'scheduled',actorId:string,key:string) {
 return db.transaction(async tx=>{
  const p=await currentProgram(tx);const d=await one(sql`SELECT * FROM discovery_definitions WHERE id=${definitionId}::uuid AND program_id=${p.id}::uuid AND program_pin=${p.pin} FOR UPDATE`,tx);
  if(!d||!d.enabled)throw new Error('DISCOVERY_DEFINITION_NOT_FOUND_OR_PAUSED');
  const replay=await one(sql`SELECT * FROM discovery_runs WHERE occurrence_key=${key}::uuid`,tx);
  if(replay){if(replay.definition_id!==definitionId||replay.mode!==mode)throw new Error('DISCOVERY_IDEMPOTENCY_CONFLICT');return replay;}
  const schedule=await one(sql`SELECT * FROM discovery_schedules WHERE id`,tx);
  const recent=await one(sql`SELECT * FROM discovery_runs WHERE definition_id=${definitionId}::uuid AND
   (state IN ('queued','dispatching','pending','submission_unknown','results_retained','importing') OR
    submitted_at>clock_timestamp()-${schedule?.repeat_days??30}::integer*interval '1 day' AND (snapshot->>'revision')::integer=${d.revision}) ORDER BY created_at DESC LIMIT 1`,tx);
  if(recent)return {...recent,reused:true};
  if(mode==='scheduled'&&!schedule?.enabled)throw new Error('DISCOVERY_SCHEDULE_DISABLED');
  return one(sql`INSERT INTO discovery_runs(definition_id,occurrence_key,mode,snapshot,actor_id)
   VALUES(${definitionId}::uuid,${key}::uuid,${mode},${json({...d,county_fips:p.county_fips,definition_county_fips:d.county_fips,vertical_ids:p.vertical_ids,matchingPolicy:MATCHING_POLICY,mapperVersion:MAPPER_VERSION})}::jsonb,${actorId}) RETURNING *`,tx);
 });
}
export async function previewRetainedRows(run:any,artifactRows:Record<string,unknown>[]) {
 const overlay:OrganizationCandidate[]=[];const counts={wouldCreate:0,wouldMatch:0,needsReview:0,duplicates:0,invalid:0,outOfScope:0,unresolved:0,rawRows:artifactRows.length};
 const facts:Array<{index:number;state:string;reason:string|null;businessId?:number;raw?:Record<string,string>}>=[];
 for(const [index,raw] of artifactRows.entries()){
  const row=normalizeDiscoveryRow(raw,run.snapshot);
  if(row.state!=='eligible'){if(row.state==='out_of_scope')counts.outOfScope++;else if(row.state==='invalid')counts.invalid++;else counts.unresolved++;
   facts.push({index,state:row.state,reason:row.reasons.join(';')});continue;}
  const batch=decideOrganizationIdentity(row.identity,overlay);
  if(batch.kind==='matched'){counts.duplicates++;facts.push({index,state:'duplicate',reason:'INTRA_RESULT_IDENTITY_DUPLICATE'});continue;}
  const result=await peekOrganizationResolution(row.identity);
  if(result.kind==='deferred'){counts.needsReview++;facts.push({index,state:'held',reason:result.reasonCode});continue;}
  if(result.kind==='would_create')counts.wouldCreate++;else counts.wouldMatch++;
  const id=result.kind==='matched'?result.business.id:-(index+1);
  overlay.push({...row.identity,id});facts.push({index,state:'eligible',reason:null,businessId:result.kind==='matched'?id:undefined,raw:row.mapped});
 }
 return {counts,rows:facts,policy:MATCHING_POLICY,observedAt:new Date().toISOString()};
}
async function retainResult(run:any,result:OutscraperSearchResult) {
 if(result.consideredResultCount>run.snapshot.result_limit||result.consideredResultCount>100)throw new Error('DISCOVERY_RESULT_LIMIT_VIOLATION');
 const data=(result.rawItems??result.results.map(r=>r.rawData)).map(v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{invalidProviderRow:v});const hash=contentHash(data);
 await db.transaction(async tx=>{
  const artifact=await one(sql`SELECT content_hash FROM discovery_artifacts WHERE run_id=${run.id}::uuid FOR UPDATE`,tx);
  if(artifact&&artifact.content_hash!==hash)throw new Error('DISCOVERY_ARTIFACT_IMMUTABLE');
  await tx.execute(sql`INSERT INTO discovery_artifacts(run_id,content_hash,rows,raw_count) VALUES(${run.id}::uuid,${hash},${json(data)}::jsonb,${result.consideredResultCount}) ON CONFLICT DO NOTHING`);
  await tx.execute(sql`UPDATE discovery_runs SET state='results_retained',saturated=${result.consideredResultCount>=run.snapshot.result_limit},updated_at=now(),last_error=NULL WHERE id=${run.id}::uuid`);
  await tx.execute(sql`UPDATE discovery_definitions SET last_retrieved_at=now(),failure_count=0 WHERE id=${run.definition_id}::uuid`);
 });
 await settleSearchProviderOperation(run.operation_id,{outcome:'completed',quantity:result.consideredResultCount,unit:'result',providerRequestId:run.provider_task_id??undefined});
 await releaseLane(run.id);
}
async function releaseLane(runId:string){await db.execute(sql`UPDATE discovery_lane SET run_id=NULL,token=NULL,updated_at=now() WHERE run_id=${runId}::uuid`);}
export async function requestRetainedDiscoveryImport(runId:string,actorId:string) {
 await db.transaction(async tx=>{
  await assertDiscoveryImportScope(tx,runId);
  const r=await one(sql`UPDATE discovery_runs SET import_requested=true,updated_at=now() WHERE id=${runId}::uuid AND state IN ('preview_ready','results_retained','importing','completed') RETURNING id`,tx);
  if(!r)throw new Error('DISCOVERY_ARTIFACT_NOT_READY');
  await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id) VALUES('discovery_retained_import_requested','discovery_run',${runId},'user',${actorId})`);
 });
}
async function fulfillRetained(run:any) {
 const artifact=await one(sql`SELECT * FROM discovery_artifacts WHERE run_id=${run.id}::uuid`);if(!artifact)throw new Error('DISCOVERY_ARTIFACT_MISSING');
 if(contentHash(artifact.rows)!==artifact.content_hash||artifact.mapper_version!==MAPPER_VERSION||artifact.matching_policy!==MATCHING_POLICY)throw new Error('DISCOVERY_ARTIFACT_VERSION_OR_HASH_MISMATCH');
 await settleSearchProviderOperation(run.operation_id,{outcome:'completed',quantity:artifact.raw_count,unit:'result',providerRequestId:run.provider_task_id??undefined});
 await releaseLane(run.id);
 if(!run.preview){const preview=await previewRetainedRows(run,artifact.rows);await db.execute(sql`UPDATE discovery_runs SET preview=${json(preview)}::jsonb,state='preview_ready',updated_at=now() WHERE id=${run.id}::uuid`);run={...run,preview};}
 if(run.mode==='preview'&&!run.import_requested)return;
 await db.transaction(tx=>assertDiscoveryImportScope(tx,run.id));
 // Re-evaluate actual scope at commit. Do not freeze preview matches or counts as write authority.
 const all=artifact.rows.map((raw:any)=>normalizeDiscoveryRow(raw,run.snapshot));
 const accepted=all.filter((r:ArtifactRow)=>r.state==='eligible').map((r:ArtifactRow)=>r.mapped);
 const envelope={runId:run.id,providerTaskId:run.provider_task_id,contentHash:artifact.content_hash,mapperVersion:MAPPER_VERSION,matchingPolicy:MATCHING_POLICY};
 const fileHash=contentHash(envelope);const filename=`Scheduled discovery ${run.id}`;
 const claim=await claimCsvExecution({fileHash,totalRows:accepted.length,actorType:'system',actorId:run.actor_id,sourcePayload:accepted,
  metadata:{sourceFormat:'google_maps_outscraper',fileName:filename,...envelope,scheduledDiscoveryRunId:run.id}});
 await db.execute(sql`UPDATE discovery_runs SET state='importing',import_execution_id=${claim.execution.id}::uuid,updated_at=now() WHERE id=${run.id}::uuid`);
 if(!claim.claimed&&!claim.replay)return;
 let projection=await one(sql`SELECT * FROM csv_imports WHERE execution_id=${claim.execution.id}::uuid`);
 if(!projection)projection=await storage.createCsvImport({executionId:claim.execution.id,fileName:filename,sourceFormat:'google_maps_outscraper',importSource:'scheduled_discovery',totalRows:accepted.length,status:'processing',importedBy:run.actor_id});
 if(claim.claimed)await processPersistedCsvImport({records:accepted,executionClaim:claim,importRecord:projection,sourceFormat:'google_maps_outscraper',actor:{actorType:'system',actorId:run.actor_id},filename});
 const execution=await one(sql`SELECT status,metadata FROM import_executions WHERE id=${claim.execution.id}::uuid`);if(execution.status!=='completed')return;
 const facts=Object.values(execution.metadata?.discoveryBusinessOutcomes??{}) as Array<{businessId:number;kind:string}>;
 const created=new Set(facts.filter(f=>f.kind==='created').map(f=>f.businessId));const matched=new Set(facts.filter(f=>f.kind==='matched'&&!created.has(f.businessId)).map(f=>f.businessId));
 const contacts=await one(sql`SELECT count(DISTINCT contact_id)::integer n FROM contact_source_events WHERE import_execution_id=${claim.execution.id}::uuid AND contact_id IS NOT NULL`);
 const rowTotals=await query(sql`SELECT disposition,count(*)::integer n FROM import_row_dispositions WHERE execution_id=${claim.execution.id}::uuid GROUP BY disposition`);
 await db.execute(sql`UPDATE discovery_runs SET state='completed',completed_at=now(),updated_at=now(),totals=${json({newBusinesses:created.size,matchedBusinesses:matched.size,contacts:contacts.n,rowDispositions:rowTotals,rawRows:artifact.raw_count,importedRows:accepted.length,excludedRows:artifact.rows.length-accepted.length})}::jsonb WHERE id=${run.id}::uuid`);
 await db.execute(sql`UPDATE discovery_definitions SET last_imported_at=now(),next_due_at=clock_timestamp()+(SELECT repeat_days FROM discovery_schedules WHERE id)*interval '1 day' WHERE id=${run.definition_id}::uuid`);
}
export type DiscoveryTransportDeps={fetchImpl?:typeof fetch;afterReservation?:()=>Promise<void>;afterDispatch?:()=>Promise<void>;afterTaskId?:()=>Promise<void>};
export async function processDiscoveryTick(deps:DiscoveryTransportDeps={}) {
 const client=await pool.connect();let owns=false;
 try{
  owns=(await client.query("SELECT pg_try_advisory_lock(2161,1) AS owned")).rows[0].owned;if(!owns)return {state:'busy'};
  // Result recovery is independent of whether a current program can seed new work.
  await db.execute(sql`INSERT INTO discovery_schedules(id) VALUES(true) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO discovery_lane(id) VALUES(true) ON CONFLICT DO NOTHING`);
  await db.execute(sql`UPDATE discovery_schedules SET worker_heartbeat_at=clock_timestamp(),last_error=NULL WHERE id`);
  try{await initializeDiscoveryDefinitions('scheduled-discovery-worker');}catch(e:any){
   if(!/^DISCOVERY_(ACTIVE_V2_PROGRAM_COUNT|COUNTY_MAPPING_UNSUPPORTED|VERTICAL_MAPPING_UNSUPPORTED)/.test(e.message))throw e;
   await db.execute(sql`UPDATE discovery_schedules SET last_error=${safeError(e)} WHERE id`);
  }
  for(const r of await query(sql`SELECT * FROM discovery_runs WHERE state IN ('results_retained','preview_ready','importing') AND (preview IS NULL OR mode='scheduled' OR import_requested) ORDER BY created_at LIMIT 10`)){
   try{await fulfillRetained(r);}catch(e:any){await db.execute(sql`UPDATE discovery_runs SET last_error=${safeError(e)},updated_at=now() WHERE id=${r.id}::uuid`);}
  }
  const lane=await one(sql`SELECT * FROM discovery_lane WHERE id`);let run=lane.run_id?await one(sql`SELECT * FROM discovery_runs WHERE id=${lane.run_id}::uuid`):null;
  if(run?.state==='dispatching'){
   const op=await one(sql`SELECT provider_request_id FROM provider_operations WHERE id=${run.operation_id}::uuid`);
   if(op?.provider_request_id){await db.execute(sql`UPDATE discovery_runs SET provider_task_id=${op.provider_request_id},state='pending',next_poll_at=now(),results_expires_at=COALESCE(submitted_at,created_at)+interval '4 hours' WHERE id=${run.id}::uuid`);return {state:'pending'};}
   await db.execute(sql`UPDATE discovery_runs SET state='submission_unknown',last_error='Acceptance may have occurred; reconcile the provider ID before continuing.',updated_at=now() WHERE id=${run.id}::uuid`);return {state:'submission_unknown'};
  }
  if(run?.state==='submission_unknown')return {state:'submission_unknown',runId:run.id};
  if(run?.state==='pending'){
   if(new Date(run.next_poll_at)>new Date())return {state:'pending',runId:run.id};
   if(new Date(run.results_expires_at)<new Date()||Date.now()-new Date(run.submitted_at).getTime()>24*3600000){
    await db.execute(sql`UPDATE discovery_runs SET state='expired',last_error='Provider results retention or submission deadline expired',updated_at=now() WHERE id=${run.id}::uuid`);await releaseLane(run.id);return {state:'expired'};
   }
   const reservation=await reserveSearchProviderOperation({runId:run.id,laneToken:lane.token,poll:true,pollKey:randomUUID()});
   try{
    const response=await performOutscraperTaskResults(run.provider_task_id,{fetchImpl:deps.fetchImpl,beforeRequest:()=>markSearchProviderDispatchBoundary(reservation)});
    await settleSearchProviderOperation(reservation.operationId,{outcome:'completed',quantity:1,unit:'request'});
    if(!response.ok){
     if(response.status!==204&&response.status!==200){
      await db.execute(sql`UPDATE discovery_runs SET last_error='PROVIDER_POLL_UNAVAILABLE',next_poll_at=clock_timestamp()+interval '1 minute',updated_at=now() WHERE id=${run.id}::uuid`);return {state:'poll_retry'};
     }
     await settleSearchProviderOperation(run.operation_id,{outcome:'ambiguous'});await failRun(run,'PROVIDER_TASK_FAILED');return {state:'failed'};
    }
    if(response.task?.state==='pending'||response.task?.state==='submitted'){
     const bounds=deriveOutscraperResultRetentionBound({state:'pending',submittedAt:new Date(run.submitted_at).toISOString(),observedAt:new Date().toISOString()});
     await db.execute(sql`UPDATE discovery_runs SET last_pending_at=clock_timestamp(),results_expires_at=${bounds.resultsExpiresAt}::timestamptz,next_poll_at=clock_timestamp()+interval '30 seconds' WHERE id=${run.id}::uuid`);return {state:'pending'};
    }
    await retainResult(run,response);return {state:'results_retained'};
   }catch(e:any){await settleSearchProviderOperation(reservation.operationId,{outcome:'ambiguous'});await db.execute(sql`UPDATE discovery_runs SET last_error=${safeError(e)},next_poll_at=clock_timestamp()+interval '1 minute' WHERE id=${run.id}::uuid`);return {state:'poll_retry'};}
  }
  if(run){await releaseLane(run.id);}
  run=await one(sql`SELECT * FROM discovery_runs WHERE state='queued' ORDER BY created_at LIMIT 1`);
  if(!run){
   const d=await one(sql`SELECT d.id FROM discovery_definitions d JOIN discovery_schedules s ON s.id AND s.enabled
     WHERE d.enabled AND (SELECT count(*) FROM discovery_runs r WHERE r.submitted_at IS NOT NULL AND (r.submitted_at AT TIME ZONE s.timezone)::date=(clock_timestamp() AT TIME ZONE s.timezone)::date)<s.daily_dispatch_count AND d.program_pin=(SELECT ${discoveryProgramPinSql} FROM sfp_programs p WHERE p.id=d.program_id AND p.is_active AND p.taxonomy_version=2) AND d.next_due_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM discovery_coverage c WHERE c.definition_id=d.id AND c.definition_revision=d.revision AND c.area_type=d.area_type AND c.area_key=d.area_key AND c.covered_through>clock_timestamp())
     ORDER BY d.last_attempt_at ASC NULLS FIRST,d.next_due_at,d.id LIMIT 1`);
   if(!d)return {state:'idle'};run=await createDiscoveryRun(d.id,'scheduled','scheduled-discovery-worker',randomUUID());
   if(run.state!=='queued')return {state:'repeat_window'};
  }
  if(run.operation_id){
   const marked=await one(sql`SELECT dispatch_marked_at FROM provider_attempts WHERE operation_id=${run.operation_id}::uuid LIMIT 1`);
   if(marked?.dispatch_marked_at){await db.execute(sql`UPDATE discovery_runs SET state='submission_unknown' WHERE id=${run.id}::uuid`);return {state:'submission_unknown'};}
   await settleSearchProviderOperation(run.operation_id,{outcome:'not_dispatched'});await failRun(run,'RECOVERED_BEFORE_DISPATCH');return {state:'pre_dispatch_recovered'};
  }
  const token=randomUUID();await db.execute(sql`UPDATE discovery_lane SET run_id=${run.id}::uuid,token=${token}::uuid,acquired_at=now(),updated_at=now() WHERE id AND run_id IS NULL`);
  let reservation:SfpSearchReservation|undefined;let dispatched=false;
  try{
   reservation=await reserveSearchProviderOperation({runId:run.id,laneToken:token,poll:false});
   await deps.afterReservation?.();
   const response=await executeSfpOutscraperDiscovery({query:run.snapshot.query,resultLimit:run.snapshot.result_limit,region:'US',async:true,endpointVersion:run.snapshot.endpoint_version},{fetchImpl:deps.fetchImpl,budgetReference:{providerOperationId:reservation!.operationId},
    beforeRequest:async()=>{await client.query('SELECT 1');await markSearchProviderDispatchBoundary(reservation!);dispatched=true;await deps.afterDispatch?.();},
    onTaskSubmitted:async task=>{
     await db.execute(sql`UPDATE provider_operations SET provider_request_id=${task.requestId} WHERE id=${reservation!.operationId}::uuid`);
     await db.execute(sql`UPDATE discovery_runs SET provider_task_id=${task.requestId},state='pending',last_pending_at=clock_timestamp(),results_expires_at=clock_timestamp()+interval '4 hours',next_poll_at=clock_timestamp()+interval '30 seconds',updated_at=now() WHERE id=${run.id}::uuid`);
     await deps.afterTaskId?.();
    }});
   run=await one(sql`SELECT * FROM discovery_runs WHERE id=${run.id}::uuid`);
   if(!response.ok){
    await settleSearchProviderOperation(reservation.operationId,{outcome:'ambiguous'});
    if(response.status>=500||response.status===408){
     await db.execute(sql`UPDATE discovery_runs SET state='submission_unknown',last_error='PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',updated_at=now() WHERE id=${run.id}::uuid`);return {state:'submission_unknown'};
    }
    await failRun(run,'PROVIDER_SUBMISSION_FAILED');return {state:'failed'};
   }
   if(response.task)return {state:'pending',runId:run.id};
   await retainResult(run,response);return {state:'results_retained',runId:run.id};
  }catch(e:any){
   if(reservation){
    if(!dispatched)await settleSearchProviderOperation(reservation.operationId,{outcome:'not_dispatched'});
    else await settleSearchProviderOperation(reservation.operationId,{outcome:'ambiguous'});
   }
   const actual=await one(sql`SELECT provider_task_id FROM discovery_runs WHERE id=${run.id}::uuid`);
   if(dispatched&&!actual?.provider_task_id){await db.execute(sql`UPDATE discovery_runs SET state='submission_unknown',last_error=${safeError(e)},updated_at=now() WHERE id=${run.id}::uuid`);}
   else if(!dispatched)await failRun(run,safeError(e));
   return {state:dispatched?'submission_unknown':'blocked',reason:safeError(e)};
  }
 }catch(e:any){await db.execute(sql`UPDATE discovery_schedules SET last_error=${safeError(e)},worker_heartbeat_at=now() WHERE id`).catch(()=>{});throw e;
 }finally{if(owns)await client.query('SELECT pg_advisory_unlock(2161,1)').catch(()=>{});client.release();}
}
function safeError(e:any){return String(e?.cause?.code?`DATABASE_${e.cause.code}`:e?.message??'DISCOVERY_ERROR').replace(/[^A-Za-z0-9_:.-]/g,'_').slice(0,180);}
async function failRun(run:any,reason:string){
 await db.execute(sql`UPDATE discovery_runs SET state='failed',last_error=${reason},updated_at=now() WHERE id=${run.id}::uuid`);
 await db.execute(sql`UPDATE discovery_definitions SET failure_count=failure_count+1,next_due_at=greatest(next_due_at,clock_timestamp()+least(1440,power(2,least(failure_count,10))*5)::integer*interval '1 minute') WHERE id=${run.definition_id}::uuid`);await releaseLane(run.id);
}
export async function reconcileDiscoverySubmission(runId:string,actorId:string,input:{taskId?:string;provenNotDispatched?:boolean;evidence:string}) {
 // Local reconciliation does not purchase anything. It preserves original operation/attempt attribution.
 return db.transaction(async tx=>{
  const r=await one(sql`SELECT * FROM discovery_runs WHERE id=${runId}::uuid AND state='submission_unknown' FOR UPDATE`,tx);
  if(!r)throw new Error('DISCOVERY_RECONCILIATION_STATE_INVALID');
  if(input.taskId){
   await tx.execute(sql`UPDATE provider_operations SET provider_request_id=${input.taskId},updated_at=now() WHERE id=${r.operation_id}::uuid`);
   await tx.execute(sql`UPDATE discovery_runs SET provider_task_id=${input.taskId},state='pending',next_poll_at=now(),results_expires_at=COALESCE(submitted_at,created_at)+interval '4 hours',updated_at=now() WHERE id=${runId}::uuid`);
  }else{
   // A human statement is not proof that a durable pre-I/O marker never dispatched. No hold is automatically refunded.
   if(!input.provenNotDispatched)throw new Error('DISCOVERY_RECONCILIATION_EVIDENCE_REQUIRED');
   await tx.execute(sql`UPDATE discovery_runs SET state='cancelled',last_error='ADMIN_RECORDED_NONDISPATCH_PROVIDER_HOLD_REQUIRES_LEDGER_RECONCILIATION',updated_at=now() WHERE id=${runId}::uuid`);
   await tx.execute(sql`UPDATE discovery_lane SET run_id=NULL,token=NULL,updated_at=now() WHERE run_id=${runId}::uuid`);
  }
  await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details)
   VALUES('discovery_submission_reconciled','discovery_run',${runId},'user',${actorId},${json(sanitizeAuditPayload(input))}::jsonb)`);
  return {id:runId};
 });
}
