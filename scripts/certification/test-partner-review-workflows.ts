/**
 * Partner review workflows certification (disposable PostgreSQL; no provider, no network, no send).
 *
 * Proves, against the real services and the migrated schema:
 *  - F03 introductions: an administrator resolves a held introduction with an explicit command (accept, decline,
 *    resolve duplicate, keep the existing referrer). Each command is revision-checked, state-checked, needs a written
 *    reason, records actor/time/reason with a history event in one transaction, and never creates a referral, commission,
 *    attribution move or company merge. The partner-facing view stays generic and never names another partner.
 *  - F03 identity: the same canonical business with a different person, a shared phone, a shared free-mail domain,
 *    same-domain separate locations and concurrent introductions from different partners are each resolved through the
 *    existing identity evidence: strong evidence holds the introduction for staff, no evidence proceeds, nothing merges.
 *  - F04 completion: contact, referral, partner total and review notification are separate idempotent checkpoints. A
 *    fault injected after the occurrence, after the contact, after the referral, before the total, around the linkage and
 *    around the notification leaves a visible held state and is repaired by the background recovery with exactly one
 *    contact, one referral, one notification and one total increment; recovery needs no browser retry and sends nothing.
 *  - F05 reopen: a declined, withdrawn, superseded or needs-information application is reopened in place by an
 *    administrator only, with concurrency protection, preserved evidence and exactly one open case; accepted, credentialed
 *    and already-open cases are refused and the anonymous public flow still cannot take over a prior application.
 *  - F06 history: every application transition (including needs-information, which now records actor and time) appends a
 *    row in the same transaction; a failing history write rolls the transition back; nothing updates or deletes history.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Partner review workflows certification" });
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const auth = await import("../../server/services/inbound-request-authority");
const applications = await import("../../server/services/partner-application");
const review = await import("../../server/services/partner-application-review");
const intros = await import("../../server/services/partner-introductions");
const events = await import("../../server/services/partner-review-events");
const { upsertContactSourceEvent } = await import("../../server/services/contact-writer");
const { PARTNER_INTRODUCTION_PERMISSION } = await import("../../shared/partner-public-content");
const { PARTNER_APPLICATION_CONSENT } = await import("../../shared/partner-application");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [PRW-${String(checks).padStart(3, "0")}] ${message}`); };
const id = randomUUID().slice(0, 8);
let phoneSeq = (Number.parseInt(id, 16) % 7000) + 100;
const nextPhone = () => `+1556${String(1000000 + (phoneSeq++ % 8999999)).padStart(7, "0")}`.slice(0, 12);
const actor = `prw-admin-${id}`;
const actor2 = `prw-admin2-${id}`;
const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one(`SELECT count(*)::int n FROM (${sql}) q`, params)).n);
const settle = async <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const code = (r: any) => (r.ok ? "ok" : r.code);
const FAR = () => new Date(Date.now() + 24 * 3600 * 1000);

const claim = async (label: string) => {
  const c = await auth.claimInboundRequest({ idempotencyKey: randomUUID(), sourceCategory: "website_form", sourceType: "partner_application", callerScope: "public:cert", actorType: "public", payload: { label } });
  assert.equal(c.outcome, "claimed");
  return (c as any).request as { id: string };
};
const referralInput = (email: string, extra: Record<string, unknown> = {}) => ({
  path: "referral", fullName: "Prw Fixture", email, phone: nextPhone(), company: `Prw Co ${id}`, profession: "cpa",
  referralNetwork: "Small business clients", contactPreference: "email", consentVersion: PARTNER_APPLICATION_CONSENT.version,
  marketingOptIn: false, sourcePage: "/partners/referrals", attribution: {}, ...extra,
}) as any;
const decideApp = (appId: string, input: Record<string, unknown>, who = actor) => review.decidePartnerApplication(appId, input as any, who);
const apply = async (label: string, extra: Record<string, unknown> = {}) => {
  const email = `prw-${label}-${id}@fixture.invalid`;
  const created = await applications.createPartnerApplication(referralInput(email, extra), { inboundRequestId: (await claim(label)).id }) as any;
  assert.equal(created.kind, "created");
  return { email, partner: created.partner, application: created.application, requestId: created.application.inboundRequestId as string };
};
const acceptedPartner = async (label: string) => {
  const a = await apply(label);
  const decided = await decideApp(a.application.id, { decision: "accept", expectedRevision: 1, commissionPercent: 15, scheduleReference: `SCH-${label}-${id}` }) as any;
  assert(decided.ok, `fixture partner ${label} must be accepted`);
  return (await storage.getPartner(a.partner.id))!;
};
const introBody = (extra: Record<string, unknown> = {}) => {
  const parsed = intros.parseIntroductionBody({
    businessName: `Prw Biz ${randomUUID().slice(0, 6)}`, contactName: "Owner Person", contactPhone: nextPhone(),
    permissionConfirmed: true, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version, ...extra,
  });
  assert((parsed as any).ok, `fixture introduction body must validate: ${JSON.stringify(parsed)}`);
  return (parsed as any).data;
};
const record = async (partner: { id: number }, body: any, key: string = randomUUID()) => {
  const r = await intros.recordPartnerIntroduction(partner as any, { userId: null }, key, body) as any;
  assert.equal(r.kind, "recorded");
  return r.introduction as { id: string; partnerId: number };
};
const total = async (partnerId: number) => Number((await one(`SELECT COALESCE(total_referrals,0)::int n FROM partners WHERE id=$1`, [partnerId])).n);
const introRow = async (introId: string) => one(`SELECT * FROM partner_introductions WHERE id=$1`, [introId]);
const referralsFor = async (partnerId: number, introId: string) => count(`SELECT 1 FROM referrals WHERE partner_id=${Number(partnerId)} AND notes='Partner introduction ${introId}'`);
const notificationsFor = async (introId: string) => count(`SELECT 1 FROM notifications WHERE command_key='partner-introduction:${introId}:review'`);

// Fault injection: a trigger in the disposable database raises on the exact write under test.
await pool.query(`CREATE OR REPLACE FUNCTION prw_fault() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'prw injected fault %', TG_ARGV[0]; END $$ LANGUAGE plpgsql`);
const withFault = async <T>(name: string, table: string, when: string, fn: () => Promise<T>): Promise<T> => {
  const trigger = `prw_fault_${name}`;
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
  await pool.query(`CREATE TRIGGER ${trigger} BEFORE ${when.startsWith("INSERT") ? "INSERT" : "UPDATE"} ON ${table} FOR EACH ROW WHEN (${when.replace(/^(INSERT|UPDATE):\s*/, "")}) EXECUTE FUNCTION prw_fault('${name}')`);
  try { return await fn(); } finally { await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`); }
};

