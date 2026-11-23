/** Intake follow-up projection. No campaign enrollment, marketing consent, or historical automatic mail. */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { claimInboundRequest, linkInboundRequest, orchestrateInboundRequest } from "./inbound-request-authority";
import { ackContentHash, brandedIntakeEmail, getAckCapability, setAckCapability, ACK_PRESENTATION_VERSION } from "./inbound-acknowledgement";
import { resolveDefaultOwnerEmail } from "./inbound-default-owner";
import { reviewBusinessDayDeadline } from "./inbound-review-policy";
import { enqueueTeamIntakeAlert } from "./team-intake-alerts";
import { getEmailSignatureHtml, getEmailSignaturePlainText, getStoredSignature } from "./email-signatures";

export const INTAKE_ACTIVATION_KEY = "intake_center_automation_enabled_at";
export const intakeKinds = ["forms", "merchants", "applications", "introductions", "referrals", "merchant_referrals"] as const;
export type IntakeKind = typeof intakeKinds[number];
const definitions: Record<IntakeKind,string> = {
 forms: `SELECT id::text,replace(source_type,'_',' ') AS name,(SELECT first_name FROM contacts WHERE contacts.id=inbound_requests.contact_id) AS recipient_name,submitted_email AS email,source_received_at AS received_at,lifecycle_state AS status,id::text AS request_id,contact_id,source_class,source_type FROM inbound_requests WHERE source_class <> 'intake_submission_request'`,
 merchants: `SELECT id::text,coalesce(legal_business_name,'Merchant application') AS name,owner_first_name AS recipient_name,coalesce(nullif(owner_email,''),business_email) AS email,coalesce(submitted_at,created_at) AS received_at,status,submitted_at IS NOT NULL AS submitted,NULL::text AS request_id,contact_id FROM merchant_applications`,
 applications: `SELECT a.id::text,p.contact_name AS name,p.email,a.created_at AS received_at,a.review_status AS status,a.inbound_request_id::text AS request_id,NULL::integer AS contact_id FROM partner_applications a JOIN partners p ON p.id=a.partner_id`,
 introductions: `SELECT i.id::text,p.contact_name AS name,p.email,i.created_at AS received_at,i.review_state AS status,NULL::text AS request_id,NULL::integer AS contact_id FROM partner_introductions i JOIN partners p ON p.id=i.partner_id`,
 referrals: `SELECT r.id::text,p.contact_name AS name,p.email,r.created_at AS received_at,r.status,NULL::text AS request_id,NULL::integer AS contact_id FROM referrals r LEFT JOIN partners p ON p.id=r.partner_id WHERE NOT EXISTS(SELECT 1 FROM partner_introductions i WHERE r.notes='Partner introduction '||i.id::text AND i.partner_id=r.partner_id AND i.contact_id=r.contact_id)`,
 merchant_referrals: `SELECT r.id::text,coalesce(u.first_name,'Merchant referrer') AS name,u.email,r.created_at AS received_at,r.status,NULL::text AS request_id,NULL::integer AS contact_id FROM merchant_referrals r LEFT JOIN merchant_profiles p ON p.id=r.referrer_profile_id LEFT JOIN users u ON u.id=p.user_id`,
};
export type IntakeSource = {id:string;name:string|null;recipient_name?:string|null;source_class?:string;source_type?:string;email:string|null;received_at:Date;status:string;request_id:string|null;contact_id:number|null};
export async function readIntakeSource(kind:IntakeKind,id:string):Promise<IntakeSource|null> {
 if (!(intakeKinds as readonly string[]).includes(kind)) return null;
 if (["forms","applications","introductions"].includes(kind) ? !/^[0-9a-f-]{36}$/i.test(id) : (!/^[1-9]\d{0,9}$/.test(id)||Number(id)>2147483647)) return null;
 return (await pool.query(`SELECT * FROM (${definitions[kind]}) s WHERE id=$1`,[id])).rows[0] ?? null;
}
const staffAlertKinds = {
 forms: "inbound", merchants: "merchant_application", applications: "application",
 introductions: "introduction", referrals: "referral", merchant_referrals: "merchant_referral",
} as const satisfies Record<IntakeKind, string>;

