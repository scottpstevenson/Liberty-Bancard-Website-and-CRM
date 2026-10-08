import { useState,useEffect,useCallback,useRef } from "react";
import { getCsrfToken,protectedScope } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { invalidateWorkFacts } from "@/hooks/use-work-commands";
import { prepareWorkCreation,acknowledgeWorkCreation } from "@/lib/work-create-intent";
import { OFFLINE_QUEUE_KEY,readOfflineQueue,appendOfflineWork,replayOfflineWork,isReplayableWork,
  type QueueIO,type QueueActor,type QueueEntry } from "@/lib/offline-work-queue";

const CHANGED="liberty-offline-work-changed";
export const WORK_ACKNOWLEDGED_EVENT="liberty-offline-work-acknowledged";
let replayRunning:Promise<{acknowledged:number}>|null=null;
function browserIO():QueueIO {
  if (typeof window==="undefined") throw new Error("Offline storage is unavailable.");
  return {
    read:()=>localStorage.getItem(OFFLINE_QUEUE_KEY),
    write:value=>{localStorage.setItem(OFFLINE_QUEUE_KEY,value);window.dispatchEvent(new Event(CHANGED));},
    lock:fn=>{
      if (!navigator.locks) return Promise.reject(new Error("Safe offline storage locking is unavailable. Keep the editor open."));
      return navigator.locks.request(OFFLINE_QUEUE_KEY,fn);
    },
    actor:async()=>{
      const response=await fetch("/api/auth/user",{credentials:"include",cache:"no-store"});
      if(!response.ok) throw new Error("Current sign-in cannot be verified. Queued work is retained.");
      return captureActor(await response.json());
    },
    send:async entry=>{
      const headers:Record<string,string>={"Content-Type":"application/json"};
      const csrf=getCsrfToken();if(csrf) headers["X-CSRF-Token"]=csrf;
      const response=await fetch(entry.url,{method:entry.method,headers,
        body:JSON.stringify(entry.body),credentials:"include"});
      const receipt=await response.json().catch(()=>null);
      if (response.ok && /^\/api\/tasks(?:\/[1-9]\d*)?$/.test(entry.url) && !Number.isSafeInteger(receipt?.id)) {
        throw new Error("Creation receipt unavailable. The original command is retained for safe retry.");
      }
      if (response.ok && entry.method === "POST" && entry.url === "/api/tasks") {
        acknowledgeWorkCreation(entry.body);
        window.dispatchEvent(new CustomEvent(WORK_ACKNOWLEDGED_EVENT, {
          detail: { actorId: entry.body?.expectedActorId, commandId: entry.body?.commandId },
        }));
      }
      return {ok:response.ok,status:response.status,message:receipt?.message};
    },
  };
}
function captureActor(user:any):QueueActor {
  if(!user?.id || !Number.isSafeInteger(user.accountVersion) || user.accountVersion<1 ||
    user.accountState!=="active") throw new Error("Current account authority is unavailable. Keep the editor open.");
  return {id:user.id,accountVersion:user.accountVersion};
}
async function replay() {
  if(!replayRunning) replayRunning=replayOfflineWork(browserIO()).then(result=>{
    if(result.acknowledged) void invalidateWorkFacts();
    return result;
  }).finally(()=>{replayRunning=null;});
  return replayRunning;
}
export function useOfflineQueue() {
  const {user}=useAuth();
  const contextKey=JSON.stringify(protectedScope(user));
  const contextRef=useRef(contextKey);contextRef.current=contextKey;
  const [queueCount,setQueueCount]=useState<number|null>(null);
  const [queueError,setQueueError]=useState<string|null>(null);
  const [reviewCount,setReviewCount]=useState(0);
  const updateCount=useCallback(()=>{
    if(contextRef.current!==contextKey)return;
    try {
      if(!user?.id) {setQueueCount(null);return;}
      const own=readOfflineQueue(browserIO()).filter(entry=>entry.actorId===user.id);
      setQueueCount(own.length);
      setReviewCount(own.filter(entry=>!!entry.blockedReason || !isReplayableWork(entry) ||
        entry.accountVersion!==user.accountVersion).length);
    } catch(error) {setQueueCount(null);setQueueError((error as Error).message);}
  },[user?.id,user?.accountVersion,contextKey]);
  const retryQueue=useCallback(async()=>{
    setQueueError(null);
    try {await replay();} catch(error) {
      if(contextRef.current===contextKey)setQueueError((error as Error).message);
    }
    updateCount();
  },[updateCount,contextKey]);
  useEffect(()=>{
    setQueueError(null);
    updateCount();
    const online=()=>void retryQueue();
    window.addEventListener("online",online);
    window.addEventListener(CHANGED,updateCount);
    window.addEventListener("storage",updateCount);
    return ()=>{
      window.removeEventListener("online",online);window.removeEventListener(CHANGED,updateCount);
      window.removeEventListener("storage",updateCount);
    };
  },[updateCount,retryQueue]);
  const enqueue=useCallback(async(method:string,url:string,body:any)=>{
    const actor=captureActor(user);
    const entry:QueueEntry={id:crypto.randomUUID(),actorId:actor.id,accountVersion:actor.accountVersion,
      method:method.toUpperCase(),url,body,timestamp:Date.now()};
    if(!isReplayableWork(entry)) entry.blockedReason="This write has no retained server retry contract. Review it manually; it will not replay automatically.";
    await appendOfflineWork(browserIO(),entry);
    updateCount();
    return entry;
  },[user,updateCount]);
  const executeOrQueue=useCallback(async(method:string,url:string,body?:any,onSuccess?:()=>void):
    Promise<{ok:boolean;queued:boolean;reason?:string}>=>{
    const creating=method.toUpperCase()==="POST" && url==="/api/tasks";
    try {
      const actor=captureActor(user);
      if (body?.expectedActorId && body.expectedActorId!==actor.id) throw new Error("Sign-in changed. Review the captured work.");
      if(body?.expectedAccountVersion!==undefined && body.expectedAccountVersion!==actor.accountVersion) {
        throw new Error("Account authority changed. Review the captured work before retrying.");
      }
      if (creating || (method.toUpperCase()==="PUT" && /^\/api\/tasks\/[1-9]\d*$/.test(url))) {
        body={...body,expectedActorId:actor.id,expectedAccountVersion:actor.accountVersion};
      }
      if(creating) body=prepareWorkCreation(actor.id,body);
      if(navigator.onLine) {
        let result;
        try {result=await browserIO().send({id:"online",method:method.toUpperCase(),url,body,timestamp:Date.now()});}
        catch {result=null;}
        if(result?.ok) {
          if(creating) acknowledgeWorkCreation(body);
          try {onSuccess?.();}
          catch {return {ok:true,queued:false,reason:"Saved on the server; refresh the work to see the latest state."};}
          return {ok:true,queued:false};
        }
        if(result && result.status<500) return {ok:false,queued:false,reason:result.message || `Not saved (${result.status}). Reload current work.`};
      }
      const entry=await enqueue(method,url,body);
      if(creating) acknowledgeWorkCreation(body); // Verified durable local entry owns the UUID.
      return {ok:false,queued:true,reason:entry.blockedReason || "Saved locally only; server confirmation is still pending."};
    } catch(error) {
      const reason=(error as Error).message;
      if(contextRef.current===contextKey)setQueueError(reason);
      return {ok:false,queued:false,reason};
    }
  },[user,enqueue,contextKey]);
  return {queueCount,queueError,reviewCount,retryQueue,enqueue,executeOrQueue};
}
