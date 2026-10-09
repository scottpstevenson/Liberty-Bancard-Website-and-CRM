/** B-owned RFI command consumer. Composes the existing B actor, assignment,
 * relationship and audit contracts; no provider/native transport exists here. */
import {createHash} from "node:crypto";
import {and,asc,eq,sql} from "drizzle-orm";
import {db} from "../db";
import {users,rfis,rfiCommandReceipts,notifications,reviewQueue} from "@shared/schema";
import {type RfiWorkCommand} from "@shared/rfi-work-command";
import {type WorkActor,WorkCommandError,workPrincipalFields,resolveWorkAssignee,validateLinks} from "./work-item-command";
import {auditChange} from "./audit-change";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)??"undefined").digest("hex");
const unavailable=()=>new WorkCommandError("RFI context unavailable",404);
const auditFacts=(row:typeof rfis.$inferSelect)=>({
  id:row.id,status:row.status,assignedTo:row.assignedTo,authorityFence:row.authorityFence,
  contactId:row.contactId,dealId:row.dealId,
});
export async function commandRfi(actor:WorkActor,operation:"create"|"edit",input:RfiWorkCommand,id?:number){
  const {commandId,expectedActorId,expectedAccountVersion,expectedFence,...fields}=input;
  const payloadHash=hash({operation,id:id??null,input});
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rfi-command:${actor.id}:${commandId}`},0))`);
    const assignee=fields.assignedTo;
    const principals=await tx.select(workPrincipalFields).from(users).where(sql`
      ${users.id}=${actor.id} OR ${users.id}=${assignee??""}
      OR lower(${users.email})=lower(${assignee??""})`).orderBy(asc(users.id)).for("share");
    const principal=principals.find(row=>row.id===actor.id);
    if(!principal||principal.accountState!=="active"||principal.authEpoch!==actor.authEpoch||
      principal.accountVersion!==actor.accountVersion||principal.id!==expectedActorId||
      principal.accountVersion!==expectedAccountVersion||
      !["admin","manager","agent"].includes(principal.role??""))throw unavailable();
    const [receipt]=await tx.select().from(rfiCommandReceipts).where(and(
      eq(rfiCommandReceipts.actorId,actor.id),eq(rfiCommandReceipts.commandId,commandId)));
    const target=operation==="edit"?id:receipt?.rfiId;
    const [before]=target?await tx.select().from(rfis).where(eq(rfis.id,target)).for("update"):[];
    if(target&&!before)throw unavailable();
    if(before){
      await validateLinks(tx,before,principal,"production");
      if(principal.role==="agent"&&!before.contactId)throw unavailable();
    }
    const prospective={...before,...fields};
    const links=await validateLinks(tx,prospective,principal,"production");
    if(principal.role==="agent"&&!prospective.contactId)throw unavailable();
    if(receipt){
      if(receipt.operation!==operation||receipt.payloadHash!==payloadHash||receipt.rfiId!==before?.id)
        throw new WorkCommandError("RFI retry differs from the retained intent. No RFI changed.",409);
      return {...receipt.result as any,replayed:true};
    }
    if(operation==="edit"&&(!before||expectedFence===undefined||before.authorityFence!==expectedFence))
      throw new WorkCommandError("RFI changed. Reload before a new edit; your captured intent was not applied.",409);
    if(operation==="create"&&!fields.subject)throw new WorkCommandError("A nonblank RFI subject is required",409);
    if(assignee){
      fields.assignedTo=(await resolveWorkAssignee(assignee,tx,principals)).email;
      if((links.contact&&links.contact.assignedTo!==fields.assignedTo)||
        (links.dealOwner!==undefined&&links.dealOwner!==fields.assignedTo))
        throw new WorkCommandError("Assignee does not own the linked record. Use the approved ownership handoff first.",409);
    }
    const responseFields=fields.response===undefined?{}:{respondedAt:fields.response?new Date():null};
    const changed=operation==="create"||Object.entries(fields).some(([key,value])=>hash(value)!==hash((before as any)[key]));
    let rfi:typeof rfis.$inferSelect;
    if(operation==="create"){
      [rfi]=await tx.insert(rfis).values({...fields,subject:fields.subject!,...responseFields}).returning();
    }else{
      [rfi]=changed?await tx.update(rfis).set({...fields,...responseFields,
        authorityFence:before!.authorityFence+1,updatedAt:new Date()}).where(eq(rfis.id,before!.id)).returning():[before!];
    }
    if(changed){
      await auditChange({userId:actor.id,actorType:"user",
        action:operation==="create"?"rfi_created":before?.status!==rfi.status?"rfi_status_changed":"rfi_updated",
        entityType:"rfi",entityId:rfi.id,
        before:before?auditFacts(before):null,after:auditFacts(rfi),details:{commandId,nativeDelivery:"not_attempted"}},tx);
      if(operation==="create"){
        await tx.insert(reviewQueue).values({sourceType:"rfi",sourceId:rfi.id,status:"pending",checklistState:{},
          metadata:{subject:rfi.subject,category:rfi.category,priority:rfi.priority,description:rfi.description,
            requestedBy:rfi.requestedBy,assignedTo:rfi.assignedTo,source:"rfi",contactId:rfi.contactId,dealId:rfi.dealId}});
        await tx.insert(notifications).values({channel:"internal",title:`New RFI: ${rfi.subject}`,
          message:`Local RFI recorded; native delivery not attempted.`,type:rfi.priority==="Urgent"?"urgent":"info",
          metadata:{rfiId:rfi.id,contactId:rfi.contactId,dealId:rfi.dealId,entityType:"rfi",entityId:rfi.id}});
      }else if(fields.response&&!before?.response){
        await tx.insert(notifications).values({channel:"internal",title:`RFI response recorded: ${rfi.subject}`,
          message:"Local response recorded; no provider delivery is established.",type:"info",
          metadata:{rfiId:rfi.id,contactId:rfi.contactId,dealId:rfi.dealId,entityType:"rfi",entityId:rfi.id}});
      }
    }
    const result={rfi,changed,replayed:false,nativeDelivery:"not_attempted" as const};
    await tx.insert(rfiCommandReceipts).values({actorId:actor.id,commandId,rfiId:rfi.id,operation,payloadHash,result});
    return result;
  });
}
