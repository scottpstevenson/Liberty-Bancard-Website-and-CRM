/**
 * Automatic default owner for new inbound requests.
 *
 * Real registered public handlers (estimate, support) and the real admin settings routes over real sessions, on
 * disposable infrastructure with every provider denied. Proves: the owner can only be an active admin/manager; with no
 * owner recorded nothing changes; a production contact nobody owns is handed to the owner together with the request's
 * assignment decision; a contact owned by someone else is never taken over; a still-unclassified contact's review task
 * goes to the owner without classifying or handing off anything, and a later continuation assigns it without duplicates;
 * support tickets go to the owner; an owner who stops qualifying is never used.
 *
 * NOT EXERCISED (reported, never counted as passes): BullMQ workers, GHL/SMTP/SMS transport, the dashboard UI.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  registerPublicRoutes(app);
  const { registerTemplatesSettingsRoutes } = await import("../server/routes/templates-settings");
  registerTemplatesSettingsRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
const ok = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const eq = (a: unknown, b: unknown, label: string) => { assert.deepEqual(a, b, label); checks++; };
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
try {
  const { orchestrateInboundRequest, resumeInboundSalesRequestAfterReview } = await import("../server/services/inbound-request-authority");
  await q("INSERT INTO agents(user_id,first_name,last_name,email,status,role) VALUES($1,'Agent','Fixture',$2,'active','sales_rep')",
    [h.userId("agent"), h.email("agent")]);
  const ownerEmail = h.email("manager");

  const estimateBody = (email: string) => ({
    contactName: "Default Owner", businessName: "Default Owner Biz", email, phone: "3055550152", vertical: "Retail",
    monthlyVolume: "50000", totalFees: "1500",
  });
  const supportBody = (email: string) => ({
    name: "Support Person", businessName: "Support Biz", email, issueType: "Terminal", priority: "Normal", message: "My terminal is offline.",
  });
  const production = async (email: string, assignedTo: string | null = null) => (await q(
    `INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to) VALUES('Existing','Production',$1,'3055550153','production',$2) RETURNING id`,
    [email, assignedTo]))[0].id as number;
  const requestState = async (receipt: string) => {
    const [request] = await q("SELECT * FROM inbound_requests WHERE id=$1", [receipt]);
    const decisions = await q("SELECT * FROM inbound_assignment_decisions WHERE request_id=$1 ORDER BY decision_ordinal", [receipt]);
    const effects = await q("SELECT effect_key,state,external_side_effect,terminal_reason FROM inbound_request_effects WHERE request_id=$1", [receipt]);
    const tasks = await q(`SELECT t.* FROM tasks t JOIN inbound_request_work_links l ON l.task_id=t.id WHERE l.request_id=$1`, [receipt]);
    return { request, decisions, effects, tasks };
  };
  const effectState = (effects: any[], key: string) => effects.find(e => e.effect_key === key)?.state;
  const submitEstimate = async (email: string) => {
    const response = await h.request("anonymous", "POST", "/api/public/estimate", estimateBody(email), true, { "Idempotency-Key": randomUUID() });
    ok([201, 202].includes(response.status), `estimate accepted (${response.status} ${JSON.stringify(response.body)})`);
    return response;
  };
  const submitSupport = async (email: string) => {
    const response = await h.request("anonymous", "POST", "/api/public/support", supportBody(email), true, { "Idempotency-Key": randomUUID() });
    ok([201, 202].includes(response.status), `support accepted (${response.status} ${JSON.stringify(response.body)})`);
    return response;
  };
  const ticketFor = async (receipt: string) => (await q(`SELECT t.* FROM tickets t JOIN inbound_requests r ON r.ticket_id=t.id WHERE r.id=$1`, [receipt]))[0];

  // ---- 1. The owner setting: admin only, active admin/manager only -------------------------------------------------
  {
    const initial = await h.request("admin", "GET", "/api/admin/inbound-default-owner");
    eq([initial.status, initial.body.ownerState, initial.body.ownerUserId], [200, "not_configured", null], "initially no default owner is recorded");
    eq((await h.request("agent", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: h.userId("manager") })).status, 403, "a sales rep cannot record the owner");
    eq((await h.request("manager", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: h.userId("manager") })).status, 403, "a manager cannot record the owner");
    eq((await h.request("admin", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: h.userId("agent") })).status, 400, "a sales rep cannot be the default owner");
    eq((await h.request("admin", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: "no-such-user" })).status, 400, "an unknown account is refused");
    eq((await h.request("admin", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: 5 })).status, 400, "a non-text owner is refused");
    eq((await q("SELECT count(*)::int n FROM system_settings WHERE key='inbound_default_owner'"))[0].n, 0, "refused requests record nothing");
  }

  // ---- 2. Nothing recorded: behavior is unchanged (held for review, nothing assigned, no ownership moved) -----------
  const noOwnerEmail = `${randomUUID()}@example.test`;
  const noOwnerContact = await production(noOwnerEmail);
  {
    const response = await submitEstimate(noOwnerEmail);
    const state = await requestState(response.body.requestReceipt);
    eq(state.decisions.map((d: any) => [d.status, d.reason_code, d.assigned_to]), [["review_required", "UNASSIGNED_POLICY_MISSING", null]],
      "no owner recorded: held for review with no assignee");
    eq((await q("SELECT assigned_to FROM contacts WHERE id=$1", [noOwnerContact]))[0].assigned_to, null, "no owner recorded: contact ownership untouched");
    eq(state.tasks[0].canonical_assignee, null, "no owner recorded: task unassigned");
    const support = await submitSupport(`${randomUUID()}@example.test`);
    eq((await ticketFor(support.body.requestReceipt))?.assigned_to ?? null, null, "no owner recorded: support ticket unassigned");
  }

  // ---- 3. Record the owner ------------------------------------------------------------------------------------------
  {
    const saved = await h.request("admin", "PUT", "/api/admin/inbound-default-owner", { ownerUserId: h.userId("manager") });
    eq([saved.status, saved.body.ownerState, saved.body.ownerEmail], [200, "ok", ownerEmail], "an active manager is recorded as the default owner");
    eq((await q("SELECT count(*)::int n FROM audit_logs WHERE action='inbound_default_owner_set'"))[0].n, 1, "recording the owner is audited");
  }

  // ---- 4. Production contact nobody owns: assigned, ownership handed over in the same decision -----------------------
  let assignedReceipt = "";
  {
    const email = `${randomUUID()}@example.test`;
    const contactId = await production(email);
    const response = await submitEstimate(email);
    const receipt = assignedReceipt = response.body.requestReceipt as string;
    const state = await requestState(receipt);
    const [deal] = await q("SELECT id,owner,record_class FROM deals WHERE contact_id=$1", [contactId]);
    eq(state.decisions.map((d: any) => [d.status, d.reason_code, d.assigned_to]), [["assigned", "DEFAULT_OWNER_ASSIGNED", ownerEmail]],
      "unowned production contact: one assigned decision naming the owner");
    eq([state.request.assignment_status, state.request.assigned_to], ["assigned", ownerEmail], "request record shows the owner and assigned");
    eq((await q("SELECT assigned_to FROM contacts WHERE id=$1", [contactId]))[0].assigned_to, ownerEmail, "contact ownership moved to the owner");
    eq(deal.owner, ownerEmail, "deal ownership moved to the owner");
    eq(state.tasks.length, 1, "exactly one task");
    eq([state.tasks[0].contact_id, state.tasks[0].deal_id, state.tasks[0].canonical_assignee], [contactId, deal.id, ownerEmail],
      "task is linked to the production records and assigned to the owner");
    eq(effectState(state.effects, "assignment"), "sent", "assignment effect completed from the durable decision");
    ok(state.effects.filter(e => e.external_side_effect).every(e => e.state === "held"), "every external effect stays held");
    eq((await q(`SELECT count(*)::int n FROM audit_logs WHERE action='contact_assigned' AND entity_id=$1 AND details->>'reason'='INBOUND_DEFAULT_OWNER'`, [contactId]))[0].n, 1,
      "the contact handoff is audited");
    eq(response.body.status, "accepted", "request becomes accepted");

    // Replays and re-evaluation neither add decisions nor flip the accepted assignment.
    await orchestrateInboundRequest({ requestId: receipt, contactId, dealId: deal.id });
    await orchestrateInboundRequest({ requestId: receipt, contactId, dealId: deal.id });
    const again = await requestState(receipt);
    eq(again.decisions.length, 1, "re-orchestration records no extra decision");
    eq([again.request.assignment_status, again.request.assigned_to, again.tasks.length], ["assigned", ownerEmail, 1], "re-orchestration keeps the assignment and one task");
  }

  // ---- 5. A contact that belongs to someone else is never taken over ------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`;
    const contactId = await production(email, h.email("agent"));
    const response = await submitEstimate(email);
    const state = await requestState(response.body.requestReceipt);
    eq((await q("SELECT assigned_to FROM contacts WHERE id=$1", [contactId]))[0].assigned_to, h.email("agent"), "the rep keeps the contact");
    ok(state.decisions.every((d: any) => d.assigned_to !== ownerEmail && d.reason_code !== "DEFAULT_OWNER_ASSIGNED"), "the default owner is not elected over an existing owner");
    eq(state.request.assigned_to === ownerEmail, false, "request is not assigned to the default owner");
  }

  // ---- 6. Still-unclassified contact: review task goes to the owner; nothing classified or handed off -----------------
  {
    const email = `${randomUUID()}@example.test`;
    const response = await submitEstimate(email);
    eq(response.body.status, "review_required", "unclassified contact: truthful review-required state");
    const receipt = response.body.requestReceipt as string;
    const [contact] = await q("SELECT id,record_class,assigned_to FROM contacts WHERE lower(email)=lower($1)", [email]);
    const [deal] = await q("SELECT id,record_class,owner FROM deals WHERE contact_id=$1", [contact.id]);
    eq([contact.record_class, contact.assigned_to, deal.record_class, deal.owner], ["unknown", null, "unknown", null],
      "unclassified contact and deal are neither classified nor handed off");
    const state = await requestState(receipt);
    eq(state.decisions.map((d: any) => [d.status, d.reason_code, d.assigned_to]), [["review_required", "CONTACT_CLASS_REVIEW_REQUIRED", null]],
      "decision stays class-review with no rep assignee");
    eq(state.tasks.length, 1, "one review task");
    eq([state.tasks[0].contact_id, state.tasks[0].deal_id, state.tasks[0].canonical_assignee, state.tasks[0].assigned_to], [null, null, ownerEmail, ownerEmail],
      "unlinked review task is owned by the default owner");
    eq(effectState(state.effects, "assignment"), "held", "assignment effect stays held until the contact is classified");

    // The separate classification authority makes the records production (reproduced here by its outcome only).
    await q("UPDATE contacts SET record_class='production' WHERE id=$1", [contact.id]);
    await q("UPDATE deals SET record_class='production' WHERE id=$1", [deal.id]);
    const before = {
      contacts: (await q("SELECT count(*)::int n FROM contacts"))[0].n,
      deals: (await q("SELECT count(*)::int n FROM deals"))[0].n,
      tasks: (await q("SELECT count(*)::int n FROM tasks"))[0].n,
    };
    const resumed = await resumeInboundSalesRequestAfterReview(receipt);
    const after = await requestState(receipt);
    eq(resumed.lifecycleState, "accepted", "continuation: request accepted");
    eq(after.decisions.map((d: any) => [d.status, d.reason_code, d.assigned_to]),
      [["review_required", "CONTACT_CLASS_REVIEW_REQUIRED", null], ["assigned", "DEFAULT_OWNER_ASSIGNED", ownerEmail]],
      "continuation: class-review decision retained, new assigned decision appended");
    eq([after.tasks[0].id, after.tasks[0].contact_id, after.tasks[0].deal_id, after.tasks[0].canonical_assignee],
      [state.tasks[0].id, contact.id, deal.id, ownerEmail], "continuation: the same task gains its links and keeps the owner");
    eq([(await q("SELECT assigned_to FROM contacts WHERE id=$1", [contact.id]))[0].assigned_to, (await q("SELECT owner FROM deals WHERE id=$1", [deal.id]))[0].owner],
      [ownerEmail, ownerEmail], "continuation: ownership handed to the owner only after classification");
    eq(effectState(after.effects, "assignment"), "sent", "continuation: assignment effect completes");
    eq({
      contacts: (await q("SELECT count(*)::int n FROM contacts"))[0].n,
      deals: (await q("SELECT count(*)::int n FROM deals"))[0].n,
      tasks: (await q("SELECT count(*)::int n FROM tasks"))[0].n,
    }, before, "continuation: no duplicate contact, deal or task");
    await resumeInboundSalesRequestAfterReview(receipt);
    eq((await requestState(receipt)).decisions.length, 2, "continuation replay: no extra decision");
  }

  // ---- 7. Support ticket -------------------------------------------------------------------------------------------
  {
    const support = await submitSupport(`${randomUUID()}@example.test`);
    const ticket = await ticketFor(support.body.requestReceipt);
    ok(ticket, "support ticket created");
    eq([ticket.assigned_to, ticket.canonical_assignee], [ownerEmail, ownerEmail], "support ticket is assigned to the owner");
  }

  // ---- 8. An owner who no longer qualifies is never used ----------------------------------------------------------
  {
    await q("UPDATE users SET account_state='deactivated' WHERE id=$1", [h.userId("manager")]);
    const status = await h.request("admin", "GET", "/api/admin/inbound-default-owner");
    eq(status.body.ownerState, "deactivated", "status reports the owner can no longer be used");
    const email = `${randomUUID()}@example.test`;
    const contactId = await production(email);
    const response = await submitEstimate(email);
    const state = await requestState(response.body.requestReceipt);
    eq(state.decisions.map((d: any) => [d.status, d.assigned_to]), [["review_required", null]], "deactivated owner: held for review, not assigned");
    eq((await q("SELECT assigned_to FROM contacts WHERE id=$1", [contactId]))[0].assigned_to, null, "deactivated owner: no ownership moved");
    const support = await submitSupport(`${randomUUID()}@example.test`);
    eq((await ticketFor(support.body.requestReceipt))?.assigned_to ?? null, null, "deactivated owner: support ticket unassigned");
    // An earlier accepted assignment no longer reads as currently valid once its owner stops qualifying.
    const [accepted] = await q("SELECT contact_id,deal_id FROM inbound_requests WHERE id=$1", [assignedReceipt]);
    await orchestrateInboundRequest({ requestId: assignedReceipt, contactId: accepted.contact_id, dealId: accepted.deal_id });
    eq((await requestState(assignedReceipt)).request.assignment_status, "review_required", "earlier assignment is reported as needing review, not silently kept");
  }

  console.log(`PASS inbound default owner: ${checks} checks. Real public estimate/support handlers and admin routes; no-owner baseline, unowned production handoff, ` +
    `existing-owner protection, class-review task owner and continuation, support tickets, deactivated owner; providers denied.`);
  console.log("NOT EXERCISED: BullMQ workers, GHL/SMTP/SMS transport, dashboard UI.");
} finally { await h.close(); }
