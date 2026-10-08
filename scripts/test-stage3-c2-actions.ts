import assert from "node:assert/strict";
import {verifyCandidateIdentity} from "./fixtures/candidate-build-identity";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const rows:Array<Record<string,unknown>>=[];
let fakeInbox=false,providerFailure=false;
let fakeAppointments=false,appointmentFailure=false;
const nativeMessages:any[]=[];
const h=await stage3BHttpFixture(async app=>{
  for(const [file,fn] of [
    ["contacts","registerContactsRoutes"],["activity","registerActivityRoutes"],
    ["crm-operations","registerCrmOperationsRoutes"],["tickets-tasks","registerTicketsTasksRoutes"],
    ["message-drafts","registerMessageDraftRoutes"],["my-day","registerMyDayRoutes"],
    ["daily-briefing","registerDailyBriefingRoutes"],["conversation-ai-config","registerConversationAiConfigRoutes"],
    ["toolkit","registerToolkitRoutes"],["deals","registerDealsRoutes"],["inbox","registerInboxRoutes"],
    ["live-chat","registerLiveChatRoutes"],
    ["ai","registerAiRoutes"],["nba","registerNbaRoutes"],
  ]) { const module=await import(`../server/routes/${file}.ts`);
    if(file==="inbox") module[fn](app,{
      config:()=>fakeInbox?{apiKey:"fake-not-a-credential",locationId:"fixture-location",calendarId:undefined}:null,
      read:async(path:string)=>{
        if(providerFailure)return {conversations:{malformed:true}};
        const url=new URL(path,"https://fake.invalid");
        if(url.pathname.endsWith("/messages")){
          const conversationId=decodeURIComponent(url.pathname.split("/")[2]);
          return {messages:{messages:nativeMessages.filter(m=>m.conversationId===conversationId).slice(0,1)}};
        }
        const type=url.searchParams.get("lastMessageType");
        const after=url.searchParams.get("startAfterDate");
        return {conversations:nativeMessages.filter(m=>(!type || m.messageType===type)&&(!after||Date.parse(m.dateAdded)<Number(after)))
          .slice(0,Number(url.searchParams.get("limit"))).map(m=>({id:m.conversationId,locationId:m.locationId,
            contactId:m.contactId,lastMessageDate:Date.parse(m.dateAdded),unreadCount:1,fullName:"Fake provider useful identity"}))};
      }
    });else if(file==="toolkit")module[fn](app,{appointments:{
      config:()=>fakeAppointments?{apiKey:"fake-not-a-credential",locationId:"fixture-location",calendarId:undefined}:null,
      read:async()=>appointmentFailure?{events:{invalid:true}}:{events:[
        {id:"owned-event",contactId:"c2-owned-provider",startTime:"2026-10-09T10:00:00Z",endTime:"2026-10-09T11:00:00Z"},
        {id:"foreign-event",contactId:"c2-foreign-provider",startTime:"2026-10-09T10:00:00Z",endTime:"2026-10-09T11:00:00Z"},
        {id:"unmapped-event",contactId:"unmapped",startTime:"2026-10-09T10:00:00Z",endTime:"2026-10-09T11:00:00Z"},
      ]}
    }});else module[fn](app);
  }
  app.use("/api",(_req,res)=>res.status(501).json({message:"Unregistered isolated C2 service; blocked, not empty"}));
});
const check=async(role:string,method:string,url:string,body:unknown,status:number,control:string,csrf=true)=>{
  const result=await h.request(role,method,url,body,csrf);
  assert.equal(result.status,status,`${control}: ${JSON.stringify(result.body)}`);
  rows.push({control,role,method,url,status,verdict:"pass",middleware:"real session→CSRF→crmObjectAccessGuard→registered handler",
    infrastructure:"private migrated database/reserved Redis",effects:"provider egress denied",sourceHead:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()});
  return result.body;
};
try{
  await import("./test-certification-redis-reservation");
  const contact=async(role:string)=>(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('C2','Person',$1,'',$2,'production') RETURNING id`,[`${randomUUID()}@example.test`,role==="unassigned"?null:h.email(role)])).rows[0].id;
  const own=await contact("agent"),foreign=await contact("other"),unassigned=await contact("unassigned");
  const beforeSiteContacts=(await h.pool.query("SELECT count(*)::int n FROM contacts")).rows[0].n;
  const beforeSiteObservations=(await h.pool.query("SELECT count(*)::int n FROM inbox_items")).rows[0].n;
  const siteIds:number[]=[];
  for(const linked of [null,own,foreign,unassigned]){
    const site=(await h.pool.query(`INSERT INTO live_chats(session_id,visitor_name,contact_id)
      VALUES($1,'Synthetic unmapped site visitor',$2) RETURNING id`,[randomUUID(),linked])).rows[0].id;
    siteIds.push(site);
  }
  const siteHref=(id:number)=>`/api/inbox/items/${encodeURIComponent(`live_chat:local::session:${id}`)}`;
  const anonymousSite=await check("admin","GET",siteHref(siteIds[0]),undefined,200,
    "existing privileged anonymous-site authority; no contact or reply channel fabricated");
  assert.equal(anonymousSite.contactId,null);assert.equal(anonymousSite.channel,"site");
  assert.equal(anonymousSite.sourceScope,"local_session_projection");assert.equal(anonymousSite.body,null);
  await check("manager","GET",siteHref(siteIds[0]),undefined,200,"manager anonymous-site triage preserved");
  await check("agent","GET",siteHref(siteIds[0]),undefined,404,"agent anonymous-site denial");
  await check("agent","GET",siteHref(siteIds[1]),undefined,200,"agent linked-owned site read");
  await check("agent","GET",siteHref(siteIds[2]),undefined,404,"foreign local-session source denied");
  await check("agent","GET",siteHref(siteIds[3]),undefined,200,"supported unassigned local-session scope");
  await check("admin","GET",`/api/live-chat/sessions/${siteIds[0]}/messages`,undefined,200,
    "actual existing local-session thread handler");
  await check("admin","PATCH",`/api/live-chat/sessions/${siteIds[0]}`,{contactId:own},200,
    "explicit authorized existing-ID site link; no new contact");
  const linkedSite=await check("admin","GET",siteHref(siteIds[0]),undefined,200,"fresh source identity after explicit link");
  assert.equal(linkedSite.contactId,own);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM contacts")).rows[0].n,beforeSiteContacts);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM inbox_items")).rows[0].n,beforeSiteObservations);
  await h.pool.query("DELETE FROM live_chats WHERE id=ANY($1::int[])",[siteIds]);
  await check("admin","GET",`/api/tasks/${own}`,undefined,501,"absent selected-task handler is explicitly blocked");
  await h.pool.query(`INSERT INTO agents(user_id,first_name,last_name,email) VALUES($1,'C2','Agent',$2)`,[h.userId("agent"),h.email("agent")]);
  for(const role of ["anonymous","merchant","affiliate","partner"]) {
    await check(role,"GET",`/api/contacts/${own}`,undefined,role==="anonymous"?401:403,"record denial");
    await check(role,"GET","/api/my-day",undefined,role==="anonymous"?401:403,"MyDay denial");
    await check(role,"GET","/api/appointments",undefined,role==="anonymous"?401:403,"native appointment employee denial");
  }
  await check("agent","GET",`/api/contacts/${foreign}/locations`,undefined,404,"forged Locations child denial");
  await check("agent","GET",`/api/contacts/${own}/locations`,undefined,200,"owned Locations read");
  await check("agent","GET",`/api/contacts/${unassigned}`,undefined,200,"supported unassigned record");
  const projected=await check("agent","GET",`/api/contacts/${own}/detail?section=notes`,undefined,200,"only requested Contact interior loaded");
  assert.deepEqual(projected.loaded,{deals:false,tickets:false,tasks:false,notes:true});
  assert.deepEqual(projected.deals,[]);assert.deepEqual(projected.tasks,[]);
  assert.equal(projected.headerDealFacts.activeDeal,null);
  await check("agent","GET",`/api/contacts/${own}/detail?section=notes&section=tasks`,undefined,400,"conflicting projection rejected");
  const intent={entityType:"contact",entityId:own,content:"C2 durable note",commandId:randomUUID(),
    expectedActorId:h.userId("agent"),expectedAccountVersion:1};
  await check("agent","POST","/api/notes",intent,403,"note missing CSRF zero effects",false);
  await check("agent","POST","/api/notes",{...intent,entityId:foreign},404,"note foreign target zero effects");
  const note=await check("agent","POST","/api/notes",intent,201,"save exact record note");
  const replay=await check("agent","POST","/api/notes",intent,200,"response-loss identical note retry");
  assert.equal(replay.id,note.id);
  const noteRead=await check("agent","GET",`/api/notes?entityType=contact&entityId=${own}`,undefined,200,"note reload");
  assert.equal(noteRead[0].content,intent.content);
  await h.pool.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2",[h.email("other"),own]);
  await check("agent","GET",`/api/contacts/${own}`,undefined,404,"ownership revocation denies previously readable record");
  await check("agent","POST","/api/notes",{...intent,commandId:randomUUID()},404,"ownership revocation denies new note intent");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM notes WHERE entity_type='contact' AND entity_id=$1",[own])).rows[0].n,1,
    "Revocation cannot create another note or replay old authority");
  await h.pool.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2",[h.email("agent"),own]);
  const create={title:"C2 due work",dueDate:new Date().toISOString(),contactId:own,
    commandId:randomUUID(),expectedActorId:h.userId("agent")};
  const task=await check("agent","POST","/api/tasks",create,201,"create exact contact task");
  assert.equal((await check("agent","POST","/api/tasks",create,200,"lost-response task retry")).id,task.id);
  const before=await check("agent","GET","/api/overview/daily-briefing",undefined,200,"factual Today initial");
  const day=await check("agent","GET","/api/my-day?timezone=UTC",undefined,200,"canonical MyDay due queue");
  assert.ok(day.tasksToday.some((t:any)=>t.id===task.id));assert.equal(day.taskQueue.limit,20);
  const edit={status:"cancelled",expectedFence:task.authorityFence,expectedActorId:h.userId("agent"),commandId:randomUUID()};
  await check("agent","PUT",`/api/tasks/${task.id}`,edit,200,"cancel task durable");
  await check("agent","PUT",`/api/tasks/${task.id}`,edit,200,"cancel response-loss retry");
  const after=await check("agent","GET","/api/overview/daily-briefing",undefined,200,"Today server freshness");
  assert.notEqual(before.factRevision,after.factRevision);
  const afterDay=await check("agent","GET","/api/my-day?timezone=UTC",undefined,200,"cancelled absent from pending queue");
  assert.ok(!afterDay.tasksToday.some((t:any)=>t.id===task.id));
  const terminalRows=await check("agent","GET","/api/tasks",undefined,200,"canonical cancelled task remains a readable terminal row");
  const terminalRow=terminalRows.find((row:any)=>row.id===task.id);
  assert.equal(terminalRow.effectiveState,"cancelled");assert.equal(terminalRow.status,"cancelled");
  await check("agent","PUT",`/api/tasks/${task.id}`,{...edit,status:"completed",commandId:randomUUID()},409,"task stale displayed version");
  await check("other","PUT",`/api/tasks/${task.id}`,{...edit,expectedActorId:h.userId("other"),commandId:randomUUID()},404,"foreign task denial");
  // Canonical A/B predicates, not a reconstructed UI population. All rows live
  // only in this guarded, freshly migrated disposable fixture database.
  const archivedContact=await contact("agent"),demoContact=await contact("agent");
  await h.pool.query("UPDATE contacts SET archived_at=now() WHERE id=$1",[archivedContact]);
  await h.pool.query("UPDATE contacts SET record_class='demo' WHERE id=$1",[demoContact]);
  const predicateCases=[
    {label:"authority open overrides completed legacy value",state:"open",legacy:"completed",contact:own,due:true,visible:true},
    {label:"effective completed is not pending",state:"completed",legacy:"pending",contact:own,due:true,visible:false},
    {label:"effective cancelled is not pending",state:"cancelled",legacy:"pending",contact:own,due:true,visible:false},
    {label:"deleted work is not pending",state:"open",legacy:"pending",contact:own,due:true,deleted:true,visible:false},
    {label:"archived linked contact excluded",state:"open",legacy:"pending",contact:archivedContact,due:true,visible:false},
    {label:"mixed class excluded",state:"open",legacy:"pending",contact:demoContact,due:true,visible:false},
    {label:"other owner excluded",state:"open",legacy:"pending",contact:foreign,due:true,visible:false},
    {label:"unassigned linked work excluded for agent",state:"open",legacy:"pending",contact:unassigned,due:true,visible:false},
    {label:"no due work is not a due queue",state:"open",legacy:"pending",contact:own,due:false,visible:false},
    {label:"canonical in-progress overdue work included",state:"in_progress",legacy:"completed",contact:own,due:true,visible:true},
  ];
  const predicateIds:number[]=[];
  for(const item of predicateCases) {
    const saved=await h.pool.query(`INSERT INTO tasks(title,status,authority_state,contact_id,due_date,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[`C2 predicate ${item.label}`,item.legacy,item.state,item.contact,
      item.due?new Date(Date.now()-86400000):null,item.deleted?new Date():null]);
    predicateIds.push(saved.rows[0].id);
  }
  const overflowIds:number[]=[];
  for(let index=0;index<25;index++) overflowIds.push((await h.pool.query(`INSERT INTO tasks(title,status,authority_state,contact_id,due_date)
    VALUES($1,'pending','open',$2,$3) RETURNING id`,[`C2 queue overflow ${index}`,own,new Date(Date.now()-172800000)])).rows[0].id);
  const queue=await check("agent","GET","/api/my-day?timezone=UTC",undefined,200,"canonical queue population and 20-row cap");
  assert.equal(queue.taskQueue.returned,20);assert.equal(queue.taskQueue.total,27);
  assert.equal(queue.taskQueue.exact,true);
  // Older overflow rows intentionally fill the limited queue. Remove just those
  // owned fixtures before proving which individual predicate rows are returned.
  await h.pool.query("DELETE FROM tasks WHERE id=ANY($1::integer[])",[overflowIds]);
  const canonical=await check("agent","GET","/api/my-day?timezone=UTC",undefined,200,"canonical task state/class/archive/ownership cases");
  assert.equal(canonical.taskQueue.total,2);
  for(const [index,item] of predicateCases.entries())
    assert.equal(canonical.tasksToday.some((row:any)=>row.id===predicateIds[index]),item.visible,item.label);
  const work=await check("agent","GET","/api/tasks",undefined,200,"Work retains authorized no-due and terminal states");
  assert.ok(work.some((row:any)=>row.id===predicateIds[8]));
  assert.ok(!work.some((row:any)=>row.id===predicateIds[3]));
  assert.ok(!work.some((row:any)=>row.id===predicateIds[4]));
  assert.ok(!work.some((row:any)=>row.id===predicateIds[5]));
  assert.ok(!work.some((row:any)=>row.id===predicateIds[6]));
  await check("agent","GET","/api/my-day?timezone=Not_A_Zone",undefined,400,"invalid timezone cannot become zero work");
  const company=(await h.pool.query(`INSERT INTO companies(legal_name,created_by_user_id) VALUES('C2 owned',$1) RETURNING id`,[h.userId("agent")])).rows[0].id;
  const otherCompany=(await h.pool.query(`INSERT INTO companies(legal_name,created_by_user_id) VALUES('C2 other',$1) RETURNING id`,[h.userId("other")])).rows[0].id;
  await check("agent","GET",`/api/ma-events?entityType=company&entityId=${company}`,undefined,200,"authorized company M&A");
  await check("agent","GET",`/api/ma-events?entityType=company&entityId=${otherCompany}`,undefined,404,"forged query company denial");
  await check("agent","GET",`/api/ma-events?entityType=contact&entityId=${foreign}`,undefined,404,"forged query contact denial");
  await check("agent","GET","/api/ma-events?entityType=company&entityId=1.5",undefined,400,"M&A input validation");
  const event=await check("agent","POST","/api/calendar-events",{title:"C2 local event",
    startTime:"2026-10-31T23:30:00.000Z",endTime:"2026-11-01T00:30:00.000Z"},201,"create local calendar event");
  assert.equal(event.ownerId,h.userId("agent"));
  const events=await check("agent","GET","/api/calendar-events?start=2026-11-01T00%3A00%3A00Z&end=2026-12-01T00%3A00%3A00Z",undefined,200,"overlap exclusive calendar window");
  assert.ok(events.some((e:any)=>e.id===event.id));
  await check("other","PUT",`/api/calendar-events/${event.id}`,{title:"foreign"},403,"calendar owner denial");
  await check("agent","GET","/api/calendar-events?start=bad&end=bad",undefined,400,"invalid window not empty");
  const appointments=await check("agent","GET","/api/appointments",undefined,200,"native absent truthful");
  assert.equal(appointments.status,"not_configured");assert.equal(appointments.source,"ghl_appointments");
  const draftContext={contextType:"contact",contextId:String(own),channel:"email"};
  const draftIntent={context:draftContext,subject:"C2",body:"Retained channel draft",expectedVersion:0,commandId:randomUUID()};
  const draft=await check("agent","PUT","/api/message-drafts",draftIntent,200,"save channel-bound draft");
  const draftRetry=await check("agent","PUT","/api/message-drafts",draftIntent,200,"draft lost-response retry");
  assert.equal(draftRetry.draft.id,draft.draft.id);
  await check("agent","PUT","/api/message-drafts",{...draftIntent,body:"stale",commandId:randomUUID()},409,"draft version conflict");
  await check("other","GET",`/api/message-drafts?contextType=contact&contextId=${own}&channel=email`,undefined,404,"foreign draft denied");
  await h.pool.query("UPDATE contacts SET ghl_contact_id='c2-owned-provider' WHERE id=$1",[own]);
  await h.pool.query("UPDATE contacts SET ghl_contact_id='c2-foreign-provider' WHERE id=$1",[foreign]);
  for(const [index,type] of ["TYPE_SMS","TYPE_EMAIL","TYPE_WEBCHAT","TYPE_CAMPAIGN_VOICEMAIL"].entries())
    nativeMessages.push({id:`message-${index}`,locationId:"fixture-location",conversationId:`conversation-${index}`,
      contactId:"c2-owned-provider",messageType:type,direction:"inbound",dateAdded:new Date(Date.now()-index*1000).toISOString(),
      body:"Same body, four actual different messages"});
  nativeMessages.push({id:"foreign-message",locationId:"fixture-location",conversationId:"foreign-conversation",
    contactId:"c2-foreign-provider",messageType:"TYPE_SMS",direction:"inbound",dateAdded:new Date(Date.now()-6000).toISOString(),body:"Foreign"});
  fakeInbox=true;
  const normalized=await check("agent","GET","/api/inbox/items?limit=50",undefined,200,"fake provider actual occurrence normalization");
  assert.deepEqual(new Set(normalized.items.map((i:any)=>i.channel)),new Set(["sms","email","ghl_chat","voicemail"]));
  assert.equal(normalized.items.length,4,"distinct same-body messages preserved; true IDs deduplicated");
  const exactMessage=await check("agent","GET",`/api/inbox/items/${encodeURIComponent(normalized.items[0].id)}`,
    undefined,200,"exact message reader retains authorized source/channel/display identity for reload");
  assert.equal(exactMessage.id,normalized.items[0].id);
  assert.equal(exactMessage.contactId,own);
  assert.equal(exactMessage.channel,normalized.items[0].channel);
  assert.equal(typeof exactMessage.contactName,"string");
  await check("other","GET",`/api/inbox/items/${encodeURIComponent(normalized.items[0].id)}`,
    undefined,404,"exact source message cannot bypass foreign contact authority");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM inbox_items WHERE contact_id=$1",[foreign])).rows[0].n,0,"foreign source reads have no materialization");
  const sourceContext={contextType:"inbox",contextId:normalized.items[0].id,channel:normalized.items[0].channel};
  await check("agent","GET",`/api/message-drafts?${new URLSearchParams(sourceContext)}`,undefined,200,
    "draft accepts actual provider/account namespace from source reader");
  const sourceDraftIntent={context:sourceContext,subject:"C2 source-bound draft",body:"Never sent",
    expectedVersion:0,commandId:randomUUID()};
  const sourceDraft=await check("agent","PUT","/api/message-drafts",sourceDraftIntent,200,"save exact channel/source draft");
  const sourceReplay=await check("agent","PUT","/api/message-drafts",sourceDraftIntent,200,"source draft identical-intent retry");
  assert.equal(sourceDraft.draft.id,sourceReplay.draft.id);
  await check("other","GET",`/api/message-drafts?${new URLSearchParams(sourceContext)}`,undefined,404,
    "source draft cannot bypass foreign record authority");
  await check("agent","PUT","/api/message-drafts",
    {...sourceDraftIntent,context:{...sourceContext,channel:"site"},commandId:randomUUID()},404,"source draft forged channel denied");
  const first=await check("agent","GET","/api/inbox/items?limit=2",undefined,200,"signed source-buffered first page");
  assert.ok(first.nextCursor);
  const outsideWindow=normalized.items.find((item:any)=>!first.items.some((visible:any)=>visible.id===item.id));
  assert.ok(outsideWindow,"Fixture must use an actual source message outside this returned window");
  const outsideExact=await check("agent","GET",`/api/inbox/items/${encodeURIComponent(outsideWindow.id)}`,
    undefined,200,"authorized exact source message outside the current buffered window");
  assert.equal(outsideExact.id,outsideWindow.id);
  assert.equal(outsideExact.channel,outsideWindow.channel);
  await check("other","GET",`/api/inbox/items?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,undefined,400,"foreign cursor denial");
  await check("agent","GET",`/api/inbox/items?limit=2&channel=sms&cursor=${encodeURIComponent(first.nextCursor)}`,undefined,400,"changed-query cursor denial");
  const ids=new Set(first.items.map((i:any)=>i.id));
  let cursor=first.nextCursor;
  for(let i=0;i<8 && cursor;i++){
    const page=await check("agent","GET",`/api/inbox/items?limit=2&cursor=${encodeURIComponent(cursor)}`,undefined,200,"buffered continuation");
    for(const item of page.items){assert.ok(!ids.has(item.id),"no repeated source occurrence");ids.add(item.id);}
    cursor=page.nextCursor;
  }
  assert.equal(ids.size,4);assert.equal(cursor,null);
  providerFailure=true;
  const failed=await check("agent","GET","/api/inbox/items?channel=sms",undefined,200,"malformed provider not authoritative empty");
  assert.ok(failed.sourceStatus.some((s:any)=>s.status==="failed"));assert.equal(failed.complete,false);
  fakeInbox=false;
  fakeAppointments=true;
  const nativeOwned=await check("agent","GET","/api/appointments",undefined,200,"native appointment exact local object scope");
  assert.equal(nativeOwned.appointments.length,1);
  assert.equal(nativeOwned.appointments[0].contactId,own);
  assert.equal(nativeOwned.appointments[0].id,"owned-event");
  assert.equal(nativeOwned.exact,false);
  const nativeAll=await check("admin","GET","/api/appointments",undefined,200,"native mapped versus unmapped identity");
  assert.equal(nativeAll.appointments.length,3);
  assert.equal(nativeAll.appointments.find((e:any)=>e.id==="unmapped-event").contactId,null);
  appointmentFailure=true;
  const failedNative=await check("agent","GET","/api/appointments",undefined,503,"native provider failure not empty");
  assert.equal(failedNative.status,"provider_failed");
  assert.equal(failedNative.configured,true);
  const deal=await h.pool.query(`INSERT INTO deals(contact_id,pipeline,stage,owner) VALUES($1,'sales','New',$2) RETURNING id`,[own,h.email("agent")]);
  const dealId=deal.rows[0].id;
  const linked=await check("agent","GET",`/api/contacts/${own}/detail?section=deals`,undefined,200,"contextual exact contact deal projection");
  assert.equal(linked.loaded.deals,true);assert.ok(linked.deals.some((row:any)=>row.id===dealId));
  const wrongDeal=(await h.pool.query(`INSERT INTO deals(contact_id,pipeline,stage,owner) VALUES($1,'sales','New',$2) RETURNING id`,
    [unassigned,h.email("agent")])).rows[0].id;
  const localLog={contactId:own,dealId,outcome:"Interested",direction:"outbound",duration:30,summary:"C2 local log, no follow-up effects",idempotencyKey:randomUUID()};
  await check("agent","POST","/api/call-logs",localLog,403,"local log missing CSRF zero effects",false);
  await check("agent","POST","/api/call-logs",{...localLog,dealId:wrongDeal},409,"foreign association among authorized records rejected");
  await check("other","POST","/api/call-logs",localLog,404,"local log ownership denial");
  await check("agent","POST","/api/call-logs",{...localLog,duration:-1},400,"negative duration rejected");
  const beforeLocal=(await h.pool.query("SELECT (SELECT count(*) FROM tasks)::int tasks,(SELECT count(*) FROM sequence_enrollments)::int enrollments")).rows[0];
  const logged=await check("agent","POST","/api/call-logs",localLog,201,"safe provider-free local log handler");
  const logs=await check("agent","GET",`/api/call-logs/contact/${own}`,undefined,200,"local log durable UUID response-loss readback");
  assert.equal(logs.find((row:any)=>row.idempotencyKey===localLog.idempotencyKey).id,logged.id);
  const afterLocal=(await h.pool.query("SELECT (SELECT count(*) FROM tasks)::int tasks,(SELECT count(*) FROM sequence_enrollments)::int enrollments")).rows[0];
  assert.deepEqual(afterLocal,beforeLocal);
  assert.equal((await h.pool.query("SELECT stage FROM deals WHERE id=$1",[dealId])).rows[0].stage,"New");
  await check("agent","PUT",`/api/deals/${dealId}`,{stage:"Discovery",expectedStage:"New"},200,"single displayed-stage move");
  assert.equal((await check("agent","GET",`/api/deals/${dealId}`,undefined,200,"stage durable readback")).stage,"Discovery");
  await check("agent","PUT",`/api/deals/${dealId}`,{stage:"Discovery",expectedStage:"New"},200,"response-loss stage no-op readback");
  await check("agent","PUT",`/api/deals/${dealId}`,{stage:"Follow-Up",expectedStage:"New"},409,"stale displayed stage rejected");
  await check("agent","PUT",`/api/deals/${dealId}`,{stage:"New",expectedStage:"Discovery"},422,"illegal stage zero effects");
  await check("other","PUT",`/api/deals/${dealId}`,{stage:"Follow-Up",expectedStage:"Discovery"},404,"foreign stage denied");
  const second=(await h.pool.query(`INSERT INTO deals(contact_id,pipeline,stage,owner) VALUES($1,'sales','Discovery',$2) RETURNING id`,[own,h.email("agent")])).rows[0].id;
  const bulk=await check("admin","POST","/api/deals/bulk-stage",{dealIds:[dealId,second],stage:"Follow-Up",
    expectedStages:{[dealId]:"Discovery",[second]:"New"}},200,"partial bulk confirmed and stale blocked receipts");
  assert.deepEqual(bulk.confirmedDealIds,[dealId]);assert.deepEqual(bulk.blockedDealIds,[second]);
  assert.equal(bulk.results.find((r:any)=>r.id===second).reason,"DEAL_STAGE_STALE");
  await check("agent","POST","/api/deals/bulk-stage",{dealIds:[second],stage:"Follow-Up"},403,"privilege-specific bulk denial");
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    SELECT 'C2 scoped','Filler '||g,$2||g||'@example.test','',$1,'production' FROM generate_series(1,55) g`,[h.email("agent"),randomUUID()]);
  const child=await contact("agent");
  await h.pool.query("UPDATE contacts SET is_parent_account=true WHERE id=$1",[own]);
  await h.pool.query("UPDATE contacts SET parent_contact_id=$1,vertical='C2 scoped retail' WHERE id=$2",[own,child]);
  await h.pool.query("UPDATE contacts SET last_name='ZZ scoped child',created_at='2000-01-01',updated_at='2000-01-01' WHERE id=$1",[child]);
  const firstContactPage=await check("agent","GET","/api/contacts?limit=50&offset=0&recordClass=production",undefined,200,"scoped group child is absent from first contact page");
  assert.equal(firstContactPage.data.some((contact:any)=>contact.id===child),false);
  assert.equal(firstContactPage.data.some((contact:any)=>contact.id===own),false);
  const parents=await check("agent","GET","/api/contacts?isParentAccount=true&limit=25&offset=0",undefined,200,"parent-only picker uses authorized predicate instead of first-page filtering");
  assert.ok(parents.data.some((contact:any)=>contact.id===own));
  assert.ok(parents.data.every((contact:any)=>contact.isParentAccount===true));
  const exactChildSearch=await check("agent","GET",`/api/contacts?search=${encodeURIComponent("ZZ scoped child")}&limit=25&offset=0`,undefined,200,"contact picker finds authorized identifier beyond first page");
  assert.ok(exactChildSearch.data.some((contact:any)=>contact.id===child));
  await check("agent","GET","/api/contacts?isParentAccount=maybe",undefined,400,"invalid parent filter is not authoritative empty");
  const scopedDeal=(await h.pool.query(`INSERT INTO deals(contact_id,pipeline,stage,owner,offer_path,archived_at,record_class)
    VALUES($1,'sales','New',$2,'C2 scoped offer',now(),'production') RETURNING id`,[child,h.email("agent")])).rows[0].id;
  const scopeParams=new URLSearchParams({pipeline:"sales",groupContactId:String(own),vertical:"C2 scoped retail",
    offerPath:"C2 scoped offer",assignedTo:h.email("agent"),limit:"1",offset:"0"});
  const activeScopeUrl=`/api/deals?${scopeParams}`;
  const activeScoped=await check("agent","GET",activeScopeUrl,undefined,200,"same-filter active Pipeline rows/total/stage distribution");
  assert.equal(activeScoped.total,0);assert.deepEqual(activeScoped.stageDistribution,{});
  const archivedScoped=await check("agent","GET",`${activeScopeUrl}&includeArchived=true`,undefined,200,"same-filter archived/group Pipeline scope beyond contact page");
  assert.equal(archivedScoped.total,1);assert.equal(archivedScoped.data[0].id,scopedDeal);
  assert.deepEqual(archivedScoped.stageDistribution,{New:1});
  await check("agent","GET",`/api/deals/${scopedDeal}`,undefined,404,"restore exception does not open archived detail reads");
  await check("agent","POST",`/api/deals/${scopedDeal}/restore`,undefined,200,"authorized restore refreshes existing-owner count cache");
  const restoredScoped=await check("agent","GET",activeScopeUrl,undefined,200,"same scoped Pipeline data/count after real restore");
  assert.equal(restoredScoped.total,1);assert.deepEqual(restoredScoped.stageDistribution,{New:1});
  assert.equal(restoredScoped.filters.groupContactId,own);assert.equal(restoredScoped.filters.assignedTo,h.email("agent"));
  const noFollowUp=await check("agent","GET",`${activeScopeUrl}&noFollowUp=true`,undefined,200,"no-followup scope uses one rows/count predicate");
  assert.equal(noFollowUp.total,1);assert.deepEqual(noFollowUp.stageDistribution,{New:1});
  const unassignedScope=await check("agent","GET",`${activeScopeUrl}&unassigned=true`,undefined,200,"unassigned plus assigned-owner scope is truthfully empty");
  assert.equal(unassignedScope.total,0);assert.deepEqual(unassignedScope.stageDistribution,{});
  const futureGoLive=await check("agent","GET",`${activeScopeUrl}&pastGoLive=true`,undefined,200,"no-date record is not past go-live");
  assert.equal(futureGoLive.total,0);
  await check("agent","PUT",`/api/deals/${scopedDeal}`,{expectedGoLiveDate:new Date(Date.now()-3600000).toISOString()},200,"local go-live date changes refresh scoped count authority");
  const pastGoLive=await check("agent","GET",`${activeScopeUrl}&pastGoLive=true`,undefined,200,"same-reader overdue go-live rows/count after real update");
  assert.equal(pastGoLive.total,1);assert.equal(pastGoLive.data[0].id,scopedDeal);assert.deepEqual(pastGoLive.stageDistribution,{New:1});
  await check("agent","GET",`/api/deals?groupContactId=${foreign}`,undefined,404,"foreign group query does not grant contact/deal access");
  await check("admin","GET","/api/deals?includeArchived=maybe",undefined,400,"malformed Pipeline scope is not empty success");
  for(const role of ["admin","manager","agent"]){
    const capabilities=await check(role,"GET","/api/tools/capabilities",undefined,200,"read-only denied tool observation");
    assert.equal(capabilities.capability,"transport_observation_only");
    for(const tool of ["ai","followups","bin"]) assert.equal(capabilities[tool].blocked,true);
    const pause=await check(role,"GET","/api/inbox/send-state",undefined,200,"existing pause authority, no send grant");
    assert.equal(pause.canSend,false);assert.equal(pause.capability,"pause_observation_only");
    assert.equal(typeof pause.reason,"string");assert.equal(typeof pause.epoch,"string");
  }
  for(const role of ["merchant","partner","affiliate"])
    await check(role,"GET","/api/inbox/send-state",undefined,403,"nonemployee pause observation denied");
  await h.pool.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2",[h.email("other"),own]);
  await check("agent","GET",`/api/contacts/${own}`,undefined,404,"owned contact access revoked after reassignment");
  const revokedTasks=await check("agent","GET","/api/tasks",undefined,200,"linked task omitted after ownership revocation");
  assert.ok(!revokedTasks.some((row:any)=>row.id===task.id));
  await check("agent","PUT",`/api/tasks/${task.id}`,{...edit,commandId:randomUUID()},404,"linked task command denied after ownership revocation");
  await check("other","GET",`/api/contacts/${own}`,undefined,200,"new authorized owner exact contact read");
  await h.pool.query("UPDATE users SET role='merchant' WHERE id=$1",[h.userId("agent")]);
  await check("agent","GET","/api/tasks",undefined,403,"employee permission revoked on existing session");
  assert.equal(h.externalCalls(),0,"read/action proofs must not call providers");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM notes WHERE id=$1",[note.id])).rows[0].n,1);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM tasks WHERE id=$1",[task.id])).rows[0].n,1);
  const identity=await verifyCandidateIdentity();
  const out="docs/certification/stage3-c2";
  await mkdir(out,{recursive:true});await writeFile(`${out}/handler-actions.json`,JSON.stringify({status:"passed",identity,rows,
    boundary:"Real handler subset only; not full dynamic controls/browser/visual/native/release acceptance"},null,2)+"\n");
  console.log(`C2 registered handlers: PASS (${rows.length} actual HTTP assertions; durable note/task/draft, denial, conflict, cache/calendar readback)`);
}finally{await h.close();}
