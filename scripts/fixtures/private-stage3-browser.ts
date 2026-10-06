import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

/** Private Chromium with real persisted session cookies. No credential logs,
 * public proxy, application auth bypass or external browser requests. */
export async function privateStage3Browser(base:string,cookie:string,originalFetch:typeof fetch) {
  const profile=await mkdtemp(path.join(tmpdir(),"stage3-b-browser-"));
  const process=spawn("/repl/tools/bin/chromium",["--headless","--no-sandbox","--disable-gpu",
    "--disable-background-networking","--disable-extensions","--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore",detached:true,
    env:{PATH:globalThis.process.env.PATH,HOME:profile}});
  let socket:WebSocket|undefined;
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  const exceptions:string[]=[];
  let serial=0,failPath:string|null=null,acceptDialog=false,closing=false;
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
    for(let i=0;i<100;i++){
      port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8").catch(()=>"")).split("\n")[0];
      if(port)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.match(port,/^\d+$/);
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
      if(m.method==="Page.javascriptDialogOpening")await call("Page.handleJavaScriptDialog",{accept:acceptDialog});
      if(m.method==="Fetch.requestPaused"){
        const {requestId,request}=m.params;
        try {
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
    await call("Fetch.enable",{patterns:[{urlPattern:"*"}]});
    for(const entry of cookie.split("; ")){
      const i=entry.indexOf("=");
      await call("Network.setCookie",{name:entry.slice(0,i),value:entry.slice(i+1),url:base});
    }
    const evaluate=async(expression:string)=>(await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result.value;
    const text=()=>evaluate("document.body.innerText");
    const screenshot=async(name:string)=>{
      await mkdir(".local/tasks/stage3-b-browser",{recursive:true});
      const image=await call("Page.captureScreenshot",{format:"jpeg",quality:75});
      await writeFile(`.local/tasks/stage3-b-browser/${name}.jpg`,Buffer.from(image.data,"base64"));
    };
    const waitFor=async(pattern:RegExp)=>{
      for(let i=0;i<120;i++){if(pattern.test(await text()))return;await new Promise(resolve=>setTimeout(resolve,100));}
      await screenshot("failure");await writeFile(".local/tasks/stage3-b-browser/failure.txt",await text());
      throw new Error(`Browser text unavailable: ${pattern.source}`);
    };
    const click=async(selector:string)=>{
      assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`),true,selector);
    };
    const set=async(selector:string,value:string)=>{
      assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;
        const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});
        e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`),true,selector);
    };
    return {call,evaluate,text,waitFor,click,set,screenshot,close,exceptions,
      failRead:(path:string|null)=>{failPath=path;},
      acceptDialogs:(accept:boolean)=>{acceptDialog=accept;},
      navigate:(pathname:string)=>call("Page.navigate",{url:base+pathname})};
  } catch(error){await close();throw error;}
}
