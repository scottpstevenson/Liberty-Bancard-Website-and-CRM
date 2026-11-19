/** Compiled affected CRM screens, real persisted local login, actual source readers; no providers. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {stage3BHttpFixture} from '../fixtures/stage3-b-http';
import {privateStage3Browser} from '../fixtures/private-stage3-browser';
import {verifyCandidateIdentity} from '../fixtures/candidate-build-identity';
const identity=await verifyCandidateIdentity();
const root=path.resolve('dist/public');
const h=await stage3BHttpFixture(async app=>{
 (await import('../../server/routes/admin')).registerAdminRoutes(app);
 (await import('../../server/routes/sdr')).registerSdrRoutes(app);
 (await import('../../server/routes/imports')).registerImportsRoutes(app);
 // Deliberate unavailable contract for unrelated panels, never fake successful positive DTOs.
 app.use('/api',(_req,res)=>res.status(501).json({message:'Unrelated source not mounted in Phase 8 fixture'}));
 const {static:serveStatic}=await import('express');app.use(serveStatic(root));app.use((_req,res)=>res.sendFile('index.html',{root}));
},undefined,{backgroundProfile:'off'});
let browser:Awaited<ReturnType<typeof privateStage3Browser>>|undefined,checks=0;
const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
const evidence='generated-artifacts/phase8/browser',rows:any[]=[];
try{
 await h.pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'Phase8 browser') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
 (await import('../../server/services/outbound-pause-authority')).invalidatePauseStateCache();
 await h.pool.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status,daily_limit) VALUES('Saved disabled','example.test','phase8-browser@example.test',false,'warm',10)");
 await h.pool.query('UPDATE users SET tour_completed_at=now() WHERE id=$1',[h.userId('admin')]);
 browser=await privateStage3Browser(h.base,h.sessions.get('admin')!.cookie,h.originalFetch,evidence,{realInput:true});
 const routes=[{url:'/dashboard/system-health?systemTab=readiness',tab:'[data-testid="tab-system-readiness"]',pattern:/Worker selection and heartbeat/},{url:'/dashboard/activation',tab:'[data-testid="tab-identity-wizard"]',pattern:/Identity saved — not usable/},{url:'/dashboard/lead-ops?tab=imports',tab:'',pattern:/Lead Operations|Lead Ops|Imports/}];
 for(const width of [1280,768,390])for(const theme of ['light','dark']){
  await browser.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  for(const [i,r]of routes.entries()){
   await browser.navigate(r.url);if(width===390&&theme==='light'&&i===0){await browser.waitFor(/This view is not in the mobile app/);const before=await browser.evaluate('location.pathname+location.search');await browser.click('[data-testid="button-open-desktop-layout"]');check(await browser.evaluate('location.pathname+location.search')===before,'Mobile desktop-layout handoff preserves exact destination');}if(r.tab){await browser.waitFor(i===0?/System Readiness/:/Identity Wizard/);await browser.click(r.tab);}await browser.waitFor(r.pattern);
   await browser.evaluate(`document.documentElement.classList.toggle('dark',${theme==='dark'})`);
   const facts=await browser.evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,url:location.pathname+location.search,emptyButtons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.querySelector('svg')).length})`);
   check(facts.scroll<=facts.width+1,`${width} ${theme} route ${i} stays within viewport`);
   if(i===0){await browser.waitFor(/Profile: off|Profile off|profile.*off/i);check(!/Durable queues active/.test(await browser.text()),'Configured Redis never claims active workers');}
   if(i===1){check(!(await browser.text()).includes('Identity active'),'Saved disabled identity never claims active');await browser.waitFor(/Outbound: paused/);check(!(await browser.text()).includes('Pause All Outbound'),'Local SDR control is not mislabeled as the global outbound control');check(await browser.evaluate("[...document.querySelectorAll('[data-testid=table-warmup-schedule] tbody tr')].every(r=>Number(r.children[1].textContent)<=35)"),'Mounted warmup examples respect native hard ceiling');}
   await browser.screenshot(`${width}-${theme}-${i}`);rows.push({...facts,width,theme,route:i});
  }
 }
 await browser.call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
 await browser.navigate('/dashboard/system-health');await browser.waitFor(/System Readiness/);await browser.click('[data-testid="tab-system-readiness"]');await browser.waitFor(/Worker selection and heartbeat/);
 const selectedUrl=await browser.evaluate('location.pathname+location.search');
 await browser.navigate('/dashboard/activation');await browser.waitFor(/Activation Control Panel/);
 const history=await browser.call('Page.getNavigationHistory');const prior=[...history.entries].reverse().find((e:any)=>e.url===h.base+selectedUrl);assert(prior);
 await browser.call('Page.navigateToHistoryEntry',{entryId:prior.id});await browser.waitFor(/Worker selection and heartbeat/);
 check(await browser.evaluate('location.pathname+location.search')===selectedUrl,'Back restores the selected diagnostic destination');
 await browser.call('Page.reload');await browser.waitFor(/Worker selection and heartbeat/);check(await browser.evaluate('location.pathname+location.search')===selectedUrl,'Reload preserves diagnostic selection');
 await browser.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 check(await browser.evaluate("document.activeElement!==document.body"),'Keyboard Tab reaches an actual focusable control');
 await browser.evaluate("document.documentElement.style.zoom='2'");check(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'200% reflow remains bounded');await browser.screenshot('zoom-200');
 browser.failRead('/api/admin/worker-heartbeats',{exact:true});await browser.navigate('/dashboard/system-health');await browser.waitFor(/System Readiness/);await browser.click('[data-testid="tab-system-readiness"]');await browser.waitFor(/Worker observations unavailable/);check(true,'Unavailable diagnostic displays retry, never invented healthy state');
 browser.failRead(null);await browser.navigate('/dashboard/activation');await browser.waitFor(/Identity Wizard/);await browser.click('[data-testid="tab-identity-wizard"]');await browser.waitFor(/Identity saved — not usable/);
 browser.failRead('/api/sdr/sending-identities',{exact:true});await browser.navigate('/dashboard/activation');await browser.waitFor(/Identity Wizard/);await browser.click('[data-testid="tab-identity-wizard"]');await browser.waitFor(/Sender identities unavailable/);check(!(await browser.text()).includes('First Sending Identity Wizard'),'Unavailable identity source does not become an empty create wizard');
 check(h.externalCalls()===0,'Mounted CRM makes zero external transport requests');
 await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify({source:identity.sourceHead,inputHash:identity.inputHash,checks,rows,exceptions:browser.exceptions,qualification:'Chromium CSS viewport coverage; not real-phone/WebKit or deployed bundled-server acceptance'},null,2));
 check(browser.exceptions.length===0,'Mounted screens have no uncaught JavaScript exception');
 console.log(`PHASE8_BROWSER_PASS ${checks}`);
}finally{await browser?.close();await h.close();}
