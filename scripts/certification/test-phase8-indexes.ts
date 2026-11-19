/** Production-shaped synthetic workload, catalog/dependency parity and reversible duplicate-index experiment. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Phase 8 query/index qualification'});applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import('../../server/db');
const c=await pool.connect();let checks=0;const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
const pairs=[['idx_contacts_ghl_id','contacts_ghl_contact_id_idx','contacts','ghl_contact_id'],['idx_deals_contact_id','deals_contact_id_idx','deals','contact_id'],['idx_deals_pipeline','deals_pipeline_idx','deals','pipeline'],['idx_deals_pipeline_stage','deals_pipeline_stage_idx','deals','pipeline,stage']];
const workload=[
 {name:'rep-common',text:"SELECT id FROM contacts WHERE assigned_to=$1 AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50",params:['phase8-rep-1@example.test']},
 {name:'rep-empty',text:"SELECT id FROM contacts WHERE assigned_to=$1 AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50",params:['phase8-absent@example.test']},
 {name:'ghl-lookup',text:'SELECT id FROM contacts WHERE ghl_contact_id=$1 LIMIT 2',params:['phase8-ghl-79999']},
 {name:'pipeline-stage',text:"SELECT id FROM deals WHERE pipeline=$1 AND stage=$2 AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 100",params:['sales','New Lead']},
 {name:'contact-deals',text:'SELECT id FROM deals WHERE contact_id=$1 ORDER BY id LIMIT 100',params:[1]},
 {name:'contact-history',text:"SELECT id FROM audit_logs WHERE entity_type='contact' AND entity_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",params:[1]},
 {name:'enrollment-current',text:'SELECT id FROM sequence_enrollments WHERE contact_id=$1 AND status=$2 ORDER BY id LIMIT 100',params:[1,'paused']},
];
const percentile=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
async function measure(){const report:any[]=[];for(const w of workload){const first=await c.query(w.text,w.params);for(let i=0;i<5;i++)await c.query(w.text,w.params);const durations=[];for(let i=0;i<30;i++){const t=performance.now();const r=await c.query(w.text,w.params);durations.push(performance.now()-t);assert.deepEqual(r.rows,first.rows);}const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+w.text,w.params)).rows[0]['QUERY PLAN'][0];report.push({query:w.name,p50Ms:percentile(durations,.5),p95Ms:percentile(durations,.95),sampleCount:30,returnedIds:first.rows.map((r:any)=>r.id),plan});}return report;}
try{
 // Do not import production data. Stable sizes/skew reflect the previous read-only estimates.
 for(let start=1;start<=160000;start+=2000)await c.query("INSERT INTO contacts(first_name,last_name,phone,email,assigned_to,record_class,ghl_contact_id) SELECT 'Phase8','Fixture','','phase8-'||n||'@example.test','phase8-rep-'||(n%100)||'@example.test',CASE WHEN n%10=0 THEN 'unknown' ELSE 'production' END,'phase8-ghl-'||n FROM generate_series($1::integer,$1::integer+1999) n",[start]);
 await c.query("INSERT INTO deals(contact_id,pipeline,stage,name,record_class) SELECT 1+(n%160000),CASE WHEN n%4=0 THEN 'onboarding' ELSE 'sales' END,CASE WHEN n%3=0 THEN 'Closed Won' ELSE 'New Lead' END,'Phase8 fixture','production' FROM generate_series(1,1600) n");
 await c.query("INSERT INTO audit_logs(action,entity_type,entity_id,details) SELECT 'phase8-fixture','contact',1+(n%10000),'{}'::jsonb FROM generate_series(1,1900000) n");
 for(const [alias,retained,table,columns] of pairs){await c.query(`CREATE INDEX IF NOT EXISTS ${retained} ON ${table}(${columns})`);await c.query(`CREATE INDEX IF NOT EXISTS ${alias} ON ${table}(${columns})`);}
 await c.query('ANALYZE contacts');await c.query('ANALYZE deals');await c.query('ANALYZE audit_logs');
 await c.query('BEGIN');
 const catalog=(await c.query(`SELECT a.relname AS alias,b.relname AS retained,pg_get_indexdef(a.oid) AS alias_definition,pg_get_indexdef(b.oid) AS retained_definition,
  pg_relation_size(a.oid) AS alias_bytes,(SELECT count(*)::int FROM pg_constraint WHERE conindid=a.oid) AS constraint_dependents,
  (SELECT count(*)::int FROM pg_depend WHERE refobjid=a.oid) AS other_dependents,
  x.indisvalid AND y.indisvalid AND NOT x.indisunique AND NOT y.indisunique AND a.relam=b.relam AND x.indrelid=y.indrelid AND x.indkey::text=y.indkey::text AND x.indclass::text=y.indclass::text AND x.indcollation::text=y.indcollation::text AND x.indoption::text=y.indoption::text AND x.indnkeyatts=y.indnkeyatts AND x.indnatts=y.indnatts AND pg_get_expr(x.indpred,x.indrelid) IS NOT DISTINCT FROM pg_get_expr(y.indpred,y.indrelid) AND pg_get_expr(x.indexprs,x.indrelid) IS NOT DISTINCT FROM pg_get_expr(y.indexprs,y.indrelid) AS equivalent
  FROM pg_class a JOIN pg_index x ON x.indexrelid=a.oid CROSS JOIN pg_class b JOIN pg_index y ON y.indexrelid=b.oid WHERE (a.relname,b.relname) IN (('idx_contacts_ghl_id','contacts_ghl_contact_id_idx'),('idx_deals_contact_id','deals_contact_id_idx'),('idx_deals_pipeline','deals_pipeline_idx'),('idx_deals_pipeline_stage','deals_pipeline_stage_idx'))`)).rows;
 console.log('PHASE8_INDEX_CATALOG '+JSON.stringify(catalog));
 check(catalog.length===4&&catalog.every(r=>r.equivalent&&r.constraint_dependents===0&&r.other_dependents===0),'Four exact non-unique aliases have valid equivalent retained indexes and no native dependents');
 const baseline=await measure();
 const write=async(offset:number)=>{const t=performance.now();await c.query("INSERT INTO contacts(first_name,last_name,phone,email,ghl_contact_id) SELECT 'Phase8','Write','','write-'||n||'@example.test','write-ghl-'||n FROM generate_series($1::integer,$1::integer+1999) n",[offset]);return performance.now()-t;};
 await c.query('SAVEPOINT writes_before');const writeBeforeMs=await write(200000);await c.query('ROLLBACK TO SAVEPOINT writes_before');
 await c.query('SAVEPOINT aliases_before');for(const [alias]of pairs)await c.query('DROP INDEX '+alias);
 const candidate=await measure();
 await c.query('SAVEPOINT writes_after');const writeAfterMs=await write(200000);await c.query('ROLLBACK TO SAVEPOINT writes_after');
 check(candidate.every((r,i)=>JSON.stringify(r.returnedIds)===JSON.stringify(baseline[i].returnedIds)),'Every actor/query workload returns identical ordered facts');
 const comparisons=candidate.map((r,i)=>({query:r.query,p50Before:baseline[i].p50Ms,p50After:r.p50Ms,p95Before:baseline[i].p95Ms,p95After:r.p95Ms,regressionPercent:(r.p95Ms/baseline[i].p95Ms-1)*100}));
 // Freeze/report the contract before interpreting results. Sub-ms noise is reported, not claimed as a performance win.
 const unresolved=comparisons.filter(r=>r.p95After>r.p95Before*1.10&&r.p95After-r.p95Before>0.5);
 await c.query('ROLLBACK TO SAVEPOINT aliases_before');
 const retainedDefinitions=(await c.query("SELECT indexname,indexdef FROM pg_indexes WHERE indexname=ANY($1::text[]) ORDER BY indexname",[pairs.map(p=>p[0])])).rows;
 check(retainedDefinitions.length===4&&retainedDefinitions.every(r=>catalog.some(c=>c.alias===r.indexname&&c.alias_definition===r.indexdef)),'Candidate retains every exact original alias definition after rollback');
 fs.mkdirSync('generated-artifacts/phase8',{recursive:true});fs.writeFileSync('generated-artifacts/phase8/index-workload.json',JSON.stringify({productionExecution:false,volume:{contacts:160000,deals:1600,auditLogs:1900000},sampleCountPerQuery:30,threshold:{percent:10,absoluteNoiseAllowanceMs:.5},catalog,baseline,candidate,comparisons,writeBeforeMs,writeAfterMs,unresolved,retainedDefinitions,approvedIndexDdl:[],experimentMeetsFrozenTimingBound:unresolved.length===0,decision:'retain all four aliases; no index DDL; experimental timing does not authorize consolidation'},null,2));
 // The removal experiment is NOT the implemented candidate. Preserve every failed
 // metric and reject consolidation; do not require an abandoned optimisation to pass.
 // Native catalog parity/rollback above gates our explicit no-change decision.
 check(retainedDefinitions.length===pairs.length,'No removal approved: measured experiment, including regressions, leaves all candidate indexes intact');
 console.log('PHASE8_INDEX_EXPERIMENT '+JSON.stringify({unresolved,approvedIndexDdl:[],decision:'retain aliases'}));
 console.log(`PHASE8_INDEXES_PASS ${checks}`);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
