/** Actual registered HTTP handlers, local password sessions, CSRF and disposable
 * database fixtures. No provider transport or application/worker bootstrap.
 */
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "Stage 3 A authority", requireRedis: false });
const { pool } = await import("../server/db");
const { default: express } = await import("express");
const { default: cookieParser } = await import("cookie-parser");
const { default: bcrypt } = await import("bcryptjs");
const { setupAuth } = await import("../server/replit_integrations/auth");
const { csrfTokenEndpoint } = await import("../server/middleware/csrf");
const { crmObjectAccessGuard } = await import("../server/services/crm-object-access");
const { registerContactsRoutes } = await import("../server/routes/contacts");
const { registerWorkflowsRoutes } = await import("../server/routes/workflows");
const { registerTicketsTasksRoutes } = await import("../server/routes/tickets-tasks");
const { readTaskMetrics } = await import("../server/services/task-read-authority");
const { storage } = await import("../server/storage");
const { SEQUENCE_REPORT_SQL } = await import("../server/services/sequence-report-query");
const { readTerminalRecommendationReport } = await import("../server/services/terminal-report-authority");
const { readSequenceRuntimeStatus } = await import("../server/services/sequence-runtime-status");
const { registerAnalyticsRoutes } = await import("../server/routes/analytics");
const { registerDailyBriefingRoutes } = await import("../server/routes/daily-briefing");
const { registerCampaignsRoutes } = await import("../server/routes/campaigns");
const { registerInboxRoutes } = await import("../server/routes/inbox");
const { registerTerminalEconomicsRoutes } = await import("../server/routes/terminal-economics");
const { certifyStage3Reads } = await import("./stage3-a-read-fixtures");
const { certifyStage3Creates } = await import("./stage3-a-create-fixtures");
const { writeContact } = await import("../server/services/contact-writer");
const { orchestrateInboundRequest } = await import("../server/services/inbound-request-authority");
const { registerAuthRoutes } = await import("../server/replit_integrations/auth");
let creationFault: import("./stage3-a-create-fixtures").CreationFault;

