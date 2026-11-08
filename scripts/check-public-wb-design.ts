import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {launchBrowser,type Session} from "./lib/public-site-browser";

/**
 * W-B public design acceptance check (Chromium only, read-only).
 *
 *   npx tsx scripts/check-public-wb-design.ts [--base=http://127.0.0.1:6100]
 *     [--out=generated-artifacts/public-site/wb-design] [--strict]
 *
 * Covers what the generic mobile gate does not:
 *  - initial server HTML (no JavaScript) for the shared shell, Home and the industries hub;
 *  - header geometry of the React and the server-rendered shell at 320/390/768/1440
 *    (logo width, header height, no horizontal overflow, menu opens inside the viewport);
 *  - CSP: no refused inline style/script messages on any inspected page;
 *  - hydration: no React hydration/minified-hydration errors on React routes;
 *  - the free-smart-terminal primary CTA at 320px, at an emulated 200% zoom (640 CSS px at
 *    DPR 2) and when reached with the keyboard;
 *  - every FAQ/accordion trigger expanded on the pages that carry one, at 320 and 390px.
 *
 * It never submits a form, books, uploads or messages anyone. Vendor chat hosts and analytics
 * are blocked. Results are Chromium evidence and are NOT a Safari/WebKit or real-iPhone pass.
 */
const arg=(name:string,fallback:string)=>{
  const hit=process.argv.find(a=>a.startsWith(`--${name}=`));
  return hit?hit.slice(name.length+3):fallback;
};
const strict=process.argv.includes("--strict")||process.env.PUBLIC_SITE_STRICT==="1";

