import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

let fakeNativeCalls = 0;
let nativeDisposition: "blocked" | "unknown" | "succeeded" | "definite_failure" = "blocked";
let waitForNative: (() => Promise<void>) | undefined;
const h = await stage3BHttpFixture(async app => {
  const { registerTicketsTasksRoutes } = await import("../server/routes/tickets-tasks");
  const { registerCrmOperationsRoutes } = await import("../server/routes/crm-operations");
  registerTicketsTasksRoutes(app);
  registerCrmOperationsRoutes(app, { nativeTaskDeleteTransport: async () => {
    fakeNativeCalls++;
    await waitForNative?.();
    return { disposition: nativeDisposition, reason: "fixture_only" };
  } });
});
try {
  const task = async (assignedTo = h.email("agent"), extra = "") => (await h.pool.query(
    `INSERT INTO tasks(title,assigned_to,canonical_assignee,status,authority_state${extra ? ",ghl_task_id,contact_id" : ""})
     VALUES($1,$2,$2,'pending','open'${extra ? `,${extra}` : ""}) RETURNING *`, [h.prefix,assignedTo])).rows[0];
  const body = (fields: Record<string, unknown> = {}, fence = 0) =>
    ({ ...fields, expectedFence: fence, commandId: randomUUID(), expectedActorId: h.userId("agent") });
  const staleAccountTask=await task();
  assert.equal((await h.request("agent","PUT",`/api/tasks/${staleAccountTask.id}`,
    {...body({status:"completed"}),expectedAccountVersion:999})).status,409);
  assert.equal((await h.pool.query("SELECT authority_fence,status FROM tasks WHERE id=$1",[staleAccountTask.id])).rows[0].authority_fence,0);
  const a = await task(), b = await task(), foreign = await task(h.email("other"));
  const put = (id: number, data: any, role = "agent") => h.request(role,"PUT",`/api/tasks/${id}`,data);
  const creation = {title:"Durable owned unlinked creation",commandId:randomUUID(),expectedActorId:h.userId("agent")};
  const created = await h.request("agent","POST","/api/tasks",creation);
  assert.equal(created.status,201);
  assert.equal(created.body.assignedTo,h.email("agent"));
  assert.equal(created.body.authorityState,"open");
  const createdReplay = await h.request("agent","POST","/api/tasks",creation);
  assert.equal(createdReplay.status,200); assert.equal(createdReplay.body.id,created.body.id);
  assert.equal(createdReplay.body.creationReplayed,true);
  assert.equal((await h.request("agent","POST","/api/tasks",{...creation,title:"Different retry"})).status,409);
  assert.equal((await put(a.id, body({ title: "Versioned edit" }), "agent")).status, 200);
  a.authority_fence = 1;
  assert.equal((await h.request("agent","PUT",`/api/tasks/${a.id}`,body({title:"Denied"},1),false)).status,403);
  for (const role of ["merchant","affiliate","partner"]) {
    assert.equal((await put(a.id,body({title:"Denied"},1),role)).status,403);
  }
  assert.equal((await put(a.id,body({title:"Denied"},1),"anonymous")).status,401);
  assert.equal((await put(a.id,{title:"Missing fence"})).status,400);
  assert.equal((await put(a.id,body({title:"Stale"}))).status,409);
  assert.equal((await put(a.id,body({completedAt:new Date().toISOString()},1))).status,400);
  assert.equal((await put(a.id,{...body({title:"Wrong actor"},1),expectedActorId:h.userId("other")})).status,409);
  const count = async () => (await h.pool.query("SELECT count(*)::int n FROM task_authority_events")).rows[0].n;
  let before = await count();
  assert.equal((await put(foreign.id,body({title:"Forged"}))).status,404);
  const mixed = { items:[{id:b.id,expectedFence:0},{id:foreign.id,expectedFence:0}], commandId:randomUUID() };
  assert.equal((await h.request("agent","POST","/api/tasks/bulk-complete",mixed)).status,404);
  assert.equal(await count(),before,"complete denied set writes no events");
  const completed = body({status:"completed",description:null,dueDate:null},1);
  const saved = await put(a.id,completed);
  assert.equal(saved.status,200); assert.equal(saved.body.authorityState,"completed");
  assert.equal(saved.body.authorityFence,2); assert.ok(saved.body.completedAt);
  before = await count();
  const replay = await put(a.id,completed);
  assert.equal(replay.status,200); assert.deepEqual(replay.body,saved.body);
  assert.equal(await count(),before,"lost-response replay has no new event");
  assert.equal((await put(b.id,{...completed,expectedFence:0})).status,409,"disjoint set cannot reuse command UUID");
  const reopened = await put(a.id,body({status:"pending"},2));
  assert.equal(reopened.status,200); assert.equal(reopened.body.completedAt,null);
  assert.equal(reopened.body.authorityState,"open");
  const owner = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class,ghl_contact_id)
    VALUES('Authorized fixture','Work',$1,$3,$2,'production','fixture-native-contact') RETURNING id`,[`${h.prefix}-contact@example.test`,h.email("agent"),`+1${String(Date.now()).slice(-10)}`])).rows[0].id;
  const deniedContact = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Other fixture','Work',$1,$3,$2,'production') RETURNING id`,[`${h.prefix}-other@example.test`,h.email("other"),`+1${String(Date.now()+1).slice(-10)}`])).rows[0].id;
  assert.equal((await put(b.id,body({contactId:deniedContact}))).status,404,"prospective endpoint denied");
  const linked = await put(b.id,body({contactId:owner}));
  assert.equal(linked.status,200);
  const ticket = (await h.pool.query(`INSERT INTO tickets(contact_id,subject,description,status,authority_state)
    VALUES($1,'Fixture','Fixture work','New Ticket','open') RETURNING *`,[owner])).rows[0];
  assert.equal((await h.request("agent","PUT",`/api/tickets/${ticket.id}`,body({contactId:null}))).status,404);
  const ticketSaved = await h.request("agent","PUT",`/api/tickets/${ticket.id}`,body({status:"Resolved"}));
  assert.equal(ticketSaved.status,200); assert.ok(ticketSaved.body.resolvedAt);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM ticket_comments WHERE ticket_id=$1",[ticket.id])).rows[0].n,1,
    "existing status conversation is saved exactly once with the work command");
  const ticketReopened = await h.request("agent","PUT",`/api/tickets/${ticket.id}`,body({status:"New Ticket"},1));
  assert.equal(ticketReopened.status,200); assert.equal(ticketReopened.body.resolvedAt,null);
  // An audit failure must roll back fields and authority events in the same transaction.
  await h.pool.query(`CREATE FUNCTION fixture_work_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='task_commanded' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_work_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_work_audit_failure();`);
  before = await count();
  assert.equal((await put(b.id,body({description:"Must roll back"},1))).status,500);
  assert.equal(await count(),before);
  assert.equal((await h.pool.query("SELECT description,authority_fence FROM tasks WHERE id=$1",[b.id])).rows[0].authority_fence,1);
  await h.pool.query("DROP TRIGGER fixture_work_audit_failure ON audit_logs; DROP FUNCTION fixture_work_audit_failure();");
  const bulk = { commandId:randomUUID(), items:[{id:a.id,expectedFence:3},{id:b.id,expectedFence:1},{id:b.id,expectedFence:1}] };
  const bulkSaved = await h.request("agent","POST","/api/tasks/bulk-complete",bulk);
  assert.equal(bulkSaved.status,200); assert.equal(bulkSaved.body.changed,2);
  assert.equal((await h.request("agent","POST","/api/tasks/bulk-complete",bulk)).body.replayed,true);
  // Direct ID authorization must work beyond the old bounded-list window.
  await h.pool.query(`INSERT INTO tasks(id,title,assigned_to,canonical_assignee,status,authority_state)
    SELECT g,'Fixture population',$1,$1,'pending','open' FROM generate_series(60000,65001) g`,[h.email("agent")]);
  assert.equal((await put(65001,body({description:"Indexed ID"}))).status,200);
  const native = await task(h.email("agent"),`'fixture-native-task',${owner}`);
  const removeBody = body();
  assert.equal((await h.request("agent","DELETE",`/api/tasks/${native.id}`,removeBody)).status,409);
  assert.equal((await h.pool.query("SELECT deleted_at FROM tasks WHERE id=$1",[native.id])).rows[0].deleted_at,null);
  const pausedCalls = fakeNativeCalls;
  assert.equal((await h.request("agent","DELETE",`/api/tasks/${native.id}`,removeBody)).status,409);
  assert.equal(fakeNativeCalls,pausedCalls,"blocked receipt never retries native I/O");
  nativeDisposition = "unknown";
  const unknown = await task(h.email("agent"),`'fixture-unknown-task',${owner}`);
  assert.equal((await h.request("agent","DELETE",`/api/tasks/${unknown.id}`,body())).status,409);
  assert.equal((await put(unknown.id,body({title:"Cannot cross unknown intent"}))).status,409);
  nativeDisposition = "definite_failure";
  const concurrent = await task(h.email("agent"),`'fixture-concurrent-task',${owner}`);
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => entered=resolve);
  waitForNative = () => new Promise<void>(resolve => { release=resolve; entered(); });
  const pending = h.request("agent","DELETE",`/api/tasks/${concurrent.id}`,body());
  await enteredPromise;
  assert.equal((await put(concurrent.id,body({title:"Concurrent edit"}))).status,409);
  release(); assert.equal((await pending).status,409); waitForNative=undefined;
  assert.equal((await put(concurrent.id,body({title:"Edit after definite failure"}))).status,200);
  nativeDisposition = "succeeded";
  const success = await task(h.email("agent"),`'fixture-success-task',${owner}`);
  const successBody = body();
  await h.pool.query(`CREATE FUNCTION fixture_delete_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='task_soft_deleted' THEN RAISE EXCEPTION 'fixture finalize audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_delete_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_delete_audit_failure();`);
  assert.equal((await h.request("agent","DELETE",`/api/tasks/${success.id}`,successBody)).status,500);
  const callsAtSuccess = fakeNativeCalls;
  assert.equal((await h.pool.query("SELECT deleted_at FROM tasks WHERE id=$1",[success.id])).rows[0].deleted_at,null);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM task_authority_events WHERE task_id=$1 AND event_type='native_delete_succeeded'",[success.id])).rows[0].n,1);
  await h.pool.query("DROP TRIGGER fixture_delete_audit_failure ON audit_logs; DROP FUNCTION fixture_delete_audit_failure();");
  assert.equal((await h.request("agent","DELETE",`/api/tasks/${success.id}`,successBody)).status,200);
  assert.equal(fakeNativeCalls,callsAtSuccess,"confirmed native result survives local rollback and is never resent");
  assert.ok((await h.pool.query("SELECT deleted_at FROM tasks WHERE id=$1",[success.id])).rows[0].deleted_at);
  assert.equal(h.externalCalls(),0);
  console.log("PASS C01 actual sessions/CSRF: exact fences, canonical completion/reopen, explicit clears, second-endpoint and complete-set denial, disjoint retry mismatch, duplicate normalization, 5000+ indexed ID, atomic audit rollback, paused/unknown native outcomes, concurrent intent fence and retained-success local retry. ZERO external/provider/native calls (fake transport only). Trusted producer/browser gates are separate.");
} finally { await h.close(); }
