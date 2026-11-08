import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,readFile,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

/**
 * Minimal private-Chromium driver for public-site acceptance checks.
 *
 * Uses the environment Chromium over the DevTools protocol (no extra npm
 * dependency). Every session is an isolated throw-away profile, so it carries no
 * cookies, consent or theme preference from a previous run. Results are
 * Chromium-only evidence: this driver is NOT Safari/WebKit or a real iPhone.
 */
export type ColorScheme="light"|"dark";
export interface SessionOptions {
  width:number;
  height:number;
  mobile?:boolean;
  deviceScaleFactor?:number;
  colorScheme?:ColorScheme;
  reducedMotion?:boolean;
  /** Request URL substrings that are aborted (e.g. third-party vendor hosts). */
  blockUrlParts?:string[];
  /** Pre-seed localStorage before any page script runs (stored preferences). */
  localStorage?:Record<string,string>;
  /** Chromium text zoom / page zoom factor (1 = 100%). */
  zoom?:number;
  userAgent?:string;
}

export const CHROMIUM_PATH=process.env.PUBLIC_SITE_CHROMIUM??"/repl/tools/bin/chromium";

export interface BrowserHandle {
  newSession(options:SessionOptions):Promise<Session>;
  close():Promise<void>;
}

export interface Session {
  goto(url:string,opts?:{settleMs?:number}):Promise<void>;
  evaluate<T=unknown>(expression:string):Promise<T>;
  /** Raw DevTools Protocol call on this page's session (e.g. CSS.getPlatformFontsForNode). */
  cdp<T=any>(method:string,params?:Record<string,unknown>):Promise<T>;
  screenshot(file:string,opts?:{fullPage?:boolean}):Promise<void>;
  click(x:number,y:number):Promise<void>;
  press(key:string,opts?:{shift?:boolean}):Promise<void>;
  type(text:string):Promise<void>;
  setViewport(width:number,height:number):Promise<void>;
  requests():Array<{url:string;status?:number;failed?:string;type?:string;encodedBytes?:number;mime?:string}>;
  consoleErrors():string[];
  close():Promise<void>;
}

