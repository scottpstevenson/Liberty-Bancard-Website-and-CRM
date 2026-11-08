/**
 * Statement-upload queue capability certification (disposable database, isolated Redis, no provider transport).
 *
 * The production defect: no selected capability group owned the physical `statement-upload` queue, so the public
 * route had no producer and answered 503. This proves the narrow `statement-upload` capability selects exactly that
 * queue and nothing else, that a real BullMQ producer then accepts the job, that a broker fault after the file is
 * retained defers (never deletes or fails) the occurrence, and that the admin recovery re-drives the SAME occurrence
 * once a consumer exists, without a replacement submission, a second task/notification or any receipt change.
 *
 * The statement-upload worker is started by the real QueueManager but the physical queue is paused before any job is
 * added, so no statement is processed, no chain step runs and nothing is sent.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Statement-upload queue capability certification" });
applyCertificationProviderDenyBoundary({ fatal: true });
// Exactly what the published profile selects for this capability.
process.env.BACKGROUND_JOB_PROFILE = "selective:statement-upload";
process.env.APP_URL = "https://libertybancard.com";

const { pool } = await import("../../server/db");
const queueManagerModule = await import("../../server/services/queue-manager");
const { QUEUE_NAMES, getWorkerCapabilityStatus, getQueueManager, getQueueManagerProducers, shutdownQueueManager } = queueManagerModule;
const worker = await import("../../server/services/statement-command-worker");
const profile = await import("../../server/services/background-profile");
const { setupAuth } = await import("../../server/replit_integrations/auth/replitAuth");
const { csrfTokenEndpoint } = await import("../../server/middleware/csrf");
const { registerPublicRoutes } = await import("../../server/routes/public");
const { registerLeadOpsRoutes } = await import("../../server/routes/lead-ops");

let checks = 0;
const check = (value: unknown, message: string) => {
  assert(value, message);
  checks++;
  console.log(`✓ [SQC-${String(checks).padStart(2, "0")}] ${message}`);
};
const tag = randomUUID().slice(0, 8);

{
  const updated = await pool.query(`UPDATE outbound_pause_control SET state='paused', reason='statement queue certification', committed_at=NOW()`);
  if (updated.rowCount === 0) {
    await pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at)
      VALUES ('paused','statement queue certification',1,'sqc-cert',$1,NOW())`, [`sqc-cert-${randomUUID()}`]);
  }
  (await import("../../server/services/outbound-pause-authority")).invalidatePauseStateCache();
}

// ── Capability selection (no queue manager yet) ───────────────────────────
check(profile.getBackgroundProfile() === "selective" && JSON.stringify(profile.getSelectiveGroups()) === JSON.stringify(["statement-upload"]),
  "The narrow capability is the only selected group");
const before = getWorkerCapabilityStatus(QUEUE_NAMES.STATEMENT_UPLOAD);
check(before.selected === true && before.queueManagerReady === false && before.workerActive === false, "Before startup the queue is selected but no manager or worker exists (truthful, not an error)");
const others = Object.values(QUEUE_NAMES).filter((name) => name !== QUEUE_NAMES.STATEMENT_UPLOAD);
const selectedOthers = others.filter((name) => getWorkerCapabilityStatus(name).selected);
check(selectedOthers.length === 0, `No other queue is selected by the narrow capability (checked ${others.length})`);
{
  // Regression guard for the actual production defect: the published profile WITHOUT the narrow group never selected
  // the physical queue, so the route had no producer.
  const fs = await import("node:fs");
  const published = /BACKGROUND_JOB_PROFILE\s*=\s*"selective:([^"]+)"/.exec(fs.readFileSync(new URL("../../.replit", import.meta.url), "utf8"))?.[1]?.split(",") ?? [];
  const withoutNarrow = published.filter((group) => group !== "statement-upload") as any[];
  check(published.includes("statement-upload") && !profile.getQueuesForCapabilityGroups(withoutNarrow).includes(QUEUE_NAMES.STATEMENT_UPLOAD)
    && profile.getQueuesForCapabilityGroups(published as any[]).includes(QUEUE_NAMES.STATEMENT_UPLOAD),
    "The published groups select the statement-upload queue only because of the narrow group; without it the queue would be unowned (the original defect)");
}
check(getQueueManagerProducers() === null, "No producer exists before the queue manager starts");
const early = await worker.enqueueStatementUploadCommand(randomUUID());
check(early.ok === false && early.code === "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE", "Enqueueing with no producer reports a sanitized, specific code instead of throwing");

// ── Real queue manager under that profile ─────────────────────────────────
const qm = await getQueueManager();
const statementQueue = qm.getQueue(QUEUE_NAMES.STATEMENT_UPLOAD)!;
// Nothing may be consumed during this certification.
await statementQueue.pause();
try {
  check(Boolean(statementQueue) && qm.isQueueWorkerActive(QUEUE_NAMES.STATEMENT_UPLOAD), "The real queue manager creates the statement-upload queue and its worker");
  const created = others.filter((name) => qm.getQueue(name));
  check(created.length === 0, `It creates no other queue under this capability (checked ${others.length}; found ${created.join(",") || "none"})`);
  const activeWorkers = others.filter((name) => qm.isQueueWorkerActive(name));
  check(activeWorkers.length === 0, "It starts no other worker under this capability");
  const status = getWorkerCapabilityStatus(QUEUE_NAMES.STATEMENT_UPLOAD);
  check(status.queueManagerReady && status.workerActive && status.selected, "The capability status now reports a live consumer");
  check(await statementQueue.isPaused(), "The physical queue is paused for the rest of the certification: no statement is processed");

  // ── HTTP harness ────────────────────────────────────────────────────────
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(cookieParser());
  await setupAuth(app);
  app.get("/api/csrf-token", csrfTokenEndpoint);
  registerPublicRoutes(app);
  registerLeadOpsRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  let ipCounter = 40;
  let phoneSeq = 1;
  const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), Buffer.alloc(2048, 0x20)]);
  const upload = async (label: string) => {
    const form = new FormData();
    form.append("statementFile", new Blob([PDF], { type: "application/pdf" }), "statement.pdf");
    form.append("businessName", `Queue Cafe ${tag} ${label}`);
    form.append("contactName", "Quinn Queue");
    form.append("email", `sqc-${tag}-${label}@example.com`);
    form.append("mobile", `+1555${String(phoneSeq++ + Number.parseInt(tag, 16) % 1000 * 1000).padStart(7, "0").slice(-7)}`);
    const key = randomUUID();
    const response = await fetch(`${url}/api/public/statement-upload`, { method: "POST", body: form, headers: { "idempotency-key": key, "x-forwarded-for": `203.0.113.${ipCounter++}` } });
    return { status: response.status, body: await response.json() as any, key };
  };
  const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);
  const jobsFor = async (commandId: string) => (await statementQueue.getJobs(["waiting", "paused", "delayed", "active", "completed", "failed"]))
    .filter((job) => job.data?.commandId === commandId);

  try {
    // ── A queue that accepts the job ──────────────────────────────────────
    const queued = await upload("queued");
    check(queued.status === 202 && queued.body.statementProcessing === "queued" && /^[0-9A-F]{8}$/.test(queued.body.reference), "With a consumer selected, a valid upload is accepted as queued with its short reference");
    const queuedRequest = (await pool.query(`SELECT id, lifecycle_state, terminal_reason FROM inbound_requests WHERE idempotency_key=$1`, [queued.key])).rows[0];
    const queuedCommand = (await pool.query(`SELECT id, status FROM statement_upload_commands WHERE request_id=$1`, [queued.key])).rows[0];
    check(queuedRequest.lifecycle_state !== "failed" && !/STATEMENT_PROCESSING_DEFERRED/.test(queuedRequest.terminal_reason ?? ""), "A queued upload is not marked deferred or failed");
    const effects = Object.fromEntries((await pool.query(`SELECT effect_key, state, terminal_reason FROM inbound_request_effects WHERE request_id=$1`, [queuedRequest.id])).rows.map((r) => [r.effect_key, r]));
    check(effects.statement_review?.state === "ready" && effects.statement_review.terminal_reason === "DURABLE_STATEMENT_COMMAND_HANDOFF", "Statement processing is recorded as handed to the durable command");
    const jobs = await jobsFor(queuedCommand.id);
    check(jobs.length === 1 && jobs[0].name === "execute" && Object.keys(jobs[0].data).join() === "commandId", "Exactly one job exists and it carries only the command id (no file, name, contact or financial data in Redis)");
    check(await count(`SELECT count(*) n FROM inbound_request_work_links WHERE request_id=$1 AND work_type='task'`, [queuedRequest.id]) === 1
      && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [queuedRequest.id]) === 1, "A queued upload still has its one review task and one notification");

    // ── A broker fault after the file is retained ─────────────────────────
    const realAdd = statementQueue.add.bind(statementQueue);
    (statementQueue as any).add = async () => { throw new Error("injected broker fault with secret-looking detail redis://user:pw@host"); };
    let faulted: Awaited<ReturnType<typeof upload>>;
    try { faulted = await upload("faulted"); } finally { (statementQueue as any).add = realAdd; }
    check(faulted.status === 202 && faulted.body.statementProcessing === "deferred", "A broker fault after retention is a truthful deferred 202, not a 503");
    check(!JSON.stringify(faulted.body).includes("redis://") && !JSON.stringify(faulted.body).includes("injected"), "The merchant response carries no broker detail");
    const fReq = (await pool.query(`SELECT id, lifecycle_state, terminal_reason, protected_object_ref FROM inbound_requests WHERE idempotency_key=$1`, [faulted.key])).rows[0];
    check(fReq.lifecycle_state === "review_required" && fReq.terminal_reason === "STATEMENT_PROCESSING_DEFERRED:STATEMENT_QUEUE_ADD_FAILED", "The occurrence records the sanitized code STATEMENT_QUEUE_ADD_FAILED");
    check(!/redis|injected|pw@/.test(JSON.stringify((await pool.query(`SELECT * FROM inbound_request_effects WHERE request_id=$1`, [fReq.id])).rows)), "No broker detail is persisted on the request effects");
    const fObject = (await pool.query(`SELECT retention_state, validation_state, deleted_at FROM protected_objects WHERE object_ref=$1`, [fReq.protected_object_ref])).rows[0];
    check(fObject.retention_state === "active" && fObject.validation_state === "validated" && fObject.deleted_at === null, "A queue failure does not delete or invalidate the retained file");
    const fCommand = (await pool.query(`SELECT id, status, lease_token FROM statement_upload_commands WHERE request_id=$1`, [faulted.key])).rows[0];
    check(fCommand.status === "in_progress" && fCommand.lease_token === null, "The durable command stays in progress and unleased so a recovery tick can pick it up");
    check((await jobsFor(fCommand.id)).length === 0, "No job was created by the failed enqueue");

    // ── Authorized recovery of that same occurrence ───────────────────────
    const password = randomUUID();
    const hash = await bcrypt.hash(password, 4);
    const adminEmail = `${randomUUID()}@example.invalid`;
    await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'admin')`, [randomUUID(), adminEmail, hash]);
    const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, password }) });
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
    const csrfResponse = await fetch(`${url}/api/csrf-token`, { headers: { cookie: sessionCookie } });
    const csrfToken = (await csrfResponse.json() as any).token;
    const recover = () => fetch(`${url}/api/lead-ops/inbound-requests/${fReq.id}/statement-recovery`, { method: "POST", headers: { cookie: sessionCookie, "x-csrf-token": csrfToken } });

    const snapshot = async () => ({
      requests: await count(`SELECT count(*) n FROM inbound_requests`),
      contacts: await count(`SELECT count(*) n FROM contacts`),
      objects: await count(`SELECT count(*) n FROM protected_objects`),
      commands: await count(`SELECT count(*) n FROM statement_upload_commands`),
      tasks: await count(`SELECT count(*) n FROM tasks`),
      notifications: await count(`SELECT count(*) n FROM notifications`),
      acks: await count(`SELECT count(*) n FROM inbound_acknowledgements`),
      ackEffect: (await pool.query(`SELECT state, terminal_reason, updated_at FROM inbound_request_effects WHERE request_id=$1 AND effect_key='transactional_ack'`, [fReq.id])).rows,
    });
    const preRecovery = await snapshot();
    const first = await recover();
    const firstBody = await first.json() as any;
    check(first.status === 200 && firstBody.outcome === "recovered" && firstBody.queued === true && firstBody.reference === faulted.body.reference,
      "Recovery re-drives the same occurrence into the real queue once a consumer exists");
    const afterFirst = await jobsFor(fCommand.id);
    check(afterFirst.length === 1 && Object.keys(afterFirst[0].data).join() === "commandId", "Recovery created exactly one job for that command");
    const postRecovery = await snapshot();
    check(JSON.stringify(preRecovery) === JSON.stringify(postRecovery), "Recovery created no replacement submission, contact, object, command, task, notification or receipt, and left the receipt effect byte-identical");
    const effectsAfter = Object.fromEntries((await pool.query(`SELECT effect_key, state, terminal_reason FROM inbound_request_effects WHERE request_id=$1`, [fReq.id])).rows.map((r) => [r.effect_key, r]));
    check(effectsAfter.statement_review.state === "ready", "The statement effect moves from held to ready only through the real handoff");
    const notice = (await pool.query(`SELECT metadata FROM notifications WHERE inbound_request_id=$1`, [fReq.id])).rows[0];
    check(notice.metadata.processingState === "queued", "The single notification now says the statement is queued (updated in place, not duplicated)");
    const reqAfter = (await pool.query(`SELECT lifecycle_state, terminal_reason FROM inbound_requests WHERE id=$1`, [fReq.id])).rows[0];
    check(!/STATEMENT_PROCESSING_DEFERRED/.test(reqAfter.terminal_reason ?? "") && reqAfter.lifecycle_state !== "failed", "The request no longer reports a deferral");
    const second = await recover();
    const secondBody = await second.json() as any;
    check(second.status === 200 && secondBody.outcome === "recovered", "Running recovery again is harmless");
    const finalSnapshot = await snapshot();
    check(JSON.stringify({ ...finalSnapshot, ackEffect: null }) === JSON.stringify({ ...postRecovery, ackEffect: null }) && JSON.stringify(finalSnapshot.ackEffect) === JSON.stringify(preRecovery.ackEffect),
      "A second run changes no row counts and still does not touch the receipt");
    check(await count(`SELECT count(*) n FROM audit_logs WHERE action='statement_occurrence_recovered' AND details->>'reference'=$1 AND details->>'receiptTouched'='false'`, [faulted.body.reference]) === 2, "Both runs are audited with receiptTouched=false");
  } finally {
    server.close();
  }
} finally {
  await statementQueue.obliterate({ force: true }).catch(() => {});
  await shutdownQueueManager().catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\nStatement-upload queue capability certification: ${checks} checks passed`);
process.exit(0);
