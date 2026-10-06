import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, systemSettings, users } from "@shared/schema";
import { resolveWorkAssignee, workPrincipalFields, WorkCommandError, type WorkActor } from "./work-item-command";
import { auditChange } from "./audit-change";

const KEY="round_robin_pool";
export type RoundRobinPool = {
  version:number; reps:Array<{userId:string;name:string;email:string;paused:boolean;assignedCount:number}>;
  currentIndex:number;enabled:boolean;
  log:Array<{contactId:number;contactName:string;assignedTo:string;assignedName:string;assignedAt:string}>;
};
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
function decode(value:unknown):RoundRobinPool {
  if (value==null) return {version:1,reps:[],currentIndex:0,enabled:false,log:[]};
  const p=value as RoundRobinPool;
  if (!Array.isArray(p.reps) || !Array.isArray(p.log) || typeof p.enabled!=="boolean" ||
    !Number.isSafeInteger(p.currentIndex) || p.currentIndex<0 ||
    p.reps.some(r=>!r || typeof r.userId!=="string" || !r.userId || typeof r.paused!=="boolean") ||
    new Set(p.reps.map(r=>r.userId)).size!==p.reps.length) throw new WorkCommandError("Pool state is unsupported. Management review is required.",409);
  return {...p,version:p.version ?? 1};
}
export async function getRoundRobinPool() {
  const [row]=await db.select().from(systemSettings).where(eq(systemSettings.key,KEY));
  return decode(row?.value);
}
async function pinActor(tx:Tx,actor:WorkActor) {
  const [observed]=await tx.select(workPrincipalFields).from(users).where(eq(users.id,actor.id));
  if (!observed || observed.accountState!=="active" || observed.authEpoch!==actor.authEpoch ||
    !["admin","manager"].includes(observed.role ?? "")) throw new WorkCommandError("Current management authority is required. Reload before saving.",409);
  // Complete dashboard-principal set, in stable order, before pool/graph locks.
  // Recovery commands acquire users in this same order. Never acquire a new
  // candidate's user lock after holding the pool against an account mutation.
  const pinned=await tx.select(workPrincipalFields).from(users)
    .where(inArray(users.role,["admin","manager","agent"])).orderBy(asc(users.id)).for("share");
  const current=pinned.find(user=>user.id===actor.id);
  if (!current || current.accountState!=="active" || current.authEpoch!==actor.authEpoch ||
    !["admin","manager"].includes(current.role ?? "")) throw new WorkCommandError("Current management authority is required. Reload before saving.",409);
  return pinned;
}
export async function getEligibleRoundRobinReps(actor:WorkActor) {
  return db.transaction(async tx=>{
    const pinned=await pinActor(tx,actor),ids:string[]=[];
    for (const user of pinned.filter(u=>u.role==="agent")) {
      try {ids.push((await resolveWorkAssignee(user.id,tx,pinned,true)).id);}
      catch(error) {if (!(error instanceof WorkCommandError)) throw error;}
    }
    return ids.length ? tx.select({id:users.id,email:users.email,firstName:users.firstName,lastName:users.lastName})
      .from(users).where(inArray(users.id,ids)).orderBy(asc(users.id)):[];
  });
}
async function lockPool(tx:Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${KEY}))`);
  const [row]=await tx.select().from(systemSettings).where(eq(systemSettings.key,KEY)).for("update");
  return decode(row?.value);
}
async function writePool(tx:Tx,pool:RoundRobinPool) {
  await tx.insert(systemSettings).values({key:KEY,value:pool,updatedAt:new Date()})
    .onConflictDoUpdate({target:systemSettings.key,set:{value:pool,updatedAt:new Date()}});
}
export async function mutateRoundRobinPool(actor:WorkActor,expectedVersion:number,
  mutate:(pool:RoundRobinPool,tx:Tx)=>Promise<void>|void) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion<1) throw new WorkCommandError("Capture the current pool version before saving.",409);
  return db.transaction(async tx=>{
    await pinActor(tx,actor);
    const pool=await lockPool(tx);
    if (pool.version!==expectedVersion) throw new WorkCommandError("Pool changed. Reload before saving; no configuration was changed.",409);
    await mutate(pool,tx);
    pool.version++;
    await writePool(tx,pool);
    await auditChange({actorType:"user",userId:actor.id,action:"round_robin_pool_updated",
      entityType:"system_setting",entityKey:KEY,details:{version:pool.version,enabled:pool.enabled,repIds:pool.reps.map(r=>r.userId)}},tx);
    return pool;
  });
}

/**
 * Existing toolkit pool, not the inbound env selector. It may only perform a
 * current management-authorized initial assignment on an otherwise unworked
 * unassigned contact. Existing ownership is never stolen. No active caller
 * currently invokes this exported selector; retaining it must not retain its
 * old misleading ID/counter contract.
 */
export async function assignNextRep(contactId:number,_displayName:string,actor?:WorkActor):Promise<string|null> {
  if (!Number.isSafeInteger(contactId) || contactId<1 || !actor) throw new WorkCommandError("Explicit management assignment authority is required.",409);
  return db.transaction(async tx=>{
    await pinActor(tx,actor);
    const pool=await lockPool(tx);
    if (!pool.enabled || !pool.reps.length) return null;
    const ids=[...pool.reps.filter(r=>!r.paused).map(r=>r.userId)];
    const principals=ids.length ? await tx.select(workPrincipalFields).from(users).where(sql`${users.id}
      IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`).orderBy(asc(users.id)).for("share"):[];
    const eligible:Array<{rep:RoundRobinPool["reps"][number];user:typeof principals[number]}>=[];
    for (const rep of pool.reps.filter(r=>!r.paused)) {
      try { eligible.push({rep,user:await resolveWorkAssignee(rep.userId,tx,principals,true)}); }
      catch(error) {if (!(error instanceof WorkCommandError)) throw error;}
    }
    const [contact]=await tx.select().from(contacts).where(eq(contacts.id,contactId)).for("update");
    if (!contact || contact.archivedAt || contact.recordClass!=="production") throw new WorkCommandError("Contact unavailable for assignment.",404);
    if (contact.assignedTo) return eligible.find(r=>r.user.email===contact.assignedTo)?.user.email ?? null;
    const deps=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM deals WHERE contact_id=${contactId})
      OR EXISTS(SELECT 1 FROM tasks WHERE contact_id=${contactId})
      OR EXISTS(SELECT 1 FROM tickets WHERE contact_id=${contactId}) AS worked`);
    if ((deps.rows[0] as any)?.worked || !eligible.length) return null;
    const chosen=eligible[pool.currentIndex % eligible.length];
    await tx.update(contacts).set({assignedTo:chosen.user.email,updatedAt:new Date()}).where(eq(contacts.id,contactId));
    chosen.rep.assignedCount=(chosen.rep.assignedCount ?? 0)+1;
    pool.currentIndex=(pool.currentIndex+1)%eligible.length; pool.version++;
    pool.log=[{contactId,contactName:contact.companyName || `${contact.firstName} ${contact.lastName}`.trim(),
      assignedTo:chosen.user.email!,assignedName:chosen.rep.name,assignedAt:new Date().toISOString()},...pool.log].slice(0,200);
    await writePool(tx,pool);
    await auditChange({actorType:"user",userId:actor.id,action:"contact_initial_assignment",entityType:"contact",entityId:contactId,
      before:{assignedTo:contact.assignedTo},after:{assignedTo:chosen.user.email},details:{policy:"toolkit_pool",poolVersion:pool.version,assigneeUserId:chosen.user.id}},tx);
    return chosen.user.email;
  });
}
