import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async app => {
  const { registerTerminalEconomicsRoutes } = await import("../server/routes/terminal-economics");
  const { registerTicketsTasksRoutes } = await import("../server/routes/tickets-tasks");
  const { registerToolkitRoutes } = await import("../server/routes/toolkit");
  registerTerminalEconomicsRoutes(app);
  registerTicketsTasksRoutes(app);
  registerToolkitRoutes(app);
});
try {
  process.env.GHL_CRM_SYNC_MODE="enabled"; // This proved disposable child only; no shared environment mutation.
  const { storage } = await import("../server/storage");
  const { syncTaskFromGhl } = await import("../server/services/ghl-sync");
  const { commandProducedTask, commandWorkItems } = await import("../server/services/work-item-command");
  const { discoverSlaResolutionCandidates, resolveClearedSlaTask } = await import("../server/services/sla-task-resolution");
  const { autoCloseResolvedTicket } = await import("../server/services/ticket-auto-close");
  const contact = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class,ghl_contact_id)
    VALUES('Producer','Fixture',$1,$2,$3,'production',$4) RETURNING *`,
    [`${h.prefix}-contact@example.test`,`+1${String(Date.now()).slice(-10)}`,h.email("agent"),h.prefix])).rows[0];
  const eventCount = async (id:number) => (await h.pool.query("SELECT count(*)::int n FROM task_authority_events WHERE task_id=$1",[id])).rows[0].n;
  const incoming = {id:`native-${randomUUID()}`,title:"Same title",body:"Explicit native body",completed:false,dateUpdated:"occurrence-1"};
  const first = await syncTaskFromGhl(incoming,contact.ghl_contact_id);
  assert.equal(first.success,true); assert.ok(first.taskId);
  const second = await syncTaskFromGhl({...incoming,id:`native-${randomUUID()}`},contact.ghl_contact_id);
  assert.equal(second.success,true); assert.notEqual(second.taskId,first.taskId,"same title never merges different immutable native IDs");
  let before = await eventCount(first.taskId!);
  assert.equal((await syncTaskFromGhl(incoming,contact.ghl_contact_id)).taskId,first.taskId);
  assert.equal(await eventCount(first.taskId!),before,"creation snapshot replay does not duplicate a receipt");
  const completed = {...incoming,completed:true,dateUpdated:"occurrence-2"};
  assert.equal((await syncTaskFromGhl(completed,contact.ghl_contact_id)).success,true);
  let row = await storage.getTaskById(first.taskId!);
  assert.equal(row!.authorityState,"completed"); assert.ok(row!.completedAt);
  before = await eventCount(first.taskId!);
  await syncTaskFromGhl(completed,contact.ghl_contact_id);
  assert.equal(await eventCount(first.taskId!),before);
  await commandWorkItems({kind:"task",items:[{id:row!.id,expectedFence:row!.authorityFence}],commandId:randomUUID(),
    actor:{id:h.userId("agent"),authEpoch:0},updates:{status:"pending"}});
  await syncTaskFromGhl(completed,contact.ghl_contact_id);
  row = await storage.getTaskById(first.taskId!);
  assert.equal(row!.authorityState,"open","identical accepted snapshot cannot overwrite a human reopen");
  assert.equal(row!.completedAt,null);
  await syncTaskFromGhl({...incoming,dateUpdated:"occurrence-3"},contact.ghl_contact_id);
  assert.equal((await storage.getTaskById(first.taskId!))!.authorityState,"open");
  assert.equal((await syncTaskFromGhl({...incoming,id:undefined},contact.ghl_contact_id)).success,false);
  const makeDeal = async (stage="Statement Received",old=true) => (await h.pool.query(
    `INSERT INTO deals(contact_id,name,stage,owner,record_class,updated_at)
     VALUES($1,'Producer fixture',$2,$3,'production',$4) RETURNING *`,
    [contact.id,stage,h.email("agent"),new Date(Date.now()-(old?4*60*60_000:0))])).rows[0];
  const deal = await makeDeal();
  const approval = await storage.createAuthorityTask({title:"Terminal approval",dealId:deal.id,contactId:contact.id,status:"pending"},
    {producer:"terminal_request",issueKey:`terminal:${deal.id}`,subjectType:"deal",subjectId:deal.id});
  await h.pool.query("UPDATE deals SET terminal_approval_status='pending_approval',terminal_approval_task_id=$2 WHERE id=$1",[deal.id,approval.id]);
  const approvePath = `/api/deals/${deal.id}/terminal-economics/approve`;
  assert.equal((await h.request("agent","POST",approvePath,{})).status,403);
  await h.pool.query(`CREATE FUNCTION fixture_terminal_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='terminal_approval_approved' THEN RAISE EXCEPTION 'fixture paired audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_terminal_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_terminal_failure();`);
  assert.equal((await h.request("manager","POST",approvePath,{})).status,500);
  assert.equal((await storage.getTaskById(approval.id))!.authorityState,"open");
  assert.equal((await storage.getDeal(deal.id))!.terminalApprovalStatus,"pending_approval");
  await h.pool.query("DROP TRIGGER fixture_terminal_failure ON audit_logs; DROP FUNCTION fixture_terminal_failure();");
  const accepted = await h.request("manager","POST",approvePath,{});
  assert.equal(accepted.status,200);
  assert.equal((await storage.getTaskById(approval.id))!.authorityState,"completed");
  assert.equal((await storage.getDeal(deal.id))!.terminalApprovalStatus,"approved");
  before = await eventCount(approval.id);
  assert.equal((await h.request("manager","POST",approvePath,{})).body.replayed,true);
  assert.equal(await eventCount(approval.id),before);
  assert.equal((await h.request("manager","POST",`/api/deals/${deal.id}/terminal-economics/reject`,{reason:"Different decision"})).status,409);
  const breachedDeal = await makeDeal();
  const makeSla = (parent:any) => storage.createAuthorityTask({title:"SLA: Statement Review",dealId:parent.id,contactId:contact.id,status:"pending",source:"sla"},
    {producer:"sla",subjectType:"deal",subjectId:parent.id,issueKey:"deal-sla:Statement Review 2hr SLA",
      context:{slaRule:{name:"Statement Review 2hr SLA",stage:"Statement Received",maxDurationMinutes:120}}});
  const sla = await makeSla(breachedDeal);
  assert.ok((await discoverSlaResolutionCandidates()).some(t=>t.id===sla.id));
  await assert.rejects(resolveClearedSlaTask(sla),/no longer eligible/);
  assert.equal((await storage.getTaskById(sla.id))!.authorityState,"open","currently breached work remains open");
  await h.pool.query("UPDATE deals SET updated_at=NOW() WHERE id=$1",[breachedDeal.id]);
  await commandProducedTask({id:sla.id,producer:"fixture_human_edit",commandId:randomUUID(),updates:{description:"Preserve this edit"}});
  await assert.rejects(resolveClearedSlaTask(sla),/Work changed/,"stale discovered generation/fence cannot overwrite a concurrent edit");
  const fresh = (await storage.getTaskById(sla.id))!;
  const cleared = await resolveClearedSlaTask(fresh);
  assert.equal(cleared.changed,1);
  assert.equal((await storage.getTaskById(sla.id))!.description,"Preserve this edit");
  assert.equal((await resolveClearedSlaTask(fresh)).changed,0,"accepted producer retry is a truthful no-op");
  const next = await makeSla(breachedDeal);
  assert.notEqual(next.id,sla.id); assert.equal(next.generation,1);
  await h.pool.query("UPDATE deals SET updated_at=NOW()-INTERVAL '4 hours' WHERE id=$1",[breachedDeal.id]);
  await assert.rejects(resolveClearedSlaTask(next),/no longer eligible/,"new generation remains protected while breached");
  const aged = (await h.pool.query(`INSERT INTO tickets(contact_id,subject,description,status,authority_state,resolved_at,updated_at)
    VALUES($1,'Aged ticket','Fixture','Resolved','completed',NOW()-INTERVAL '8 days',NOW()-INTERVAL '8 days') RETURNING id`,[contact.id])).rows[0];
  const originalTicket = (await storage.getTicket(aged.id))!;
  const closed = await autoCloseResolvedTicket(originalTicket);
  assert.equal(closed.changed,1);
  assert.equal((await storage.getTicket(aged.id))!.status,"Closed");
  assert.equal((await autoCloseResolvedTicket(originalTicket)).replayed,true);
  await commandWorkItems({kind:"ticket",producer:"fixture_human_reopen",items:[{id:aged.id,expectedFence:1}],
    commandId:randomUUID(),updates:{status:"New Ticket"}});
  assert.equal((await storage.getTicket(aged.id))!.resolvedAt,null);
  assert.equal((await autoCloseResolvedTicket(originalTicket)).replayed,true);
  assert.equal((await storage.getTicket(aged.id))!.status,"New Ticket","accepted auto-close retry cannot close a later human reopen");
  await (await import("./fixtures/stage3-b-routing")).verifyRouting(h);
  assert.equal(h.externalCalls(),0);
  console.log("PASS C01 trusted producers: immutable GHL ID/same-title separation, indexed snapshot replay/human-reopen preservation, atomic terminal decision+task+audit and stale opposite decision, real SLA creator/discovery identity, current breached/cleared eligibility, stale candidate fence, preserved fields, no-op retry and new generation. Zero GHL writes, workers, emails, AI or external calls.");
} finally { await h.close(); }
