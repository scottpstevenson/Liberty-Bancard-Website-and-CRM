/** Real intake routes and persisted staff sessions against private disposable infrastructure; no live sends. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stage3BHttpFixture} from '../fixtures/stage3-b-http';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
applyCertificationProviderDenyBoundary({fatal:true});
const h=await stage3BHttpFixture(async app=>{
 (await import('../../server/routes/partner-program')).registerPartnerProgramRoutes(app);
 (await import('../../server/routes/lifecycle')).registerLifecycleRoutes(app);
 (await import('../../server/routes/inbound-acknowledgements')).registerInboundAcknowledgementRoutes(app);
},undefined,{backgroundProfile:'off'});
const {PARTNER_APPLICATION_CONSENT}=await import('../../shared/partner-application');
let checks=0;
const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
try{
 await h.pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
 (await import('../../server/services/outbound-pause-authority')).invalidatePauseStateCache();
 for(const path of ['referral','sales_agent']){
  const email=`${randomUUID()}@example.test`,key=randomUUID();
  const body={schemaVersion:1,path,fullName:'Private Applicant',email,company:'Private Company',contactPreference:'email',contactPermission:true,consentVersion:PARTNER_APPLICATION_CONSENT.version,marketingOptIn:false,
   ...(path==='referral'?{profession:'cpa',referralNetwork:'Local merchants'}:{phone:'+15555550123',region:'Florida',experience:'Private fixture',prospectingApproach:'Private fixture',leadSourceInterest:'self_sourced'})};
  const first=await h.request('anonymous','POST','/api/partner-apply',body,true,{'Idempotency-Key':key});
  assert.equal(first.status,201,JSON.stringify(first.body));
  const replay=await h.request('anonymous','POST','/api/partner-apply',body,true,{'Idempotency-Key':key});
  assert.ok(replay.status>=200&&replay.status<300,JSON.stringify(replay.body));
  const rows=(await h.pool.query('SELECT a.id,a.path,p.status,t.state,t.recipient,t.event_kind FROM partner_applications a JOIN partners p ON p.id=a.partner_id JOIN team_intake_alerts t ON t.event_key=\'application:\'||a.id::text WHERE p.email=$1',[email])).rows;
  check(rows.length===1&&rows[0].status==='pending'&&rows[0].state==='pending'&&rows[0].recipient==='scott@libertybancard.com'&&rows[0].event_kind===(path==='referral'?'referral_partner_application':'sales_agent_application'),'Real '+path+' form and replay create one pending staff alert without approval');
 }
 const {storage}=await import('../../server/storage');
 const referralCode=randomUUID();
 await storage.createMerchantProfile({userId:h.userId('merchant'),businessName:'Private merchant',referralCode} as any);
 const merchant=await h.request('anonymous','POST','/api/merchant-referrals',{referralCode,referredEmail:`${randomUUID()}@example.test`,referredName:'Private Referral',referredCompany:'Private Company'});
 assert.equal(merchant.status,201,JSON.stringify(merchant.body));
 const alert=(await h.pool.query("SELECT * FROM team_intake_alerts WHERE event_key=$1",['merchant_referral:'+merchant.body.id])).rows;
 check(alert.length===1&&alert[0].state==='pending'&&merchant.body.status==='pending','Real merchant referral route commits pending record and staff alert');
 for(const role of ['admin','manager','agent','merchant','anonymous']){
  const status=await h.request(role,'GET','/api/admin/team-intake-alerts/status');
  assert.equal(status.status,['admin','manager'].includes(role)?200:role==='anonymous'?401:403,JSON.stringify(status.body));
  if(status.status===200){assert.equal(status.body.recipient,'scott@libertybancard.com');assert.equal(status.body.sendWhileOutboundPaused,true);assert.equal(status.headers.get('cache-control'),'no-store');}
  check(true,'Status read authorization: '+role);
 }
 check((await h.pool.query('SELECT state,epoch FROM outbound_pause_control')).rows.every(r=>r.state==='paused'&&Number(r.epoch)===4),'HTTP intake never changes outbound pause or epoch');
 check((await h.pool.query("SELECT count(*)::int n FROM team_intake_alerts WHERE state='sent'")).rows[0].n===0,'Dev HTTP fixture sends no staff email');
 check(h.externalCalls()===0&&getBlockedCertificationNetworkAttemptCount()===0,'All HTTP checks completed with zero provider calls');
 console.log(`PASS ${checks} team intake HTTP checks`);
}finally{await h.close();}
