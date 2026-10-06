import {createHash} from "node:crypto";
import {and,asc,eq,isNull,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "../db";
import {users,contacts,deals,inboxItems,inboxActionReceipts,notifications} from "@shared/schema";
import {parseInboxSourceIdentity} from "../storage/inbox";
import {resolveWorkAssignee,workPrincipalFields,WorkCommandError,type WorkActor} from "./work-item-command";
import {auditChange} from "./audit-change";

export const inboxWorkFields=z.object({
  commandId:z.string().uuid(),expectedVersion:z.number().int().positive(),
  expectedActorId:z.string().min(1).max(190),
  expectedAccountVersion:z.number().int().positive().optional(),
  ownerId:z.string().min(1).max(190).nullable().optional(),
  ownerName:z.string().max(190).optional(), // Legacy display-only input, never identity.
  contactId:z.number().int().positive().optional(),dealId:z.number().int().positive().nullable().optional(),
  department:z.enum(["sales","support","onboarding","accounts"]).optional(),
  status:z.enum(["new","in_progress","waiting","resolved","escalated"]).optional(),
  priority:z.enum(["low","normal","high","urgent"]).optional(),
  nextAction:z.string().max(500).nullable().optional(),notes:z.string().max(20000).nullable().optional(),
  intent:z.string().max(2000).optional(),reason:z.string().max(4000).optional(),
}).strict();
type Fields=z.infer<typeof inboxWorkFields>;
const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value && typeof value==="object"
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=(value:any)=>createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const unavailable=()=>new WorkCommandError("Inbox context unavailable. Reload authorized work.",404);
/** Local work only: no booking, invitation, provider, AI, native or send call. */
export async function commandInboxWork(input:{
  actor:WorkActor;sourceKey:string;operation:"edit"|"escalate"|"book"|"no_show";fields:Fields;
}) {
  return db.transaction(async tx=>{
    const [observed]=await tx.select(workPrincipalFields).from(users).where(eq(users.id,input.actor.id));
    if(!observed || observed.accountState!=="active" || observed.authEpoch!==input.actor.authEpoch ||
      !["admin","manager","agent"].includes(observed.role ?? "")) throw unavailable();
    const identity=parseInboxSourceIdentity(input.sourceKey);
    const sourcePredicate=and(eq(inboxItems.sourceItemId,identity.sourceItemId),
      sql`COALESCE(${inboxItems.sourceNamespace},'legacy')=${identity.sourceNamespace}`);
    // Only access metadata before the actual contact policy; no source body/notes.
    const [metadata]=await tx.select({id:inboxItems.id,contactId:inboxItems.contactId,ownerId:inboxItems.ownerId})
      .from(inboxItems).where(sourcePredicate);
    if(!metadata?.contactId) throw unavailable();
    const [visible]=await tx.select({id:contacts.id}).from(contacts).where(and(
      eq(contacts.id,metadata.contactId),isNull(contacts.archivedAt),eq(contacts.recordClass,"production"),
      observed.role==="agent"?eq(contacts.assignedTo,observed.email ?? ""):undefined));
    if(!visible) throw unavailable();
    const target=input.fields.ownerId===undefined
      ? input.operation==="escalate" ? null : input.operation==="book" ? observed.id : metadata.ownerId
      : input.fields.ownerId;
    const principalIds=[...new Set([observed.id,target].filter((id):id is string=>!!id))];
    const principals=await tx.select(workPrincipalFields).from(users).where(
      sql`${users.id} IN (${sql.join(principalIds.map(id=>sql`${id}`),sql`,`)})
        OR lower(${users.email}) IN (${sql.join(principalIds.map(id=>sql`${id.toLowerCase()}`),sql`,`)})`)
      .orderBy(asc(users.id)).for("share");
    const actor=principals.find(user=>user.id===input.actor.id);
    if(!actor || actor.accountState!=="active" || actor.authEpoch!==input.actor.authEpoch ||
      (input.actor.accountVersion!==undefined && actor.accountVersion!==input.actor.accountVersion) ||
      !["admin","manager","agent"].includes(actor.role ?? "")) throw unavailable();
    let recipient:typeof principals[number]|null=null;
    if(target) {
      try {
        recipient=await resolveWorkAssignee(target,tx,principals);
        if(recipient.role==="agent") recipient=await resolveWorkAssignee(target,tx,principals,true);
      }
      catch(error) {
        recipient=null;
        if(!(error instanceof WorkCommandError) || input.fields.ownerId!==undefined) throw error;
      }
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox-work:${actor.id}:${input.fields.commandId}`},0))`);
    const [contact]=await tx.select().from(contacts).where(and(eq(contacts.id,metadata.contactId),
      isNull(contacts.archivedAt),eq(contacts.recordClass,"production"),
      actor.role==="agent"?eq(contacts.assignedTo,actor.email ?? ""):undefined)).for("share");
    if(!contact) throw unavailable();
    const [before]=await tx.select().from(inboxItems).where(eq(inboxItems.id,metadata.id)).for("update");
    if(!before || before.contactId!==contact.id || (input.fields.contactId!==undefined && input.fields.contactId!==contact.id)) throw unavailable();
    const dealId=input.fields.dealId===undefined?before.dealId:input.fields.dealId;
    const [deal]=dealId ? await tx.select().from(deals).where(and(eq(deals.id,dealId),
      eq(deals.contactId,contact.id),isNull(deals.archivedAt),eq(deals.recordClass,"production"),
      actor.role==="agent"?eq(deals.owner,actor.email ?? ""):undefined)).for("share"):[];
    if(dealId && !deal) throw unavailable();
    if(recipient?.role==="agent" && (contact.assignedTo!==recipient.email || (deal && deal.owner!==recipient.email))) {
      if(input.fields.ownerId!==undefined) throw new WorkCommandError("Selected rep does not own the linked records. Use the approved ownership handoff; nothing was reassigned.",409);
      recipient=null;
    }
    const payloadHash=hash(input);
    const [prior]=await tx.select().from(inboxActionReceipts).where(and(
      eq(inboxActionReceipts.actorId,actor.id),eq(inboxActionReceipts.commandId,input.fields.commandId)));
    if(prior) {
      if(prior.payloadHash!==payloadHash || prior.itemId!==before.id) throw new WorkCommandError("Inbox retry differs from the retained intent.",409);
      return {...prior.result as any,replayed:true};
    }
    if(before.version!==input.fields.expectedVersion) throw new WorkCommandError("Inbox work changed. Reload before saving; no work was changed.",409);
    const department=input.fields.department ?? before.department ?? "sales";
    const changes:any={ownerId:recipient?.id ?? null,ownerName:recipient?.email ?? null,department,dealId};
    for(const key of ["status","priority","nextAction","notes"] as const) if(input.fields[key]!==undefined) changes[key]=input.fields[key];
    if(input.operation==="escalate") Object.assign(changes,{status:"escalated",priority:"urgent",
      nextAction:recipient?"management_review":"unassigned_management_review",escalationPath:input.fields.reason ?? "Manual escalation"});
    if(input.operation==="no_show") Object.assign(changes,{status:"waiting",nextAction:"prepare_reschedule"});
    const changed=input.operation!=="edit" || Object.entries(changes).some(([key,value])=>value!==((before as any)[key]));
    const [item]=changed ? await tx.update(inboxItems).set({...changes,version:before.version+1,updatedAt:new Date()})
      .where(eq(inboxItems.id,before.id)).returning():[before];
    let taskId:number|null=null;
    const bookingUrl=process.env.GHL_CALENDAR_ID
      ? `https://api.leadconnectorhq.com/widget/booking/${encodeURIComponent(process.env.GHL_CALENDAR_ID)}`:null;
    if(input.operation!=="edit") {
      const {storage}=await import("../storage");
      const task=await storage.createAuthorityTask({
        contactId:contact.id,dealId:deal?.id,assignedTo:recipient?.email ?? undefined,
        title:input.operation==="escalate"?"Inbox management review":input.operation==="book"?"Prepare appointment":"Prepare appointment reschedule",
        description:`Inbox ${input.sourceKey}. ${!recipient?"Management assignment review: current assignee unavailable. ":""}No booking or message was sent.`,
        status:"pending",priority:"high",source:"ai_inbox",
        dueDate:new Date(Date.now()+(input.operation==="book"?24:input.operation==="no_show"?4:2)*3600000),
        automationKey:`inbox-work:${actor.id}:${input.fields.commandId}`,
      },{producer:"inbox_work",actorId:actor.id,commandKey:`inbox-work:${actor.id}:${input.fields.commandId}`,
        issueKey:`inbox-work:${actor.id}:${input.fields.commandId}`,context:{sourceKey:input.sourceKey,payloadHash}},tx);
      taskId=task.id;
      await tx.insert(notifications).values({channel:"internal",recipientId:recipient?.id ?? null,
        type:"info",title:"Inbox work prepared",message:"Local review work was prepared. No booking or message was sent.",
        metadata:{taskId,contactId:contact.id,eventType:"task_assigned",audienceRoles:recipient?undefined:["admin","manager"]}});
    }
    const result={ok:true,item,taskId,taskCreated:taskId!==null,changed,replayed:false,
      assignmentState:recipient?"assigned":"management_review_required",
      bookingUrl:input.operation==="book"?bookingUrl:null,hasCalendar:!!bookingUrl,
      bookingState:input.operation==="book"?(bookingUrl?"link_prepared":"not_configured"):"not_requested",
      delivered:false};
    await auditChange({actorType:"user",userId:actor.id,action:`inbox_${input.operation}_commanded`,
      entityType:"inbox_item",entityId:before.id,before,after:item,details:{commandId:input.fields.commandId,taskId,changed,delivered:false}},tx);
    await tx.insert(inboxActionReceipts).values({itemId:before.id,actorId:actor.id,
      commandId:input.fields.commandId,payloadHash,result});
    return result;
  });
}
