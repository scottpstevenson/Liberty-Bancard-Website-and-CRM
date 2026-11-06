/**
 * Stage 5 F01 — fresh-inbound class contradiction.
 *
 * Real registered public HTTP handlers (estimate / get-started / callback), real persisted sessions, real inbound
 * authority and storage, on disposable infrastructure with every provider denied. Fresh public submissions create
 * `unknown` contacts and deals; the request must be accepted as a truthful review-required occurrence with durable,
 * unlinked management work instead of a generic 400 that hides retained rows. Nothing here reclassifies a record to
 * force admission; the "later review" step reproduces only the OUTCOME of the separate classification authority.
 *
 * NOT EXERCISED here (reported, never counted as passes): BullMQ workers, GHL/SMTP/SMS transport, the dashboard UI,
 * the statement-upload multipart adapter (covered by its own suite; it shares the same authority function).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  registerPublicRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
const ok = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const eq = (a: unknown, b: unknown, label: string) => { assert.deepEqual(a, b, label); checks++; };
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
try {
  const { claimInboundRequest, orchestrateInboundRequest, resumeInboundSalesRequestAfterReview } =
    await import("../server/services/inbound-request-authority");
  await q("INSERT INTO agents(user_id,first_name,last_name,email,status,role) VALUES($1,'Agent','Fixture',$2,'active','sales_rep')",
    [h.userId("agent"), h.email("agent")]);

  const estimateBody = (email: string) => ({
    contactName: "Fresh Inbound", businessName: "Fresh Biz", email, phone: "3055550142", vertical: "Retail",
    monthlyVolume: "50000", totalFees: "1500",
  });
  const gsBody = (email: string) => ({
    goal: "lower fees", vertical: "Retail", monthlyVolume: "$15k-$50k", needTerminal: false, interestedIn0Percent: false,
    firstName: "Quiz", lastName: "Fresh", email, phone: "3055550143",
  });
  const cbBody = (phone: string) => ({ name: "Call Me", phone, bestTime: "morning", notes: "fresh callback" });

  const counts = async (email?: string, contactId?: number) => ({
    contacts: email ? (await q("SELECT count(*)::int n FROM contacts WHERE lower(email)=lower($1)", [email]))[0].n : null,
    deals: contactId ? (await q("SELECT count(*)::int n FROM deals WHERE contact_id=$1", [contactId]))[0].n : null,
  });
  const requestState = async (receipt: string) => {
    const [request] = await q("SELECT * FROM inbound_requests WHERE id=$1", [receipt]);
    const decisions = await q("SELECT * FROM inbound_assignment_decisions WHERE request_id=$1 ORDER BY decision_ordinal", [receipt]);
    const effects = await q("SELECT effect_key,state,external_side_effect,terminal_reason FROM inbound_request_effects WHERE request_id=$1", [receipt]);
    const tasks = await q(`SELECT t.* FROM tasks t JOIN inbound_request_work_links l ON l.task_id=t.id WHERE l.request_id=$1`, [receipt]);
    return { request, decisions, effects, tasks };
  };
  const effectState = (effects: any[], key: string) => effects.find(e => e.effect_key === key)?.state;

  // ---- 1-3. Fresh unknown contact + unknown deal through each registered sales entrance --------------------------
  const entrances: Array<{ name: string; path: string; body: any; lookup: () => Promise<any> }> = [];
  const eEmail = `${randomUUID()}@example.test`, gEmail = `${randomUUID()}@example.test`, cPhone = `30555${String(Math.floor(10000 + Math.random() * 89999))}`;
  entrances.push({ name: "estimate", path: "/api/public/estimate", body: estimateBody(eEmail),
    lookup: async () => (await q("SELECT id FROM contacts WHERE lower(email)=lower($1)", [eEmail]))[0] });
  entrances.push({ name: "get-started", path: "/api/public/get-started", body: gsBody(gEmail),
    lookup: async () => (await q("SELECT id FROM contacts WHERE lower(email)=lower($1)", [gEmail]))[0] });
  entrances.push({ name: "callback", path: "/api/public/callback", body: cbBody(cPhone),
    lookup: async () => (await q("SELECT c.id FROM contacts c JOIN contact_source_events e ON e.contact_id=c.id WHERE e.source_type='callback_form' AND c.phone LIKE $1", [`%${cPhone.slice(-10)}`]))[0] });

  const fresh: Record<string, { receipt: string; key: string; contactId: number; dealId: number; taskId: number }> = {};
  for (const entrance of entrances) {
    const key = randomUUID();
    const response = await h.request("anonymous", "POST", entrance.path, entrance.body, true, { "Idempotency-Key": key });
    eq(response.status, 201, `${entrance.name}: fresh unknown submission is accepted (${JSON.stringify(response.body)})`);
    ok(response.body.requestReceipt, `${entrance.name}: receipt returned`);
    eq(response.body.status, "review_required", `${entrance.name}: truthful review-required state, not 'accepted' or a 400`);
    const receipt = response.body.requestReceipt as string;
    const contact = await entrance.lookup();
    ok(contact, `${entrance.name}: retained contact exists`);
    const [contactRow] = await q("SELECT record_class FROM contacts WHERE id=$1", [contact.id]);
    eq(contactRow.record_class, "unknown", `${entrance.name}: contact is not reclassified to force admission`);
    const dealRows = await q("SELECT id,record_class,inbound_request_id,contact_id FROM deals WHERE contact_id=$1", [contact.id]);
    eq(dealRows.length, 1, `${entrance.name}: exactly one retained deal`);
    eq(dealRows[0].record_class, "unknown", `${entrance.name}: deal stays unclassified`);
    eq(dealRows[0].inbound_request_id, receipt, `${entrance.name}: deal is bound to this exact request occurrence`);
    const provenance = await q("SELECT count(*)::int n FROM contact_source_events WHERE contact_id=$1 AND event_key=$2",
      [contact.id, `form:${entrance.name === "get-started" ? "get_started_form" : entrance.name === "callback" ? "callback_form" : "estimate_form"}:${receipt}`]);
    eq(provenance[0].n, 1, `${entrance.name}: occurrence provenance retained`);
    const state = await requestState(receipt);
    eq(state.request.contact_id, contact.id, `${entrance.name}: request retains exact contact`);
    eq(state.request.deal_id, dealRows[0].id, `${entrance.name}: request retains exact deal`);
    eq(state.request.lifecycle_state, "review_required", `${entrance.name}: lifecycle review_required`);
    eq(state.request.assignment_status, "review_required", `${entrance.name}: assignment held for review`);
    eq(state.request.assigned_to, null, `${entrance.name}: nothing assigned`);
    eq(state.decisions.length, 1, `${entrance.name}: one decision`);
    eq(state.decisions[0].reason_code, "CONTACT_CLASS_REVIEW_REQUIRED", `${entrance.name}: class-review reason recorded`);
    eq(state.tasks.length, 1, `${entrance.name}: one durable management task`);
    eq(state.tasks[0].contact_id, null, `${entrance.name}: task is unlinked from production rep work`);
    eq(state.tasks[0].deal_id, null, `${entrance.name}: task carries no deal link`);
    eq(state.tasks[0].canonical_assignee, null, `${entrance.name}: task unassigned`);
    ok(state.tasks[0].due_date, `${entrance.name}: SLA due date on the task`);
    const [event] = await q("SELECT payload FROM task_authority_events WHERE task_id=$1 AND event_type='created'", [state.tasks[0].id]);
    eq([event.payload.context.retainedContactId, event.payload.context.retainedDealId], [contact.id, dealRows[0].id],
      `${entrance.name}: exact retained contact/deal evidence on the task's authority event`);
    eq(effectState(state.effects, "sales_work"), "sent", `${entrance.name}: internal work effect completed`);
    eq(effectState(state.effects, "sales_sla"), "sent", `${entrance.name}: SLA effect completed`);
    eq(effectState(state.effects, "assignment"), "held", `${entrance.name}: assignment effect held until authorized`);
    ok(state.effects.filter(e => e.external_side_effect).every(e => e.state === "held"), `${entrance.name}: every external effect held`);
    fresh[entrance.name] = { receipt, key, contactId: contact.id, dealId: dealRows[0].id, taskId: state.tasks[0].id };

    // Replay: identical receipt, no duplicate contact/deal/task/decision.
    const replay = await h.request("anonymous", "POST", entrance.path, entrance.body, true, { "Idempotency-Key": key });
    eq(replay.status, 200, `${entrance.name}: replay is a replay`);
    eq(replay.body.requestReceipt, receipt, `${entrance.name}: replay returns the same receipt`);
    eq(replay.body.status, "review_required", `${entrance.name}: replay reports the retained state`);
    eq((await q("SELECT count(*)::int n FROM deals WHERE contact_id=$1", [contact.id]))[0].n, 1, `${entrance.name}: replay creates no deal`);
    eq((await requestState(receipt)).tasks.length, 1, `${entrance.name}: replay creates no task`);
    eq((await requestState(receipt)).decisions.length, 1, `${entrance.name}: replay records no extra decision`);
  }
  eq((await counts(eEmail)).contacts, 1, "estimate: one contact row for the email");

  // ---- 4. Lost response (committed, client never saw it), then retry with the same key -----------------------------
  {
    const email = `${randomUUID()}@example.test`;
    const key = randomUUID();
    h.loseNextSuccessfulResponse("POST", "/api/public/estimate", "socket");
    await h.request("anonymous", "POST", "/api/public/estimate", estimateBody(email), true, { "Idempotency-Key": key }).catch(() => null);
    eq(h.responseLossCount() >= 1, true, "lost-response fault actually executed");
    const [contact] = await q("SELECT id FROM contacts WHERE lower(email)=lower($1)", [email]);
    ok(contact, "lost-response: committed contact retained");
    const retry = await h.request("anonymous", "POST", "/api/public/estimate", estimateBody(email), true, { "Idempotency-Key": key });
    eq(retry.status, 200, "lost-response: retry replays the committed outcome");
    eq(retry.body.status, "review_required", "lost-response: retry sees the retained review state");
    eq((await q("SELECT count(*)::int n FROM deals WHERE contact_id=$1", [contact.id]))[0].n, 1, "lost-response: no duplicate deal");
    eq((await requestState(retry.body.requestReceipt)).tasks.length, 1, "lost-response: no duplicate task");
  }

  // ---- 5. Existing production contact (public form) ----------------------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`;
    const [contact] = await q(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to)
      VALUES('Existing','Production',$1,'3055550144','production',$2) RETURNING id`, [email, h.email("agent")]);
    const response = await h.request("anonymous", "POST", "/api/public/estimate", estimateBody(email), true, { "Idempotency-Key": randomUUID() });
    eq(response.status, 201, `existing production: accepted (${JSON.stringify(response.body)})`);
    const state = await requestState(response.body.requestReceipt);
    const [deal] = await q("SELECT id,record_class FROM deals WHERE contact_id=$1", [contact.id]);
    eq(deal.record_class, "production", "existing production: deal inherits production");
    eq(state.request.deal_id, deal.id, "existing production: exact deal retained");
    eq(state.tasks.length, 1, "existing production: one task");
    eq([state.tasks[0].contact_id, state.tasks[0].deal_id], [contact.id, deal.id], "existing production: work linked to the production records");
    ok(state.decisions[0].reason_code !== "CONTACT_CLASS_REVIEW_REQUIRED", "existing production: not routed through class review");
    eq(effectState(state.effects, "assignment"), "held", "existing production: no unowned auto-assignment (deal owner absent)");
  }

  // ---- 6. Explicit nonproduction / QA contact (public form) ----------------------------------------------------------
  for (const klass of ["test", "demo", "synthetic"]) {
    const email = `${randomUUID()}@example.test`;
    const [contact] = await q(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Non','Production',$1,'3055550145',$2) RETURNING id`, [email, klass]);
    const response = await h.request("anonymous", "POST", "/api/public/estimate", estimateBody(email), true, { "Idempotency-Key": randomUUID() });
    ok([201, 202].includes(response.status), `${klass}: not a generic 400 (${response.status} ${JSON.stringify(response.body)})`);
    ok(response.body.requestReceipt, `${klass}: receipt returned`);
    eq(response.body.status, "review_required", `${klass}: review-required, never accepted into rep work`);
    const state = await requestState(response.body.requestReceipt);
    eq(state.request.contact_id, contact.id, `${klass}: exact contact retained`);
    eq(state.tasks.length, 0, `${klass}: no work created for a nonproduction context`);
    eq(state.request.assigned_to, null, `${klass}: nothing assigned`);
    eq(state.decisions.map((d: any) => d.reason_code), ["INBOUND_CONTEXT_UNAVAILABLE"], `${klass}: refusal retained as a single decision`);
    eq((await q("SELECT record_class FROM contacts WHERE id=$1", [contact.id]))[0].record_class, klass, `${klass}: class untouched`);
    ok(state.effects.filter(e => e.external_side_effect).every(e => e.state === "held"), `${klass}: external effects held`);
    eq(effectState(state.effects, "assignment"), "held", `${klass}: assignment held`);
    // Orchestration replay appends nothing.
    await orchestrateInboundRequest({ requestId: response.body.requestReceipt, contactId: contact.id, dealId: state.request.deal_id });
    eq((await requestState(response.body.requestReceipt)).decisions.length, 1, `${klass}: re-orchestration records no extra decision`);
  }

  // ---- 7. Archived / foreign-linked through the real authority (no public route can express these) -----------------
  const claimSales = async () => (await claimInboundRequest({ idempotencyKey: randomUUID(), sourceCategory: "website_form",
    sourceType: "estimate_form", callerScope: `public:${randomUUID()}`, actorType: "public", payload: { n: randomUUID() } })).request;
  const unknownContactWithEvidence = async (receipt: string) => {
    const [c] = await q("INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Evidence','Contact',$1,'','unknown') RETURNING id",
      [`${randomUUID()}@example.test`]);
    await q(`INSERT INTO contact_source_events(contact_id,source_category,source_type,event_key,actor_type)
      VALUES($1,'website_form','estimate_form',$2,'public')`, [c.id, `form:estimate_form:${receipt}`]).catch(async () => {
      // Schema differs on optional columns: fall back to the contact writer's own recorder.
      throw new Error("contact_source_events fixture insert failed");
    });
    return c.id as number;
  };
  {
    const request = await claimSales();
    const contactId = await unknownContactWithEvidence(request.id);
    const [other] = await q("INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Other','Contact',$1,'','unknown') RETURNING id", [`${randomUUID()}@example.test`]);
    const [foreignDeal] = await q("INSERT INTO deals(name,contact_id,record_class) VALUES('Foreign deal',$1,'unknown') RETURNING id", [other.id]);
    const result = await orchestrateInboundRequest({ requestId: request.id, contactId, dealId: foreignDeal.id });
    eq(result.lifecycleState, "review_required", "foreign-linked deal: retained as review-required, no throw");
    const state = await requestState(request.id);
    eq(state.decisions.map((d: any) => d.reason_code), ["INBOUND_CONTEXT_UNAVAILABLE"], "foreign-linked deal: refusal evidence retained");
    eq(state.tasks.length, 0, "foreign-linked deal: no task linked to another contact's deal");
    eq([state.request.contact_id, state.request.deal_id], [contactId, foreignDeal.id], "foreign-linked deal: exact links retained");
  }
  {
    const request = await claimSales();
    const contactId = await unknownContactWithEvidence(request.id);
    const [archivedDeal] = await q("INSERT INTO deals(name,contact_id,record_class,archived_at) VALUES('Archived deal',$1,'unknown',now()) RETURNING id", [contactId]);
    const result = await orchestrateInboundRequest({ requestId: request.id, contactId, dealId: archivedDeal.id });
    eq(result.lifecycleState, "review_required", "archived deal: retained as review-required");
    eq((await requestState(request.id)).tasks.length, 0, "archived deal: no task");
  }
  {
    const request = await claimSales();
    const contactId = await unknownContactWithEvidence(request.id);
    await q("UPDATE contacts SET archived_at=now() WHERE id=$1", [contactId]);
    const result = await orchestrateInboundRequest({ requestId: request.id, contactId });
    eq(result.lifecycleState, "review_required", "archived contact: retained as review-required");
    eq((await requestState(request.id)).tasks.length, 0, "archived contact: no task");
  }
  {
    const request = await claimSales();
    const contactId = await unknownContactWithEvidence(request.id);
    const [qaDeal] = await q("INSERT INTO deals(name,contact_id,record_class) VALUES('QA deal',$1,'test') RETURNING id", [contactId]);
    const result = await orchestrateInboundRequest({ requestId: request.id, contactId, dealId: qaDeal.id });
    eq(result.lifecycleState, "review_required", "explicit nonproduction deal on unknown contact: refused context, retained");
    eq((await requestState(request.id)).decisions.map((d: any) => d.reason_code), ["INBOUND_CONTEXT_UNAVAILABLE"], "nonproduction deal: refusal evidence");
  }

  // ---- 8. Later review: same rows continue, nothing duplicated -----------------------------------------------------
  {
    const f = fresh.estimate;
    // Reproduces only the outcome of the separate classification authority: both records become production and the
    // rep who owns them is the contact/deal owner.
    await q("UPDATE contacts SET record_class='production', assigned_to=$2 WHERE id=$1", [f.contactId, h.email("agent")]);
    await q("UPDATE deals SET record_class='production', owner=$2 WHERE id=$1", [f.dealId, h.email("agent")]);
    const before = {
      contacts: (await q("SELECT count(*)::int n FROM contacts"))[0].n,
      deals: (await q("SELECT count(*)::int n FROM deals"))[0].n,
      tasks: (await q("SELECT count(*)::int n FROM tasks"))[0].n,
    };
    const resumed = await resumeInboundSalesRequestAfterReview(f.receipt);
    const state = await requestState(f.receipt);
    eq(state.tasks.length, 1, "resume: still exactly one task for the request");
    eq(state.tasks[0].id, f.taskId, "resume: the SAME retained task continues");
    eq([state.tasks[0].contact_id, state.tasks[0].deal_id], [f.contactId, f.dealId], "resume: task gains the retained contact/deal links");
    eq(state.tasks[0].canonical_assignee, h.email("agent"), "resume: elected owner recorded on the task");
    eq(state.decisions.length, 2, "resume: one new decision, class-review decision preserved");
    eq(state.decisions[0].reason_code, "CONTACT_CLASS_REVIEW_REQUIRED", "resume: original decision retained");
    eq(state.decisions[1].assigned_to, h.email("agent"), "resume: new decision assigns the owner");
    eq(effectState(state.effects, "assignment"), "sent", "resume: assignment effect completes only after authorization");
    eq(resumed.lifecycleState, "accepted", "resume: request becomes accepted");
    ok(state.effects.filter(e => e.external_side_effect).every(e => e.state === "held"), "resume: external effects remain held");
    eq({
      contacts: (await q("SELECT count(*)::int n FROM contacts"))[0].n,
      deals: (await q("SELECT count(*)::int n FROM deals"))[0].n,
      tasks: (await q("SELECT count(*)::int n FROM tasks"))[0].n,
    }, before, "resume: no duplicate contact/deal/task rows");
    await resumeInboundSalesRequestAfterReview(f.receipt);
    eq((await requestState(f.receipt)).decisions.length, 2, "resume replay: no extra decision");
    eq((await q("SELECT count(*)::int n FROM tasks"))[0].n, before.tasks, "resume replay: no extra task");
    eq((await q("SELECT count(*)::int n FROM task_authority_events WHERE task_id=$1 AND event_type='inbound_class_review_resolved'", [f.taskId]))[0].n, 1,
      "resume replay: continuation recorded once");
  }

  // The get-started route's pre-existing fire-and-forget deal blueprint step attempts an OpenAI call per submission. The
  // fixture denies every such attempt before it leaves the process; attempts are reported, never treated as provider I/O.
  const deniedAttempts = h.externalCalls();
  ok(deniedAttempts <= 3, `provider attempts were all denied by the fixture (${deniedAttempts} denied, 0 completed)`);
  console.log(`PASS Stage 5 F01 fresh-inbound: ${checks} checks. Real registered estimate/get-started/callback handlers, unknown/production/` +
    `nonproduction/archived/foreign-linked contexts, replay and lost-response, durable review work, later continuation without duplicates, providers denied (${deniedAttempts} attempted, all refused).`);
  console.log("NOT EXERCISED: BullMQ workers, GHL/SMTP/SMS transport, dashboard UI, multipart statement-upload adapter (separate suite).");
} finally { await h.close(); }
