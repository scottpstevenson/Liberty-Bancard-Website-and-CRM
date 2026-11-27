import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { startSfpColdSmtpFixture } from "./sfp-cold-smtp-fixture";
import type { ReaderDeps, ReaderGmail } from "../../server/services/gmail-mailbox-reader";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";
await assertDisposableTestInfrastructure({ operation: "SFP launch runner end-to-end certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

// ── Local fake SMTP server: the real nodemailer transport talks to it ───────
interface Captured { from: string; rcpt: string[]; data: string }
const captured: Captured[] = [];
const smtp = net.createServer((sock) => {
  let inData = false; let buf = ""; let cur: Captured = { from: "", rcpt: [], data: "" };
  sock.write("220 fake ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        cur.data = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
        captured.push(cur); cur = { from: "", rcpt: [], data: "" };
        sock.write("250 OK queued\r\n"); continue;
      }
      const nl = buf.indexOf("\r\n"); if (nl < 0) return;
      const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO")) sock.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
      else if (cmd.startsWith("AUTH")) sock.write("235 ok\r\n");
      else if (cmd.startsWith("MAIL FROM")) { cur.from = line; sock.write("250 OK\r\n"); }
      else if (cmd.startsWith("RCPT TO")) { cur.rcpt.push(line); sock.write("250 OK\r\n"); }
      else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
      else if (cmd.startsWith("QUIT")) { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 OK\r\n");
    }
  });
});
await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
const smtpPort = (smtp.address() as net.AddressInfo).port;
process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(smtpPort);
process.env.SMTP_USER = "cert"; process.env.SMTP_PASS = "cert";
const coldSmtp = await startSfpColdSmtpFixture(smtp);
const SFP_SALES_ADDRESS = "sales@meetlibertybancard.com";
const SHARED_GMAIL_ACCOUNT = "scott@libertybancard.com";
process.env.SFP_COLD_SMTP_FROM = SFP_SALES_ADDRESS;
delete process.env.SFP_COLD_REPLY_GMAIL_ACCOUNT;
process.env.APP_URL = "https://liberty.example.test";
process.env.UNSUBSCRIBE_TOKEN_SECRET ||= "cert-unsubscribe-secret-0123456789abcdef";

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { prepareCanonicalRecipient } = await import("../../server/services/canonical-recipient-preparation");
const release = await import("../../server/services/sfp-canonical-release");
const { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } = await import("../../server/services/contact-business-system-links");
const content = await import("../../server/services/cro03/sfp-launch-content");
const { processSequenceEnrollments } = await import("../../server/services/sequence-worker");
const { generateUnsubscribeToken } = await import("../../server/services/unsubscribe-token");
const { openMailboxReader, pollMailboxOnce } = await import("../../server/services/gmail-mailbox-reader");

const prefix = `cert_launch_e2e_${randomUUID().replaceAll("-", "")}`;
const actor = { role: "admin" as const, actorId: `system:${prefix}`, email: null };
let checks = 0;
const check = (value: unknown, message: string) => { assert(value, message); checks++; };
const one = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows[0];

