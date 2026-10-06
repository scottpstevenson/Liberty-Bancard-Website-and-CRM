/** Browser storage adapter is supplied by the hook; importing this is SSR-safe.
 * Only retained server work commands replay automatically. Other historical
 * writes remain for review, never for an unsafe duplicate after a timeout. */
export const OFFLINE_QUEUE_KEY="lb_mobile_mutation_queue";
export type QueueActor={id:string;accountVersion:number};
export type QueueEntry={
  id:string;actorId?:string;accountVersion?:number;
  method:string;url:string;body?:any;timestamp:number;blockedReason?:string;
};
export type QueueIO={
  read:()=>string|null;write:(value:string)=>void;
  lock:<T>(fn:()=>Promise<T>)=>Promise<T>;
  actor:()=>Promise<QueueActor>;
  send:(entry:QueueEntry)=>Promise<{ok:boolean;status:number;message?:string}>;
};
export function readOfflineQueue(io:Pick<QueueIO,"read">):QueueEntry[] {
  const raw=io.read();
  if (raw===null) return [];
  if (raw.length>2_000_000) throw new Error("Offline storage is oversized. Work is retained; review is required.");
  const entries=JSON.parse(raw);
  if (!Array.isArray(entries) || entries.length>1000 || entries.some(e=>!e ||
    typeof e.id!=="string" || typeof e.method!=="string" || typeof e.url!=="string" ||
    !e.url.startsWith("/api/") || !Number.isFinite(e.timestamp)) ||
    new Set(entries.map(e=>e.id)).size!==entries.length) throw new Error("Offline storage is malformed. It was not overwritten.");
  return entries;
}
function write(io:QueueIO,entries:QueueEntry[]) {
  const raw=JSON.stringify(entries);
  if(raw.length>2_000_000) throw new Error("Offline storage is full. Keep the editor open; no new entry was saved.");
  io.write(raw);
  if(io.read()!==raw) throw new Error("Offline save could not be verified. Keep the editor open.");
}
export async function appendOfflineWork(io:QueueIO,entry:QueueEntry) {
  return io.lock(async()=>{
    const current=readOfflineQueue(io);
    if(current.length>=1000) throw new Error("Offline queue is full. Keep the editor open.");
    current.push(JSON.parse(JSON.stringify(entry))); write(io,current); return current;
  });
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isReplayableWork(entry:QueueEntry) {
  return typeof entry.actorId==="string" && !!entry.actorId &&
    Number.isSafeInteger(entry.accountVersion) && entry.accountVersion!>0 &&
    ((entry.method==="POST" && entry.url==="/api/tasks") ||
    (entry.method==="PUT" && /^\/api\/tasks\/[1-9]\d*$/.test(entry.url) &&
      Number.isSafeInteger(entry.body?.expectedFence))) &&
    uuid.test(entry.body?.commandId ?? "") && entry.body?.expectedActorId===entry.actorId &&
    entry.body?.expectedAccountVersion===entry.accountVersion;
}
function sameActor(entry:QueueEntry,actor:QueueActor) {
  return entry.actorId===actor.id &&
    entry.accountVersion===actor.accountVersion;
}
export async function replayOfflineWork(io:QueueIO) {
  const snapshot=await io.lock(async()=>readOfflineQueue(io));
  let acknowledged=0;
  for (const entry of snapshot) {
    if(entry.blockedReason || !isReplayableWork(entry)) continue;
    // Fresh authority before EACH request, not just the start of a batch.
    // The server also checks this captured context against the request actor.
    const actor=await io.actor();
    if (!sameActor(entry,actor)) continue;
    const response=await io.send(entry); // Network/authority failure retains all pending work.
    await io.lock(async()=>{
      const latest=readOfflineQueue(io),index=latest.findIndex(e=>e.id===entry.id);
      if(index<0) return;
      if(response.ok) {latest.splice(index,1);acknowledged++;}
      else if([400,401,403,404,409].includes(response.status)) {
        latest[index]={...latest[index],blockedReason:response.message || `Review required (${response.status}); no success was confirmed.`};
      }
      write(io,latest); // Merge by ID; new entries added during fetch survive.
    });
  }
  return {acknowledged};
}