function staffAlertKind(kind: IntakeKind, source: IntakeSource) {
 return kind === "forms" && source.source_type === "appointment_booked" ? "ghl_booking" : staffAlertKinds[kind];
}

/** A bounded triage view with the same role and source boundaries as the record drawer. */
export async function listRecentIntakeTriage(kind: IntakeKind, includePrivacy: boolean) {
 const filter = kind === "forms"
  ? "WHERE source_class <> 'partner_application_request' AND ($3 OR source_class <> 'privacy_request')"
  : kind === "merchants" ? "WHERE submitted" : "";
 const { rows } = await pool.query(`
  WITH recent AS (
   SELECT id, name, status, received_at, request_id FROM (${definitions[kind]}) source
   ${filter} ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 8
  )
  SELECT r.id, r.name, r.status, r.received_at,
    CASE WHEN review.id IS NOT NULL THEN reviewer.email
         ELSE COALESCE(t.canonical_assignee, t.assigned_to, request.assigned_to) END AS owner,
    CASE WHEN review.id IS NOT NULL THEN review.metadata->>'reviewDueAt'
         ELSE COALESCE(request.sla_due_at, t.due_date AT TIME ZONE 'UTC')::text END AS due_at,
    CASE WHEN review.metadata->>'reviewDueAt' IS NOT NULL THEN
           r.status IN ('pending_review', 'needs_info', 'review_required', 'pending', 'processing')
         ELSE COALESCE(t.authority_state IN ('open', 'in_progress')
              AND t.status NOT IN ('completed', 'cancelled', 'canceled'), false) END AS deadline_open,
    ack.state AS receipt_state, a.state AS staff_alert_state
  FROM recent r
  LEFT JOIN intake_operations op ON op.source_kind=$1 AND op.source_id=r.id
  LEFT JOIN inbound_requests request ON request.id=COALESCE(r.request_id::uuid,op.request_id)
  LEFT JOIN inbound_request_work_links w ON w.request_id=request.id AND w.work_type='task'
  LEFT JOIN tasks t ON t.id=COALESCE(op.task_id,w.task_id) AND t.deleted_at IS NULL
  LEFT JOIN LATERAL (
   SELECT id, metadata FROM notifications
   WHERE inbound_request_id=request.id
     AND metadata->>'eventType' IN ('partner_application_received', 'privacy_request_received')
   ORDER BY id LIMIT 1
  ) review ON true
  LEFT JOIN users reviewer ON reviewer.id=review.metadata->>'reviewOwnerUserId'
  LEFT JOIN LATERAL (
   SELECT state FROM inbound_acknowledgements WHERE request_id=request.id
   ORDER BY updated_at DESC, id DESC LIMIT 1
  ) ack ON true
  LEFT JOIN team_intake_alerts a ON a.event_key=(CASE WHEN $1='forms' AND request.source_type='appointment_booked'
    THEN 'ghl_booking' ELSE $2 END) || ':' || r.id
  ORDER BY r.received_at DESC NULLS LAST, r.id DESC
 `, [kind, staffAlertKinds[kind], ...(kind === "forms" ? [includePrivacy] : [])]);
 return rows;
}

