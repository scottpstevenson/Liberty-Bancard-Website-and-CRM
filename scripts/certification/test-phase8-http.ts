import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stage3BHttpFixture} from '../fixtures/stage3-b-http';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
applyCertificationProviderDenyBoundary({fatal:true});
const h=await stage3BHttpFixture(async app=>{
 (await import('../../server/routes/admin')).registerAdminRoutes(app);
 (await import('../../server/routes/sdr')).registerSdrRoutes(app);
 (await import('../../server/routes/imports')).registerImportsRoutes(app);
},undefined,{backgroundProfile:'off'});
let checks=0;const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
try{
 await h.pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'private fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
 (await import('../../server/services/outbound-pause-authority')).invalidatePauseStateCache();
 await h.pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status) VALUES('Usable','example.test',$1,true,'warm'),('Disabled','example.test',$2,false,'warm'),('Unknown','example.test',$3,NULL,'warm')",Array.from({length:3},()=>`${randomUUID()}@example.test`));
 for(const role of ['admin','manager','agent','merchant','partner','anonymous']){
  for(const path of ['/api/admin/system-readiness','/api/admin/worker-heartbeats']){
   const response=await h.request(role,'GET',path);
   assert.equal(response.status,['admin','manager'].includes(role)?200:role==='anonymous'?401:403,JSON.stringify(response.body));
   check(true,role+' read authority '+path);
   if(response.status===200){
    if(path.endsWith('system-readiness'))assert.equal(response.body.sendingIdentities.activeCount,1);
    else {assert.equal(response.body.backgroundProfile,'off');assert.equal(response.body.pauseReason.state,'paused');assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(response.body.heartbeats.length>0&&response.body.heartbeats.every((w:any)=>!w.expectedSelected&&!w.workerActive&&!w.backlogAvailable));}
   }
  }
 }
 await h.pool.query('ALTER TABLE sending_identities RENAME TO phase8_unavailable_sender_fixture');
 try{const unavailable=await h.request('admin','GET','/api/admin/system-readiness');assert.equal(unavailable.status,200);check(unavailable.body.sendingIdentities.available===false&&unavailable.body.sendingIdentities.activeCount===null,'Partial readiness cannot turn unavailable sender evidence into zero/healthy');}
 finally{await h.pool.query('ALTER TABLE phase8_unavailable_sender_fixture RENAME TO sending_identities');}
 const maintenance=await h.request('admin','POST','/api/sdr/inbox-maintenance',{});
 assert.equal(maintenance.status,200,JSON.stringify(maintenance.body));assert.equal(maintenance.body.execution,"completed");
 const replay=await h.request("admin","POST","/api/sdr/inbox-maintenance",{});assert.equal(replay.status,200);assert.equal(replay.body.execution,"replayed");
 check(true,"Actual maintenance HTTP path records and replays its durable period");
 const denied=await h.request("manager","POST","/api/sdr/inbox-maintenance",{});assert.equal(denied.status,403);
 check(true,"Manager cannot execute maintenance");
 const stats=await h.request("admin","GET","/api/csv-imports/stats");assert.equal(stats.status,200);assert.equal(stats.body.totalUpdatedRows,0);
 check(true,"Import DTO exposes updated rows separately from newly created source rows");
 check(h.externalCalls()===0&&getBlockedCertificationNetworkAttemptCount()===0,'Status reads and permissions perform no provider request');
 check((await h.pool.query('SELECT state,epoch FROM outbound_pause_control')).rows.every(r=>r.state==='paused'&&Number(r.epoch)===4),'HTTP verification preserves outbound state/epoch');
 console.log(`PHASE8_HTTP_PASS ${checks}`);
}finally{await h.close();}
