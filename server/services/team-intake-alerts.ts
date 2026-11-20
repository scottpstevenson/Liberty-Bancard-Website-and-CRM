import {brandedIntakeEmail} from "./intake-email-layout";
import {sanitizeAuditPayload} from "./audit-sanitizer";
/** Staff-only intake alerts. No customer send, approval, enrollment or historical backfill. */
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '../db';

export const TEAM_INTAKE_RECIPIENT='scott@libertybancard.com';
export const TEAM_INTAKE_MAX_ATTEMPTS=5;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor=Pick<Tx,'execute'>;
export type TeamIntakeSource='application'|'introduction'|'referral'|'merchant_referral'|'inbound'|'merchant_application';
export type TeamIntakeClaim={alertId:string;attemptToken:string};
const rows=(r:any):any[]=>r.rows??r;
const query=async(tx:Executor,q:any)=>rows(await tx.execute(q));
const one=async(tx:Executor,q:any)=>(await query(tx,q))[0];
const clean=(v:unknown,max=200)=>String(v??'').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function source(tx:Executor,kind:TeamIntakeSource,id:string){
 if(['application','introduction','inbound'].includes(kind)?!uuid(id):!(/^[1-9]\d{0,9}$/.test(id)&&Number(id)<=2147483647))return null;
 if(kind==='inbound')return one(tx,sql`SELECT source_type AS company,submitted_email AS email FROM inbound_requests WHERE id=${id}::uuid`);
 if(kind==='merchant_application')return one(tx,sql`SELECT owner_first_name AS name,legal_business_name AS company,owner_email AS email FROM merchant_applications WHERE id=${Number(id)}`);
 if(kind==='application')return one(tx,sql`SELECT a.path,p.contact_name AS name,p.company_name AS company,p.email
   FROM partner_applications a JOIN partners p ON p.id=a.partner_id WHERE a.id=${id}::uuid`);
 if(kind==='introduction')return one(tx,sql`SELECT i.contact_name AS name,i.business_name AS company,i.contact_email AS email,p.company_name AS referrer
   FROM partner_introductions i JOIN partners p ON p.id=i.partner_id WHERE i.id=${id}::uuid`);
 if(kind==='referral')return one(tx,sql`SELECT r.referred_name AS name,r.referred_company AS company,r.referred_email AS email,p.company_name AS referrer,
   EXISTS(SELECT 1 FROM partner_introductions i WHERE r.notes='Partner introduction '||i.id::text AND i.partner_id=r.partner_id AND i.contact_id=r.contact_id) AS introduction_owned
   FROM referrals r LEFT JOIN partners p ON p.id=r.partner_id WHERE r.id=${Number(id)}`);
 if(kind==='merchant_referral')return one(tx,sql`SELECT referred_name AS name,referred_company AS company,referred_email AS email FROM merchant_referrals WHERE id=${Number(id)}`);
 return null;
}

/** Caller must pass the transaction that inserts the source record. Never called by historical recovery scans. */
export async function enqueueTeamIntakeAlert(tx:Executor,kind:TeamIntakeSource,id:string){
 const record=await source(tx,kind,id);
 if(!record)throw Error('TEAM_INTAKE_SOURCE_MISSING');
 if(record.introduction_owned)return; // The introduction already owns the alert, including held/duplicate referrals.
 const eventKind=kind==='inbound'?'website_submission':kind==='merchant_application'?'merchant_application':kind==='application'?(record.path==='sales_agent'?'sales_agent_application':'referral_partner_application'):'merchant_referral';
 if(kind==='application'&&!['sales_agent','referral'].includes(record.path))throw Error('TEAM_INTAKE_APPLICATION_PATH_INVALID');
 const payload={name:clean(record.name),company:clean(record.company),email:clean(record.email,254),referrer:clean(record.referrer)};
 await tx.execute(sql`INSERT INTO team_intake_alerts(event_key,event_kind,source_kind,source_id,recipient,payload)
   VALUES(${kind+':'+id},${eventKind},${kind},${id},${TEAM_INTAKE_RECIPIENT},${JSON.stringify(payload)}::jsonb)
   ON CONFLICT(event_key) DO NOTHING`);
}