class Cdp {
  private socket!:WebSocket;
  private serial=0;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  private listeners=new Map<string,Array<(params:any,sessionId?:string)=>void>>();
  async connect(url:string){
    this.socket=new WebSocket(url);
    await new Promise<void>((resolve,reject)=>{
      this.socket.addEventListener("open",()=>resolve(),{once:true});
      this.socket.addEventListener("error",()=>reject(new Error("CDP socket error")),{once:true});
    });
    this.socket.addEventListener("message",event=>{
      const message=JSON.parse(String(event.data));
      if(message.id&&this.pending.has(message.id)){
        const operation=this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if(message.error)operation.reject(new Error(`${message.error.message}`));
        else operation.resolve(message.result);
      }else if(message.method){
        for(const listener of this.listeners.get(message.method)??[])listener(message.params,message.sessionId);
      }
    });
  }
  send<T=any>(method:string,params:Record<string,unknown>={},sessionId?:string):Promise<T>{
    const id=++this.serial;
    return new Promise<T>((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  on(method:string,listener:(params:any,sessionId?:string)=>void){
    this.listeners.set(method,[...(this.listeners.get(method)??[]),listener]);
  }
  close(){
    for(const operation of this.pending.values())operation.reject(new Error("browser closed"));
    this.pending.clear();
    try{this.socket.close();}catch{}
  }
}

export async function launchBrowser():Promise<BrowserHandle> {
  const profile=await mkdtemp(path.join(tmpdir(),"public-site-browser-"));
  const child:ChildProcess=spawn(CHROMIUM_PATH,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--hide-scrollbars","--force-color-profile=srgb","--disable-background-networking","--disable-extensions",
    "--remote-debugging-address=127.0.0.1","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],
    {stdio:["ignore","ignore","pipe"],detached:true,env:{PATH:process.env.PATH,HOME:profile}});
  let diagnostics="";
  child.stderr?.on("data",chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-2000);});
  let port="";
  for(let i=0;i<300;i++){
    port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8").catch(()=>"")).split("\n")[0];
    if(port)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!/^\d+$/.test(port))throw new Error(`Chromium did not open a debugging port: ${diagnostics}`);
  const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser=new Cdp();
  await browser.connect(version.webSocketDebuggerUrl);

  const close=async()=>{
    browser.close();
    try{process.kill(-child.pid!,"SIGKILL");}catch{}
    await new Promise<void>(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)resolve();
      else child.once("exit",()=>resolve());
    });
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  };

  const newSession=async(options:SessionOptions):Promise<Session>=>{
    const {targetId}=await browser.send<{targetId:string}>("Target.createTarget",{url:"about:blank"});
    const {sessionId}=await browser.send<{sessionId:string}>("Target.attachToTarget",{targetId,flatten:true});
    const send=<T=any>(method:string,params:Record<string,unknown>={})=>browser.send<T>(method,params,sessionId);
    const requestLog=new Map<string,{url:string;status?:number;failed?:string;type?:string;encodedBytes?:number;mime?:string}>();
    const errors:string[]=[];
    browser.on("Network.requestWillBeSent",(p,sid)=>{if(sid===sessionId)requestLog.set(p.requestId,{url:p.request.url,type:p.type});});
    browser.on("Network.responseReceived",(p,sid)=>{if(sid!==sessionId)return;const r=requestLog.get(p.requestId);if(r){r.status=p.response.status;r.mime=p.response.mimeType;}});
    browser.on("Network.loadingFinished",(p,sid)=>{if(sid!==sessionId)return;const r=requestLog.get(p.requestId);if(r)r.encodedBytes=p.encodedDataLength;});
    browser.on("Network.loadingFailed",(p,sid)=>{if(sid!==sessionId)return;const r=requestLog.get(p.requestId);if(r)r.failed=p.errorText;});
    browser.on("Runtime.exceptionThrown",(p,sid)=>{if(sid===sessionId)errors.push(String(p.exceptionDetails?.exception?.description??p.exceptionDetails?.text).slice(0,300));});
    browser.on("Fetch.requestPaused",(p,sid)=>{
      if(sid!==sessionId)return;
      const blocked=(options.blockUrlParts??[]).some(part=>p.request.url.includes(part));
      void browser.send(blocked?"Fetch.failRequest":"Fetch.continueRequest",
        blocked?{requestId:p.requestId,errorReason:"BlockedByClient"}:{requestId:p.requestId},sessionId).catch(()=>{});
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    if(options.blockUrlParts?.length)await send("Fetch.enable",{patterns:[{urlPattern:"*"}]});
    if(options.userAgent)await send("Network.setUserAgentOverride",{userAgent:options.userAgent});
    const applyViewport=async(width:number,height:number)=>{
      await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:options.deviceScaleFactor??(options.mobile?3:1),mobile:!!options.mobile});
      if(options.mobile)await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
    };
    await applyViewport(options.width,options.height);
    await send("Emulation.setEmulatedMedia",{features:[
      {name:"prefers-color-scheme",value:options.colorScheme??"light"},
      {name:"prefers-reduced-motion",value:options.reducedMotion?"reduce":"no-preference"},
    ]});
    if(options.zoom&&options.zoom!==1){
      // Text/page zoom emulation without touching the layout viewport width.
      await send("Emulation.setPageScaleFactor",{pageScaleFactor:1}).catch(()=>{});
    }
    if(options.localStorage){
      await send("Page.addScriptToEvaluateOnNewDocument",{source:
        `try{const e=${JSON.stringify(options.localStorage)};for(const k in e)localStorage.setItem(k,e[k]);}catch{}`});
    }
    const evaluate=async<T=unknown>(expression:string):Promise<T>=>{
      const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description??result.exceptionDetails.text}`);
      return result.result.value as T;
    };
    return {
      async goto(url,opts={}){
        requestLog.clear();
        const loaded=new Promise<void>(resolve=>{
          const timer=setTimeout(resolve,20000);
          browser.on("Page.loadEventFired",(_p,sid)=>{if(sid===sessionId){clearTimeout(timer);resolve();}});
        });
        await send("Page.navigate",{url});
        await loaded;
        await new Promise(r=>setTimeout(r,opts.settleMs??1500));
      },
      evaluate,
      cdp:send,
      async screenshot(file,opts={}){
        await mkdir(path.dirname(file),{recursive:true});
        const params:Record<string,unknown>={format:"png"};
        if(opts.fullPage){
          const size=await evaluate<{w:number;h:number}>("({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})");
          params.captureBeyondViewport=true;
          params.clip={x:0,y:0,width:size.w,height:Math.min(size.h,16000),scale:1};
        }
        const {data}=await send("Page.captureScreenshot",params);
        await writeFile(file,Buffer.from(data,"base64"));
      },
      async click(x,y){
        await send("Input.dispatchMouseEvent",{type:"mouseMoved",x,y});
        await send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
        await send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
      },
      async press(key,opts={}){
        const modifiers=opts.shift?8:0;
        const codes:Record<string,{code:string;vk:number;text?:string}>={
          Tab:{code:"Tab",vk:9},Escape:{code:"Escape",vk:27},Enter:{code:"Enter",vk:13,text:"\r"},
          ArrowDown:{code:"ArrowDown",vk:40},Space:{code:"Space",vk:32,text:" "},
        };
        const info=codes[key]??{code:key,vk:key.toUpperCase().charCodeAt(0),text:key};
        await send("Input.dispatchKeyEvent",{type:info.text?"keyDown":"rawKeyDown",key:key==="Space"?" ":key,code:info.code,windowsVirtualKeyCode:info.vk,modifiers,...(info.text?{text:info.text}:{})});
        await send("Input.dispatchKeyEvent",{type:"keyUp",key:key==="Space"?" ":key,code:info.code,windowsVirtualKeyCode:info.vk,modifiers});
      },
      async type(text){await send("Input.insertText",{text});},
      async setViewport(width,height){await applyViewport(width,height);},
      requests:()=>[...requestLog.values()],
      consoleErrors:()=>errors,
      async close(){await browser.send("Target.closeTarget",{targetId}).catch(()=>{});},
    };
  };
  return {newSession,close};
}

/**
 * Page-side audit expression. Runs in the page and returns a JSON-serialisable
 * report: composited text contrast, nested interactive elements, landmark counts,
 * overflow, touch targets. Kept as a string so it needs no bundling.
 */
export const PAGE_AUDIT=String.raw`(()=>{
  // Computed colours can be rgb(), color(srgb ...), oklab()/oklch() (Tailwind v4 colour
  // mixing); a 1x1 canvas converts any of them to sRGB so none is silently skipped.
  const cv=document.createElement('canvas');cv.width=cv.height=1;
  const cx2=cv.getContext('2d',{willReadFrequently:true});
  const colorCache=new Map();
  const parse=(c)=>{
    if(!c||c==='transparent')return {r:0,g:0,b:0,a:0};
    if(colorCache.has(c))return colorCache.get(c);
    let out=null;
    const m=c.match(/^rgba?\(([^)]+)\)$/);
    if(m){const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);out={r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
    else{
      // Canvas read-back of low-alpha colours is quantised (premultiplied), so split the
      // alpha off the string and read the opaque colour for accurate channels.
      let alpha=1;let opaque=c;
      const am=c.match(/\/\s*([\d.]+)(%?)\s*\)\s*$/);
      if(am){alpha=am[2]?parseFloat(am[1])/100:parseFloat(am[1]);opaque=c.replace(am[0],')');}
      cx2.clearRect(0,0,1,1);cx2.fillStyle='#000';cx2.fillStyle=opaque;cx2.fillRect(0,0,1,1);const d=cx2.getImageData(0,0,1,1).data;
      out={r:d[0],g:d[1],b:d[2],a:am?alpha:d[3]/255};
    }
    colorCache.set(c,out);return out;
  };
  const COLOR_FN=/(?:rgba?|color|oklab|oklch|lab|lch|hsla?|hwb)\([^)]*\)/g;
  const parseAll=(str)=>{const out=[];let m;COLOR_FN.lastIndex=0;while((m=COLOR_FN.exec(str))){const c=parse(m[0]);if(c)out.push(c);}return out;};
  const over=(top,bottom)=>{const a=top.a+bottom.a*(1-top.a);if(a===0)return {r:0,g:0,b:0,a:0};return {r:(top.r*top.a+bottom.r*bottom.a*(1-top.a))/a,g:(top.g*top.a+bottom.g*bottom.a*(1-top.a))/a,b:(top.b*top.a+bottom.b*bottom.a*(1-top.a))/a,a};};
  const lum=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  // Content of a closed <details> is not rendered (only its summary is), but its stale boxes still report a size.
  const inClosedDetails=(el)=>{let child=el;for(let n=el.parentElement;n;child=n,n=n.parentElement){if(n.tagName==='DETAILS'&&!n.open&&!(child.tagName==='SUMMARY'&&child.parentElement===n))return true;}return false;};
  const visible=(el)=>{const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;if(inClosedDetails(el))return false;const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none';};
  const inViewportTree=(el)=>{if(inClosedDetails(el))return false;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const cs=getComputedStyle(n);if(cs.display==='none'||cs.visibility==='hidden')return false;if(n.getAttribute&&n.getAttribute('aria-hidden')==='true')return false;}return true;};
  const effectiveOpacity=(el)=>{let o=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const v=parseFloat(getComputedStyle(n).opacity);if(!isNaN(v))o*=v;}return o;};
  // Sample a linear-gradient at a point inside its box. Chromium serialises computed
  // gradients with explicit percentage stops, so the colour under the text can be
  // evaluated instead of assuming the worst stop. Anything else falls back to the
  // conservative lightest/darkest-stop evaluation in composite().
  const splitTop=(str)=>{const out=[];let depth=0,cur='';for(const ch of str){if(ch==='(')depth++;if(ch===')')depth--;if(ch===','&&depth===0){out.push(cur.trim());cur='';}else cur+=ch;}if(cur.trim())out.push(cur.trim());return out;};
  const sampleLinear=(img,box,x,y,opacity)=>{
    const m=img.match(/^linear-gradient\((.*)\)$/s);if(!m)return null;
    const parts=splitTop(m[1]);let dirStr='to bottom';
    if(/^(to |[-\d.]+deg)/.test(parts[0])){dirStr=parts.shift().replace(/\s+in\s+\S+$/,'');}
    else if(/^in\s/.test(parts[0])){parts.shift();}
    const W=box.width,H=box.height;if(W<1||H<1)return null;
    let ang;const dm=dirStr.match(/^([-\d.]+)deg$/);
    if(dm)ang=parseFloat(dm[1]);
    else{
      const k=Math.atan2(W,H)*180/Math.PI;
      const map={'to top':0,'to right':90,'to bottom':180,'to left':270,'to top right':k,'to right top':k,'to top left':360-k,'to left top':360-k,'to bottom right':180-k,'to right bottom':180-k,'to bottom left':180+k,'to left bottom':180+k};
      ang=map[dirStr];if(ang===undefined)return null;
    }
    const th=ang*Math.PI/180;const L=Math.abs(W*Math.sin(th))+Math.abs(H*Math.cos(th));if(L<1)return null;
    const stops=[];
    for(const part of parts){
      const cm=part.match(/^((?:rgba?|color|oklab|oklch|lab|lch|hsla?|hwb)\([^)]*\))\s*(?:([-\d.]+)%)?\s*$/);
      if(!cm)return null;
      stops.push({c:parse(cm[1]),pos:cm[2]===undefined?null:parseFloat(cm[2])/100});
    }
    if(stops.length<2)return null;
    if(stops[0].pos===null)stops[0].pos=0;if(stops[stops.length-1].pos===null)stops[stops.length-1].pos=1;
    for(let i=1;i<stops.length-1;i++){if(stops[i].pos===null){let j=i;while(stops[j].pos===null)j++;const a=stops[i-1].pos,b=stops[j].pos;for(let k2=i;k2<j;k2++)stops[k2].pos=a+(b-a)*(k2-i+1)/(j-i+1);}}
    const px=x-(box.left+W/2),py=y-(box.top+H/2);
    const t=Math.min(1,Math.max(0,(px*Math.sin(th)-py*Math.cos(th))/L+0.5));
    let lo=stops[0],hi=stops[stops.length-1];
    for(let i=0;i<stops.length-1;i++){if(t>=stops[i].pos&&t<=stops[i+1].pos){lo=stops[i];hi=stops[i+1];break;}}
    const span=hi.pos-lo.pos;const f=span<=0?0:(t-lo.pos)/span;
    // CSS interpolates gradients in premultiplied space.
    const mix=(a,b)=>a+(b-a)*f;
    const al=mix(lo.c.a,hi.c.a);
    const pm=(k)=>mix(lo.c[k]*lo.c.a,hi.c[k]*hi.c.a);
    return al<=0?{r:0,g:0,b:0,a:0}:{r:pm('r')/al,g:pm('g')/al,b:pm('b')/al,a:al*opacity};
  };
  // Backdrop under the centre of a text box, taken from what is actually painted
  // there (elementsFromPoint) so sibling/pseudo-element backgrounds and gradients
  // count. Gradients are evaluated at their lightest and darkest stop; url()
  // images cannot be sampled here and are reported as imageBacked, not as a pass.
  const layersFor=(el,x,y)=>{
    const list=document.elementsFromPoint(x,y);
    let idx=list.findIndex(n=>n===el||el.contains(n)||n.contains(el));
    if(idx<0)return null;
    // the text element's own subtree may be topmost; start at the first node that is el or an ancestor
    const startIdx=list.findIndex(n=>n===el||n.contains(el));
    const chain=list.slice(startIdx<0?idx:startIdx);
    const layers=[];
    for(const n of chain){
      if(/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(n.tagName)){const io=parseFloat(getComputedStyle(n).opacity);layers.unshift({image:true,a:isNaN(io)?1:io});}
      for(const pseudo of ['::after','::before',null]){
        const cs=pseudo?getComputedStyle(n,pseudo):getComputedStyle(n);
        if(pseudo&&(cs.content==='none'||cs.content==='normal'||cs.display==='none'))continue;
        if(pseudo&&cs.position!=='absolute'&&cs.position!=='fixed')continue;
        // A pseudo-element can only be a backdrop if it covers the text box (inset-0 style overlays);
        // a thin accent rule at the corner of a block must not be treated as the backdrop.
        if(pseudo){const nb=n.getBoundingClientRect();if(parseFloat(cs.width)<nb.width*0.9||parseFloat(cs.height)<nb.height*0.9)continue;}
        const o=parseFloat(cs.opacity);const opacity=isNaN(o)?1:o;
        const bg=parse(cs.backgroundColor);
        const img=cs.backgroundImage;
        if(img&&img!=='none'){
          if(/gradient/.test(img)){
            const sampled=sampleLinear(img,n.getBoundingClientRect(),x,y,opacity);
            if(sampled)layers.unshift({color:sampled});
            else{const stops=parseAll(img);if(stops.length)layers.unshift({gradient:stops.map(c=>({...c,a:c.a*opacity}))});}
          }else layers.unshift({image:true,a:opacity});
        }
        if(bg&&bg.a>0)layers.unshift({color:{...bg,a:bg.a*opacity}});
      }
      const bgSelf=parse(getComputedStyle(n).backgroundColor);
      if(bgSelf&&bgSelf.a===1&&!layers.some(l=>l.gradient||l.image))break;
    }
    return layers;
  };
  const composite=(layers,pick)=>{
    let base={r:255,g:255,b:255,a:1};let image=false;
    for(const l of layers){
      // An image can be anything; assume the extreme least favourable to the text
      // (white for the 'light' pass, black for the 'dark' pass) and let any overlay above it dominate.
      if(l.image){image=true;const ex=pick==='light'?{r:255,g:255,b:255,a:l.a}:{r:0,g:0,b:0,a:l.a};base=over(ex,base);continue;}
      if(l.color){base=over(l.color,base);continue;}
      if(l.gradient){const sorted=[...l.gradient].sort((a,b)=>lum(a)-lum(b));const c=pick==='light'?sorted[sorted.length-1]:sorted[0];base=over(c,base);}
    }
    return {color:base,image};
  };
  const failures=[];const imageBacked=[];let checked=0;let disabledSkipped=0;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const seen=new Set();const targets=[];
  while(walker.nextNode()){
    const t=walker.currentNode;if(!t.textContent||!t.textContent.trim())continue;
    const el=t.parentElement;if(!el||seen.has(el)||!inViewportTree(el)||!visible(el))continue;
    if(el.closest('script,style,noscript,chat-widget'))continue;
    // Inactive (disabled) controls are exempt from WCAG contrast; they are counted, not hidden.
    if(el.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,fieldset:disabled,[aria-disabled="true"]')){disabledSkipped++;continue;}
    seen.add(el);targets.push([t,el]);
  }
  const originalY=window.scrollY;
  for(const [t,el] of targets){
    const cs=getComputedStyle(el);
    const fg=parse(cs.color);if(!fg)continue;
    const op=effectiveOpacity(el);
    if(op<0.05)continue;
    const range=document.createRange();range.selectNodeContents(t);const rects=range.getClientRects();if(!rects.length)continue;
    const probe=rects[0];
    if(probe.width<1||probe.height<1)continue;
    const fixedAncestor=(()=>{for(let n=el;n&&n.nodeType===1;n=n.parentElement){if(getComputedStyle(n).position==='fixed')return true;}return false;})();
    if(!fixedAncestor){
      const top=probe.top+window.scrollY;
      window.scrollTo(0,Math.max(0,top-window.innerHeight/2));
    }
    const pr=(()=>{const rr=document.createRange();rr.selectNodeContents(t);return rr.getClientRects()[0];})();
    const cx=Math.min(Math.max(pr.left+pr.width/2,1),window.innerWidth-1),cy=Math.min(Math.max(pr.top+pr.height/2,1),window.innerHeight-1);
    const layers=layersFor(el,cx,cy);
    if(!layers)continue;
    const size=parseFloat(cs.fontSize);const bold=parseInt(cs.fontWeight)>=700;
    const large=size>=24||(size>=18.66&&bold);
    const need=large?3:4.5;
    const lightBg=composite(layers,'light'),darkBg=composite(layers,'dark');
    const fgEff=(bg)=>over({...fg,a:fg.a*Math.min(1,op)},{...bg.color,a:1});
    const rL=ratio(fgEff(lightBg),{...lightBg.color,a:1}),rD=ratio(fgEff(darkBg),{...darkBg.color,a:1});
    const r=Math.min(rL,rD);
    checked++;
    const entry={text:t.textContent.trim().slice(0,60),ratio:+r.toFixed(2),need,fg:cs.color,bg:'rgb('+Math.round(darkBg.color.r)+','+Math.round(darkBg.color.g)+','+Math.round(darkBg.color.b)+')',tag:el.tagName.toLowerCase(),cls:(typeof el.className==='string'?el.className:'').slice(0,80)};
    if(r<need){if(lightBg.image||darkBg.image)imageBacked.push(entry);else failures.push(entry);}
  }
  window.scrollTo(0,originalY);
  const interactive='a[href],button,[role=button],[role=link],input:not([type=hidden]),select,textarea,summary';
  const nested=[];
  document.querySelectorAll(interactive).forEach(el=>{const inner=el.querySelector(interactive);if(inner&&el.tagName!=='LABEL')nested.push((el.tagName+'>'+inner.tagName+' '+(el.textContent||'').trim().slice(0,40)));});
  const small=[];
  document.querySelectorAll('a[href],button,[role=button],input[type=checkbox],input[type=radio],select,[role=checkbox],[role=tab]').forEach(el=>{
    if(!inViewportTree(el)||!visible(el))return;
    if(el.closest('chat-widget'))return;
    const r=el.getBoundingClientRect();
    // Inline links inside running text are exempt (WCAG 2.5.8 inline exception): the link is
    // display:inline and its parent carries text of its own outside the link.
    const inline=el.tagName==='A'&&getComputedStyle(el).display==='inline'&&el.parentElement&&((el.parentElement.textContent||'').trim().length>(el.textContent||'').trim().length+3);
    if(inline)return;
    if(r.width<44||r.height<44){
      // A checkbox/radio is also operated through its label; a label of at least 44x44, or a hit
      // area that resolves to the control at the corners of a centred 44x44 box, satisfies the target.
      const kind=el.getAttribute('role')||el.type||'';
      if(/^(checkbox|radio)$/.test(kind)){
        const lab=(el.id&&document.querySelector('label[for="'+CSS.escape(el.id)+'"]'))||el.closest('label');
        if(lab){const lr=lab.getBoundingClientRect();if(lr.width>=44&&lr.height>=44)return;}
      }
      // Hit-area extension (pseudo-element) counts: scroll the control to the middle of the
      // viewport and probe the corners and centre of a 44x44 box on it. Fixed bars are probed
      // where they are.
      {
        const fixed=(()=>{for(let n=el;n&&n.nodeType===1;n=n.parentElement){if(getComputedStyle(n).position==='fixed')return true;}return false;})();
        if(!fixed)el.scrollIntoView({block:'center',inline:'nearest'});
        const r2=el.getBoundingClientRect();
        if(r2.top>=22&&r2.bottom<=window.innerHeight-22){
          const cxm=r2.left+r2.width/2,cym=r2.top+r2.height/2;
          const hx=22;
          const pts=[[-hx+1,-21],[hx-1,-21],[-hx+1,21],[hx-1,21],[0,0]].map(([dx,dy])=>document.elementFromPoint(cxm+dx,cym+dy));
          if(pts.every(n=>n&&(n===el||el.contains(n)))){window.scrollTo(0,originalY);return;}
        }
        window.scrollTo(0,originalY);
      }
      const host=el.closest('footer,nav,header,[data-testid]');small.push({tag:el.tagName.toLowerCase(),w:Math.round(r.width),h:Math.round(r.height),text:((el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,40)),cls:(typeof el.className==='string'?el.className:'').slice(0,70),ctx:host?(host.tagName.toLowerCase()+(host.getAttribute('data-testid')?'#'+host.getAttribute('data-testid'):'')):''});}
  });
  const doc=document.documentElement;
  return {
    url:location.pathname,
    title:document.title,
    contrast:{checked,disabledSkipped,failures:failures.slice(0,60),failureCount:failures.length,imageBackedCount:imageBacked.length,imageBacked:imageBacked.slice(0,10)},
    nestedInteractive:{count:nested.length,examples:nested.slice(0,8)},
    landmarks:{main:document.querySelectorAll('main,[role=main]').length,h1:document.querySelectorAll('h1').length,h1Text:Array.from(document.querySelectorAll('h1')).map(h=>h.textContent.trim().slice(0,70))},
    overflow:{scrollWidth:doc.scrollWidth,innerWidth:window.innerWidth,horizontal:doc.scrollWidth>window.innerWidth+1},
    height:Math.max(doc.scrollHeight,document.body.scrollHeight),
    smallTargets:{count:small.length,examples:small.slice(0,10),all:small.slice(0,400)},
    htmlClass:doc.className,
    hasWidget:!!document.querySelector('chat-widget'),
  };
})()`;

/** The 27 public routes inspected for Task 2140 (shared by the public-site checks). */
export const INSPECTED_ROUTES=[
  "/","/free-analysis","/upload-statement","/estimate","/get-started",
  "/0-percent-processing","/free-smart-terminal","/shop",
  "/about-contact","/why-liberty-bancard","/case-studies",
  "/faq","/support","/help","/blog",
  "/compare-rates","/savings-calculator","/compare/square",
  "/partners","/affiliate","/areas-served","/privacy-policy",
  "/industries","/industries/restaurant-payment-processing","/industries/retail-payment-processing",
  "/industries/healthcare-payment-processing","/industries/auto-repair-payment-processing",
];
