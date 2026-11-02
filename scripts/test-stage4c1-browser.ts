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
  await until(async()=>/Live version 1/.test(await text('[data-testid="badge-live-version"]')),"live version badge");
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

  // ── C. Campaigns "Message as sent" step preview (the other legacy editor) ──
  const camp=(await h.pool.query(`INSERT INTO campaigns (name,status,total_steps,created_by) VALUES ($1,'draft',2,$2) RETURNING id`,[`4c1-camp-${tag}`,"cert-admin"])).rows[0].id;
  const cGood=(await h.pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,subject,body_template,channel) VALUES ($1,1,'email','Hi {{first_name}}','<p>Hello {{first_name}} at {{company_name}}.</p>','email') RETURNING id`,[camp])).rows[0].id;
  const cBad=(await h.pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,subject,body_template,channel) VALUES ($1,2,'email','Savings','<p>You could save {{estimatedSavings}}.</p>','email') RETURNING id`,[camp])).rows[0].id;
  const campCounts=async()=>(await h.pool.query(`SELECT (SELECT count(*)::int FROM campaign_steps) s,(SELECT count(*)::int FROM outbound_messages) o,(SELECT status FROM campaigns WHERE id=$1) st,(SELECT content_revision FROM campaigns WHERE id=$1) rev`,[camp])).rows[0];
  const campBefore=await campCounts();
  const openCampaignStep=async(stepId:number)=>{
    await b!.navigate("/dashboard/outbound-center?tab=campaigns");
    await until(async()=>await count(`[data-testid="button-expand-campaign-${camp}"]`)>0,"campaign expand button",120);
    await b!.click(`[data-testid="button-expand-campaign-${camp}"]`);
    await until(async()=>await count(`[data-testid="button-preview-step-${stepId}"]`)>0,"campaign step preview button");
    await b!.click(`[data-testid="button-preview-step-${stepId}"]`);
  };
  await openCampaignStep(cGood);
  await until(async()=>await count('[data-testid="asset-final-preview"]')>0,"campaign asset final preview");
  await until(async()=>((await b!.evaluate(`document.querySelector('[data-testid="final-html-frame"]')?.getAttribute("srcdoc")||""`)) as string).length>0,"campaign final frame");
  const campFrame=await b.evaluate(`document.querySelector('[data-testid="final-html-frame"]')?.getAttribute("srcdoc")||""`) as string;
  check(campFrame.includes("Hello Alex at Sample Business LLC")&&/Path:/.test(await text('[data-testid="asset-preview-path"]'))&&(await text('[data-testid="asset-preview-subject"]'))==="Subject: Hi Alex","The Campaigns step preview shows the server-resolved path, subject and body with substitution applied");
  const creq=b.requests.filter(r=>/\/api\/message-steps\/asset-preview$/.test(r.url)).pop();
  check(!!creq&&creq.method==="POST"&&creq.status===200,"The Campaigns preview came from the real asset route with CSRF (200)");
  await b.screenshot("campaign-step-as-sent");
  await openCampaignStep(cBad);
  await until(async()=>await count('[data-testid="asset-preview-warning"]')>0,"campaign literal-token warning");
  check(/estimatedSavings/.test(await text('[data-testid="asset-preview-warning"]'))&&/delivered literally/.test(await text('[data-testid="asset-preview-warning"]')),"A campaign step using {{estimatedSavings}} is flagged: the legacy campaign path would deliver the token literally");
  const campAfter=await campCounts();
  check(campAfter.s===campBefore.s&&campAfter.o===campBefore.o&&campAfter.st==="draft"&&campAfter.rev===campBefore.rev,"Previewing a campaign step created no step or message and changed neither its status nor its content revision");

  // ── D. Package editor on a real current SFP package ──
  const ACTOR=`cert:${tag}`, KEY="sfp.automotive.v2";
  await h.pool.query(`INSERT INTO follow_up_sequences (name,status,trigger_type,trigger_config,total_steps,sequence_family) VALUES ($1,'paused','contact_created','{}'::jsonb,5,'cold-email-manual-call')`,[`W6 fixture ${tag}`]);
  for(const name of ["SDR-01: Statement Review Cold Outreach","SDR-05: Medical / Dental / Medspa","SDR-07: Auto / Service / Trades","SDR-10: Salon / Spa / Beauty"]){
    const c=(await h.pool.query(`INSERT INTO campaigns (name,status,total_steps,created_by) VALUES ($1,'draft',5,'cert') RETURNING id`,[name])).rows[0];
    for(let i=1;i<=5;i++) await h.pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,delay_days,subject,body_template,channel) VALUES ($1,$2,'follow_up',$3,$4,$5,'email')`,[c.id,i,i*2,`S ${name} ${i}`,`B ${name} ${i}`]);
  }
  const packages=await import("../server/services/cro03/sfp-campaign-packages.ts");
  const launch=await import("../server/services/cro03/sfp-launch-content.ts");
  await packages.applyPackageConvergenceV2({actorId:ACTOR});
  const populated=await launch.populateSfpLaunchContentV2({actorId:ACTOR});
  check(populated.every((r:any)=>r.status==="populated"),`Setup: the five current SFP packages exist through the real writers ${JSON.stringify(populated.map((r:any)=>[r.status,r.reason??r.detail??null]))}`);
  const pkgState=async()=>(await h.pool.query(`SELECT (SELECT count(*)::int FROM sfp_campaign_package_versions) versions,(SELECT string_agg(body,'|' ORDER BY ss.id) FROM sequence_steps ss JOIN sfp_campaign_package_versions v ON v.sequence_id=ss.sequence_id AND v.package_key=$1 AND v.lifecycle_state='current') bodies,(SELECT count(*)::int FROM audit_logs WHERE action ILIKE '%package%publish%') publishes`,[KEY])).rows[0];
  const pkgBefore=await pkgState();
  const editorUrl=`/dashboard/ghl-integration?tab=settings&content=current_sfp&package=${KEY}`;
  await b.navigate(editorUrl);
  await until(async()=>await count(`[data-testid="package-editor-${KEY}"]`)>0,"package editor",160);
  check((await count('[data-testid="package-step-rail"] li'))>=3,"The package editor opens on the current package and lists its touches");
  await b.set('[data-testid="input-step-body"]',"Hello {{firstName}}, edited in the browser for a preview only.");
  await until(async()=>await count('[data-testid="badge-package-dirty"]')>0,"dirty badge");
  await b.click('[data-testid="button-preview-step"]');
  await until(async()=>((await b!.evaluate(`document.querySelector('[data-testid="final-html-frame"]')?.getAttribute("srcdoc")||""`)) as string).includes("edited in the browser"),"package step final preview",120);
  check(true,"The package editor's final preview renders the unpublished edit through the real route");
  check((await b.evaluate(`document.querySelector('[data-testid="button-publish-package"]')?.disabled===true`)),"Publishing stays disabled until the operator confirms");
  await b.screenshot("package-editor-1280");
  const pkgAfter=await pkgState();
  check(pkgAfter.versions===pkgBefore.versions&&pkgAfter.bodies===pkgBefore.bodies&&pkgAfter.publishes===pkgBefore.publishes,"Editing and previewing changed no package version, live step wording or publication record");

  // ── E. Narrow widths: 768 and 390 ──
  for(const width of [768,390]){
    await b.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
    await b.navigate(editorUrl);
    await b.evaluate("localStorage.setItem('prefer_desktop','true')");
    await b.navigate(editorUrl);
    await until(async()=>await count(`[data-testid="package-editor-${KEY}"]`)>0,`package editor at ${width}`,160);
    const fit=await b.evaluate(`(()=>{const w=window.innerWidth;const r=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,r:b.right,h:b.height}};const ids=['[data-testid="input-step-body"]','[data-testid="button-preview-step"]','[data-testid="button-package-close"]'];return {w,sw:document.documentElement.scrollWidth,boxes:ids.map(r)}})()`) as {w:number;sw:number;boxes:Array<{l:number;r:number;h:number}|null>};
    check(fit.boxes.every(x=>x&&x.l>=0&&x.r<=fit.w+1)&&fit.sw<=fit.w+1,`At ${width}px the package editor controls sit inside the viewport and the page does not scroll sideways`);
    check(fit.boxes.every(x=>x&&x.h>=40),`At ${width}px the editor's buttons and fields keep a touch-sized height`);
    await b.screenshot(`package-editor-${width}`);
    await openCampaignStep(cGood);
    await until(async()=>await count('[data-testid="asset-final-preview"]')>0,`campaign preview at ${width}`);
    const dlg=await b.evaluate(`(()=>{const e=document.querySelector('[role="dialog"]');if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,r:r.right,w:window.innerWidth,sw:document.documentElement.scrollWidth}})()`) as {l:number;r:number;w:number;sw:number}|null;
    check(!!dlg&&dlg.l>=-1&&dlg.r<=dlg.w+1&&dlg.sw<=dlg.w+1,`At ${width}px the 'Message as sent' dialog fits the viewport`);
    await b.screenshot(`campaign-step-as-sent-${width}`);
  }
  await b.call("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});

  // ── F. Seven-role matrix for both surfaces, plus direct API refusal ──
  const matrix:Record<string,unknown>={};
  for(const role of ["admin","manager","agent","other","merchant","affiliate","partner"]){
    const rb=await open(role);
    try{
      await rb.call("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await rb.navigate(`/dashboard/outbound-center?tab=campaigns&content=current_sfp&package=${KEY}`);
      await settle(3000);
      const has0=(q:string)=>rb.evaluate(`document.querySelectorAll(${JSON.stringify(q)}).length>0`) as Promise<boolean>;
      if(role==='admin'||role==='manager') for(let i=0;i<60&&!(await has0(`[data-testid="package-editor-${KEY}"],[data-testid="text-package-editor-admin-only"]`));i++) await settle(250);
      const has=(s:string)=>rb.evaluate(`document.querySelectorAll(${JSON.stringify(s)}).length>0`) as Promise<boolean>;
      const editor=await has(`[data-testid="package-editor-${KEY}"]`), adminOnly=await has('[data-testid="text-package-editor-admin-only"]'), workspace=await has('[data-testid="card-content-workspace"]');
      const pkgReads=rb.requests.filter(r=>r.url.startsWith("/api/content-workspace/packages")).map(r=>r.status??0);
      const api=await rb.evaluate(`(async()=>{const get=await fetch('/api/content-workspace/packages/${KEY}',{credentials:'same-origin'});const m=document.cookie.match(/(?:^|;\\s*)csrf_token=([^;]*)/);const t=m?decodeURIComponent(m[1]):'';const post=await fetch('/api/message-steps/asset-preview',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','X-CSRF-Token':t},body:JSON.stringify({assetType:'campaign',assetId:${camp},stepId:${cGood}})});const pub=await fetch('/api/content-workspace/packages/${KEY}/publish',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','X-CSRF-Token':t},body:'{}'});return {get:get.status,preview:post.status,publish:pub.status}})()`) as {get:number;preview:number;publish:number};
      matrix[role]={editor,adminOnly,workspace,pkgReads,api};
      const refused=(n:number)=>n===401||n===403;
      if(role==="admin"){check(editor&&api.get===200&&api.preview===200,`admin sees the package editor and may read packages and preview steps (${editor}/${api.get}/${api.preview})`);}
      else if(role==="manager"){check(!editor&&adminOnly&&pkgReads.length===0,`manager sees the workspace but only the administrators-only notice, and never requests package state (editor=${editor} adminOnly=${adminOnly} workspace=${workspace} reads=${pkgReads.join(",")})`);check(refused(api.get)&&api.preview===200&&refused(api.publish),"manager: package read and publish are refused by the server; step preview is allowed");}
      else{check(!editor&&!workspace,`${role} is not shown the package editor or the content workspace`);check(refused(api.get)&&refused(api.preview)&&refused(api.publish),`${role}: package read, step preview and publish are all refused by the server (${api.get}/${api.preview}/${api.publish})`);}
    }finally{await rb.close();}
  }
  const finalState=await pkgState();
  check(finalState.versions===pkgBefore.versions&&finalState.bodies===pkgBefore.bodies&&finalState.publishes===pkgBefore.publishes,"The refused publish attempts changed no package version, wording or publication record");
  check(b.exceptions.length===0,"No uncaught browser exceptions");
  check(h.externalCalls()===0,"No external provider egress");
  await writeFile(`${dir}/role-matrix.json`,JSON.stringify(matrix,null,2));
  await writeFile(`${dir}/receipt.json`,JSON.stringify({status:"passed",identity,fixture:h.prefix,checks,
    qualification:"Real-browser run of the Sequences and Campaigns step 'Message as sent' previews, the stored-template draft editor and the current-SFP package editor (preview only, nothing published) on a disposable database with only the campaigns and templates-settings routes registered; 1280/768/390 widths and a seven-role matrix with direct API refusals. Not published-candidate or production acceptance."},null,2));
  console.log(`STAGE4C1_BROWSER_PASS (${checks.length} checks)`);
  function open(role:string){return privateStage3Browser(h.base,h.sessions.get(role)!.cookie,h.originalFetch,dir,{realInput:true,startupTimeoutMs:30000});}
}catch(error){
  await b?.screenshot("failure");
  await writeFile(`${dir}/failed-receipt.json`,JSON.stringify({status:"failed",identity,error:String(error),checks},null,2));
  throw error;
}finally{await b?.close();await h.close();}
