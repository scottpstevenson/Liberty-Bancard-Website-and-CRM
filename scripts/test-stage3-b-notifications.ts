import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const h=await stage3BHttpFixture(async app=>{
  const {registerNotificationsRoutes}=await import("../server/routes/notifications");
  registerNotificationsRoutes(app);
});
try {
  const notice=async(metadata:any={},recipient:string|null=null,read=false)=>(await h.pool.query(
    `INSERT INTO notifications(channel,title,message,recipient_id,metadata,read,created_at)
     VALUES('internal','Fixture notice','Retained evidence',$1,$2,$3,'2026-01-01') RETURNING id`,
    [recipient,metadata,read])).rows[0].id;
  const broadcast={eventType:"system_announcement",broadcast:true};
  const shared=await notice(broadcast,null,true);
  const personal=await notice({},h.userId("agent"),true);
  const other=await notice({},h.userId("other"));
  const unknown=await notice({eventType:"legacy_business"});
  const merchant=await notice({},h.userId("merchant"));
  const ownContact=(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Protected','Fixture',$1,$2,$3,'production') RETURNING id`,
    [`${randomUUID()}@example.test`,`+1${String(Date.now()).slice(-10)}`,h.email("agent")])).rows[0].id;
  const scoped=await notice({contactId:ownContact,eventType:"hot_lead"});
  const malicious=await notice({link:"//evil.test/dashboard",eventType:"system_announcement",broadcast:true});
  const malformed=await notice({contactId:"1junk",eventType:"hot_lead"});
  const foreignPersonal=await notice({contactId:ownContact},h.userId("other"));
  const get=async(role:string,query="")=>h.request(role,"GET",`/api/notifications${query}`);
  const list=await get("agent");assert.equal(list.status,200,JSON.stringify(list.body));
  assert.deepEqual(new Set(list.body.data.map((row:any)=>row.id)),new Set([shared,personal,scoped]));
  assert.equal(list.body.data.find((row:any)=>row.id===shared).read,false,"legacy shared read provenance is not inferred");
  assert.equal(list.body.data.find((row:any)=>row.id===personal).read,true,"personal historical state preserved");
  assert.equal((await h.request("agent","GET","/api/notifications/count")).body.unread,2);
  assert.deepEqual(new Set((await get("other")).body.data.map((row:any)=>row.id)),new Set([shared,other]));
  assert.deepEqual((await get("merchant")).body.data.map((row:any)=>row.id),[merchant],"portal personal notice preserved, broadcasts withheld");
  assert.ok(!(await get("agent")).body.data.some((row:any)=>[unknown,malicious,malformed,foreignPersonal].includes(row.id)));
  await h.pool.query("INSERT INTO notification_preferences(user_id,event_type,enabled) VALUES($1,'hot_lead',false)",[h.userId("agent")]);
  assert.equal((await h.request("agent","GET","/api/notifications/count")).body.unread,1);
  assert.equal((await get("agent","?category=leads")).body.total,0);
  for(const path of ["?limit=-1","?offset=1.5","?category=unsupported"]) assert.equal((await get("agent",path)).status,400);
  assert.equal((await h.request("agent","PUT",`/api/notifications/${shared}/read`,{})).status,200);
  assert.equal((await h.request("agent","GET","/api/notifications/count")).body.unread,0);
  assert.equal((await h.request("other","GET","/api/notifications/count")).body.unread,2,"another actor's state unaffected");
  assert.equal((await h.request("agent","DELETE",`/api/notifications/${shared}`,{})).status,200);
  assert.ok((await get("other")).body.data.some((row:any)=>row.id===shared));
  assert.equal((await h.request("other","DELETE",`/api/notifications/${personal}`,{})).status,404);
  assert.equal((await h.request("agent","PUT","/api/notifications/1bad/read",{})).status,400);
  assert.equal((await h.request("agent","PUT",`/api/notifications/${personal}/read`,{},false)).status,403);
  assert.equal((await get("anonymous")).status,401);
  await h.pool.query("UPDATE notification_preferences SET enabled=true WHERE user_id=$1",[h.userId("agent")]);
  const target=await h.request("agent","GET",`/api/notifications/${scoped}/target`);
  assert.equal(target.body.url,`/dashboard/contacts/${ownContact}`);
  assert.equal((await h.request("other","GET",`/api/notifications/${scoped}/target`)).body.state,"unavailable");
  await h.pool.query("UPDATE contacts SET archived_at=NOW() WHERE id=$1",[ownContact]);
  assert.equal((await h.request("agent","GET",`/api/notifications/${scoped}/target`)).body.state,"unavailable");
  assert.ok(!(await get("agent")).body.data.some((row:any)=>row.id===scoped));
  assert.equal((await h.request("other","POST","/api/notifications/mark-all-read",{})).status,200);
  assert.equal((await h.request("other","DELETE","/api/notifications/clear-all",{})).status,200);
  assert.equal((await get("other")).body.total,0);
   assert.equal((await h.pool.query("SELECT count(*)::int n FROM notifications WHERE id=ANY($1::int[])",
     [[shared,personal,other,unknown,merchant,scoped,malicious,malformed,foreignPersonal]])).rows[0].n,9,"all original fixture notification evidence retained");
  const {storage}=await import("../server/storage");
  await h.pool.query("UPDATE contacts SET archived_at=NULL WHERE id=$1",[ownContact]);
  const produced=await storage.createNotification({channel:"internal",title:"Assignment fixture",message:"Actor-local work",
    metadata:{contactId:ownContact,eventType:"task_assigned",assignedTo:h.email("agent")}});
  assert.equal(produced.recipientId,h.userId("agent"),"producer resolves explicit canonical email to current user ID");
  const personalEmail=await storage.createNotification({channel:"internal",title:"Explicit fixture",message:"Personal",
    recipientId:h.email("merchant")});
  assert.equal(personalEmail.recipientId,h.userId("merchant"),"explicit personal email is normalized, not broadcast");
  await h.pool.query("UPDATE users SET account_state='deactivated' WHERE id=$1",[h.userId("agent")]);
  const disabled=await storage.createNotification({channel:"internal",title:"Inactive fixture",message:"Review required",
    metadata:{contactId:ownContact,eventType:"task_assigned",assignedTo:h.email("agent")}});
  assert.equal(disabled.recipientId,null);
  assert.deepEqual(disabled.metadata.audienceRoles,["admin","manager"]);
  await h.pool.query("UPDATE users SET account_state='active' WHERE id=$1",[h.userId("agent")]);
  const conflicting=await notice({entityType:"contact",entityId:ownContact,contactId:2147483647,eventType:"hot_lead"});
  assert.ok(!(await get("agent")).body.data.some((row:any)=>row.id===conflicting),"conflicting typed IDs never reach actor content");
  const source=(await h.request("admin","GET",`/api/notifications/${conflicting}/target`)).body;
  assert.equal(source.state,"unavailable");
  assert.equal(h.externalCalls(),0);
  console.log("PASS actual notification handlers: actor audiences before body/count; portal personal preservation; preference/list/unread/category parity; strict paging; two-user read/dismiss/bulk isolation; shared provenance unchanged; safe typed/archived/denied targets; evidence retained; session/CSRF; zero external calls.");
} finally {await h.close();}
