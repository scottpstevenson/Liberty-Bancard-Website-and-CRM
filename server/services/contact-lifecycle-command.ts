import {createHash} from "node:crypto";
import {and,asc,eq,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "../db";
import {contacts,users,contactLifecycleReceipts} from "@shared/schema";
import {workPrincipalFields,WorkCommandError,type WorkActor} from "./work-item-command";
import {auditChange} from "./audit-change";
export const contactLifecycleFields=z.object({
  commandId:z.string().uuid(),expectedActorId:z.string().min(1),expectedAccountVersion:z.number().int().positive().optional(),
  items:z.array(z.object({id:z.number().int().positive().max(2147483647),expectedVersion:z.number().int().positive(),
    expectedOwner:z.string().nullable(),expectedRecordClass:z.string().min(1)}).strict()).min(1).max(5000),
}).strict().superRefine((input,ctx)=>{
  if(new Set(input.items.map(item=>item.id)).size!==input.items.length) ctx.addIssue({code:"custom",message:"Duplicate selected contact"});
});
export async function commandContactLifecycle(actor:WorkActor,operation:"archive"|"restore",fields:z.infer<typeof contactLifecycleFields>) {
  const items=[...fields.items].sort((a,b)=>a.id-b.id);
  const payloadHash=createHash("sha256").update(JSON.stringify([actor,operation,items])).digest("hex");
  return db.transaction(async tx=>{
    const [principal]=await tx.select(workPrincipalFields).from(users).where(eq(users.id,actor.id)).for("share");
    if(!principal || principal.accountState!=="active" || principal.authEpoch!==actor.authEpoch ||
      principal.accountVersion!==actor.accountVersion || !["admin","manager"].includes(principal.role ?? "")) {
      throw new WorkCommandError("Contact operation unavailable",404);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-lifecycle:${actor.id}:${fields.commandId}`},0))`);
    // Approved privileged manager global scope is preserved. The complete set
    // is locked and verified before the first update or audit.
    const rows=await tx.select().from(contacts).where(sql`${contacts.id} IN
      (${sql.join(items.map(item=>sql`${item.id}`),sql`,`)})`).orderBy(asc(contacts.id)).for("update");
    if(rows.length!==items.length) throw new WorkCommandError("Selected contact set unavailable; nothing was changed.",404);
    const [prior]=await tx.select().from(contactLifecycleReceipts).where(and(
      eq(contactLifecycleReceipts.actorId,actor.id),eq(contactLifecycleReceipts.commandId,fields.commandId)));
    if(prior) {
      if(prior.payloadHash!==payloadHash) throw new WorkCommandError("Contact retry payload differs from the retained command.",409);
      return {...prior.result as any,replayed:true};
    }
    for(const [i,row] of rows.entries()) {
      const selected=items[i];
      if(row.lifecycleVersion!==selected.expectedVersion || row.assignedTo!==selected.expectedOwner ||
        row.recordClass!==selected.expectedRecordClass) {
        throw new WorkCommandError("Contact state, owner or classification changed. Reload the selected set; nothing was changed.",409);
      }
    }
    const output=[];
    let changed=0;
    for(const before of rows) {
      const needsChange=operation==="archive"?!before.archivedAt:!!before.archivedAt;
      const [after]=needsChange ? await tx.update(contacts).set({archivedAt:operation==="archive"?new Date():null,
        lifecycleVersion:before.lifecycleVersion+1}).where(eq(contacts.id,before.id)).returning():[before];
      if(needsChange) {
        changed++;
        await auditChange({userId:actor.id,actorType:"user",action:operation==="archive"?"contact_archived":"contact_restored",
          entityType:"contact",entityId:before.id,before,after,details:{commandId:fields.commandId}},tx);
      }
      output.push(after);
    }
    const result={contacts:output,changed,replayed:false};
    await tx.insert(contactLifecycleReceipts).values({actorId:actor.id,commandId:fields.commandId,payloadHash,result});
    return result;
  });
}
