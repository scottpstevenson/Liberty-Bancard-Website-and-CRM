/**
 * Stage 5 F01-A / F01-B — durable occurrence recovery and scoped review continuation.
 *
 * Real registered public HTTP handlers (estimate / get-started / callback) and the real lead-ops route, real sessions,
 * real inbound authority, on a disposable database with every provider denied. Failures are injected with REAL
 * database/storage faults after each committed step (contact, consent, deal, link bind, notification), then the SAME
 * Idempotency-Key is replayed. Nothing is mocked at the HTTP boundary and nothing is reclassified to force admission.
 *
 * NOT EXERCISED here (reported, never counted as passes): BullMQ workers, GHL/SMTP/SMS transport, the browser UI
 * (separate private-browser suite), multipart statement-upload adapter.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

process.env.INBOUND_RECOVERY_LEASE_MS = "60000";
const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  registerPublicRoutes(app);
  const { registerLeadOpsRoutes } = await import("../server/routes/lead-ops");
  registerLeadOpsRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
const ok = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const eq = (a: unknown, b: unknown, label: string) => { assert.deepEqual(a, b, label); checks++; };
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
try {
  const { storage } = await import("../server/storage");
  const { claimInboundRequest, orchestrateInboundRequest } = await import("../server/services/inbound-request-authority");
  await q("INSERT INTO agents(user_id,first_name,last_name,email,status,role) VALUES($1,'Agent','Fixture',$2,'active','sales_rep')",
    [h.userId("agent"), h.email("agent")]);

  // ---- fault machinery: real triggers, armed/disarmed around a real request -----------------------------------------
  await q("CREATE TABLE stage5_fault(kind text primary key, armed boolean not null default false)");
  await q("INSERT INTO stage5_fault(kind) VALUES('deal'),('consent'),('bind')");
  await q(`CREATE FUNCTION stage5_fault_trip() RETURNS trigger AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM stage5_fault WHERE kind = TG_ARGV[0] AND armed) THEN RAISE EXCEPTION 'STAGE5_FAULT_%', TG_ARGV[0]; END IF;
    RETURN NEW; END $$ LANGUAGE plpgsql`);
  await q("CREATE TRIGGER stage5_fault_deal BEFORE INSERT ON deals FOR EACH ROW EXECUTE FUNCTION stage5_fault_trip('deal')");
  await q(`CREATE TRIGGER stage5_fault_consent BEFORE INSERT ON consent_audit_logs FOR EACH ROW WHEN (NEW.event_namespace = 'pewc')
    EXECUTE FUNCTION stage5_fault_trip('consent')`);
  await q(`CREATE FUNCTION stage5_fault_bind() RETURNS trigger AS $$ BEGIN
    IF NEW.contact_id IS DISTINCT FROM OLD.contact_id AND EXISTS (SELECT 1 FROM stage5_fault WHERE kind='bind' AND armed)
      THEN RAISE EXCEPTION 'STAGE5_FAULT_bind'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await q("CREATE TRIGGER stage5_fault_bind BEFORE UPDATE ON inbound_requests FOR EACH ROW EXECUTE FUNCTION stage5_fault_bind()");
  const arm = (kind: string, armed: boolean) => q("UPDATE stage5_fault SET armed=$2 WHERE kind=$1", [kind, armed]);

  const post = (path: string, body: unknown, key: string) =>
    h.request("anonymous", "POST", path, body, true, { "Idempotency-Key": key });
  const estimateBody = (email: string, pewc = false) => ({
    contactName: "Recover Me", businessName: "Recover Biz", email, phone: "3055550177", vertical: "Retail",
    monthlyVolume: "50000", totalFees: "1500", ...(pewc ? { pewcConsent: true } : {}),
  });
  const gsBody = (email: string) => ({
    goal: "lower fees", vertical: "Retail", monthlyVolume: "$15k-$50k", needTerminal: false, interestedIn0Percent: false,
    firstName: "Quiz", lastName: "Recover", email, phone: "3055550178", pewcConsent: true,
  });
  const cbBody = (phone: string) => ({ name: "Call Recover", phone, bestTime: "morning", pewcConsent: true });

  const snapshot = async (receipt: string, email?: string) => {
    const [request] = await q("SELECT * FROM inbound_requests WHERE id=$1", [receipt]);
    const deals = await q("SELECT id,record_class,contact_id FROM deals WHERE inbound_request_id=$1", [receipt]);
    const tasks = await q("SELECT t.* FROM tasks t JOIN inbound_request_work_links l ON l.task_id=t.id WHERE l.request_id=$1", [receipt]);
    const notifications = await q("SELECT id FROM notifications WHERE inbound_request_id=$1", [receipt]);
    const decisions = await q("SELECT reason_code FROM inbound_assignment_decisions WHERE request_id=$1", [receipt]);
    const consent = await q(`SELECT count(*)::int n FROM consent_audit_logs WHERE record_kind='canonical_fact' AND event_namespace='pewc'
      AND event_key LIKE $1`, [`%:${receipt}:pewc`]);
    const sourceEvents = await q("SELECT contact_id FROM contact_source_events WHERE event_key LIKE $1", [`form:%:${receipt}`]);
    const contacts = email ? await q("SELECT id,record_class FROM contacts WHERE lower(email)=lower($1)", [email]) : [];
    const externalEffects = await q("SELECT state FROM inbound_request_effects WHERE request_id=$1 AND external_side_effect", [receipt]);
    return { request, deals, tasks, notifications, decisions, consent: consent[0].n, sourceEvents, contacts, externalEffects };
  };
  const assertComplete = (s: Awaited<ReturnType<typeof snapshot>>, label: string, withConsent: boolean) => {
    eq(s.deals.length, 1, `${label}: exactly one deal`);
    eq(s.tasks.length, 1, `${label}: exactly one task`);
    eq(s.notifications.length, 1, `${label}: exactly one notification`);
    eq(s.sourceEvents.length, 1, `${label}: exactly one occurrence source event`);
    if (withConsent) eq(s.consent, 1, `${label}: exactly one consent fact`);
    eq(s.request.lifecycle_state, "review_required", `${label}: truthful class-review state (never silently accepted)`);
    ok(s.request.terminal_reason !== "INBOUND_HANDOFF_RECOVERABLE" && s.request.terminal_reason !== "INBOUND_HANDOFF_RECOVERING",
      `${label}: recovery marker cleared (${s.request.terminal_reason})`);
    eq(s.request.contact_id, s.sourceEvents[0].contact_id, `${label}: request bound to the evidenced contact`);
    eq(s.request.deal_id, s.deals[0].id, `${label}: request bound to the occurrence deal`);
    eq(s.deals[0].record_class, "unknown", `${label}: deal not promoted`);
    ok(s.externalEffects.every(e => e.state === "held"), `${label}: external effects stay held`);
  };

  // ---- 1. Failure after deal creation (notification), estimate: replay finishes the SAME occurrence -----------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    const original = storage.createNotification.bind(storage);
    let tripped = 0;
    (storage as any).createNotification = async (...args: any[]) => { tripped++; (storage as any).createNotification = original; throw new Error("STAGE5_FAULT_notification"); };
    const first = await post("/api/public/estimate", estimateBody(email, true), key);
    (storage as any).createNotification = original;
    eq(tripped, 1, "after-deal: notification fault actually executed");
    eq([first.status, first.body.recoverable, first.body.status], [202, true, "review_required"], `after-deal: truthful recoverable 202 (${JSON.stringify(first.body)})`);
    const receipt = first.body.requestReceipt as string;
    let s = await snapshot(receipt, email);
    eq(s.deals.length, 1, "after-deal: committed deal retained"); eq(s.contacts.length, 1, "after-deal: committed contact retained");
    eq(s.request.terminal_reason, "INBOUND_HANDOFF_RECOVERABLE", "after-deal: recoverable hold recorded");
    eq(s.request.deal_id, s.deals[0].id, "after-deal: deal bound to the occurrence before the failure was reported");
    eq(s.tasks.length, 0, "after-deal: no task yet");
    const second = await post("/api/public/estimate", estimateBody(email, true), key);
    eq([second.status, second.body.requestReceipt], [201, receipt], `after-deal: same-key replay finishes the same request (${JSON.stringify(second.body)})`);
    s = await snapshot(receipt, email);
    assertComplete(s, "after-deal", true);
    eq(s.contacts.length, 1, "after-deal: still one contact");
    eq(s.contacts[0].record_class, "unknown", "after-deal: contact not promoted");
    const third = await post("/api/public/estimate", estimateBody(email, true), key);
    eq([third.status, third.body.requestReceipt], [200, receipt], "after-deal: later replay is a plain replay");
    assertComplete(await snapshot(receipt, email), "after-deal replay", true);
    // The immutable binding rejects another occurrence's identity.
    const status = await h.request("anonymous", "GET", `/api/public/inbound-requests/${receipt}/status`, undefined, true, { "Idempotency-Key": key });
    eq([status.status, status.body.recoverable], [200, false], "after-deal: status reports recovered, not recoverable");
  }

  // ---- 2. Failure after contact+consent, before the deal (estimate) -----------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/estimate", estimateBody(email, true), key);
    await arm("deal", false);
    eq([first.status, first.body.recoverable], [202, true], `after-consent: recoverable 202 (${JSON.stringify(first.body)})`);
    const receipt = first.body.requestReceipt as string;
    let s = await snapshot(receipt, email);
    eq([s.contacts.length, s.consent, s.deals.length], [1, 1, 0], "after-consent: contact and consent committed, no deal");
    const second = await post("/api/public/estimate", estimateBody(email, true), key);
    eq(second.status, 201, `after-consent: replay completes (${JSON.stringify(second.body)})`);
    s = await snapshot(receipt, email);
    assertComplete(s, "after-consent", true);
    eq(s.contacts.length, 1, "after-consent: no duplicate contact");
  }

  // ---- 3. Failure after the contact, before consent ---------------------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("consent", true);
    const first = await post("/api/public/estimate", estimateBody(email, true), key);
    await arm("consent", false);
    eq([first.status, first.body.recoverable], [202, true], `after-contact: recoverable 202 (${JSON.stringify(first.body)})`);
    const receipt = first.body.requestReceipt as string;
    let s = await snapshot(receipt, email);
    eq([s.contacts.length, s.consent, s.deals.length], [1, 0, 0], "after-contact: only the contact committed");
    const second = await post("/api/public/estimate", estimateBody(email, true), key);
    eq(second.status, 201, `after-contact: replay completes (${JSON.stringify(second.body)})`);
    assertComplete(await snapshot(receipt, email), "after-contact", true);
  }

  // ---- 4. Evidence-only recovery: the link bind itself failed ----------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("bind", true);
    const first = await post("/api/public/estimate", estimateBody(email), key);
    await arm("bind", false);
    eq([first.status, first.body.recoverable], [202, true], `bind-failed: recoverable 202 from immutable evidence (${JSON.stringify(first.body)})`);
    const receipt = first.body.requestReceipt as string;
    let s = await snapshot(receipt, email);
    eq(s.request.contact_id, null, "bind-failed: request link genuinely absent");
    eq(s.sourceEvents.length, 1, "bind-failed: occurrence evidence exists");
    const second = await post("/api/public/estimate", estimateBody(email), key);
    eq(second.status, 201, `bind-failed: replay completes (${JSON.stringify(second.body)})`);
    s = await snapshot(receipt, email);
    assertComplete(s, "bind-failed", false);
    eq(s.contacts.length, 1, "bind-failed: evidence-bound contact reused, no duplicate");
  }

  // ---- 5. get-started and callback entrances ----------------------------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/get-started", gsBody(email), key);
    await arm("deal", false);
    eq([first.status, first.body.recoverable], [202, true], `get-started: recoverable 202 (${JSON.stringify(first.body)})`);
    const second = await post("/api/public/get-started", gsBody(email), key);
    eq(second.status, 201, `get-started: replay completes (${JSON.stringify(second.body)})`);
    const s = await snapshot(first.body.requestReceipt, email);
    assertComplete(s, "get-started", true);
    eq(s.contacts.length, 1, "get-started: one contact");
  }
  {
    const phone = `30555${String(Math.floor(10000 + Math.random() * 89999))}`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/callback", cbBody(phone), key);
    await arm("deal", false);
    eq([first.status, first.body.recoverable], [202, true], `callback: recoverable 202 (${JSON.stringify(first.body)})`);
    const receipt = first.body.requestReceipt as string;
    const contactsBefore = (await q("SELECT count(*)::int n FROM contacts c JOIN contact_source_events e ON e.contact_id=c.id WHERE e.event_key=$1", [`form:callback_form:${receipt}`]))[0].n;
    eq(contactsBefore, 1, "callback: committed contact retained");
    const second = await post("/api/public/callback", cbBody(phone), key);
    eq(second.status, 201, `callback: replay completes (${JSON.stringify(second.body)})`);
    const s = await snapshot(receipt);
    assertComplete(s, "callback", true);
    eq((await q("SELECT count(*)::int n FROM contacts WHERE phone LIKE $1", [`%${phone.slice(-10)}`]))[0].n, 1, "callback: no duplicate contact by phone");
  }

  // ---- 6. Lost response after the recovery itself, then replay ---------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/estimate", estimateBody(email), key);
    await arm("deal", false);
    eq(first.status, 202, "lost-recovery: first attempt recoverable");
    h.loseNextSuccessfulResponse("POST", "/api/public/estimate", "socket");
    await post("/api/public/estimate", estimateBody(email), key).catch(() => null);
    ok(h.responseLossCount() >= 1, "lost-recovery: response-loss fault actually executed after the recovery committed");
    const replay = await post("/api/public/estimate", estimateBody(email), key);
    eq([replay.status, replay.body.requestReceipt], [200, first.body.requestReceipt], "lost-recovery: replay returns the committed receipt");
    assertComplete(await snapshot(first.body.requestReceipt, email), "lost-recovery", false);
  }

  // ---- 7. Concurrent replays: exactly one wins the recovery claim -------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/estimate", estimateBody(email), key);
    await arm("deal", false);
    eq(first.status, 202, "concurrent: first attempt recoverable");
    const [a, b] = await Promise.all([post("/api/public/estimate", estimateBody(email), key), post("/api/public/estimate", estimateBody(email), key)]);
    eq([a.status, b.status].sort(), [200, 201], `concurrent: one recovery winner, one plain replay (${a.status}/${b.status})`);
    assertComplete(await snapshot(first.body.requestReceipt, email), "concurrent", false);
  }

  // ---- 8. Silent first execution: fresh lease is never re-entered; stale lease is ---------------------------------
  {
    const email = `${randomUUID()}@example.test`, key = randomUUID();
    await arm("deal", true);
    const first = await post("/api/public/estimate", estimateBody(email), key);
    await arm("deal", false);
    const receipt = first.body.requestReceipt as string;
    await q("UPDATE inbound_requests SET lifecycle_state='processing', terminal_reason=NULL, updated_at=now() WHERE id=$1", [receipt]);
    const fresh = await post("/api/public/estimate", estimateBody(email), key);
    eq([fresh.status, fresh.body.status], [200, "processing"], "stale-lease: a live first execution is not re-entered");
    eq((await snapshot(receipt, email)).deals.length, 0, "stale-lease: nothing created by the blocked replay");
    await q("UPDATE inbound_requests SET updated_at=now()-interval '10 minutes' WHERE id=$1", [receipt]);
    const stale = await post("/api/public/estimate", estimateBody(email), key);
    eq(stale.status, 201, `stale-lease: silent execution past its lease is recovered (${JSON.stringify(stale.body)})`);
    assertComplete(await snapshot(receipt, email), "stale-lease", false);
  }

  // ---- 9. Malformed input stays a real 400 before any mutation ----------------------------------------------------
  {
    const email = `${randomUUID()}@example.test`;
    const before = (await q("SELECT count(*)::int n FROM contacts"))[0].n;
    const response = await post("/api/public/estimate", { ...estimateBody(email), monthlyVolume: undefined, phone: "" }, randomUUID());
    eq(response.status, 400, `malformed: real 400 (${JSON.stringify(response.body)})`);
    ok(!response.body.recoverable, "malformed: never presented as recoverable");
    eq((await q("SELECT count(*)::int n FROM contacts"))[0].n, before, "malformed: no contact created");
    const gsEmail = `${randomUUID()}@example.test`;
    const bad = await post("/api/public/get-started", { ...gsBody(gsEmail), email: "not-an-email", goal: undefined }, randomUUID());
    eq(bad.status, 400, `malformed get-started: real 400 (${JSON.stringify(bad.body)})`);
    eq((await q("SELECT count(*)::int n FROM contacts WHERE lower(email)=lower($1)", [gsEmail]))[0].n, 0, "malformed get-started: nothing created");
  }

  // ---- 10. F01-B: scoped review continuation through the real lead-ops route -------------------------------------
  const freshReview = async (label: string) => {
    const email = `${randomUUID()}@example.test`;
    const response = await post("/api/public/estimate", estimateBody(email), randomUUID());
    eq(response.status, 201, `${label}: fresh review request (${JSON.stringify(response.body)})`);
    const receipt = response.body.requestReceipt as string;
    const s = await snapshot(receipt, email);
    return { receipt, contactId: s.contacts[0].id as number, dealId: s.deals[0].id as number, taskId: s.tasks[0].id as number, email };
  };
  const resumePath = (receipt: string) => `/api/lead-ops/inbound-requests/${receipt}/resume`;
  const classify = async (f: { contactId: number; dealId: number }) => {
    await q("UPDATE contacts SET record_class='production', assigned_to=$2 WHERE id=$1", [f.contactId, h.email("agent")]);
    await q("UPDATE deals SET record_class='production', owner=$2 WHERE id=$1", [f.dealId, h.email("agent")]);
  };
  const totals = async () => ({
    tasks: (await q("SELECT count(*)::int n FROM tasks"))[0].n,
    decisions: (await q("SELECT count(*)::int n FROM inbound_assignment_decisions"))[0].n,
    events: (await q("SELECT count(*)::int n FROM task_authority_events"))[0].n,
  });
  {
    const f = await freshReview("resume");
    const list = await h.request("admin", "GET", "/api/lead-ops/inbound-requests?sourceClass=sales_request&limit=200");
    eq(list.status, 200, "resume: list readable by admin");
    const row = (list.body as any[]).find(r => r.requestReceipt === f.receipt);
    eq(row?.reviewRevision, 0, "resume: list exposes the current decision revision");

    for (const role of ["agent", "other", "merchant", "affiliate", "partner"]) {
      const r = await h.request(role, "POST", resumePath(f.receipt), { reviewRevision: 0 });
      eq(r.status, 403, `resume: ${role} is forbidden`);
    }
    eq((await h.request("anonymous", "POST", resumePath(f.receipt), { reviewRevision: 0 })).status >= 401, true, "resume: anonymous is refused");
    eq((await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 }, false)).status, 403, "resume: missing CSRF token is refused");
    eq((await h.request("admin", "POST", resumePath(f.receipt), {})).status, 400, "resume: revision is required");
    eq((await h.request("admin", "POST", resumePath("not-a-receipt"), { reviewRevision: 0 })).status, 404, "resume: malformed receipt");
    eq((await h.request("admin", "POST", resumePath(randomUUID()), { reviewRevision: 0 })).status, 404, "resume: unknown receipt");
    const untouched = await totals();

    // Missing classification: contact still unknown. Real blocked reason, nothing changed, no forced reclassification.
    const blockedClass = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([blockedClass.status, blockedClass.body.reason], [422, "CONTACT_NOT_CLASSIFIED_PRODUCTION"], `resume: unclassified is blocked with its reason (${JSON.stringify(blockedClass.body)})`);
    eq(await totals(), untouched, "resume: blocked attempts changed nothing");
    eq((await q("SELECT record_class FROM contacts WHERE id=$1", [f.contactId]))[0].record_class, "unknown", "resume: contact not reclassified by the click");

    await classify(f);
    const stale = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 7 });
    eq([stale.status, stale.body.reason], [409, "STALE_REVIEW"], "resume: stale review revision is refused");
    eq(await totals(), untouched, "resume: stale review changed nothing");

    const done = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([done.status, done.body.outcome, done.body.lifecycleState], [200, "continued", "accepted"], `resume: admin continues (${JSON.stringify(done.body)})`);
    eq(done.body.assignedTo, h.email("agent"), "resume: current ownership decides the owner");
    eq(done.body.taskId, f.taskId, "resume: the SAME retained task continues");
    const state = await snapshot(f.receipt);
    eq(state.tasks.length, 1, "resume: still exactly one task");
    ok(state.externalEffects.every(e => e.state === "held"), "resume: external effects remain held");
    eq((await q("SELECT count(*)::int n FROM task_authority_events WHERE task_id=$1 AND event_type='inbound_class_review_resolved'", [f.taskId]))[0].n, 1, "resume: continuation recorded once");
    eq((await q("SELECT user_id FROM audit_logs WHERE action='inbound_review_resumed' AND entity_key=$1", [f.receipt])).map(r => r.user_id), [h.userId("admin")], "resume: exactly one actor audit entry for the acting admin");
    const afterDone = await totals();
    const again = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([again.status, again.body.outcome], [200, "already_continued"], "resume: repeated resume is a read-only no-op");
    eq(await totals(), afterDone, "resume: repeat creates no task/decision/event");
  }
  {
    // Manager scope + lost response after commit, then retry.
    const f = await freshReview("resume-lost");
    await classify(f);
    h.loseNextSuccessfulResponse("POST", resumePath(f.receipt), "socket");
    await h.request("manager", "POST", resumePath(f.receipt), { reviewRevision: 0 }).catch(() => null);
    ok(h.responseLossCount() >= 2, "resume-lost: response-loss fault actually executed after the commit");
    const retry = await h.request("manager", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([retry.status, retry.body.outcome], [200, "already_continued"], "resume-lost: manager retry sees the committed continuation");
    eq((await snapshot(f.receipt)).tasks.length, 1, "resume-lost: one task");
    eq((await q("SELECT count(*)::int n FROM task_authority_events WHERE task_id=$1 AND event_type='inbound_class_review_resolved'", [f.taskId]))[0].n, 1, "resume-lost: one continuation event");
  }
  {
    // Completed human work is never reopened.
    const f = await freshReview("resume-terminal");
    await classify(f);
    await q("UPDATE tasks SET status='completed', completed_at=now() WHERE id=$1", [f.taskId]);
    const before = await totals();
    const r = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([r.status, r.body.reason], [409, "HUMAN_WORK_ALREADY_TERMINAL"], "resume-terminal: completed task is not reopened");
    eq(await totals(), before, "resume-terminal: nothing changed");
    eq((await q("SELECT status,contact_id FROM tasks WHERE id=$1", [f.taskId]))[0], { status: "completed", contact_id: null }, "resume-terminal: task untouched");
  }
  {
    // Archived contact and changed identity.
    const f = await freshReview("resume-archived");
    await classify(f);
    await q("UPDATE contacts SET archived_at=now() WHERE id=$1", [f.contactId]);
    const r = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([r.status, r.body.reason], [409, "CONTACT_ARCHIVED"], "resume-archived: archived contact blocked");
    await q("UPDATE contacts SET archived_at=NULL, email=$2 WHERE id=$1", [f.contactId, `${randomUUID()}@example.test`]);
    const changed = await h.request("admin", "POST", resumePath(f.receipt), { reviewRevision: 0 });
    eq([changed.status, changed.body.reason], [409, "CONTACT_IDENTITY_CHANGED"], "resume-identity: changed contact identity blocked");
  }
  {
    // Foreign-linked deal and a request that is not a review obligation.
    const request = (await claimInboundRequest({ idempotencyKey: randomUUID(), sourceCategory: "website_form", sourceType: "estimate_form",
      callerScope: `public:${randomUUID()}`, actorType: "public", payload: { n: randomUUID() } })).request;
    const [c] = await q("INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Evidence','Contact',$1,'','unknown') RETURNING id", [`${randomUUID()}@example.test`]);
    await q("INSERT INTO contact_source_events(contact_id,source_category,source_type,event_key,actor_type) VALUES($1,'website_form','estimate_form',$2,'public')", [c.id, `form:estimate_form:${request.id}`]);
    const [other] = await q("INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Other','Contact',$1,'','unknown') RETURNING id", [`${randomUUID()}@example.test`]);
    const [foreign] = await q("INSERT INTO deals(name,contact_id,record_class) VALUES('Foreign',$1,'unknown') RETURNING id", [other.id]);
    await orchestrateInboundRequest({ requestId: request.id, contactId: c.id, dealId: foreign.id });
    await q("UPDATE contacts SET record_class='production' WHERE id=$1", [c.id]);
    const revision = (await q("SELECT max(decision_ordinal)::int n FROM inbound_assignment_decisions WHERE request_id=$1", [request.id]))[0].n;
    const before = await totals();
    const r = await h.request("admin", "POST", resumePath(request.id), { reviewRevision: revision });
    eq([r.status, r.body.reason], [409, "DEAL_LINKED_TO_ANOTHER_OCCURRENCE"], `resume-foreign: foreign deal linkage blocked (${JSON.stringify(r.body)})`);
    eq(await totals(), before, "resume-foreign: nothing changed");
  }
  {
    // A recoverable (not yet reviewed) request has no review decision to continue from.
    const email = `${randomUUID()}@example.test`;
    await arm("deal", true);
    const first = await post("/api/public/estimate", estimateBody(email), randomUUID());
    await arm("deal", false);
    eq(first.status, 202, "resume-recoverable: recoverable request exists");
    const r = await h.request("admin", "POST", resumePath(first.body.requestReceipt), { reviewRevision: 0 });
    eq([r.status, r.body.reason], [409, "NO_REVIEW_DECISION"], "resume-recoverable: nothing to continue yet; real reason returned");
  }

  const denied = h.externalCalls();
  console.log(`PASS Stage 5 F01-A/B intake recovery: ${checks} checks. Real HTTP failure injection after contact, consent, deal, bind and notification, ` +
    `same-key replay, lost response, concurrent replay, stale lease, malformed 400, scoped review resume (admin/manager/forbidden roles, stale, ` +
    `unclassified, terminal task, archived, identity change, foreign linkage, repeat, lost response). Provider attempts denied by fixture: ${denied}, completed: 0.`);
  console.log("NOT EXERCISED: BullMQ workers, GHL/SMTP/SMS transport, browser UI (separate suite), multipart statement-upload adapter.");
} finally { await h.close(); }