export function renderTeamIntakeAlert(row:{event_kind:string;source_kind:string;source_id:string;payload:any}){
 const title=row.source_kind==='inbound'?'New website submission':row.source_kind==='merchant_application'?'New merchant application':row.event_kind==='sales_agent_application'?'New sales-agent application':row.event_kind==='referral_partner_application'?'New referral-partner application':'New merchant referral';
 const tab=row.source_kind==='application'?'applications':row.source_kind==='introduction'?'introductions':'referrals';
 const path=row.source_kind==='inbound'?`/dashboard/intake?tab=forms&ref=${row.source_id.replaceAll('-','').slice(0,8)}`:row.source_kind==='merchant_application'?'/dashboard/intake?tab=merchants':row.source_kind==='merchant_referral'?'/dashboard/intake?tab=referrals':`/dashboard/intake?tab=${tab}${row.source_kind==='application'?'&application='+row.source_id:row.source_kind==='introduction'?'&introduction='+row.source_id:''}`;
 const link=`https://libertybancard.com${path}`;
 const label='Open Intake Center';
 const p=row.payload??{};
 const fields=[['Name',clean(p.name)],['Company',clean(p.company)],['Email',clean(p.email,254)],['Referred by',clean(p.referrer)],['Reference',clean(row.source_id)]];
 const text=[title,'Received for review.',...fields.filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`),`${label}: ${link}`].join('\n');
 const html=brandedIntakeEmail(title,`Received for review.\n\n${fields.filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join('\n')}`,`<p><a href="${escape(link)}">${label}</a></p>`,false);
 return {to:TEAM_INTAKE_RECIPIENT,subject:`Liberty Bancard: ${title}`,html,text,category:'internal_ops' as const};
}

type Message={to:string;subject:string;html:string;text?:string;category?:string;commercialPurpose?:string;contactId?:number;inboundRequestId?:string;seedTest?:unknown;inboundAck?:unknown;phase7Attempt?:unknown};
/** Called by the canonical SMTP pause authority and again at the final dispatch boundary. No caller boolean bypass. */
async function verify(tx:Executor,message:Message,claim:TeamIntakeClaim,mark:boolean){
 if(process.env.NODE_ENV!=='production'&&!(process.env.NODE_ENV==='test'&&(globalThis.fetch as any)[Symbol.for('liberty.certification.fatal-egress-denied')]===true))return {ok:false as const,error:'TEAM_INTAKE_NON_PRODUCTION'};
 if(message.to!==TEAM_INTAKE_RECIPIENT||message.category!=='internal_ops'||message.commercialPurpose||message.contactId||message.inboundRequestId||message.seedTest||message.inboundAck||message.phase7Attempt||process.env.EMAIL_OVERRIDE_TO?.trim())return {ok:false as const,error:'TEAM_INTAKE_PURPOSE_MISMATCH'};
 if(!uuid(claim.alertId)||!uuid(claim.attemptToken))return {ok:false as const,error:'TEAM_INTAKE_CLAIM_INVALID'};
 const row=await one(tx,sql`SELECT * FROM team_intake_alerts WHERE id=${claim.alertId}::uuid AND state='attempting'
   AND attempt_token=${claim.attemptToken}::uuid AND lease_expires_at>clock_timestamp() AND attempt_count BETWEEN 1 AND 5 FOR UPDATE`);
 if(!row||row.recipient!==TEAM_INTAKE_RECIPIENT||row.dispatched_at)return {ok:false as const,error:'TEAM_INTAKE_CLAIM_UNAVAILABLE'};
 const current=await source(tx,row.source_kind,row.source_id);
 if(!current||current.introduction_owned||(row.source_kind==='application'&&(current.path==='sales_agent'?'sales_agent_application':'referral_partner_application')!==row.event_kind))return {ok:false as const,error:'TEAM_INTAKE_SOURCE_UNAVAILABLE'};
 const expected=renderTeamIntakeAlert(row);
 if(message.subject!==expected.subject||message.html!==expected.html||message.text!==expected.text)return {ok:false as const,error:'TEAM_INTAKE_MESSAGE_MISMATCH'};
 if(mark)await tx.execute(sql`UPDATE team_intake_alerts SET dispatched_at=clock_timestamp(),updated_at=now() WHERE id=${claim.alertId}::uuid`);
 return {ok:true as const};
}
export function verifyTeamIntakeAlertCapability(message:Message,claim:TeamIntakeClaim){return db.transaction(tx=>verify(tx,message,claim,false));}
export function markTeamIntakeAlertDispatch(message:Message,claim:TeamIntakeClaim){return db.transaction(tx=>verify(tx,message,claim,true));}

export async function readTeamIntakeAlertStatus(){
 const counts=await query(db,sql`SELECT state,count(*)::integer count FROM team_intake_alerts GROUP BY state ORDER BY state`);
 const {isSmtpConfigured}=await import('./smtp-email');
 return {recipient:TEAM_INTAKE_RECIPIENT,sendWhileOutboundPaused:true,smtpConfigured:isSmtpConfigured(),liveDeliveryEnvironment:process.env.NODE_ENV==='production',counts,
  note:'Staff intake alerts only. Customer/prospect outbound pause is unchanged. Sent means accepted by SMTP, not inbox delivery.'};
}

/** Reused by the existing partner-intake recovery tick. Safe to run concurrently across processes. */
export async function processTeamIntakeAlerts(limit=20){
 const stats={sent:0,waiting:0,uncertain:0,failed:0};
 // Local previews/normal dev workers must never send real staff mail. Tests use a fatal denied provider boundary.
 if(process.env.NODE_ENV!=='production'&&!(process.env.NODE_ENV==='test'&&(globalThis.fetch as any)[Symbol.for('liberty.certification.fatal-egress-denied')]===true))return {...stats,disabledNonProduction:true};
 const {isSmtpConfigured,sendSmtpEmail}=await import('./smtp-email');
 if(!isSmtpConfigured()||process.env.EMAIL_OVERRIDE_TO?.trim())return {...stats,waiting:1};
 await db.execute(sql`UPDATE team_intake_alerts SET state=CASE WHEN dispatched_at IS NOT NULL THEN 'uncertain' WHEN attempt_count>=5 THEN 'failed' ELSE 'pending' END,
   last_error=CASE WHEN dispatched_at IS NOT NULL THEN 'CRASH_AFTER_DISPATCH' WHEN attempt_count>=5 THEN 'ATTEMPTS_EXHAUSTED' ELSE 'CLAIM_EXPIRED_BEFORE_DISPATCH' END,
   attempt_token=NULL,lease_expires_at=NULL,next_attempt_at=now(),updated_at=now() WHERE state='attempting' AND lease_expires_at<=clock_timestamp()`);
 for(let i=0;i<Math.min(100,Math.max(0,limit));i++){
  const token=randomUUID();
  const row=await db.transaction(tx=>one(tx,sql`UPDATE team_intake_alerts SET state='attempting',attempt_token=${token}::uuid,
    lease_expires_at=clock_timestamp()+interval '5 minutes',attempt_count=attempt_count+1,dispatched_at=NULL,updated_at=now()
    WHERE id=(SELECT id FROM team_intake_alerts WHERE state='pending' AND next_attempt_at<=clock_timestamp() AND attempt_count<5 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`));
  if(!row)break;
  const claim={alertId:String(row.id),attemptToken:token};
  let result:Awaited<ReturnType<typeof sendSmtpEmail>>;
  try{result=await sendSmtpEmail({...renderTeamIntakeAlert(row),teamIntakeAlert:claim});}
  catch{result={success:false,outcome:'uncertain',error:'UNEXPECTED_TRANSPORT_FAILURE'};}
  const state=result.success?'sent':result.outcome==='uncertain'?'uncertain':Number(row.attempt_count)>=5?'failed':'pending';
  // Never retain raw SMTP error strings (which may contain addresses/content). The typed outcome drives retry safety.
  const reason=result.success?null:result.outcome==='uncertain'?'TRANSPORT_OUTCOME_UNKNOWN':state==='failed'?'ATTEMPTS_EXHAUSTED':'DELIVERY_UNAVAILABLE';
  await db.transaction(async tx=>{
   const updated=await one(tx,sql`UPDATE team_intake_alerts SET state=${state},attempt_token=NULL,lease_expires_at=NULL,
     dispatched_at=CASE WHEN ${state}='pending' THEN NULL ELSE dispatched_at END,next_attempt_at=clock_timestamp()+${Math.min(3600,60*2**(Number(row.attempt_count)-1))}*interval '1 second',
     provider_message_id=${result.success?clean(result.messageId,255):null},last_error=${reason},updated_at=now()
     WHERE id=${row.id}::uuid AND state='attempting' AND attempt_token=${token}::uuid RETURNING id`);
   if(!updated)throw Error('TEAM_INTAKE_SETTLEMENT_FENCE_LOST');
   await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,details) VALUES('team_intake_alert_delivery','team_intake_alert',${String(row.id)},'system',
     ${JSON.stringify(sanitizeAuditPayload({state,attempt:Number(row.attempt_count),reason,recipient:TEAM_INTAKE_RECIPIENT}))}::jsonb)`);
  });
  if(state==='sent')stats.sent++;else if(state==='uncertain')stats.uncertain++;else if(state==='failed')stats.failed++;else stats.waiting++;
 }
 return stats;
}
