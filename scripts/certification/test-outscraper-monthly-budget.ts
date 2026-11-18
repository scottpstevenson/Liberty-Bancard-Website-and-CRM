import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'CRM-wide Outscraper budget'});
applyCertificationProviderDenyBoundary({fatal:true});process.env.OUTSCRAPER_API_KEY='disposable-budget-test-only';
const {pool,db}=await import('../../server/db');
const {sql:querySql}=await import('drizzle-orm');
const budget=await import('../../server/services/outscraper-monthly-budget');
const transport=await import('../../server/services/sdr/outscraper');
const schema=await import('../../shared/schema');
let checks=0,calls=0;const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log(`PASS ${label}`);};
const sql=(text:string,args:any[]=[])=>pool.query(text,args);
const scalar=async(text:string,args:any[]=[])=>Object.values((await sql(text,args)).rows[0])[0];
const fingerprint=budget.outscraperRequestFingerprint('non-sensitive synthetic request');
const purchase=(service:'maps'|'leads',quantity:number)=>({service,quantity,fingerprint});
const expiry=()=>new Date(Date.now()+86400000).toISOString();
const leadsQuote=(unit:'domain'|'contact'='domain')=>({unitPriceMicros:3000,unit,expiresAt:expiry(),evidence:'Synthetic disposable endpoint-specific quote, not a vendor-account observation'});
const fakeFetch=(async(input:any)=>{calls++;const u=new URL(String(input));
 assert.equal(u.hostname,'api.outscraper.com');
 return new Response(JSON.stringify(u.pathname.startsWith('/requests/')?{status:'Success',data:[[]]}:u.pathname==='/leads-and-contacts'?{data:[{domain:'fixture.test',contacts:[]}]}:{status:'Success',data:[[]]}),{status:200});
}) as typeof fetch;
const opts={fetchImpl:fakeFetch,recordCreditSignal:async()=>{}};
const maps=(quantity=2)=>transport.performOutscraperSearch({query:'Synthetic business in fixture',resultLimit:quantity},opts);
const contacts=(quantity=2)=>transport.performOutscraperLeadsAndContacts(Array.from({length:quantity},(_,i)=>`fixture-${i}.test`),opts);
// Only this launcher-owned disposable DB is cleared; no production reset endpoint exists.
const reset=async()=>{await sql('DELETE FROM outscraper_budget_requests');await sql('DELETE FROM outscraper_budget_windows');await sql('DELETE FROM outscraper_budget_policy');};
const legacyIds:string[]=[];
async function legacy(price:number|null,state='committed',createdAt=new Date().toISOString()){
 const r=(await sql(`INSERT INTO provider_operations(provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state,billing_state,requested_units,reserved_units,unit_price_micros,unit_price_unit,settled_cost_micros,created_at)
 VALUES('outscraper','budget_fixture','legacy_fixture',$1,'system','synthetic','completed',$2,1,1,$3,'result',$3,$4) RETURNING id`,[randomUUID(),state,price,createdAt])).rows[0].id;legacyIds.push(r);return r;
}
try{
 for(const table of [schema.outscraperBudgetPolicy,schema.outscraperBudgetWindows,schema.outscraperBudgetRequests]){
  const c=getTableConfig(table);const live=(await sql('SELECT column_name FROM information_schema.columns WHERE table_name=$1',[c.name])).rows;
  check(live.length===c.columns.length&&c.columns.every(column=>live.some(x=>x.column_name===column.name)),`${c.name} columns match declared schema`);
  const constraints=(await sql('SELECT conname,convalidated FROM pg_constraint WHERE conrelid=$1::regclass',[c.name])).rows;
  check(c.checks.every(x=>constraints.some(y=>y.conname===x.name&&y.convalidated)),`${c.name} native checks match and are validated`);
  for(const index of c.indexes)check(await scalar('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',[index.config.name]),`${index.config.name} is valid`);
 }
 await sql(`INSERT INTO provider_controls(provider,capability) VALUES('outscraper','business_discovery') ON CONFLICT DO NOTHING`);
 let status=await budget.readOutscraperMonthlyBudget();check(Number(await scalar('SELECT count(*) FROM outscraper_budget_policy'))===0,'Status GET logic does not initialize or mutate financial policy');
 check(status.limitMicros===50000000&&status.pricingReady&&!status.enrichmentPricingReady,'One $50 authority; enrichment price is not invented from another endpoint');
 await assert.rejects(contacts(),/PRICING_UNVERIFIED/);check(calls===0,'Missing enrichment quote blocks actual transport');
 await budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:0.01,leadsQuote:leadsQuote()});
 const race=await Promise.allSettled([maps(),contacts()]);
 check(race.filter(r=>r.status==='fulfilled').length===1&&race.some(r=>r.status==='rejected'&&/BUDGET_REACHED/.test(String(r.reason))),'Maps and enrichment contend for the same real PostgreSQL allowance');
 status=await budget.readOutscraperMonthlyBudget();check(calls===1&&status.reservedMicros===6000,'Only one concurrent HTTP purchase executes and it is counted once');
 await assert.rejects(maps(),/BUDGET_REACHED/);check(calls===1,'Injected fetch alone cannot bypass an exhausted cap');
 const count=Number(await scalar('SELECT count(*) FROM outscraper_budget_requests'));
 await transport.performOutscraperTaskResults('retained-task',opts);
 check(calls===2&&Number(await scalar('SELECT count(*) FROM outscraper_budget_requests'))===count,'Known-task retrieval remains possible without another purchase at exhausted budget');
 await assert.rejects(transport.performOutscraperTaskResults('../new-query',opts),/REFERENCE_INVALID/);checks++;
 await reset();await budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:0.01});
 const before=calls;
 await assert.rejects(transport.performOutscraperSearch({query:'fixture',resultLimit:2},{...opts,beforeRequest:async()=>{throw Error('OWNER_DENIED');}}),/OWNER_DENIED/);
 check(calls===before&&(await budget.readOutscraperMonthlyBudget()).reservedMicros===0,'Failed owner checkpoint refunds only this proven non-dispatched reservation');
 await assert.rejects(transport.performOutscraperSearch({query:'fixture',resultLimit:2},{...opts,fetchImpl:async()=>{calls++;throw Error('UNCERTAIN_HTTP');}}),/UNCERTAIN_HTTP/);
 check((await budget.readOutscraperMonthlyBudget()).reservedMicros===6000,'Unknown HTTP outcome retains its complete maximum liability');
 await assert.rejects(maps(),/BUDGET_REACHED/);checks++;
 await reset();const crashed=await budget.reserveOutscraperMonthlyBudget(purchase('maps',2));
 check((await budget.readOutscraperMonthlyBudget()).reservedMicros===6000,'A crashed process cannot erase a durable pre-I/O reservation');
 await crashed.markDispatched();await crashed.releaseNotDispatched();
 check((await budget.readOutscraperMonthlyBudget()).reservedMicros===6000,'A dispatched reservation cannot be refunded by the non-dispatch method');
 await assert.rejects(crashed.markDispatched(),/RESERVATION_LOST/);checks++;
 await reset();const old=await budget.reserveOutscraperMonthlyBudget(purchase('maps',2));
 await sql(`INSERT INTO outscraper_budget_windows(period) VALUES('2000-01')`);
 await sql(`UPDATE outscraper_budget_requests SET period='2000-01' WHERE id=$1`,[old.id]);
 await assert.rejects(old.markDispatched(),/PERIOD_CHANGED/);checks++;
 check(Number(await scalar("SELECT sum(maximum_micros) FROM outscraper_budget_requests WHERE period='2000-01'"))===6000,'Month transition preserves the old reservation and refuses wrong-period dispatch');
 await reset();const revised=await budget.reserveOutscraperMonthlyBudget(purchase('maps',2));
 await budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:0});
 await assert.rejects(revised.markDispatched(),/POLICY_CHANGED/);checks++;
 await reset();await budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:50});await sql("UPDATE outscraper_budget_policy SET maps_quote_expires_at=now()-interval '1 second'");
 await assert.rejects(maps(),/PRICING_UNVERIFIED/);checks++;
 await assert.rejects(budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:50.01}),/LIMIT_INVALID/);checks++;
 await reset();await budget.updateOutscraperMonthlyBudget('fixture',{leadsQuote:leadsQuote('contact')});await contacts(2);
 check((await budget.readOutscraperMonthlyBudget()).reservedMicros===18000,'Contact-priced enrichment reserves all three requested contacts per company');
 await reset();const known=await legacy(9000);status=await budget.readOutscraperMonthlyBudget();
 check(status.legacyMicros===9000&&status.unknownOperations===0,'Real existing provider ledger cost consumes the shared allowance');
 await budget.reserveOutscraperMonthlyBudget(purchase('maps',1));
 await budget.updateOutscraperMonthlyBudget('fixture',{monthlyBudgetUsd:0.01});await assert.rejects(maps(1),/BUDGET_REACHED/);checks++;
 await sql("UPDATE provider_operations SET billing_state='released',settled_cost_micros=0 WHERE id=$1",[known]);
 check((await budget.readOutscraperMonthlyBudget()).legacyMicros===9000,'Observed legacy liability does not silently shrink within its month');
 await sql('DELETE FROM provider_operations WHERE id=$1',[known]);
 await reset();const unknown=await legacy(null,'ambiguous','2000-01-01T00:00:00Z');status=await budget.readOutscraperMonthlyBudget();
 check(status.unknownOperations===1&&status.remainingMicros===null,'Older unresolved provider holds are not hidden by a new calendar month');
 await assert.rejects(maps(1),/LEGACY_UNRECONCILED/);checks++;
 await sql("UPDATE provider_operations SET billing_state='released',settled_cost_micros=0 WHERE id=$1",[unknown]);
 check((await budget.readOutscraperMonthlyBudget()).unknownOperations===0,'Only resolution in the native ledger clears its uncertainty');
 await sql('DELETE FROM provider_operations WHERE id=$1',[unknown]);
 await reset();const linked=await legacy(9000,'reserved');
 const ticket=await budget.reserveOutscraperMonthlyBudget({...purchase('maps',2),reference:{providerOperationId:linked}});
 await assert.rejects(ticket.markDispatched(),/NATIVE_MARKER_REQUIRED/);checks++;
 await sql(`INSERT INTO provider_attempts(operation_id,attempt_number,outcome,dispatch_marked_at) VALUES($1,1,'ambiguous',now())`,[linked]);
 await sql("UPDATE provider_operations SET billing_state='ambiguous' WHERE id=$1",[linked]);await ticket.markDispatched();
 status=await budget.readOutscraperMonthlyBudget();check(status.legacyMicros===0&&status.reservedMicros===18000,'Linked native operation is counted once and its higher frozen price is honored');
 await reset();await sql('DELETE FROM provider_attempts WHERE operation_id=$1',[linked]);await sql('DELETE FROM provider_operations WHERE id=$1',[linked]);
 const utcBoundary=String(await scalar(`SELECT to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'America/New_York')+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS')`));
 const priorMonth=await legacy(3000,'committed',utcBoundary+'Z');
 check((await budget.readOutscraperMonthlyBudget()).legacyMicros===0,'Actual provider timestamps near month start use the correct Eastern calendar month');
 await sql('DELETE FROM provider_operations WHERE id=$1',[priorMonth]);
 const expectedPeriod=String(await scalar(`SELECT to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'America/New_York')-interval '1 day','YYYY-MM')`));
 const dual=await db.transaction(async tx=>{
  await tx.execute(querySql`SET LOCAL TIME ZONE 'Pacific/Honolulu'`);
  return (await tx.execute(querySql`SELECT ${budget.outscraperBudgetPeriodSql(querySql`${utcBoundary}::timestamp`)} AS naive,
    ${budget.outscraperBudgetPeriodSql(querySql`${utcBoundary+'Z'}::timestamptz`)} AS aware`)).rows[0];
 });
 check(dual.naive===expectedPeriod&&dual.aware===expectedPeriod,'Both timestamp types preserve the Eastern boundary under a non-UTC database session');

 const {seedBudgetCro03cGeneration}=await import('./fixtures/outscraper-budget-cro03c');const generation=await seedBudgetCro03cGeneration(pool);
 const cro=(await sql(`INSERT INTO cro03c_stage_operations(generation_id,stage_key,provider,operation_type,operation_key,caller,unit_type,currency,price_schedule_version,price_schedule_hash,max_reserved_units,max_reserved_amount_micros,settled_amount_micros,billing_certainty,dispatched_at)
 VALUES($1,'outscraper','outscraper','fixture',$2,'server/services/cro03/live-provider-executors.ts','result','USD',1,$3,2,10000,3000,'certain',now()) RETURNING id`,[generation,randomUUID(),'a'.repeat(64)])).rows[0].id;
 check((await budget.readOutscraperMonthlyBudget()).legacyMicros===10000,'CRO03C maximum liability participates in the same historical baseline');
 await reset();await sql("UPDATE cro03c_stage_operations SET dispatched_at=NULL,dispatch_state='dispatching',settled_amount_micros=0 WHERE id=$1",[cro]);
 const croTicket=await budget.reserveOutscraperMonthlyBudget({...purchase('maps',2),reference:{generationId:generation,stageKey:'outscraper'}});
 await assert.rejects(croTicket.markDispatched(),/NATIVE_MARKER_REQUIRED/);checks++;
 await sql("UPDATE cro03c_stage_operations SET dispatched_at=now(),dispatch_state='dispatched',billing_certainty='ambiguous' WHERE id=$1",[cro]);await croTicket.markDispatched();
 status=await budget.readOutscraperMonthlyBudget();check(status.legacyMicros===0&&status.reservedMicros===10000,'A linked CRO03C stage and a request reservation are not double charged');
 const certificationBudget=async()=>({id:'fixture',markDispatched:async()=>{},releaseNotDispatched:async()=>{}});
 const env=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{await assert.rejects(transport.performOutscraperSearch({query:'fixture'},{...opts,certificationBudget}),/TEST_OVERRIDE_DENIED/);checks++;
 await assert.rejects(transport.performOutscraperSearch({query:'fixture'},opts),/OWNER_REQUIRED/);checks++;}finally{process.env.NODE_ENV=env;}
 check(getBlockedCertificationNetworkAttemptCount()===0,'All financial proofs used fake HTTP and zero real provider requests');
 console.log(`OUTSCRAPER_GLOBAL_BUDGET_PASS ${checks}`);
}finally{await pool.end();}
