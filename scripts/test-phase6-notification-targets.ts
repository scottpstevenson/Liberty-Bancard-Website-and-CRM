/**
 * Phase 6 R07 — notification destinations and visibility.
 *
 * Real registered public handlers (estimate / get-started / callback) and the real notification routes, real persisted sessions,
 * on disposable infrastructure with every provider denied. Proves:
 *  - each public entrance now writes a notification that names its own request (event type, request id, short reference, review
 *    link), and the notification opens that request's review page with a specific action label;
 *  - an older notification written without a link still resolves, but only through its immutable recorded request relationship
 *    (never a name, email, title or a reference typed in its message), only for admin/manager, and rows with no recorded
 *    relationship stay explicitly unresolved;
 *  - the task, statement, support and inquiry destinations carry specific labels; a stale task is unavailable, not guessed;
 *  - agent, merchant, partner and affiliate accounts never receive request notifications or their destinations;
 *  - resolving a destination never marks a notification read.
 *
 * NOT EXERCISED here (reported, never counted as passes): the rendered list (client/src/pages/dashboard/Notifications.test.tsx,
 * browser first-viewport suite), BullMQ workers, GHL/SMTP/SMS transport.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  const { registerNotificationsRoutes } = await import("../server/routes/notifications");
  registerPublicRoutes(app);
  registerNotificationsRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
const ok = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const eq = (a: unknown, b: unknown, label: string) => { assert.deepEqual(a, b, label); checks++; };
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
try {
  const { inboundReviewLinkFor } = await import("../server/services/notification-authority");
  const { inboundReviewLink } = await import("../server/services/statement-review-notification");
  const { inboundShortRef } = await import("../server/services/inbound-request-authority");
  await q("INSERT INTO agents(user_id,first_name,last_name,email,status,role) VALUES($1,'Agent','Fixture',$2,'active','sales_rep')",
    [h.userId("agent"), h.email("agent")]);

  // ── 0. The two copies of the review-link rule cannot drift ────────────────────────────────────────────────────────
  for (const id of [randomUUID(), randomUUID(), "269b66af-0000-4000-8000-000000000000"])
    eq(inboundReviewLinkFor(id), inboundReviewLink(id), `review link rule matches the producers' rule for ${id.slice(0, 8)}`);
  eq(inboundReviewLinkFor("269b66af-0000-4000-8000-000000000000"), "/dashboard/lead-ops?tab=pipeline&ref=269B66AF", "exact link shape");

  const get = (role: string, query = "") => h.request(role, "GET", `/api/notifications${query}`);
  const target = (role: string, id: number) => h.request(role, "GET", `/api/notifications/${id}/target`);
  const unread = async (role: string) => (await h.request(role, "GET", "/api/notifications/count")).body.unread as number;

  // ── 1. Every public entrance writes a notification that names its own request ──────────────────────────────────────
  const estimate = await h.request("anonymous", "POST", "/api/public/estimate", {
    contactName: "Notice Estimate", businessName: "Notice Biz", email: `${randomUUID()}@example.test`, phone: "3055550142",
    vertical: "Retail", monthlyVolume: "50000", totalFees: "1500" }, true, { "Idempotency-Key": randomUUID() });
  const quiz = await h.request("anonymous", "POST", "/api/public/get-started", {
    goal: "lower fees", vertical: "Retail", monthlyVolume: "$15k-$50k", needTerminal: false, interestedIn0Percent: false,
    firstName: "Notice", lastName: "Quiz", email: `${randomUUID()}@example.test`, phone: "3055550143" }, true, { "Idempotency-Key": randomUUID() });
  const callback = await h.request("anonymous", "POST", "/api/public/callback", {
    name: "Notice Callback", phone: `30555${String(Math.floor(10000 + Math.random() * 89999))}`, bestTime: "morning", notes: "fixture" },
    true, { "Idempotency-Key": randomUUID() });
  for (const [name, response] of [["estimate", estimate], ["quiz", quiz], ["callback", callback]] as const)
    ok([200, 201, 202].includes(response.status) && response.body.requestReceipt, `${name} accepted (${response.status} ${JSON.stringify(response.body)})`);

  const produced: Array<{ name: string; event: string; receipt: string }> = [
    { name: "estimate", event: "estimate_request_received", receipt: estimate.body.requestReceipt },
    { name: "quiz", event: "quiz_lead_received", receipt: quiz.body.requestReceipt },
    { name: "callback", event: "callback_request_received", receipt: callback.body.requestReceipt },
  ];
  const producedIds: number[] = [];
  for (const entry of produced) {
    const rows = await q("SELECT id,metadata FROM notifications WHERE inbound_request_id=$1 AND metadata->>'eventType'=$2", [entry.receipt, entry.event]);
    eq(rows.length, 1, `${entry.name}: exactly one notification written with its own event type`);
    const metadata = rows[0].metadata;
    eq(metadata.requestId, entry.receipt, `${entry.name}: names its own request`);
    eq(metadata.shortRef, inboundShortRef(entry.receipt), `${entry.name}: short reference matches the request`);
    eq(metadata.link, inboundReviewLink(entry.receipt), `${entry.name}: review link matches the request`);
    ok(!("contactId" in metadata) && !("dealId" in metadata), `${entry.name}: no typed contact/deal target that could hide it`);
    producedIds.push(rows[0].id);

    for (const role of ["admin", "manager"]) {
      const listed = (await get(role)).body.data.find((row: any) => row.id === rows[0].id);
      ok(listed, `${entry.name}: visible to ${role}`);
      eq(listed.target.state, "available", `${entry.name}: ${role} destination available`);
      eq(listed.target.url, inboundReviewLink(entry.receipt), `${entry.name}: ${role} opens that request`);
      eq(listed.target.actionLabel, "Open request", `${entry.name}: ${role} sees a specific label`);
      const resolved = await target(role, rows[0].id);
      eq([resolved.body.state, resolved.body.url, resolved.body.actionLabel], ["available", inboundReviewLink(entry.receipt), "Open request"],
        `${entry.name}: ${role} destination read matches the list`);
    }
  }

  // ── 2. Older notifications: resolved only through the recorded request relationship ───────────────────────────────
  const request = async (label: string) => (await q(
    `INSERT INTO inbound_requests(idempotency_key,occurrence_key,request_fingerprint,source_category,source_type,source_class,caller_scope,
       actor_type,manifest_version,manifest_hash)
     VALUES($1,$1,$2,'website_form','estimate_form','sales','public','anonymous','fixture',$2) RETURNING id`,
    [`${label}-${randomUUID()}`, createHash("sha256").update(`fixture-${label}-${randomUUID()}`).digest("hex")]))[0].id as string;
  const historical = async (title: string, message: string, metadata: any, inboundRequestId: string | null) => (await q(
    `INSERT INTO notifications(channel,title,message,metadata,inbound_request_id,created_at)
     VALUES('internal',$1,$2,$3,$4,NOW()-interval '10 days') RETURNING id`, [title, message, metadata, inboundRequestId]))[0].id as number;
  const requestA = await request("A"), requestB = await request("B");
  const linkedOld = await historical("Callback Requested", `Mentions another request ${inboundShortRef(requestB)} and Pat Example <pat@example.test>`, {}, requestA);
  const unlinkedOld = await historical("Older alert without a record", "No relationship was recorded", {}, null);
  const lookalike = await historical("Name only", `Request ${inboundShortRef(requestA)} for Pat Example`, { shortRef: inboundShortRef(requestA) }, null);
  const strayLink = await historical("Stray link", "Unrecognized link", { link: "https://evil.test/x", eventType: "estimate_request_received" }, requestA);
  const adminView = (await get("admin")).body.data;
  const old = (id: number) => adminView.find((row: any) => row.id === id);
  eq([old(linkedOld).target.state, old(linkedOld).target.url, old(linkedOld).target.actionLabel],
    ["available", inboundReviewLinkFor(requestA), "Open request"], "older alert resolves to its own recorded request, not the reference typed in its message");
  ok(old(linkedOld).target.url !== inboundReviewLinkFor(requestB), "a reference or name inside the message never selects the request");
  eq(old(unlinkedOld).target.state, "unavailable", "older alert with no recorded relationship stays unresolved");
  eq(old(lookalike).target.state, "unavailable", "a short reference or name in metadata/message is never resolved to a request");
  ok(!old(strayLink), "an unrecognized link stays hidden even with a recorded request");
  eq((await target("admin", strayLink)).body.state, "unavailable", "hidden row has no destination either");
  eq((await target("manager", linkedOld)).body.url, inboundReviewLinkFor(requestA), "managers resolve the same recorded relationship");
  eq((await target("admin", unlinkedOld)).body.state, "unavailable", "destination read for an unrelated row is unavailable");

  // ── 3. Task, statement, support and inquiry labels; a stale task is unavailable ───────────────────────────────────
  const [task] = await q(`INSERT INTO tasks(title,status,priority,assigned_to) VALUES('Fixture task','pending','medium',$1) RETURNING id`, [h.email("admin")]);
  const taskNote = (await q(`INSERT INTO notifications(channel,title,message,metadata,created_at)
    VALUES('internal','Task assigned','Call the owner',$1,NOW()) RETURNING id`, [{ eventType: "task_assigned", taskId: task.id }]))[0].id as number;
  const taskTarget = await target("admin", taskNote);
  eq([taskTarget.body.state, taskTarget.body.url, taskTarget.body.actionLabel],
    ["available", `/dashboard/tasks-appointments?tab=tasks&taskId=${task.id}`, "Open task"], "a task alert opens the exact task with a specific label");
  const reviewKinds: Array<[string, string]> = [["statement_uploaded", "Statement"], ["support_request_received", "Support"], ["public_inquiry_received", "Inquiry"]];
  for (const [eventType, title] of reviewKinds) {
    const requestId = await request(eventType);
    const id = (await q(`INSERT INTO notifications(channel,title,message,metadata,inbound_request_id,created_at) VALUES('internal',$1,'fixture',$2,$3,NOW()) RETURNING id`,
      [title, { eventType, requestId, shortRef: inboundShortRef(requestId), link: inboundReviewLink(requestId) }, requestId]))[0].id as number;
    const resolved = await target("admin", id);
    eq([resolved.body.state, resolved.body.url, resolved.body.actionLabel], ["available", inboundReviewLink(requestId), "Open request"], `${eventType} opens its request`);
  }
  await q("UPDATE tasks SET deleted_at=NOW() WHERE id=$1", [task.id]);
  eq((await target("admin", taskNote)).body.state, "unavailable", "a task that was removed is unavailable, not guessed");

  // ── 4. Other roles never receive request notifications or destinations ────────────────────────────────────────────
  const requestNotices = [...producedIds, linkedOld, unlinkedOld, lookalike, strayLink];
  for (const role of ["agent", "other", "merchant", "partner", "affiliate"]) {
    const response = await get(role);
    if (response.status === 200) ok(!response.body.data.some((row: any) => requestNotices.includes(row.id)), `${role}: no request notifications listed`);
    else ok([401, 403].includes(response.status), `${role}: refused (${response.status})`);
    for (const id of requestNotices) {
      const resolved = await target(role, id);
      ok(resolved.status !== 200 || resolved.body.state === "unavailable", `${role}: destination for ${id} unavailable or refused`);
    }
  }
  eq((await get("anonymous")).status, 401, "anonymous refused");

  // ── 5. Resolving a destination never marks a notification read ────────────────────────────────────────────────────
  const before = await unread("admin");
  for (const id of [...producedIds, linkedOld, unlinkedOld]) await target("admin", id);
  eq(await unread("admin"), before, "target reads leave unread state untouched");
  eq((await q("SELECT count(*)::int n FROM notification_actor_states WHERE read_at IS NOT NULL"))[0].n, 0, "no actor read rows exist");

  // ── 6. Producers and the visibility rule stay wired together ───────────────────────────────────────────────────────
  const publicSource = readFileSync("server/routes/public.ts", "utf8");
  for (const event of ["estimate_request_received", "quiz_lead_received", "callback_request_received"])
    ok(publicSource.includes(`eventType: "${event}"`), `producer for ${event} is wired`);
  const authority = readFileSync("server/services/notification-authority.ts", "utf8");
  for (const event of ["estimate_request_received", "quiz_lead_received", "callback_request_received"])
    ok(authority.includes(`"${event}"`), `${event} is an inbound-review event for visibility and destination`);
  // The get-started route's pre-existing fire-and-forget deal blueprint step attempts an OpenAI call per submission; the fixture
  // refuses every attempt before it leaves the process. Attempts are reported, never counted as completed provider I/O.
  const denied = h.externalCalls();
  ok(denied <= 3, `every provider attempt was refused by the fixture (${denied} refused, 0 completed)`);
  console.log(`PASS Phase 6 notification targets (${checks} checks): own-request metadata on every public entrance, recorded-relationship resolution for older rows, specific labels, role refusal, read state untouched; ${denied} provider attempts, all refused`);
} finally { await h.close(); }
