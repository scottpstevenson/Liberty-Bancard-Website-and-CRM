import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Team intake email alert certification'});
applyCertificationProviderDenyBoundary({fatal:true});
const {pool,db}=await import('../../server/db');
const {sql}=await import('drizzle-orm');
const {storage}=await import('../../server/storage');
const svc=await import('../../server/services/team-intake-alerts');
const pause=await import('../../server/services/outbound-pause-authority');
const smtp=await import('../../server/services/smtp-email');
const applications=await import('../../server/services/partner-application');
const intros=await import('../../server/services/partner-introductions');
const inbound=await import('../../server/services/inbound-request-authority');
const {PARTNER_APPLICATION_CONSENT}=await import('../../shared/partner-application');
const {teamIntakeAlerts}=await import('../../shared/schema');
let checks=0;
const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log(`PASS ${label}`);};
const rows=async(s:string,p:any[]=[])=> (await pool.query(s,p)).rows;
const scalar=async(s:string,p:any[]=[])=>Object.values((await rows(s,p))[0])[0];
const alert=async(key:string)=>(await rows('SELECT * FROM team_intake_alerts WHERE event_key=$1',[key]))[0];
const identity=randomUUID().slice(0,8);
let calls:any[]=[];let mode='sent';
const originalTransport=nodemailer.createTransport;
(nodemailer as any).createTransport=()=>({sendMail:async(message:any)=>{calls.push(message);if(mode==='uncertain')throw Object.assign(new Error('fixture lost response'),{command:'DATA',code:'ECONNECTION'});if(mode==='unsent')throw Object.assign(new Error('fixture refused connection'),{code:'ECONNREFUSED'});return {messageId:'fixture-'+randomUUID()};}});
async function merchant(label:string){return storage.createMerchantReferral({referredEmail:`${label}-${identity}@example.test`,referredName:'<img src=x onerror=alert(1)>',referredCompany:'Fixture & Company',referralCode:'fixture'});}
async function claim(row:any){const token=randomUUID();return (await rows("UPDATE team_intake_alerts SET state='attempting',attempt_count=1,attempt_token=$2,lease_expires_at=now()+interval '5 minutes',dispatched_at=NULL WHERE id=$1 RETURNING *",[row.id,token]))[0];}
try{
 await pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");pause.invalidatePauseStateCache();
 const config=getTableConfig(teamIntakeAlerts);
 const native=await rows("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='team_intake_alerts'::regclass");
 check(config.checks.every(c=>native.some(n=>n.conname===c.name&&n.convalidated)),'Native alert constraints match declared schema');
 check(Number(await scalar('SELECT count(*) FROM team_intake_alerts'))===0,'Migration creates no historical alert backlog');
 const partner=await storage.createPartner({companyName:'Fixture Partner',contactName:'Fixture Partner',email:`partner-${identity}@example.test`,partnerType:'referral',affiliateCode:identity,status:'active',commissionPercent:null} as any);
 const created:any[]=[];
 for(const path of ['referral','sales_agent']){
  const request=await inbound.claimInboundRequest({idempotencyKey:randomUUID(),sourceCategory:'website_form',sourceType:'partner_application',callerScope:'public:team-fixture',actorType:'public',payload:{path}});
  assert.equal(request.outcome,'claimed');
  const result=await applications.createPartnerApplication({path,fullName:'Fixture Applicant',email:`${path}-${identity}@example.test`,company:'Fixture',profession:'cpa',referralNetwork:'Small businesses',contactPreference:'email',consentVersion:PARTNER_APPLICATION_CONSENT.version,marketingOptIn:false} as any,{inboundRequestId:(request as any).request.id});
  assert.equal(result.kind,'created');created.push(result);
  const a=await alert('application:'+(result as any).application.id);
  check(a?.event_kind===(path==='sales_agent'?'sales_agent_application':'referral_partner_application'),'Application and typed staff alert commit together: '+path);
 }
 const mr=await merchant('merchant');const ma=await alert('merchant_referral:'+mr.id);
 check(ma?.recipient===svc.TEAM_INTAKE_RECIPIENT,'Merchant-profile referral writes the fixed-recipient alert');
 const ref=await storage.createReferral({partnerId:partner.id,referredEmail:`referred-${identity}@example.test`,referredName:'Fixture',status:'pending'} as any);
 check(!!await alert('referral:'+ref.id),'Standalone partner/affiliate referral writes a staff alert');
 const body={businessName:'Fixture Introduction',contactName:'Fixture Person',contactEmail:`intro-${identity}@example.test`,permissionConfirmed:true};
 const key=randomUUID();const ir=await intros.recordPartnerIntroduction(partner,{userId:null},key,body as any);assert.equal(ir.kind,'recorded');
 const intro=(ir as any).introduction;
 await intros.recordPartnerIntroduction(partner,{userId:null},key,body as any);
 check(Number(await scalar('SELECT count(*) FROM team_intake_alerts WHERE event_key=$1',['introduction:'+intro.id]))===1,'Introduction replay retains exactly one staff alert');
 const contact=await storage.createContact({firstName:'Fixture',lastName:'Intro',phone:'',email:`contact-${identity}@example.test`} as any);
 await pool.query('UPDATE partner_introductions SET contact_id=$2 WHERE id=$1',[intro.id,contact.id]);
 const materialized=await storage.createReferral({partnerId:partner.id,contactId:contact.id,referredEmail:body.contactEmail,notes:'Partner introduction '+intro.id,status:'pending'} as any);
 check(!await alert('referral:'+materialized.id),'Materializing an already-alerted introduction does not duplicate the email');
 await Promise.all(Array.from({length:6},()=>db.transaction(tx=>svc.enqueueTeamIntakeAlert(tx,'merchant_referral',String(mr.id)))));
 check(Number(await scalar('SELECT count(*) FROM team_intake_alerts WHERE event_key=$1',['merchant_referral:'+mr.id]))===1,'Concurrent duplicate enqueue is one durable event');
 await assert.rejects(db.transaction(async tx=>{const r=(await tx.execute(sql`INSERT INTO merchant_referrals(referred_email,referral_code) VALUES('rollback@example.test','fixture') RETURNING id`)).rows[0] as any;await svc.enqueueTeamIntakeAlert(tx,'merchant_referral',String(r.id));throw Error('ROLLBACK');}),/ROLLBACK/);
 check(Number(await scalar("SELECT count(*) FROM merchant_referrals WHERE referred_email='rollback@example.test'"))===0,'Intake and alert roll back atomically');
 await pool.query(`CREATE FUNCTION pg_temp.reject_staff_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'email'='atomic-failure@example.test' THEN RAISE EXCEPTION 'FIXTURE_ALERT_WRITE_FAILURE'; END IF; RETURN NEW; END $$`);
 await pool.query('CREATE TRIGGER fixture_alert_failure BEFORE INSERT ON team_intake_alerts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_staff_alert()');
 await assert.rejects(storage.createMerchantReferral({referredEmail:'atomic-failure@example.test',referralCode:'fixture'}),(error:any)=>error.cause?.message==='FIXTURE_ALERT_WRITE_FAILURE');
 check(Number(await scalar("SELECT count(*) FROM merchant_referrals WHERE referred_email='atomic-failure@example.test'"))===0,'Actual merchant writer rolls back intake when alert persistence fails');
 await pool.query('DROP TRIGGER fixture_alert_failure ON team_intake_alerts');
 const content=svc.renderTeamIntakeAlert(ma);
 check(content.html.includes('&lt;img')&&!content.html.includes('<img')&&content.html.includes('&amp;'),'Untrusted fields are HTML escaped');
 check(content.subject==='Liberty Bancard: New merchant referral'&&content.text.includes('/dashboard/intake?tab=referrals'),'Server-owned subject and CRM link; no customer-supplied URL');
 let c=await claim(ma);const lease={alertId:c.id,attemptToken:c.attempt_token};
 check((await pause.authorizeTeamIntakeAlertSend(content,lease)).allowed,'Exact staff intake message obtains a lease while globally paused');
 const before=calls.length;
 for(const bad of [{...content,to:'elsewhere@example.test'},{...content,html:content.html+'changed'},{...content,subject:'changed'},{...content,category:'cold_outreach'},{...content,commercialPurpose:'marketing_outreach'},{...content,contactId:contact.id},{...content,inboundAck:{effectId:randomUUID(),attemptToken:randomUUID()}},{...content,phase7Attempt:{idempotencyKey:'fixture'}}]){
  const result=await smtp.sendSmtpEmail({...bad,teamIntakeAlert:lease} as any);check(!result.success,'Canonical SMTP refuses altered recipient/content/purpose');
 }
 process.env.EMAIL_OVERRIDE_TO='override@example.test';check(!(await smtp.sendSmtpEmail({...content,teamIntakeAlert:lease})).success,'Recipient override cannot redirect the staff capability');delete process.env.EMAIL_OVERRIDE_TO;
 process.env.NODE_ENV='development';check(!(await smtp.sendSmtpEmail({...content,teamIntakeAlert:lease})).success,'Normal non-production use cannot send live staff alerts');process.env.NODE_ENV='test';
 check(!(await pause.authorize({})).allowed&&calls.length===before,'Ordinary outbound remains blocked; invalid staff messages cause zero SMTP calls');
 const decision=await pause.authorizeTeamIntakeAlertSend(content,lease);await pool.query('UPDATE outbound_pause_control SET epoch=5');pause.invalidatePauseStateCache();
 check(!await pause.recheckSeedLeaseEpoch(decision.epoch),'An epoch change invalidates an in-flight staff lease');
 await pool.query("UPDATE outbound_pause_control SET state='activating'");pause.invalidatePauseStateCache();check(!(await pause.authorizeTeamIntakeAlertSend(content,lease)).allowed,'Activation barrier refuses even staff leases');
 await pool.query("UPDATE outbound_pause_control SET state='paused',epoch=4");pause.invalidatePauseStateCache();
 await pool.query("UPDATE team_intake_alerts SET state='pending',attempt_token=NULL,lease_expires_at=NULL,attempt_count=0");
 check((await svc.processTeamIntakeAlerts()).waiting===1&&calls.length===before,'Missing SMTP configuration waits without dropping events');
 Object.assign(process.env,{SMTP_HOST:'fixture.invalid',SMTP_USER:'fixture',SMTP_PASS:'fixture-only'});
 await Promise.all([svc.processTeamIntakeAlerts(),svc.processTeamIntakeAlerts()]);
 check(calls.length===5&&Number(await scalar("SELECT count(*) FROM team_intake_alerts WHERE state='sent'"))===5,'Concurrent workers send five distinct intake events exactly once through fake SMTP');
 check(calls.every(m=>m.to===svc.TEAM_INTAKE_RECIPIENT),'Every intercepted envelope targets only Scott');
 await svc.processTeamIntakeAlerts();check(calls.length===5,'Subsequent sweeps do not resend completed events');
 check((await rows('SELECT state,epoch FROM outbound_pause_control'))[0].state==='paused','Staff alerts never unpause customer/prospect outbound');
 const booking=await inbound.claimVerifiedProviderEvent({sourceType:'appointment_booked',eventId:'fixture-booking-'+identity,payload:{}});
 assert.equal(booking.outcome,'claimed');
 await db.transaction(tx=>svc.enqueueTeamIntakeAlert(tx,'ghl_booking',booking.request.id));
 for (const channel of ['call','sms'] as const) {
  const activity={channel,locationId:'fixture-location',messageId:channel+'-'+identity};
  await svc.enqueueVerifiedGhlActivityAlert(activity);
  await svc.enqueueVerifiedGhlActivityAlert(activity);
 }
 const beforeGhl=calls.length;
 await svc.processTeamIntakeAlerts();
 assert.deepEqual(calls.slice(beforeGhl).map(m=>m.subject).sort(),[
  'Liberty Bancard: New inbound call','Liberty Bancard: New inbound text','Liberty Bancard: New sales meeting booked',
 ]);
 check(calls.slice(beforeGhl).every(m=>m.to===svc.TEAM_INTAKE_RECIPIENT),'Incoming call, text and booking each deliver one staff-only SMTP envelope while globally paused');
 const replaySource=await merchant('claim-replay'),replayRow=await claim(await alert('merchant_referral:'+replaySource.id));
 const replayMessage={...svc.renderTeamIntakeAlert(replayRow),teamIntakeAlert:{alertId:replayRow.id,attemptToken:replayRow.attempt_token}};
 const beforeReplay=calls.length;
 const attempts=await Promise.all([smtp.sendSmtpEmail(replayMessage),smtp.sendSmtpEmail(replayMessage)]);
 check(attempts.filter(r=>r.success).length===1&&calls.length===beforeReplay+1,'Concurrent reuse of the same SMTP claim dispatches exactly once');
 await pool.query("UPDATE team_intake_alerts SET state='sent',attempt_token=NULL,lease_expires_at=NULL WHERE id=$1",[replayRow.id]);

 const retry=await merchant('retry');mode='unsent';await svc.processTeamIntakeAlerts();let retryRow=await alert('merchant_referral:'+retry.id);
 check(retryRow.state==='pending'&&retryRow.dispatched_at===null&&retryRow.attempt_count===1,'Known-unsent SMTP failure retains a retryable event');
 await pool.query('UPDATE team_intake_alerts SET next_attempt_at=now() WHERE id=$1',[retryRow.id]);mode='sent';await svc.processTeamIntakeAlerts();check((await alert(retryRow.event_key)).state==='sent','Known-unsent event succeeds on a later bounded retry');
 const uncertain=await merchant('uncertain');mode='uncertain';await svc.processTeamIntakeAlerts();const uncertainRow=await alert('merchant_referral:'+uncertain.id);const n=calls.length;
 await svc.processTeamIntakeAlerts();check(uncertainRow.state==='uncertain'&&calls.length===n,'Unknown SMTP outcome is retained and never automatically resent');mode='sent';
 const pre=await merchant('pre-crash'),post=await merchant('post-crash');const preRow=await claim(await alert('merchant_referral:'+pre.id)),postRow=await claim(await alert('merchant_referral:'+post.id));
 await pool.query("UPDATE team_intake_alerts SET lease_expires_at=now()-interval '1 minute',dispatched_at=CASE WHEN id=$1 THEN now() ELSE NULL END WHERE id=ANY($2::uuid[])",[postRow.id,[preRow.id,postRow.id]]);
 await svc.processTeamIntakeAlerts();check((await alert(preRow.event_key)).state==='sent'&&(await alert(postRow.event_key)).state==='uncertain','Crash recovery retries pre-dispatch work and holds post-dispatch ambiguity');
 const exhausted=await merchant('exhausted');let ex=await alert('merchant_referral:'+exhausted.id);await pool.query('UPDATE team_intake_alerts SET attempt_count=4 WHERE id=$1',[ex.id]);mode='unsent';await svc.processTeamIntakeAlerts();check((await alert(ex.event_key)).state==='failed','Retries stop after five known-unsent attempts');
 check((await rows('SELECT * FROM outbound_pause_control'))[0].epoch==='4'||Number((await rows('SELECT * FROM outbound_pause_control'))[0].epoch)===4,'Outbound epoch is unchanged after delivery proofs');
 check(getBlockedCertificationNetworkAttemptCount()===0,'All SMTP was intercepted; zero provider/network attempts');
 console.log(`PASS ${checks} team intake checks`);
}finally{nodemailer.createTransport=originalTransport;await pool.end();}