export function intakeRecordHref(kind:IntakeKind,id:string) {
 if(kind==='forms')return `/dashboard/intake?tab=forms&ref=${id.replaceAll('-','').slice(0,8)}`;
 return `/dashboard/intake?tab=${kind==='merchant_referrals'?'referrals':kind}${kind==='applications'?'&application='+id:kind==='introductions'?'&introduction='+id:''}`;
}
const stableUuid=(key:string)=>{const h=createHash('sha256').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export async function intakeAutomationStatus() {
 return {backgroundProfile:(await import('./background-profile')).getBackgroundProfile(),enabledAt:await storage.getSystemSetting(INTAKE_ACTIVATION_KEY),capability:await getAckCapability(),heartbeat:await storage.getSystemSetting('intake_center_heartbeat')};
}
export async function enableIntakeAutomation(actor:string) {
 // Preserve the original cutoff on repeat saves. Activation never scans older sources.
 const prior=await storage.getSystemSetting(INTAKE_ACTIVATION_KEY);
 if(!prior)await storage.setSystemSetting(INTAKE_ACTIVATION_KEY,new Date().toISOString());
 const current=await getAckCapability();
 await setAckCapability({enabled:true,sourceClasses:[...new Set([...current.sourceClasses,'sales_request','support_request','fulfillment_request','partner_application_request','privacy_request','intake_submission_request'])],actor});
 await storage.createAuditLog({action:'intake_automation_enabled',entityType:'system_setting',entityId:0,details:{actor,noHistoricalBackfill:true}} as any);
 return intakeAutomationStatus();
}
async function reviewNotification(requestId:string, title:string, link:string) {
 return db.transaction(async tx=>{
  const result:any=await tx.execute(sql`INSERT INTO notifications(channel,title,message,type,inbound_request_id,command_key,metadata)
    VALUES('internal',${title},'Review the submission and record the next step.','alert',${requestId}::uuid,${`inbound:${requestId}:review-notification`},${JSON.stringify({link,audienceRoles:['admin','manager'],eventType:'intake_received'})}::jsonb)
    ON CONFLICT(command_key) WHERE command_key IS NOT NULL DO UPDATE SET command_key=EXCLUDED.command_key RETURNING id`);
  return Number(result.rows[0].id);
 });
}
async function ensureOperations(kind:IntakeKind,source:IntakeSource) {
 await db.execute(sql`INSERT INTO intake_operations(source_kind,source_id) VALUES(${kind},${source.id}) ON CONFLICT DO NOTHING`);
 const link=intakeRecordHref(kind,source.id);
 const alertKind = staffAlertKind(kind, source);
 const title=alertKind === "ghl_booking" ? "Review sales meeting booking" : `Review ${kind==='forms'?'website submission':kind==='merchants'?'merchant application':kind==='applications'?'agent / partner application':'merchant referral'}`;
 let requestId=source.request_id;
 // Each source has exactly one automatic receipt occurrence. Existing forms/applications keep their original owner.
 if(!requestId){
  const claimed=await claimInboundRequest({idempotencyKey:stableUuid(`intake:${kind}:${source.id}`),sourceCategory:'manual_crm',sourceType:kind==='merchants'?'merchant_application':'referral_submission',callerScope:`intake:${kind}:${source.id}`,actorType:'system',payload:{kind,id:source.id},sourceReceivedAt:new Date(source.received_at)});
  if(claimed.outcome!=='claimed'&&claimed.outcome!=='replay')throw Error('INTAKE_OCCURRENCE_CONFLICT');
  requestId=claimed.request.id;
  await linkInboundRequest(requestId,{submittedEmail:source.email});
 }
 const originalTask=(await pool.query(`SELECT task_id FROM inbound_request_work_links WHERE request_id=$1 AND task_id IS NOT NULL LIMIT 1`,[requestId])).rows[0];
 const owner=(await pool.query(`SELECT email FROM users WHERE lower(email)='scott@libertybancard.com' AND account_state='active' AND role IN ('admin','manager')`)).rows;
 const assignedTo = await resolveDefaultOwnerEmail() ?? (owner.length === 1 ? owner[0].email : undefined);
 const dueDate = reviewBusinessDayDeadline(new Date(source.received_at), 2);
 const task=originalTask ? {id:originalTask.task_id} : await storage.createAuthorityTask({title,description:`${link}\nRecord reference: ${source.id}`,assignedTo,dueDate,status:'pending',priority:'normal',source:'intake_center',automationKey:`intake:${kind}:${source.id}`},{producer:'intake_center',commandKey:`intake:${kind}:${source.id}:task`,issueKey:`intake:${kind}:${source.id}`,context:{kind,sourceId:source.id,requestId}});
 let notificationId:number;
 const prior=(await pool.query(`SELECT id FROM notifications WHERE inbound_request_id=$1 ORDER BY id LIMIT 1`,[requestId])).rows[0];
 notificationId=prior?.id ?? await reviewNotification(requestId,title,link);
 if(!source.request_id)await orchestrateInboundRequest({requestId,submittedEmail:source.email,notificationId});
 await db.transaction(async tx=>{
  // Existing application/introduction/referral alerts already have a unique owner; enqueue again safely, never duplicate.
  if (alertKind !== "ghl_booking") await enqueueTeamIntakeAlert(tx,alertKind,source.id);
  await tx.execute(sql`UPDATE intake_operations SET request_id=${requestId}::uuid,task_id=${task.id},notification_id=${notificationId},ready=true,updated_at=now() WHERE source_kind=${kind} AND source_id=${source.id}`);
 });
}
async function repairOpenBookingDeadlines(from: Date) {
 const { rows } = await pool.query<{ id: number; received_at: Date }>(`
  SELECT t.id, r.source_received_at AS received_at
  FROM intake_operations o JOIN inbound_requests r ON r.id=o.request_id
  JOIN tasks t ON t.id=o.task_id
  JOIN team_intake_alerts a ON a.event_key='ghl_booking:' || r.id::text
  WHERE o.source_kind='forms' AND r.source_type='appointment_booked' AND r.source_received_at >= $1
   AND t.producer='intake_center' AND t.authority_state IN ('open','in_progress')
   AND t.deleted_at IS NULL AND t.due_date IS NULL
  ORDER BY r.source_received_at, t.id LIMIT 25
 `, [from]);
 for (const task of rows) {
  const due = reviewBusinessDayDeadline(task.received_at, 2);
  await pool.query(`UPDATE tasks SET due_date=$2::timestamptz AT TIME ZONE 'UTC'
   WHERE id=$1 AND producer='intake_center' AND authority_state IN ('open','in_progress')
    AND deleted_at IS NULL AND due_date IS NULL`, [task.id, due.toISOString()]);
 }
}

/** Bounded idempotent reconciliation: read-only GETs never manufacture work or send mail. */
export async function reconcileIntakeOperations() {
 const raw=await storage.getSystemSetting(INTAKE_ACTIVATION_KEY);
 const from=typeof raw==='string'?new Date(raw):null;
 if(!from||Number.isNaN(from.getTime()))return {enabled:false,processed:0,failed:0};
 let processed=0,failed=0;
 for(const kind of intakeKinds){
  const scope = kind === "merchants" ? "AND s.submitted" : kind === "forms" ? `AND s.source_class <> 'partner_application_request'
   AND (s.source_type <> 'appointment_booked' OR EXISTS (
    SELECT 1 FROM team_intake_alerts a WHERE a.event_key='ghl_booking:' || s.id
   ))` : "";
  const records=(await pool.query(`SELECT s.* FROM (${definitions[kind]}) s
   LEFT JOIN intake_operations o ON o.source_kind=$1 AND o.source_id=s.id
   WHERE s.received_at >= $2 ${scope} AND coalesce(o.ready,false)=false
   ORDER BY o.updated_at NULLS FIRST,s.received_at,s.id LIMIT 25`,[kind,from])).rows;
  for(const source of records)try{await ensureOperations(kind,source);processed++;}catch{failed++;await pool.query(`UPDATE intake_operations SET updated_at=now() WHERE source_kind=$1 AND source_id=$2`,[kind,source.id]);}
 }
 await repairOpenBookingDeadlines(from);
 await storage.setSystemSetting('intake_center_heartbeat',{at:new Date().toISOString(),processed,failed});
 return {enabled:true,processed,failed};
}
export async function readIntakeRecord(kind:IntakeKind,id:string) {
 const source=await readIntakeSource(kind,id);if(!source)return null;
 const operation=(await pool.query(`SELECT source_kind,source_id,request_id,task_id,notification_id,ready,created_at,updated_at FROM intake_operations WHERE source_kind=$1 AND source_id=$2`,[kind,id])).rows[0]??null;
 const requestId=source.request_id??operation?.request_id;
 const tasks=operation?.task_id?(await pool.query(`SELECT id,title,status,due_date,assigned_to FROM tasks WHERE id=$1`,[operation.task_id])).rows:requestId?(await pool.query(`SELECT t.id,t.title,t.status,t.due_date,t.assigned_to FROM tasks t JOIN inbound_request_work_links w ON w.task_id=t.id WHERE w.request_id=$1`,[requestId])).rows:[];
 const receipts=requestId?(await pool.query(`SELECT state,blocked_reason,attempt_count,updated_at,subject,html_body,text_body FROM inbound_acknowledgements WHERE request_id=$1`,[requestId])).rows:[];
 const notifications=requestId?(await pool.query(`SELECT id,title,created_at FROM notifications WHERE inbound_request_id=$1 ORDER BY id DESC LIMIT 20`,[requestId])).rows:operation?.notification_id?(await pool.query(`SELECT id,title,created_at FROM notifications WHERE id=$1`,[operation.notification_id])).rows:[];
 const alerts=(await pool.query(`SELECT state,attempt_count,last_error,created_at,updated_at FROM team_intake_alerts WHERE source_kind=$1 AND source_id=$2`,[staffAlertKind(kind,source),id])).rows;
 const correspondence=(await pool.query(`SELECT r.id,a.state,a.blocked_reason,a.subject,a.html_body,a.text_body,a.updated_at FROM inbound_requests r JOIN inbound_acknowledgements a ON a.request_id=r.id WHERE r.caller_scope=$1 AND r.source_type='intake_followup' ORDER BY r.created_at DESC LIMIT 20`,[`intake:${kind}:${id}`])).rows;
 return {source,operation,tasks,notifications,receipts,alerts,correspondence,href:intakeRecordHref(kind,id),recipientMeaning:['introductions','referrals','merchant_referrals'].includes(kind)?'Referrer who submitted the business':'Applicant / requester',nextSteps:kind==='merchants'?['Review the application and supporting documents.','Use the merchant review controls to request information or record an underwriting decision.']:kind==='applications'?['Review the application, assignment and consent evidence.','Request information or record an application decision using the existing review controls.']:kind==='introductions'?['Check duplicate or competing-referrer evidence.','Record a review decision before contacting the referred business.']:['Assign or complete the follow-up task.','Review the record and send a relevant response when needed.']};
}
export async function previewIntakeCorrespondence(kind:IntakeKind,id:string,subject:string,body:string) {
 const source=await readIntakeSource(kind,id);if(!source||!source.email)return null;
 const sig=await getStoredSignature('support');
 const recipientName=source.recipient_name??(['forms','merchants'].includes(kind)?null:source.name);
 const booking=source.source_class!=='privacy_request';
 const html=brandedIntakeEmail(recipientName?`Hello ${recipientName},`:'Hello,',body,getEmailSignatureHtml('support',sig),booking);
 const text=`${body}${booking?'\n\nSchedule a call: https://libertybancard.com/book':''}\n\n${getEmailSignaturePlainText('support',sig)}`;
 return {to:source.email.trim().toLowerCase(),subject,html,text,hash:ackContentHash({to:source.email,subject,html,text})};
}
export async function queueIntakeCorrespondence(input:{kind:IntakeKind;id:string;subject:string;body:string;previewHash:string;commandKey:string;actor:string}) {
 const cap=await getAckCapability();if(!cap.enabled||!cap.sourceClasses.includes('intake_submission_request'))throw Error('Enable intake receipt delivery before sending correspondence.');
 const preview=await previewIntakeCorrespondence(input.kind,input.id,input.subject,input.body);
 if(!preview||preview.hash!==input.previewHash)throw Error('Recipient or content changed. Preview this email again.');
 const claim=await claimInboundRequest({idempotencyKey:input.commandKey,sourceCategory:'manual_crm',sourceType:'intake_followup',callerScope:`intake:${input.kind}:${input.id}`,actorType:'user',actorId:input.actor,payload:{kind:input.kind,id:input.id,hash:preview.hash,actor:input.actor}});
 if(claim.outcome!=='claimed'&&claim.outcome!=='replay')throw Error('This send command already belongs to different content or another record.');
 const requestId=claim.request.id;
 await linkInboundRequest(requestId,{submittedEmail:preview.to});
 const notificationId=await reviewNotification(requestId,'Intake correspondence queued',intakeRecordHref(input.kind,input.id));
 // Prepare the exact preview before making the effect ready. Replays retain the original prepared content.
 await db.execute(sql`INSERT INTO inbound_acknowledgements(effect_id,request_id,source_class,recipient_email,template_key,presentation_version,subject,html_body,text_body,content_hash,state)
 SELECT e.id,e.request_id,'intake_submission_request',${preview.to},'intake.staff_followup',${ACK_PRESENTATION_VERSION},${preview.subject},${preview.html},${preview.text},${preview.hash},'prepared' FROM inbound_request_effects e WHERE e.request_id=${requestId}::uuid AND e.effect_key='transactional_ack' ON CONFLICT(effect_id) DO NOTHING`);
 await orchestrateInboundRequest({requestId,submittedEmail:preview.to,notificationId});
 await storage.createAuditLog({action:'intake_correspondence_queued',entityType:'inbound_request',entityId:0,details:{requestId,kind:input.kind,sourceId:input.id,actor:input.actor,contentHash:preview.hash}} as any);
 return {requestId,state:'queued',meaning:'Queued for the receipt worker; not proof of delivery.'};
}

/** Explicit staff action for an older record; creates work only, never sends a historical receipt or alert email. */
export async function createIntakeFollowupTask(kind:IntakeKind,id:string) {
 const source=await readIntakeSource(kind,id);if(!source)return null;
 const task=await storage.createAuthorityTask({title:'Review intake submission',description:intakeRecordHref(kind,id),status:'pending',priority:'normal',source:'intake_center',automationKey:`intake:${kind}:${id}`},{producer:'intake_center',commandKey:`intake:${kind}:${id}:task`,issueKey:`intake:${kind}:${id}`,context:{kind,sourceId:id}});
 await db.execute(sql`INSERT INTO intake_operations(source_kind,source_id,task_id) VALUES(${kind},${id},${task.id}) ON CONFLICT(source_kind,source_id) DO UPDATE SET task_id=EXCLUDED.task_id,updated_at=now()`);
 return task;
}

/** A referral projected by an introduction keeps that introduction's receipt/task owner. No second email or task. */
export async function canonicalIntakeIdentity(input:{kind:IntakeKind;id:string}) {
 if(input.kind!=='referrals'||!/^[1-9]\d{0,9}$/.test(input.id)||Number(input.id)>2147483647)return input;
 const linked=(await pool.query(`SELECT i.id::text FROM referrals r JOIN partner_introductions i ON r.notes='Partner introduction '||i.id::text AND i.partner_id=r.partner_id AND i.contact_id=r.contact_id WHERE r.id=$1`,[Number(input.id)])).rows[0];
 return linked?{kind:'introductions' as const,id:linked.id}:input;
}
