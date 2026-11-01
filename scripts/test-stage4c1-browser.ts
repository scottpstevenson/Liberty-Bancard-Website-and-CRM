import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
import {privateStage3Browser} from "./fixtures/private-stage3-browser";
import {verifyCandidateIdentity} from "./fixtures/candidate-build-identity";

// Stage 4C1 real-browser check of two editors on the compiled client, a disposable database, real session cookies and
// CSRF: (1) the legacy Sequences editor's "Message as sent" step preview (asset-addressed, server-resolved) and
// (2) the stored-template draft editor (R03). Nothing here activates, publishes, enrolls, sends or calls a provider.
const identity=await verifyCandidateIdentity();
const dir="docs/certification/stage4-c1/browser";
const clientRoot=path.resolve("dist/public");
const h=await stage3BHttpFixture(async app=>{
  (await import("../server/routes/campaigns.ts")).registerCampaignsRoutes(app);
  (await import("../server/routes/templates-settings.ts")).registerTemplatesSettingsRoutes(app);
  app.use("/api",(_req,res)=>res.status(501).json({message:"Source not registered in this isolated 4C1 fixture"}));
  const {static:serveStatic}=await import("express");
  app.use((req,res,next)=>serveStatic(clientRoot)(req,res,next));
  app.use((_req,res)=>res.sendFile("index.html",{root:clientRoot}));
},undefined,{backgroundProfile:"off"});
const checks:string[]=[];
const check=(ok:unknown,label:string)=>{assert.ok(ok,label);checks.push(label);};
const settle=(ms=150)=>new Promise(resolve=>setTimeout(resolve,ms));
type B=Awaited<ReturnType<typeof privateStage3Browser>>;
const until=async(fn:()=>Promise<boolean>,label:string,tries=80)=>{for(let i=0;i<tries;i++){if(await fn())return;await settle(250);}throw new Error(`Timed out: ${label}`);};
let b:B|undefined;
const tag=randomUUID().slice(0,8);
try{
  await mkdir(dir,{recursive:true});
  await h.pool.query(`UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1`,[`${h.prefix}-%`]);
  await h.pool.query(`INSERT INTO system_settings (key,value) VALUES ('compliance_mailing_address',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify("100 Certification Way, Miami, FL 33101")]);
  const seq=(await h.pool.query(`INSERT INTO follow_up_sequences (name,status,trigger_type,trigger_config,total_steps,created_by) VALUES ($1,'paused','manual','{"category":"sales"}'::jsonb,2,$2) RETURNING id`,[`4c1-seq-${tag}`,`${h.prefix}-admin`])).rows[0].id as number;
  const good=(await h.pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,subject,body) VALUES ($1,1,'email','Hi {{firstName}}','<p>Hello {{firstName}} at {{companyName}}.</p>') RETURNING id`,[seq])).rows[0].id as number;
  const bad=(await h.pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,subject,body) VALUES ($1,2,'email','Savings','<p>You could save {{estimatedSavings}}.</p>') RETURNING id`,[seq])).rows[0].id as number;
  const tpl=(await h.pool.query(`INSERT INTO message_templates (name,category,channel,subject,body,merge_fields,is_active) VALUES ($1,'cert','email','Subject {{contact.firstName}}','<p>Original {{contact.firstName}}</p>','{contact.firstName}',false) RETURNING id,content_version`,[`4c1-tpl-${tag}`])).rows[0];
  const count=(s:string)=>b!.evaluate(`document.querySelectorAll(${JSON.stringify(s)}).length`) as Promise<number>;
  const text=(s:string)=>b!.evaluate(`document.querySelector(${JSON.stringify(s)})?.textContent||""`) as Promise<string>;
  const stepCounts=async()=>(await h.pool.query(`SELECT (SELECT count(*)::int FROM sequence_steps) s,(SELECT count(*)::int FROM outbound_messages) o,(SELECT status FROM follow_up_sequences WHERE id=$1) st`,[seq])).rows[0];
  const before=await stepCounts();

  // ── A. Sequence step preview shows the message as the real path would send it ──
  b=await open("admin");
  await b.call("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await b.navigate("/dashboard/outbound-center?tab=sequences");
  await until(async()=>await count(`[data-testid="button-expand-${seq}"]`)>0,"expand button");
  await b.click(`[data-testid="button-expand-${seq}"]`);
  await until(async()=>await count(`[data-testid="button-preview-step-${good}"]`)>0,"step preview button");
  await b.click(`[data-testid="button-preview-step-${good}"]`);
  await until(async()=>await count('[data-testid="asset-final-preview"]')>0,"asset final preview");
  const path1=await text('[data-testid="asset-preview-path"]');
  check(/Path: sequence worker: interpolation, category signature, SMTP/.test(path1)&&/Signature: sales/.test(path1),"The modal names the server-resolved path and signature for a cold sales sequence");
  const frame=()=>b!.evaluate(`document.querySelector('[data-testid="final-html-frame"]')?.getAttribute("srcdoc")||""`) as Promise<string>;
  await until(async()=>(await frame()).length>0,"final html frame");
  check((await frame()).includes("Hello Alex at Sample Business LLC")&&(await text('[data-testid="asset-preview-subject"]'))==="Subject: Hi Alex","The sent subject and body are shown with the worker's substitution applied");
  check((await b.evaluate(`document.body.innerText`) as string).includes("Message as sent")&&(await b.evaluate(`document.body.innerText`) as string).includes("Editor sample (not the sent message)"),"The modal is titled as the sent message and keeps the old editor sample behind a labelled disclosure");
  const req=b.requests.find(r=>/\/api\/message-steps\/asset-preview$/.test(r.url));
  check(!!req&&req.method==="POST"&&req.status===200,"The preview came from the real route with CSRF (200)");
  await b.screenshot("sequence-step-as-sent");
  await b.navigate("/dashboard/outbound-center?tab=sequences");
  await until(async()=>await count(`[data-testid="button-expand-${seq}"]`)>0,"expand button again");
  await b.click(`[data-testid="button-expand-${seq}"]`);
  await until(async()=>await count(`[data-testid="button-preview-step-${bad}"]`)>0,"blocked step preview button");
  await b.click(`[data-testid="button-preview-step-${bad}"]`);
  await until(async()=>await count('[data-testid="asset-preview-blocked"]')>0,"blocked notice");
  check(/estimatedSavings/.test(await text('[data-testid="asset-preview-blocked"]')),"A step using {{estimatedSavings}} is shown as blocked, not as a clean message");
  await b.screenshot("sequence-step-blocked");
  const after=await stepCounts();
  check(after.s===before.s&&after.o===before.o&&after.st==="paused","Previewing created no step or outbound message and left the sequence paused");

  // ── B. Template draft editor (R03): draft saves, live content and activation are untouched ──
  await b.navigate("/dashboard/ghl-integration?tab=settings");
  await until(async()=>await count(`[data-testid="button-edit-template-${tpl.id}"]`)>0,"template edit button",120);
  await b.click(`[data-testid="button-edit-template-${tpl.id}"]`);
  await until(async()=>await count('[data-testid="dialog-template-editor"]')>0,"template dialog");
  check(/Live version 1/.test(await text('[data-testid="badge-live-version"]')),"The editor opens on the stored template and shows its live version");
  await b.set('[data-testid="input-template-body"]',"<p>Edited {{contact.firstName}} from the browser</p>");
  await until(async()=>((await b!.evaluate(`document.querySelector('[data-testid="template-preview"] [data-testid="final-html-frame"]')?.getAttribute("srcdoc")||""`)) as string).includes("Edited Alex"),"preview follows the edit");
  check(true,"The final preview frame re-renders with the edited wording and sample recipient");
  await b.click('[data-testid="button-save-draft"]');
  await until(async()=>(await h.pool.query(`SELECT 1 FROM message_template_versions WHERE template_id=$1 AND state='draft'`,[tpl.id])).rowCount===1,"draft stored");
  const live=(await h.pool.query(`SELECT body,content_version,is_active FROM message_templates WHERE id=$1`,[tpl.id])).rows[0];
  check(live.body==="<p>Original {{contact.firstName}}</p>"&&live.content_version===tpl.content_version&&live.is_active===false,"Saving a draft leaves the live wording, version and activation unchanged");
  await until(async()=>await count('[data-testid="button-discard-draft"]')>0,"discard button");
  await b.click('[data-testid="button-discard-draft"]');
  await until(async()=>(await h.pool.query(`SELECT 1 FROM message_template_versions WHERE template_id=$1 AND state='draft'`,[tpl.id])).rowCount===0,"draft discarded");
  check(true,"Discarding removes the draft and nothing else");
  check(b.exceptions.length===0,"No uncaught browser exceptions");
  check(h.externalCalls()===0,"No external provider egress");
  await writeFile(`${dir}/receipt.json`,JSON.stringify({status:"passed",identity,fixture:h.prefix,checks,
    qualification:"Real-browser run of the Sequences step 'Message as sent' preview and the stored-template draft editor on a disposable database with only the campaigns and templates-settings routes registered. Not campaign editor, not published-candidate or production acceptance."},null,2));
  console.log(`STAGE4C1_BROWSER_PASS (${checks.length} checks)`);
  function open(role:string){return privateStage3Browser(h.base,h.sessions.get(role)!.cookie,h.originalFetch,dir,{realInput:true,startupTimeoutMs:30000});}
}catch(error){
  await b?.screenshot("failure");
  await writeFile(`${dir}/failed-receipt.json`,JSON.stringify({status:"failed",identity,error:String(error),checks},null,2));
  throw error;
}finally{await b?.close();await h.close();}
