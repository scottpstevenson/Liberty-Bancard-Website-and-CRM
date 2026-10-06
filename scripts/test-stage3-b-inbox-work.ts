import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const h=await stage3BHttpFixture(async app=>{
  const {registerInboxOwnershipRoutes}=await import("../server/routes/inbox-ownership");
  const {registerTicketsTasksRoutes}=await import("../server/routes/tickets-tasks");
  registerInboxOwnershipRoutes(app);registerTicketsTasksRoutes(app);
});
try {
  const {upsertInboxItem,getInboxItem}=await import("../server/storage/inbox");
  for(const role of ["agent","other"]) {
    const result=await h.pool.query(`INSERT INTO agents(first_name,last_name,email,user_id,status)
      VALUES('Duplicate','Name',$1,$2,'active') RETURNING id`,[h.email(role),h.userId(role)]);
    await h.pool.query("UPDATE users SET agent_id=$2 WHERE id=$1",[h.userId(role),String(result.rows[0].id)]);
  }
  const contact=async(role:string)=> (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Inbox','Fixture',$1,$2,$3,'production') RETURNING id`,
    [`${randomUUID()}@example.test`,`+1${String(Date.now()+Math.floor(Math.random()*100000)).slice(-10)}`,h.email(role)])).rows[0].id;
  const owned=await contact("agent"),foreign=await contact("other");
  const key="fixture-mailbox-a::message-1";
  await upsertInboxItem({sourceItemId:key,contactId:owned,sourceItemType:"email",sourceBody:"Original observation"});
  const body=(version=1,fields:any={})=>({...fields,expectedVersion:version,commandId:randomUUID(),
    expectedActorId:h.userId("agent"),expectedAccountVersion:1});
  const send=(operation:string,payload:any,role="agent",csrf=true)=>h.request(role,
    operation==="ownership"?"PATCH":"POST",`/api/inbox/items/${key}/${operation}`,payload,csrf);
  const assigned=await send("ownership",body(1,{ownerId:h.userId("agent"),ownerName:"Forged person"}));
  assert.equal(assigned.status,200,JSON.stringify(assigned.body));assert.equal(assigned.body.item.ownerId,h.userId("agent"));
  assert.equal(assigned.body.item.ownerName,h.email("agent"));assert.equal(assigned.body.item.version,2);
  await upsertInboxItem({sourceItemId:key,contactId:foreign,ownerId:"forged",status:"new",sourceBody:"Replacement"});
  const observed=await getInboxItem(key);assert.equal(observed!.contactId,owned);assert.equal(observed!.ownerId,h.userId("agent"));
  assert.equal(observed!.sourceBody,"Original observation");assert.equal(observed!.version,2,"discovery doesn't reset human workflow");
  for(const role of ["merchant","partner","affiliate"]) assert.equal((await send("ownership",body(2),role)).status,403);
  assert.equal((await send("ownership",body(2),"anonymous")).status,401);
  assert.equal((await send("ownership",body(2),"agent",false)).status,403);
  assert.equal((await send("ownership",{...body(2),expectedActorId:h.userId("other")})).status,409);
  assert.equal((await send("ownership",body(1))).status,409);
  assert.equal((await send("ownership",body(2,{contactId:foreign}))).status,404);
  assert.equal((await send("ownership",body(2,{ownerId:h.userId("other")}))).status,409);
  assert.equal((await send("ownership",{...body(2),expectedActorId:h.userId("other")},"other")).status,404);
  assert.equal((await h.request("other","GET",`/api/inbox/items/${key}/ownership`)).status,404);
  const booking=body(2,{contactId:owned});
  const booked=await send("book-appointment",booking);
  assert.equal(booked.status,200,JSON.stringify(booked.body));assert.equal(booked.body.delivered,false);
  assert.equal(booked.body.bookingState,"not_configured");assert.ok(booked.body.taskId);
  const task=await h.pool.query("SELECT * FROM tasks WHERE id=$1",[booked.body.taskId]);
  assert.equal(task.rows[0].canonical_assignee,h.email("agent"));
  const list=await h.request("agent","GET","/api/tasks");
  assert.ok(list.body.some((row:any)=>row.id===booked.body.taskId),"intended rep sees the actual local work");
  const replay=await send("book-appointment",booking);assert.equal(replay.status,200);
  assert.equal(replay.body.taskId,booked.body.taskId);assert.equal(replay.body.replayed,true);
  assert.equal((await send("book-appointment",{...booking,intent:"changed"})).status,409);
  const escalating=body(3,{reason:"Review"});
  const pair=await Promise.all([send("escalate",escalating),send("escalate",escalating)]);
  assert.ok(pair.every(result=>result.status===200));assert.equal(pair[0].body.taskId,pair[1].body.taskId);
  assert.equal(pair[0].body.assignmentState,"management_review_required");
  assert.equal((await h.pool.query("SELECT canonical_assignee FROM tasks WHERE id=$1",[pair[0].body.taskId])).rows[0].canonical_assignee,null);
  assert.equal((await h.pool.query("SELECT assigned_to FROM contacts WHERE id=$1",[owned])).rows[0].assigned_to,h.email("agent"));
  await h.pool.query(`CREATE FUNCTION fixture_inbox_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='inbox_no_show_commanded' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_inbox_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_inbox_fail();`);
  const before=(await h.pool.query("SELECT count(*)::int n FROM tasks")).rows[0].n;
  const noShow=body(4);
  assert.equal((await send("no-show",noShow)).status,500);
  assert.equal((await getInboxItem(key))!.version,4);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM tasks")).rows[0].n,before);
  await h.pool.query("DROP TRIGGER fixture_inbox_fail ON audit_logs; DROP FUNCTION fixture_inbox_fail();");
  assert.equal((await send("no-show",noShow)).status,200);
  assert.equal((await send("no-show",noShow)).body.replayed,true);
  await h.pool.query("UPDATE users SET account_state='deactivated' WHERE id=$1",[h.userId("other")]);
  assert.ok(!(await h.request("agent","GET","/api/inbox/staff")).body.some((row:any)=>row.id===h.userId("other")));
  assert.equal(h.externalCalls(),0);
  console.log("PASS registered inbox ownership: actor/account/version, derived identity, complete linked ownership, immutable observation, duplicate-name/current roster, booking preparation only, management review, atomic task/audit rollback, concurrent/retry receipts, zero external calls. Browser proof separate.");
} finally {await h.close();}
