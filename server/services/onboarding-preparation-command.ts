import { createHash } from "node:crypto";
import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { auditLogs, contacts, deals, tasks, users, onboardingChecklistItems, ONBOARDING_CHECKLIST_ITEM_KEYS } from "@shared/schema";
import type { OnboardingPreparationFields, OnboardingPreparationStatus } from "@shared/onboarding-preparation";
import { db } from "../db";
import { storage } from "../storage";
import { canAccessOwner } from "./crm-object-access";
import { CLOSED_WON_SLA_TASKS } from "./deal-stage-service";
import { resolveWorkAssignee, workPrincipalFields, WorkCommandError, type WorkActor } from "./work-item-command";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Plan = { commandId: string; selectedDealId: number; sourceDealId: number; contactId: number;
  onboardingDealId: number; owner: string|null; baseDate: string; sourceVersion: string; payloadHash: string;
  planning:{targetGoLiveDate:string;terminalNeeded:string;underwritingDocs:string[]} };
const key = (id:string) => `onboarding-local-prepare:${id}`;
const acceptedAction = "onboarding_local_prepare_accepted";
const stepAction = "onboarding_local_step_recorded";
const missing = () => new WorkCommandError("Selected onboarding relationship unavailable",404);

/** B principal lock ordering, existing A object policy, and locked exact IDs.
 * This command has no provider, welcome, enrollment or activation seam. */
async function authorize(tx:Tx,actor:WorkActor,selectedId:number) {
  const principals = await tx.select(workPrincipalFields).from(users).where(sql`
    ${users.id}=${actor.id} OR lower(${users.email}) IN (
      SELECT lower(owner) FROM deals WHERE id=${selectedId}
      OR id=(SELECT sales_deal_id FROM deals WHERE id=${selectedId})
    )`).orderBy(asc(users.id)).for("share");
  const principal=principals.find(p=>p.id===actor.id);
  if(!principal || principal.accountState!=="active" || principal.authEpoch!==actor.authEpoch ||
    principal.accountVersion!==actor.accountVersion || !["admin","manager","agent"].includes(principal.role ?? "")) throw missing();
  const read = async(id:number)=>{
    const [row]=await tx.select({...getTableColumns(deals),version:sql<string>`${deals.updatedAt}::text`})
      .from(deals).where(and(eq(deals.id,id),eq(deals.recordClass,"production"),isNull(deals.archivedAt))).for("share");
    if(!row || !canAccessOwner({role:principal.role ?? undefined,email:principal.email},row.owner,false))throw missing();
    return row;
  };
  const selected=await read(selectedId);
  const source=selected.pipeline==="sales" ? selected :
    selected.pipeline==="onboarding" && selected.salesDealId ? await read(selected.salesDealId) : null;
  if(!source || source.pipeline!=="sales" || source.stage!=="Closed Won" || !source.contactId)
    throw new WorkCommandError("Local preparation requires a Closed Won Sales deal or its explicitly linked Onboarding deal.",409);
  const [contact]=await tx.select().from(contacts).where(and(eq(contacts.id,source.contactId),
    eq(contacts.recordClass,"production"),isNull(contacts.archivedAt))).for("share");
  if(!contact || !canAccessOwner({role:principal.role ?? undefined,email:principal.email},contact.assignedTo,false) || selected.contactId!==contact.id)throw missing();
  const owner=source.owner ? (await resolveWorkAssignee(source.owner,tx,principals)).email : null;
  return {selected,source,contact,owner,principal:{...principal,role:principal.role ?? undefined}};
}