const prefix = `stage3-${randomUUID()}`;
const password = `fixture-${randomUUID()}`;
const originalFetch = globalThis.fetch;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
try {
  const passwordHash = await bcrypt.hash(password, 4);
  const roles = ["admin", "manager", "agent", "merchant", "affiliate", "partner"];
  for (const role of roles) await pool.query(`INSERT INTO users(id,email,password_hash,role,auth_provider,email_verified)
    VALUES($1,$2,$3,$4,'local',NOW())`, [`${prefix}-${role}`, `${prefix}-${role}@example.test`, passwordHash, role]);
  if (process.env.STAGE3_BROWSER_PROOF === "1") {
    await pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [`${prefix}-%`]);
  }
  const agentEmail = `${prefix}-agent@example.test`;
  const otherEmail = `${prefix}-other@example.test`;
  const contactIds: number[] = [];
  for (const owner of [agentEmail, otherEmail, null]) {
    const result = await pool.query(`INSERT INTO contacts(first_name,last_name,email,assigned_to,record_class,phone,
      lead_source,created_at,email_status) VALUES('Authority','Fixture',$1,$2,'production',$3,'dashboard',NOW()-INTERVAL '60 days','valid') RETURNING id`,
    [`${prefix}-${contactIds.length}@example.test`, owner, `+1555${randomInt(1000000, 9999999)}`]);
    contactIds.push(result.rows[0].id);
  }
  const [owned, nonowned, unassigned] = contactIds;
  const wf = await pool.query(`INSERT INTO workflows(name,trigger_type,enabled,actions) VALUES($1,'manual',true,'[]'::jsonb) RETURNING id`, [prefix]);
  const workflowId = wf.rows[0].id;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  await setupAuth(app);
  app.get("/api/csrf-token", csrfTokenEndpoint);
  app.use(crmObjectAccessGuard);
  registerContactsRoutes(app, {
    writeContact: async input => {
      if (creationFault === "before_commit") throw new Error("FIXTURE_PRECOMMIT_FAILED");
      const contact = await writeContact(input);
      if (creationFault === "after_commit") throw new Error("FIXTURE_TIMEOUT_AFTER_COMMIT");
      return contact;
    },
    orchestrateInboundRequest: async input => {
      if (creationFault === "handoff") throw new Error("FIXTURE_HANDOFF_FAILED");
      return orchestrateInboundRequest(input);
    },
  });
  registerWorkflowsRoutes(app);
  registerTicketsTasksRoutes(app);
  registerAnalyticsRoutes(app);
  registerDailyBriefingRoutes(app);
  registerCampaignsRoutes(app);
  registerInboxRoutes(app);
  registerTerminalEconomicsRoutes(app);
  registerAuthRoutes(app);
  if (process.env.STAGE3_BROWSER_PROOF === "1") {
    app.use(express.static("dist/public"));
    app.get("/", (_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
    app.get("/dashboard/{*path}", (_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
    app.get("/auth", (_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
  }
  server = await new Promise<any>(resolve => { const running = app.listen(Number(process.env.STAGE3_BROWSER_PORT ?? 0), "127.0.0.1", () => resolve(running)); });
  const base = `http://127.0.0.1:${(server!.address() as any).port}`;
  let providerCalls = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    if (!String(input).startsWith(`${base}/`)) { providerCalls++; throw new Error("STAGE3_PROVIDER_DENIED"); }
    return originalFetch(input, init);
  }) as typeof fetch;
  const sessions = new Map<string, { cookie: string; token: string }>();
  for (const role of roles) {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${prefix}-${role}@example.test`, password }) });
    assert.equal(login.status, 200, `${role} actual local login`);
    let cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const csrf = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie } });
    const token = (await csrf.json()).token;
    cookie = [...cookie.split("; "), ...csrf.headers.getSetCookie().map(value => value.split(";")[0])]
      .filter((value, index, all) => !all.slice(index + 1).some(later => later.split("=")[0] === value.split("=")[0])).join("; ");
    assert.ok(token);
    sessions.set(role, { cookie, token });
  }
  async function request(role: string, method: string, path: string, body?: unknown, csrf = true, headers: Record<string, string> = {}) {
    const session = sessions.get(role)!;
    const response = await fetch(base + path, { method, headers: { Cookie: session.cookie, "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": session.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.headers.get("content-type")?.includes("text/csv")
      ? await response.text() : await response.json() };
  }
  // Reconciled mobile thread endpoint: actual persisted immutable source and
  // registered handler, including no restricted body disclosure on denial.
  for (const [suffix, contactId] of [["owned", owned], ["nonowned", nonowned]] as const) {
    await pool.query("INSERT INTO inbox_items(source_item_id,contact_id,source_body) VALUES($1,$2,$3)",
      [`${prefix}-${suffix}`, contactId, `Immutable ${suffix} fixture body`]);
  }
  const thread = await request("agent", "GET", `/api/inbox/items/${prefix}-owned`);
  assert.equal(thread.status, 200);
  assert.equal(thread.body.body, "Immutable owned fixture body");
  const deniedThread = await request("agent", "GET", `/api/inbox/items/${prefix}-nonowned`);
  assert.equal(deniedThread.status, 404);
  assert.ok(!JSON.stringify(deniedThread.body).includes("Immutable"));
  assert.equal((await request("merchant", "GET", `/api/inbox/items/${prefix}-owned`)).status, 403);
  assert.equal((await request("agent", "GET", `/api/inbox/items/${prefix}-missing`)).status, 404);
  const audience = await request("agent", "GET", "/api/contacts/cold-leads");
  assert.equal(audience.status, 200);
  assert.ok(audience.body.data.some((row: any) => row.id === owned));
  assert.ok(audience.body.data.some((row: any) => row.id === unassigned));
  assert.ok(!audience.body.data.some((row: any) => row.id === nonowned));
  assert.equal(audience.body.estimatedValue, undefined);
  const auditsBefore = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity_type='contact' AND entity_id=ANY($1::int[])`, [contactIds]);
  assert.equal((await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned, nonowned] })).status, 404);
  const auditsAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity_type='contact' AND entity_id=ANY($1::int[])`, [contactIds]);
  assert.equal(auditsBefore.rows[0].n, auditsAfter.rows[0].n, "mixed denied set has zero audit writes");
  assert.equal((await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned, owned] })).status, 400);
  assert.equal((await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned] }, false)).status, 403);
  for (let replay = 0; replay < 2; replay++) {
    const outcome = await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned, unassigned] });
    assert.equal(outcome.status, 200); assert.equal(outcome.body.enrolled, 0);
    assert.ok(outcome.body.outcomes.every((row: any) => row.enrolled === false && ["held", "blocked"].includes(row.state)));
  }
  const tags = await pool.query("SELECT tags FROM contacts WHERE id=ANY($1::int[])", [contactIds]);
  assert.ok(tags.rows.every(row => !(row.tags ?? []).includes("RE-ENGAGE-60") && !(row.tags ?? []).includes("COLD-NO-DEAL")));
  const { certifyStage3Cold } = await import("./stage3-a-cold-fixtures");
  await certifyStage3Cold({ pool, prefix, owned, nonowned, agentEmail, request });
  for (const role of ["merchant", "affiliate", "partner", "agent"]) {
    for (const [method, path, body] of [
      ["GET", "/api/workflows", undefined], ["POST", "/api/workflows", { name: "Forbidden" }],
      ["PUT", `/api/workflows/${workflowId}`, { name: "Forbidden" }],
      ["DELETE", `/api/workflows/${workflowId}`, undefined],
      ["POST", `/api/workflows/${workflowId}/run`, { entityType: "contact", entityId: owned }],
      ["GET", "/api/workflow-runs", undefined],
    ] as const) assert.equal((await request(role, method, path, body)).status, 403, `${role} ${method} ${path}`);
  }
  for (const role of ["admin", "manager"]) {
    assert.equal((await request(role, "GET", "/api/workflows")).status, 200);
    assert.equal((await request(role, "POST", `/api/workflows/${workflowId}/run`, { entityType: "company", entityId: owned })).status, 400);
    assert.equal((await request(role, "POST", `/api/workflows/${workflowId}/run`, { entityType: "contact", entityId: 2147483647 })).status, 404);
  }
  const deniedRuns = await pool.query("SELECT COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id=$1", [workflowId]);
  assert.equal(deniedRuns.rows[0].n, 0, "denied runs never reached executor");
  const missingSession = await originalFetch(`${base}/api/workflows`);
  assert.equal(missingSession.status, 401);
  assert.equal((await request("admin", "POST", `/api/workflows/${workflowId}/run`, { entityType: "contact", entityId: owned })).status, 200);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM workflow_runs WHERE workflow_id=$1", [workflowId])).rows[0].n, 1);
  console.log("PASS actual session cold/workflow authorization, CSRF, whole-set denial, replay and no-tag outcomes");

  const asOf = new Date("2026-10-03T12:00:00Z");
  for (const [state, deleted] of [["open", false], ["in_progress", false], ["completed", false], ["cancelled", false], ["open", true]] as const) {
    await pool.query(`INSERT INTO tasks(title,contact_id,status,authority_state,due_date,deleted_at)
      VALUES($1,$2,'pending',$3,$4,$5)`, [prefix, owned, state, new Date(asOf.getTime() - 3600000), deleted ? asOf : null]);
  }
  const scope = { actor: { role: "agent", email: agentEmail }, asOf, timezone: "UTC" };
  const metrics = await readTaskMetrics(scope);
  const list = await storage.getTasks({ scope });
  assert.equal(metrics.rows[0].total, list.length);
  assert.equal(metrics.rows[0].total, 4);
  assert.equal(metrics.rows[0].overdue, 2);
  assert.equal((await storage.getTasks({ scope: { ...scope, states: ["open", "in_progress"], dueBefore: asOf } })).length, 2);
  console.log("PASS DB same-scope task list/metric/open-state/deletion/date parity");

  const sequence = await pool.query("INSERT INTO follow_up_sequences(name,status) VALUES($1,'paused') RETURNING id", [prefix]);
  const sequenceId = sequence.rows[0].id;
  for (let step = 0; step < 2; step++) await pool.query("INSERT INTO sequence_steps(sequence_id,step_order,action_type) VALUES($1,$2,'email')", [sequenceId, step]);
  for (const status of ["active", "cancelled", "completed"]) await pool.query("INSERT INTO sequence_enrollments(sequence_id,contact_id,status) VALUES($1,$2,$3)", [sequenceId, owned, status]);
  const sequences = await pool.query(SEQUENCE_REPORT_SQL);
  const row = sequences.rows.find(row => row.id === sequenceId);
  assert.equal(row.step_count, 2); assert.equal(row.email_steps, 2);
  assert.equal(row.total_memberships, 3); assert.equal(row.unique_contacts, 1);
  assert.equal(row.active_enrollments, 1); assert.equal(row.completed_enrollments, 1);
  console.log("PASS independent DB 2-step/3-membership counts and repeated-contact identity");

  const beforeFinance = await readTerminalRecommendationReport(0, { greenThresholdMonths: 6, yellowThresholdMonths: 12 });
  await pool.query(`INSERT INTO deals(name,contact_id,record_class,terminal_recommendation,terminal_cost_at_order,estimated_gross_profit_monthly,stage,closed_at)
    SELECT $1,$2,'production','Fixture Terminal',100,'20','Closed Lost','2020-01-01'::timestamp FROM generate_series(1,5001)`, [prefix, owned]);
  const finance = await readTerminalRecommendationReport(0, { greenThresholdMonths: 6, yellowThresholdMonths: 12 });
  assert.equal(finance.summary.totalRecommendations - beforeFinance.summary.totalRecommendations, 5001); assert.equal(finance.rows.length, 100);
  assert.equal(finance.summary.totalDeployedTerminals, null); assert.equal(finance.summary.paidOffCount, null);
  assert.equal(finance.summary.actualCashRecovery, null);
  assert.ok(finance.rows.every((row: any) => row.paybackStatus === "unknown"));
  const runtime = await readSequenceRuntimeStatus();
  assert.equal(runtime.smtp.configured, false); assert.equal(runtime.verifiedDelivery, "not_observed");
  assert.equal(providerCalls, 0);
  console.log("PASS full >5000 scoped forecast population, unavailable actuals and zero provider calls");
  await certifyStage3Reads({ pool, prefix, owned, nonowned, agentEmail, request });
  await certifyStage3Creates({ pool, prefix, request, setFault: value => { creationFault = value; } });
  assert.equal(providerCalls, 0);
  if (process.env.STAGE3_BROWSER_PROOF === "1") {
    const { certifyStage3Browser } = await import("./stage3-a-browser-fixtures");
    await certifyStage3Browser({ base, cookie: sessions.get("admin")!.cookie, managerCookie: sessions.get("manager")!.cookie, fetch: originalFetch,
      chromium: process.env.STAGE3_CHROMIUM_PATH! });
    const holdMs = Number(process.env.STAGE3_BROWSER_HOLD_MS ?? 0);
    if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 120000) throw new Error("Invalid fixture screenshot hold");
    if (holdMs) {
      console.log("Fixture public screenshot server ready");
      await new Promise(resolve => setTimeout(resolve, holdMs));
    }
    await new Promise(resolve => setTimeout(resolve, Number(process.env.STAGE3_BROWSER_PAUSE_MS ?? 0)));
  }
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  // Only this invocation's synthetic fixture rows; never whole-table cleanup.
  await pool.query("DELETE FROM sequence_enrollments WHERE sequence_id IN (SELECT id FROM follow_up_sequences WHERE name=$1)", [prefix]);
  await pool.query("DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM follow_up_sequences WHERE name=$1)", [prefix]);
  await pool.query("DELETE FROM follow_up_sequences WHERE name=$1", [prefix]);
  await pool.query("DELETE FROM tasks WHERE title=$1", [prefix]);
  await pool.query("DELETE FROM tickets WHERE subject=$1", [prefix]);
  const manualIds = (await pool.query("SELECT id FROM contacts WHERE email LIKE $1", [`${prefix}-create-%@example.test`])).rows.map(r => r.id);
  if (manualIds.length) {
    await pool.query("DELETE FROM inbound_request_work_links WHERE request_id IN (SELECT id FROM inbound_requests WHERE actor_id=$1)", [`${prefix}-admin`]);
    await pool.query("DELETE FROM tasks WHERE contact_id=ANY($1::int[])", [manualIds]);
    await pool.query("UPDATE contacts SET primary_source_event_id=NULL WHERE id=ANY($1::int[])", [manualIds]);
    for (const table of ["contact_source_events", "contact_identity_observations", "contact_provider_projections", "validation_intents", "contact_lead_scoring_jobs"]) {
      await pool.query(`DELETE FROM ${table} WHERE contact_id=ANY($1::int[])`, [manualIds]);
    }
    await pool.query("UPDATE inbound_requests SET contact_id=NULL WHERE actor_id=$1", [`${prefix}-admin`]);
  }
  await pool.query("DELETE FROM deals WHERE name=$1", [prefix]);
  await pool.query("DELETE FROM workflow_runs WHERE workflow_id IN (SELECT id FROM workflows WHERE name=$1)", [prefix]);
  await pool.query("DELETE FROM workflows WHERE name=$1", [prefix]);
  await pool.query("DELETE FROM inbox_items WHERE source_item_id LIKE $1", [`${prefix}-%`]);
  await pool.query("DELETE FROM contacts WHERE email LIKE $1", [`${prefix}-%@example.test`]);
  await pool.query("DELETE FROM user_sessions WHERE user_id LIKE $1", [`${prefix}-%`]);
  await pool.query("DELETE FROM users WHERE id LIKE $1", [`${prefix}-%`]);
  await pool.end();
}