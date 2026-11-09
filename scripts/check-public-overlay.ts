import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {launchBrowser,type Session} from "./lib/public-site-browser";

/**
 * Public overlay hit-test check (Chromium only, real vendor chat script).
 *
 *   npx tsx scripts/check-public-overlay.ts [--base=http://127.0.0.1:5000]
 *     [--out=generated-artifacts/public-site/overlay] [--strict]
 *
 * Phone viewport (390x844). The vendor chat script is NOT blocked, so the real
 * launcher paints, but this check never opens the chat panel, never types into
 * it and never creates a chat session. It only reads layout and performs
 * `elementFromPoint` hit-tests. Analytics hosts are blocked. Results are
 * Chromium evidence and are not a Safari/WebKit or real-iPhone pass.
 *
 * Each state asserts that the control a visitor must be able to tap is the
 * top-most element at its centre (never the vendor `chat-widget` host) and that
 * the vendor launcher is hidden while a higher-priority surface is active.
 */
const arg=(name:string,fallback:string)=>{
  const hit=process.argv.find(a=>a.startsWith(`--${name}=`));
  return hit?hit.slice(name.length+3):fallback;
};
const strict=process.argv.includes("--strict")||process.env.PUBLIC_SITE_STRICT==="1";

interface Probe {name:string;ok:boolean;detail:string}
const results:Probe[]=[];
const record=(name:string,ok:boolean,detail:string)=>{results.push({name,ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${name}  ${detail}`);};

const HELPERS=`
window.__hit=(selector)=>{
  const el=document.querySelector(selector);
  if(!el)return {found:false};
  const r=el.getBoundingClientRect();
  const cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);
  const top=document.elementFromPoint(cx,cy);
  const topTag=top?top.tagName.toLowerCase():null;
  return {found:true,x:cx,y:cy,w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),
    inViewport:r.top>=0&&r.bottom<=innerHeight,
    topIsTarget:!!top&&(top===el||el.contains(top)||top.contains(el)&&topTag!=="chat-widget"&&topTag!=="html"&&topTag!=="body"),
    topTag};
};
window.__widget=()=>{
  const w=document.querySelector('chat-widget');
  if(!w)return {present:false};
  const s=getComputedStyle(w);const r=w.getBoundingClientRect();
  return {present:true,visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,
    rect:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
};
window.__launcher=()=>{
  // The launcher paints inside the vendor shadow root, so measure it by hit-testing the right edge
  // from the bottom of the viewport upward until the vendor host is the top-most element.
  const x=innerWidth-40;
  for(let y=innerHeight-1;y>=innerHeight*0.5;y--){
    const t=document.elementFromPoint(x,y);
    if(t&&t.tagName.toLowerCase()==='chat-widget')return {hit:true,bottomGap:innerHeight-1-y};
  }
  return {hit:false,bottomGap:null};
};
window.__overlay=()=>document.documentElement.getAttribute('data-public-overlay');
true;`;

async function waitForWidget(session:Session,ms=15000){
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    const ready=await session.evaluate<boolean>(`!!document.querySelector('chat-widget')&&document.documentElement.hasAttribute('data-public-chat-ready')`);
    if(ready)return true;
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
}

const widgetHidden=(w:any)=>!w.present||w.visibility==="hidden"||w.pointerEvents==="none"||w.opacity==="0";

async function main(){
  const base=arg("base",process.env.BASE_URL??"http://127.0.0.1:5000").replace(/\/$/,"");
  const out=arg("out","generated-artifacts/public-site/overlay");
  const browser=await launchBrowser();
  try{
    const blockUrlParts=["google-analytics","googletagmanager","facebook.net"];
    const seeded={lb_cookie_consent:"essential",lb_cookie_prefs:JSON.stringify({necessary:true,analytics:false,marketing:false,functional:false})};

    // 1. First visit: consent banner must own the bottom of the screen.
    {
      const s=await browser.newSession({width:390,height:844,mobile:true,blockUrlParts});
      await s.goto(`${base}/`,{settleMs:1500});
      await s.evaluate(HELPERS);
      const widgetLoaded=await waitForWidget(s);
      record("first-visit: vendor widget script loaded",widgetLoaded,widgetLoaded?"chat-widget present and API ready":"vendor did not load in this environment (no launcher to hit-test)");
      await new Promise(r=>setTimeout(r,1500));
      for(const id of ["button-cookie-reject","button-cookie-accept","button-cookie-manage"]){
        const h=await s.evaluate<any>(`window.__hit('[data-testid="${id}"]')`);
        record(`first-visit: ${id} is top-most`,!!h.found&&h.topIsTarget&&h.inViewport,JSON.stringify(h));
      }
      const w=await s.evaluate<any>(`window.__widget()`);
      record("first-visit: launcher hidden while consent shows",widgetLoaded?widgetHidden(w)&&(await s.evaluate<string>(`window.__overlay()||''`)).includes("consent"):true,JSON.stringify(w));
      await s.screenshot(path.join(out,"first-visit.png"));
      await s.close();
    }

    // 2. Revisit (consent stored): dock + chat entry; launcher hidden under the dock, never on top of it.
    {
      const s=await browser.newSession({width:390,height:844,mobile:true,blockUrlParts,localStorage:seeded});
      await s.goto(`${base}/`,{settleMs:1500});
      await s.evaluate(HELPERS);
      const widgetLoaded=await waitForWidget(s);
      await s.evaluate(`window.scrollTo(0,Math.round(innerHeight*1.6));true`);
      await new Promise(r=>setTimeout(r,1500));
      const overlay=await s.evaluate<string>(`window.__overlay()||''`);
      record("revisit: dock flag published after scroll",overlay.includes("dock"),`data-public-overlay="${overlay}"`);
      const upload=await s.evaluate<any>(`window.__hit('[data-testid="link-sticky-upload"]')`);
      record("revisit: dock upload is top-most",!!upload.found&&upload.topIsTarget&&upload.inViewport,JSON.stringify(upload));
      const entry=await s.evaluate<any>(`window.__hit('[data-testid="button-sticky-chat"],[data-testid="link-sticky-call"]')`);
      record("revisit: dock help entry (chat or call) is top-most and >=44px",!!entry.found&&entry.topIsTarget&&entry.w>=44&&entry.h>=44,JSON.stringify(entry));
      record("revisit: dock help entry matches vendor state",widgetLoaded?await s.evaluate<boolean>(`!!document.querySelector('[data-testid="button-sticky-chat"]')`):await s.evaluate<boolean>(`!!document.querySelector('[data-testid="link-sticky-call"]')`),widgetLoaded?"chat entry shown (vendor ready)":"call entry shown (vendor not ready)");
      const w=await s.evaluate<any>(`window.__widget()`);
      record("revisit: launcher hidden while dock is visible",widgetLoaded?widgetHidden(w):true,JSON.stringify(w));
      const underDock=await s.evaluate<any>(`window.__launcher()`);
      record("revisit: nothing from the vendor intercepts taps above the dock",!underDock.hit,JSON.stringify(underDock));
      await s.screenshot(path.join(out,"revisit-dock.png"));

      // 2b. Top of page: no dock yet, so the launcher is allowed and must clear the bottom edge by 12px+.
      await s.evaluate(`window.scrollTo(0,0);true`);
      await new Promise(r=>setTimeout(r,1500));
      const overlayTop=await s.evaluate<string>(`window.__overlay()||''`);
      const wt=await s.evaluate<any>(`window.__widget()`);
      const launcher=await s.evaluate<any>(`window.__launcher()`);
      record("revisit: visible launcher clears the bottom edge by >=12px (or is absent)",!widgetLoaded||!launcher.hit||launcher.bottomGap>=12,`widgetLoaded=${widgetLoaded} launcher=${JSON.stringify(launcher)}`);
      record("revisit: top of page has no blocking surface",!overlayTop.includes("dock")&&!overlayTop.includes("consent"),`data-public-overlay="${overlayTop}" widget=${JSON.stringify(wt)}`);
      await s.screenshot(path.join(out,"revisit-top.png"));

      // 3. Mobile menu (dialog): menu controls must be top-most, launcher hidden.
      await s.evaluate(`document.querySelector('[data-testid="button-mobile-menu"]')?.click();true`);
      await new Promise(r=>setTimeout(r,900));
      const overlayMenu=await s.evaluate<string>(`window.__overlay()||''`);
      record("menu: dialog flag published",overlayMenu.includes("dialog"),`data-public-overlay="${overlayMenu}"`);
      const wm=await s.evaluate<any>(`window.__widget()`);
      record("menu: launcher hidden while menu is open",widgetLoaded?widgetHidden(wm):true,JSON.stringify(wm));
      const menuLink=await s.evaluate<any>(`(()=>{const d=document.querySelector('[role="dialog"][data-state="open"]');const a=d&&d.querySelector('a[href]');if(!a)return {found:false};a.setAttribute('data-hit-probe','1');return window.__hit('[data-hit-probe="1"]');})()`);
      record("menu: first menu link is top-most",!!menuLink.found&&menuLink.topIsTarget,JSON.stringify(menuLink));
      await s.screenshot(path.join(out,"menu-open.png"));
      await s.close();
    }

    // 4. Focused field on a form route: launcher hidden, field top-most.
    {
      const s=await browser.newSession({width:390,height:844,mobile:true,blockUrlParts,localStorage:seeded});
      await s.goto(`${base}/upload-statement`,{settleMs:1500});
      await s.evaluate(HELPERS);
      const widgetLoaded=await waitForWidget(s);
      const focused=await s.evaluate<boolean>(`(()=>{const f=document.querySelector('input[type="tel"],input[type="email"],input[type="text"]');if(!f)return false;f.scrollIntoView({block:'center'});f.focus();return document.activeElement===f;})()`);
      await new Promise(r=>setTimeout(r,700));
      const overlay=await s.evaluate<string>(`window.__overlay()||''`);
      record("field: a text field could be focused",focused,focused?"focused":"no text field on /upload-statement first screen");
      record("field: field flag published",overlay.includes("field"),`data-public-overlay="${overlay}"`);
      const w=await s.evaluate<any>(`window.__widget()`);
      record("field: launcher hidden while a field is focused",widgetLoaded?widgetHidden(w):true,JSON.stringify(w));
      const hit=await s.evaluate<any>(`(()=>{const f=document.activeElement;if(f)f.setAttribute('data-hit-probe','1');return window.__hit('[data-hit-probe="1"]');})()`);
      record("field: focused field is top-most",!!hit.found&&hit.topIsTarget,JSON.stringify(hit));
      await s.screenshot(path.join(out,"focused-field.png"));
      await s.close();
    }

    // 5. /areas-served (long link list): dock entry still top-most, nothing covers the page footer links.
    {
      const s=await browser.newSession({width:390,height:844,mobile:true,blockUrlParts,localStorage:seeded});
      await s.goto(`${base}/areas-served`,{settleMs:1500});
      await s.evaluate(HELPERS);
      const widgetLoaded=await waitForWidget(s);
      await s.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight);true`);
      await new Promise(r=>setTimeout(r,1500));
      const overlay=await s.evaluate<string>(`window.__overlay()||''`);
      const w=await s.evaluate<any>(`window.__widget()`);
      record("areas-served bottom: launcher never sits on the page bottom with the dock",widgetLoaded?(widgetHidden(w)||!overlay.includes("dock")):true,`data-public-overlay="${overlay}" widget=${JSON.stringify(w)}`);
      // The shared footer no longer promotes Staff Login. The bottom of the page is still where the dock could sit,
      // so the probe takes the last footer link in document order (the legal and consent row, always rendered)
      // and requires that exact link to be the top-most element at its own position.
      const staff=await s.evaluate<any>(`(()=>{const links=Array.from(document.querySelectorAll('footer a')).filter(x=>x.getClientRects().length);const a=links[links.length-1];if(!a)return {found:false};a.setAttribute('data-hit-probe','1');a.scrollIntoView({block:'center'});return window.__hit('[data-hit-probe="1"]');})()`);
      record("areas-served bottom: last footer link is top-most",!!staff.found&&staff.topIsTarget,JSON.stringify(staff));
      await s.screenshot(path.join(out,"areas-served-bottom.png"));
      await s.close();
    }
  }finally{
    await browser.close();
  }
  await mkdir(out,{recursive:true});
  await writeFile(path.join(out,"report.json"),JSON.stringify(results,null,2));
  const failed=results.filter(r=>!r.ok);
  console.log(`\n${results.length} probes, ${failed.length} failed. Report: ${path.join(out,"report.json")}`);
  if(strict&&failed.length)process.exit(1);
}

main().catch(error=>{console.error(error);process.exit(1);});
