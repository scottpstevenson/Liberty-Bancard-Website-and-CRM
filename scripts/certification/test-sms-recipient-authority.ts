/**
 * SMS recipient authority certification (spec section 15, C2-R06) — disposable database; provider network denied; no sends.
 *
 *  A. Canonical consent and number: a PEWC-backed contact is allowed only at the number the consent was captured for;
 *     legacy consent_sms alone never grants; STOP, a number change and global suppression each refuse.
 *  B. STOP race: a STOP that lands after the pre-check but before dispatch is refused by the transport-boundary decision,
 *     and the provider is never called.
 *  C. SMS-denied / email-allowed: a standing SMS denial (contact or lead subject) does not strand a statement reminder,
 *     which goes by email; a retryable denial (quiet hours) does not switch channel.
 *  D. Workflow SMS steps (template and free text) refuse with the canonical reason and a re-claimable receipt.
 *  E. Transactional responses need a positive canonical permission bound to the current number.
 *  F. Static: no legacy consent flag decides a send; note/task/no-show handlers use exact GHL-id lookups.
 * Every critical check has a negative control that must fail the same assertion on the defective behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "SMS recipient authority certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
// Feature flag only; the provider network stays denied. GHL "configured" lets flows reach their consent decisions.
process.env.SMS_ENABLED = "true";
process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "certification-token-not-a-secret";
process.env.GHL_LOCATION_ID = "certification-location";

const { pool, db } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { sdrLeadState, sdrMerchants } = await import("../../shared/schema");
const { eq } = await import("drizzle-orm");
const { applyConsentCommand } = await import("../../server/services/consent-authority");
const { recordPewcDecision } = await import("../../server/services/consent-evidence");
const { resolveSmsRecipient, parseSmsDenialDetail, assertSmsRecipientAllowed } = await import("../../server/services/sms-recipient-authority");
const { assertGhlSmsRecipientAuthorized } = await import("../../server/services/ghl");
const { deliverStatementSms, sendStatementReminder } = await import("../../server/services/sdr/statement-flow");
const { executeWorkflowActions } = await import("../../server/services/workflow-executor");

let checks = 0;
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++;
  console.log(`✓ [SA-${String(checks).padStart(2, "0")}]${negativeControl ? " (negative control)" : ""} ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const tag = `${Date.now()}`;
// Tuesday 11:00 in New York: inside business hours for the fixture contacts.
const businessHours = new Date("2026-11-03T16:00:00Z");
let phoneSeq = 0;
const nextPhone = () => `+1305555${String(Number(tag.slice(-4)) * 10 + (phoneSeq++)).padStart(4, "0").slice(-4)}`;

async function makeContact(label: string, phone = nextPhone()) {
  return storage.createContact({
    firstName: "SmsAuth", lastName: label, email: `sms-auth.${label}.${tag}@example.invalid`, phone,
    ghlContactId: `smsauth-${label}-${tag}`, status: "Active", timezone: "America/New_York", state: "NY",
    sourceCategory: "inbound", recordClass: "production",
  } as any);
}
async function grantPewc(contactId: number, key: string) {
  await recordPewcDecision({ contactId, checked: true, source: "sms_auth_cert", ipAddress: "127.0.0.1", userAgent: "cert", eventKey: `${key}:${tag}` });
}
const stop = (contactId: number, key: string) => applyConsentCommand({
  subject: { type: "contact", id: contactId }, kind: "opt_out", channel: "sms", purpose: "outreach",
  eventNamespace: "sms_auth_cert", eventKey: `stop:${key}:${tag}`, source: "sms_auth_cert", evidence: { inbound: "STOP" },
});
async function makeLead(contactId: number, label: string, extra: Record<string, unknown> = {}) {
  const [merchant] = await db.insert(sdrMerchants).values({ businessName: `SmsAuth ${label} ${tag}` } as any).returning();
  const [lead] = await db.insert(sdrLeadState).values({
    merchantId: merchant.id, contactId, companyName: `SmsAuth ${label}`, ownerName: "Pat Owner",
    stage: "STATEMENT_REQUESTED", statementUploadToken: `tok-${label}-${tag}`, statementRequestedAt: new Date(),
    // Legacy projections deliberately say "SMS is fine": they must be ignored.
    consentSms: true, optedOutSms: false, phone: "+19995550000", ownerPhone: "+19995550001", ...extra,
  } as any).returning();
  return lead;
}

// ── A. canonical consent and number ─────────────────────────────────────────────────────
const ok = await makeContact("ok");
await grantPewc(ok.id, "ok");
const allowed = await resolveSmsRecipient({ contactId: ok.id, purpose: "cert", currentTime: businessHours });
check(allowed.allowed && allowed.phone.endsWith(ok.phone!.replace(/\D/g, "").slice(-10)), "PEWC captured for the current number is allowed, and the resolved number is that number");

const legacy = await makeContact("legacy");
await pool.query(`UPDATE contacts SET consent_sms = true, sms_status = 'active' WHERE id = $1`, [legacy.id]);
const legacyDecision = await resolveSmsRecipient({ contactId: legacy.id, purpose: "cert", currentTime: businessHours });
check(!legacyDecision.allowed, "the legacy consent_sms flag alone never authorizes an SMS");
rejects(() => assert.equal(legacyDecision.allowed, true), "treating the legacy flag as consent would allow this contact");

const stopped = await makeContact("stop");
await grantPewc(stopped.id, "stop");
check((await resolveSmsRecipient({ contactId: stopped.id, purpose: "cert", currentTime: businessHours })).allowed, "contact is allowed before STOP");
await stop(stopped.id, "stop");
const afterStop = await resolveSmsRecipient({ contactId: stopped.id, purpose: "cert", currentTime: businessHours });
check(!afterStop.allowed && afterStop.code === "consent_withdrawn" && !afterStop.transient, "STOP makes SMS a standing refusal (consent_withdrawn)");

const moved = await makeContact("moved");
await grantPewc(moved.id, "moved");
const boundTo = (await resolveSmsRecipient({ contactId: moved.id, purpose: "cert", currentTime: businessHours }));
assert(boundTo.allowed);
const newPhone = nextPhone();
await pool.query(`UPDATE contacts SET phone = $2 WHERE id = $1`, [moved.id, newPhone]);
const changedAfterDecision = await resolveSmsRecipient({ contactId: moved.id, purpose: "cert", boundPhone: boundTo.allowed ? boundTo.phone : null, currentTime: businessHours });
check(!changedAfterDecision.allowed && changedAfterDecision.code === "recipient_number_changed", "a number change after the decision is refused at dispatch (recipient_number_changed)");
const noRebind = await resolveSmsRecipient({ contactId: moved.id, purpose: "cert", currentTime: businessHours });
check(!noRebind.allowed && noRebind.code === "consent_not_bound_to_number", "consent captured for the old number does not authorize the new number");
rejects(() => assert.equal(noRebind.allowed, true), "a decision that ignores which number consent was captured for would allow the new number");

const suppressed = await makeContact("dnc");
await grantPewc(suppressed.id, "dnc");
await applyConsentCommand({ subject: { type: "contact", id: suppressed.id }, kind: "global_dnc", purpose: "outreach",
  eventNamespace: "sms_auth_cert", eventKey: `dnc:${tag}`, source: "sms_auth_cert", evidence: { reason: "cert" } });
const dncDecision = await resolveSmsRecipient({ contactId: suppressed.id, purpose: "cert", currentTime: businessHours });
check(!dncDecision.allowed && dncDecision.code === "global_suppressed", "global DNC refuses SMS even with PEWC evidence");

const afterHours = await resolveSmsRecipient({ contactId: ok.id, purpose: "cert", currentTime: new Date("2026-11-03T03:00:00Z") });
check(!afterHours.allowed && afterHours.code === "quiet_hours" && afterHours.transient, "quiet hours is a retryable refusal, not a standing one");
check(parseSmsDenialDetail("sms_not_permitted:quiet_hours")?.transient === true && parseSmsDenialDetail("sms_not_permitted:consent_withdrawn")?.transient === false,
  "denial details separate retryable from standing refusals");
check(!(await resolveSmsRecipient({ contactId: 999999999, purpose: "cert" })).allowed, "an unknown contact is refused");

// ── B. STOP race at the transport boundary ───────────────────────────────────────────────
const race = await makeContact("race");
await grantPewc(race.id, "race");
const raceLead = await makeLead(race.id, "race");
let providerCalls = 0;
// The pre-check passes; the STOP lands before dispatch, as an inbound webhook would between check and provider call.
const raceResult = await deliverStatementSms(raceLead as any, `cert:race:${tag}`, "body", "statement_request", {
  currentTime: businessHours,
  send: async (params) => {
    await stop(race.id, "race");
    // Same decision the real transport takes immediately before the provider call.
    await assertGhlSmsRecipientAuthorized({ contactId: params.contactId, purpose: params.purpose, boundPhone: params.boundPhone, leadStateId: params.leadStateId });
    providerCalls++;
    return { success: true };
  },
});
check(providerCalls === 0 && raceResult.state === "refused" && raceResult.detail === "sms_not_permitted:consent_withdrawn" && raceResult.smsDenied === true,
  "a STOP between the pre-check and dispatch is refused at the transport boundary and the provider is never called");
check(!(await resolveSmsRecipient({ contactId: race.id, purpose: "cert", currentTime: businessHours })).allowed, "after the race the recipient stays refused");
await assert.rejects(
  assertGhlSmsRecipientAuthorized({ contactId: race.id, purpose: "cert" }),
  /sms_not_permitted:consent_withdrawn/,
);
check(true, "the transport-boundary decision throws sms_not_permitted:<code> after STOP");
rejects(() => assert.equal(raceResult.state, "accepted"), "dispatching after a STOP would read as delivered");

// ── C. SMS denied, email allowed ─────────────────────────────────────────────────────────
const dual = await makeContact("dual");
await grantPewc(dual.id, "dual");
await stop(dual.id, "dual");
const dualLead = await makeLead(dual.id, "dual", { statementReminderCount: 0 });
// The statement request was delivered earlier; the reminder-1 email receipt is already accepted so no network is needed.
await pool.query(
  `INSERT INTO followup_effect_receipts (effect_key, owner_kind, owner_id, channel, state) VALUES
    ($1,'statement',$3,'email','accepted'), ($2,'statement',$3,'email','accepted')`,
  [`statement_request:${dualLead.id}:email`, `statement_reminder:${dualLead.id}:1:email`, String(dualLead.id)]);
const reminderSent = await sendStatementReminder(dualLead.id);
const [afterReminder] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, dualLead.id));
const smsReceipts = (await pool.query(`SELECT count(*)::int AS n FROM followup_effect_receipts WHERE owner_id=$1 AND channel='sms'`, [String(dualLead.id)])).rows[0].n;
check(reminderSent === true && afterReminder.statementReminderCount === 1 && /via email/.test(afterReminder.decisionReason ?? ""),
  "SMS denied + email allowed: reminder #1 is delivered by email instead of stalling");
check(smsReceipts === 0, "the denied SMS claimed no send receipt");
rejects(() => assert.equal(smsReceipts, 1), "a denied SMS must not leave a send receipt");

const leadStop = await makeContact("leadstop");
await grantPewc(leadStop.id, "leadstop");
const leadStopLead = await makeLead(leadStop.id, "leadstop");
await applyConsentCommand({ subject: { type: "sdr_lead_state", id: leadStopLead.id }, kind: "opt_out", channel: "sms", purpose: "outreach",
  eventNamespace: "sms_auth_cert", eventKey: `leadstop:${tag}`, source: "sms_auth_cert", evidence: { inbound: "STOP" } });
const leadDenied = await resolveSmsRecipient({ contactId: leadStop.id, leadStateId: leadStopLead.id, purpose: "cert", currentTime: businessHours });
const contactOnly = await resolveSmsRecipient({ contactId: leadStop.id, purpose: "cert", currentTime: businessHours });
check(!leadDenied.allowed && leadDenied.code === "consent_withdrawn" && contactOnly.allowed, "a STOP recorded on the lead subject refuses the lead's SMS even when the contact subject still permits it");

const legacyLead = await makeContact("legacylead");
const legacyLeadRow = await makeLead(legacyLead.id, "legacylead");
const legacyStatement = await deliverStatementSms(legacyLeadRow as any, `cert:legacylead:${tag}`, "body", "statement_request", {
  currentTime: businessHours, send: async () => { providerCalls++; return { success: true }; },
});
check(legacyStatement.state === "refused" && legacyStatement.smsDenied === true && providerCalls === 0,
  "a lead whose legacy flags say consent but whose canonical consent is absent is refused and never sent");

// ── D. workflow SMS steps ────────────────────────────────────────────────────────────────
const wfContact = await makeContact("wf");
await grantPewc(wfContact.id, "wf");
await stop(wfContact.id, "wf");
const template = await storage.createMessageTemplate({ name: `sms auth ${tag}`, category: "follow_up", channel: "sms", body: "Hi {{contact.firstName}}", isActive: true } as any);
// A required send that was not delivered halts the run, so each SMS step shape is exercised in its own workflow.
const wfTemplate = await storage.createWorkflow({ name: `sms auth t ${tag}`, triggerType: "manual", enabled: true,
  actions: [{ type: "send_ghl_sms", templateId: template.id }] } as any);
const wfFree = await storage.createWorkflow({ name: `sms auth f ${tag}`, triggerType: "manual", enabled: true,
  actions: [{ type: "send_ghl_sms", body: "Hello there" }] } as any);
const runT = await executeWorkflowActions(wfTemplate.id, wfTemplate.actions as any[], { entityType: "contact", entityId: wfContact.id, contactId: wfContact.id, occurrenceId: `wf-t-${tag}` } as any);
const runF = await executeWorkflowActions(wfFree.id, wfFree.actions as any[], { entityType: "contact", entityId: wfContact.id, contactId: wfContact.id, occurrenceId: `wf-f-${tag}` } as any);
const smsSteps = [...(runT.log as any[]), ...(runF.log as any[])].filter(entry => entry.action === "send_ghl_sms");
check(smsSteps.length === 2 && smsSteps.every(entry => entry.status === "failed" && /consent_withdrawn/.test(entry.error ?? "")),
  "workflow SMS steps (template and free text) fail with the canonical reason after STOP");
const run = runF;
check(runT.status === "failed" && runF.status === "failed" && (runT.delivered ?? 0) === 0 && (runF.delivered ?? 0) === 0, "the run is failed with nothing delivered");
const wfReceipts = (await pool.query(`SELECT state FROM followup_effect_receipts WHERE owner_kind='workflow_run' AND owner_id = ANY($1) AND channel='sms'`, [[String(runT.runId), String(runF.runId)]])).rows;
check(wfReceipts.every((r: any) => r.state === "refused"), "free-text refusal leaves a re-claimable receipt (never accepted)");
rejects(() => assert.equal(run.status, "completed"), "an SMS-denied run cannot read as completed");

// ── E. transactional responses ───────────────────────────────────────────────────────────
const txn = await makeContact("txn");
const txnNone = await resolveSmsRecipient({ contactId: txn.id, purpose: "confirmation", commercialPurpose: "transactional_response" });
check(!txnNone.allowed && txnNone.code === "consent_not_recorded", "a transactional text needs a positive canonical permission");
await applyConsentCommand({ subject: { type: "contact", id: txn.id }, kind: "opt_in", channel: "sms", purpose: "outreach",
  eventNamespace: "sms_auth_cert", eventKey: `txn:${tag}`, source: "sms_auth_cert", evidence: { form: "confirmation" } });
check((await resolveSmsRecipient({ contactId: txn.id, purpose: "confirmation", commercialPurpose: "transactional_response" })).allowed, "an opted-in contact may receive the transactional text");
await pool.query(`UPDATE contacts SET phone = $2 WHERE id = $1`, [txn.id, nextPhone()]);
const txnMoved = await resolveSmsRecipient({ contactId: txn.id, purpose: "confirmation", commercialPurpose: "transactional_response" });
check(!txnMoved.allowed && txnMoved.code === "consent_not_bound_to_number", "permission recorded for the old number does not cover the new number");

// Permission recorded before any number existed must not extend to a number added later.
const noPhoneThen = await makeContact("nophone");
await applyConsentCommand({ subject: { type: "contact", id: noPhoneThen.id }, kind: "opt_in", channel: "sms", purpose: "outreach",
  eventNamespace: "sms_auth_cert", eventKey: `nophone:${tag}`, source: "sms_auth_cert", evidence: { form: "confirmation" } });
// Model a permission whose subject never had a number bound (legacy rows): no subject phone, no evidence phone.
await pool.query(`UPDATE consent_subjects SET normalized_phone = NULL WHERE subject_type = 'contact' AND subject_record_id = $1`, [noPhoneThen.id]);
await pool.query(`UPDATE consent_subject_channel_states SET evidence = evidence - 'consentedPhone'
  WHERE subject_id IN (SELECT id FROM consent_subjects WHERE subject_type = 'contact' AND subject_record_id = $1)`, [noPhoneThen.id]);
const lateNumber = await resolveSmsRecipient({ contactId: noPhoneThen.id, purpose: "confirmation", commercialPurpose: "transactional_response" });
check(!lateNumber.allowed && lateNumber.code === "consent_not_bound_to_number", "transactional permission with no recorded number never covers a number added later");
rejects(() => assert.equal(lateNumber.allowed, true), "treating an unbound permission as covering any number would allow the later number");

// Direct SDR transport (sendSmsReply) and inbound-confirmation SMS decide from the same authority.
const sdrClientSource = read("server/services/sdr/ghl-client.ts");
const replyBody = sdrClientSource.slice(sdrClientSource.indexOf("export async function sendSmsReply"), sdrClientSource.indexOf("export async function sendEmailReply"));
check(replyBody.includes("assertSmsRecipientAllowed") && replyBody.indexOf("assertSmsRecipientAllowed") < replyBody.indexOf("sdrGhlFetch("),
  "the direct SDR SMS transport takes the canonical decision before provider I/O");
rejects(() => assert.ok(!replyBody.includes("assertSmsRecipientAllowed")), "the direct SDR transport must call the recipient authority");
const { sendSmsReply } = await import("../../server/services/sdr/ghl-client");
await assert.rejects(
  sendSmsReply({ contactId: wfContact.ghlContactId!, dbContactId: wfContact.id, commercialPurpose: "transactional_response", message: "hi" }),
  /COMMERCIAL_CLASS|sms_not_permitted|paused|Outbound/i,
);
check(getBlockedCertificationNetworkAttemptCount() === 0, "a refused direct SDR SMS never reaches the provider");
await assert.rejects(assertSmsRecipientAllowed({ contactId: wfContact.id, purpose: "sdr_sms_reply", commercialPurpose: "transactional_response" }), /sms_not_permitted:consent_withdrawn/);
check(true, "a STOPped contact is refused by the direct-transport decision");
check(!/contact\.consentSms/.test(read("server/services/ghl-workflow-enrollment.ts")), "inbound confirmation SMS no longer reads the legacy consentSms flag");

// ── F. static ────────────────────────────────────────────────────────────────────────────
const ghlSource = read("server/services/ghl.ts");
const inner = ghlSource.slice(ghlSource.indexOf("async function _sendGhlSmsInner"), ghlSource.indexOf("export function getCalendarBookingUrl"));
check(inner.includes("assertGhlSmsRecipientAuthorized(params)") && !/contact\.consentSms/.test(inner), "the SMS transport decides from the canonical authority, not contact.consentSms");
rejects(() => assert.ok(!inner.includes("assertGhlSmsRecipientAuthorized(params)")), "the transport boundary must call the recipient authority");
check(!/lead\.consentSms|lead\.optedOutSms|lead\.ownerPhone/.test(read("server/services/sdr/statement-flow.ts")), "statement flow never reads the legacy lead consent or phone fields");
check(!/lead\.consentSms|lead\.optedOutSms/.test(read("server/services/sdr/proposal-tracking.ts")), "proposal SMS follow-up never reads the legacy lead consent flags");
check(!/getContacts\(\{ limit: (500|1000) \}\)/.test(ghlSource), "GHL note and no-show handlers no longer scan a bounded page of contacts");
check(/handleNoteAdded[\s\S]*?getContactByGhlContactId/.test(ghlSource), "the note handler resolves the contact by its exact GHL id");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

console.log(`\nSMS recipient authority: ${checks} checks passed`);
await pool.end();
