/**
 * Website intake and CRM handoff certification (disposable database, deny-by-default egress, no provider transport).
 *
 * Drives the REAL public statement-upload route with real multipart bodies (PDF, JPG, PNG, missing, wrong type,
 * oversize) against a process that has NO queue consumer, which is exactly the production failure: the file must be
 * validated before anything is created, retained when it is valid, and the occurrence must still produce the durable
 * internal review obligation (one task with the SLA due date, one notification) and a truthful 202 with a short
 * reference. Then proves the operator side: authenticated lookup by reference, role matrix, notification visibility,
 * acknowledgement gating and per-class cutoffs, and that the operator recovery refuses to invent a queue.
 *
 * It never sends mail, never calls a provider, never enables a capability beyond its own disposable database, and
 * keeps the global outbound pause in force for the entire run.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Website intake and CRM handoff certification" });
applyCertificationProviderDenyBoundary({ fatal: true });
process.env.APP_URL = "https://libertybancard.com";

const { pool } = await import("../../server/db");
const { setupAuth } = await import("../../server/replit_integrations/auth/replitAuth");
const { csrfTokenEndpoint } = await import("../../server/middleware/csrf");
const { registerPublicRoutes } = await import("../../server/routes/public");
const { registerLeadOpsRoutes } = await import("../../server/routes/lead-ops");
const { registerInboundAcknowledgementRoutes } = await import("../../server/routes/inbound-acknowledgements");
const authority = await import("../../server/services/inbound-request-authority");
const ack = await import("../../server/services/inbound-acknowledgement");
const file = await import("../../server/services/statement-upload-file");
const profile = await import("../../server/services/background-profile");
const notificationAuthority = await import("../../server/services/notification-authority");
const review = await import("../../server/services/statement-review-notification");

let checks = 0;
const check = (value: unknown, message: string) => {
  assert(value, message);
  checks++;
  console.log(`✓ [WIH-${String(checks).padStart(2, "0")}] ${message}`);
};
const tag = randomUUID().slice(0, 8);

// Real pause state: the global outbound pause stays in force for the whole certification.
{
  const updated = await pool.query(`UPDATE outbound_pause_control SET state='paused', reason='intake handoff certification', committed_at=NOW()`);
  if (updated.rowCount === 0) {
    await pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at)
      VALUES ('paused','intake handoff certification',1,'wih-cert',$1,NOW())`, [`wih-cert-${randomUUID()}`]);
  }
  (await import("../../server/services/outbound-pause-authority")).invalidatePauseStateCache();
}

// ── Real fixture bytes ──────────────────────────────────────────────────────
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), Buffer.alloc(2048, 0x20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(2048, 0x11), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 0x22)]);
const OVERSIZE = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(file.STATEMENT_MAX_BYTES + 1, 0x20)]);
const NOT_A_STATEMENT = Buffer.from("MZ this is a program, not a statement ".repeat(20));

// ── Pure contracts ──────────────────────────────────────────────────────────
{
  const id = randomUUID();
  check(authority.inboundShortRef(id) === ack.ackReference(id), "The short reference on the review surface equals the reference printed in the receipt email");
  check(/^[0-9A-F]{8}$/.test(authority.inboundShortRef(id)), "Short reference is eight upper-case hex characters");
  check(authority.parseInboundShortRef("269B66AF") === "269b66af" && authority.parseInboundShortRef(" 269B ") === "269b", "A reference or a prefix of at least four characters is accepted in any case");
  check(authority.parseInboundShortRef("zz") === null && authority.parseInboundShortRef("269") === null && authority.parseInboundShortRef("269B66AFF") === null && authority.parseInboundShortRef("") === null && authority.parseInboundShortRef(null) === null,
    "Malformed references are refused rather than matched loosely");

  check(file.inspectStatementFile({ buffer: PDF }).ok && (file.inspectStatementFile({ buffer: PDF }) as any).mimeType === "application/pdf", "A PDF is recognised from its bytes");
  check((file.inspectStatementFile({ buffer: JPG }) as any).mimeType === "image/jpeg", "A JPG is recorded as image/jpeg, never relabelled as a PDF");
  check((file.inspectStatementFile({ buffer: PNG }) as any).mimeType === "image/png", "A PNG is recorded as image/png");
  check((file.inspectStatementFile({ buffer: Buffer.alloc(0) }) as any).code === "STATEMENT_FILE_REQUIRED", "An empty file is rejected as missing");
  check((file.inspectStatementFile(undefined) as any).status === 400, "No file at all is a 400");
  check((file.inspectStatementFile({ buffer: NOT_A_STATEMENT }) as any).status === 415, "Bytes that are not a statement are a 415 whatever the filename or declared type says");
  check((file.inspectStatementFile({ buffer: OVERSIZE }) as any).status === 413, "Over the 10 MB ceiling is a 413");
  check(file.STATEMENT_MAX_BYTES === 10 * 1024 * 1024, "The 10 MB ceiling is unchanged");

  const groups = profile.WORKER_CAPABILITY_GROUPS as Record<string, readonly string[]>;
  check(JSON.stringify(groups["statement-upload"]) === JSON.stringify(["statement-upload"]), "The narrow capability owns exactly the statement-upload queue");
  check(groups["critical-commands"].includes("statement-upload") && groups["critical-commands"].length > 1, "The broader critical-commands group is unchanged and still contains it");
  const text = (await import("node:fs")).readFileSync(new URL("../../.replit", import.meta.url), "utf8");
  const configured = /BACKGROUND_JOB_PROFILE\s*=\s*"selective:([^"]+)"/.exec(text)?.[1]?.split(",") ?? [];
  check(configured.includes("statement-upload") && !configured.includes("critical-commands") && !configured.includes("ghl-integration"),
    "The published profile selects the narrow capability, not critical-commands or the full GHL integration");

  const open = { enabled: true, eligibleFrom: "2026-10-01T00:00:00Z", classEligibleFrom: { sales_request: "2026-10-01T00:00:00Z", support_request: "2026-11-05T00:00:00Z" },
    expiresAt: null, sourceClasses: ["sales_request", "support_request"], activatedBy: "a", activatedAt: "2026-10-01T00:00:00Z" };
  const started = new Date("2026-09-01T00:00:00Z");
  const received = new Date("2026-11-01T00:00:00Z");
  check(ack.ackCapabilityAllows(open as any, { sourceClass: "sales_request", sourceReceivedAt: received, ownerStartedAt: started, now: new Date("2026-11-07T00:00:00Z") }).ok === true,
    "A class enabled earlier keeps its own, earlier cutoff");
  check((ack.ackCapabilityAllows(open as any, { sourceClass: "support_request", sourceReceivedAt: received, ownerStartedAt: started, now: new Date("2026-11-07T00:00:00Z") }) as any).reason === "request_before_eligibility_window",
    "A class enabled later does not receive catch-up for earlier requests");
}

// ── Test app: the real public, Lead Ops and acknowledgement routes, real local sign-in ──────────
const app = express();
app.set("trust proxy", true); // each request carries its own forwarded address, so the production limiter is exercised, not bypassed
app.use(express.json());
app.use(cookieParser());
await setupAuth(app); // installs session auth and the same CSRF guard the dashboard uses
app.get("/api/csrf-token", csrfTokenEndpoint);
registerPublicRoutes(app);
registerLeadOpsRoutes(app);
registerInboundAcknowledgementRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const url = `http://127.0.0.1:${(server.address() as any).port}`;
let ipCounter = 10;
let phoneSeq = 1;
const phones = new Map<string, string>();
const callers = new Map<string, string>();
const nextIp = () => `203.0.113.${ipCounter++}`;

async function upload(input: { bytes?: Buffer; type?: string; name?: string; key?: string | null; email?: string; business?: string; extra?: Record<string, string> }) {
  const form = new FormData();
  if (input.bytes) form.append("statementFile", new Blob([input.bytes], { type: input.type ?? "application/pdf" }), input.name ?? "statement.pdf");
  form.append("businessName", input.business ?? `Handoff Cafe ${tag}`);
  form.append("contactName", "Ada Handoff");
  const email = input.email ?? `wih-${tag}-${randomUUID().slice(0, 6)}@example.com`;
  form.append("email", email);
  // The contacts table requires a phone; the real form always sends one. Stable per mailbox (so a replay is the same
  // payload) and unique across mailboxes (so fixtures never merge).
  if (!phones.has(email)) phones.set(email, `+1555${String(phoneSeq++ + Number.parseInt(tag, 16) % 1000 * 1000).padStart(7, "0").slice(-7)}`);
  form.append("mobile", phones.get(email)!);
  for (const [k, v] of Object.entries(input.extra ?? {})) form.append(k, v);
  // The caller scope is derived from the client address, so one Idempotency-Key is one caller: a replay or retry
  // comes from the same address, while distinct submissions come from distinct addresses (the limiter stays on).
  const key = input.key === null ? null : input.key ?? randomUUID();
  const headers: Record<string, string> = { "x-forwarded-for": key ? (callers.get(key) ?? callers.set(key, nextIp()).get(key)!) : nextIp() };
  if (key) headers["idempotency-key"] = key;
  const response = await fetch(`${url}/api/public/statement-upload`, { method: "POST", body: form, headers });
  let body: any = null;
  try { body = await response.json(); } catch { /* non-JSON */ }
  return { status: response.status, body };
}
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);
const baseline = async () => ({
  requests: await count(`SELECT count(*) n FROM inbound_requests`),
  contacts: await count(`SELECT count(*) n FROM contacts`),
  objects: await count(`SELECT count(*) n FROM protected_objects`),
  commands: await count(`SELECT count(*) n FROM statement_upload_commands`),
  tasks: await count(`SELECT count(*) n FROM tasks`),
  notifications: await count(`SELECT count(*) n FROM notifications`),
});