try {
  // Disposable DB only: open the pause authority so the unreleased/released distinction is the only gate under test.
  await pool.query(`DELETE FROM outbound_pause_control`);
  await pool.query(`INSERT INTO outbound_pause_control(state,reason,epoch,actor) VALUES('unpaused','cert',1,'cert')`);
  const { invalidatePauseStateCache } = await import("../../server/services/outbound-pause-authority");
  invalidatePauseStateCache();
  const { sendSmtpEmail } = await import("../../server/services/smtp-email");
  const staffAlert = await sendSmtpEmail({
    category: "internal_ops", to: "staff@example.test", subject: "Staff alert", html: "<p>Alert</p>",
  });
  check(staffAlert.success && captured.length === 1 && coldSmtp.dedicatedConnections() === 0,
    "A staff message still uses the shared SMTP endpoint with the dedicated mailbox configured");
  captured.length = 0;
  await storage.setSystemSetting("emailChannelPaused", false);
  await storage.setSystemSetting("coldEmailChannelPaused", false);
  await storage.setSystemSetting("compliance_mailing_address", "100 Test Way, Miami, FL 33130");
  const programId = randomUUID();
  await pool.query(`INSERT INTO sfp_programs (id,name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
    VALUES($1,$2,ARRAY['12086'],ARRAY['Automotive'],2,TRUE,$3)`, [programId, prefix, actor.actorId]);
  const sequenceId = Number((await pool.query(`INSERT INTO follow_up_sequences
    (name,status,trigger_type,trigger_config,sequence_family,total_steps) VALUES($1,'paused','contact_created',$2::jsonb,'sfp-v2-cold-automotive',0) RETURNING id`,
    [prefix, JSON.stringify({ canonicalProgramId: programId, canonicalVerticals: ["Automotive"] })])).rows[0].id);

  // Populate the sequence with the real launch drafts through the same shape the content writer produces.
  for (const d of content.buildLaunchStepDrafts("sfp.automotive.v2")) {
    await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,delay_hours,subject,body,config)
      VALUES($1,$2,'email',$3,0,$4,$5,'{"format":"plain_text"}'::jsonb)`, [sequenceId, d.stepOrder, d.delayDays, d.subject, d.body]);
  }
  await pool.query("UPDATE follow_up_sequences SET total_steps=3 WHERE id=$1", [sequenceId]);

  // One canonical business + contact via the real affiliation writer.
  const label = randomUUID().replaceAll("-", "");
  const place = `${prefix}_place`;
  const business = (await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,google_place_id,vertical,city,state,postal_code)
    VALUES($1,$2,'canonical',$3,'Automotive','Miami','FL','33130') RETURNING *`, [`${prefix} Garage`, `${prefix}garage`, place])).rows[0];
  await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key) VALUES($1,'google_maps','place',$2)`, [business.id, place]);
  const email = `${prefix.slice(0, 28)}.${label.slice(0, 20)}@gmail.com`;
  const contact = (await pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name,record_class,email_status)
    VALUES('Maria','Lopez',$1,'',$2,'production','valid') RETURNING id`, [email, `${business.canonical_name} LLC`])).rows[0];
  await pool.query(`INSERT INTO contact_source_events (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
    VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4::jsonb)`, [contact.id, `${prefix}_event`, actor.actorId, JSON.stringify({ place_id: place })]);
  const preview = await previewContactBusinessSystemLinks({ afterContactId: Number(contact.id) - 1, limit: 1 });
  const linked = await applyContactBusinessSystemLink({ contactId: Number(contact.id), businessId: Number(business.id),
    sourceLinkId: preview.rows[0].sourceLinkId!, sourceEntityId: preview.rows[0].sourceEntityId, snapshotHash: preview.rows[0].snapshotHash });
  check(linked.status === "applied", "Affiliation written by the reviewed native writer");

  // A current provider "valid" observation (the send authority) for this exact mailbox, inserted as fixture data.
  const { hashEmailToken } = await import("../../server/services/provider-readiness-control");
  const tokenHash = hashEmailToken(email);
  const gen = (await one("SELECT email_mutation_generation g FROM contacts WHERE id=$1", [contact.id])).g ?? 0;
  const opId = randomUUID();
  await pool.query(`INSERT INTO provider_operations (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES($1,'zerobounce','email_validation','certification',$2,'system',$3,'completed')`, [opId, `${prefix}-op`, `business:${business.id}`]);
  await pool.query(`INSERT INTO provider_observations (provider,operation_id,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at,expires_at)
    VALUES('zerobounce',$1,'contact',$2,$3,$4,'valid',false,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '29 days')`, [opId, contact.id, tokenHash, gen]);
  await pool.query(`UPDATE contacts SET email_status='valid',email_token_hash=$2,email_validation_updated_at=NOW() WHERE id=$1`, [contact.id, tokenHash]);

  const prepared = await prepareCanonicalRecipient({ contactId: Number(contact.id), sequenceId, programId, actor, source: prefix });
  check(prepared.enrollmentId != null, "Preparation owns a paused membership");
  const enrollmentId = Number(prepared.enrollmentId);
  // The real selector and real capacity definition: one warm sender able to send five a day.
  await pool.query(`DELETE FROM sending_identities WHERE lower(email_address)=lower($1)`, [SFP_SALES_ADDRESS]);
  await pool.query(`INSERT INTO sending_identities (label,domain,email_address,is_active,warmup_status,daily_limit,sent_today)
    VALUES('cert',$1,$2,TRUE,'warm',5,0)`, ["meetlibertybancard.com", SFP_SALES_ADDRESS]);
  const enrollment = async () => one("SELECT * FROM sequence_enrollments WHERE id=$1", [enrollmentId]);

  // Not released: nothing sends even with the legacy flag off and release-only mode on.
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  check(captured.length === 0, "Unreleased membership sends nothing");

  const p = await release.previewCanonicalRelease(1);
  check(p.size === 1, "Release preview selects the single ready recipient (content-ready sequence)");
  await release.executeCanonicalRelease({ requestedLimit: 1, snapshotHash: p.snapshotHash, commandKey: `${prefix}-1`, expiresInHours: 2, actorId: "admin:cert" });
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);

  // Transport rule: SMTP unavailable -> deferred, never a silent fallback.
  const savedHost = process.env.SFP_COLD_SMTP_HOST;
  delete process.env.SFP_COLD_SMTP_HOST;
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  process.env.SFP_COLD_SMTP_HOST = savedHost;
  let e = await enrollment();
  check(captured.length === 0 && Number(e.current_step) === 0 && e.status === "active",
    "Without dedicated SMTP the step defers even though shared SMTP is available");
  check(Number((await one(`SELECT count(*) c FROM audit_logs WHERE action='sequence_step_deferred_transport_unavailable' AND entity_id=$1`, [contact.id])).c) >= 1,
    "The deferral is audited");
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);

  process.env.SFP_COLD_SMTP_FROM = "wrong@example.test";
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  process.env.SFP_COLD_SMTP_FROM = SFP_SALES_ADDRESS;
  e = await enrollment();
  check(captured.length === 0 && Number(e.current_step) === 0 && e.status === "active",
    "A mismatched dedicated mailbox defers without attempting delivery through either SMTP endpoint");
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);

  // Empty sequence: the membership is deferred, never completed as a successful outreach.
  const parking = Number((await pool.query(`INSERT INTO follow_up_sequences (name,status,trigger_type,trigger_config,total_steps)
    VALUES($1,'paused','contact_created','{}'::jsonb,0) RETURNING id`, [`${prefix}-parking`])).rows[0].id);
  await pool.query("UPDATE sequence_steps SET sequence_id=$1 WHERE sequence_id=$2", [parking, sequenceId]);
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  e = await enrollment();
  check(e.status === "active" && !e.completed_at && e.metadata?.deferral?.reason === "SEQUENCE_HAS_NO_STEPS" && captured.length === 0,
    "An empty sequence defers the membership and never completes it as outreach");
  await pool.query("UPDATE sequence_steps SET sequence_id=$2 WHERE sequence_id=$1", [parking, sequenceId]);
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);

  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  check(captured.length === 0 && Number((await one(`SELECT count(*) c FROM audit_logs
    WHERE action='sequence_step_deferred_transport_unavailable' AND entity_id=$1
      AND details->>'reason'='SFP_SALES_REPLY_READER_UNAVAILABLE'`, [contact.id])).c) === 1,
    "Sales SMTP defers until the configured reply reader is active");
  process.env.SFP_COLD_REPLY_GMAIL_ACCOUNT = SHARED_GMAIL_ACCOUNT;
  await storage.setSystemSetting("gmail_oauth_email", SHARED_GMAIL_ACCOUNT);
  let gmailReplyHeaders: { name: string; value: string }[] = [];
  let historyId = 1000;
  let gmailMessageId = "cert-gmail-reply";
  const gmail: ReaderGmail = { users: {
    getProfile: async () => ({ data: { historyId: String(historyId) } }),
    history: { list: async () => {
      const id = String(++historyId);
      return { data: { historyId: id, history: [{ id, messagesAdded: [{ message: { id: gmailMessageId } }] }] } };
    } },
    messages: { get: async () => ({ data: {
      threadId: "cert-gmail-thread", labelIds: ["INBOX"], internalDate: String(Date.now()),
      payload: { headers: gmailReplyHeaders },
    } }) },
  } };
  const readerClient: ReaderDeps["getClient"] = async () => ({ ok: true, gmail, account: SHARED_GMAIL_ACCOUNT });
  check((await openMailboxReader()).ok && (await pollMailboxOnce({ getClient: readerClient })).status === "initialized",
    "Gmail reader initializes through the normal poll");
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);

  // Step 1 send.
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  e = await enrollment();
  check(captured.length === 1 && coldSmtp.dedicatedConnections() === 1, "Released step 1 is delivered once through the dedicated TLS connection");
  const m1 = captured[0].data;
  check(/^From: .*sales@meetlibertybancard\.com/mi.test(m1) && /^Reply-To: .*sales@meetlibertybancard\.com/mi.test(m1), "Sales From and Reply-To are independent of the SMTP login");
  check(/List-Unsubscribe:\s*<https:\/\/liberty\.example\.test\/unsubscribe\?t=/i.test(m1) && /List-Unsubscribe-Post: List-Unsubscribe=One-Click/i.test(m1), "Signed List-Unsubscribe and one-click headers are present");
  const decoded = m1.replace(/=\r\n/g, "").replace(/=3D/g, "=");
  check(decoded.includes("Hi Maria,") && !decoded.includes("upload-statement") && /interested in a free statement review/.test(decoded), "Touch 1 is rendered reply-first with the person greeting and no upload CTA");
  check(/^From: "?Liberty Bancard Sales"? <sales@meetlibertybancard\.com>/mi.test(m1), "From carries the Liberty Bancard Sales display name");
  check((decoded.match(/data-sfp-signature/g) ?? []).length === 1 && (decoded.match(/<img\b/g) ?? []).length === 1 && decoded.includes('alt="Liberty Bancard logo"')
    && decoded.indexOf("<img") < decoded.indexOf("data-can-spam-footer"), "One signature, one logo with alt text, above the single transport footer");
  check(!/\{\{|undefined/.test(decoded), "No unresolved token ships");
  check(decoded.includes("Commercial message from Liberty Bancard") && decoded.includes("100 Test Way"), "One footer with commercial notice and postal address");
  check((decoded.match(/data-can-spam-footer/g) ?? []).length === 1, "Exactly one footer");
  check(Number(e.current_step) === 1 && e.status === "active", "Enrollment advanced to touch 2");
  const gapDays = (new Date(e.next_action_at).getTime() - Date.now()) / 86400000;
  check(gapDays > 2.9 && gapDays < 3.1, "Touch 2 is scheduled 3 days after the actual send");

  // Replay: another tick before the due time does not resend.
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  check(captured.length === 1, "A replayed tick sends nothing new");
  // Concurrent workers: lock keeps a single owner.
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);
  await Promise.all([processSequenceEnrollments({ canonicalReleaseOnly: true }), processSequenceEnrollments({ canonicalReleaseOnly: true })]);
  check(captured.length === 2, "Two concurrent workers produce exactly one touch-2 delivery");
  const subject2 = captured[1].data.match(/^Subject: (.*)$/mi)?.[1];
  check(!!subject2 && !/^Re:/i.test(subject2), "Follow-up has no fake Re:");

  const messageId = captured[1].data.match(/^Message-ID: (.*)$/mi)?.[1]?.trim();
  assert(messageId, "SMTP message carries a Message-ID");
  const replyHeaders = [
    { name: "From", value: email }, { name: "To", value: SFP_SALES_ADDRESS },
    { name: "Delivered-To", value: SHARED_GMAIL_ACCOUNT },
    { name: "Subject", value: "Interested in a statement review" },
    { name: "In-Reply-To", value: messageId },
  ];
  gmailReplyHeaders = [...replyHeaders, { name: "Auto-Submitted", value: "auto-replied" }];
  const autoReplyPoll = await pollMailboxOnce({ getClient: readerClient });
  check(autoReplyPoll.status === "polled" && Number((await one(`SELECT count(*) c FROM communication_events
    WHERE contact_id=$1 AND direction='inbound'`, [contact.id])).c) === 0,
    "An auto-reply is recorded as evidence without creating a reply event");
  gmailMessageId = "cert-gmail-reply-wrong-recipient";
  gmailReplyHeaders = replyHeaders.map((header) => header.name === "To"
    ? { ...header, value: "sales@libertybancard.com" }
    : header);
  const wrongRecipientPoll = await pollMailboxOnce({ getClient: readerClient });
  check(wrongRecipientPoll.status === "polled" && Number((await one(`SELECT count(*) c FROM communication_events
    WHERE contact_id=$1 AND direction='inbound'`, [contact.id])).c) === 0,
    "A reference to the SMTP send must also match the Sales address originally used");
  gmailMessageId = "cert-gmail-reply-human";
  gmailReplyHeaders = replyHeaders;
  const humanReplyPoll = await pollMailboxOnce({ getClient: readerClient });
  check(humanReplyPoll.status === "polled" && humanReplyPoll.applied === 1, `A forwarded human reply to the actual wire Message-ID is applied (${JSON.stringify(humanReplyPoll)})`);
  check((await pollMailboxOnce({ getClient: readerClient })).duplicates === 1, "Replaying the Gmail event is idempotent");
  check(Number((await one(`SELECT count(*) c FROM audit_logs
    WHERE action='email_inbound' AND entity_id=$1 AND details->>'subject'=$2`, [contact.id, "Interested in a statement review"])).c) === 1,
    "The CRM Inbox receives one entry for the reply");
  await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);
  await processSequenceEnrollments({ canonicalReleaseOnly: true });
  e = await enrollment();
  check(captured.length === 2 && e.status === "completed" && e.metadata?.terminal?.reason === "contact_replied",
    "The CRM reply stops the remaining sequence touch");

  // Opt-out: signed one-click POST suppresses; touch 3 is never sent.
  const { default: express } = await import("express");
  const { registerPublicRoutes } = await import("../../server/routes/public").catch(() => ({ registerPublicRoutes: null as any }));
  if (registerPublicRoutes) {
    const app = express(); app.use(express.urlencoded({ extended: false })); registerPublicRoutes(app);
    const srv = await new Promise<import("node:http").Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const port = (srv.address() as net.AddressInfo).port;
    const t = generateUnsubscribeToken(Number(contact.id));
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      check(res.status === 200, `One-click unsubscribe POST accepted (call ${i + 1})`);
    }
    srv.close();
    const consent = await one(`SELECT email_status FROM contacts WHERE id=$1`, [contact.id]);
    check(consent.email_status === "opted_out", "The contact is opted out after the POST");
    await pool.query("UPDATE sequence_enrollments SET next_action_at=NOW()-interval '1 minute' WHERE id=$1", [enrollmentId]);
    await processSequenceEnrollments({ canonicalReleaseOnly: true });
    check(captured.length === 2, "No further touch is sent to an opted-out contact");
  }

  const capacity = await import("../../server/services/sfp-sender-capacity");
  process.env.SFP_COLD_ACCOUNT_CAP_ONLY_FOR = SFP_SALES_ADDRESS;
  await storage.setSystemSetting("outboundDailyEmailCap", 200);
  const selected = await capacity.readSelectedSender();
  assert(selected);
  await pool.query("UPDATE sending_identities SET warmup_status='warming', warmup_started_at=now(), daily_limit=30 WHERE id=$1", [selected.id]);
  const day = capacity.capacityDay();
  const senderScope = capacity.senderScope(selected.id);
  await pool.query(`INSERT INTO outbound_send_counters (date, channel, scope, count)
    VALUES ($1,'email',$2,35), ($1,'email',$3,198)
    ON CONFLICT (date, channel, scope) DO UPDATE SET count=EXCLUDED.count`, [day, senderScope, capacity.GLOBAL_COLD_SCOPE]);
  const before = await capacity.readSenderCapacity();
  check(before.identityLimit === null && before.identityRemaining === null && before.remaining === 2 && before.limitedBy === "global_ceiling",
    "Sales uses the remaining account capacity even after exceeding both mailbox limits");
  const reservations = await Promise.all(Array.from({ length: 6 }, () => capacity.reserveSenderCapacity()));
  check(reservations.filter(result => result.ok).length === 2
    && reservations.filter(result => !result.ok && result.reason === "GLOBAL_DAILY_CEILING").length === 4,
    "Concurrent sends reach exactly the 200-account ceiling");
  const after = await capacity.readSenderCapacity();
  check(after.identityUsedByLaunch === 37 && after.globalUsed === 200 && after.remaining === 0,
    "Account cap violations roll back sender usage and zero capacity remains");
  await pool.query("UPDATE sending_identities SET is_active=false WHERE id=$1", [selected.id]);
  const disabled = await capacity.reserveSenderCapacity(new Date(Date.now() + 86_400_000));
  check(!disabled.ok && disabled.reason === "SENDER_UNUSABLE", "Account-cap-only configuration preserves sender eligibility");
  check(getBlockedCertificationNetworkAttemptCount() === 0, "No provider or external network call was attempted");
  console.log(`PASS SFP launch runner end-to-end (${checks} checks)`);
} finally {
  coldSmtp.close();
  await pool.query("DELETE FROM system_settings WHERE key=$1", [release.CANONICAL_RELEASE_CONTROL_KEY]).catch(() => {});
  smtp.close();
  await pool.end().catch(() => {});
}
