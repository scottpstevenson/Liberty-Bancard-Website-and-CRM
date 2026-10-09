import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import crypto from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
import {privateStage3Browser} from "./fixtures/private-stage3-browser";
import {buildLocalRehearsalEnvironment} from "./local-rehearsal-core";
import {assertDisposableTestInfrastructure} from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({operation:"C1 compiled isolated browser acceptance",requireRedis:true});
const buildEnv=buildLocalRehearsalEnvironment();
execFileSync(process.execPath,["node_modules/tsx/dist/cli.mjs","script/build.ts"],{
  env:{...buildEnv,NODE_ENV:"production"},stdio:"pipe",timeout:300000,maxBuffer:12*1024*1024});
const files=execFileSync("git",["ls-files","--cached","--others","--exclude-standard","client","server","shared","package-lock.json"],{encoding:"utf8"}).trim().split("\n").sort();
const tree=crypto.createHash("sha256");
for(const file of files){tree.update(file);tree.update(await fs.readFile(file));}
const identity={sourceHead:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  candidateContentHash:tree.digest("hex"),compiledClientHash:crypto.createHash("sha256").update(await fs.readFile("dist/public/index.html")).digest("hex"),
  isolatedDatabase:true,isolatedRedis:true,providerTransports:"denied-before-import",session:"private empty-cookie Chromium; actual password login"};
