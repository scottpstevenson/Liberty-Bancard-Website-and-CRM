import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Phase 8 period/counter certification'});applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import('../../server/db');const {sql}=await import('drizzle-orm');
const {runScheduledPeriod}=await import('../../server/services/scheduled-period');
const inbox=await import('../../server/services/sdr/inbox-rotation');
let checks=0;const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
async function count(query:string,params:any[]=[]){return Number(Object.values((await pool.query(query,params)).rows[0])[0]);}
try{
 await pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'phase8 private fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
 if(process.argv.includes('--crash')){
  await runScheduledPeriod('funnel-aggregation','2026-11-12',async tx=>{await tx.execute(sql`INSERT INTO audit_logs(action,entity_type) VALUES('phase8-process-crash','fixture')`);process.exit(77);});
 }else if(process.argv.includes('--child')){
  await runScheduledPeriod('funnel-aggregation','2026-11-18',async tx=>{await tx.execute(sql`INSERT INTO audit_logs(action,entity_type) VALUES('phase8-cross-process','fixture')`);});
 }else{
  const work=async(tx:any)=>{await tx.execute(sql`INSERT INTO audit_logs(action,entity_type) VALUES('phase8-one-period','fixture')`);return 7;};
  const results=await Promise.all(Array.from({length:6},()=>runScheduledPeriod('funnel-aggregation','2026-11-17',work)));
  check(results.filter(r=>!r.replayed).length===1&&await count("SELECT count(*) FROM audit_logs WHERE action='phase8-one-period'")===1,'Concurrent callers commit one database effect and receipt');
  const child=()=>new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/certification/test-phase8-periods.ts','--child'],{env:process.env,stdio:'inherit'});p.on('exit',c=>c===0?resolve():reject(Error('CHILD_FAILED')));p.on('error',reject);});
  await Promise.all([child(),child()]);check(await count("SELECT count(*) FROM audit_logs WHERE action='phase8-cross-process'")===1,'Independent processes share the same period authority');
  await assert.rejects(runScheduledPeriod('funnel-aggregation','2026-11-16',async tx=>{await tx.execute(sql`INSERT INTO audit_logs(action,entity_type) VALUES('phase8-rollback','fixture')`);throw Error('fixture crash');}),/fixture crash/);
  check(await count("SELECT count(*) FROM scheduled_period_receipts WHERE period_key='2026-11-16'")===0&&await count("SELECT count(*) FROM audit_logs WHERE action='phase8-rollback'")===0,'Fault before commit rolls back effect and completion receipt');
  check(!(await runScheduledPeriod('funnel-aggregation','2026-11-16',work)).replayed,'Rolled-back work can safely recover');
  const crashed=await new Promise<number|null>((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/certification/test-phase8-periods.ts','--crash'],{env:process.env,stdio:'inherit'});p.on('exit',resolve);p.on('error',reject);});
  check(crashed===77&&await count("SELECT count(*) FROM scheduled_period_receipts WHERE period_key='2026-11-12'")===0&&await count("SELECT count(*) FROM audit_logs WHERE action='phase8-process-crash'")===0,'Process termination rolls back uncommitted effect and receipt');
  check(!(await runScheduledPeriod('funnel-aggregation','2026-11-12',work)).replayed,'Another process can recover the crashed period');
  const {COLD_OUTREACH_FROM}=await import('../../server/services/sender-policy');
  await pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status,daily_limit,sent_today,counter_date) VALUES('Other canonical consumer','example.test',$1,true,'warm',2,2,'2000-01-01')",[COLD_OUTREACH_FROM]);
  check((await (await import('../../server/services/sfp-sender-capacity')).readSelectedSender())?.sentToday===0,'SFP capacity reader respects expired inbox counter period without resetting stored history');
  const outreach=await import('../../server/services/daily-outreach');
  const cycles=await Promise.all([outreach.runDailyOutreach(),outreach.runDailyOutreach()]);
  check(cycles.some(r=>r.execution==='completed')&&cycles.some(r=>r.execution==='held'),'Actual concurrent daily outreach commands share the registry owner while outbound stays paused');
  const registry=await import('../../server/services/job-registry');
  const owner=await registry.acquireJobLock('inbox-rotation');assert.equal(owner.status,'acquired');
  check((await inbox.runDailyMaintenance()).execution==='held','Concurrent real maintenance refuses held registry lease');
  await pool.query("UPDATE background_jobs SET updated_at=now()-interval '2 hours' WHERE job_name='inbox-rotation'");
  const takeover=await registry.acquireJobLock('inbox-rotation');assert.equal(takeover.status,'acquired');
  check(owner.status==='acquired'&&(await registry.releaseJobLock('inbox-rotation',true,undefined,owner.lockToken)).status==='stale_owner','Stale owner cannot release a replacement lease');
  if(takeover.status==='acquired')await registry.releaseJobLock('inbox-rotation',true,undefined,takeover.lockToken);
  await pool.query('ALTER TABLE background_jobs RENAME TO phase8_private_unavailable_jobs');
  try{check((await inbox.runDailyMaintenance()).execution==='unavailable','Unavailable native registry refuses maintenance without fallback');check((await outreach.runDailyOutreach()).execution==='unavailable','Actual daily command reports unavailable, not completed zero work');check((await (await import('../../server/services/sdr/orchestrator')).sweepLeads()).execution==='unavailable','Actual SDR sweep reports unavailable, not completed zero work');}finally{await pool.query('ALTER TABLE phase8_private_unavailable_jobs RENAME TO background_jobs');}
  const row=(await pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status,daily_limit,sent_today,counter_date) VALUES('Phase8 Fixture','example.test','phase8@example.test',true,'warm',2,0,'2000-01-01') RETURNING id")).rows[0];
  check(!!await inbox.reserveSend(row.id,1),'Reservation lazily rolls an expired day before consuming allowance');
  const first=await inbox.runDailyMaintenance();check(first.execution==='completed'&&await count('SELECT sent_today FROM sending_identities WHERE id=$1',[row.id])===1,'Maintenance cannot erase a current-day reservation');
  const reservation=await inbox.reserveSend(row.id,1);check(!!reservation,'Second current-day reservation succeeds at exact cap');
  check(!await inbox.reserveSend(row.id,1),'Cap rejects the next reservation');
  await inbox.resetDailySendCounts();await inbox.runDailyMaintenance();check(await count('SELECT sent_today FROM sending_identities WHERE id=$1',[row.id])===2,'Repeated reset/manual/scheduled maintenance preserves same-day consumption');
  await inbox.rollbackSend(row.id,'2000-01-01');check(await count('SELECT sent_today FROM sending_identities WHERE id=$1',[row.id])===2,'Old-day rollback cannot free current-day capacity');
  await inbox.rollbackSend(row.id,reservation!.periodKey);check(await count('SELECT sent_today FROM sending_identities WHERE id=$1',[row.id])===1,'Known-unsent rollback remains bound to the reservation day');
  const disabled=(await pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status) VALUES('Disabled','example.test','disabled@example.test',NULL,'warm') RETURNING id")).rows[0];
  check(!await inbox.reserveSend(disabled.id,1),'Unknown sender activation cannot reserve a slot');
  const {aggregateDailyMetrics}=await import('../../server/services/sdr/funnel-metrics');
  await Promise.all([aggregateDailyMetrics('2026-11-15',{scheduled:true}),aggregateDailyMetrics('2026-11-15',{scheduled:true})]);
  const rows=await count("SELECT count(*) FROM daily_funnel_metrics WHERE date='2026-11-15'");
  await aggregateDailyMetrics('2026-11-15',{scheduled:true});check(await count("SELECT count(*) FROM daily_funnel_metrics WHERE date='2026-11-15'")===rows,'Scheduled funnel replay preserves the one committed projection');
  await aggregateDailyMetrics('2026-11-15');check(await count("SELECT count(*) FROM daily_funnel_metrics WHERE date='2026-11-15'")===rows,'Explicit manual refresh replaces projection without duplicating rows');
  check((await pool.query('SELECT state,epoch FROM outbound_pause_control')).rows.every(r=>r.state==='paused'&&Number(r.epoch)===4),'All effects preserve canonical outbound pause and epoch');
  const {runInboxSendEffect}=await import('../../server/services/sdr/inbox-send-effect');
  const sender=(await pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status,daily_limit) VALUES('Receipt fixture','example.test','receipt-fixture@example.test',true,'warm',35) RETURNING id")).rows[0].id;
  let dispatches=0;const acceptedKey={effectKey:'phase8-accepted',ownerKind:'phase8-fixture',ownerId:'one',channel:'email'};
  const accepted=()=>runInboxSendEffect(acceptedKey,sender,1,async()=>{dispatches++;return {success:true,messageId:'fixture-provider-id'};});
  await Promise.all([accepted(),accepted()]);await accepted();
  check(dispatches===1&&await count('SELECT sent_today FROM sending_identities WHERE id=$1',[sender])===1,'Concurrent and sequential effect replay dispatches and reserves once');
  const uncertainKey={...acceptedKey,effectKey:'phase8-unknown'};
  const unknown=await runInboxSendEffect(uncertainKey,sender,1,async()=>{dispatches++;throw Error('socket lost after delivery began');});
  const replayUnknown=await runInboxSendEffect(uncertainKey,sender,1,async()=>{dispatches++;return {success:true};});
  check(unknown.state==='unknown'&&replayUnknown.state==='unknown'&&replayUnknown.replay&&dispatches===2&&await count('SELECT sent_today FROM sending_identities WHERE id=$1',[sender])===2,'Unknown provider outcome retains capacity and cannot automatically repeat');
  const refused=await runInboxSendEffect({...acceptedKey,effectKey:'phase8-known-refused'},sender,1,async()=>({success:false,error:'Outbound paused: private fixture'}));
  check(refused.state==='refused'&&await count('SELECT sent_today FROM sending_identities WHERE id=$1',[sender])===2,'Proven refusal releases only its period-bound reservation');
  assert.throws(()=>outreach.startDailyOutreachWorker(),/LEGACY_DAILY_OUTREACH_RETIRED/);check(!outreach.isWorkerRunning(),'Retired legacy dispatcher cannot start a Redis-outage fallback');
  const {featureFlags}=await import('../../server/services/feature-flags');
  const orchestrator=await import('../../server/services/sdr/orchestrator');
  const originalEnabled=process.env.ORCHESTRATOR_ENABLED;process.env.ORCHESTRATOR_ENABLED="true";
  const set=globalThis.setTimeout,clear=globalThis.clearTimeout,setI=globalThis.setInterval,clearI=globalThis.clearInterval;
  const timeouts=new Set<any>(),intervals=new Set<any>();
  globalThis.setTimeout=((fn:any,ms:number,...args:any[])=>{const h=set(fn,ms,...args);if(ms===10000)timeouts.add(h);return h;}) as any;
  globalThis.clearTimeout=((h:any)=>{timeouts.delete(h);return clear(h);}) as any;
  globalThis.setInterval=((fn:any,ms:number,...args:any[])=>{const h=setI(fn,ms,...args);if(ms===300000)intervals.add(h);return h;}) as any;
  globalThis.clearInterval=((h:any)=>{intervals.delete(h);return clearI(h);}) as any;
  try{orchestrator.startOrchestrator();orchestrator.startOrchestrator();check(timeouts.size===1&&intervals.size===1,'Real SDR starter owns one initial timeout and interval');orchestrator.stopOrchestrator();check(timeouts.size===0&&intervals.size===0&&!orchestrator.isOrchestratorRunning(),'Real SDR Stop cancels initial and recurring work');}
  finally{orchestrator.stopOrchestrator();if(originalEnabled===undefined)delete process.env.ORCHESTRATOR_ENABLED;else process.env.ORCHESTRATOR_ENABLED=originalEnabled;globalThis.setTimeout=set;globalThis.clearTimeout=clear;globalThis.setInterval=setI;globalThis.clearInterval=clearI;}
  await (await import('../../server/storage')).storage.getSystemSetting('sdrOrchestratorPaused');
  check(getBlockedCertificationNetworkAttemptCount()===0,'No provider/network attempt occurred');console.log(`PHASE8_PERIODS_PASS ${checks}`);
 }
}finally{inbox.stopDailyMaintenanceScheduler();await pool.end();}
