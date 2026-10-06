import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const h=await stage3BHttpFixture(async app=>{
  const {registerPublicRoutes}=await import("../server/routes/public");
  const {registerToolkitRoutes}=await import("../server/routes/toolkit");
  const {registerTicketsTasksRoutes}=await import("../server/routes/tickets-tasks");
  registerPublicRoutes(app);
  registerToolkitRoutes(app);registerTicketsTasksRoutes(app);
});
try {
  const {claimInboundRequest,orchestrateInboundRequest}=await import("../server/services/inbound-request-authority");
  const {storage}=await import("../server/storage");
  await h.pool.query("INSERT INTO agents(user_id,first_name,last_name,email,status,role) VALUES($1,'Agent','Fixture',$2,'active','sales_rep')",
    [h.userId("agent"),h.email("agent")]);
  const contact=(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to)
    VALUES('Inbound','Fixture',$1,'','production',$2) RETURNING id`,[`${randomUUID()}@example.test`,h.email("agent")])).rows[0];
  const assigned=await claimInboundRequest({idempotencyKey:randomUUID(),sourceCategory:"manual_crm",sourceType:"dashboard",
    callerScope:`user:${h.userId("admin")}`,actorType:"user",actorId:h.userId("admin"),payload:{contactId:contact.id}});
  // Current owner is a real active rep, independent of display names and an
  // absent env roster. No allocation or live reassignment is manufactured.
  const pair=await Promise.all([orchestrateInboundRequest({requestId:assigned.request.id,contactId:contact.id}),
    orchestrateInboundRequest({requestId:assigned.request.id,contactId:contact.id})]);
  assert.equal(pair[0].assignedTo,h.email("agent"));
  const work=(await h.pool.query("SELECT * FROM tasks WHERE contact_id=$1 AND source='inbound_request'",[contact.id])).rows;
  assert.equal(work.length,1);assert.equal(work[0].canonical_assignee,h.email("agent"));assert.ok(work[0].due_date);
  const list=await h.request("agent","GET","/api/tasks");
  assert.equal(list.status,200);
  const rows=Array.isArray(list.body)?list.body:list.body.data;
  assert.ok(rows.some((row:any)=>row.id===work[0].id),"assigned user-ID/email mapping yields actually visible work");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM inbound_request_work_links WHERE request_id=$1",[assigned.request.id])).rows[0].n,1);
  await h.pool.query("UPDATE users SET account_state='deactivated' WHERE id=$1",[h.userId("agent")]);
  const replay=await orchestrateInboundRequest({requestId:assigned.request.id,contactId:contact.id});
  assert.equal(replay.assignmentStatus,"review_required");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM tasks WHERE contact_id=$1 AND source='inbound_request'",[contact.id])).rows[0].n,1);
  await h.pool.query("UPDATE users SET account_state='active' WHERE id=$1",[h.userId("agent")]);
  const publicInput={softwareName:"Fixture software",contactName:"Public Fixture",email:`${randomUUID()}@example.test`,phone:"",notes:"Protected fixture occurrence"};
  const path="/api/public/integration-request",key=randomUUID(),headers={"Idempotency-Key":key};
  assert.equal((await h.request("anonymous","POST",path,publicInput)).status,400);
  const accepted=await h.request("anonymous","POST",path,publicInput,true,headers);
  assert.equal(accepted.status,201,JSON.stringify(accepted.body));
  assert.ok(accepted.body.requestReceipt);
  const publicReplay=await h.request("anonymous","POST",path,publicInput,true,headers);
  assert.equal(publicReplay.status,200);
  assert.equal(publicReplay.body.requestReceipt,accepted.body.requestReceipt);
  assert.equal((await h.request("anonymous","POST",path,{...publicInput,notes:"changed payload"},true,headers)).status,409);
  const tasks=(await h.pool.query(`SELECT t.* FROM tasks t JOIN inbound_request_work_links l ON l.task_id=t.id WHERE l.request_id=$1`,
    [accepted.body.requestReceipt])).rows;
  assert.equal(tasks.length,1);assert.equal(tasks[0].canonical_assignee,null);assert.match(tasks[0].description,/Management assignment review/);
  assert.equal(tasks[0].contact_id,null,"unknown contact is not admitted to production rep work");
  assert.equal((await h.pool.query("SELECT record_class FROM contacts WHERE email=$1",[publicInput.email])).rows[0].record_class,"unknown",
    "intake review never reclassifies a contact to force admission");
  assert.ok((await h.request("manager","GET","/api/tasks")).body.some((row:any)=>row.id===tasks[0].id),"unassigned obligation visible to management");
  assert.ok((await h.pool.query("SELECT state FROM inbound_request_effects WHERE request_id=$1 AND external_side_effect=true",
    [accepted.body.requestReceipt])).rows.every(row=>row.state==="held"));
  const badMixed=await h.request("manager","PUT","/api/admin/round-robin",{expectedVersion:1,
    reps:[{userId:h.userId("agent"),paused:false},{userId:h.userId("merchant"),paused:false}]});
  assert.equal(badMixed.status,409);
  assert.equal((await h.request("manager","GET","/api/admin/round-robin")).body.version,1,"mixed roster denial makes zero partial writes");
  const configured=await h.request("manager","PUT","/api/admin/round-robin",{expectedVersion:1,enabled:true,
    reps:[{userId:h.userId("agent"),name:"Not an identity",paused:false}]});
  assert.equal(configured.status,200,JSON.stringify(configured.body));
  assert.equal(configured.body.reps[0].email,h.email("agent"));
  assert.equal((await h.request("manager","PUT","/api/admin/round-robin",{expectedVersion:1,enabled:false})).status,409);
  await h.pool.query("UPDATE users SET account_state='deactivated' WHERE id=$1",[h.userId("agent")]);
  assert.ok(!(await h.request("manager","GET","/api/admin/round-robin/eligible-reps")).body.some((row:any)=>row.id===h.userId("agent")));
  assert.equal(h.externalCalls(),0);
  console.log("PASS registered public intake replay/payload denial, actual occurrence/task/SLA links, active canonical owner work visibility, inactive replay review without duplicate work, held external effects, no-pool visible management review, toolkit current-state/identity/version/mixed-roster isolation; zero external calls.");
} finally {await h.close();}
