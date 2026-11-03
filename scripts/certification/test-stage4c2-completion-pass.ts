/**
 * Stage 4C2 completion-pass certification — disposable database; provider network denied; nothing is sent or booked.
 *
 *  A. Migration 0379 install, rollback-to-0378 shape and upgrade, in one disposable database (no production writes).
 *  B. RC1B: command-fingerprint binding inside the claim (real DB barrier interleaving, legacy-null rows).
 *  C. RC1A: local mutation and effect receipt in ONE transaction; lease fence; takeover cannot interleave; receipt failure.
 *  D. RC2A: generic inbound provider webhook converges on the canonical provider message identity.
 *  E. RC2B/RC2C: held obligations stay retryable until durable; amendment wins; expired hold is terminal with no provider call.
 *  F. RC3A/RC3B: per-channel owed state; SMS provider-vs-local number comparison; dormant proposal resend is fenced.
 *  G. RC4A: booking readback requires exact appointment, calendar, location, contact and requested content.
 *  H. Static wiring: saved booking command, run-detail wording, manifest/runner relationship.
 * Every critical check has a negative control that must fail on the defective behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C2 completion pass certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
// No provider credential: the generic webhook's automatic reply must stop at "not configured", never at the network.
delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
delete process.env.GHL_API_KEY;
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { runFollowupEffect, EffectBindingConflictError } = await import("../../server/services/followup-effects");
const { applyLocalEffectOnce, applyLocalWorkflowAction } = await import("../../server/services/workflow-local-actions");
const { handleGhlWebhook } = await import("../../server/services/ghl");
const { deferGhlEnrollment, retryDeferredEnrollments } = await import("../../server/services/ghl-enrollment-recovery");
const { classifyStatementChannelReceipt, statementRequestChannelStates } = await import("../../server/services/sdr/statement-flow");
const booking = await import("../../server/services/ghl-booking-command");

let checks = 0;
const evidence: Array<{ id: string; claim: string; negativeControl: boolean }> = [];
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++; evidence.push({ id: `CM-${String(checks).padStart(2, "0")}`, claim: message, negativeControl });
  console.log(`✓ [CM-${String(checks).padStart(2, "0")}] ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
const gate = () => { let open!: () => void; const wait = new Promise<void>(r => { open = r; }); return { open, wait }; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── A. Migration 0379: install, rollback shape, upgrade ──────────────────────────────────
const migrationSql = src("migrations/0379_stage4c2_correction_pass.sql");
const statements = migrationSql.split("--> statement-breakpoint").map(s => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
const expectedCols = async () => (await pool.query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name='workflow_runs' AND column_name='input_context')
       OR (table_name='followup_effect_receipts' AND column_name IN ('request_fingerprint','attempt_count'))`)).rows.length;
check(await expectedCols() === 3, "installed: migration 0379 columns exist on the disposable database");
{
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Rollback to the pre-0379 (0378) shape, proving the migration is purely additive columns.
    await client.query(`ALTER TABLE workflow_runs DROP COLUMN IF EXISTS input_context`);
    await client.query(`ALTER TABLE followup_effect_receipts DROP COLUMN IF EXISTS request_fingerprint`);
    await client.query(`ALTER TABLE followup_effect_receipts DROP COLUMN IF EXISTS attempt_count`);
    const rolledBack = (await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE (table_name='workflow_runs' AND column_name='input_context')
          OR (table_name='followup_effect_receipts' AND column_name IN ('request_fingerprint','attempt_count'))`)).rows[0].n;
    check(rolledBack === 0, "rollback: removing exactly the 0379 columns returns the 0378 shape");
    for (const statement of statements) await client.query(statement);
    const upgraded = (await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE (table_name='workflow_runs' AND column_name='input_context')
          OR (table_name='followup_effect_receipts' AND column_name IN ('request_fingerprint','attempt_count'))`)).rows[0].n;
    check(upgraded === 3, "upgrade: applying 0379 on the 0378 shape restores all three columns");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}
check(await expectedCols() === 3 && !/DROP |DELETE FROM|TRUNCATE/i.test(migrationSql), "0379 is additive only and the database ends on the upgraded shape");
rejects(() => assert.equal(0, 3, "columns"), "an upgrade that left a column missing would be detected");

// ── B. RC1B: binding inside the claim ────────────────────────────────────────────────────
const F1 = "f1".repeat(32), F2 = "f2".repeat(32);
const ident = (k: string, fp?: string) => ({ effectKey: `cm:${tag}:${k}`, ownerKind: "cm_cert", ownerId: tag, channel: "email", requestFingerprint: fp });
let calls = 0;
await runFollowupEffect(ident("race", F1), async () => ({ success: false, error: "paused" }));
const barrier = gate(); let aStarted = false;
const a = runFollowupEffect(ident("race", F1), async () => { calls++; aStarted = true; await barrier.wait; return { success: true }; });
while (!aStarted) await sleep(10);
const conflict = await runFollowupEffect(ident("race", F2), async () => { calls++; return { success: true }; }).then(() => null, (e) => e);
const sameWhileStarted = await runFollowupEffect(ident("race", F1), async () => { calls++; return { success: true }; });
barrier.open();
const aOutcome = await a;
check(conflict instanceof EffectBindingConflictError && calls === 1, "a different request fingerprint arriving while the claim is in flight is a binding conflict and calls no provider");
check(sameWhileStarted.state === "unknown" && sameWhileStarted.replay && aOutcome.state === "accepted" && calls === 1, "the same fingerprint while the first attempt is in flight does not claim a second send");
rejects(() => assert.equal(calls, 2, "two sends"), "two providers calls for one reviewed request are rejected");

calls = 0;
await runFollowupEffect(ident("dual", F1), async () => ({ success: false, error: "paused" }));
const racers = await Promise.all([1, 2, 3, 4].map(() => runFollowupEffect(ident("dual", F1), async () => { calls++; await sleep(50); return { success: true }; })));
check(calls === 1 && racers.filter(r => !r.replay).length === 1, "four simultaneous claimers of one refused row produce exactly one provider call");

await pool.query(`INSERT INTO followup_effect_receipts (effect_key, owner_kind, owner_id, channel, state, settled_at) VALUES ($1,'cm_cert',$2,'email','refused', now())`, [`cm:${tag}:legacy`, tag]);
calls = 0;
const legacyBound = await runFollowupEffect(ident("legacy", F1), async () => { calls++; return { success: true }; }).then(() => "claimed", (e) => e instanceof EffectBindingConflictError ? "conflict" : "other");
check(legacyBound === "conflict" && calls === 0, "a legacy refused row without a fingerprint cannot be adopted by a fingerprinted request (no provider call)");
const legacyUnbound = await runFollowupEffect(ident("legacy"), async () => { calls++; return { success: true }; });
check(legacyUnbound.state === "accepted" && calls === 1, "an unbound caller keeps its prior claim semantics on a legacy row");
await runFollowupEffect(ident("bound-then-unbound", F1), async () => ({ success: false, error: "paused" }));
const unboundOnBound = await runFollowupEffect(ident("bound-then-unbound"), async () => { calls++; return { success: true }; }).then(() => "claimed", (e) => e instanceof EffectBindingConflictError ? "conflict" : "other");
check(unboundOnBound === "conflict" && calls === 1, "an unbound caller cannot reclaim a fingerprinted refused row");
const wrongOwner = await runFollowupEffect({ ...ident("legacy-owner", F1), ownerId: "someone-else" }, async () => ({ success: false, error: "paused" }));
const wrongOwnerAgain = await runFollowupEffect({ ...ident("legacy-owner", F1), ownerId: tag }, async () => { calls++; return { success: true }; }).then(() => "claimed", (e) => e instanceof EffectBindingConflictError ? "conflict" : "other");
check(wrongOwner.state === "refused" && wrongOwnerAgain === "conflict" && calls === 1, "the owner and channel are part of the claim binding");

// ── C. RC1A: local effect and receipt in one transaction ─────────────────────────────────
const wf = await storage.createWorkflow({ name: `cm cert ${tag}`, triggerType: "manual", actions: [{ type: "wait", minutes: 0 }], enabled: true } as any);
const mkRun = async (leaseSeconds: number) => {
  const token = crypto.randomUUID();
  const row = (await pool.query(
    `INSERT INTO workflow_runs (workflow_id, entity_type, entity_id, status, lease_token, lease_expires_at)
     VALUES ($1,'deal',$2,'running',$3, now() + ($4 || ' seconds')::interval) RETURNING id`, [wf.id, Math.floor(Math.random() * 1e6), token, String(leaseSeconds)])).rows[0];
  return { id: row.id as number, token };
};
const receiptCount = async (key: string) => (await pool.query(`SELECT count(*)::int AS n FROM followup_effect_receipts WHERE effect_key=$1`, [key])).rows[0].n as number;
const notifCount = async (title: string) => (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE title=$1`, [title])).rows[0].n as number;
const run1 = await mkRun(600);
const title1 = `cm-note-${tag}-1`;
const applied = await applyLocalWorkflowAction(run1.id, 1, run1.token, async (tx) => { await storage.createNotification({ channel: "internal", title: title1, message: "m", type: "info" } as any, tx as any); });
const replayed = await applyLocalWorkflowAction(run1.id, 1, run1.token, async (tx) => { await storage.createNotification({ channel: "internal", title: title1, message: "m", type: "info" } as any, tx as any); });
check(applied === "applied" && replayed === "replay" && await notifCount(title1) === 1 && await receiptCount(`wf_local:${run1.id}:1`) === 1, "a workflow notification and its receipt commit together and a repeat changes nothing");
const title2 = `cm-note-${tag}-2`;
const failed = await applyLocalWorkflowAction(run1.id, 2, run1.token, async (tx) => {
  await storage.createNotification({ channel: "internal", title: title2, message: "m", type: "info" } as any, tx as any);
  throw new Error("mutation failed after write");
}).then(() => "ok", () => "threw");
check(failed === "threw" && await notifCount(title2) === 0 && await receiptCount(`wf_local:${run1.id}:2`) === 0, "a mutation that fails after writing leaves neither the row nor the receipt");
const retryApplied = await applyLocalWorkflowAction(run1.id, 2, run1.token, async (tx) => { await storage.createNotification({ channel: "internal", title: title2, message: "m", type: "info" } as any, tx as any); });
check(retryApplied === "applied" && await notifCount(title2) === 1, "the retry after a rolled-back attempt performs the effect exactly once");
let mutated = false;
const noReceipt = await applyLocalEffectOnce({ effectKey: null as any, ownerKind: "cm_cert", ownerId: tag, channel: "x" }, async () => { mutated = true; }).then(() => "ok", () => "threw");
check(noReceipt === "threw" && !mutated, "if the receipt cannot be written nothing is mutated");
const expired = await mkRun(-5);
const title3 = `cm-note-${tag}-3`;
let lostMutated = false;
const lost = await applyLocalWorkflowAction(expired.id, 1, expired.token, async (tx) => { lostMutated = true; await storage.createNotification({ channel: "internal", title: title3, message: "m", type: "info" } as any, tx as any); });
check(lost === "lost_lease" && !lostMutated && await notifCount(title3) === 0 && await receiptCount(`wf_local:${expired.id}:1`) === 0, "a worker whose lease is gone writes nothing and records no receipt");
const wrongToken = await applyLocalWorkflowAction(run1.id, 3, "not-the-token", async () => { lostMutated = true; });
check(wrongToken === "lost_lease" && !lostMutated, "a different lease token cannot write");
const run2 = await mkRun(600);
let takeoverCode: string | null = null;
const midOutcome = await applyLocalWorkflowAction(run2.id, 1, run2.token, async () => {
  const other = await pool.connect();
  try {
    await other.query("SET lock_timeout = '400ms'");
    await other.query(`UPDATE workflow_runs SET lease_token = 'stolen' WHERE id = $1`, [run2.id]);
  } catch (error: any) { takeoverCode = error?.code ?? "error"; } finally { other.release(); }
});
const afterTakeover = await pool.query(`UPDATE workflow_runs SET lease_token = 'stolen' WHERE id = $1 RETURNING id`, [run2.id]);
check(midOutcome === "applied" && takeoverCode === "55P03" && afterTakeover.rowCount === 1, "a takeover attempted mid-action is blocked until the commit, then succeeds");
const lateWorker = await applyLocalWorkflowAction(run2.id, 2, run2.token, async () => { lostMutated = true; });
check(lateWorker === "lost_lease" && !lostMutated, "after the takeover commits the old worker's next effect is refused");
rejects(() => assert.equal(lost, "applied"), "a lost-lease worker reported as applied");

// ── D. RC2A: generic inbound webhook converges on the provider message identity ──────────
const contact = await storage.createContact({ firstName: "Inbound", lastName: `Cm${tag}`, email: `inbound-${tag}@example.test`, phone: "+19951230099", ghlContactId: `ghl-cm-${tag}`, status: "Active" } as any);
const counts = async () => ({
  activity: (await pool.query(`SELECT count(*)::int AS n FROM ghl_activity_log WHERE contact_id=$1 AND direction='inbound'`, [contact.id])).rows[0].n as number,
  notifications: (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE metadata->>'contactId' = $1`, [String(contact.id)])).rows[0].n as number,
  tasks: (await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1`, [contact.id])).rows[0].n as number,
  audits: (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='inbound_message_processed' AND entity_id=$1`, [contact.id])).rows[0].n as number,
  events: (await pool.query(`SELECT count(*)::int AS n FROM communication_events WHERE contact_id=$1 AND direction='inbound'`, [contact.id])).rows[0].n as number,
});
const inbound = (extra: Record<string, unknown>, body = "What are your rates and fees for a small restaurant?") =>
  ({ type: "InboundMessage", direction: "inbound", messageType: "SMS", contactId: `ghl-cm-${tag}`, body, ...extra });
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-1` }));
const c1 = await counts();
check(c1.activity === 1 && c1.notifications === 1 && c1.audits === 1, "first delivery records one activity row, one notification and one processed audit");
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-1` }));
const c2 = await counts();
check(JSON.stringify(c2) === JSON.stringify(c1), "a re-delivered webhook repeats no local effect");
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-1`, id: `other-alias-${tag}`, eventId: `evt-${tag}` }));
const c3 = await counts();
check(JSON.stringify(c3) === JSON.stringify(c1), "a delivery alias naming the same provider message repeats no local effect");
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-2` }));
const c4 = await counts();
check(c4.activity === 2 && c4.notifications === 2, "negative control: a different provider message is a new message and is recorded");
const noId = inbound({}, "No identifier on this one please call me");
await handleGhlWebhook(noId); const c5 = await counts();
await handleGhlWebhook(noId); const c6 = await counts();
check(c5.activity === 3 && JSON.stringify(c6) === JSON.stringify(c5), "a delivery with no provider id converges on its own payload fingerprint");
const idBasis = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='ghl_inbound_identity_unavailable'`)).rows[0].n as number;
check(idBasis >= 1, "the missing provider identity is explicit in the audit trail, not silent");
await handleGhlWebhook(inbound({}, "A different payload without any identifier either"));
check((await counts()).activity === 4, "negative control: a different payload without ids is not folded into the earlier one");
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-stop` }, "STOP"));
const stopEvents = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='contact_unsubscribed' AND entity_id=$1`, [contact.id])).rows[0].n as number;
await handleGhlWebhook(inbound({ messageId: `msg-${tag}-stop` }, "STOP"));
const stopEvents2 = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='contact_unsubscribed' AND entity_id=$1`, [contact.id])).rows[0].n as number;
check(stopEvents === 1 && stopEvents2 === 1, "STOP keeps its idempotent consent handling and one audit across re-delivery");
rejects(() => assert.equal(c3.activity, 2), "an alias delivery that duplicated the activity row is detected");

// ── E. RC2B / RC2C ───────────────────────────────────────────────────────────────────────
const sched = src("server/services/sdr/scheduling.ts");
check(/workflow_hold_not_durable/.test(sched), "RC2B: a held outcome that is not durable fails at the owning step (retryable), never completes it");
const gc = `ghl-def-${tag}`;
const metaV1 = { _holdForConfiguration: true, _expiresAt: new Date(Date.now() + 3600_000).toISOString(), revision: 1 };
await deferGhlEnrollment({ ghlContactId: gc, workflowKey: "booking_confirmation", metadata: metaV1, error: "workflow_not_configured", occurrenceKey: `occ-${tag}` });
await deferGhlEnrollment({ ghlContactId: gc, workflowKey: "booking_confirmation", metadata: { ...metaV1, revision: 2 }, error: "workflow_not_configured", occurrenceKey: `occ-${tag}` });
const amended = (await pool.query(`SELECT id, metadata, status FROM deferred_ghl_enrollments WHERE ghl_contact_id=$1`, [gc])).rows;
check(amended.length === 1 && amended[0].metadata?.revision === 2, "a newer revision of one occurrence amends the pending obligation (latest wins, one row)");
// Expire it and let the worker claim it: terminal, observable, and no provider call.
await pool.query(`UPDATE deferred_ghl_enrollments SET metadata = jsonb_set(metadata, '{_expiresAt}', to_jsonb($2::text)), next_retry_at = now() - interval '1 minute' WHERE id=$1`,
  [amended[0].id, new Date(Date.now() - 60_000).toISOString()]);
const blockedBefore = getBlockedCertificationNetworkAttemptCount();
// Fail-closed default: with no unpaused control row the worker touches nothing (the row is neither consumed nor retried).
const pausedStats = await retryDeferredEnrollments();
const stillPending = (await pool.query(`SELECT status, retry_count FROM deferred_ghl_enrollments WHERE id=$1`, [amended[0].id])).rows[0];
check(pausedStats.attempted === 0 && stillPending.status === "pending" && stillPending.retry_count === 0, "under the fail-closed pause default the worker neither claims nor consumes the held obligation");
// Disposable database only: simulate an unpaused control row so the worker reaches the held row; restored afterwards.
const setPause = async (state: "paused" | "unpaused") => {
  const updated = await pool.query(`UPDATE outbound_pause_control SET state=$1, committed_at=NOW()`, [state]);
  if (updated.rowCount === 0) await pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at) VALUES ($1,'completion pass certification',1,'cm-cert',$2,NOW())`, [state, `cm-cert-${crypto.randomUUID()}`]);
  (await import("../../server/services/outbound-pause-authority")).invalidatePauseStateCache();
};
await setPause("unpaused");
let stats: Awaited<ReturnType<typeof retryDeferredEnrollments>>;
try { stats = await retryDeferredEnrollments(); } finally { await setPause("paused"); }
const expiredRow = (await pool.query(`SELECT status, last_error FROM deferred_ghl_enrollments WHERE id=$1`, [amended[0].id])).rows[0];
check(expiredRow?.status === "failed" && expiredRow?.last_error === "hold_expired" && stats.permanentlyFailed >= 1, "an expired required hold becomes a terminal, observable failure (not deleted, not pending)");
check(getBlockedCertificationNetworkAttemptCount() === blockedBefore, "the expired hold made no provider attempt");
const expiredAudit = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='ghl_enrollment_hold_expired' AND entity_key=$1`, [gc])).rows[0].n as number;
check(expiredAudit === 1, "the expiry disposition is audited once");
const reopened = await deferGhlEnrollment({ ghlContactId: gc, workflowKey: "booking_confirmation", metadata: metaV1, error: "workflow_not_configured", occurrenceKey: `occ-${tag}` });
check(!reopened.persisted && (await pool.query(`SELECT status FROM deferred_ghl_enrollments WHERE id=$1`, [amended[0].id])).rows[0].status === "failed", "a terminal row is never reopened by a later revision");
rejects(() => assert.notEqual(expiredRow?.status, "failed"), "an expired hold left pending is rejected");

// ── F. RC3 ────────────────────────────────────────────────────────────────────────────────
check(classifyStatementChannelReceipt("sms", { state: "refused", detail: "sms_not_permitted:quiet_hours" }) === "owed_temporary", "RC3A: SMS quiet hours is a temporary owed state");
check(classifyStatementChannelReceipt("sms", { state: "refused", detail: "sms_not_permitted:consent_withdrawn" }) === "permanent_refusal", "RC3A: an SMS standing denial is a permanent refusal for that channel only");
check(classifyStatementChannelReceipt("email", { state: "accepted" }) === "delivered" && classifyStatementChannelReceipt("email", { state: "started" }) === "unknown" && classifyStatementChannelReceipt("sms", undefined) === "not_attempted", "RC3A: accepted is delivered, an unsettled row is unknown, no row is not attempted");
check(classifyStatementChannelReceipt("email", { state: "refused", detail: "daily_cap_reached" }) === "owed_temporary" && classifyStatementChannelReceipt("email", { state: "refused", detail: "weird_provider_text" }) === "unknown", "RC3A: email cap is temporary; an unclassified refusal is unknown, never retried blindly");
const leadId = 880000000 + Math.floor(Math.random() * 1_000_000);
await pool.query(`INSERT INTO followup_effect_receipts (effect_key, owner_kind, owner_id, channel, state, detail, settled_at) VALUES
  ($1,'statement',$3,'email','accepted',NULL,now()), ($2,'statement',$3,'sms','refused','sms_not_permitted:quiet_hours',now())`,
  [`statement_request:${leadId}:email`, `statement_request:${leadId}:sms`, String(leadId)]);
const states = await statementRequestChannelStates(leadId);
check(states.email === "delivered" && states.sms === "owed_temporary", "RC3A: an accepted email never erases a held SMS; the SMS stays owed");
await pool.query(`UPDATE followup_effect_receipts SET detail='sms_not_permitted:consent_withdrawn' WHERE effect_key=$1`, [`statement_request:${leadId}:sms`]);
const states2 = await statementRequestChannelStates(leadId);
check(states2.email === "delivered" && states2.sms === "permanent_refusal", "RC3A: a permanent SMS denial does not suppress or alter the email channel");
rejects(() => assert.equal(states.sms, "delivered"), "a held SMS read as delivered");
const client = src("server/services/sdr/ghl-client.ts");
const { sdrSmsProviderDeps, sendSmsReply } = await import("../../server/services/sdr/ghl-client");
const priorRead = sdrSmsProviderDeps.readContactPhone;
let providerReads = 0;
sdrSmsProviderDeps.readContactPhone = async () => { providerReads++; return "+19959999999"; };
const blockedNet = getBlockedCertificationNetworkAttemptCount();
const mismatch = await sendSmsReply({ contactId: `ghl-cm-${tag}`, message: "hello", dbContactId: contact.id }).then(() => "sent", (e) => String(e?.message ?? e));
sdrSmsProviderDeps.readContactPhone = priorRead;
check(mismatch !== "sent" && getBlockedCertificationNetworkAttemptCount() === blockedNet, "RC3B: an SMS reply whose provider number differs (or is unverifiable) never reaches the provider");
check(/provider_number_mismatch|provider_target_unverified/.test(client) && /beforeAttempt/.test(client) && /assertSmsRecipientAllowed\(\{ \.\.\.decision, boundPhone: approvedPhone \}\)/.test(client), "RC3B: consent, STOP, purpose and the exact number are re-asserted before every attempt");
const proposal = src("server/services/sdr/proposal-tracking.ts");
const { resendProposalEmail } = await import("../../server/services/sdr/proposal-tracking");
check(await resendProposalEmail(1) === false && !/sendGhlEmail|selectBestInbox/.test(proposal), "RC3: the dormant proposal email resend export is fenced fail-closed and no longer sends");

// ── G. RC4A: readback identity ───────────────────────────────────────────────────────────
const SALES_ID = "AbCdEfGhIjKlMnOpQrSt";
const benv = { GHL_DEFAULT_CALENDAR_ID: SALES_ID, GHL_LOCATION_ID: "locFixture1" };
const NEW_START = "2026-11-11T16:00:00.000Z", NEW_END = "2026-11-11T16:30:00.000Z";
const req = { operation: "reschedule" as const, purpose: "sales" as const, ghlContactId: "contactAbc", appointmentId: "appt1", startTimeIso: NEW_START, endTimeIso: NEW_END, title: "x" };
const pv = booking.previewBookingCommand(req, benv); const hash = pv.ok ? pv.payloadHash : "";
const good = { found: true, id: "appt1", status: "booked", calendarId: SALES_ID, contactId: "contactAbc", locationId: "locFixture1", startTime: NEW_START, endTime: NEW_END, version: 100 };
const readbackState = async (after: Record<string, unknown>) => {
  let wrote = false;
  const provider = {
    write: async () => { wrote = true; return { id: "appt1" }; },
    readAppointment: async () => (wrote ? { ...good, ...after } : { ...good, startTime: "2026-11-10T10:00:00.000Z", endTime: "2026-11-10T10:30:00.000Z" }) as any,
  };
  return (await booking.executeBookingCommand({ actorId: "a", commandId: crypto.randomUUID(), expectedVersion: 100, reviewedPayloadHash: hash, request: req, writerEnabled: true, provider }, benv)).state;
};
check(await readbackState({}) === "confirmed", "RC4A: a readback naming the exact appointment, calendar, location, contact and time is confirmed");
check(await readbackState({ id: undefined }) === "unconfirmed" && await readbackState({ id: "appt-other" }) === "unconfirmed", "RC4A: a missing or different appointment id is unconfirmed");
check(await readbackState({ calendarId: undefined }) === "unconfirmed" && await readbackState({ calendarId: "OtherCal0123456789abc" }) === "unconfirmed", "RC4A: a missing or different calendar is unconfirmed");
check(await readbackState({ locationId: undefined }) === "unconfirmed" && await readbackState({ locationId: "otherLoc" }) === "unconfirmed", "RC4A: a missing or different location is unconfirmed");
check(await readbackState({ contactId: undefined }) === "unconfirmed" && await readbackState({ contactId: "someoneElse" }) === "unconfirmed", "RC4A: a missing or different contact is unconfirmed");
check(await readbackState({ startTime: "2026-11-11T17:00:00.000Z" }) === "unconfirmed", "RC4A: a different requested time is unconfirmed");
rejects(() => assert.equal(String(good.id), "confirmed"), "treating a readback with no identity as matching is rejected");

// ── H. Static wiring ─────────────────────────────────────────────────────────────────────
const panel = src("client/src/components/BookingCommandPanel.tsx");
check(/button-booking-check-saved/.test(panel) && /\/api\/appointments\/booking\/command\//.test(panel) && /writePending\(storageKey, saved\)/.test(panel) && /purgeOtherScopes/.test(panel), "RC4B: the panel saves, restores and checks an unresolved command and clears other actors' entries");
check(/disabled=\{busy !== null \|\| pending !== null\}/.test(panel), "RC4B: a new preview cannot mint a replacement command while one is unresolved");
const pendingShape = panel.split("interface PendingCommand")[1]?.split("\n")[0] ?? "";
check(!/contact|phone|email|token|authorization/i.test(pendingShape) || /payloadHash/.test(pendingShape) && !/contactId|phone|email|authorization/i.test(pendingShape), "RC4B: the saved record holds only command identity and reviewed numbers");
const wfPage = src("client/src/pages/dashboard/Workflows.tsx");
check(/Historical unresolved step — review required/.test(wfPage) && /run-detail-diagnostics/.test(wfPage) && /sanitizeDiagnostic/.test(wfPage) && !/Retry run|button-retry-run"|retryFailedRun/.test(wfPage), "RC4D: historical runs are labelled as such, raw provider text is in sanitized diagnostics, and there is no retry control");
const manifest = src("scripts/ci-suite-manifest.ts");
check(/test-ghl-sync-exact-lookups\.ts/.test(manifest), "RC5: the exact-lookup suite is in the CI suite manifest");
const preDeploy = src("scripts/pre-deploy.ts"), certRunner = src("scripts/run-sfp2060-certification-disposable.ts");
check(/test-stage4c2-completion-pass\.ts/.test(preDeploy) && /test-stage4c2-completion-pass\.ts/.test(certRunner), "this suite is registered in the pre-deploy roster and the disposable certification runner");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

mkdirSync(new URL("../../docs/certification/stage4-c2/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/certification/stage4-c2/completion-pass-evidence.json", import.meta.url),
  JSON.stringify({ suite: "stage4c2-completion-pass", checks, negativeControls: evidence.filter(e => e.negativeControl).length, results: evidence }, null, 2) + "\n");
console.log(`\nStage 4C2 completion pass: ${checks} checks passed`);
await pool.end();
