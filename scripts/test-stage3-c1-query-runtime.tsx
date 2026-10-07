import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClientProvider} from "@tanstack/react-query";
import {queryClient,getQueryFn,transitionProtectedActor,protectedScope} from "../client/src/lib/queryClient";
import {useCrmQuery} from "../client/src/hooks/use-crm-query";
import {toast,useToast} from "../client/src/hooks/use-toast";
import {EmployeeCrmProvider} from "../client/src/components/crm/employee-crm-context";
const dom=new JSDOM("<div id='root'></div>",{url:"http://candidate.test/dashboard/contacts"});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
const originalFetch=globalThis.fetch;
// Removed observers can otherwise retain their own five-minute GC timers after
// a context fence. Keep this harness bounded without changing application GC.
const defaults=queryClient.getDefaultOptions();
queryClient.setDefaultOptions({...defaults,queries:{...defaults.queries,gcTime:0}});
queryClient.setQueryDefaults(["/api/blog/generated/published"],{gcTime:Infinity});
const actorA={id:"isolated-a",role:"agent",accountVersion:1};
const actorB={id:"isolated-b",role:"manager",accountVersion:2};
type Pending={url:string;signal:AbortSignal;resolve:(value:Response)=>void};
const pending:Pending[]=[];
globalThis.fetch=async(input,init)=>{
  if(String(input)==="/api/auth/user")return Response.json(queryClient.getQueryData(["/api/auth/user"]));
  return new Promise<Response>(resolve=>pending.push({url:String(input),signal:init!.signal as AbortSignal,resolve}));
};
let scopedToast:ReturnType<typeof useToast>["toast"];
function Probe({id}:{id:string}){
  return <EmployeeCrmProvider enabled><ProbeBody id={id}/></EmployeeCrmProvider>;
}
function ProbeBody({id}:{id:string}){
  const read=useCrmQuery<{name:string}>({queryKey:["/api/contacts",id]});
  const {toasts,toast:emit}=useToast();
  scopedToast=emit;
  return <div>{read.data?.name??"unavailable"}{toasts.map(t=><span key={t.id}>{t.description}</span>)}</div>;
}
const root=createRoot(document.getElementById("root")!);
const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
try {
  await transitionProtectedActor(actorA);
  queryClient.setQueryData(["/api/auth/user"],actorA);
  queryClient.setQueryData(["/api/blog/generated/published"],{public:true});
  await act(async()=>{root.render(<QueryClientProvider client={queryClient}><Probe id="1"/></QueryClientProvider>);});
  await settle();
  assert.equal(pending[0].url,"/api/contacts/1","scope object never becomes request URL");
  const oldRequest=pending[0];
  const oldScopeToast=scopedToast!;
  await act(async()=>{toast({description:"protected old actor"});});
  await act(async()=>{await transitionProtectedActor(actorB);queryClient.setQueryData(["/api/auth/user"],actorB);});
  await settle();
  assert.equal(oldRequest.signal.aborted,true);
  assert.ok(!document.body.textContent!.includes("protected old actor"));
  await act(async()=>{oldScopeToast({description:"LATE OLD ACTOR TOAST"});});
  assert.ok(!document.body.textContent!.includes("LATE OLD ACTOR TOAST"),"late durable callback cannot expose the previous actor");
  oldRequest.resolve(Response.json({name:"OLD ACTOR DATA"}));
  await settle();
  assert.ok(!document.body.textContent!.includes("OLD ACTOR DATA"),"late canceled result cannot resurrect prior scope");
  assert.deepEqual(queryClient.getQueryData(["/api/blog/generated/published"]),{public:true});
  const current=pending.find(p=>p!==oldRequest && !p.signal.aborted)!;
  await act(async()=>{current.resolve(Response.json({name:"CURRENT ACTOR DATA"}));});
  await settle();
  assert.ok(document.body.textContent!.includes("CURRENT ACTOR DATA"));
  assert.equal(queryClient.getQueryCache().findAll({queryKey:["/api/contacts"]}).length,1,"old context removed");
  assert.equal(queryClient.getQueryCache().findAll({queryKey:["/api/contacts", "1"]})[0].queryKey.at(-1)?.actor,protectedScope(actorB).actor);
  await act(async()=>{root.render(<QueryClientProvider client={queryClient}><Probe id="2"/></QueryClientProvider>);});
  await settle();
  assert.ok(!document.body.textContent!.includes("CURRENT ACTOR DATA"),"other record has no placeholder from prior record");
  const record2=pending.at(-1)!;
  await act(async()=>{root.render(<QueryClientProvider client={queryClient}><Probe id="3"/></QueryClientProvider>);});
  await settle();
  assert.equal(record2.signal.aborted,true);
  record2.resolve(Response.json({name:"OLD RECORD DATA"}));await settle();
  assert.ok(!document.body.textContent!.includes("OLD RECORD DATA"));
  const beforePermission=pending.at(-1)!;
  const revised={...actorB,permissions:["isolated-test-permission"]};
  await act(async()=>{toast({description:"public feedback",protectedContext:null});});
  await act(async()=>{await transitionProtectedActor(revised);queryClient.setQueryData(["/api/auth/user"],revised);});
  await settle();
  assert.ok(document.body.textContent!.includes("public feedback"),"public feedback survives protected transition");
  assert.equal(beforePermission.signal.aborted,true,"same-actor permission change cancels prior generation");
  beforePermission.resolve(Response.json({name:"OLD PERMISSION DATA"}));await settle();
  assert.ok(!document.body.textContent!.includes("OLD PERMISSION DATA"));
  const defaultSignal=new AbortController();
  const simple=getQueryFn({on401:"throw"})({queryKey:["/api/default","42"],signal:defaultSignal.signal} as any);
  assert.equal(pending.at(-1)!.url,"/api/default/42");
  assert.equal(pending.at(-1)!.signal,defaultSignal.signal);
  pending.at(-1)!.resolve(Response.json({ok:true}));await simple;
  console.log("PASS mounted query context: actor/permission/record transition, delayed out-of-order results, actual AbortSignal, URL separation, public cache and toast isolation. Supporting harness, not real-session proof.");
}finally{
  await act(async()=>{await queryClient.cancelQueries();root.unmount();});
  for(const request of pending)request.resolve(Response.json({teardown:true}));
  queryClient.clear();globalThis.fetch=originalFetch;dom.window.close();
}