let facetsUnavailable=false;
const h = await stage3BHttpFixture(async app => {
  const {isDashboardUser}=await import("../server/replit_integrations/auth");
  app.get("/api/contacts/facets",isDashboardUser,(_req,res,next)=>{
    if(facetsUnavailable)return res.status(503).json({message:"Isolated facet outage"});
    next();
  });
  const {registerContactsRoutes} = await import("../server/routes/contacts");
  const {registerCrmOperationsRoutes} = await import("../server/routes/crm-operations");
  const {registerNotificationsRoutes} = await import("../server/routes/notifications");
  const {registerTicketsTasksRoutes} = await import("../server/routes/tickets-tasks");
  const {registerMessageDraftRoutes} = await import("../server/routes/message-drafts");
  const {registerResidualsRoutes} = await import("../server/routes/residuals");
  const {registerAnalyticsRoutes} = await import("../server/routes/analytics");
  const {registerTerminalEconomicsRoutes} = await import("../server/routes/terminal-economics");
  const {registerAdminRoutes} = await import("../server/routes/admin");
  const {registerPermissionsAuditRoutes} = await import("../server/routes/permissions-audit");
  registerContactsRoutes(app); registerCrmOperationsRoutes(app);
  registerNotificationsRoutes(app); registerTicketsTasksRoutes(app); registerMessageDraftRoutes(app);
  registerResidualsRoutes(app);registerAnalyticsRoutes(app);registerTerminalEconomicsRoutes(app);registerAdminRoutes(app);
  registerPermissionsAuditRoutes(app);
  app.use("/api", (_req,res) => res.status(501).json({message:"Unregistered candidate fixture service"}));
  const {default:express}=await import("express");
  app.use(express.static(path.resolve("dist/public"),{index:false}));
  const {installC1CompiledSsrAssets}=await import("./fixtures/c1-compiled-ssr-assets");
  await installC1CompiledSsrAssets(app);
  const {registerSsrRoutes}=await import("../server/routes/ssr-routes");
  registerSsrRoutes(app);
  app.get(/.*/,(_req,res)=>res.sendFile(path.resolve("dist/public/index.html")));
});
console.log(`C1 private compiled candidate: ${h.base}; actual application login only; no public proxy`);
const publicSsrResponse=await h.originalFetch(`${h.base}/`);
const publicSsrHtml=await publicSsrResponse.text();
assert.equal(publicSsrResponse.status,200,"real public SSR response");
assert.ok(publicSsrHtml.includes('src="/assets/'),"guarded compiled candidate has real compiled asset tags");
assert.ok(!publicSsrHtml.includes('src="/src/main.tsx"')&&!publicSsrHtml.includes('src="/@vite/client"'),"no development modules served as fixture HTML");
assert.ok(!publicSsrHtml.includes("maximum-scale"),"actual SSR allows zoom");
let browser: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
const receipts:any[]=[];
const requestReceipts:Array<{role:string;requests:unknown}>=[];
const wait=async()=>new Promise(resolve=>setTimeout(resolve,350));
const waitForRows=async(count:number)=>{
  for(let i=0;i<100;i++){
    if(await browser!.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length")===count)return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await browser!.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length"),count,"actual scoped row response settled");
};
const receipt=(role:string,control:string,result:unknown)=>receipts.push({role,control,result});
try {
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1",[h.prefix+"%"]);
  const {rows:seeded}=await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to,email_status)
    SELECT 'C1 Synthetic '||n,'Person',$1||n||'@example.test','','production',$2,'active'
    FROM generate_series(1,61) AS n RETURNING id`,[h.prefix,h.email("agent")]);
  const contactId=seeded[0].id;
  for (const role of ["admin","manager","agent"] as const) {
    browser = await privateStage3Browser(h.base,"",h.originalFetch,"docs/certification/stage3-c1/browser",{realInput:true,startupTimeoutMs:30000});
    await browser.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await browser.navigate("/dashboard/contacts");
    await browser.waitFor(/Sign In/);
    assert.equal(await browser.evaluate("location.pathname"),"/login","anonymous denial precedes employee mounting");
    await browser.set('[data-testid="input-email"]',h.email(role));
    await browser.set('[data-testid="input-password"]',h.password);
    await browser.click('[data-testid="button-login"]');
    for(let i=0;i<120;i++){
      if(await browser.evaluate("location.pathname.startsWith('/dashboard')"))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(await browser.evaluate("location.pathname.startsWith('/dashboard')"),`real ${role} sign-in`);
    assert.equal(await browser.evaluate("fetch('/api/auth/user').then(r=>r.json()).then(u=>u.role)"),role);
    const listStarted=performance.now();
    await browser.navigate("/dashboard/contacts");
    await browser.waitFor(/C1 Synthetic/);
    const usefulListMs=performance.now()-listStarted;
    assert.ok(usefulListMs<=2500,`declared 61-row useful-list limit: ${usefulListMs.toFixed(0)}ms`);
    assert.equal(await browser.evaluate("document.querySelectorAll('h1').length"),1);
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=select-people-page-size]').value"),"50");
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length"),50);
    receipt(role,"people-default",{pageSize:50,syntheticVolume:61,realRows:true,oneH1:true,usefulListMs});
     assert.equal(await browser.evaluate("document.querySelector('[data-testid=preset-people-mine]').disabled"),role!=="agent");
     if(role!=="agent"){
       const before=browser.requests.length;
       await browser.navigate("/dashboard/contacts?assignedToMe=true");
       await browser.waitFor(/Assigned-to-me filtering is unavailable for this role/);
       await browser.waitFor(/C1 Synthetic/);
       assert.ok(!browser.requests.slice(before).some(r=>/\/api\/contacts(?:\/facets)?\?.*assignedToMe=true/.test(r.url)),
         "unsupported assignment filter never reaches either reader");
       receipt(role,"unsupported-mine-preset",{disabled:true,directLinkSafe:true,noUnsupportedReaderFilter:true});
       await browser.navigate("/dashboard/contacts");await browser.waitFor(/C1 Synthetic/);
     }
    await browser.click('[data-testid="checkbox-select-all"]');
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=checkbox-select-all]').getAttribute('aria-checked')"),"true");
    await browser.click('[data-testid="button-contacts-next"]');
     await waitForRows(11);
    assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('offset')"),"50");
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length"),11);
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=checkbox-select-all]').getAttribute('aria-checked')"),"false");
    await browser.call("Runtime.evaluate",{expression:"history.back()"});
    await wait();
    assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('offset')"),null);
    const localStarted=performance.now();
    await browser.set('[data-testid="input-search-contacts"]',"C1 Synthetic 61");
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=input-search-contacts]').value"),"C1 Synthetic 61");
    const localResponseMs=performance.now()-localStarted;
    assert.ok(localResponseMs<=200,`local input response: ${localResponseMs.toFixed(0)}ms`);
     await waitForRows(1);
    assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('search')"),"C1 Synthetic 61");
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length"),1);
    receipt(role,"search/back/paging",{debounced:true,resetPage:true,history:true,localResponseMs});
    await browser.navigate("/dashboard/contacts");
    await browser.waitFor(/C1 Synthetic/);
    facetsUnavailable=true;
    await browser.navigate("/dashboard/contacts?search=Synthetic");
     await browser.waitFor(/Count unavailable/);
    await browser.waitFor(/C1 Synthetic/);
    assert.ok(await browser.evaluate("document.querySelectorAll('[data-testid^=contacts-table-row-]').length>0"));
     assert.equal(await browser.evaluate("document.querySelector('[data-testid=stat-count-all]').textContent"),"Unknown");
    facetsUnavailable=false;
    receipt(role,"facets-unavailable",{rowsUsable:true,notZero:true});
     for(const malformed of ["1.5","1e1","Jane"]){
       const before=browser.requests.length;
       await browser.navigate(`/dashboard/contacts/${malformed}`);
       await browser.waitFor(/not a valid local Contact ID/);
       assert.ok(!browser.requests.slice(before).some(r=>/^\/api\/contacts\/\d/.test(r.url)),
         "invalid typed identity cannot open a normalized different record");
       await browser.click('[data-testid="link-invalid-contact-people"]');
       await browser.waitFor(/C1 Synthetic/);
     }
     receipt(role,"invalid-record-identity",{noRecordReads:true,actualPeopleFallback:true});
    await browser.navigate(`/dashboard/contacts/${contactId}`);
    await browser.waitFor(/C1 Synthetic/);
    assert.equal(await browser.evaluate("document.querySelectorAll('h1').length"),1);
    if(role==="admin"){
       await browser.click('[data-testid="contact-more-actions"]');
       await browser.waitFor(/Edit contact/i);
       await browser.click('[data-testid="menu-action-edit"]');
       // Current C2 editor is inline. The native input helper verifies the
       // actual target; do not wait for a retired modal title.
      await browser.set('[data-testid="input-edit-firstname"]',"C1 Synthetic Updated");
      await browser.click('[data-testid="button-save-edit"]');
      await browser.waitFor(/C1 Synthetic Updated/);
      const readback=await h.pool.query("SELECT first_name FROM contacts WHERE id=$1",[contactId]);
      assert.equal(readback.rows[0].first_name,"C1 Synthetic Updated");
      receipt(role,"record-header-edit",{realCommand:true,csrf:true,durableReadback:true});
    }
    await browser.click('[data-testid="button-back"]');
    await browser.waitFor(/People/);
    await browser.evaluate("localStorage.setItem('prefer_desktop','true')");
    if(role==="admin"){
      await browser.click('[data-testid="button-add-contact"]');
      await browser.waitFor(/Create New Contact/);
      // Measure stable targets, not the transient entry zoom animation.
      await browser.evaluate("Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
      assert.ok(await browser.evaluate("!!document.querySelector('[role=dialog].crm-theme.crm-portal')"),"employee dialog portal theme");
      const measured=await browser.evaluate(`({
        font:getComputedStyle(document.querySelector('h1')).fontFamily,
        titleSize:getComputedStyle(document.querySelector('h1')).fontSize,
        close:document.querySelector('[role=dialog] > button:last-child').getBoundingClientRect().height,
        bodyFontLoaded:[...document.fonts].some(f=>f.family==='IBM Plex Sans'&&f.status==='loaded')
      })`);
      assert.match(measured.font,/IBM Plex Sans/);assert.equal(measured.titleSize,"24px");
      assert.ok(measured.bodyFontLoaded);assert.ok(measured.close>=44,JSON.stringify(measured));
      await browser.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      await wait();
      assert.equal(await browser.evaluate("document.querySelector('[role=dialog]')"),null);
      assert.equal(await browser.evaluate("document.activeElement?.getAttribute('data-testid')"),"button-add-contact");
      receipt(role,"employee-dialog-font-focus",{...measured,escape:true});
    }
    for(const width of role==="admin"?[320,390,768,1280,1440]:[390,1440]){
      await browser.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      await wait();
      assert.ok(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),`no full-page overflow ${width}`);
      await browser.screenshot(`${role}-people-${width}-light`);
      receipt(role,`layout-${width}`,{noPageOverflow:true});
    }
    await browser.evaluate("document.documentElement.classList.add('dark')");
    await browser.screenshot(`${role}-people-dark`);
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.crm-theme')).getPropertyValue('--background').trim()"),"222 47% 11%");
    await browser.evaluate("document.documentElement.classList.remove('dark')");
    await browser.call("Emulation.setDeviceMetricsOverride",{width:720,height:500,deviceScaleFactor:2,mobile:false});
    await wait();
    assert.ok(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),"720px density-emulated desktop reflow; not native browser zoom");
    await browser.screenshot(`${role}-people-density-reflow`);
    receipt(role,"density-emulated-reflow",{width:720,deviceScaleFactor:2,nativeZoomVerified:false});
    await browser.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await browser.navigate("/dashboard/financial-hub?tab=forecasting#history");
    if(role==="agent"){
      await browser.waitFor(/Access denied|permission|Dashboard|Overview/i);
      assert.ok(!browser.requests.some(r=>r.url.startsWith("/api/forecasting/summary")),"agent has no Financial child fetch");
    }else{
      await browser.waitFor(/Revenue Forecasting|Forecasting/);
      assert.equal(await browser.evaluate("document.querySelector('[data-testid=tab-financial-forecasting]').getAttribute('data-state')"),"active");
      assert.ok(browser.requests.some(r=>r.url==="/api/forecasting/summary"));
      await browser.click('[data-testid="tab-financial-terminal-roi"]');
      await browser.waitFor(/Terminal ROI/);
      assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('financialTab')"),"terminal-roi");
      await browser.call("Runtime.evaluate",{expression:"history.back()"});
      await wait();
      assert.equal(await browser.evaluate("document.querySelector('[data-testid=tab-financial-forecasting]').getAttribute('data-state')"),"active");
      receipt(role,"Financial-mounted-alias-click-back",{realSelectedChild:true,request:true});
    }
    if(role!=="agent"){
      const before=browser.requests.length;
      await browser.navigate("/dashboard/system-health?tab=monitor&view=worker-heartbeats");
      if(role==="manager"){
        await browser.waitFor(/forbidden/);
        assert.equal(await browser.evaluate("document.querySelector('[data-testid=tab-system-monitor]')"),null);
        assert.ok(!browser.requests.slice(before).some(r=>/operator|heartbeats/.test(r.url)));
      }else{
        await browser.waitFor(/Worker Heartbeats/i);
        assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('tab')"),"monitor");
      }
      receipt(role,"Operator-parent-child",{managerMonitorDenied:role==="manager",parentPreserved:true});
    }
    await browser.screenshot(`${role}-compatibility`);
    assert.equal(browser.exceptions.length,0,`no runtime exceptions for ${role}`);
    requestReceipts.push({role,requests:browser.requests});
    await browser.close(); browser=undefined;
  }
  for(const role of ["merchant","partner"] as const){
    browser=await privateStage3Browser(h.base,"",h.originalFetch,"docs/certification/stage3-c1/browser",{realInput:true,startupTimeoutMs:30000});
    await browser.navigate("/login");await browser.waitFor(/Sign In/);
    await browser.set('[data-testid="input-email"]',h.email(role));
    await browser.set('[data-testid="input-password"]',h.password);
    await browser.click('[data-testid="button-login"]');await wait();await wait();
     assert.equal(await browser.evaluate("fetch('/api/auth/user').then(r=>r.json()).then(u=>u.role)"),role,
       "portal isolation requires the actual authenticated fixture role");
    await browser.navigate("/dashboard/contacts");await wait();await wait();
    assert.equal(await browser.evaluate("document.querySelector('.crm-theme')"),null,"nonemployee branding isolated");
    assert.ok(!browser.requests.some(r=>/^\/api\/contacts(?:\\?|$)/.test(r.url)),"no People request for nonemployee portal");
    await browser.screenshot(`${role}-isolation`);
    receipt(role,"portal-isolation",{actualLogin:true,noEmployeeTheme:true,noPeopleRead:true});
    requestReceipts.push({role,requests:browser.requests});
    await browser.close();browser=undefined;
  }
  browser=await privateStage3Browser(h.base,"",h.originalFetch,"docs/certification/stage3-c1/browser",{realInput:true,zoom:2,startupTimeoutMs:30000});
  await browser.navigate("/login");await browser.waitFor(/Sign In/);
  await browser.set('[data-testid="input-email"]',h.email("admin"));
  await browser.set('[data-testid="input-password"]',h.password);
  await browser.click('[data-testid="button-login"]');await wait();await wait();
   assert.equal(await browser.evaluate("fetch('/api/auth/user').then(r=>r.json()).then(u=>u.role)"),"admin");
  await browser.evaluate("localStorage.setItem('prefer_desktop','true')");
  await browser.navigate("/dashboard/contacts");await browser.waitFor(/C1 Synthetic/);
  const zoom=await browser.evaluate("({cssWidth:innerWidth,pixelRatio:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1})");
  assert.equal(zoom.pixelRatio,2,"real Chromium persisted default browser zoom is 200%");
  assert.equal(zoom.overflow,false);
  await browser.screenshot("admin-real-browser-zoom-200");
  receipt("admin","actual-browser-zoom-200",zoom);
  await browser.close();browser=undefined;
  assert.equal(h.externalCalls(),0);
  await fs.writeFile("docs/certification/stage3-c1/browser/receipts.json",JSON.stringify({identity,candidateUrl:h.base,status:"passed-declared-capabilities-only",receipts,requestReceipts},null,2));
  console.log(`C1 compiled real sign-in and adopted browser receipts: ${receipts.length}; not a full roster/deploy approval.`);
} finally {
  await fs.mkdir("docs/certification/stage3-c1/browser",{recursive:true});
  await fs.writeFile("docs/certification/stage3-c1/browser/attempt.json",JSON.stringify({identity,candidateUrl:h.base,receipts,requestReceipts},null,2));
  if(browser)await fs.writeFile("docs/certification/stage3-c1/browser/last-requests.json",JSON.stringify(browser.requests,null,2));
  await browser?.close(); await h.close();
}