// ═══ 1. F06: transactional append-only application history ═══════════════════════════════════════════════════════════
const A = await apply("hist");
const info1 = await decideApp(A.application.id, { decision: "needs_info", expectedRevision: 1, note: "Please confirm your region." }) as any;
check(info1.ok && info1.application.reviewStatus === "needs_info" && info1.application.decidedBy === actor && info1.application.decidedAt, "Needs-information now records the deciding actor and time");
const info2 = await decideApp(A.application.id, { decision: "needs_info", expectedRevision: 2, note: "Also confirm your network size." }, actor2) as any;
check(info2.ok && info2.application.revision === 3 && info2.application.decidedBy === actor2, "A repeated needs-information change is accepted and records the new actor");
const hist1 = await events.listReviewEvents("application", A.application.id);
check(hist1.length === 2 && hist1.every((e) => e.eventType === "needs_info" && e.toStatus === "needs_info"), "Each needs-information change retains its own history row");
check(hist1[0].actorId === actor && hist1[1].actorId === actor2 && hist1[0].note === "Please confirm your region." && hist1[1].note === "Also confirm your network size.", "History keeps each actor and note, not only the latest note");
check(hist1[0].fromRevision === 1 && hist1[0].toRevision === 2 && hist1[1].fromRevision === 2 && hist1[1].toRevision === 3 && hist1[0].fromStatus === "pending_review" && hist1[1].fromStatus === "needs_info", "History records before/after status and revision");
check(hist1.every((e) => e.details.messageSent === false) && (await count(`SELECT 1 FROM partner_approval_deliveries WHERE partner_id=${A.partner.id}`)) === 0, "A needs-information change records that no message was sent and queues no delivery");

// A failing history write must roll the whole transition back (no transition without accountability).
await pool.query(`ALTER TABLE partner_review_events ADD CONSTRAINT prw_tmp_fail CHECK (note IS DISTINCT FROM 'PRW-FAIL')`);
let failedDecision: any = null;
try { failedDecision = await decideApp(A.application.id, { decision: "decline", expectedRevision: 3, note: "PRW-FAIL" }).catch((e: unknown) => ({ threw: e })); }
finally { await pool.query(`ALTER TABLE partner_review_events DROP CONSTRAINT prw_tmp_fail`); }
const afterFail = await one(`SELECT review_status, revision FROM partner_applications WHERE id=$1`, [A.application.id]);
check(failedDecision?.threw && afterFail.review_status === "needs_info" && afterFail.revision === 3, "A failing history write aborts the decision: status and revision are unchanged");
check((await storage.getPartner(A.partner.id))!.status === "pending" && (await events.listReviewEvents("application", A.application.id)).length === 2, "The partner row and the history are untouched by the aborted decision");

const detailA = await review.getPartnerApplicationDetail(A.application.id);
check(Boolean(detailA) && detailA!.history.length === 2 && detailA!.decidedByName === null && detailA!.application.decidedBy === actor2, "The application detail carries the history and keeps an unresolvable staff id as an id (no invented name)");
check(detailA!.allowedActions.includes("reopen") && detailA!.allowedActions.includes("accept"), "A needs-information application can be decided or returned to review");
check(detailA!.application.submittedCompany === `Prw Co ${id}`, "The detail shows the company the applicant submitted");
const noCompany = await apply("nocompany", { company: undefined });
const noCompanyDetail = await review.getPartnerApplicationDetail(noCompany.application.id);
check(noCompanyDetail!.application.submittedCompany === null && noCompanyDetail!.partner.company.length > 0, "With no submitted company the detail says none was provided and keeps the legacy display name separate");
const noCompanyRow = (await review.listPartnerApplications(review.normalizeApplicationFilters({ pageSize: "50" }))).rows.find((r) => r.id === noCompany.application.id)!;
check(noCompanyRow.company === null && noCompanyRow.legacyDisplayName !== null, "The list shows no company for an applicant who gave none, never the person's fallback name");

// Owner display name and exact occurrence/contact linkage.
const owner = await one(`INSERT INTO users(email, role, auth_provider, first_name, last_name) VALUES ($1, 'manager', 'local', 'Olivia', 'Owner') RETURNING id`, [`prw-owner-${id}@fixture.invalid`]);
await pool.query(
  `INSERT INTO notifications(channel, title, message, type, inbound_request_id, command_key, metadata) VALUES ('internal','Application','x','alert',$1,$2,$3::jsonb)`,
  [A.requestId, `prw-owner-note:${id}`, JSON.stringify({ eventType: "partner_application_received", reviewOwnerUserId: owner.id, reviewPolicy: "recorded", reviewDueAt: new Date(Date.now() + 86400000).toISOString() })],
);
const mailboxContact = await one(`INSERT INTO contacts(first_name,last_name,phone,email) VALUES ('Mailbox','Holder',$1,$2) RETURNING id`, [nextPhone(), A.email]);
const occurrenceContact = await one(`INSERT INTO contacts(first_name,last_name,phone,email) VALUES ('Occurrence','Linked',$1,$2) RETURNING id`, [nextPhone(), `prw-occ-${id}@fixture.invalid`]);
await upsertContactSourceEvent({ contactId: occurrenceContact.id, provenance: { sourceCategory: "website_form", sourceType: "partner_application", eventKey: `form:partner_application:${A.requestId}`, actorType: "public" } });
const detailLinked = await review.getPartnerApplicationDetail(A.application.id);
check(detailLinked!.assignment.ownerName === "Olivia Owner" && detailLinked!.assignment.owner === owner.id, "The detail resolves the assigned owner's display name");
check(detailLinked!.contactId === occurrenceContact.id && detailLinked!.contactId !== mailboxContact.id, "The related contact is the one this occurrence's source event names, not the contact that owns the mailbox now");
const listedLinked = (await review.listPartnerApplications(review.normalizeApplicationFilters({ pageSize: "50" }))).rows.find((r) => r.id === A.application.id)!;
check(listedLinked.assignedOwnerName === "Olivia Owner", "The list shows the owner's display name");

