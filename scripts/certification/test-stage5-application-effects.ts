/**
 * Stage 5 application-effects certification (disposable database; no provider, no network, no sends).
 *
 * R02: outbox effects run only under the current claim; a resolved workflow {success:false,skipped:true} is
 * never "delivered"; a recipient-facing send that may have reached the provider is held (never re-sent);
 * a refused conditional e-sign write is re-read instead of ignored; an old queued consent grant keeps its
 * submission time and so cannot override a later STOP.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 application effects certification" });
process.env.NODE_ENV = "test";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const worker = await import("../../server/services/merchant-application-outbox-worker");
const pauseAuthority = await import("../../server/services/outbound-pause-authority");
const { applyConsentCommand } = await import("../../server/services/consent-authority");
const { resolveSmsRecipient } = await import("../../server/services/sms-recipient-authority");

let checks = 0;
const check = (v: unknown, message: string, negative = false) => { assert(v, message); checks++; console.log(`✓ [S5E-${String(checks).padStart(2, "0")}]${negative ? " (negative control)" : ""} ${message}`); };
const id = randomUUID().slice(0, 8);
const T = worker.__test__;

const setPause = async (state: "paused" | "unpaused") => {
  const updated = await pool.query(`UPDATE outbound_pause_control SET state=$1, reason='stage5 effects certification', committed_at=NOW()`, [state]);
  if (updated.rowCount === 0) {
    await pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at) VALUES ($1,'stage5 effects certification',1,'s5e-cert',$2,NOW())`, [state, `s5e-${randomUUID()}`]);
  }
  pauseAuthority.invalidatePauseStateCache();
};
await setPause("unpaused");
process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID = "tpl-s5e";

let seq = 0;
const nextPhone = () => `+1305556${String(Number(id.slice(0, 3).replace(/\D/g, "1")) % 10)}${String(1000 + (seq++)).slice(-4)}`;
async function makeApp(label: string, opts: { ghl?: string | null; esignStatus?: string } = {}) {
  const email = `s5e-${label}-${id}@fixture.invalid`;
  const contactId = (await pool.query(
    `INSERT INTO contacts(first_name,last_name,email,phone,ghl_contact_id) VALUES('S5E',$1,$2,$3,$4) RETURNING id`,
    [label, email, nextPhone(), opts.ghl === undefined ? `ghl-${label}-${id}` : opts.ghl])).rows[0].id as number;
  const appId = (await pool.query(
    `INSERT INTO merchant_applications(contact_id, owner_email, owner_first_name, owner_last_name, legal_business_name, esign_status)
     VALUES($1,$2,'S5E',$3,$4,$5) RETURNING id`,
    [contactId, email, label, `S5E ${label} LLC`, opts.esignStatus ?? null])).rows[0].id as number;
  return { contactId, appId };
}
await pool.query(`DELETE FROM merchant_application_protected_outbox WHERE status IN ('pending','failed','processing')`);
let k = 0;
const enqueue = async (appId: number, eventType: string, payload: Record<string, unknown> = {}) => (await pool.query(
  `INSERT INTO merchant_application_protected_outbox(application_id,event_type,idempotency_key,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING id`,
  [appId, eventType, `s5e-${id}-${k++}`, JSON.stringify(payload)])).rows[0].id as string;
const row = async (rid: string) => (await pool.query(`SELECT status, attempts, last_error FROM merchant_application_protected_outbox WHERE id=$1`, [rid])).rows[0];
const audit = async (action: string, appId: number) => Number((await pool.query(`SELECT count(*) c FROM audit_logs WHERE action=$1 AND entity_id=$2`, [action, appId])).rows[0].c);
const tick = () => T.tick();

// ── 1. Claim fence ─────────────────────────────────────────────────────────────────────
{
  const { appId } = await makeApp("fence");
  let calls = 0;
  T.testOverrides.approvedEmail = async (_i: any, hooks: any) => { calls++; await hooks.beforeDispatch(); return { status: "sent" }; };
  const rid = await enqueue(appId, "approval_email");
  const first = await T.claimOne();
  check(first && first.id === rid && first.attempts === 1, "the row is claimed with attempt 1");
  // Simulate a stale reclaim handing the row to a newer claim.
  await pool.query(`UPDATE merchant_application_protected_outbox SET status='pending', locked_at=NULL, available_at=now() WHERE id=$1`, [rid]);
  const second = await T.claimOne();
  check(second && second.attempts === 2, "a newer claim owns the row (attempt 2)");
  let lost = false;
  try { await T.processRow(first!); } catch (e) { lost = e instanceof T.ClaimLostError; }
  check(lost && calls === 0, "the superseded claim is refused before any effect runs");
  await T.processRow(second!);
  check(calls === 1, "the current claim runs the effect", false);
  let lostDirect = false;
  try { await T.assertCurrentClaim({ id: rid, attempts: 1 }); } catch { lostDirect = true; }
  check(lostDirect, "a claim check with a stale attempt number throws", true);
  await pool.query(`UPDATE merchant_application_protected_outbox SET status='delivered' WHERE id=$1`, [rid]);
}

// ── 2. Workflow enrollment results ─────────────────────────────────────────────────────
{
  const { appId } = await makeApp("wf");
  T.testOverrides.enroll = async () => ({ success: false, skipped: true, error: "Global outbound pause is active" });
  const paused = await enqueue(appId, "workflow_enroll");
  await tick();
  const r1 = await row(paused);
  check(r1.status === "pending" && r1.last_error === "waiting:outbound_paused", "a pause refusal is a durable wait, not delivered");

  await pool.query(`DELETE FROM merchant_application_protected_outbox WHERE id=$1`, [paused]);
  T.testOverrides.enroll = async () => ({ success: false, skipped: true, error: "Contact is on the do-not-contact list" });
  const skipped = await enqueue(appId, "workflow_enroll");
  await tick();
  const r2 = await row(skipped);
  check(r2.status === "dead_letter" && r2.last_error === "held:workflow_enroll_not_delivered", "a skipped enrollment is held with evidence, never marked delivered");
  check(await audit("merchant_application_workflow_enroll_not_delivered", appId) === 1, "the held enrollment leaves audit evidence");

  T.testOverrides.enroll = async () => ({ success: true });
  const ok = await enqueue(appId, "workflow_enroll");
  await tick();
  check((await row(ok)).status === "delivered", "an accepted enrollment is delivered");
}

// ── 3. Approval email possible-send uncertainty ────────────────────────────────────────
{
  const { appId } = await makeApp("mail");
  let calls = 0;
  T.testOverrides.approvedEmail = async (_i: any, hooks: any) => { calls++; await hooks.beforeDispatch(); throw new Error("socket hang up"); };
  const r1 = await enqueue(appId, "approval_email");
  await tick();
  const s1 = await row(r1);
  check(s1.status === "dead_letter" && s1.last_error === "held:possible_send_unconfirmed" && calls === 1, "a send that fails after dispatch began is held as possibly sent");
  check(await audit("merchant_application_approved_email_dispatch_started", appId) === 1 && await audit("merchant_application_approved_email_send_unconfirmed", appId) >= 1, "the dispatch marker and unconfirmed evidence are durable");

  T.testOverrides.approvedEmail = async (_i: any, hooks: any) => { calls++; await hooks.beforeDispatch(); return { status: "sent" }; };
  const r2 = await enqueue(appId, "approval_email");
  await tick();
  check((await row(r2)).status === "dead_letter" && calls === 1, "a later approval-email row is held and never re-sends", true);
  check(await audit("merchant_application_approved_email_sent", appId) === 0, "no sent evidence is written for an unconfirmed message");

  // A transient failure BEFORE dispatch is an ordinary retry (nothing could have been sent).
  const pre = await makeApp("mailpre");
  T.testOverrides.approvedEmail = async () => { throw new Error("contact lookup timed out"); };
  const r3 = await enqueue(pre.appId, "approval_email");
  await tick();
  const s3 = await row(r3);
  check(s3.status === "pending" && s3.attempts === 1, "a failure before dispatch stays retryable");

  const good = await makeApp("mailok");
  T.testOverrides.approvedEmail = async (_i: any, hooks: any) => { await hooks.beforeDispatch(); return { status: "sent" }; };
  const r4 = await enqueue(good.appId, "approval_email");
  await tick();
  check((await row(r4)).status === "delivered" && await audit("merchant_application_approved_email_sent", good.appId) === 1, "a confirmed send is delivered with sent evidence");

  // Decline path shares the same guard.
  const dec = await makeApp("decl");
  let dcalls = 0;
  T.testOverrides.declinedEmail = async (_i: any, hooks: any) => { dcalls++; await hooks.beforeDispatch(); throw new Error("timeout"); };
  const d1 = await enqueue(dec.appId, "decline_email");
  await tick();
  const d2 = await enqueue(dec.appId, "decline_email");
  await tick();
  check((await row(d1)).last_error === "held:possible_send_unconfirmed" && (await row(d2)).status === "dead_letter" && dcalls === 1, "the decline email is held and never re-sent after an unconfirmed dispatch");
}

// ── 4. E-sign dispatch and conditional-write refusal ───────────────────────────────────
{
  const a = await makeApp("esign1");
  let calls = 0;
  T.testOverrides.sendDocumentForEsign = async () => { calls++; throw new Error("ETIMEDOUT"); };
  const r1 = await enqueue(a.appId, "esign_send");
  await tick();
  check((await row(r1)).last_error === "held:possible_send_unconfirmed" && calls === 1, "an e-sign send that throws is held as possibly delivered");
  T.testOverrides.sendDocumentForEsign = async () => { calls++; return { success: true, documentId: "doc-never" }; };
  const r2 = await enqueue(a.appId, "esign_send");
  await tick();
  check((await row(r2)).status === "dead_letter" && calls === 1, "a second agreement is never sent while the first is unconfirmed", true);

  const refused = await makeApp("esign2");
  let n = 0;
  T.testOverrides.sendDocumentForEsign = async () => { n++; return n === 1 ? { success: false, error: "template" } : { success: true, documentId: "doc-2", signingUrl: "https://example.invalid/sign" }; };
  const r3 = await enqueue(refused.appId, "esign_send");
  await tick();
  const s3 = await row(r3);
  check(s3.status === "pending" && n === 1, "a resolved provider refusal is retryable");
  await pool.query(`UPDATE merchant_application_protected_outbox SET available_at=now() WHERE id=$1`, [r3]);
  await tick();
  const app2 = (await pool.query(`SELECT esign_status, esign_document_id FROM merchant_applications WHERE id=$1`, [refused.appId])).rows[0];
  check(n === 2 && (await row(r3)).status === "delivered" && app2.esign_status === "sent" && app2.esign_document_id === "doc-2", "the retry after a settled refusal sends once and records the document");

  const signed = await makeApp("esign3", { esignStatus: "signed" });
  T.testOverrides.sendDocumentForEsign = async () => ({ success: true, documentId: "doc-late" });
  const r4 = await enqueue(signed.appId, "esign_send");
  await tick();
  const app3 = (await pool.query(`SELECT esign_status, esign_document_id FROM merchant_applications WHERE id=$1`, [signed.appId])).rows[0];
  check(app3.esign_status === "signed" && app3.esign_document_id == null, "a conditional update refused for a signed application is respected (signed state not overwritten)");
  check(await audit("merchant_application_esign_sent_after_signed", signed.appId) === 1 && (await row(r4)).status === "delivered", "the late document id is kept as evidence only");
}

// ── 5. Consent chronology ──────────────────────────────────────────────────────────────
{
  const { PEWC_DISCLOSURE_VERSION } = await import("../../shared/consent-disclosures");
  const { appId, contactId } = await makeApp("consent");
  const phone = (await pool.query(`SELECT phone FROM contacts WHERE id=$1`, [contactId])).rows[0].phone as string;
  const submittedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // STOP arrives AFTER the application was submitted but BEFORE the queued grant runs.
  await applyConsentCommand({
    subject: { type: "contact", id: contactId }, kind: "opt_out", channel: "sms", purpose: "outreach",
    eventNamespace: "s5e_cert", eventKey: `stop:${id}`, source: "s5e_cert", evidence: { inbound: "STOP" },
  });
  const rid = await enqueue(appId, "consent_record", {
    consentedPhone: phone, disclosureVersion: PEWC_DISCLOSURE_VERSION, submissionId: `sub-${id}`, submittedAt,
    ipAddress: "203.0.113.9", userAgent: "cert",
  });
  await tick();
  check((await row(rid)).status === "delivered", "the queued grant is processed");
  const business = new Date("2026-11-03T16:00:00Z");
  const decision = await resolveSmsRecipient({ contactId, purpose: "cert", currentTime: business });
  check(!decision.allowed, "an old queued grant does not override the later STOP", true);

  const clean = await makeApp("consent2");
  const phone2 = (await pool.query(`SELECT phone FROM contacts WHERE id=$1`, [clean.contactId])).rows[0].phone as string;
  const rid2 = await enqueue(clean.appId, "consent_record", {
    consentedPhone: phone2, disclosureVersion: PEWC_DISCLOSURE_VERSION, submissionId: `sub2-${id}`, submittedAt,
    disclosureHash: "a".repeat(64), ipAddress: "203.0.113.9", userAgent: "cert",
  });
  await tick();
  const ev = (await pool.query(
    `SELECT evidence, effective_at FROM consent_audit_logs WHERE contact_id=$1 AND record_kind IS NOT NULL ORDER BY id DESC LIMIT 1`, [clean.contactId])).rows[0];
  check((await row(rid2)).status === "delivered" && ev?.evidence?.disclosureHash === "a".repeat(64), "the disclosure hash captured at submission is the one recorded");
  check(ev && Math.abs(new Date(ev.effective_at).getTime() - Date.parse(submittedAt)) < 1500, "the grant keeps its submission time as its effective time");

  const bad = await makeApp("consent3");
  const phone3 = (await pool.query(`SELECT phone FROM contacts WHERE id=$1`, [bad.contactId])).rows[0].phone as string;
  const rid3 = await enqueue(bad.appId, "consent_record", { consentedPhone: phone3, disclosureVersion: PEWC_DISCLOSURE_VERSION, submissionId: `sub3-${id}`, ipAddress: "x", userAgent: "x" });
  await tick();
  check((await row(rid3)).status !== "delivered", "a payload without a submission time is refused, never stamped with now", true);
  const old = await makeApp("consent4");
  const phone4 = (await pool.query(`SELECT phone FROM contacts WHERE id=$1`, [old.contactId])).rows[0].phone as string;
  const rid4 = await enqueue(old.appId, "consent_record", { consentedPhone: phone4, disclosureVersion: "v1999-01-01", submissionId: `sub4-${id}`, submittedAt, ipAddress: "x", userAgent: "x" });
  await tick();
  check((await row(rid4)).status !== "delivered", "a superseded disclosure version without a captured hash is refused", true);
}

// ── 6. Finalize captures the disclosure hash ───────────────────────────────────────────
{
  const src = (await import("node:fs")).readFileSync("server/services/merchant-application-service.ts", "utf8");
  check(/disclosureHash: hashDisclosure\(PEWC_DISCLOSURE_TEXT\)/.test(src), "finalize captures the disclosure hash at submission time");
}

console.log(`\nStage 5 application effects certification: ${checks} checks passed`);
await pool.end();