async function accepted(tx:Tx,id:string,actor:WorkActor):Promise<Plan|undefined> {
  const [row]=await tx.select().from(auditLogs).where(and(eq(auditLogs.entityKey,key(id)),eq(auditLogs.action,acceptedAction)));
  if(row && row.userId!==actor.id)throw missing();
  return row?.details as Plan|undefined;
}
async function lock(tx:Tx,id:string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key(id)},0))`);
}
async function validatePlan(tx:Tx,plan:Plan,actor:WorkActor) {
  const auth=await authorize(tx,actor,plan.selectedDealId);
  if(auth.source.id!==plan.sourceDealId || auth.source.contactId!==plan.contactId ||
    auth.source.version!==plan.sourceVersion)throw new WorkCommandError("Source changed after acceptance. Retained preparation requires review; no step was reset.",409);
  const [target]=await tx.select().from(deals).where(and(eq(deals.id,plan.onboardingDealId),
    eq(deals.salesDealId,plan.sourceDealId),eq(deals.contactId,plan.contactId),eq(deals.pipeline,"onboarding"),
    eq(deals.recordClass,"production"),isNull(deals.archivedAt))).for("share");
  if(!target || !canAccessOwner(auth.principal,target.owner,false))
    throw missing();
  if(target.owner!==auth.source.owner)throw new WorkCommandError("Linked handoff owner changed. Review assignment before unfinished preparation.",409);
  return target;
}
async function status(tx:Tx,plan:Plan):Promise<OnboardingPreparationStatus> {
  const receipts=await tx.select().from(auditLogs).where(and(eq(auditLogs.entityKey,key(plan.commandId)),eq(auditLogs.action,stepAction)));
  const steps:OnboardingPreparationStatus["steps"]=await Promise.all(CLOSED_WON_SLA_TASKS.map(async step=>{
    const receipt=receipts.find(r=>(r.details as any)?.key===step.title);
    const taskId=(receipt?.details as any)?.taskId as number|undefined;
    const [task]=taskId ? await tx.select().from(tasks).where(eq(tasks.id,taskId)) : [];
    const unavailable=!!receipt && (!task || !!task.deletedAt || task.dealId!==plan.onboardingDealId || task.contactId!==plan.contactId);
    return {key:step.title,accepted:!!receipt,taskId,unavailable};
  }));
  const checklist=receipts.find(r=>(r.details as any)?.key==="checklist");
  const checklistIds=(checklist?.details as any)?.checklistIds as number[]|undefined;
  const items=await tx.select().from(onboardingChecklistItems).where(eq(onboardingChecklistItems.dealId,plan.onboardingDealId));
  steps.unshift({key:"checklist",accepted:!!checklist,checklistIds,
    unavailable:!!checklist && (!checklistIds || checklistIds.length!==ONBOARDING_CHECKLIST_ITEM_KEYS.length ||
      checklistIds.some(id=>!items.some(item=>item.id===id)))});
  return {commandId:plan.commandId,selectedDealId:plan.selectedDealId,sourceDealId:plan.sourceDealId,
    contactId:plan.contactId,onboardingDealId:plan.onboardingDealId,
    targetGoLiveDate:plan.planning.targetGoLiveDate,
    state:steps.every(s=>s.accepted && !s.unavailable) ? "prepared":"partial",steps,
    nativeOutcome:"not_requested",notificationOutcome:"not_requested"};
}

export async function readOnboardingPreparation(actor:WorkActor,selectedId:number,commandId?:string) {
  return db.transaction(async tx=>{
    const auth=await authorize(tx,actor,selectedId);
    if(commandId){
      const plan=await accepted(tx,commandId,actor);
      if(!plan)return {accepted:false as const,commandId,command:null};
      if(plan.selectedDealId!==selectedId)throw missing();
      await validatePlan(tx,plan,actor);
      return {command:await status(tx,plan)};
    }
    const [link]=await tx.select().from(deals).where(and(eq(deals.salesDealId,auth.source.id),
      eq(deals.pipeline,"onboarding")));
    if(link && (link.archivedAt || link.recordClass!=="production" || link.contactId!==auth.contact.id ||
      !canAccessOwner(auth.principal,link.owner,false)))throw missing();
    const [latest]=await tx.select().from(auditLogs).where(and(eq(auditLogs.entityId,selectedId),
      eq(auditLogs.userId,actor.id),eq(auditLogs.action,acceptedAction))).orderBy(sql`${auditLogs.id} DESC`).limit(1);
    if(latest)await validatePlan(tx,latest.details as Plan,actor);
    return {sourceDealId:auth.source.id,selectedDealId:selectedId,contactId:auth.contact.id,
      expectedSourceVersion:auth.source.version,onboardingDealId:link?.id ?? null,
      latestCommand:latest ? await status(tx,latest.details as Plan) : null,
      policy:"closed_won_linked_local_preparation_only"};
  });
}

/** Acceptance+deal commit precedes resumable task commits. Every step rechecks
 * principal/source/object authority; faults leave durable exact accepted IDs.
 * Audit rows here are a local intent ledger (IDs/digest/plan, not raw notes). */
export async function prepareOnboarding(input:{actor:WorkActor;selectedId:number;commandId:string;
  fields?:OnboardingPreparationFields},afterStep?:(step:string)=>Promise<void>) {
  const hash=input.fields ? createHash("sha256").update(JSON.stringify(input.fields)).digest("hex") : undefined;
  const plan=await db.transaction(async tx=>{
    await lock(tx,input.commandId);
    // Serialize manual intents BEFORE graph locks, not SHARE→UPDATE upgrades:
    // concurrent different UUIDs must not deadlock on the same Sales record.
    const [peek]=await tx.select({id:deals.id,pipeline:deals.pipeline,salesDealId:deals.salesDealId})
      .from(deals).where(eq(deals.id,input.selectedId));
    if(!peek)throw missing();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`onboarding-source:${peek.pipeline==="sales" ? peek.id:peek.salesDealId}`},0))`);
    const auth=await authorize(tx,input.actor,input.selectedId);
    const prior=await accepted(tx,input.commandId,input.actor);
    if(prior){
      if(prior.selectedDealId!==input.selectedId || (hash && hash!==prior.payloadHash))
        throw new WorkCommandError("This preparation intent has different captured input. Read the retained command.",409);
      await validatePlan(tx,prior,input.actor);return prior;
    }
    if(!input.fields)throw missing();
    if(auth.source.version!==input.fields.expectedSourceVersion || auth.contact.id!==input.fields.contactId)
      throw new WorkCommandError("Selected source or contact changed. Reload before preparing.",409);
    const links=await tx.select().from(deals).where(and(eq(deals.salesDealId,auth.source.id),eq(deals.pipeline,"onboarding")));
    if(links.length>1 || links.some(d=>d.archivedAt || d.contactId!==auth.contact.id || d.recordClass!=="production"))
      throw new WorkCommandError("Existing handoff is archived or inconsistent. No replacement was created.",409);
    if(!links.length){
      const legacy=await tx.select({id:deals.id}).from(deals).where(and(eq(deals.contactId,auth.contact.id),
        eq(deals.pipeline,"onboarding"),isNull(deals.salesDealId),isNull(deals.archivedAt)));
      if(legacy.length)throw new WorkCommandError("Unlinked legacy Onboarding requires relationship review; no parallel deal was created.",409);
    }
    let target=links[0];
    if(!target){
      // Existing B writer/audit, same transaction: no stage-transition effects.
      const [winner]=await tx.select().from(deals).where(and(eq(deals.salesDealId,auth.source.id),eq(deals.pipeline,"onboarding")));
      target=winner ?? await storage.createDeal({contactId:auth.contact.id,pipeline:"onboarding",
        stage:"Application Submitted",salesDealId:auth.source.id,owner:auth.source.owner,
        offerPath:auth.source.offerPath,leadSource:"closed_won",
        fundingNotes:input.fields.fundingNotes,notes:`Local preparation linked to Sales deal #${auth.source.id}; no native effects requested.`},
        {userId:input.actor.id,actorType:"user"},tx);
    }
    if(target.contactId!==auth.contact.id || target.archivedAt || target.recordClass!=="production")throw missing();
    if(!canAccessOwner(auth.principal,target.owner,false))throw missing();
    if(target.owner!==auth.source.owner)throw new WorkCommandError("Existing handoff assignment differs from Sales. Review before preparation.",409);
    if(["Live (First Batch)","Active (7 Days)","Active (30 Days)"].includes(target.stage))
      throw new WorkCommandError("Live handoff is not eligible for a new preparation intent.",409);
    if(!auth.source.updatedAt || !auth.source.version)throw new WorkCommandError("Source version unavailable. No intent accepted.",409);
    const frozen:Plan={commandId:input.commandId,selectedDealId:input.selectedId,sourceDealId:auth.source.id,
      contactId:auth.contact.id,onboardingDealId:target.id,owner:auth.owner,baseDate:auth.source.updatedAt!.toISOString(),
      sourceVersion:auth.source.version,payloadHash:hash!,planning:{targetGoLiveDate:input.fields.goLiveDate,
        terminalNeeded:input.fields.terminalNeeded,underwritingDocs:input.fields.underwritingDocs}};
    await tx.insert(auditLogs).values({userId:input.actor.id,entityType:"deal",entityId:input.selectedId,
      entityKey:key(input.commandId),action:acceptedAction,details:frozen,actorType:"user"});
    return frozen;
  });
  await afterStep?.("deal");
  await db.transaction(async tx=>{
    await lock(tx,input.commandId);
    const target=await validatePlan(tx,plan,input.actor);
    const [receipt]=await tx.select().from(auditLogs).where(and(eq(auditLogs.entityKey,key(plan.commandId)),
      eq(auditLogs.action,stepAction),sql`${auditLogs.details}->>'key'='checklist'`));
    if(receipt)return;
    if(["Live (First Batch)","Active (7 Days)","Active (30 Days)"].includes(target.stage))
      throw new WorkCommandError("Live handoff cannot initialize unfinished preparation.",409);
    await storage.initializeOnboardingChecklist(target.id,tx);
    const items=await tx.select().from(onboardingChecklistItems).where(eq(onboardingChecklistItems.dealId,target.id));
    if(items.length!==ONBOARDING_CHECKLIST_ITEM_KEYS.length)throw new WorkCommandError("Checklist identity incomplete or ambiguous.",409);
    await tx.insert(auditLogs).values({userId:input.actor.id,entityType:"deal",entityId:target.id,
      entityKey:key(plan.commandId),action:stepAction,details:{key:"checklist",checklistIds:items.map(i=>i.id)},actorType:"user"});
  });
  await afterStep?.("checklist");
  for(const step of CLOSED_WON_SLA_TASKS){
    await db.transaction(async tx=>{
      await lock(tx,input.commandId);
      const target=await validatePlan(tx,plan,input.actor);
      const [receipt]=await tx.select().from(auditLogs).where(and(eq(auditLogs.entityKey,key(plan.commandId)),
        eq(auditLogs.action,stepAction),sql`${auditLogs.details}->>'key'=${step.title}`));
      if(receipt)return;
      if(["Live (First Batch)","Active (7 Days)","Active (30 Days)"].includes(target.stage))
        throw new WorkCommandError("Live handoff is not eligible for unfinished preparation. No task was reopened.",409);
      const existing=await tx.select().from(tasks).where(and(eq(tasks.dealId,target.id),eq(tasks.title,step.title))).for("share");
      if(existing.length>1 || existing.some(t=>t.deletedAt || t.contactId!==plan.contactId))
        throw new WorkCommandError("Retained task identity is deleted or ambiguous. No replacement task was created.",409);
      const task=existing[0] ?? await storage.createAuthorityTask({title:step.title,priority:step.priority,
        dueDate:new Date(new Date(plan.baseDate).getTime()+step.dueDays*86400000),
        dealId:target.id,contactId:plan.contactId,assignedTo:plan.owner},
        {actorId:input.actor.id,producer:"automatic",issueKey:step.title.toLowerCase(),
          subjectType:"deal",subjectId:target.id,context:{sourceDealId:plan.sourceDealId,preparationCommandId:plan.commandId}},tx);
      await tx.insert(auditLogs).values({userId:input.actor.id,entityType:"deal",entityId:target.id,
        entityKey:key(plan.commandId),action:stepAction,details:{key:step.title,taskId:task.id},actorType:"user"});
    });
    await afterStep?.(step.title);
  }
  return readOnboardingPreparation(input.actor,input.selectedId,input.commandId);
}