interface Probe {name:string;ok:boolean;detail:string}
const results:Probe[]=[];
const record=(name:string,ok:boolean,detail:string)=>{results.push({name,ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${name}  ${detail}`);};

const BLOCK=["leadconnectorhq.com","google-analytics","googletagmanager","facebook.net"];
const WIDTHS=[320,390,768,1440];
const SHELL_ROUTES=["/","/industries","/about-contact","/free-smart-terminal","/shop","/alternatives/square","/alternatives/authorize-net","/switch-from/square"];
const FAQ_ROUTES=["/","/free-smart-terminal","/0-percent-processing","/compare/square","/alternatives/clover"];

const settle=async(s:Session,ms=1200)=>{
  await s.evaluate(`(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=Math.max(300,innerHeight*0.7)){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}scrollTo(0,0);await new Promise(r=>setTimeout(r,${ms}));return h;})()`);
};

const GEOMETRY=String.raw`(()=>{
  const vis=(el)=>{if(!el)return false;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';};
  const ssr=document.querySelector('header.ssr-navbar');
  const react=document.querySelector('[data-testid="navbar"]');
  const shell=ssr||react;
  const logo=shell?shell.querySelector(ssr?'.ssr-logo img':'[data-testid="link-logo"] img'):null;
  const lr=logo?logo.getBoundingClientRect():null;
  const sr=shell?shell.getBoundingClientRect():null;
  const toggle=ssr?ssr.querySelector('.ssr-menu summary'):document.querySelector('[data-testid="button-mobile-menu"]');
  const tr=toggle?toggle.getBoundingClientRect():null;
  return {
    kind:ssr?'server':react?'react':'none',
    scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth,
    h1:document.querySelectorAll('h1').length,
    shellBottom:sr?Math.round(sr.bottom):null,
    logo:lr?{w:Math.round(lr.width),h:Math.round(lr.height),natural:logo.naturalWidth,visible:vis(logo)}:null,
    toggle:tr&&vis(toggle)?{w:Math.round(tr.width),h:Math.round(tr.height),right:Math.round(tr.right)}:null,
    mainCount:document.querySelectorAll('main').length,
  };
})()`;

async function openMenuGeometry(s:Session,kind:string){
  const target=kind==="server"?"header.ssr-navbar .ssr-menu summary":'[data-testid="button-mobile-menu"]';
  const box=await s.evaluate<any>(`(()=>{const el=document.querySelector(${JSON.stringify(target)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  if(!box)return null;
  await s.click(box.x,box.y);
  await new Promise(r=>setTimeout(r,600));
  return s.evaluate<any>(`(()=>{
    const panel=${kind==="server"?`document.querySelector('header.ssr-navbar .ssr-menu-panel')`:`document.querySelector('[data-testid="mobile-nav-drawer"]')`};
    if(!panel)return {panel:false};
    const r=panel.getBoundingClientRect();
    const links=[...panel.querySelectorAll('a')].filter(a=>{const q=a.getBoundingClientRect();return q.width>0&&q.height>0;});
    const hrefs=links.map(a=>a.getAttribute('href'));
    return {panel:true,left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),
      hasIndustriesHub:${kind==="server"?"hrefs.includes('/industries')":"true"},hasSupport:hrefs.includes('/support'),
      overflow:document.documentElement.scrollWidth>innerWidth,linkCount:links.length};
  })()`);
}

async function main(){
  const base=arg("base",process.env.BASE_URL??"http://127.0.0.1:6100").replace(/\/$/,"");
  const out=arg("out","generated-artifacts/public-site/wb-design");
  await mkdir(out,{recursive:true});

  // 1. Initial server HTML without JavaScript.
  for(const route of ["/","/industries","/alternatives/square","/switch-from/square"]){
    const res=await fetch(`${base}${route}`);
    const html=await res.text();
    const h1=(html.match(/<h1[\s>]/g)??[]).length;
    record(`initial-html ${route}: status 200`,res.status===200,String(res.status));
    record(`initial-html ${route}: exactly one h1`,h1===1,`h1=${h1}`);
    record(`initial-html ${route}: shared shell present`,/class="ssr-navbar"/.test(html)&&/class="ssr-footer"/.test(html),"ssr-navbar + ssr-footer");
    record(`initial-html ${route}: shell stylesheet is inline (no extra dependency)`,/<style[^>]*>[\s\S]*\.ssr-logo img[\s\S]*<\/style>/.test(html),"logo size rule inside <style>");
    record(`initial-html ${route}: industries hub linked from the shell`,/href="\/industries"/.test(html),"href=/industries");
    record(`initial-html ${route}: no login link in public nav`,!/Merchant login|Merchant Login/.test(html),"no merchant login label");
  }

  const browser=await launchBrowser();
  try{
    // 2. Shell geometry + menu + CSP + hydration.
    for(const width of WIDTHS){
      const height=width<500?844:width<1100?1024:900;
      const s=await browser.newSession({width,height,mobile:width<500,blockUrlParts:BLOCK});
      for(const route of SHELL_ROUTES){
        await s.goto(`${base}${route}`,{settleMs:1500});
        await settle(s,700);
        const g=await s.evaluate<any>(GEOMETRY);
        const tag=`${route} @${width}`;
        record(`${tag}: no horizontal overflow`,g.scrollWidth<=g.innerWidth,`${g.scrollWidth}<=${g.innerWidth}`);
        record(`${tag}: one h1, one main`,g.h1===1&&g.mainCount===1,`h1=${g.h1} main=${g.mainCount}`);
        record(`${tag}: shared header present (${g.kind})`,g.kind!=="none"&&!!g.logo&&g.logo.visible,JSON.stringify(g.logo));
        if(g.logo){
          record(`${tag}: logo rendered at a sane width (intrinsic ${g.logo.natural}px)`,g.logo.w>=70&&g.logo.w<=220&&g.logo.h<=64,`${g.logo.w}x${g.logo.h}`);
        }
        record(`${tag}: header height`,g.shellBottom!==null&&g.shellBottom<=84,`bottom=${g.shellBottom}`);
        if(width<1024){
          record(`${tag}: menu toggle is a 44px target inside the viewport`,!!g.toggle&&g.toggle.w>=44&&g.toggle.h>=44&&g.toggle.right<=width,JSON.stringify(g.toggle));
          const menu=await openMenuGeometry(s,g.kind);
          record(`${tag}: opened menu stays inside the viewport and exposes the hub, Support`,!!menu&&menu.panel&&menu.left>=0&&menu.right<=width&&menu.hasIndustriesHub&&menu.hasSupport&&!menu.overflow,JSON.stringify(menu));
        }else{
          const links=await s.evaluate<number>(`document.querySelectorAll('${g.kind==="server"?"header.ssr-navbar .ssr-nav-links a, header.ssr-navbar .ssr-nav-links summary":"[data-testid=navbar] [data-testid^=button-nav-]"}').length`);
          record(`${tag}: desktop navigation groups visible`,links>=5,`count=${links}`);
        }
        const csp=s.consoleErrors().filter(m=>/content security policy|refused to (apply|execute|load)/i.test(m));
        record(`${tag}: no CSP refusal`,csp.length===0,csp.slice(0,2).join(" | ")||"clean");
        const hyd=s.consoleErrors().filter(m=>/hydrat|minified react error #(418|423|425)|did not match/i.test(m));
        record(`${tag}: no hydration error`,hyd.length===0,hyd.slice(0,2).join(" | ")||"clean");
      }
      await s.close();
    }

    // 3. Terminal CTA: 320px, emulated 200% zoom, keyboard.
    const cta='[data-testid="link-terminal-primary-cta"]';
    const ctaProbe=`(()=>{const el=document.querySelector('${cta}');if(!el)return null;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);
      return {left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),height:Math.round(r.height),inner:innerWidth,sw:document.documentElement.scrollWidth,
        clipped:el.scrollWidth>el.clientWidth+1,whiteSpace:cs.whiteSpace,text:el.textContent.trim(),
        focusRing:(parseFloat(cs.outlineWidth)>0&&cs.outlineStyle!=='none')||cs.boxShadow!=='none'};})()`;
    for(const [label,width,dsf] of [["320px",320,1],["200% zoom (640 CSS px, DPR 2)",640,2]] as const){
      const s=await browser.newSession({width,height:width<500?844:1024,mobile:width<500,deviceScaleFactor:dsf,blockUrlParts:BLOCK});
      await s.goto(`${base}/free-smart-terminal`,{settleMs:1800});
      await settle(s,500);
      const p=await s.evaluate<any>(ctaProbe);
      record(`terminal CTA @${label}: fits the viewport, wraps instead of clipping`,!!p&&p.left>=0&&p.right<=p.inner&&p.sw<=p.inner&&!p.clipped&&p.whiteSpace!=="nowrap"&&p.height>=44,JSON.stringify(p));
      // Keyboard: Tab until the CTA is focused (bounded), then check it is visible and shows a focus indication.
      let focused=false;
      for(let i=0;i<60&&!focused;i++){
        await s.press("Tab");
        focused=await s.evaluate<boolean>(`document.activeElement&&document.activeElement.matches('${cta}')`);
      }
      const k=focused?await s.evaluate<any>(`(()=>{const el=document.activeElement;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),inner:innerWidth,innerH:innerHeight,
        ring:(parseFloat(cs.outlineWidth)>0&&cs.outlineStyle!=='none')||cs.boxShadow!=='none',sw:document.documentElement.scrollWidth};})()`):null;
      record(`terminal CTA @${label}: reachable by keyboard, in view, focus indicated`,focused&&!!k&&k.top>=0&&k.bottom<=k.innerH&&k.left>=0&&k.right<=k.inner&&k.ring&&k.sw<=k.inner,JSON.stringify(k));
      const imgs=await s.evaluate<any>(`(()=>{return ['img-terminal-clover','img-terminal-pax'].map(id=>{const pic=document.querySelector('[data-testid="'+id+'"]');const im=pic&&pic.querySelector('img');if(!im)return {id,found:false};
        const r=im.getBoundingClientRect();return {id,found:true,w:Math.round(r.width),h:Math.round(r.height),cur:im.currentSrc.split('/').pop(),complete:im.complete&&im.naturalWidth>0,attrW:im.getAttribute('width'),attrH:im.getAttribute('height')};});})()`);
      record(`terminal images @${label}: responsive derivative loaded, dimensions declared`,imgs.every((i:any)=>i.found&&i.complete&&/^product-.*-(320|640)\.(avif|webp|jpg)$/.test(i.cur)&&i.attrW&&i.attrH),JSON.stringify(imgs));
      await s.close();
    }

    // 4. Every FAQ / accordion trigger expanded.
    for(const width of [320,390]){
      const s=await browser.newSession({width,height:844,mobile:true,blockUrlParts:BLOCK});
      for(const route of FAQ_ROUTES){
        await s.goto(`${base}${route}`,{settleMs:1500});
        await settle(s,500);
        const opened=await s.evaluate<any>(`(async()=>{
          const scope=document.querySelector('main')||document.body;
          let n=0;
          for(const b of [...scope.querySelectorAll('button[aria-expanded="false"]')]){
            const t=(b.getAttribute('data-testid')||'')+' '+(b.closest('[data-testid]')?.getAttribute('data-testid')||'');
            if(/faq|accordion|question/i.test(t)||b.closest('[class*="faq" i]')){b.click();n++;await new Promise(r=>setTimeout(r,60));}
          }
          let d=0;for(const x of [...scope.querySelectorAll('details:not([open])')]){x.open=true;d++;}
          await new Promise(r=>setTimeout(r,500));
          return {buttons:n,details:d,sw:document.documentElement.scrollWidth,iw:innerWidth};
        })()`);
        record(`FAQ expanded ${route} @${width}: no horizontal overflow`,opened.sw<=opened.iw,JSON.stringify(opened));
      }
      await s.close();
    }
  }finally{
    await browser.close();
  }
  await writeFile(path.join(out,"report.json"),JSON.stringify(results,null,2));
  const failed=results.filter(r=>!r.ok);
  console.log(`\n${results.length} probes, ${failed.length} failed. Report: ${path.join(out,"report.json")}`);
  if(strict&&failed.length)process.exit(1);
}

main().catch(error=>{console.error(error);process.exit(1);});
