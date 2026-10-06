import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {appendOfflineWork,readOfflineQueue,replayOfflineWork,isReplayableWork,
  type QueueIO,type QueueEntry,type QueueActor} from "../client/src/lib/offline-work-queue";

let raw:string|null=null,actor:QueueActor={id:"actor-a",accountVersion:1},calls=0,lock=Promise.resolve();
const entry=():QueueEntry=>({id:randomUUID(),actorId:"actor-a",accountVersion:1,method:"POST",url:"/api/tasks",
  body:{commandId:randomUUID(),expectedActorId:"actor-a",expectedAccountVersion:1,title:"Retained work"},timestamp:1});
const io:QueueIO={
  read:()=>raw,write:value=>{raw=value;},
  lock:async fn=>{
    const preceding=lock;let release!:()=>void;
    lock=new Promise<void>(resolve=>{release=resolve;});
    await preceding;try{return await fn();}finally{release();}
  },
  actor:async()=>actor,
  send:async()=>{calls++;return {ok:true,status:200};},
};
assert.deepEqual(readOfflineQueue(io),[]);
const first=entry(),second=entry(),addedDuringFetch=entry();
await appendOfflineWork(io,first);await appendOfflineWork(io,second);
io.send=async()=>{
  calls++;await appendOfflineWork(io,addedDuringFetch);
  actor={id:"actor-b",accountVersion:1};return {ok:true,status:200};
};
assert.equal((await replayOfflineWork(io)).acknowledged,1);
assert.equal(calls,1,"account checked before each request; no later dispatch as another actor");
assert.deepEqual(readOfflineQueue(io).map(e=>e.id),[second.id,addedDuringFetch.id],"concurrent enqueue isn't overwritten");
actor={id:"actor-a",accountVersion:2};
assert.equal((await replayOfflineWork(io)).acknowledged,0);assert.equal(calls,1,"reactivation/role change cannot replay prior account version");
actor={id:"actor-a",accountVersion:1};io.send=async()=>{calls++;return {ok:true,status:200};};
assert.equal((await replayOfflineWork(io)).acknowledged,2);assert.deepEqual(readOfflineQueue(io),[]);
const conflict=entry();await appendOfflineWork(io,conflict);
io.send=async()=>{calls++;return {ok:false,status:409,message:"Work version changed. Reload."};};
await replayOfflineWork(io);
assert.match(readOfflineQueue(io)[0].blockedReason!,/Work version changed/);
const afterConflict=calls;await replayOfflineWork(io);assert.equal(calls,afterConflict,"conflicts are held, not automatically retried");
const legacy={...entry(),accountVersion:undefined,body:{title:"Old unbound work"}};
assert.equal(isReplayableWork(legacy),false);
assert.equal(isReplayableWork({...entry(),url:"/api/call-logs"}),false,"non-idempotent writes never auto-replay");
raw="{broken";await assert.rejects(appendOfflineWork(io,entry()));assert.equal(raw,"{broken","malformed history retained");
raw=null;io.write=()=>{throw new Error("Quota unavailable");};
await assert.rejects(appendOfflineWork(io,entry()),/Quota unavailable/);assert.equal(raw,null,"failed storage never acknowledged");
const hook=readFileSync("client/src/hooks/use-offline-queue.ts","utf8");
assert.match(hook,/navigator\.locks/);assert.match(hook,/setQueueCount\(null\)/);
assert.doesNotMatch(hook,/catch\s*\{\s*\}/);
console.log("Stage 3 B offline pure contract PASS: account/version binding, per-entry authority, concurrent additions retained, conflict held, unsafe legacy/non-idempotent replay denied, malformed/quota failure explicit. Not browser proof.");
