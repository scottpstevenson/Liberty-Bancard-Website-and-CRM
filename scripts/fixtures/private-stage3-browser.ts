import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

/** Private Chromium with real persisted session cookies. No credential logs,
 * public proxy, application auth bypass or external browser requests. */
export async function privateStage3Browser(base:string,cookie:string,originalFetch:typeof fetch,
  screenshotDirectory=".local/tasks/stage3-b-browser",options:{realInput?:boolean;zoom?:number;singleProcess?:boolean;startupTimeoutMs?:number}={}) {
  const profile=await mkdtemp(path.join(tmpdir(),"stage3-b-browser-"));
  if(options.zoom){
    await mkdir(path.join(profile,"Default"),{recursive:true});
    await writeFile(path.join(profile,"Default","Preferences"),JSON.stringify({
      partition:{default_zoom_level:Math.log(options.zoom)/Math.log(1.2)},
    }));
  }
  const process=spawn("/repl/tools/bin/chromium",["--headless","--no-sandbox","--disable-gpu",
    ...(options.singleProcess?["--no-zygote","--single-process"]:[]),
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    "--disable-background-networking","--disable-extensions","--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"],detached:true,
    env:{PATH:globalThis.process.env.PATH,HOME:profile}});
  let startupDiagnostics="";
  process.stderr?.on("data",chunk=>{
    startupDiagnostics=(startupDiagnostics+String(chunk).replaceAll(profile,"<private-profile>")).slice(-4000);
  });
  let socket:WebSocket|undefined;
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  const exceptions:string[]=[];
  const requests:Array<{url:string;method:string;status?:number;failed?:string}>=[];
  const requestIndexes=new Map<string,number>();
  let serial=0,failPath:string|null=null,delayPath:string|null=null,delayMs=0,acceptDialog=false,closing=false;
  const close=async()=>{
    closing=true;
    for(const operation of pending.values())operation.reject(new Error("Owned browser closed"));
    pending.clear();
    socket?.close();
    try{globalThis.process.kill(-process.pid!,"SIGKILL");}catch{}
    await new Promise<void>(resolve=>{
      if(process.exitCode!==null || process.signalCode!==null)resolve();
      else process.once("exit",()=>resolve());
    });
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  };
  try {
    let port="";
    for(let i=0;i<Math.ceil((options.startupTimeoutMs??10000)/100);i++){
      port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8").catch(()=>"")).split("\n")[0];
      if(port)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!/^\d+$/.test(port))throw new Error(`Private Chromium did not open a debugging port (exit=${process.exitCode}, signal=${process.signalCode}): ${startupDiagnostics}`);
    const pages=await (await originalFetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(pages.find((p:any)=>p.type==="page" && p.url==="about:blank").webSocketDebuggerUrl);
    await new Promise<void>((resolve,reject)=>{socket!.addEventListener("open",()=>resolve(),{once:true});
      socket!.addEventListener("error",()=>reject(new Error("Private Chromium connect failed")),{once:true});});
    const call=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser timeout: ${method}`));},15000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
      socket!.send(JSON.stringify({id,method,params}));
    });
    socket.addEventListener("message",async event=>{
      if(closing)return;
      const m=JSON.parse(String(event.data));
      if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result);}
      if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params.exceptionDetails.text);
      if(m.method==="Network.requestWillBeSent" && m.params.request.url.startsWith(base+"/api/")){
        const url=new URL(m.params.request.url);
        // No bodies, headers, credentials, cookies or auth response values.
        requestIndexes.set(m.params.requestId,requests.length);
        requests.push({url:url.pathname+url.search,method:m.params.request.method});
      }
      if(m.method==="Network.responseReceived"){
        const index=requestIndexes.get(m.params.requestId);
        if(index!==undefined)requests[index].status=m.params.response.status;
      }
      if(m.method==="Network.loadingFailed"){
        const index=requestIndexes.get(m.params.requestId);
        if(index!==undefined)requests[index].failed=m.params.errorText;
      }
      if(m.method==="Page.javascriptDialogOpening")await call("Page.handleJavaScriptDialog",{accept:acceptDialog});
      if(m.method==="Fetch.requestPaused"){
        const {requestId,request}=m.params;
        try {
        if(delayPath && request.url.startsWith(base+delayPath))
          await new Promise(resolve=>setTimeout(resolve,delayMs));
        if(failPath && request.url.startsWith(base+failPath)) await call("Fetch.fulfillRequest",{requestId,responseCode:503,
          responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from('{"message":"Fixture source unavailable"}').toString("base64")});
        else await call(request.url.startsWith(base+"/")?"Fetch.continueRequest":"Fetch.failRequest",
          request.url.startsWith(base+"/")?{requestId}:{requestId,errorReason:"BlockedByClient"});
        } catch(error) {
          if(closing)return;
          // Navigation can cancel an already paused request. This exact CDP
          // state is no longer an interceptable request, not an allowed send.
          if(!(error instanceof Error) || error.message!=="Invalid InterceptionId.")throw error;
        }
      }
    });
    await call("Page.enable");await call("Runtime.enable");await call("Network.enable");
    if(options.realInput)await call("Network.setCacheDisabled",{cacheDisabled:true});
    await call("Fetch.enable",{patterns:[{urlPattern:"*"}]});
    for(const entry of cookie ? cookie.split("; ") : []){
      const i=entry.indexOf("=");
      await call("Network.setCookie",{name:entry.slice(0,i),value:entry.slice(i+1),url:base});
    }
    const evaluate=async(expression:string)=>{
      const result=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw new Error("Private browser evaluation failed; expression and response omitted");
      return result.result.value;
    };
    const text=()=>evaluate("document.body.innerText");
    const screenshot=async(name:string)=>{
      assert.match(name,/^[a-z0-9-]+$/i);
      await mkdir(screenshotDirectory,{recursive:true});
      const image=await call("Page.captureScreenshot",{format:"jpeg",quality:75});
      await writeFile(`${screenshotDirectory}/${name}.jpg`,Buffer.from(image.data,"base64"));
    };
    const waitFor=async(pattern:RegExp)=>{
      for(let i=0;i<120;i++){if(pattern.test(await text()))return;await new Promise(resolve=>setTimeout(resolve,100));}
      await screenshot("failure");await writeFile(`${screenshotDirectory}/failure.txt`,await text());
      throw new Error(`Browser text unavailable: ${pattern.source}`);
    };
    const click=async(selector:string)=>{
      if(!options.realInput){
        assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`),true,selector);
        return;
      }
      const point=await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length);if(!e)return null;
        e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.ok(point,selector);
      await call("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
      await call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
      await call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
    };
    const set=async(selector:string,value:string)=>{
      if(!options.realInput){
        assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;
          const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});
          e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`),true,selector);
        return;
      }
      await click(selector);
      await call("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
      await call("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
      await call("Input.insertText",{text:value});
    };
    return {call,evaluate,text,waitFor,click,set,screenshot,close,exceptions,requests,
      failRead:(path:string|null)=>{failPath=path;},
      delayRead:(path:string|null,ms=0)=>{delayPath=path;delayMs=ms;},
      acceptDialogs:(accept:boolean)=>{acceptDialog=accept;},
      navigate:(pathname:string)=>call("Page.navigate",{url:base+pathname})};
  } catch(error){await close();throw error;}
}
