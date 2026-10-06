import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

assert.ok(process.env.TEST_REDIS_PREFIX,"A disposable parent namespace is required");
process.env.TEST_REDIS_PREFIX += `draft_fixture_${randomUUID().replaceAll("-","")}_`;
const isolation = await assertDisposableTestInfrastructure({
  operation: "Stage 3 B registered draft/Knowledge handlers", requireRedis: true, reserveRedisNamespace: true,
});
const { pool } = await import("../server/db");
const { default: express } = await import("express");
const { default: cookieParser } = await import("cookie-parser");
const { default: bcrypt } = await import("bcryptjs");
const { setupAuth } = await import("../server/replit_integrations/auth");
const { csrfTokenEndpoint } = await import("../server/middleware/csrf");
const { registerMessageDraftRoutes } = await import("../server/routes/message-drafts");
const { registerKnowledgeAdminRoutes } = await import("../server/routes/knowledge-admin");
const { registerWorkflowsRoutes } = await import("../server/routes/workflows");
const { registerTicketsTasksRoutes } = await import("../server/routes/tickets-tasks");
const { registerDailyBriefingRoutes } = await import("../server/routes/daily-briefing");
const { readTaskDigestFacts, readTaskMetrics } = await import("../server/services/task-read-authority");
const { isValidEmail, computeDataReadinessScore } = await import("../server/services/contact-readiness");
const prefix = `stage3b-${randomUUID()}`;
const password = `fixture-${randomUUID()}`;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const originalFetch = globalThis.fetch;
let externalCalls = 0;
try {
  const roles = ["admin", "manager", "agent", "other", "merchant", "affiliate", "partner"];
  const passwordHash = await bcrypt.hash(password, 4);
  for (const role of roles) await pool.query(`INSERT INTO users(id,email,password_hash,role,auth_provider,email_verified)
    VALUES($1,$2,$3,$4,'local',NOW())`,
  [`${prefix}-${role}`, `${prefix}-${role}@example.test`, passwordHash, role === "other" ? "agent" : role]);
  const actor = `${prefix}-agent@example.test`;
  const foreign = `${prefix}-other@example.test`;
  const contacts: number[] = [];
  for (const owner of [actor, foreign]) {
    const row = await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
      VALUES('Draft','Fixture',$1,$2,$3,'test') RETURNING id`,
    [`${prefix}-${contacts.length}@example.test`, `+1555${randomInt(1000000,9999999)}`, owner]);
    contacts.push(row.rows[0].id);
  }
  const [owned, other] = contacts;
  for (const namespace of ["mail_a", "mail_b"]) await pool.query(`INSERT INTO inbox_items
    (source_namespace,source_item_id,source_item_type,source_body,contact_id)
    VALUES($1,'42','email','Immutable source',$2)`, [namespace, owned]);
  await pool.query(`INSERT INTO knowledge_sources(title,content,audience,status)
    VALUES($1,'Fixture only','staff','draft'),($2,'Fixture only','public','published')`,
  [`${prefix}-staff`, `${prefix}-public`]);
  const app = express(); app.use(express.json()); app.use(cookieParser());
  await setupAuth(app);
  app.get("/api/csrf-token", csrfTokenEndpoint);
  registerMessageDraftRoutes(app);
  registerKnowledgeAdminRoutes(app);
  registerWorkflowsRoutes(app);
  registerTicketsTasksRoutes(app);
  registerDailyBriefingRoutes(app);
  server = await new Promise<any>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server!.address() as any).port}`;
  globalThis.fetch = (async (input: any, init: any) => {
    if (!String(input).startsWith(`${base}/`)) { externalCalls++; throw new Error("FIXTURE_PROVIDER_DENIED"); }
    return originalFetch(input, init);
  }) as typeof fetch;
  const sessions = new Map<string, { cookie: string; token: string }>();
  for (const role of roles) {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${prefix}-${role}@example.test`, password }) });
    assert.equal(login.status, 200, `actual ${role} login`);
    let cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    const csrf = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie } });
    const token = (await csrf.json()).token;
    cookie = [...cookie.split("; "), ...csrf.headers.getSetCookie().map(v => v.split(";")[0])]
      .filter((v, i, all) => !all.slice(i+1).some(later => later.split("=")[0] === v.split("=")[0])).join("; ");
    sessions.set(role, { cookie, token });
  }
  async function request(role: string, method: string, path: string, body?: unknown, csrf = true) {
    const session = sessions.get(role);
    const response = await fetch(base + path, { method,
      headers: { "Content-Type": "application/json", ...(session ? { Cookie: session.cookie } : {}),
        ...(session && csrf ? { "X-CSRF-Token": session.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const context = { contextType: "contact", contextId: String(owned), channel: "email" };
  const path = `/api/message-drafts?${new URLSearchParams(context)}`;
  const command = { context, subject: "Fixture subject", body: "Durable fixture text", expectedVersion: 0, commandId: randomUUID() };
  assert.equal((await request("anonymous", "GET", path)).status, 401);
  for (const role of ["merchant", "affiliate", "partner"]) assert.equal((await request(role, "PUT", "/api/message-drafts", command)).status, 403);
  assert.equal((await request("agent", "PUT", "/api/message-drafts", command, false)).status, 403);
  assert.equal((await request("other", "PUT", "/api/message-drafts", command)).status, 404);
  const created = await request("agent", "PUT", "/api/message-drafts", command);
  assert.equal(created.status, 200); assert.equal(created.body.draft.version, 1);
  assert.equal(created.body.draft.delivered, false);
  assert.deepEqual((await request("agent", "PUT", "/api/message-drafts", command)).body, created.body, "lost-response retry identical");
  assert.equal((await request("agent", "PUT", "/api/message-drafts", { ...command, body: "changed retry" })).status, 409);
  const reopened = await request("agent", "GET", path);
  assert.equal(reopened.body.draft.id, created.body.draft.id); assert.equal(reopened.body.draft.body, command.body);
  const edits = await Promise.all(["editor_a", "editor_b"].map(body => request("agent", "PUT", "/api/message-drafts",
    { ...command, body, expectedVersion: 1, commandId: randomUUID() })));
  assert.deepEqual(edits.map(v => v.status).sort(), [200,409]);
  assert.equal((await request("agent", "GET", path)).body.draft.version, 2);
  assert.equal((await request("manager", "GET", path)).body.draft, null, "actor-local draft not shared");
  for (const namespace of ["mail_a", "mail_b"]) {
    const c = { contextType: "inbox", contextId: `${namespace}::42`, channel: "email" };
    const saved = await request("agent", "PUT", "/api/message-drafts", { ...command, context: c, body: namespace, commandId: randomUUID() });
    assert.equal(saved.status, 200);
    assert.equal((await request("agent", "GET", `/api/message-drafts?${new URLSearchParams(c)}`)).body.draft.body, namespace);
  }
  const global = { contextType: "global", contextId: "unaddressed", channel: "email" };
  assert.equal((await request("agent", "PUT", "/api/message-drafts", { ...command, context: global, commandId: randomUUID() })).status, 200);
  assert.equal((await request("agent", "PUT", "/api/message-drafts", { ...command, context: { ...context, contextId: String(other) }, commandId: randomUUID() })).status, 404);
  assert.equal((await request("agent", "PUT", "/api/message-drafts", { ...command, actorId: "forged" })).status, 400);
  assert.equal((await request("agent", "PUT", "/api/message-drafts", { ...command, body: "x".repeat(50001) })).status, 400);
  await pool.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2", [foreign, owned]);
  assert.equal((await request("agent", "GET", path)).status, 404, "ownership change denies reopening");
  assert.equal((await request("agent", "PUT", "/api/message-drafts", command)).status, 404, "accepted-command replay reauthorized");
  const facts = await pool.query("SELECT count(*)::int AS n FROM rep_message_drafts WHERE actor_id=$1",[`${prefix}-agent`]);
  assert.equal(facts.rows[0].n, 4);
  assert.equal((await request("agent", "GET", "/api/knowledge/sources")).status, 403);
  for (const role of ["admin", "manager"]) {
    const list = await request(role, "GET", "/api/knowledge/sources?status=draft&audience=staff");
    assert.equal(list.status, 200);
    assert.ok(list.body.sources.some((s: any) => s.title === `${prefix}-staff`));
    assert.ok(list.body.sources.every((s: any) => s.status === "draft" && s.audience === "staff"));
  }
  const malicious = await request("admin", "GET", `/api/knowledge/sources?status=${encodeURIComponent("draft' OR true --")}`);
  assert.equal(malicious.status, 400);
  await pool.query("ALTER TABLE knowledge_sources RENAME TO knowledge_sources_fixture_unavailable");
  assert.equal((await request("admin", "GET", "/api/knowledge/sources")).status, 500, "real DB failure is not successful empty");
  await pool.query("ALTER TABLE knowledge_sources_fixture_unavailable RENAME TO knowledge_sources");
  assert.equal((await request("admin", "GET", "/api/knowledge/sources")).status, 200, "retry recovers");

  // Actual workflow configuration commands; execution stays disabled, no
  // provider actions. Historical rows are fixtures, not manufactured sends.
  const made = await request("admin", "POST", "/api/workflows", {
    name: `${prefix}-workflow`, triggerType: "manual", enabled: false, actions: [],
  });
  assert.equal(made.status, 201);
  const wfId = made.body.id;
  assert.equal(made.body.version, 1);
  const wfPath = `/api/workflows/${wfId}`;
  for (const role of ["agent", "other", "merchant", "affiliate", "partner"]) {
    assert.equal((await request(role, "PUT", wfPath, { name: "Denied", expectedVersion: 1 })).status, 403);
    assert.equal((await request(role, "DELETE", wfPath, { expectedVersion: 1 })).status, 403);
    assert.equal((await request(role, "POST", `${wfPath}/run`, { entityType: "contact", entityId: owned })).status, 403);
  }
  assert.equal((await request("admin", "PUT", wfPath, { name: "No CSRF", expectedVersion: 1 }, false)).status, 403);
  assert.equal((await request("admin", "PUT", wfPath, { name: "No version" })).status, 400);
  assert.equal((await request("admin", "PUT", wfPath, { retiredAt: new Date().toISOString(), expectedVersion: 1 })).status, 400);
  const saves = await Promise.all(["one", "two"].map(name =>
    request("manager", "PUT", wfPath, { name: `${prefix}-${name}`, expectedVersion: 1 })));
  assert.deepEqual(saves.map(s => s.status).sort(), [200,409]);
  const wfRead = await request("manager", "GET", wfPath);
  assert.equal(wfRead.body.version, 2);
  // Audit failure cannot leave a successful configuration edit/version.
  await pool.query(`CREATE FUNCTION stage3_b_reject_workflow_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='workflow_updated' THEN RAISE EXCEPTION 'fixture_audit_failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER stage3_b_workflow_audit_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION stage3_b_reject_workflow_audit()`);
  assert.equal((await request("admin", "PUT", wfPath, { name: "Must rollback", expectedVersion: 2 })).status, 500);
  assert.deepEqual((await request("manager", "GET", wfPath)).body, wfRead.body, "audit and configuration atomic");
  await pool.query("DROP TRIGGER stage3_b_workflow_audit_failure ON audit_logs");
  await pool.query("DROP FUNCTION stage3_b_reject_workflow_audit()");
  await pool.query("INSERT INTO workflow_runs(workflow_id,status,log) VALUES($1,'completed','[]'::jsonb)", [wfId]);
  const historyCount = async () => (await pool.query("SELECT count(*)::int n FROM workflow_runs WHERE workflow_id=$1", [wfId])).rows[0].n;
  assert.equal((await request("admin", "POST", `${wfPath}/run`, { entityType: "contact", entityId: owned })).status, 400);
  assert.equal(await historyCount(), 1, "disabled run has zero history/executor effects");
  const retired = await request("admin", "DELETE", wfPath, { expectedVersion: 2 });
  assert.equal(retired.status, 200); assert.equal(retired.body.historyRetained, true);
  assert.equal(retired.body.workflow.version, 3); assert.ok(retired.body.workflow.retiredAt);
  assert.equal(await historyCount(), 1);
  assert.equal((await request("admin", "PUT", wfPath, { enabled: true, expectedVersion: 3 })).status, 409);
  assert.equal((await request("manager", "POST", `${wfPath}/restore`, { expectedVersion: 3 })).body.enabled, false);
  const restored = (await request("manager", "GET", wfPath)).body;
  assert.equal(restored.version, 4); assert.equal(restored.retiredAt, null); assert.equal(restored.enabled, false);
  assert.equal((await request("manager", "PUT", wfPath, { enabled: true, expectedVersion: 4 })).status, 200);
  await pool.query("INSERT INTO workflow_runs(workflow_id,status,log) VALUES($1,'waiting','[]'::jsonb)", [wfId]);
  assert.equal((await request("manager", "DELETE", wfPath, { expectedVersion: 5 })).status, 409, "retained pending work blocks retirement");
  assert.equal((await request("manager", "PUT", wfPath, { name: "No pending edit", expectedVersion: 5 })).status, 409);
  assert.equal(await historyCount(), 2, "blocked retirement retains both history and work");

  // One production cohort, exact actor/class/asOf boundaries. No sender/timer
  // invoked; static insertions are fixture facts, never product cleanup.
  const c = await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Metric','Fixture',$1,$2,$3,'production') RETURNING id`,
  [`${prefix}-metrics@example.test`, `+1555${randomInt(1000000,9999999)}`, actor]);
  const metricContact = c.rows[0].id;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const future = new Date(now.getTime() + 86400000);
  for (const [state, due, deleted, contact] of [
    ["open", yesterday, null, metricContact], ["in_progress", yesterday, null, metricContact],
    ["completed", yesterday, null, metricContact], ["cancelled", yesterday, null, metricContact],
    ["open", future, null, metricContact], ["open", yesterday, now, metricContact],
    ["open", yesterday, null, owned],
  ] as const) {
    await pool.query(`INSERT INTO tasks(title,contact_id,status,authority_state,due_date,deleted_at,completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [`${prefix}-metric`, contact,
      state === "open" ? "pending" : state === "in_progress" ? "in progress" : state, state, due, deleted,
      state === "completed" ? now : null]);
  }
  const scope = { actor: { role: "agent", email: actor }, recordClass: "production" as const, asOf: now, timezone: "UTC" };
  const metrics = await readTaskMetrics(scope);
  assert.equal(metrics.rows[0].total, 5); assert.equal(metrics.rows[0].overdue, 2);
  const digest = await readTaskDigestFacts(scope, yesterday);
  assert.equal(digest.overdue, 2); assert.equal(digest.completed, 1);
  assert.equal(digest.overdue_rows.length, 2);
  const taskList = await request("agent", "GET", `/api/tasks?asOf=${encodeURIComponent(now.toISOString())}&recordClass=production`);
  assert.equal(taskList.status, 200);
  assert.equal((Array.isArray(taskList.body) ? taskList.body : taskList.body.data).length, 5);
  const briefing = await request("agent", "POST", "/api/overview/daily-briefing/refresh", {});
  assert.equal(briefing.status, 200); assert.equal(briefing.body.overdueTaskCount, 2);
  assert.equal(briefing.body.unreadCount, null);
  assert.equal(briefing.body.taskMetricContract.cachedDailySnapshot, true);
  assert.match(briefing.body.aiSummary, /Overdue tasks: 2/);
  await pool.query("ALTER TABLE inbox_items RENAME TO inbox_items_fixture_unavailable");
  const degraded = await request("agent", "POST", "/api/overview/daily-briefing/refresh", {});
  assert.equal(degraded.status, 200); assert.equal(degraded.body.overdueSlaCount, null);
  assert.equal(degraded.body.sectionStatus.sla, "degraded"); assert.equal(degraded.body.overdueTaskCount, 2);
  assert.match(degraded.body.aiSummary, /SLA breaches: unavailable/);
  await pool.query("ALTER TABLE inbox_items_fixture_unavailable RENAME TO inbox_items");
  const foreignBriefing = await request("other", "POST", "/api/overview/daily-briefing/refresh", {});
  assert.equal(foreignBriefing.body.overdueTaskCount, 0, "actor factual cache is isolated");
  assert.equal(isValidEmail("no-email-fixture@no-email.libertybancard.internal"), false);
  assert.equal(isValidEmail("123456@qq.com"), true);
  const withPlaceholder = computeDataReadinessScore({ email: "no-email-fixture@no-email.libertybancard.internal" } as any);
  const withoutEmail = computeDataReadinessScore({ email: null } as any);
  assert.equal(withPlaceholder.score, withoutEmail.score);
  assert.equal(withPlaceholder.breakdown.components.email.earnedPoints, 0);
  assert.equal(withPlaceholder.breakdown.components.email.status, "invalid", "placeholder is not a missing address nor a real address");
  assert.equal(externalCalls, 0, "no send/generate/provider calls");
  console.log("PASS Stage 3 B registered sessions/CSRF: drafts create/read/CAS/concurrent/replay/ownership/source isolation; Knowledge parameter query/error/retry; placeholder completeness; workflow stale save/audit rollback/retained retirement/restore/pending conflict/denial; task list/digest/briefing frozen cohort and degraded null. Zero provider calls. Browser acceptance and remaining Task B gates NOT certified here.");
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await isolation.releaseRedisReservation();
  await pool.end();
}