try {
  // ── R2/R3: validate before any mutation ───────────────────────────────────
  {
    const before = await baseline();
    const missing = await upload({});
    check(missing.status === 400 && missing.body?.error === "STATEMENT_FILE_REQUIRED", "A request with no file is a 400 STATEMENT_FILE_REQUIRED");
    const wrongType = await upload({ bytes: NOT_A_STATEMENT, type: "application/pdf", name: "statement.pdf" });
    check(wrongType.status === 415 && wrongType.body?.error === "STATEMENT_FILE_TYPE_UNSUPPORTED", "A non-statement posing as statement.pdf is a 415");
    const oversize = await upload({ bytes: OVERSIZE });
    check(oversize.status === 413 && oversize.body?.error === "STATEMENT_FILE_TOO_LARGE", "An oversize file is a 413 STATEMENT_FILE_TOO_LARGE");
    const noKey = await upload({ bytes: PDF, key: null });
    check(noKey.status === 400 && noKey.body?.error === "MISSING_IDEMPOTENCY_KEY", "A missing Idempotency-Key is a 400");
    const badKey = await upload({ bytes: PDF, key: "not-a-uuid" });
    check(badKey.status === 400 && badKey.body?.error === "INVALID_IDEMPOTENCY_KEY", "A malformed Idempotency-Key is a 400");
    const after = await baseline();
    check(JSON.stringify(before) === JSON.stringify(after), "Every rejected upload left no request, contact, retained object, command, task or notification behind");
    const leaked = JSON.stringify([missing.body, wrongType.body, oversize.body]);
    check(!/stack|\/home\/|node_modules|ECONN|postgres/i.test(leaked), "Rejection bodies expose no stack trace, path or infrastructure detail");
  }

  // ── R1/R2/R3: accepted uploads with no queue consumer (the production failure) ─────────────
  const accepted: Array<{ kind: string; type: string; name: string; bytes: Buffer; mime: string; key: string; email: string; business: string; body?: any }> = [
    { kind: "PDF", type: "application/pdf", name: "May statement.pdf", bytes: PDF, mime: "application/pdf" },
    { kind: "JPG", type: "image/jpeg", name: "photo.jpg", bytes: JPG, mime: "image/jpeg" },
    { kind: "PNG", type: "image/png", name: "scan.png", bytes: PNG, mime: "image/png" },
  ].map((f, i) => ({ ...f, key: randomUUID(), email: `wih-${tag}-${i}@example.com`, business: `Handoff Cafe ${tag} ${f.kind}` }));
  for (const f of accepted) {
    const response = await upload({ bytes: f.bytes, type: f.type, name: f.name, key: f.key, email: f.email, business: f.business });
    f.body = response.body;
    check(response.status === 202 && response.body?.success === true, `${f.kind}: a valid statement is accepted with 202, not a 503`);
    check(/^[0-9A-F]{8}$/.test(response.body?.reference ?? "") && response.body?.statementProcessing === "deferred",
      `${f.kind}: the response carries the short reference and says processing is deferred, not complete`);
    check(!/\$|\bamount\b|\bsavings\b|\bapproved\b/i.test(JSON.stringify(response.body)), `${f.kind}: the response makes no financial or approval claim`);

    const request = (await pool.query(`SELECT * FROM inbound_requests WHERE idempotency_key=$1`, [f.key])).rows[0];
    check(request && request.id === response.body.requestReceipt && authority.inboundShortRef(request.id) === response.body.reference, `${f.kind}: the reference maps to exactly the stored occurrence`);
    check(request.lifecycle_state === "review_required" && /^STATEMENT_PROCESSING_DEFERRED:STATEMENT_QUEUE_PRODUCER_UNAVAILABLE$/.test(request.terminal_reason ?? ""),
      `${f.kind}: the occurrence is marked review_required with the sanitized queue reason, not failed`);
    const object = (await pool.query(`SELECT mime_type, size_bytes, validation_state, retention_state, tenant_scope FROM protected_objects WHERE object_ref=$1`, [request.protected_object_ref])).rows[0];
    check(object && object.mime_type === f.mime && object.size_bytes === f.bytes.length && object.validation_state === "validated" && object.retention_state === "active"
      && object.tenant_scope === `contact:${request.contact_id}`, `${f.kind}: the file is retained, validated and bound to its contact with the real media type ${f.mime}`);
    const command = (await pool.query(`SELECT status, context->>'protectedObjectRef' ref, context->>'inboundRequestId' req FROM statement_upload_commands WHERE request_id=$1`, [f.key])).rows[0];
    check(command?.status === "in_progress" && command.ref === request.protected_object_ref && command.req === request.id,
      `${f.kind}: the durable command stays in progress, unleased, bound to the retained file`);
    const effects = Object.fromEntries((await pool.query(`SELECT effect_key, state, terminal_reason FROM inbound_request_effects WHERE request_id=$1`, [request.id])).rows.map((r) => [r.effect_key, r]));
    check(effects.statement_review?.state === "held" && effects.statement_review.terminal_reason === "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE",
      `${f.kind}: statement processing is held with the sanitized reason`);
    check(effects.sales_work?.state === "sent" && effects.sales_sla?.state === "sent", `${f.kind}: the review task and its SLA are durable even though processing is deferred`);
    check(effects.transactional_ack && effects.transactional_ack.state !== "sent", `${f.kind}: the receipt is not sent by the handoff itself`);
    const task = (await pool.query(`SELECT t.* FROM inbound_request_work_links l JOIN tasks t ON t.id=l.task_id WHERE l.request_id=$1 AND l.work_type='task'`, [request.id])).rows;
    check(task.length === 1 && task[0].title === `Review statement — ${f.business}` && task[0].due_date, `${f.kind}: exactly one task named for the business exists with a due date`);
    check(!/\$|statement.?pdf|\.jpg|\.png|May statement/i.test(`${task[0].title} ${task[0].description}`), `${f.kind}: the task carries no file name or financial content`);
    const notices = (await pool.query(`SELECT metadata, message FROM notifications WHERE inbound_request_id=$1`, [request.id])).rows;
    check(notices.length === 1 && notices[0].metadata.link === `/dashboard/lead-ops?tab=pipeline&ref=${response.body.reference}` && notices[0].metadata.processingState === "needs_attention"
      && notices[0].message.includes(review.STATEMENT_NEEDS_ATTENTION_LABEL), `${f.kind}: exactly one internal notification says "Processing needs attention" and links to the exact request`);
    check(notices[0].metadata.contactId === undefined && notices[0].metadata.dealId === undefined && !/\$/.test(notices[0].message), `${f.kind}: the notification has no typed target and no financial content`);
    check((await ack.ackInternalReviewGate(request.id)).ok === true, `${f.kind}: the receipt gate is satisfied only because the file is retained and the review work is durable`);
  }

  // Replay and conflict
  {
    const first = accepted[0];
    const before = await baseline();
    const replay = await upload({ bytes: PDF, name: "May statement.pdf", key: first.key, email: first.email, business: first.business });
    check(replay.status === 200 && replay.body?.reference === first.body.reference && replay.body?.statementProcessing === "deferred", "Replaying the same upload returns the same reference and the same truthful state");
    const after = await baseline();
    check(JSON.stringify(before) === JSON.stringify(after), "A replay creates no second request, task, notification, object or command");
    const conflict = await upload({ bytes: JPG, type: "image/jpeg", name: "photo.jpg", key: first.key, email: first.email, business: first.business });
    check(conflict.status === 409, "The same key with different bytes is a conflict, not a second submission");
  }

  // Concurrency: the same key twice at once yields one occurrence
  {
    const key = randomUUID();
    const email = `wih-${tag}-race@example.com`;
    const results = await Promise.all([upload({ bytes: PNG, type: "image/png", name: "a.png", key, email, business: `Race Cafe ${tag}` }), upload({ bytes: PNG, type: "image/png", name: "a.png", key, email, business: `Race Cafe ${tag}` })]);
    check(results.every((r) => [200, 202].includes(r.status)), "Two simultaneous submissions with one key both answer successfully");
    check(await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key=$1`, [key]) === 1 && await count(`SELECT count(*) n FROM statement_upload_commands WHERE request_id=$1`, [key]) === 1,
      "They share one occurrence and one command");
    const requestId = (await pool.query(`SELECT id FROM inbound_requests WHERE idempotency_key=$1`, [key])).rows[0].id;
    check(await count(`SELECT count(*) n FROM inbound_request_work_links WHERE request_id=$1 AND work_type='task'`, [requestId]) === 1
      && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [requestId]) === 1, "The race still yields exactly one task and one notification");
  }

  // ── Sign-in fixtures and role matrix ──────────────────────────────────────
  const password = randomUUID(), hash = await bcrypt.hash(password, 4);
  const sessions: Record<string, { cookie: string; id: string }> = {};
  for (const role of ["admin", "manager", "agent"]) {
    const email = `${randomUUID()}@example.invalid`, id = randomUUID();
    await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, [id, email, hash, role]);
    const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200, `Real local ${role} sign-in must succeed`);
    sessions[role] = { id, cookie: login.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") };
  }
  const csrf: Record<string, { token: string; cookie: string }> = {};
  for (const role of Object.keys(sessions)) {
    const response = await fetch(`${url}/api/csrf-token`, { headers: { cookie: sessions[role].cookie } });
    csrf[role] = { token: (await response.json() as any).token, cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") };
  }
  // Mutations carry the session AND the CSRF token, exactly like the dashboard; `withCsrf=false` proves the guard still bites.
  const call = (role: string | null, method: string, path: string, withCsrf = true) => {
    const headers: Record<string, string> = {};
    if (role) {
      // One csrf_token cookie only: the one issued with the token this request presents.
      const sessionOnly = sessions[role].cookie.split("; ").filter((c) => !c.startsWith("csrf_token=")).join("; ");
      headers.cookie = csrf[role].cookie ? [sessionOnly, csrf[role].cookie].join("; ") : sessions[role].cookie;
      if (method !== "GET" && withCsrf) headers["x-csrf-token"] = csrf[role].token;
    }
    return fetch(url + path, { method, headers });
  };
  const target = accepted[0];
  const ref = target.body.reference as string;
  const receipt = target.body.requestReceipt as string;

  {
    const listPath = `/api/lead-ops/inbound-requests?ref=${ref}`;
    check((await call(null, "GET", listPath)).status === 401, "Unauthenticated callers cannot list inbound requests");
    check((await call("agent", "GET", listPath)).status === 403, "Agents cannot list inbound requests (they see permitted work in Tasks)");
    for (const role of ["admin", "manager"]) {
      const response = await call(role, "GET", listPath);
      const rows = await response.json() as any[];
      check(response.status === 200 && rows.length === 1 && rows[0].shortRef === ref && rows[0].businessName === target.business, `${role}: the short reference finds exactly that request with its business name`);
      check(rows[0].processingNeedsAttention === true && rows[0].work?.title === `Review statement — ${target.business}` && typeof rows[0].work.taskId === "number",
        `${role}: the row shows "Processing needs attention" and the exact task title`);
      const receiptEffect = rows[0].effects.find((e: any) => e.effectKey === "transactional_ack");
      check(receiptEffect && receiptEffect.state !== "sent" && (rows[0].receipt === null || typeof rows[0].receipt.state === "string"),
        `${role}: the receipt is reported separately from processing and is not claimed as sent`);
    }
    const prefix = await (await call("admin", "GET", `/api/lead-ops/inbound-requests?ref=${ref.slice(0, 4).toLowerCase()}`)).json() as any[];
    check(prefix.some((r) => r.shortRef === ref), "A prefix of the reference, in lower case, still finds the request");
    const invalid = await call("admin", "GET", "/api/lead-ops/inbound-requests?ref=zzzz");
    check(invalid.status === 400 && (await invalid.json() as any).error === "INVALID_REFERENCE", "A malformed reference is a 400 INVALID_REFERENCE, not an empty list");
    const injection = await call("admin", "GET", `/api/lead-ops/inbound-requests?ref=${encodeURIComponent("' OR 1=1 --")}`);
    check(injection.status === 400, "A reference containing SQL is refused");
    check((await call("agent", "GET", "/api/lead-ops/inbound-requests/summary")).status === 403 && (await call(null, "GET", "/api/lead-ops/inbound-requests/summary")).status === 401, "The summary is not available to agents or anonymous callers");
    const summaryResponse = await call("manager", "GET", "/api/lead-ops/inbound-requests/summary");
    const summary = await summaryResponse.json() as any;
    check(summaryResponse.status === 200 && summary.statementAttention >= 3, "Managers see the statements needing attention in the website-requests summary");
    check(!/\$|file_name|fileName|statement\.pdf/i.test(JSON.stringify(summary)), "The summary carries no file names or financial content");
  }

  // ── Notification visibility (authority, not a parallel path) ──────────────
  {
    const visible = async (role: string) => ((await notificationAuthority.listActorNotifications({ userId: sessions[role].id, limit: 200, offset: 0 })).data as any[])
      .some((n: any) => n.metadata?.shortRef === ref || n.message?.includes(ref));
    check(await visible("admin") && await visible("manager"), "Admins and managers see the statement notification in their own notification list");
    check(!(await visible("agent")), "Agents do not see the management notification");
    const adminList = (await notificationAuthority.listActorNotifications({ userId: sessions.admin.id, limit: 200, offset: 0 })).data as any[];
    const mine = adminList.find((n: any) => n.metadata?.shortRef === ref);
    check(mine?.target?.state === "available" && mine.target.url === `/dashboard/lead-ops?tab=pipeline&ref=${ref}`, "The notification opens the exact request, not a retired deal URL");
  }

  // ── R5: acknowledgement semantics ────────────────────────────────────────
  {
    const before = await ack.getAckCapability();
    const first = await ack.setAckCapability({ enabled: true, sourceClasses: ["sales_request"], actor: `wih-${tag}` });
    const salesCutoff = first.classEligibleFrom!.sales_request;
    await new Promise((r) => setTimeout(r, 30));
    const second = await ack.setAckCapability({ enabled: true, sourceClasses: ["sales_request", "support_request"], actor: `wih-${tag}` });
    check(second.classEligibleFrom!.sales_request === salesCutoff, "Saving again with the same request type does not move its original cutoff");
    check(Date.parse(second.classEligibleFrom!.support_request) > Date.parse(salesCutoff), "A newly enabled request type starts at its own, later cutoff (no catch-up)");
    const third = await ack.setAckCapability({ enabled: true, sourceClasses: ["sales_request", "support_request"], actor: `wih-${tag}` });
    check(JSON.stringify(third.classEligibleFrom) === JSON.stringify(second.classEligibleFrom), "A repeat save with no change leaves every cutoff untouched");
    const removed = await ack.setAckCapability({ enabled: true, sourceClasses: ["support_request"], actor: `wih-${tag}` });
    check(!removed.sourceClasses.includes("sales_request") && removed.classEligibleFrom!.support_request === second.classEligibleFrom!.support_request, "Removing a type drops only that type");
    await ack.setAckCapability({ enabled: false, actor: `wih-${tag}` });
    const reopened = await ack.setAckCapability({ enabled: true, sourceClasses: ["support_request"], actor: `wih-${tag}` });
    check(Date.parse(reopened.classEligibleFrom!.support_request) >= Date.parse(second.classEligibleFrom!.support_request), "Closing then reopening grants no backdated window");
    if (before.enabled) await ack.setAckCapability({ enabled: true, sourceClasses: before.sourceClasses, actor: `wih-${tag}-restore` });
    else await ack.setAckCapability({ enabled: false, actor: `wih-${tag}-restore` });
    check(!(await ack.getAckCapability()).enabled === !before.enabled, "The acknowledgement capability is returned to the state the run found");

    // The gate itself: no retained file, or review work not durable, blocks the receipt.
    const claimed = await authority.claimInboundRequest({
      idempotencyKey: randomUUID(), sourceCategory: "website_form", sourceType: "statement_upload", callerScope: `wih-${tag}`,
      actorType: "public", requestFingerprint: createHash("sha256").update(randomUUID()).digest("hex"), payload: {},
    } as any);
    assert(claimed.outcome === "claimed", "Gate fixture occurrence must be claimed");
    const unretained = (claimed as any).request.id as string;
    check((await ack.ackInternalReviewGate(unretained) as any).reason === "statement_not_retained", "A statement receipt is blocked until the file is retained");
    const stuck = (await pool.query(`SELECT id FROM inbound_requests WHERE idempotency_key=$1`, [accepted[1].key])).rows[0].id;
    await pool.query(`UPDATE inbound_request_effects SET state='held' WHERE request_id=$1 AND effect_key='sales_work'`, [stuck]);
    check((await ack.ackInternalReviewGate(stuck) as any).reason === "internal_review_not_durable", "A receipt is blocked while the review work is not durable");
    await pool.query(`UPDATE inbound_request_effects SET state='sent' WHERE request_id=$1 AND effect_key='sales_work'`, [stuck]);
    check((await ack.ackInternalReviewGate(stuck)).ok === true, "The receipt gate opens again once the review work is durable");
  }

  // ── R2/R4: operator recovery refuses to invent a queue and never touches the receipt ──────
  {
    const snapshot = async () => ({
      ...(await baseline()),
      ack: (await pool.query(`SELECT effect_key,state,updated_at FROM inbound_request_effects WHERE request_id=$1 AND effect_key='transactional_ack'`, [receipt])).rows,
      ackRows: await count(`SELECT count(*) n FROM inbound_acknowledgements WHERE request_id=$1`, [receipt]),
    });
    const path = `/api/lead-ops/inbound-requests/${receipt}/statement-recovery`;
    check((await call(null, "POST", path)).status === 401, "Recovery requires sign-in");
    check((await call("agent", "POST", path)).status === 403 && (await call("manager", "POST", path)).status === 403, "Recovery is admin-only: managers and agents are refused");
    check((await call("admin", "POST", path, false)).status === 403, "Recovery without the CSRF token is refused even for an admin");
    check((await call("admin", "POST", `/api/lead-ops/inbound-requests/not-a-uuid/statement-recovery`)).status === 404, "A non-receipt identifier is a 404");
    check((await call("admin", "POST", `/api/lead-ops/inbound-requests/${randomUUID()}/statement-recovery`)).status === 404, "An unknown request is a 404");
    const before = await snapshot();
    const response = await call("admin", "POST", path);
    const result = await response.json() as any;
    check(response.status === 200 && result.outcome === "recovered" && result.reference === ref && result.queued === false && result.queueCode === "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE" && result.lifecycleState === "review_required",
      "With no consumer selected, recovery says so truthfully (queued=false with the reason) instead of reporting success");
    const after = await snapshot();
    check(JSON.stringify(before) === JSON.stringify(after), "Recovery created no replacement submission, contact, task, notification or object, and left the receipt untouched");
    const again = await (await call("admin", "POST", path)).json() as any;
    check(again.outcome === "recovered" && again.queued === false, "Repeating recovery is harmless");
    check(await count(`SELECT count(*) n FROM audit_logs WHERE action='statement_occurrence_recovered' AND details->>'reference'=$1 AND details->>'receiptTouched'='false' AND details->>'replacementSubmissionCreated'='false'`, [ref]) >= 1,
      "Each recovery is audited with receiptTouched=false and replacementSubmissionCreated=false");
    check(await count(`SELECT count(*) n FROM statement_upload_commands WHERE request_id=$1 AND status='in_progress'`, [target.key]) === 1, "The command is still the same single in-progress command");
  }

  // ── R6: preview returns the sender, reply-to and both examples ───────────
  {
    check((await call("agent", "GET", "/api/admin/inbound-acknowledgements/preview")).status === 403, "Agents cannot open the receipt preview");
    const response = await call("manager", "GET", "/api/admin/inbound-acknowledgements/preview");
    const body = await response.json() as any;
    const items: any[] = body.previews ?? [];
    check(response.status === 200 && items.length >= 2, "Managers can open the receipt preview with more than one example");
    check(items.every((i) => i.sender?.address && i.replyTo && i.subject && i.html), "Every example shows its subject, sender and reply-to");
    check(items.some((i) => /statement/i.test(`${i.variant} ${i.sourceType}`)), "A statement-upload example is included alongside the estimate example");
    check(items.every((i) => (i.html.match(/https:\/\/libertybancard\.com\/logo-blue\.png/g) ?? []).length === 1), "The delivered logo URL is the one public logo, once per example");
  }
} finally {
  server.close();
  await pool.end().catch(() => {});
}

console.log(`\nWebsite intake and CRM handoff certification: ${checks} checks passed`);
process.exit(0);
