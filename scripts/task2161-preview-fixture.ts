/** Deliberate UI-state fixtures in the private local preview only. No purchase/import receipts are claimed. */
import {assertDisposableTestInfrastructure} from './test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary} from './certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Task2161 UI fixtures'});applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import('../server/db');
const {initializeDiscoveryDefinitions}=await import('../server/services/scheduled-discovery/service');
const {contentHash}=await import('../server/services/scheduled-discovery/policy');
try{
 const actor=(await pool.query('SELECT id FROM users WHERE email=$1',[process.env.ADMIN_SEED_EMAIL])).rows[0].id;
 await initializeDiscoveryDefinitions(actor);
 const p=(await pool.query('SELECT * FROM sfp_programs WHERE is_active AND taxonomy_version=2')).rows[0];
 const defs=(await pool.query('SELECT * FROM discovery_definitions ORDER BY vertical,county_fips,query LIMIT 9')).rows;
 const states=['pending','submission_unknown','preview_ready','importing','completed','expired','failed','results_retained','queued'];
 for(const [n,state] of states.entries()){
  const d=defs[n],retained=['preview_ready','importing','completed','results_retained'].includes(state);
  const snapshot={...d,county_fips:p.county_fips,definition_county_fips:d.county_fips,vertical_ids:p.vertical_ids};
  const preview=retained?{counts:{wouldCreate:0,wouldMatch:0,needsReview:0,duplicates:0,outOfScope:0,unresolved:0,invalid:0,rawRows:0},rows:[],policy:'scheduled-discovery-v1'}:null;
  const r=(await pool.query(`INSERT INTO discovery_runs(definition_id,occurrence_key,mode,state,snapshot,actor_id,provider_task_id,results_expires_at,next_poll_at,preview,totals,last_error)
   VALUES($1,gen_random_uuid(),'preview',$2,$3::jsonb,$4,$5,now()+interval '4 hours',now()+interval '30 seconds',$6::jsonb,$7::jsonb,'UI STATE FIXTURE — no provider request or materialization') RETURNING id`,
   [d.id,state,JSON.stringify(snapshot),actor,state==='submission_unknown'||state==='queued'?null:`ui-fixture-${n}`,preview?JSON.stringify(preview):null,state==='completed'?JSON.stringify({newBusinesses:0,matchedBusinesses:0,contacts:0,excludedRows:0}):null])).rows[0];
  if(retained)await pool.query("INSERT INTO discovery_artifacts(run_id,content_hash,rows,raw_count) VALUES($1,$2,'[]',0)",[r.id,contentHash([])]);
 }
 console.log('Private UI-state fixtures ready; no provider requests or import completion evidence implied.');
}finally{await pool.end();}
process.exit(0);
