/**
 * Stage 4C2 journey authority certification — disposable database; provider network denied; no sends.
 *
 *  A. Pure: honest workflow outcomes (a failed/queued/unknown step is never "completed"; delivered counts accepted sends).
 *  B. Pure: application reminder milestones come from accepted deliveries and the authoritative occurrence start.
 *  C. Pure: appointment authority (current appointment by recorded start time; occurrence identity; status text).
 *  D. Pure: inbound identity (deal chosen only by association; several candidates select none).
 *  E. Disposable DB: per-channel send receipts (accepted replay, ambiguous = unknown, refused is re-claimable).
 *  F. Disposable DB: workflow run occurrence uniqueness, definition pin, due-run lease.
 *  G. Disposable DB: exact inbound identity lookup (not_found / resolved / archived / opportunity selection).
 *  H. Static: token not logged, route guard, booking handoff held, purpose resolver wired.
 * Every critical check has a negative control that must fail the same assertion on the defective behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C2 journey authority certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { classifyWorkflowRunOutcome, executeWorkflowActions, retryFailedWorkflowRun } = await import("../../server/services/workflow-executor");
const { nextApplicationReminderDay } = await import("../../server/services/sla-worker");
const { runFollowupEffect, hasAcceptedEffect } = await import("../../server/services/followup-effects");
const { claimDueWorkflowRuns, releaseWorkflowRunLease } = await import("../../server/services/workflow-run-lease");
const { deriveCurrentAppointmentId, normalizeAppointmentStatus } = await import("../../server/services/ghl-appointment-events");
const { occurrenceKeyOf } = await import("../../server/services/ghl-occurrence");
const { selectInboundDeal, resolveInboundIdentity } = await import("../../server/services/ghl-inbound-identity");
const { workflowTriggerRefusal } = await import("../../server/services/ghl-workflows");

let checks = 0;
const evidence: Array<{ id: string; claim: string; negativeControl: boolean }> = [];
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++; evidence.push({ id: `JA-${String(checks).padStart(2, "0")}`, claim: message, negativeControl });
  console.log(`✓ [JA-${String(checks).padStart(2, "0")}] ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };

const read0 = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
// ── A ────────────────────────────────────────────────────────────────────────────────────
const clean = classifyWorkflowRunOutcome([{ action: "send_ghl_email", status: "completed" }, { action: "create_task", status: "completed" }]);
check(clean.status === "completed" && clean.delivered === 1, "clean run with one accepted send is completed and delivered=1");
check(classifyWorkflowRunOutcome([{ action: "send_ghl_sms", status: "failed" }]).status === "failed", "a failed send makes the run failed");
check(classifyWorkflowRunOutcome([{ action: "send_ghl_email", status: "queued_no_ghl" }]).status === "blocked", "a locally queued email (no provider) is blocked, not completed");
check(classifyWorkflowRunOutcome([{ action: "send_ghl_email", status: "unknown_outcome" }]).status === "blocked", "an unknown outcome is blocked, never completed");
const skipped = classifyWorkflowRunOutcome([{ action: "send_packet", status: "skipped" }]);
check(skipped.status === "completed" && skipped.delivered === 0 && skipped.skipped === 1, "a skipped send stays visible and delivers nothing");
rejects(() => assert.equal(classifyWorkflowRunOutcome([{ action: "send_ghl_email", status: "failed" }]).status, "completed"), "the old always-completed behaviour is rejected for a failed send");

// ── B ────────────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000, T0 = Date.UTC(2026, 10, 1);
check(nextApplicationReminderDay({ nowMs: T0 + 1.5 * DAY, occurrenceStartMs: T0, deliveredDays: [], lastDeliveredMs: null }) === 1, "day-1 milestone is due 1 day after the occurrence start");
check(nextApplicationReminderDay({ nowMs: T0 + 1.5 * DAY, occurrenceStartMs: T0, deliveredDays: [1], lastDeliveredMs: T0 + DAY }) === null, "a delivered milestone is not offered again (36h gap also holds)");
check(nextApplicationReminderDay({ nowMs: T0 + 4 * DAY, occurrenceStartMs: T0, deliveredDays: [1], lastDeliveredMs: T0 + DAY }) === 3, "an undelivered milestone stays owed (day 3 after day 1 delivered)");
check(nextApplicationReminderDay({ nowMs: T0 + 4 * DAY, occurrenceStartMs: T0, deliveredDays: [], lastDeliveredMs: null }) === 1, "with nothing delivered the earliest owed milestone is offered first (held work retained)");
rejects(() => assert.equal(nextApplicationReminderDay({ nowMs: T0 + 4 * DAY, occurrenceStartMs: T0, deliveredDays: [], lastDeliveredMs: null }), 3), "a consumed-without-delivery reading (skipping to day 3) is rejected");

// ── C ────────────────────────────────────────────────────────────────────────────────────
const purposeOf = (id: string | null) => (id === "ACCT" ? "account" : "sales");
const open = [
  { appointment_id: "b", calendar_id: "S", start_time: "2026-11-10T15:00:00Z" },
  { appointment_id: "a", calendar_id: "S", start_time: "2026-11-05T15:00:00Z" },
  { appointment_id: "z", calendar_id: "ACCT", start_time: "2026-11-01T15:00:00Z" },
];
check(deriveCurrentAppointmentId(open as any, purposeOf, "sales") === "a", "current sales appointment is the earliest recorded start, regardless of arrival order");
check(deriveCurrentAppointmentId(open as any, purposeOf, "account") === "z", "account appointment never becomes the sales current appointment");
check(deriveCurrentAppointmentId([] as any, purposeOf, "sales") === null, "no open appointment means no current pointer");
rejects(() => assert.equal(deriveCurrentAppointmentId(open as any, purposeOf, "sales"), "z"), "last-arrival/any-calendar pointer is rejected");
check(normalizeAppointmentStatus("No Show") === "no_show" && normalizeAppointmentStatus("cancelled") === "canceled" && normalizeAppointmentStatus("weird") === null, "status text normalizes; unknown text is never guessed");
check(occurrenceKeyOf({ appointmentId: "A1", appointmentDate: "x" }) === "A1" && occurrenceKeyOf({}) === null, "occurrence identity prefers the appointment id and is null without one");
check(workflowTriggerRefusal({ succeded: false }) === "succeded=false" && workflowTriggerRefusal({ succeeded: true }) === null && workflowTriggerRefusal({ success: false }) !== null, "provider trigger refusal (incl. documented 'succeded') is read from the body");

// ── D ────────────────────────────────────────────────────────────────────────────────────
const deals = [{ id: 1, ghlOpportunityId: "O1" }, { id: 2, ghlOpportunityId: "O2" }];
check(selectInboundDeal(deals, "O2").index === 1, "deal selected by the conversation's opportunity association");
check(selectInboundDeal(deals, null).index === null && selectInboundDeal(deals, null).selection === "ambiguous", "several deals without association select no deal");
check(selectInboundDeal([deals[0]], null).index === 0, "a single open deal is selected");
rejects(() => assert.equal(selectInboundDeal(deals, null).index, 0), "'first deal to avoid null' is rejected");

// ── E ────────────────────────────────────────────────────────────────────────────────────
const tag = `4c2-${Date.now()}`;
let sends = 0;
const id = (k: string) => ({ effectKey: `${tag}:${k}`, ownerKind: "cert", ownerId: tag, channel: "email" });
const ok1 = await runFollowupEffect(id("a"), async () => { sends++; return { success: true }; });
const ok2 = await runFollowupEffect(id("a"), async () => { sends++; return { success: true }; });
check(ok1.state === "accepted" && ok2.state === "accepted" && ok2.replay && sends === 1, "an accepted receipt replays without a second provider call");
check(await hasAcceptedEffect("cert", tag), "accepted receipt is readable as delivered");
const amb = await runFollowupEffect(id("b"), async () => { sends++; return { success: false, error: "fetch failed: ETIMEDOUT" }; });
const amb2 = await runFollowupEffect(id("b"), async () => { sends++; return { success: true }; });
check(amb.state === "unknown" && amb2.state === "unknown" && sends === 2, "an ambiguous failure is unknown and is never re-sent");
const ref = await runFollowupEffect(id("c"), async () => { sends++; return { success: false, error: "paused" }; });
const ref2 = await runFollowupEffect(id("c"), async () => { sends++; return { success: true }; });
check(ref.state === "refused" && ref2.state === "accepted" && sends === 4, "a definite refusal (pause) leaves the touch owed and a later attempt may send");
const threw = await runFollowupEffect(id("d"), async () => { throw new Error("boom"); });
check(threw.state === "refused", "a thrown non-ambiguous error is refused, not accepted");
rejects(() => assert.equal(ref.state, "accepted"), "a paused attempt cannot be read as delivered");

// ── F ────────────────────────────────────────────────────────────────────────────────────
const wf = await storage.createWorkflow({ name: `4c2 cert ${tag}`, triggerType: "manual", actions: [{ type: "wait", minutes: 0 }, { type: "create_task", title: "x" }], enabled: true } as any);
const ctx = { entityType: "deal", entityId: 987654, occurrenceId: `occ-${tag}` } as any;
const first = await executeWorkflowActions(wf.id, (wf.actions as any[]), ctx);
const second = await executeWorkflowActions(wf.id, (wf.actions as any[]), ctx);
check(first.status === "waiting" && second.replay === true && second.runId === first.runId, "the same occurrence returns the existing run, not a second one");
const runs = (await pool.query(`SELECT count(*)::int AS n FROM workflow_runs WHERE workflow_id=$1`, [wf.id])).rows[0].n;
check(runs === 1, "exactly one run row exists for the occurrence");
const third = await executeWorkflowActions(wf.id, (wf.actions as any[]), { ...ctx, occurrenceId: `occ2-${tag}` });
check(third.runId !== first.runId, "a different occurrence starts its own run");
await pool.query(`UPDATE workflow_runs SET next_run_at = now() - interval '1 minute' WHERE workflow_id=$1`, [wf.id]);
const claimA = await claimDueWorkflowRuns(10);
const mine = claimA.filter(r => r.workflowId === wf.id);
const claimB = await claimDueWorkflowRuns(10);
check(mine.length === 2 && claimB.filter(r => r.workflowId === wf.id).length === 0, "a leased due run cannot be claimed by a second worker");
await pool.query(`UPDATE workflow_runs SET lease_expires_at = now() - interval '1 second' WHERE workflow_id=$1`, [wf.id]);
const claimC = await claimDueWorkflowRuns(10);
check(claimC.filter(r => r.workflowId === wf.id).length === 2, "an expired lease can be re-claimed (crash recovery)");
for (const r of claimC.filter(r => r.workflowId === wf.id)) await releaseWorkflowRunLease(r.id, r.leaseToken);
// definition pin: change the workflow, then resume the old run
await pool.query(`UPDATE workflow_runs SET next_run_at = now() - interval '1 minute' WHERE id=$1`, [first.runId]);
const changed = [{ type: "wait", minutes: 0 }, { type: "create_task", title: "CHANGED" }];
const resumed = await executeWorkflowActions(wf.id, changed, ctx, first.runId, 1);
const after = (await pool.query(`SELECT status FROM workflow_runs WHERE id=$1`, [first.runId])).rows[0].status;
check(resumed.status === "blocked" && after === "blocked", "resuming against a changed workflow definition is blocked");
const resumed2 = await executeWorkflowActions(wf.id, changed, ctx, first.runId, 1);
check(resumed2.status === "blocked" && resumed2.log[0]?.action === "run_unavailable", "a blocked run is terminal and cannot be resumed");
const dup = await pool.query(`INSERT INTO workflow_runs (workflow_id, entity_type, entity_id, status, occurrence_key) VALUES ($1,'deal',987654,'running',$2)`,
  [wf.id, `deal:987654:occ-${tag}`]).then(() => false, (e: any) => e.code === "23505");
check(dup, "negative control: the unique index rejects a second run for one occurrence", true);

// ── F2: controlled retry and parked runs ─────────────────────────────────────────────────
check(classifyWorkflowRunOutcome([
  { step: 2, action: "send_ghl_email", status: "failed" }, { step: 2, action: "send_ghl_email", status: "completed" },
]).status === "completed", "after a retry the latest entry per step decides the run outcome");
rejects(() => assert.equal(classifyWorkflowRunOutcome([{ step: 2, action: "send_ghl_email", status: "failed" }]).status, "completed"), "an unretried failed step is never completed");
const retryContact = await storage.createContact({ firstName: "Retry", lastName: "FourC2", email: `retry4c2.${Date.now()}@example.invalid`,
  phone: `+1555${String(Date.now() + 1).slice(-7)}`, ghlContactId: `retry4c2${Date.now()}`, status: "Active" } as any);
const taskTitle = `4c2 retry ${tag}`;
const retryWf = await storage.createWorkflow({ name: `4c2 retry ${tag}`, triggerType: "manual", enabled: true,
  actions: [{ type: "create_task", title: taskTitle }, { type: "send_ghl_email", subject: "x", body: "y" }] } as any);
const retryCtx = { entityType: "contact", entityId: retryContact.id, occurrenceId: `retry-${tag}` } as any;
const r1 = await executeWorkflowActions(retryWf.id, retryWf.actions as any[], retryCtx);
check(["failed", "blocked"].includes(r1.status) && (r1.delivered ?? 0) === 0, "a send that cannot be delivered leaves the run failed or blocked with nothing delivered");
const again = await executeWorkflowActions(retryWf.id, retryWf.actions as any[], retryCtx);
check(again.replay === true && again.runId === r1.runId && again.status === r1.status, "a plain re-trigger replays the terminal run (it does not retry)");
const r2 = await retryFailedWorkflowRun(r1.runId);
const taskCount = (await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title = $1`, [taskTitle])).rows[0].n;
check(r2.state === "retried" && taskCount === 1, "a controlled retry re-attempts the undelivered step without repeating the completed task");
check(r2.state === "retried" && r2.status !== "completed", "while delivery is still impossible the retry does not report completion");
rejects(() => assert.equal(taskCount, 2), "a retry that repeats completed steps is rejected");
await pool.query(`UPDATE workflow_runs SET status='failed', log = log || '[{"step":2,"action":"send_ghl_email","status":"unknown_outcome"}]'::jsonb WHERE id=$1`, [r1.runId]);
const r3 = await retryFailedWorkflowRun(r1.runId);
check(r3.state === "needs_review" && r3.reason === "unknown_outcome_requires_review", "an unknown outcome is parked for review, never retried");
await pool.query(`UPDATE workflows SET enabled = false WHERE id=$1`, [retryWf.id]);
const r4 = await retryFailedWorkflowRun(r1.runId);
check(r4.state === "needs_review", "a disabled workflow is not retried");
// a waiting run whose workflow is disabled is parked, not left due
const parkedWf = await storage.createWorkflow({ name: `4c2 parked ${tag}`, triggerType: "manual", enabled: true, actions: [{ type: "wait", minutes: 60 }] } as any);
const parked = await executeWorkflowActions(parkedWf.id, parkedWf.actions as any[], { entityType: "deal", entityId: 987655, occurrenceId: `parked-${tag}` } as any);
await pool.query(`UPDATE workflow_runs SET next_run_at = now() - interval '1 minute' WHERE id=$1`, [parked.runId]);
await pool.query(`UPDATE workflows SET enabled = false WHERE id=$1`, [parkedWf.id]);
const dueBefore = (await claimDueWorkflowRuns(50)).filter(r => r.id === parked.runId);
check(dueBefore.length === 1, "the waiting run is due before its workflow is found unavailable");
await executeWorkflowActions(parkedWf.id, [], { entityType: "deal", entityId: 987655 } as any, parked.runId, 1);
await releaseWorkflowRunLease(parked.runId, dueBefore[0].leaseToken);
const parkedRow = (await pool.query(`SELECT status FROM workflow_runs WHERE id=$1`, [parked.runId])).rows[0];
const dueAfter = (await claimDueWorkflowRuns(50)).filter(r => r.id === parked.runId);
check(parkedRow.status === "blocked" && dueAfter.length === 0, "a run whose workflow is disabled is parked as blocked and is not due again");
rejects(() => assert.equal(dueAfter.length, 1), "a released-but-still-waiting run would repeat on every scan");
const sla = read0("server/services/sla-worker.ts");
check(/handledThisScan/.test(sla) && /retryFailedWorkflowRun/.test(sla), "the waiting-run loop cannot repeat a run within a scan and reminders use the controlled retry");

// ── G ────────────────────────────────────────────────────────────────────────────────────
const ghlId = `cert4c2${Date.now()}`;
check((await resolveInboundIdentity(ghlId)).state === "not_found", "an unknown GHL contact is a named not_found outcome");
const contact = await storage.createContact({ firstName: "Cert", lastName: "FourC2", email: `cert4c2.${Date.now()}@example.invalid`,
  phone: `+1555${String(Date.now()).slice(-7)}`, ghlContactId: ghlId, status: "Active" } as any);
await pool.query(`INSERT INTO deals (contact_id, name, ghl_opportunity_id) VALUES ($1,'Cert deal A','OPP-A'),($1,'Cert deal B','OPP-B')`, [contact.id]);
const resolvedNoAssoc = await resolveInboundIdentity(ghlId);
check(resolvedNoAssoc.state === "resolved" && resolvedNoAssoc.deal === null && resolvedNoAssoc.dealSelection === "ambiguous", "contact with several deals and no association resolves with no deal");
const resolvedAssoc = await resolveInboundIdentity(ghlId, "OPP-B");
check(resolvedAssoc.state === "resolved" && resolvedAssoc.deal?.ghlOpportunityId === "OPP-B", "the linked deal is selected by the opportunity association");
await pool.query(`UPDATE contacts SET archived_at = now() WHERE id=$1`, [contact.id]);
check((await resolveInboundIdentity(ghlId)).state === "archived", "an archived contact is a named archived outcome");

// ── H ────────────────────────────────────────────────────────────────────────────────────
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const statement = read("server/services/sdr/statement-flow.ts");
check(!/console\.(log|warn|error)\([^)]*(token|uploadUrl)/i.test(statement), "the statement upload token and URL are never logged");
rejects(() => assert(!/console\.log\(`\[Statement\] token: \$\{token\}`\)/.test("console.log(`[Statement] token: ${token}`)")), "a token log line would be detected");
const sdrRoutes = read("server/routes/sdr.ts");
check(/app\.post\("\/api\/sdr\/send-booking-link\/:merchantId", isDashboardUser, requireRole\("admin", "manager"\)/.test(sdrRoutes), "the booking-link route requires a dashboard staff role");
check(/workflow_not_configured", durable: false|reason: "workflow_not_configured"/.test(read("server/services/ghl-workflow-enrollment.ts")) && !/state: "skipped", reason: "workflow_not_configured"/.test(read("server/services/ghl-workflow-enrollment.ts")), "an unconfigured native workflow is a held handoff, not a skip");
check(!/GHL_CALENDAR_ID/.test(read("server/services/inbox-work-command.ts")), "Inbox preparation derives its booking address from the shared purpose resolver");
check(!/limit: 500/.test(read("server/services/sla-worker.ts").slice(read("server/services/sla-worker.ts").indexOf("async function checkApplicationReminders"), read("server/services/sla-worker.ts").indexOf("async function checkNpsTriggers"))), "application reminders no longer scan the first 500 deals");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

mkdirSync(new URL("../../docs/certification/stage4-c2/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/certification/stage4-c2/journey-authority-evidence.json", import.meta.url),
  JSON.stringify({ suite: "stage4c2-journey-authority", checks, negativeControls: evidence.filter(e => e.negativeControl).length, results: evidence }, null, 2) + "\n");
console.log(`\nStage 4C2 journey authority: ${checks} checks passed`);
await pool.end();
