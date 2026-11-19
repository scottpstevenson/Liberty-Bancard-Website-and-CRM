import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {stage3BHttpFixture} from './fixtures/stage3-b-http';
import {privateStage3Browser} from './fixtures/private-stage3-browser';
import {verifyCandidateIdentity} from './fixtures/candidate-build-identity';
const identity=await verifyCandidateIdentity();
const root=path.resolve('dist/public');
const h=await stage3BHttpFixture(async app=>{
 const {pool}=await import('../server/db');
 await pool.query('UPDATE sfp_programs SET is_active=false');
 await pool.query(`INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
 VALUES($1,ARRAY['12086'],ARRAY['Healthcare'],2,true,'system:budget-browser-fixture')`,['budget-browser-'+randomUUID()]);
 const {registerScheduledDiscoveryRoutes}=await import('../server/routes/scheduled-discovery');registerScheduledDiscoveryRoutes(app);
 app.use('/api',(_req,res)=>res.status(501).json({message:'Unrelated source is not registered in this isolated budget fixture'}));
 const {static:serveStatic}=await import('express');app.use(serveStatic(root));app.use((_req,res)=>res.sendFile('index.html',{root}));
},undefined,{backgroundProfile:'off'});
let browser:Awaited<ReturnType<typeof privateStage3Browser>>|undefined,checks=0;
const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log(`PASS ${label}`);};
const open=async(role:'admin'|'manager',width:number)=>{
 await browser?.close();
 browser=await privateStage3Browser(h.base,h.sessions.get(role)!.cookie,h.originalFetch,'.local/audit-fixes/global-budget-browser',{realInput:true});
 await browser.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});
 await browser.navigate('/dashboard/lead-ops?tab=imports');
 await browser.waitFor(/Scheduled Outscraper discovery|Open this page in the desktop layout/);
 if((await browser.text()).includes('Open this page in the desktop layout'))await browser.click('[data-testid="button-open-desktop-layout"]');
 await browser.waitFor(/CRM-wide Outscraper budget/);
 const actor=await h.request(role,'GET','/api/auth/user');
 assert.equal(actor.status,200,'Budget prerequisite reads the signed-in actor');
 if(!actor.body.tourCompletedAt){
  await browser.waitFor(/Welcome to Liberty Bancard/);
  await browser.click('[data-testid="button-tour-skip-text"]');
  let completed=false;
  for(let i=0;i<50;i++){if((await h.request(role,'GET','/api/auth/user')).body.tourCompletedAt){completed=true;break;}await new Promise(r=>setTimeout(r,100));}
  assert(completed,'Supported tour skip persists before budget interaction');
 }
 let ready=false;
 for(let i=0;i<50;i++){if(await browser.evaluate("!document.querySelector('[data-testid=button-tour-skip]')&&getComputedStyle(document.body).pointerEvents!=='none'")){ready=true;break;}await new Promise(r=>setTimeout(r,100));}
 assert(ready,'Tour modal releases pointer input before budget interaction');
};
try{
 const {pool}=await import('../server/db');
 await open('admin',390);
 const controlsBefore=JSON.stringify((await pool.query('SELECT * FROM provider_controls ORDER BY provider')).rows);
 check((await browser!.text()).includes('$50.00 per calendar month'),'Compiled CRM reads the one $50 allowance from the actual budget API');
 check((await browser!.text()).includes('Leads & Contacts purchases are blocked'),'Unverified enrichment pricing is visible rather than labelled ready');
 await browser!.click('[data-testid="discovery-schedule-settings"]');
 await browser!.set('[data-testid="input-outs-monthly-budget"]','20');
 await browser!.click('[data-testid="save-discovery-schedule"]');
 await browser!.waitFor(/Saved\./);
 const saved=await h.request('admin','GET','/api/outscraper-budget');
 check(saved.status===200&&saved.body.limitMicros===20000000,'Real pointer/input/CSRF save updates the shared authority');
 check((await pool.query('SELECT enabled FROM discovery_schedules')).rows[0].enabled===false,'Saving the cap does not enable the schedule');
 check(Number((await pool.query('SELECT count(*) n FROM outscraper_budget_requests')).rows[0].n)===0,'Budget settings create no purchase reservation');
 check(JSON.stringify((await pool.query('SELECT * FROM provider_controls ORDER BY provider')).rows)===controlsBefore,'Preparing the budget leaves existing provider controls untouched');
 for(const width of [320,390,768,1280])for(const dark of [false,true]){
  await browser!.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});
  await browser!.evaluate(`document.documentElement.classList.toggle('dark',${dark})`);
  check(!await browser!.evaluate('document.documentElement.scrollWidth>innerWidth+1'),`Shared budget layout fits ${width}px ${dark?'dark':'light'}`);
 }
 await browser!.evaluate('document.querySelector("[aria-labelledby=scheduled-discovery-heading] div[role=status]").scrollIntoView({block:"center"})');
 check(await browser!.evaluate('(()=>{const r=document.querySelector("[aria-labelledby=scheduled-discovery-heading] div[role=status]").getBoundingClientRect();return r.top>=120&&r.bottom<innerHeight})()'),'Budget screenshot captures the visible shared allowance card');
 await browser!.screenshot('admin-shared-budget');
 await open('manager',390);await browser!.click('[data-testid="discovery-schedule-settings"]');
 check(await browser!.evaluate('document.querySelector("[data-testid=input-outs-monthly-budget]").disabled===true'),'Manager sees the shared cap as read-only');
 check(!await browser!.evaluate('!!document.querySelector("[data-testid=save-discovery-schedule]")'),'Manager has no budget save control');
 check(browser!.exceptions.length===0&&h.externalCalls()===0,'Compiled UI has no uncaught errors or external requests');
 check(identity.sourceInputHash.length===64,'Browser proof is bound to the actual compiled candidate');
 console.log(`OUTSCRAPER_BUDGET_BROWSER_PASS ${checks}`);
}finally{await browser?.close();await h.close();}
