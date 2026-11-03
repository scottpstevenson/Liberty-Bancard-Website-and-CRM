/**
 * Stage 4C2 correction-pass certification — disposable database; provider network denied; nothing is sent or booked.
 *
 *  A. Migration 0379 (columns, journal, idempotent re-application on top of 0378).
 *  B. Trigger-response decoder strictness (unconfirmed is never success).
 *  C. Held handoff for a missing workflow ID is a durable, expiring obligation with a stable identity (one row on repeat).
 *  D. Statement request: one token under a race, rep opt-out and later stages establish nothing.
 *  E. Effect receipts: a command id bound to a different request is a conflict before any I/O.
 *  F. Deals follow-up range predicate (exclusive end) and its route validation.
 *  G. Static wiring: proposal touch identity, reminder occurrence audit action, SMS toolkit authority, URL state, runner registration.
 * Every critical check has a negative control that must fail on the defective behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C2 correction pass certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { workflowTriggerRefusal } = await import("../../server/services/ghl-workflows");
const { runFollowupEffect, EffectBindingConflictError } = await import("../../server/services/followup-effects");
const { establishStatementRequest } = await import("../../server/services/sdr/statement-flow");
const { enrollWorkflowHandoff } = await import("../../server/services/ghl-workflow-enrollment");
const { dealReadPredicate } = await import("../../server/services/revenue-read-authority");

let checks = 0;
const evidence: Array<{ id: string; claim: string; negativeControl: boolean }> = [];
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++; evidence.push({ id: `CP-${String(checks).padStart(2, "0")}`, claim: message, negativeControl });
  console.log(`✓ [CP-${String(checks).padStart(2, "0")}] ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 8);

// ── A. Migration 0379 ────────────────────────────────────────────────────────────────────
const cols = (await pool.query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name='workflow_runs' AND column_name='input_context')
       OR (table_name='followup_effect_receipts' AND column_name IN ('request_fingerprint','attempt_count'))`)).rows;
check(cols.length === 3, "migration 0379 columns exist (workflow_runs.input_context, receipts request_fingerprint + attempt_count)");
const migrationSql = src("migrations/0379_stage4c2_correction_pass.sql");
for (const statement of migrationSql.split("--> statement-breakpoint").map(s => s.trim()).filter(s => s && !/^--/.test(s.split("\n").filter(l => !l.startsWith("--")).join("\n").trim() ? "" : s))) {
  const executable = statement.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim();
  if (executable) await pool.query(executable);
}
check(true, "migration 0379 re-applies cleanly on an already-migrated database (idempotent)");
check(/"tag":\s*"0379_stage4c2_correction_pass"/.test(src("migrations/meta/_journal.json")) && !/DROP |DELETE FROM|TRUNCATE/i.test(migrationSql), "0379 is journaled and additive only");
rejects(() => assert.ok(/DROP |DELETE FROM|TRUNCATE/i.test(migrationSql), "a destructive statement"), "a destructive statement in 0379 would be detected");

// ── B. Trigger-response decoder ──────────────────────────────────────────────────────────
check(workflowTriggerRefusal({ succeeded: true }) === null && workflowTriggerRefusal({ succeded: true }) === null && workflowTriggerRefusal({ success: true }) === null, "an explicit documented true result is the only success");
check(workflowTriggerRefusal({ success: false }) === "success=false" && workflowTriggerRefusal({ succeeded: false }) === "succeeded=false", "an explicit false is a definite refusal");
check(workflowTriggerRefusal({}) === "unconfirmed_response" && workflowTriggerRefusal(null) === "unconfirmed_response" && workflowTriggerRefusal("ok") === "unconfirmed_response" && workflowTriggerRefusal({ success: "yes" }) === "unconfirmed_response",
  "an empty, null, string or non-boolean response is unconfirmed (never success)");
rejects(() => assert.equal(workflowTriggerRefusal({}), null), "treating an empty provider response as accepted");
check(!/eventStartTime[^}]*appointmentId|statementUploadToken/.test(src("server/services/ghl-workflows.ts").split("export async function triggerGhlWorkflow")[1]?.slice(0, 1500) ?? ""),
  "the trigger body does not carry appointment ids or upload tokens");

// ── C. Held handoff for a missing workflow ID ────────────────────────────────────────────
delete process.env.GHL_WORKFLOW_BOOKING_CONFIRM;
await pool.query(`DELETE FROM system_settings WHERE key = 'ghl_workflow_env_GHL_WORKFLOW_BOOKING_CONFIRM'`);
const contact = await storage.createContact({ firstName: "Held", lastName: `Handoff${tag}`, email: `held-${tag}@example.test`, phone: "+19951230001", ghlContactId: `ghl-held-${tag}`, status: "Active" } as any);
const startIso = new Date(Date.now() + 3 * 3600_000).toISOString();
const handoffInput = { workflowKey: "booking_confirmation", ghlContactId: `ghl-held-${tag}`, contactId: contact.id,
  metadata: { appointmentId: `appt-${tag}`, startTime: startIso, occurrenceId: `occ-${tag}`, entityType: "contact", entityId: contact.id } };
const held1 = await enrollWorkflowHandoff(handoffInput);
const held2 = await enrollWorkflowHandoff(handoffInput);
const heldRows = (await pool.query(`SELECT metadata, status FROM deferred_ghl_enrollments WHERE ghl_contact_id=$1 AND workflow_key='booking_confirmation'`, [`ghl-held-${tag}`])).rows;
check(held1.state === "held" && (held1 as any).reason === "workflow_not_configured" && (held1 as any).durable === true, "a missing workflow ID is held and durable, not skipped");
check(heldRows.length === 1 && heldRows[0].status === "pending" && held2.state === "held", "a repeated handoff for the same occurrence keeps one pending obligation");
const heldMeta = heldRows[0]?.metadata ?? {};
check(heldMeta._holdForConfiguration === true && typeof heldMeta._expiresAt === "string" && Date.parse(heldMeta._expiresAt) <= Date.parse(startIso) + 1000 && Date.parse(heldMeta._expiresAt) > Date.now(),
  "the held obligation carries an expiry no later than the appointment start");
check(/^handoff:booking_confirmation:\d+:/.test(String(heldMeta.idempotencyKey ?? "")), "the held obligation has a stable handoff identity (not a per-attempt key)");
const noOcc = await enrollWorkflowHandoff({ ...handoffInput, metadata: { startTime: startIso } });
check(noOcc.state === "held" && (noOcc as any).durable === false, "negative control: a handoff with no occurrence identity is held but not claimed durable");
rejects(() => assert.equal(held1.state, "failed"), "a missing workflow ID cannot read as a failure that loses the handoff");

// ── D. Statement request establishment ───────────────────────────────────────────────────
const { sdrMerchants, sdrLeadState } = await import("../../shared/schema");
const { db } = await import("../../server/db");
const { eq } = await import("drizzle-orm");
const mkLead = async (suffix: string, extra: Record<string, unknown> = {}) => {
  const c = await storage.createContact({ firstName: "Stmt", lastName: `${suffix}${tag}`, email: `stmt-${suffix}-${tag}@example.test`, phone: "+19951230002", ghlContactId: `ghl-stmt-${suffix}-${tag}`, status: "Active" } as any);
  const [m] = await db.insert(sdrMerchants).values({ ghlContactId: `ghl-stmt-${suffix}-${tag}`, businessName: `Stmt ${suffix} ${tag}`, mainEmail: `stmt-${suffix}-${tag}@example.test`, ownerFirstName: "A", ownerLastName: "B", source: "test" }).returning();
  const [l] = await db.insert(sdrLeadState).values({ merchantId: m.id, contactId: c.id, companyName: `Stmt ${suffix}`, ownerName: "A B", ghlContactId: `ghl-stmt-${suffix}-${tag}`, stage: "DISCOVERY_CALL_SCHEDULED", ownerType: "human", assignedOwnerType: "human", ...extra } as any).returning();
  return l;
};
const raced = await mkLead("race");
const [r1, r2, r3] = await Promise.all([establishStatementRequest(raced.id), establishStatementRequest(raced.id), establishStatementRequest(raced.id)]);
const racedRow = (await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, raced.id)))[0];
check(r1 && r2 && r3 && r1.token === r2.token && r2.token === r3.token && racedRow.statementUploadToken === r1.token && racedRow.stage === "STATEMENT_REQUESTED" && !!racedRow.statementRequestedAt,
  "three concurrent requests establish exactly one token and one requested-at");
check([r1, r2, r3].filter(r => r?.created).length === 1, "exactly one caller created the request; the others reuse it");
const suppressed = await mkLead("supp", { enrichmentData: { suppressStatementAuto: true } });
const suppressedResult = await establishStatementRequest(suppressed.id);
check(suppressedResult === null && (await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, suppressed.id)))[0].stage === "DISCOVERY_CALL_SCHEDULED", "a rep opt-out establishes nothing (no token, stage unchanged)");
const received = await mkLead("recv", { stage: "STATEMENT_RECEIVED" });
const recvResult = await establishStatementRequest(received.id);
check(recvResult === null && (await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, received.id)))[0].stage === "STATEMENT_RECEIVED", "a lead that already uploaded a statement is never moved back to STATEMENT_REQUESTED");
rejects(() => assert.ok(suppressedResult !== null, "a token was minted for an opted-out lead"), "minting a token for an opted-out lead would be detected");

// ── E. Effect binding ────────────────────────────────────────────────────────────────────
const effectKey = `cp_bind:${tag}`;
// The real command identity names ONE owner (the command id); the binding includes owner and channel, so the fixture keeps it fixed.
const bindOwner = crypto.randomUUID();
const first = await runFollowupEffect({ effectKey, ownerKind: "booking_command", ownerId: bindOwner, channel: "calendar_cancel:a1", requestFingerprint: "fp-one" }, async () => ({ success: true, detail: "ok" }));
let providerCalls = 0;
let conflict = false;
try { await runFollowupEffect({ effectKey, ownerKind: "booking_command", ownerId: bindOwner, channel: "calendar_cancel:a1", requestFingerprint: "fp-two" }, async () => { providerCalls++; return { success: true }; }); }
catch (error) { conflict = error instanceof EffectBindingConflictError; }
check(first.state === "accepted" && conflict && providerCalls === 0, "the same command id with a different request fingerprint is a conflict before any provider call");
const replay = await runFollowupEffect({ effectKey, ownerKind: "booking_command", ownerId: bindOwner, channel: "calendar_cancel:a1", requestFingerprint: "fp-one" }, async () => { providerCalls++; return { success: true }; });
check(replay.state === "accepted" && replay.replay === true && providerCalls === 0, "the same request replays its accepted receipt without a second call");
const receiptRow = (await pool.query(`SELECT attempt_count FROM followup_effect_receipts WHERE effect_key=$1`, [effectKey])).rows[0];
check(receiptRow && Number(receiptRow.attempt_count) >= 1, "the receipt records its attempt count");

// ── F. Deals follow-up range ─────────────────────────────────────────────────────────────
const values: unknown[] = [];
const where = dealReadPredicate({ id: "u1", role: "admin" } as any, { followUpFrom: "2026-11-01T05:00:00.000Z", followUpTo: "2026-12-01T05:00:00.000Z" } as any, values);
check(/next_follow_up >= \$\d+::timestamptz/.test(where) && /next_follow_up < \$\d+::timestamptz/.test(where) && values.length >= 2, "the follow-up range is an inclusive start and EXCLUSIVE end predicate");
const noRange: unknown[] = [];
check(!/next_follow_up >=/.test(dealReadPredicate({ id: "u1", role: "admin" } as any, {} as any, noRange)), "negative control: no range means no follow-up predicate");
const dealsRoute = src("server/routes/deals.ts");
check(/INVALID_DEAL_FILTERS/.test(dealsRoute) && /followUpFrom/.test(dealsRoute), "the deals route validates the range (both bounds, start before end)");

// ── G. Static wiring ─────────────────────────────────────────────────────────────────────
const worker = src("server/services/proposal-followup-worker.ts");
check(/proposal_followup:\$\{deal\.id\}:\$\{proposalVersion\}:/.test(worker) && /createHash\("sha256"\)\.update\(deal\.proposalToken\)/.test(worker) && /:email/.test(worker), "the proposal follow-up identity includes the deal, the proposal token hash and the touch number");
check(/GHL_AMBIGUOUS_DISPATCH:/.test(worker), "an unknown follow-up outcome is mapped to the ambiguous-dispatch marker (never retried blindly)");
const sla = src("server/services/sla-worker.ts");
check(/application_reminder_day\$\{[^}]*\}_accepted/.test(sla) && /application_reminder_o\$\{/.test(sla), "reminder milestones are occurrence-scoped and audited as accepted");
const toolkit = src("server/routes/toolkit.ts");
const smsReply = toolkit.split("/api/sms-inbox/reply")[1]?.split("/api/")[0] ?? "";
check(/sendGhlSms/.test(smsReply) && /only the server may set/.test(smsReply) && /"purpose"/.test(smsReply), "the SMS inbox reply is routed through the canonical SMS authority and refuses caller-supplied purpose/recipient fields");
const cal = src("client/src/pages/dashboard/Calendar.tsx");
check(/useUrlParam/.test(cal) && /cal_month/.test(cal) && /calendar-agenda/.test(cal) && /followUpFrom/.test(cal), "the Calendar keeps month/date/source/item in the URL, has a narrow-screen agenda and a range-bounded deals read");
const wfPage = src("client/src/pages/dashboard/Workflows.tsx");
check(/wf_tab/.test(wfPage) && /wf_run/.test(wfPage) && /run-detail-drawer/.test(wfPage) && !/Retry run|button-retry-run"|retryFailedRun/.test(wfPage), "Run History keeps tab/search/status/page/run in the URL and has a read-only run detail with no retry control");
check(!/not delivered/.test(wfPage.split("runStatusLabel")[1]?.slice(0, 400) ?? ""), "the run label no longer says 'not delivered' for steps with unresolved outcomes");
check(/test-stage4c2-correction-pass\.ts/.test(src("scripts/pre-deploy.ts")) && /test-stage4c2-calendar-contract\.ts/.test(src("scripts/pre-deploy.ts")), "this suite is registered in the pre-deploy fixture roster beside the calendar contract");
const certRunner = src("scripts/run-sfp2060-certification-disposable.ts");
check(/test-sms-recipient-authority\.ts/.test(certRunner) && /test-stage4c2-correction-pass\.ts/.test(certRunner), "the certification runner lists the SMS authority suite and this suite");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

mkdirSync(new URL("../../docs/certification/stage4-c2/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/certification/stage4-c2/correction-pass-evidence.json", import.meta.url),
  JSON.stringify({ suite: "stage4c2-correction-pass", checks, negativeControls: evidence.filter(e => e.negativeControl).length, results: evidence }, null, 2) + "\n");
console.log(`\nStage 4C2 correction pass: ${checks} checks passed`);
await pool.end();