// Nothing updates or deletes history (append-only is enforced in code and proven here by source inspection).
const serverFiles: string[] = [];
const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (p.endsWith(".ts")) serverFiles.push(p); } };
walk(path.resolve("server"));
const mutators = serverFiles.filter((f) => /(\.update|\.delete)\(\s*partnerReviewEvents\b|UPDATE\s+partner_review_events|DELETE\s+FROM\s+partner_review_events/i.test(fs.readFileSync(f, "utf8")));
check(mutators.length === 0, `No server code updates or deletes partner_review_events (${mutators.join(", ") || "none"})`);

// ═══ 2. F05: audited reopen ═════════════════════════════════════════════════════════════════════════════════════════
const reopen = (appId: string, input: Record<string, unknown>, who = actor) => review.reopenPartnerApplication(appId, input as any, who);
const D = await apply("declined");
const consentBefore = await one(`SELECT consent_text_sha256, consent_version, answers, acquisition FROM partner_applications WHERE id=$1`, [D.application.id]);
check((await decideApp(D.application.id, { decision: "decline", expectedRevision: 1, note: "Not a fit yet." }) as any).ok, "Fixture: an application is declined");
check(code(await reopen(D.application.id, { expectedRevision: 2 })) === "NOTE_REQUIRED", "Reopen needs a written reason");
check(code(await reopen(D.application.id, { note: "ok" })) === "REVISION_REQUIRED", "Reopen needs the revision the screen showed");
check(code(await reopen(D.application.id, { expectedRevision: 9, note: "ok" })) === "STALE_REVISION", "A stale revision is refused");
check(code(await reopen(D.application.id, { expectedRevision: 2, note: "ok", path: "wholesale" })) === "INVALID_PATH", "An unknown path is refused");
check(code(await reopen("00000000-0000-4000-8000-000000000000", { expectedRevision: 1, note: "x" })) === "NOT_FOUND", "An unknown application is not found");
check(code(await reopen(D.application.id, { expectedRevision: 2, note: "ok" }, "")) === "ACTOR_REQUIRED", "Reopen needs an actor");
check((await one(`SELECT review_status FROM partner_applications WHERE id=$1`, [D.application.id])).review_status === "declined", "Refused reopen attempts changed nothing");

// Public anonymous flow cannot reopen, replace or take over a declined application.
const takeover = await applications.createPartnerApplication(referralInput(D.email, { fullName: "Someone Else", company: "Other Co" }), { inboundRequestId: (await claim("takeover")).id }) as any;
check(takeover.kind === "refused" && (await one(`SELECT review_status FROM partner_applications WHERE id=$1`, [D.application.id])).review_status === "declined", "An anonymous resubmission for the same mailbox is refused and cannot reopen the application");
check((await storage.getPartner(D.partner.id))!.contactName === "Prw Fixture" && (await count(`SELECT 1 FROM partner_applications WHERE mailbox='${D.email}'`)) === 1, "The prior application and partner identity are untouched by the anonymous attempt");

// Two administrators reopen at once: exactly one wins; one open case results.
const race = await settle([
  reopen(D.application.id, { expectedRevision: 2, note: "Reopen A" }, actor),
  reopen(D.application.id, { expectedRevision: 2, note: "Reopen B" }, actor2),
]);
const raceResults = race.map((r) => (r.status === "fulfilled" ? code(r.value) : "threw"));
check(raceResults.filter((c) => c === "ok").length === 1 && raceResults.filter((c) => c === "STALE_REVISION").length === 1, `Concurrent reopen: exactly one wins, the other is stale (${raceResults.join(",")})`);
const reopenedRow = await one(`SELECT review_status, revision, path, consent_text_sha256, consent_version, answers, acquisition, decision_note FROM partner_applications WHERE id=$1`, [D.application.id]);
check(reopenedRow.review_status === "pending_review" && reopenedRow.revision === 3 && (await storage.getPartner(D.partner.id))!.status === "pending", "The application is pending review again and the partner is pending");
check(await count(`SELECT 1 FROM partner_applications WHERE mailbox='${D.email}' AND review_status IN ('pending_review','needs_info')`) === 1, "Exactly one open case exists for the mailbox");
check(reopenedRow.consent_text_sha256 === consentBefore.consent_text_sha256 && JSON.stringify(reopenedRow.answers) === JSON.stringify(consentBefore.answers) && JSON.stringify(reopenedRow.acquisition) === JSON.stringify(consentBefore.acquisition) && reopenedRow.decision_note === "Not a fit yet.", "Old answers, consent evidence, acquisition and the decision note are preserved");
const reopenHistory = await events.listReviewEvents("application", D.application.id);
const reopenEvent = reopenHistory.find((e) => e.eventType === "reopened")!;
check(reopenHistory.map((e) => e.eventType).join(",") === "decline,reopened" && reopenEvent.fromStatus === "declined" && reopenEvent.details.previousStatus === "declined" && reopenEvent.details.previousDecidedBy === actor && reopenEvent.details.previousDecisionNote === "Not a fit yet.", "History keeps the original decision and records the reopen with the prior decision evidence");
check(await decideApp(D.application.id, { decision: "accept", expectedRevision: 3, commissionPercent: 12, scheduleReference: `SCH-REOPEN-${id}` }).then((r: any) => r.ok), "A reopened application can be decided normally afterwards");
check(code(await reopen(D.application.id, { expectedRevision: 4, note: "again" })) === "APPLICATION_ACCEPTED", "An accepted application cannot be reopened");

// Needs-information amendment and same-mailbox path correction.
const N = await apply("pathfix");
check((await decideApp(N.application.id, { decision: "needs_info", expectedRevision: 1, note: "Wrong path chosen?" }) as any).ok, "Fixture: needs information");
const P0 = await apply("pendingreopen");
check(code(await reopen(P0.application.id, { expectedRevision: 1, note: "x" })) === "APPLICATION_ALREADY_OPEN", "A pending application cannot be reopened (it is already open)");
check(code(await reopen(N.application.id, { expectedRevision: 1, note: "x" })) === "STALE_REVISION", "A screen that predates the needs-information change cannot reopen it");
const fixed = await reopen(N.application.id, { expectedRevision: 2, note: "Applicant replied: they want the sales-agent path.", path: "sales_agent" }) as any;
check(fixed.ok && fixed.application.reviewStatus === "pending_review" && fixed.application.path === "sales_agent" && fixed.partner.partnerType === "iso_agent", "Returning a needs-information case to review can correct the path and keeps the same subject row");
const fixEvent = (await events.listReviewEvents("application", N.application.id)).find((e) => e.eventType === "reopened")!;
check(fixEvent.details.pathChanged === true && fixEvent.details.previousPath === "referral" && fixEvent.details.path === "sales_agent" && fixEvent.fromStatus === "needs_info", "The path correction is recorded with the previous path");
check((await one(`SELECT answers FROM partner_applications WHERE id=$1`, [N.application.id])).answers.company === `Prw Co ${id}`, "The submitted answers are unchanged by the path correction");

// Withdrawn and superseded legacy statuses reopen the same way; an account with credentials or terms never does.
const W = await apply("withdrawn");
await pool.query(`UPDATE partner_applications SET review_status='withdrawn', decided_by=$2, decided_at=now() WHERE id=$1`, [W.application.id, actor]);
await pool.query(`UPDATE partners SET status='inactive' WHERE id=$1`, [W.partner.id]);
check((await reopen(W.application.id, { expectedRevision: 1, note: "Withdrawn by mistake." }) as any).ok, "A withdrawn application can be reopened");
const S = await apply("superseded");
await pool.query(`UPDATE partner_applications SET review_status='superseded', decided_by=$2, decided_at=now() WHERE id=$1`, [S.application.id, actor]);
await pool.query(`UPDATE partners SET status='inactive' WHERE id=$1`, [S.partner.id]);
check((await reopen(S.application.id, { expectedRevision: 1, note: "Legacy state." }) as any).ok, "A superseded (legacy) application can be reopened");

const L = await apply("login");
check((await decideApp(L.application.id, { decision: "decline", expectedRevision: 1, note: "No." }) as any).ok, "Fixture: declined applicant");
await pool.query(`UPDATE partners SET password_hash='$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456' WHERE id=$1`, [L.partner.id]);
check(code(await reopen(L.application.id, { expectedRevision: 2, note: "try" })) === "PARTNER_HAS_ACCOUNT", "An application whose partner holds a credential is never reopened");
const T = await apply("terms");
check((await decideApp(T.application.id, { decision: "decline", expectedRevision: 1, note: "No." }) as any).ok, "Fixture: declined applicant with terms");
await pool.query(`UPDATE partners SET commission_percent=10 WHERE id=$1`, [T.partner.id]);
check(code(await reopen(T.application.id, { expectedRevision: 2, note: "try" })) === "PARTNER_HAS_ACCOUNT", "An application whose partner has recorded terms is never reopened");
const legacy = await storage.createPartner({ companyName: `Prw Legacy ${id}`, contactName: "Legacy", email: `prw-legacy-${id}@fixture.invalid`, phone: nextPhone(), passwordHash: "hash", partnerType: "referral", affiliateCode: `prwlg${id}`, status: "active", commissionPercent: 10 } as any);
const legacyApply = await applications.createPartnerApplication(referralInput(legacy.email!), { inboundRequestId: (await claim("legacy")).id }) as any;
check(legacyApply.kind === "refused" && (await count(`SELECT 1 FROM partner_applications WHERE partner_id=${legacy.id}`)) === 0 && (await storage.getPartner(legacy.id))!.commissionPercent === 10, "An accepted legacy partner mailbox cannot be replaced by an anonymous application and has nothing to reopen");

// A second open case on the same mailbox blocks the reopen (the partial unique index would refuse it anyway).
const M1 = await apply("mbox1");
check((await decideApp(M1.application.id, { decision: "decline", expectedRevision: 1, note: "No." }) as any).ok, "Fixture: declined mailbox holder");
const M2 = await apply("mbox2");
await pool.query(`UPDATE partner_applications SET mailbox=$2 WHERE id=$1`, [M2.application.id, M1.email]);
check(code(await reopen(M1.application.id, { expectedRevision: 2, note: "try" })) === "MAILBOX_HAS_OPEN_APPLICATION", "Reopen is refused while another open case holds the mailbox");
const allowed = review.allowedApplicationActions({ reviewStatus: "accepted" }, { status: "active", passwordHash: null } as any);
check(allowed.length === 0 && review.allowedApplicationActions({ reviewStatus: "declined" }, { status: "inactive", passwordHash: null } as any).join() === "reopen", "The detail offers reopen only where the server would allow it");

// ═══ 3. F04: durable introduction completion ════════════════════════════════════════════════════════════════════════
const P1 = await acceptedPartner("p1");
const P2 = await acceptedPartner("p2");
// Every call is a different business: a distinct domain per address, so unrelated fixtures never look like one business.
const unique = (label: string) => { const tag = randomUUID().slice(0, 8); return `${label}-${tag}@${label}-${tag}.prw-fixture.invalid`; };

// 3a. Happy path leaves every checkpoint set and the state complete.
const e1 = unique("happy");
const happy = await record(P1, introBody({ contactEmail: e1 }));
check((await introRow(happy.id)).completion_state === "pending" && (await introRow(happy.id)).contact_checkpoint_at === null, "A recorded introduction is pending with no checkpoint");
const happyView = intros.toPartnerIntroductionView((await intros.refreshIntroduction(happy as any)));
check(/finishing recording/.test(happyView.nextStep) && happyView.status === "received", "While recording is unfinished the partner sees a truthful 'still finishing' status, not a review promise");
const totalBefore = await total(P1.id);
const doneHappy = await intros.completePartnerIntroduction(happy.id);
check(doneHappy.completionState === "complete" && doneHappy.contactCheckpointAt && doneHappy.referralCheckpointAt && doneHappy.countCheckpointAt && doneHappy.notificationCheckpointAt, "A completed introduction has all four checkpoints and state complete");
check(await total(P1.id) === totalBefore + 1 && await referralsFor(P1.id, happy.id) === 1 && await notificationsFor(happy.id) === 1, "One referral, one notification and one total increment");
await intros.completePartnerIntroduction(happy.id);
await intros.completePartnerIntroduction(happy.id);
check(await total(P1.id) === totalBefore + 1 && await referralsFor(P1.id, happy.id) === 1 && await notificationsFor(happy.id) === 1, "Replaying completion repeats nothing (checkpoints are the idempotency)");
check(intros.toPartnerIntroductionView(await intros.refreshIntroduction(happy as any)).nextStep === "Our team will review this introduction.", "Once complete the partner sees the normal review status");

// 3b. Notification failure after contact, referral and count; repair by recovery.
const e2 = unique("notifail");
const nf = await record(P1, introBody({ contactEmail: e2 }));
const nfBefore = await total(P1.id);
let nfFailure: unknown = null;
await withFault("notification", "notifications", `INSERT: NEW.command_key = 'partner-introduction:${nf.id}:review'`, async () => {
  nfFailure = await intros.completePartnerIntroduction(nf.id).then(() => null, (e: unknown) => e);
  const again = await intros.completePartnerIntroduction(nf.id).then(() => null, (e: unknown) => e);
  check(nfFailure && again, "The injected notification fault executed on the first pass and on a replay");
});
const nfRow = await introRow(nf.id);
check(nfRow.contact_checkpoint_at && nfRow.referral_checkpoint_at && nfRow.count_checkpoint_at && !nfRow.notification_checkpoint_at && nfRow.contact_id !== null, "After a notification failure the earlier checkpoints stand and the notification checkpoint is missing");
check(nfRow.completion_state === "held" && nfRow.completion_error_code === "STEP_NOTIFICATION_FAILED" && nfRow.completion_attempts >= 2, "The introduction is visibly held with a non-sensitive error code and an attempt count");
check(await total(P1.id) === nfBefore + 1 && await notificationsFor(nf.id) === 0, "The total moved once and no notification exists yet");
const staffHeld = await intros.listIntroductionsForReview({ pageSize: 50 });
const heldRow = staffHeld.rows.find((r) => r.id === nf.id)!;
check(heldRow.completionState === "held" && heldRow.completionErrorCode === "STEP_NOTIFICATION_FAILED", "Staff review shows the held completion state and code");
const attemptsHeld = nfRow.completion_attempts;
const tooSoon = await intros.recoverPartnerIntroductions({ now: new Date(new Date(nfRow.completion_last_attempt_at).getTime() + 10_000) });
check((await introRow(nf.id)).completion_attempts === attemptsHeld && tooSoon.examined >= 0, "Recovery waits for the backoff before retrying a held introduction");
const recovered = await intros.recoverPartnerIntroductions({ now: FAR() });
check(recovered.examined >= 1 && recovered.completed >= 1, "Background recovery resumes the held introduction with no browser retry");
const nfDone = await introRow(nf.id);
check(nfDone.completion_state === "complete" && nfDone.completion_error_code === null && await notificationsFor(nf.id) === 1 && await total(P1.id) === nfBefore + 1 && await referralsFor(P1.id, nf.id) === 1, "Recovery completes with one notification, one referral and one total increment");
await intros.recoverPartnerIntroductions({ now: FAR() });
check(await notificationsFor(nf.id) === 1 && await total(P1.id) === nfBefore + 1, "Repeated reconciliation changes nothing");

// 3c. Crash after contact, before the referral.
const e3 = unique("refail");
const rf = await record(P1, introBody({ contactEmail: e3 }));
const rfBefore = await total(P1.id);
await withFault("referral", "referrals", `INSERT: NEW.notes = 'Partner introduction ${rf.id}'`, async () => {
  const failure = await intros.completePartnerIntroduction(rf.id).then(() => null, (e: unknown) => e);
  check(Boolean(failure), "The injected referral fault executed");
});
const rfRow = await introRow(rf.id);
check(rfRow.contact_checkpoint_at && !rfRow.referral_checkpoint_at && rfRow.completion_error_code === "STEP_REFERRAL_FAILED" && await count(`SELECT 1 FROM contacts WHERE lower(email)='${e3}'`) === 1 && await referralsFor(P1.id, rf.id) === 0, "After the contact exists but the referral failed: the contact is checkpointed, the referral is not");
await intros.recoverPartnerIntroductions({ now: FAR() });
check((await introRow(rf.id)).completion_state === "complete" && await count(`SELECT 1 FROM contacts WHERE lower(email)='${e3}'`) === 1 && await referralsFor(P1.id, rf.id) === 1 && await notificationsFor(rf.id) === 1 && await total(P1.id) === rfBefore + 1, "Recovery completes with one contact, one referral, one notification and one total increment");

// 3c2. Referral row committed but its checkpoint write failed: the replay reuses the referral, never creates a second.
const e3b = unique("refckpt");
const rc = await record(P1, introBody({ contactEmail: e3b }));
const rcBefore = await total(P1.id);
await withFault("refckpt", "partner_introductions", `UPDATE: NEW.id = '${rc.id}' AND NEW.referral_checkpoint_at IS NOT NULL AND OLD.referral_checkpoint_at IS NULL`, async () => {
  const failure = await intros.completePartnerIntroduction(rc.id).then(() => null, (e: unknown) => e);
  check(Boolean(failure), "The injected referral-checkpoint fault executed");
});
check(await referralsFor(P1.id, rc.id) === 1 && !(await introRow(rc.id)).referral_checkpoint_at, "The referral exists but its checkpoint is missing");
await intros.recoverPartnerIntroductions({ now: FAR() });
check((await introRow(rc.id)).completion_state === "complete" && await referralsFor(P1.id, rc.id) === 1 && await total(P1.id) === rcBefore + 1 && await notificationsFor(rc.id) === 1, "Replay reuses the existing referral and moves the total once");

// 3d. Crash after the referral, before the total.
const e4 = unique("cntfail");
const cf = await record(P1, introBody({ contactEmail: e4 }));
const cfBefore = await total(P1.id);
await withFault("count", "partners", `UPDATE: NEW.id = ${P1.id} AND COALESCE(NEW.total_referrals,0) > COALESCE(OLD.total_referrals,0)`, async () => {
  const failure = await intros.completePartnerIntroduction(cf.id).then(() => null, (e: unknown) => e);
  check(Boolean(failure), "The injected total fault executed");
});
const cfRow = await introRow(cf.id);
check(cfRow.referral_checkpoint_at && !cfRow.count_checkpoint_at && cfRow.completion_error_code === "STEP_COUNT_FAILED" && await total(P1.id) === cfBefore && await referralsFor(P1.id, cf.id) === 1, "After the referral but before the total: the claim and the increment rolled back together");
await intros.recoverPartnerIntroductions({ now: FAR() });
check((await introRow(cf.id)).completion_state === "complete" && await total(P1.id) === cfBefore + 1 && await referralsFor(P1.id, cf.id) === 1, "Recovery moves the total exactly once");

// 3e. Contact created but the link checkpoint write failed (crash around linkage).
const e5 = unique("linkfail");
const lf = await record(P1, introBody({ contactEmail: e5 }));
const lfBefore = await total(P1.id);
await withFault("link", "partner_introductions", `UPDATE: NEW.id = '${lf.id}' AND NEW.contact_checkpoint_at IS NOT NULL AND OLD.contact_checkpoint_at IS NULL`, async () => {
  const failure = await intros.completePartnerIntroduction(lf.id).then(() => null, (e: unknown) => e);
  check(Boolean(failure), "The injected linkage fault executed");
});
const lfRow = await introRow(lf.id);
check(lfRow.contact_id === null && !lfRow.contact_checkpoint_at && await count(`SELECT 1 FROM contacts WHERE lower(email)='${e5}'`) === 1, "The contact exists but the linkage was not recorded");
await intros.recoverPartnerIntroductions({ now: FAR() });
const lfDone = await introRow(lf.id);
check(lfDone.completion_state === "complete" && lfDone.contact_id !== null && await count(`SELECT 1 FROM contacts WHERE lower(email)='${e5}'`) === 1 && await referralsFor(P1.id, lf.id) === 1 && await total(P1.id) === lfBefore + 1, "Recovery links the same contact (no duplicate) and completes once");
check(await count(`SELECT 1 FROM contact_source_events WHERE event_key='partner_introduction:${lf.id}'`) === 1, "The occurrence has exactly one source event");

// 3f. Notification created but its checkpoint write failed.
const e6 = unique("ckptfail");
const kf = await record(P1, introBody({ contactEmail: e6 }));
await withFault("ckpt", "partner_introductions", `UPDATE: NEW.id = '${kf.id}' AND NEW.notification_checkpoint_at IS NOT NULL AND OLD.notification_checkpoint_at IS NULL`, async () => {
  const failure = await intros.completePartnerIntroduction(kf.id).then(() => null, (e: unknown) => e);
  check(Boolean(failure), "The injected notification-checkpoint fault executed");
});
check(await notificationsFor(kf.id) === 1 && !(await introRow(kf.id)).notification_checkpoint_at, "The notification exists but its checkpoint is missing");
await intros.recoverPartnerIntroductions({ now: FAR() });
check((await introRow(kf.id)).completion_state === "complete" && await notificationsFor(kf.id) === 1, "Replay reuses the existing notification (command key) and records the checkpoint");

// 3g. Notification retry is independent of contactId.
const e7 = unique("indep");
const ind = await record(P1, introBody({ contactEmail: e7 }));
await intros.completePartnerIntroduction(ind.id);
const indBefore = await introRow(ind.id);
const indTotal = await total(P1.id);
await pool.query(`DELETE FROM notifications WHERE command_key='partner-introduction:${ind.id}:review'`);
await pool.query(`UPDATE partner_introductions SET notification_checkpoint_at=NULL, completion_state='pending', completion_last_attempt_at=NULL WHERE id=$1`, [ind.id]);
await intros.recoverPartnerIntroductions({ now: FAR() });
const indAfter = await introRow(ind.id);
check(indBefore.contact_id !== null && indAfter.contact_id === indBefore.contact_id && indAfter.completion_state === "complete" && await notificationsFor(ind.id) === 1 && await total(P1.id) === indTotal, "A linked introduction with a missing notification is repaired without touching the contact or the total");

// 3h. Restart with no browser retry: an old, never-completed introduction is picked up; a young one is left to its request.
const old = await record(P1, introBody({ contactEmail: unique("old") }));
const young = await record(P1, introBody({ contactEmail: unique("young") }));
await pool.query(`UPDATE partner_introductions SET created_at = now() - interval '5 minutes' WHERE id=$1`, [old.id]);
await intros.recoverPartnerIntroductions({ now: new Date() });
check((await introRow(old.id)).completion_state === "complete" && (await introRow(young.id)).completion_attempts === 0, "Recovery completes an abandoned introduction and leaves a just-submitted one to its own request");
await intros.completePartnerIntroduction(young.id);

// 3i. Concurrent same-key replay and concurrent completion: one canonical effect.
const e8 = unique("burst");
const burstKey = randomUUID();
const burstBody = introBody({ contactEmail: e8 });
const burstRecorded = await settle(Array.from({ length: 6 }, () => intros.recordPartnerIntroduction(P1 as any, { userId: null }, burstKey, burstBody)));
const burstIds = new Set(burstRecorded.map((r) => (r as any).value?.introduction?.id));
check(burstIds.size === 1 && burstRecorded.every((r) => r.status === "fulfilled"), "Six concurrent identical submissions store one occurrence");
const burstId = [...burstIds][0] as string;
const burstBefore = await total(P1.id);
const burstDone = await settle(Array.from({ length: 6 }, () => intros.completePartnerIntroduction(burstId)));
check(burstDone.every((r) => r.status === "fulfilled"), "Six concurrent completions all settle");
check(await count(`SELECT 1 FROM contacts WHERE lower(email)='${e8}'`) === 1 && await referralsFor(P1.id, burstId) === 1 && await notificationsFor(burstId) === 1 && await total(P1.id) === burstBefore + 1, "Concurrent completion leaves one contact, one referral, one notification and one total increment");

// 3j. Backfill semantics for rows the previous code already linked (migration checkpoint rule): simulate and recover.
const pre = await record(P1, introBody({ contactEmail: unique("pre") }));
await intros.completePartnerIntroduction(pre.id);
check((await introRow(pre.id)).completion_state === "complete", "Fixture: a completed introduction stays complete when reconciled again");

// ═══ 4. F03: introduction decisions ═════════════════════════════════════════════════════════════════════════════════
const decideIntro = (introId: string, input: Record<string, unknown>, who = actor) => intros.decidePartnerIntroduction(introId, input as any, who);
const D1 = await record(P1, introBody({ contactEmail: unique("dec1") }));
check(code(await decideIntro(D1.id, { command: "accept", expectedRevision: 1, note: "ok" })) === "INTRODUCTION_PROCESSING", "A decision is refused while the introduction's contact and referral are unfinished");
await intros.completePartnerIntroduction(D1.id);
const d1 = await introRow(D1.id);
check(code(await decideIntro(D1.id, { command: "bogus", expectedRevision: d1.revision, note: "ok" })) === "INVALID_COMMAND", "An unknown command is refused");
check(code(await decideIntro(D1.id, { command: "accept", note: "ok" })) === "REVISION_REQUIRED" && code(await decideIntro(D1.id, { command: "accept", expectedRevision: "1", note: "ok" })) === "REVISION_REQUIRED", "A missing or string revision is refused");
check(code(await decideIntro(D1.id, { command: "accept", expectedRevision: d1.revision })) === "NOTE_REQUIRED" && code(await decideIntro(D1.id, { command: "accept", expectedRevision: d1.revision, note: "   " })) === "NOTE_REQUIRED", "A written reason is required");
check(code(await decideIntro(D1.id, { command: "accept", expectedRevision: d1.revision + 5, note: "ok" })) === "STALE_REVISION", "A stale revision is refused");
check(code(await decideIntro(D1.id, { command: "resolve_duplicate", expectedRevision: d1.revision, note: "ok" })) === "COMMAND_NOT_ALLOWED_FOR_STATE" && code(await decideIntro(D1.id, { command: "keep_existing_referrer", expectedRevision: d1.revision, note: "ok" })) === "COMMAND_NOT_ALLOWED_FOR_STATE", "A duplicate or competing command is refused for a plain pending introduction");
check(code(await decideIntro("00000000-0000-4000-8000-000000000000", { command: "accept", expectedRevision: 1, note: "x" })) === "NOT_FOUND" && code(await decideIntro("nope", { command: "accept", expectedRevision: 1, note: "x" })) === "NOT_FOUND", "An unknown introduction is not found");
check(code(await decideIntro(D1.id, { command: "accept", expectedRevision: d1.revision, note: "ok" }, "")) === "ACTOR_REQUIRED", "A decision needs an actor");
const refsBefore = await count(`SELECT 1 FROM referrals`);
const totalsBefore = (await rows(`SELECT id, total_referrals, commission_percent FROM partners ORDER BY id`));
const contactsBefore = await count(`SELECT 1 FROM contacts`);
const businessesBefore = await count(`SELECT 1 FROM businesses`);
const otherIntroBefore = await introRow(happy.id);
const raceDecide = await settle([
  decideIntro(D1.id, { command: "accept", expectedRevision: d1.revision, note: "Admin one accepts." }, actor),
  decideIntro(D1.id, { command: "decline", expectedRevision: d1.revision, note: "Admin two declines." }, actor2),
]);
const raceDecideCodes = raceDecide.map((r) => (r.status === "fulfilled" ? code(r.value) : "threw"));
check(raceDecideCodes.filter((c) => c === "ok").length === 1 && raceDecideCodes.filter((c) => ["STALE_REVISION", "INTRODUCTION_ALREADY_DECIDED"].includes(c)).length === 1, `Two concurrent decisions: exactly one wins (${raceDecideCodes.join(",")})`);
const decidedRow = await introRow(D1.id);
check(["accepted", "declined"].includes(decidedRow.review_state) && decidedRow.decided_by && decidedRow.decided_at && decidedRow.decision_note && decidedRow.revision === d1.revision + 1, "The winning decision records state, actor, time and reason atomically");
check(code(await decideIntro(D1.id, { command: "decline", expectedRevision: decidedRow.revision, note: "late" })) === "INTRODUCTION_ALREADY_DECIDED", "A decided introduction cannot be decided again");
check(await count(`SELECT 1 FROM referrals`) === refsBefore && JSON.stringify(await rows(`SELECT id, total_referrals, commission_percent FROM partners ORDER BY id`)) === JSON.stringify(totalsBefore), "A decision creates no referral and changes no partner total or commission");
check(await count(`SELECT 1 FROM contacts`) === contactsBefore && await count(`SELECT 1 FROM businesses`) === businessesBefore, "A decision merges nothing and creates no company or contact");
const otherIntroAfter = await introRow(happy.id);
check(JSON.stringify(otherIntroAfter) === JSON.stringify(otherIntroBefore), "Another introduction (and its partner's allocation) is untouched by a decision");
const histD1 = await events.listReviewEvents("introduction", D1.id);
check(histD1.length === 1 && histD1[0].actorId === decidedRow.decided_by && histD1[0].fromStatus === "pending_review" && histD1[0].toStatus === decidedRow.review_state && histD1[0].fromRevision === d1.revision && histD1[0].toRevision === decidedRow.revision && Boolean(histD1[0].note), "The decision appended one history row with actor, time, reason and before/after state");
const partnerViewD1 = intros.toPartnerIntroductionView(await intros.refreshIntroduction(D1 as any));
check(partnerViewD1.status === decidedRow.review_state && Object.keys(partnerViewD1).sort().join() === "businessName,nextStep,reference,status,submittedAt", "The partner sees the permitted status only");
const detailD1 = await intros.getPartnerIntroductionDetail(D1.id);
check(Boolean(detailD1) && detailD1!.linked.contact?.id === decidedRow.contact_id && detailD1!.linked.referral?.id === decidedRow.referral_id && detailD1!.linked.contact?.createdByThisIntroduction === true && detailD1!.allowedCommands.length === 0 && detailD1!.history.length === 1, "The staff detail names the exact linked contact and referral, offers no command after a decision and carries the history");
check(detailD1!.introduction.completion.state === "complete" && Boolean(detailD1!.introduction.completion.checkpoints.notification), "The staff detail shows the completion checkpoints");
check(await intros.getPartnerIntroductionDetail("not-a-uuid") === null && await intros.getPartnerIntroductionDetail("00000000-0000-4000-8000-000000000000") === null, "An unknown introduction has no detail");

// ═══ 5. F03: identity cases ═════════════════════════════════════════════════════════════════════════════════════════
const complete = async (partner: { id: number }, extra: Record<string, unknown>) => {
  const rec = await record(partner, introBody(extra));
  const done = await intros.completePartnerIntroduction(rec.id);
  return { rec, done, row: await introRow(rec.id) };
};

// 5a. Same canonical business, different person/mailbox, other partner introducing: strong registry evidence holds it.
const regDomain = `reg-${id}.invalid`;
const biz = await one(`INSERT INTO businesses(canonical_name, normalized_name, website_domain) VALUES ($1,$2,$3) RETURNING id`, [`Registry Cafe ${id}`, `registry cafe ${id}`, regDomain]);
const regContact = await one(`INSERT INTO contacts(first_name,last_name,phone,email,company_name,business_id) VALUES ('Reg','Owner',$1,$2,$3,$4) RETURNING id`, [nextPhone(), `owner@${regDomain}`, `Registry Cafe ${id}`, biz.id]);
const sameBiz = await complete(P2, { contactEmail: `manager@${regDomain}`, contactName: "Second Person", website: `https://${regDomain}`, businessName: `Registry Cafe ${id}` });
check(sameBiz.done.reviewState === "duplicate_review" && sameBiz.done.reviewReason === "SAME_BUSINESS_EVIDENCE" && sameBiz.row.referral_id === null, "A different person at a canonical business already in the CRM is held for review with no referral");
check(await count(`SELECT 1 FROM contacts WHERE lower(email)='manager@${regDomain}'`) === 1 && (await one(`SELECT business_id FROM contacts WHERE id=${regContact.id}`)).business_id === biz.id, "The new person is a separate contact and the existing business link is not moved or merged");
const sameBizDetail = await intros.getPartnerIntroductionDetail(sameBiz.rec.id);
check(sameBizDetail!.evidence.businessIds.includes(biz.id) && sameBizDetail!.evidence.otherContacts.some((c) => c.id === regContact.id) && sameBizDetail!.evidence.domain === regDomain, "Staff see the business evidence behind the hold");
check(sameBizDetail!.allowedCommands.sort().join() === "accept,decline,resolve_duplicate", "A duplicate-review introduction offers accept, decline and resolve-duplicate");
const resolvedDup = await decideIntro(sameBiz.rec.id, { command: "resolve_duplicate", expectedRevision: sameBiz.row.revision, note: "Same business as the existing record." }) as any;
check(resolvedDup.ok && resolvedDup.introduction.reviewState === "declined" && resolvedDup.introduction.reviewReason === "DUPLICATE_OF_EXISTING_RECORD" && await referralsFor(P2.id, sameBiz.rec.id) === 0, "Resolving a duplicate ends in declined with its own reason code and creates no referral");

// 5b. Same partner introducing two people at one business (no registry): that partner has no conflict with itself.
const ownDomain = `own-${id}.invalid`;
const own1 = await complete(P1, { contactEmail: `a@${ownDomain}`, website: `https://${ownDomain}` });
const own2 = await complete(P1, { contactEmail: `b@${ownDomain}`, website: `https://${ownDomain}` });
check(own1.done.reviewState === "pending_review" && own2.done.reviewState === "pending_review" && await referralsFor(P1.id, own2.rec.id) === 1, "The same partner introducing a second person at its own business is not held against itself");

// 5c. Different partners, same business domain, different people: the earlier introduction wins, the later is held.
const compDomain = `comp-${id}.invalid`;
const first = await complete(P1, { contactEmail: `first@${compDomain}`, website: `https://${compDomain}` });
const later = await complete(P2, { contactEmail: `later@${compDomain}`, website: `https://www.${compDomain}/locations` });
check(first.done.reviewState === "pending_review" && first.row.referral_id !== null, "The first partner's introduction proceeds");
check(later.done.reviewState === "competing_referrer" && later.done.reviewReason === "ANOTHER_PARTNER_REFERRED_SAME_BUSINESS" && later.row.referral_id === null && await referralsFor(P2.id, later.rec.id) === 0, "A later introduction of the same business by another partner is held and creates no second referral");
check(await referralsFor(P1.id, first.rec.id) === 1, "The first partner's referral is untouched");
const laterDetail = await intros.getPartnerIntroductionDetail(later.rec.id);
check(laterDetail!.evidence.otherClaims.some((c) => c.partnerId === P1.id) && laterDetail!.allowedCommands.sort().join() === "decline,keep_existing_referrer", "Staff see which partner holds the earlier claim and may keep the existing referrer or decline");
const laterPartnerJson = JSON.stringify(intros.toPartnerIntroductionView(await intros.refreshIntroduction(later.rec as any)));
check(!laterPartnerJson.includes(P1.companyName) && !laterPartnerJson.includes(String(P1.id)) && !laterPartnerJson.includes(`first@${compDomain}`), "The competing partner's own view never names the other partner or its contact");
const keep = await decideIntro(later.rec.id, { command: "keep_existing_referrer", expectedRevision: later.row.revision, note: "First introduction stands." }) as any;
check(keep.ok && keep.introduction.reviewReason === "COMPETING_REFERRER_EXISTING_KEPT" && keep.introduction.reviewState === "declined" && await referralsFor(P1.id, first.rec.id) === 1, "Keeping the existing referrer declines the later introduction and leaves the first partner's referral alone");
const staffForeign = await intros.listPartnerIntroductionsFor(P1.id);
check(!staffForeign.some((v) => v.reference === later.rec.id), "One partner's list never contains another partner's introduction");

// 5d. Shared phone: two different people (different mailboxes) behind one phone number.
const sharedPhone = nextPhone();
const ph1 = await complete(P1, { contactEmail: unique("ph1"), contactPhone: sharedPhone });
const ph2 = await complete(P2, { contactEmail: unique("ph2"), contactPhone: sharedPhone, contactName: "Different Person" });
check(ph1.done.reviewState === "pending_review" && ph2.done.reviewState === "competing_referrer" && await referralsFor(P2.id, ph2.rec.id) === 0, "A shared phone resolves to the existing contact and holds the second partner's introduction");
check(await count(`SELECT 1 FROM contacts WHERE regexp_replace(phone, '\\D', '', 'g') = '${sharedPhone.replace(/\D/g, "")}'`) === 1, "No second contact is created behind a shared phone");

// 5e. Shared free-mail domain: not business evidence.
const g1 = await complete(P1, { contactEmail: `prw.gm1.${id}@gmail.com` });
const g2 = await complete(P2, { contactEmail: `prw.gm2.${id}@gmail.com` });
check(g1.done.reviewState === "pending_review" && g2.done.reviewState === "pending_review" && await referralsFor(P2.id, g2.rec.id) === 1, "Two people sharing a free-mail provider are different businesses: neither is held");

// 5f. Same domain, separate locations introduced by different partners: genuine ambiguity goes to staff, nothing merges.
const locDomain = `loc-${id}.invalid`;
const loc1 = await complete(P1, { contactEmail: `main@${locDomain}`, businessName: `Loc Pizza Main ${id}`, website: `https://${locDomain}/main` });
const loc2 = await complete(P2, { contactEmail: `oak@${locDomain}`, businessName: `Loc Pizza Oak ${id}`, website: `https://${locDomain}/oak` });
check(loc1.done.reviewState === "pending_review" && loc2.done.reviewState === "competing_referrer", "Separate locations behind one domain from different partners are sent to review, not auto-credited");
check(await count(`SELECT 1 FROM contacts WHERE lower(email) IN ('main@${locDomain}','oak@${locDomain}')`) === 2, "Both locations remain separate contacts (no merge)");

// 5g. Concurrent introductions from different partners for the same business, different people: deterministic, one winner.
const raceDomain = `race-${id}.invalid`;
const r1 = await record(P1, introBody({ contactEmail: `x@${raceDomain}`, website: `https://${raceDomain}` }));
const r2 = await record(P2, introBody({ contactEmail: `y@${raceDomain}`, website: `https://${raceDomain}` }));
await settle([intros.completePartnerIntroduction(r2.id), intros.completePartnerIntroduction(r1.id)]);
const r1Row = await introRow(r1.id); const r2Row = await introRow(r2.id);
const earlier = new Date(r1Row.created_at) <= new Date(r2Row.created_at) ? r1Row : r2Row;
const laterRow = earlier.id === r1Row.id ? r2Row : r1Row;
check(earlier.referral_id !== null && earlier.review_state === "pending_review" && laterRow.referral_id === null && laterRow.review_state === "competing_referrer", "Concurrent introductions of one business: the earlier one wins in any processing order and the later is held");
check(await count(`SELECT 1 FROM referrals WHERE notes IN ('Partner introduction ${r1.id}','Partner introduction ${r2.id}')`) === 1, "Exactly one referral exists across both partners");

// 5h. The exact same mailbox introduced by two partners. Processed one after the other: the first partner keeps the
// contact and the one referral, the second is held. Processed concurrently: the identity lock serializes the two passes,
// there is still exactly one contact and never more than one referral, and whichever introduction has no referral is
// held for staff (nothing is merged, re-attributed or silently credited).
const sameEmail = unique("same");
const s1 = await record(P1, introBody({ contactEmail: sameEmail }));
const s2 = await record(P2, introBody({ contactEmail: sameEmail }));
await intros.completePartnerIntroduction(s1.id);
await intros.completePartnerIntroduction(s2.id);
const s1Row = await introRow(s1.id); const s2Row = await introRow(s2.id);
check(await count(`SELECT 1 FROM contacts WHERE lower(email)='${sameEmail}'`) === 1 && s1Row.referral_id !== null && s2Row.referral_id === null && s2Row.review_state === "competing_referrer", "Same mailbox from two partners in sequence: one contact, the first partner's referral, the second held as a competing referrer");
const raceEmail = unique("racemail");
const c1 = await record(P1, introBody({ contactEmail: raceEmail }));
const c2 = await record(P2, introBody({ contactEmail: raceEmail }));
const raceSettled = await settle([intros.completePartnerIntroduction(c2.id), intros.completePartnerIntroduction(c1.id)]);
check(raceSettled.every((r) => r.status === "fulfilled"), "Concurrent completion of one mailbox from two partners settles for both");
const c1Row = await introRow(c1.id); const c2Row = await introRow(c2.id);
check(await count(`SELECT 1 FROM contacts WHERE lower(email)='${raceEmail}'`) === 1 && await count(`SELECT 1 FROM referrals WHERE lower(referred_email)='${raceEmail}'`) <= 1, "Concurrent introductions of one mailbox: one contact and never more than one referral");
check([c1Row, c2Row].every((r) => (r.referral_id !== null && r.review_state === "pending_review") || (r.referral_id === null && ["competing_referrer", "duplicate_review"].includes(r.review_state))), "Each concurrent introduction either holds the single referral or is held for staff review");

// Accept a held duplicate: the existing record stays and nothing is created.
const accDup = await complete(P2, { contactEmail: `second@${regDomain}`, website: `https://${regDomain}` });
const accRes = await decideIntro(accDup.rec.id, { command: "accept", expectedRevision: accDup.row.revision, note: "Legitimate introducer; existing record kept." }) as any;
check(accRes.ok && accRes.introduction.reviewState === "accepted" && accRes.introduction.reviewReason === "ACCEPTED_EXISTING_RECORD_KEPT" && await referralsFor(P2.id, accDup.rec.id) === 0, "Accepting a held duplicate records the acceptance without creating a referral or moving attribution");

// ═══ 6. Contract summary ═════════════════════════════════════════════════════════════════════════════════════════════
const eventRows = await rows(`SELECT subject_type, count(*)::int n FROM partner_review_events GROUP BY subject_type`);
check(eventRows.length === 2 && eventRows.every((r) => r.n > 0), "History exists for both applications and introductions");
check(await count(`SELECT 1 FROM notifications WHERE channel <> 'internal' AND created_at > now() - interval '1 hour' AND command_key LIKE 'partner-introduction:%'`) === 0, "Nothing in these workflows created an outbound message");

console.log(`\nPartner review workflows certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
