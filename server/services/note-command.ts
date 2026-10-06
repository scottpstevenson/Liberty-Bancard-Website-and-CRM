import {createHash} from "node:crypto";
import {and,desc,eq,isNull,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "../db";
import {users,contacts,deals,notes,noteCommandReceipts} from "@shared/schema";
import {canAccessOwner} from "./crm-object-access";
import {workPrincipalFields,WorkCommandError,type WorkActor} from "./work-item-command";
import {auditChange} from "./audit-change";
export const noteEntityKind=z.enum(["contact","deal"]);
export const noteCommandFields=z.object({
  commandId:z.string().uuid(),expectedActorId:z.string().min(1),expectedAccountVersion:z.number().int().positive().optional(),
  expectedVersion:z.number().int().positive().optional(),entityType:noteEntityKind.optional(),
  entityId:z.number().int().positive().max(2147483647).optional(),
  content:z.string().trim().min(1).max(20000).optional(),pinned:z.boolean().optional(),
}).strict();
type Fields=z.infer<typeof noteCommandFields>;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
const unavailable=()=>new WorkCommandError("Note context unavailable",404);
async function pinActor(tx:Tx,actor:WorkActor) {
  const [principal]=await tx.select(workPrincipalFields).from(users).where(eq(users.id,actor.id)).for("share");
  if(!principal || principal.accountState!=="active" || principal.authEpoch!==actor.authEpoch ||
    principal.accountVersion!==actor.accountVersion || !["admin","manager","agent"].includes(principal.role ?? "")) throw unavailable();
  return {...principal,role:principal.role ?? undefined};
}
async function pinTarget(tx:Tx,principal:Awaited<ReturnType<typeof pinActor>>,kind:string,id:number) {
  if(kind==="contact") {
    const [row]=await tx.select({id:contacts.id,owner:contacts.assignedTo}).from(contacts).where(eq(contacts.id,id)).for("share");
    if(!row || !canAccessOwner(principal,row.owner,false)) throw unavailable();
  } else if(kind==="deal") {
    const [row]=await tx.select({id:deals.id,owner:deals.owner,archivedAt:deals.archivedAt}).from(deals).where(eq(deals.id,id)).for("share");
    if(!row || row.archivedAt || !canAccessOwner(principal,row.owner,false)) throw unavailable();
  } else throw unavailable();
}
export async function readContextNotes(actor:WorkActor,kind:z.infer<typeof noteEntityKind>,id:number) {
  return db.transaction(async tx=>{
    const principal=await pinActor(tx,actor);await pinTarget(tx,principal,kind,id);
    return tx.select().from(notes).where(and(eq(notes.entityType,kind),eq(notes.entityId,id),isNull(notes.deletedAt)))
      .orderBy(desc(notes.pinned),desc(notes.createdAt),desc(notes.id));
  });
}
export async function commandNote(actor:WorkActor,operation:"create"|"edit"|"pin"|"delete",fields:Fields,noteId?:number,expectedContactId?:number) {
  const payloadHash=createHash("sha256").update(JSON.stringify([actor,operation,noteId,fields,expectedContactId])).digest("hex");
  return db.transaction(async tx=>{
    const principal=await pinActor(tx,actor);
    const [metadata]=noteId?await tx.select({entityType:notes.entityType,entityId:notes.entityId}).from(notes).where(eq(notes.id,noteId)):[];
    const kind=operation==="create"?fields.entityType:metadata?.entityType;
    const id=operation==="create"?fields.entityId:metadata?.entityId;
    if(!kind || !id || (expectedContactId!==undefined && (kind!=="contact" || id!==expectedContactId))) throw unavailable();
    if(operation!=="create" && (fields.entityType!==undefined || fields.entityId!==undefined)) {
      throw new WorkCommandError("Notes cannot be reparented",409);
    }
    await pinTarget(tx,principal,kind,id);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`note-command:${actor.id}:${fields.commandId}`},0))`);
    const [before]=noteId?await tx.select().from(notes).where(eq(notes.id,noteId)).for("update"):[];
    if(before && (before.entityType!==kind || before.entityId!==id)) throw unavailable();
    const [prior]=await tx.select().from(noteCommandReceipts).where(and(
      eq(noteCommandReceipts.actorId,actor.id),eq(noteCommandReceipts.commandId,fields.commandId)));
    if(prior) {
      if(prior.payloadHash!==payloadHash) throw new WorkCommandError("Note retry differs from the retained intent",409);
      return {...prior.result as any,replayed:true};
    }
    if(operation!=="create" && (!before || before.deletedAt)) throw unavailable();
    if(operation!=="create" && before!.version!==fields.expectedVersion) throw new WorkCommandError("Note changed. Reload before saving; your edit was not applied.",409);
    if(["create","edit"].includes(operation) && !fields.content) throw new WorkCommandError("Bounded nonblank content is required",409);
    if(operation==="pin" && fields.pinned===undefined) throw new WorkCommandError("Pinned state is required",409);
    let changed=true,note:typeof notes.$inferSelect;
    if(operation==="create") {
      [note]=await tx.insert(notes).values({entityType:kind,entityId:id,content:fields.content!,
        authorId:principal.id,authorName:principal.email ?? principal.id,pinned:false}).returning();
    } else {
      changed=operation==="delete" || (operation==="pin"?before!.pinned!==fields.pinned:before!.content!==fields.content);
      [note]=changed?await tx.update(notes).set({version:before!.version+1,updatedAt:new Date(),
        ...(operation==="delete"?{deletedAt:new Date()}:operation==="pin"?{pinned:fields.pinned}:{content:fields.content})})
        .where(eq(notes.id,noteId!)).returning():[before!];
    }
    if(changed) await auditChange({userId:actor.id,actorType:"user",action:`note_${operation}`,
      entityType:"note",entityId:note.id,before:before ?? null,after:note,details:{commandId:fields.commandId}},tx);
    const result={note,changed,replayed:false};
    await tx.insert(noteCommandReceipts).values({actorId:actor.id,commandId:fields.commandId,noteId:note.id,payloadHash,result});
    return result;
  });
}
