import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
import {privateStage3Browser} from "./fixtures/private-stage3-browser";
let vite:import("vite").ViteDevServer|undefined;
const h=await stage3BHttpFixture(async app=>{
  const {default:express}=await import("express");
  const {registerContactsRoutes}=await import("../server/routes/contacts");
  const {registerCrmOperationsRoutes}=await import("../server/routes/crm-operations");
  const {registerKnowledgeAdminRoutes}=await import("../server/routes/knowledge-admin");
  const {registerMessageDraftRoutes}=await import("../server/routes/message-drafts");
  const {registerNotificationsRoutes}=await import("../server/routes/notifications");
  const {registerTicketsTasksRoutes}=await import("../server/routes/tickets-tasks");
  const {registerWorkflowsRoutes}=await import("../server/routes/workflows");
  const {registerAdminRoutes}=await import("../server/routes/admin");
  registerContactsRoutes(app);registerCrmOperationsRoutes(app);registerKnowledgeAdminRoutes(app);
  registerMessageDraftRoutes(app);registerNotificationsRoutes(app);registerTicketsTasksRoutes(app);
  registerWorkflowsRoutes(app);registerAdminRoutes(app);
  // Missing unrelated fixture services fail explicitly, never fabricate data.
  app.use("/api",(_req,res)=>res.status(501).json({message:"Unregistered fixture service"}));
  app.use(express.static(path.resolve("dist/public"),{index:false}));
  // Actual public SSR renderers use the same development asset contract as
  // the application. A private middleware-mode Vite serves those assets.
  const {createServer}=await import("vite");
  vite=await createServer({configFile:path.resolve("vite.config.ts"),appType:"custom",
    server:{middlewareMode:true,host:"127.0.0.1",hmr:false}});
  app.use(vite.middlewares);
  const {registerSsrRoutes}=await import("../server/routes/ssr-routes");
  registerSsrRoutes(app);
  app.get(/.*/,(_req,res)=>res.sendFile(path.resolve("dist/public/index.html")));
});
let browser:Awaited<ReturnType<typeof privateStage3Browser>>|undefined;
try {
  const contact=(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class)
    VALUES('Browser','Retained',$1,'','production') RETURNING id`,[`browser-${randomUUID()}@example.test`])).rows[0];
  await h.pool.query(`INSERT INTO knowledge_sources(title,source_type,status,audience,content)
    VALUES('Browser knowledge fixture','text_block','draft','staff','Fixture content')`);
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id=$1",[h.userId("admin")]);
  browser=await privateStage3Browser(h.base,h.sessions.get("admin")!.cookie,h.originalFetch);
  await browser.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.navigate("/dashboard/knowledge-admin");
  await browser.waitFor(/Browser knowledge fixture/);
  await browser.screenshot("knowledge-desktop");
  browser.failRead("/api/knowledge/sources");
  await browser.navigate("/dashboard/knowledge-admin");
  await browser.waitFor(/Retry/);
  assert.ok(!/No sources/.test(await browser.text()),"failed list is never an empty-library claim");
  browser.failRead(null);
  await browser.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='Retry sources').click()");
  await browser.waitFor(/Browser knowledge fixture/);
  await browser.navigate("/dashboard/contacts");
  await browser.waitFor(/Browser Retained/);
  // Radix triggers use a pointer event; menu activation and native confirmation
  // are exercised in the actual page, not with direct request substitutes.
  const openMenu=()=>browser!.evaluate(`document.querySelector('[data-testid="button-actions-${contact.id}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,ctrlKey:false}))`);
  await openMenu();await browser.waitFor(/Archive/);
  browser.acceptDialogs(false);
  await browser.click(`[data-testid="menu-archive-contact-${contact.id}"]`);
  assert.equal((await h.pool.query("SELECT archived_at FROM contacts WHERE id=$1",[contact.id])).rows[0].archived_at,null,"Cancel performs no lifecycle write");
  await openMenu();await browser.waitFor(/Archive/);
  browser.acceptDialogs(true);
  await browser.click(`[data-testid="menu-archive-contact-${contact.id}"]`);
  await browser.waitFor(/Contact archived/);
  assert.ok((await h.pool.query("SELECT archived_at FROM contacts WHERE id=$1",[contact.id])).rows[0].archived_at);
  await browser.navigate("/dashboard/contacts?archived=true");
  await browser.waitFor(/Browser Retained/);
  await browser.click(`[data-testid="button-restore-contact-${contact.id}"]`);
  await browser.waitFor(/Contact restored/);
  assert.equal((await h.pool.query("SELECT archived_at FROM contacts WHERE id=$1",[contact.id])).rows[0].archived_at,null);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action IN ('contact_archived','contact_restored')",[contact.id])).rows[0].n,2);
  await browser.navigate(`/dashboard/contacts/${contact.id}`);
  await browser.waitFor(/Browser Retained/);
  await browser.click('[data-testid="button-compose-email-contact"]');
  await browser.waitFor(/Saving never sends|No saved draft/);
  await browser.set('[data-testid="input-email-subject"]',"Retained browser draft");
  await browser.set('[data-testid="textarea-email-body"]',"Saved through the existing contextual composer. Not sent.");
  await browser.click('[data-testid="button-save-email-draft"]');
  await browser.waitFor(/Draft saved \(v1\)/);
  await browser.navigate(`/dashboard/contacts/${contact.id}`);
  await browser.waitFor(/Browser Retained/);
  await browser.click('[data-testid="button-compose-email-contact"]');
  await browser.waitFor(/Draft saved \(v1\)/);
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=\"input-email-subject\"]').value"),"Retained browser draft");
  assert.match(await browser.evaluate("document.querySelector('[data-testid=\"textarea-email-body\"]').value"),/Saved through the existing/);
  await browser.screenshot("contact-draft-desktop");
  await browser.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
  await browser.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
  assert.ok(await browser.evaluate("document.activeElement.tagName!=='BODY'"),"keyboard focus stays in interactive draft dialog");
  await browser.call("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await browser.waitFor(/Switch to desktop view/);
  await browser.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('Switch to desktop view')).click()");
  // The actual switch hard-navigates to Overview. Wait for that navigation
  // before reopening the contact; otherwise it can win the next navigation.
  await browser.waitFor(/Toggle Sidebar/);
  assert.equal(await browser.evaluate("location.pathname"),"/dashboard");
  await browser.navigate(`/dashboard/contacts/${contact.id}`);
  await browser.waitFor(/Browser Retained/);
  await browser.click('[data-testid="button-compose-email-contact"]');
  await browser.waitFor(/Draft saved \(v1\)/);
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=\"input-email-subject\"]').value"),"Retained browser draft");
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true,"phone desktop-view draft has no horizontal overflow");
  await new Promise(resolve=>setTimeout(resolve,300));
  const phoneDialog=await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="dialog-email-composer"]').getBoundingClientRect();
    const s=getComputedStyle(document.querySelector('[data-testid="dialog-email-composer"]'));
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,translate:s.translate,transform:s.transform}})()`);
  console.log("Phone draft viewport/geometry",JSON.stringify(phoneDialog));
  await browser.screenshot("contact-draft-phone");
  assert.ok(phoneDialog.left>=-1 && phoneDialog.top>=-1 && phoneDialog.right<=403 && phoneDialog.bottom<=875,
    "actual phone dialog, not just document overflow, fits within the viewport");
  // Public SSR survives React mounting and reload. No forms are submitted.
  for(const width of [1440,402]){
    await browser.call("Emulation.setDeviceMetricsOverride",{width,height:874,deviceScaleFactor:1,mobile:width<500});
    await browser.navigate("/");
    await browser.waitFor(/Credit Card Processing\s+Without the Rate Games/);
    for(let attempt=0;attempt<100;attempt++){
      if(await browser.evaluate("!!document.querySelector('[data-testid=\"text-hero-heading\"]')"))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const home=await browser.evaluate(`(()=>{const e=document.querySelector('[data-testid="text-hero-heading"]');
      return e?{font:getComputedStyle(e).fontSize,fallback:!!document.querySelector('style[data-ssr-fallback-styles]'),
        overflow:document.documentElement.scrollWidth>innerWidth+1}:null})()`);
    assert.ok(home,"React mounted the actual public Home");
    assert.equal(home.fallback,true,"real SSR head stylesheet survives React mounting");
    assert.equal(home.font,width===1440?"68px":"28px");assert.equal(home.overflow,false);
    for(let attempt=0;attempt<100;attempt++){
      if(await browser.evaluate("Number(getComputedStyle(document.querySelector('[data-testid=\"text-hero-heading\"]')).opacity)>.99"))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(await browser.evaluate("Number(getComputedStyle(document.querySelector('[data-testid=\"text-hero-heading\"]')).opacity)>.99"),true,
      "hydrated public hero becomes visible after its real entrance animation");
    await browser.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
    await browser.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
    assert.ok(await browser.evaluate("document.activeElement.tagName!=='BODY'"),"public keyboard focus is usable");
    await browser.screenshot(`public-home-${width}`);
    await browser.navigate("/upload-statement");
    await browser.waitFor(/Upload Your Statement|Upload.*Statement/i);
    assert.equal(await browser.evaluate("!!document.querySelector('style[data-ssr-fallback-styles]')"),true);
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
    await browser.screenshot(`public-upload-${width}`);
    await browser.call("Page.reload");
    await browser.waitFor(/Upload Your Statement|Upload.*Statement/i);
  }
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM communication_events")).rows[0].n,0);
  assert.deepEqual(browser.exceptions,[]);
  assert.equal(h.externalCalls(),0);
  console.log("PASS protected desktop and phone supported desktop-view Chromium: real admin session; Knowledge error/retry, actual contact menu/cancel/archive/restore persisted audit/reload, same contextual saved draft reopen, keyboard focus/phone overflow; actual public SSR/Home hydration and upload/reload desktop/phone; zero communication receipts and real external calls. Native phone-workqueue behavior is not this proof.");
} finally {await browser?.close();await vite?.close();await h.close();}
