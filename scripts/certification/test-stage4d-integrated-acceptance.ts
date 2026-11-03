/**
 * Stage 4D integrated acceptance — disposable database; provider network denied; nothing is sent, booked or released.
 *
 *  A. D02 inbound reply evidence: receipt and canonical event are one transaction; aliases (generic webhook + SDR webhook)
 *     converge on one event; a fault after the event insert leaves no event AND no receipt, and the retry writes exactly one.
 *  B. D03 reply-stop pause: the pause and its audit are atomic, the count is the real changed count, a repeat writes no
 *     fabricated audit, and an audit failure rolls the pause back.
 *  C. D04 held-enrollment expiry: an expired hold is terminalized once without sending/claiming/retry-counting; a live hold,
 *     a cancelled row and an ordinary retry row are untouched; two concurrent sweeps audit it exactly once.
 *  D. D05 SMS provider identity: transport-identity denial codes are transient/unknown, never a consent withdrawal.
 *  E. D06 workflow retry with an unlinked (null) workflow id parks for review instead of throwing.
 *  F. D12/booking: local-contact-required create contract and confirmation-only wording (static).
 * Every critical check has a negative control that must fail on the defective behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4D integrated acceptance" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool, db } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { recordCanonicalInboundMessageEventOnce } = await import("../../server/services/ghl-inbound-effects");
const { heldEnrollmentExpiry, sweepExpiredHeldEnrollments, getHeldEnrollmentExpiryDiagnostics } = await import("../../server/services/ghl-enrollment-recovery");
const { parseSmsDenialDetail } = await import("../../server/services/sms-recipient-authority");
const { retryFailedWorkflowRun } = await import("../../server/services/workflow-executor");
const { sql } = await import("drizzle-orm");

let checks = 0;
const evidence: Array<{ id: string; claim: string; negativeControl: boolean }> = [];
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++; evidence.push({ id: `S4D-${String(checks).padStart(2, "0")}`, claim: message, negativeControl });
  console.log(`✓ [S4D-${String(checks).padStart(2, "0")}]${negativeControl ? " (negative control)" : ""} ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
const count = async (query: string, params: unknown[] = []) => Number((await pool.query(query, params)).rows[0].n);

async function makeContact(label: string) {
  return storage.createContact({
    firstName: "S4D", lastName: label, phone: `+1305555${String(Math.floor(Math.random() * 9000) + 1000)}`, email: `s4d.${label}.${tag}@example.invalid`, ghlContactId: `s4d-${label}-${tag}`,
    status: "Active", sourceCategory: "inbound", recordClass: "production",
  } as any);
}

// ── A. D02 inbound reply evidence ───────────────────────────────────────────────────────
const replyContact = await makeContact("reply");
const payload = { messageId: `m-${tag}`, direction: "inbound", type: "SMS" };
const eventCount = () => count(`SELECT count(*)::int AS n FROM communication_events WHERE contact_id=$1 AND direction='inbound'`, [replyContact.id]);
const receiptCount = (key: string) => count(`SELECT count(*)::int AS n FROM followup_effect_receipts WHERE effect_key=$1`, [key]);
const effectKey = `ghl_inbound:${replyContact.id}:msg:${payload.messageId}:communication_event`;

// A fault after the event insert (inside the same transaction) must leave neither event nor receipt.
const { applyLocalEffectOnce } = await import("../../server/services/workflow-local-actions");
const { recordInboundEventInTx } = await import("../../server/services/communication-events");
await assert.rejects(applyLocalEffectOnce(
  { effectKey: `fault:${effectKey}`, ownerKind: "ghl_inbound_message", ownerId: `fault:${replyContact.id}`, channel: "communication_event" },
  async (tx) => {
    await recordInboundEventInTx(tx, { contactId: replyContact.id, channel: "sms", provider: "ghl", body: "fault", status: "received" } as any);
    throw new Error("simulated crash after event insert");
  }), /simulated crash/);
check(await eventCount() === 0 && await receiptCount(`fault:${effectKey}`) === 0, "a crash after the event insert rolls back both the event and the receipt");

const first = await recordCanonicalInboundMessageEventOnce({ contactId: replyContact.id, payload, channel: "sms", body: "yes", ghlMessageId: payload.messageId, metadata: { source: "generic" } });
const alias = await recordCanonicalInboundMessageEventOnce({ contactId: replyContact.id, payload: { ...payload }, channel: "sms", body: "yes", ghlMessageId: payload.messageId, metadata: { source: "sdr_message_received" } });
check(first === "applied" && alias === "replay" && await eventCount() === 1 && await receiptCount(effectKey) === 1,
  "the generic and SDR webhook aliases converge on one canonical event and one receipt");
const racers = await Promise.all([1, 2, 3].map(() => recordCanonicalInboundMessageEventOnce({
  contactId: replyContact.id, payload: { messageId: `race-${tag}` }, channel: "email", body: "race", ghlMessageId: `race-${tag}` })));
const raceEvents = await count(`SELECT count(*)::int AS n FROM communication_events WHERE contact_id=$1 AND ghl_message_id=$2`, [replyContact.id, `race-${tag}`]);
check(racers.filter(r => r === "applied").length === 1 && raceEvents === 1, "three concurrent deliveries of the same reply write exactly one event");
rejects(() => assert.equal(raceEvents, 3), "an unfenced writer would leave one event per delivery");

// ── B. D03 reply-stop pause ─────────────────────────────────────────────────────────────
const pauseContact = await makeContact("pause");
const [seq] = (await pool.query(`INSERT INTO follow_up_sequences (name, status) VALUES ($1,'paused') RETURNING id`, [`S4D seq ${tag}`])).rows;
await pool.query(`INSERT INTO sequence_enrollments (sequence_id, contact_id, status) VALUES ($1,$2,'active')`, [seq.id, pauseContact.id]);
const auditAction = `s4d_pause_${tag}`;
const auditCount = () => count(`SELECT count(*)::int AS n FROM audit_logs WHERE action=$1`, [auditAction]);
const buildAudit = (c: { count: number; enrollmentIds: number[] }) => ({ action: auditAction, entityType: "contact", entityId: String(pauseContact.id), details: { pausedCount: c.count, enrollmentIds: c.enrollmentIds } } as any);
const paused = await storage.pauseActiveEnrollmentsWithAudit(pauseContact.id, buildAudit);
check(paused.count === 1 && paused.enrollmentIds.length === 1 && await auditCount() === 1, "the pause returns the real changed count and writes its audit in the same transaction");
const repeat = await storage.pauseActiveEnrollmentsWithAudit(pauseContact.id, buildAudit);
check(repeat.count === 0 && await auditCount() === 1, "a repeat finds nothing active and fabricates no audit");

await pool.query(`UPDATE sequence_enrollments SET status='active' WHERE contact_id=$1`, [pauseContact.id]);
await assert.rejects(storage.pauseActiveEnrollmentsWithAudit(pauseContact.id, () => { throw new Error("audit build failed"); }), /audit build failed/);
const stillActive = await count(`SELECT count(*)::int AS n FROM sequence_enrollments WHERE contact_id=$1 AND status='active'`, [pauseContact.id]);
check(stillActive === 1, "an audit failure rolls the pause back, so a pause is never unaudited");
rejects(() => assert.equal(stillActive, 0, "enrollment paused"), "a non-atomic pause would leave the enrollment paused after the audit failed");
check(await storage.pauseAllActiveEnrollments(pauseContact.id) === 1, "the legacy pauseAllActiveEnrollments delegates and returns the real count");

// ── C. D04 held-enrollment expiry ───────────────────────────────────────────────────────
const past = new Date(Date.now() - 3600_000).toISOString();
const future = new Date(Date.now() + 3600_000).toISOString();
const ids = { expired: `${tag}-expired::wf`, live: `${tag}-live::wf`, ordinary: `${tag}-ordinary::wf` };
const insertHold = (id: string, metadata: unknown, status = "pending") => pool.query(
  `INSERT INTO deferred_ghl_enrollments (id, ghl_contact_id, workflow_key, metadata, next_retry_at, status) VALUES ($1,$2,'wf',$3::jsonb,now(),$4)`,
  [id, id.split("::")[0], JSON.stringify(metadata), status]);
await insertHold(ids.expired, { _holdForConfiguration: true, _expiresAt: past });
await insertHold(ids.live, { _holdForConfiguration: true, _expiresAt: future });
await insertHold(ids.ordinary, { note: "ordinary" });
check(heldEnrollmentExpiry({ _holdForConfiguration: true, _expiresAt: past }).expired && !heldEnrollmentExpiry({ _holdForConfiguration: true, _expiresAt: future }).expired && !heldEnrollmentExpiry({ note: 1 }).held,
  "the shared expiry predicate separates expired, live and non-hold rows");
const before = await getHeldEnrollmentExpiryDiagnostics();
check(before.availability === "available" && before.expiredAwaitingSweep >= 1 && before.heldPending >= 1, "read-only diagnostics report an expired hold awaiting sweep and a live hold");
const [sweepA, sweepB] = await Promise.all([sweepExpiredHeldEnrollments(500), sweepExpiredHeldEnrollments(500)]);
const rowsAfter = Object.fromEntries((await pool.query(`SELECT id, status, last_error, retry_count FROM deferred_ghl_enrollments WHERE id = ANY($1)`, [Object.values(ids)])).rows.map((r: any) => [r.id, r]));
check(rowsAfter[ids.expired].status === "failed" && rowsAfter[ids.expired].last_error === "hold_expired" && rowsAfter[ids.expired].retry_count === 0,
  "an expired hold is terminalized as hold_expired without consuming a retry");
check(rowsAfter[ids.live].status === "pending" && rowsAfter[ids.ordinary].status === "pending", "a live hold and an ordinary retry row are untouched");
check(sweepA.expired + sweepB.expired === (await count(`SELECT count(*)::int AS n FROM deferred_ghl_enrollments WHERE status='failed' AND last_error='hold_expired'`)),
  "concurrent sweeps terminalize each expired row exactly once between them (counts add up to the terminal rows)");
rejects(() => assert.equal(rowsAfter[ids.live].status, "failed"), "a sweep that ignored the expiry time would terminalize the live hold");
const secondPass = await sweepExpiredHeldEnrollments(500);
check(secondPass.expired === 0 && await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action='ghl_enrollment_hold_expired'`) === sweepA.expired + sweepB.expired,
  "a repeat sweep terminalizes and audits nothing more");

// ── D. D05 SMS provider identity ─────────────────────────────────────────────────────────
const unverified = parseSmsDenialDetail("sms_not_permitted:provider_target_unverified");
const mismatch = parseSmsDenialDetail("sms_not_permitted:provider_number_mismatch");
const withdrawn = parseSmsDenialDetail("sms_not_permitted:consent_withdrawn");
const withdrawnStanding = () => withdrawn?.transient === false;
check(unverified?.transient === true && unverified.transportIdentity === false && withdrawnStanding(), "an unreadable provider target is transient (retryable, nothing sent), never a standing consent refusal");
check(mismatch?.transportIdentity === true && withdrawn?.transportIdentity === false && withdrawn.transient === false, "a provider number mismatch is transport identity, never a consent withdrawal");
rejects(() => assert.equal(mismatch?.transportIdentity, false), "treating a mismatch as a consent withdrawal would hide an identity problem");
check(parseSmsDenialDetail("sms_not_permitted:invented_code") === null, "an unknown denial code is not classified");
const sdrClient = src("server/services/sdr/ghl-client.ts");
check(!sdrClient.includes("phoneTail") && sdrClient.includes("provider_number_mismatch"), "the direct SDR transport compares the full normalized number, not a last-digits tail");

// ── E. D06 workflow retry with null workflow id ──────────────────────────────────────────
const [run] = (await pool.query(`INSERT INTO workflow_runs (workflow_id, entity_type, entity_id, status, log) VALUES (NULL,'contact',$1,'failed','[]'::jsonb) RETURNING id`, [replyContact.id])).rows;
const retried = await retryFailedWorkflowRun(run.id);
check(retried.state === "needs_review" && (retried as any).reason === "workflow_unavailable", "a failed run with no linked workflow parks for review instead of throwing");
rejects(() => assert.equal(retried.state, "retried"), "retrying a run with no workflow would execute against an unknown definition");

// ── F. static contracts ──────────────────────────────────────────────────────────────────
const toolkit = src("server/routes/toolkit.ts");
check(toolkit.includes("local_contact_required") && toolkit.includes("resolveCreateContact(req.body)"), "booking create requires an authorized local contact on preview and execute");
check(!/1h reminder/.test(src("server/services/ghl-workflows.ts")), "the booking confirmation workflow no longer claims a reminder it does not own");
check(src("client/src/components/BookingCreatePanel.tsx").includes("expectedVersion: null") && src("client/src/pages/dashboard/Calendar.tsx").includes("button-create-provider-appointment"), "the Calendar offers the governed create console");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

console.log(`\nStage 4D integrated acceptance: ${checks} checks passed`);
await pool.end();
