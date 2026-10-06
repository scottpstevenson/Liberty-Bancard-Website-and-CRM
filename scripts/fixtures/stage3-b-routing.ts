import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { stage3BHttpFixture } from "./stage3-b-http";

/** Invoked only after the enclosing suite's pre-import isolation proof. */
export async function verifyRouting(h:Awaited<ReturnType<typeof stage3BHttpFixture>>) {
  const {claimInboundRequest,orchestrateInboundRequest} = await import("../../server/services/inbound-request-authority");
  const {storage} = await import("../../server/storage");
  const {commandWorkItems} = await import("../../server/services/work-item-command");
  const repId = h.userId("agent"), email=h.email("agent");
  await h.pool.query(`INSERT INTO agents(user_id,first_name,last_name,email,status)
    VALUES($1,'Duplicate','Name',$2,'active')`,[repId,email]);
  const secondId=randomUUID(), secondEmail=`${h.prefix}-second@example.test`;
  await h.pool.query(`INSERT INTO users(id,email,role,account_state) VALUES($1,$2,'agent','active')`,[secondId,secondEmail]);
  await h.pool.query(`INSERT INTO agents(user_id,first_name,last_name,email,status)
    VALUES($1,'Duplicate','Name',$2,'active')`,[secondId,secondEmail]);
  const contact = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Routing','Fixture',$1,$2,$3,'production') RETURNING *`,
    [`${h.prefix}-routing@example.test`,`+1${String(Date.now()+232).slice(-10)}`,email])).rows[0];
  const claim = async () => {
    const result = await claimInboundRequest({idempotencyKey:randomUUID(),sourceCategory:"website_form",
      sourceType:"estimate_form",callerScope:"fixture",actorType:"anonymous",payload:{fixture:h.prefix},
      sourceReceivedAt:new Date("2026-10-06T10:00:00.000Z")});
    assert.equal(result.outcome,"claimed");
    if (!("request" in result)) throw new Error("Fixture claim failed");
    return result.request;
  };
  process.env.INBOUND_ASSIGNMENT_POLICY_JSON=JSON.stringify({version:"fixture-v1",
    reps:[{id:repId,serviceHours:{unsupported:true},load:0,capacity:1},{id:secondId,load:0,capacity:1}]});
  const request=await claim();
  const accepted=await orchestrateInboundRequest({requestId:request.id,contactId:contact.id});
  assert.equal(accepted.assignedTo,email,"stable user ID resolves canonical email, not duplicate display name");
  const task=(await h.pool.query("SELECT * FROM tasks WHERE command_key=$1",[`inbound:${request.id}:task`])).rows[0];
  assert.equal(task.canonical_assignee,email); assert.ok(task.due_date);
  const listing=await h.request("agent","GET","/api/tasks?recordClass=production");
  assert.equal(listing.status,200); assert.ok(listing.body.some((t:any)=>t.id===task.id),"assigned actor actually sees linked work");
  const decision=(await h.pool.query("SELECT * FROM inbound_assignment_decisions WHERE request_id=$1",[request.id])).rows[0];
  assert.equal(decision.service_hours_snapshot.mode,"not_enforced");
  assert.equal(decision.capacity_snapshot.mode,"configured_load_advisory_not_reserved");
  const editedDue=new Date("2026-11-04T14:00:00.000Z");
  await commandWorkItems({kind:"task",actor:{id:repId,authEpoch:0},
    commandId:randomUUID(),items:[{id:task.id,expectedFence:task.authority_fence}],updates:{dueDate:editedDue}});
  process.env.INBOUND_ASSIGNMENT_POLICY_JSON=JSON.stringify({version:"fixture-v2",reps:[{id:secondId}]});
  const repeated=await orchestrateInboundRequest({requestId:request.id,contactId:contact.id});
  assert.equal(repeated.assignedTo,email,"accepted election does not change with policy");
  assert.equal((await storage.getTaskById(task.id))!.dueDate!.getTime(),editedDue.getTime(),"replay preserves human deadline");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM inbound_assignment_decisions WHERE request_id=$1",[request.id])).rows[0].n,1);
  await h.pool.query("UPDATE agents SET status='inactive' WHERE user_id=$1",[repId]);
  const unavailable=await orchestrateInboundRequest({requestId:request.id,contactId:contact.id});
  assert.equal(unavailable.assignmentStatus,"review_required"); assert.equal(unavailable.assignedTo,email,"retained accepted attribution");
  assert.equal((await storage.getTaskById(task.id))!.canonicalAssignee,email);
  const foreign=await claim();
  const review=await orchestrateInboundRequest({requestId:foreign.id,contactId:contact.id});
  assert.equal(review.assignedTo,null); assert.equal(review.assignmentStatus,"review_required");
  const held=(await h.pool.query("SELECT * FROM tasks WHERE command_key=$1",[`inbound:${foreign.id}:task`])).rows[0];
  assert.equal(held.canonical_assignee,null); assert.match(held.description,/Management assignment review/);
  assert.equal((await storage.getContact(contact.id))!.assignedTo,email,"no foreign ownership theft");
  const {assignNextRep,getRoundRobinPool} = await import("../../server/services/round-robin-policy");
  assert.equal((await h.request("agent","GET","/api/admin/round-robin")).status,403);
   let initial=await h.request("manager","GET","/api/admin/round-robin");
  assert.equal(initial.status,200);
   // This check declares a single-candidate pool. Earlier canonical suites may
   // retain memberships; remove only those memberships through the real
   // versioned command, preserving their users, assignments and pool history.
   for(const rep of initial.body.reps){
     const removed=await h.request("manager","DELETE",
       `/api/admin/round-robin/rep/${encodeURIComponent(rep.userId)}`,
       {expectedVersion:initial.body.version});
     assert.equal(removed.status,200);initial=removed;
   }
  const added=await h.request("manager","POST","/api/admin/round-robin/rep",
    {expectedVersion:initial.body.version,userId:secondId,name:"Duplicate Name",email:"forged@example.test"});
  assert.equal(added.status,200); assert.equal(added.body.reps[0].email,secondEmail);
  assert.equal((await h.request("manager","PUT","/api/admin/round-robin",
    {expectedVersion:initial.body.version,enabled:true})).status,409,"stale pool cannot overwrite accepted change");
  const enabled=await h.request("manager","PUT","/api/admin/round-robin",{expectedVersion:added.body.version,enabled:true});
  assert.equal(enabled.status,200);
  const currentRoster=await h.request("manager","GET","/api/admin/round-robin/eligible-reps");
  assert.equal(currentRoster.status,200); assert.ok(currentRoster.body.some((u:any)=>u.id===secondId));
  assert.ok(!currentRoster.body.some((u:any)=>u.id===repId),"inactive profile isn't a selectable current rep");
  const poolActor={id:h.userId("manager"),authEpoch:0};
  assert.equal(await assignNextRep(contact.id,"Ignore forged display name",poolActor),null,"toolkit never steals another owner's contact");
  assert.equal((await getRoundRobinPool()).version,enabled.body.version,"no false selection count on review");
  const fresh=(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class)
    VALUES('Initial','Unassigned',$1,$2,'production') RETURNING id`,
    [`${h.prefix}-initial@example.test`,`+1${String(Date.now()+842).slice(-10)}`])).rows[0];
  assert.equal(await assignNextRep(fresh.id,"Forged recipient name",poolActor),secondEmail);
  assert.equal((await storage.getContact(fresh.id))!.assignedTo,secondEmail,"initial handoff persists canonical ownership");
  const afterPool=await getRoundRobinPool();
  assert.equal(afterPool.reps[0].assignedCount,1); assert.equal(afterPool.log[0].assignedTo,secondEmail);
  assert.equal(await assignNextRep(fresh.id,"Retry",poolActor),secondEmail);
  assert.equal((await getRoundRobinPool()).reps[0].assignedCount,1,"accepted initial assignment isn't counted twice");
  await assert.rejects(orchestrateInboundRequest({requestId:request.id,contactId:contact.id+99999}),/LINK_CHANGED/);
  assert.equal(h.externalCalls(),0);
  console.log("PASS C02 routing service: linked identity, duplicate names, actual actor list, accepted election freeze, inactive review, foreign owner zero theft, truthful advisory/hours, human deadline retention. Registered public intake/toolkit/inbox and concurrency proofs remain pending.");
}
