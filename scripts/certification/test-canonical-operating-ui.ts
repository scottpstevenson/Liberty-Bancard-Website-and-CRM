import assert from "node:assert/strict";
import fs from "node:fs";
import WebSocket from "ws";

// This browser check is deliberately manual: launch the EXISTING disposable UI
// fixture first. Never point an automatically authenticated fixture at prod/dev.
assert.equal(process.env.CANONICAL_PRIVATE_UI_CERTIFICATION,"1","Explicit private UI fixture opt-in required");
const targets=await (await fetch("http://127.0.0.1:5444/json/list")).json() as any[];
const target=targets.find(target=>target.type==="page" && target.url==="about:blank");
assert(target?.webSocketDebuggerUrl?.startsWith("ws://127.0.0.1:5444/"),"Dedicated loopback page target required");
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});
let sequence=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
const exceptions:string[]=[];
socket.on("message",raw=>{
  const event=JSON.parse(String(raw));
  if(event.method==="Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails.text);
  if(!event.id) return;
  const callback=pending.get(event.id);if(!callback)return;
  pending.delete(event.id);
  if(event.error)callback.reject(new Error(event.error.message));else callback.resolve(event.result);
});
function command(method:string,params:any={}) {
  const id=++sequence;
  return new Promise<any>((resolve,reject)=>{
    pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{if(pending.delete(id))reject(new Error(`CDP_TIMEOUT:${method}`));},12_000).unref();
  });
}
async function evaluate(expression:string) {
  const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  assert(!result.exceptionDetails,"Browser evaluation must not throw");
  return result.result.value;
}
async function waitFor(expression:string) {
  const until=Date.now()+45_000;
  while(Date.now()<until){
    if(await evaluate(expression))return;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw new Error("CANONICAL_UI_WAIT_TIMEOUT");
}
const views=[
  {label:"Pipeline",expected:"Preparation cursor and validation queue",slug:"pipeline"},
  {label:"Records",expected:"Follow identity back to the source",slug:"records"},
  {label:"Imports & Sources",expected:"Imports and source history",slug:"imports"},
  {label:"Exceptions",expected:"Exceptions stay visible",slug:"exceptions"},
  {label:"Settings & Health",expected:"Settings & Health",slug:"health"},
];
const receipts:any[]=[];
try {
  await command("Page.enable");await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride",{width:1440,height:1040,deviceScaleFactor:1,mobile:false});
  await command("Page.navigate",{url:"http://127.0.0.1:5443/dashboard/canonical-enrichment"});
  await waitFor("document.body?.innerText.includes('Read-only status view') && document.body.innerText.includes('Preparation cursor and validation queue')");
  assert.equal(await evaluate("fetch('/api/auth/user').then(r=>r.json()).then(u=>u.role)"),"admin");
  for(const view of views) {
    const clicked=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>
      b.textContent.replace(/\\s+/g,' ').trim().startsWith(${JSON.stringify(view.label)}));
      if(!b)return false;b.click();return true;})()`);
    assert(clicked,`View button must exist: ${view.label}`);
    await waitFor(`[...document.querySelectorAll('h2')].some(h=>h.textContent===${JSON.stringify(view.expected)})`);
    assert(!await evaluate("document.body.innerText.includes('Unable to load')"),"View must not mask a failed status endpoint");
    const image=await command("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(`docs/certification/canonical-enrichment-private-${view.slug}.png`,Buffer.from(image.data,"base64"));
    receipts.push({view:view.label,rendered:true,signedInRole:"admin"});
  }
  assert.deepEqual(exceptions,[],"No uncaught browser exceptions in the five-view interaction");
  fs.writeFileSync("docs/certification/canonical-enrichment-private-operating-ui.json",JSON.stringify({
    observedAt:new Date().toISOString(),scope:"Actual signed-in five-view desktop UI against existing disposable fixture",
    views:receipts,viewport:{width:1440,height:1040},uncaughtExceptions:exceptions,
    productionExecution:false,scheduledProgression:false,managerAgentRoleCertification:false,
    nativeMobileCertification:false,taskComplete:false,
  },null,2)+"\n");
  console.log("PASS: all five signed-in canonical operating views; no uncaught browser exceptions");
} finally {socket.close();}