/**
 * Partner program lifecycle certification (disposable PostgreSQL; no provider, no network, no send).
 *
 * Proves, against the real services and the migrated schema:
 *  - an application creates a pending partner with no credential, no commission terms (explicit null) and no users row,
 *    and one mailbox cannot hold two applications under concurrency;
 *  - a decision is compare-and-set on the application revision: exactly one of two concurrent accepts wins, a stale
 *    revision is refused, accepting records the typed terms plus the schedule reference and queues ONE invitation
 *    intent in the same transaction, declining leaves the partner inactive with no invitation, and "needs info" keeps
 *    the application open;
 *  - accepting an application never records marketing consent and never gives a user the staff "agent" role;
 *  - the published referral policy has one approved version at a time, is created as a draft first, supersedes the
 *    previous version on approval, and falls back to the written-agreement default when revoked;
 *  - an introduction is an idempotent occurrence per (partner, key): same key + same body replays, same key + a
 *    different body is a conflict, an inactive partner is refused, and N concurrent identical submissions store one;
 *  - completing an introduction twice leaves one contact and one review notification, a second partner introducing the
 *    same business is sent to review (never a second referral or silent steal), and the partner-facing view carries no
 *    contact details;
 *  - an application that is not accepted never gets a login, password reset or invitation: no reset token is issued, a
 *    token that exists anyway is refused, a planted credential cannot sign in, while accepted and legacy credentialed
 *    partners keep invitation and reset access.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Partner program lifecycle certification" });
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const auth = await import("../../server/services/inbound-request-authority");
const applications = await import("../../server/services/partner-application");
const review = await import("../../server/services/partner-application-review");
const policy = await import("../../server/services/partner-public-policy");
const intros = await import("../../server/services/partner-introductions");
const { PARTNER_INTRODUCTION_PERMISSION } = await import("../../shared/partner-public-content");
const { PARTNER_APPLICATION_CONSENT } = await import("../../shared/partner-application");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [PPL-${String(checks).padStart(2, "0")}] ${message}`); };
const id = randomUUID().slice(0, 8);
let phoneSeq = Number.parseInt(id, 16) % 9000;
const nextPhone = () => `+1555${String(1000 + (phoneSeq++ % 9000)).padStart(7, "0")}`.slice(0, 12);
const actor = `ppl-admin-${id}`;

const claim = async (label: string) => {
  const c = await auth.claimInboundRequest({ idempotencyKey: randomUUID(), sourceCategory: "website_form", sourceType: "partner_application", callerScope: "public:cert", actorType: "public", payload: { label } });
  assert.equal(c.outcome, "claimed");
  return (c as any).request as { id: string };
};
const referralInput = (email: string, extra: Record<string, unknown> = {}) => ({
  path: "referral", fullName: "Ppl Fixture", email, phone: nextPhone(), company: `Ppl Co ${id}`, profession: "cpa",
  referralNetwork: "Small business clients", contactPreference: "email", consentVersion: PARTNER_APPLICATION_CONSENT.version,
  marketingOptIn: false, sourcePage: "/partners/referrals", attribution: {}, ...extra,
}) as any;
const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const settle = async <T>(ps: Promise<T>[]) => Promise.allSettled(ps);

// ── 1. Application: pending, no credential, no terms, no login ───────────────────────────────────────────────────────
const emailA = `ppl-a-${id}@fixture.invalid`;
const reqA = await claim("a");
const createdA = await applications.createPartnerApplication(referralInput(emailA), { inboundRequestId: reqA.id });
check(createdA.kind === "created", "A valid application is created");
const partnerA = (createdA as any).partner;
const appA = (createdA as any).application;
check(partnerA.status === "pending" && partnerA.passwordHash === null, "The partner is pending with no password");
check(partnerA.commissionPercent === null, "Commission terms are explicit null, never the column default");
check((await rows(`SELECT 1 FROM users WHERE lower(email)=$1`, [emailA])).length === 0, "No users row (no login) exists for an applicant");
check(appA.reviewStatus === "pending_review" && appA.revision === 1 && appA.marketingOptIn === false, "The application is pending review at revision 1 with no marketing opt-in");
check(appA.consentTextSha256.length === 64 && appA.consentVersion === PARTNER_APPLICATION_CONSENT.version, "Contact-consent wording is stored as a server-resolved hash");
check((await rows(`SELECT submitted_email FROM inbound_requests WHERE id=$1`, [reqA.id]))[0].submitted_email === emailA, "The occurrence is bound to the mailbox in the same transaction");

// Refusals are explicit and create nothing.
const reqDup = await claim("dup");
const dup = await applications.createPartnerApplication(referralInput(emailA), { inboundRequestId: reqDup.id });
check(dup.kind === "refused" && ["PARTNER_EXISTS", "OPEN_APPLICATION"].includes((dup as any).reason) && (await rows(`SELECT 1 FROM partners WHERE lower(email)=$1`, [emailA])).length === 1, "A second application for an open mailbox is refused and creates no second partner");
const badConsent = await applications.createPartnerApplication(referralInput(`ppl-bc-${id}@fixture.invalid`, { consentVersion: "forged-v9" }), { inboundRequestId: (await claim("bc")).id });
check(badConsent.kind === "invalid" && (badConsent as any).reason === "UNKNOWN_CONSENT_VERSION", "An unknown consent version is rejected (wording is resolved server-side)");
const badDisclosure = await applications.createPartnerApplication(referralInput(`ppl-bd-${id}@fixture.invalid`, { marketingOptIn: true, emailDisclosureId: "forged" }), { inboundRequestId: (await claim("bd")).id });
check(badDisclosure.kind === "invalid" && (badDisclosure as any).reason === "UNKNOWN_EMAIL_DISCLOSURE", "A marketing opt-in with an unknown disclosure id is rejected");
const existing = await storage.createPartner({ companyName: `Ppl Existing ${id}`, contactName: "Existing", email: `ppl-ex-${id}@fixture.invalid`, phone: nextPhone(), passwordHash: "hash", partnerType: "referral", affiliateCode: `pplex${id}`, status: "active", commissionPercent: 10 } as any);
const exApp = await applications.createPartnerApplication(referralInput(existing.email!), { inboundRequestId: (await claim("ex")).id });
check(exApp.kind === "refused" && (exApp as any).reason === "PARTNER_EXISTS", "An existing partner mailbox is refused and its historical terms are untouched");
check((await storage.getPartner(existing.id))!.commissionPercent === 10, "Historical commission value is preserved");

// Concurrency: one mailbox, many simultaneous applications.
const emailC = `ppl-c-${id}@fixture.invalid`;
const concurrent = await settle(Array.from({ length: 6 }, async (_, i) => applications.createPartnerApplication(referralInput(emailC), { inboundRequestId: (await claim(`c${i}`)).id })));
const concurrentCreated = concurrent.filter((r) => r.status === "fulfilled" && (r.value as any).kind === "created").length;
const concurrentRefused = concurrent.filter((r) => r.status === "fulfilled" && (r.value as any).kind === "refused").length;
check(concurrentCreated === 1 && concurrentRefused === 5, "Six concurrent applications for one mailbox create exactly one (five refused)");
check((await rows(`SELECT 1 FROM partner_applications WHERE mailbox=$1`, [emailC])).length === 1 && (await rows(`SELECT 1 FROM partners WHERE lower(email)=$1`, [emailC])).length === 1, "Exactly one application row and one partner row exist for that mailbox");

// ── 2. Review list and filters ───────────────────────────────────────────────────────────────────────────────────────
const list = await review.listPartnerApplications(review.normalizeApplicationFilters({ status: "pending_review", pageSize: "50" }));
check(list.rows.some((r) => r.id === appA.id && r.termsState === "pending"), "The pending application is listed with terms pending");
const unassigned = await review.listPartnerApplications(review.normalizeApplicationFilters({ owner: "unassigned", pageSize: "50" }));
check(unassigned.rows.some((r) => r.id === appA.id), "With no recorded policy the application shows as unassigned");
const none = await review.listPartnerApplications(review.normalizeApplicationFilters({ status: "declined", pageSize: "50" }));
check(!none.rows.some((r) => r.id === appA.id), "The status filter excludes non-matching applications");
check((review.normalizeApplicationFilters({ pageSize: "9999" }).pageSize ?? Number.POSITIVE_INFINITY) <= review.APPLICATION_PAGE_SIZE_MAX, "Page size is bounded");

// ── 3. Decision validation and CAS ───────────────────────────────────────────────────────────────────────────────────
const decide = (appId: string, input: Record<string, unknown>) => review.decidePartnerApplication(appId, input as any, actor);
const code = (r: any) => (r.ok ? "ok" : r.code);
check(code(await decide(appA.id, { decision: "maybe", expectedRevision: 1 })) === "INVALID_DECISION", "An unknown decision is refused");
check(code(await decide(appA.id, { decision: "accept" })) === "REVISION_REQUIRED", "A missing revision is refused");
check(code(await decide(appA.id, { decision: "accept", expectedRevision: "1" })) === "REVISION_REQUIRED", "A string revision is refused");
for (const bad of [undefined, 0, 101, 12.5, "25", null, -5]) {
  check(code(await decide(appA.id, { decision: "accept", expectedRevision: 1, commissionPercent: bad, scheduleReference: "SCH-1" })) === "TERMS_REQUIRED", `Accepting with terms ${JSON.stringify(bad)} is refused`);
}
check(code(await decide(appA.id, { decision: "accept", expectedRevision: 1, commissionPercent: 20 })) === "SCHEDULE_REFERENCE_REQUIRED", "Accepting without a schedule reference is refused");
check(code(await decide(appA.id, { decision: "decline", expectedRevision: 1 })) === "NOTE_REQUIRED", "Declining without a note is refused");
check(code(await decide(appA.id, { decision: "needs_info", expectedRevision: 1 })) === "NOTE_REQUIRED", "Requesting information without a note is refused");
check(code(await decide(appA.id, { decision: "accept", expectedRevision: 7, commissionPercent: 20, scheduleReference: "SCH-1" })) === "STALE_REVISION", "A stale revision is refused");
check(code(await decide("00000000-0000-4000-8000-000000000000", { decision: "decline", expectedRevision: 1, note: "x" })) === "NOT_FOUND", "An unknown application is not found");
check((await storage.getPartner(partnerA.id))!.status === "pending" && (await rows(`SELECT 1 FROM partner_approval_deliveries WHERE partner_id=$1`, [partnerA.id])).length === 0, "Refused decisions changed nothing and queued nothing");

const info = await decide(appA.id, { decision: "needs_info", expectedRevision: 1, note: "Please confirm your region." }) as any;
check(info.ok && info.application.reviewStatus === "needs_info" && info.application.revision === 2, "Requesting information keeps the application open at the next revision");
check((await storage.getPartner(partnerA.id))!.status === "pending", "Requesting information leaves the partner pending");

// Two concurrent accepts: exactly one wins.
const accepts = await settle([
  decide(appA.id, { decision: "accept", expectedRevision: 2, commissionPercent: 22, scheduleReference: "SCH-2026-A" }),
  decide(appA.id, { decision: "accept", expectedRevision: 2, commissionPercent: 22, scheduleReference: "SCH-2026-A" }),
]);
const winners = accepts.filter((r) => r.status === "fulfilled" && (r.value as any).ok);
const losers = accepts.filter((r) => r.status === "fulfilled" && !(r.value as any).ok).map((r) => (r as any).value.code);
check(winners.length === 1 && losers.length === 1 && ["STALE_REVISION", "APPLICATION_NOT_OPEN"].includes(losers[0]), "Two concurrent accepts: exactly one wins, the other is refused");
const acceptedPartner = (await storage.getPartner(partnerA.id))!;
check(acceptedPartner.status === "active" && acceptedPartner.commissionPercent === 22, "Accepting activates the partner with exactly the typed terms");
const acceptedApp = (await rows(`SELECT review_status, revision, schedule_reference, decided_by FROM partner_applications WHERE id=$1`, [appA.id]))[0];
check(acceptedApp.review_status === "accepted" && acceptedApp.schedule_reference === "SCH-2026-A" && acceptedApp.decided_by === actor, "The decision records the schedule reference and the deciding administrator");
const invites = await rows(`SELECT kind, state FROM partner_approval_deliveries WHERE partner_id=$1`, [partnerA.id]);
check(invites.length === 1 && invites[0].kind === "invite" && invites[0].state === "pending", "Exactly one invitation intent is queued, pending, in the same transaction");
check(code(await decide(appA.id, { decision: "decline", expectedRevision: 3, note: "late" })) === "APPLICATION_NOT_OPEN" || code(await decide(appA.id, { decision: "decline", expectedRevision: 3, note: "late" })) === "STALE_REVISION", "A decided application cannot be decided again");
check((await rows(`SELECT 1 FROM users WHERE lower(email)=$1`, [emailA])).length === 0, "Accepting creates no login and no staff-role user");
check((await rows(`SELECT 1 FROM users WHERE role='agent' AND lower(email)=$1`, [emailA])).length === 0, "No sales-agent decision path creates a staff agent user");
check(appA.marketingOptIn === false && (await rows(`SELECT marketing_opt_in FROM partner_applications WHERE id=$1`, [appA.id]))[0].marketing_opt_in === false, "Acceptance did not grant marketing consent");
const auditAccepted = await rows(`SELECT details FROM audit_logs WHERE action='partner_application_accepted' AND entity_id=$1`, [String(partnerA.id)]);
check(auditAccepted.length >= 1, "The acceptance is audit-logged against the administrator");

// Decline: partner inactive, no invitation.
const emailD = `ppl-d-${id}@fixture.invalid`;
const reqD = await claim("d");
const createdD = await applications.createPartnerApplication(referralInput(emailD), { inboundRequestId: reqD.id }) as any;
const declined = await decide(createdD.application.id, { decision: "decline", expectedRevision: 1, note: "Not a fit." }) as any;
check(declined.ok && declined.application.reviewStatus === "declined", "A decline is recorded");
check((await storage.getPartner(createdD.partner.id))!.status === "inactive" && (await rows(`SELECT 1 FROM partner_approval_deliveries WHERE partner_id=$1`, [createdD.partner.id])).length === 0, "A declined partner is inactive and has no invitation");
check((await storage.getPartner(createdD.partner.id))!.commissionPercent === null, "A declined partner never receives terms");
const reapply = await applications.createPartnerApplication(referralInput(emailD), { inboundRequestId: (await claim("d2")).id });
check(reapply.kind === "refused", "A declined mailbox cannot silently re-apply into a second application");

// Identity and re-application conflicts: each refusal reason has its own test and creates nothing. OPEN_APPLICATION and
// PRIOR_APPLICATION are reached when an application row exists for the mailbox but the partner row no longer carries that
// address (for example the address was corrected in the CRM afterwards); separate fixtures keep the earlier checks intact.
const emailO = `ppl-o-${id}@fixture.invalid`;
const createdO = await applications.createPartnerApplication(referralInput(emailO), { inboundRequestId: (await claim("o")).id }) as any;
await pool.query(`UPDATE partners SET email=$2 WHERE id=$1`, [createdO.partner.id, `ppl-o-moved-${id}@fixture.invalid`]);
const partnersBeforeOpen = (await rows(`SELECT count(*)::int n FROM partners`))[0].n;
const openRefusal = await applications.createPartnerApplication(referralInput(emailO), { inboundRequestId: (await claim("o2")).id }) as any;
check(openRefusal.kind === "refused" && openRefusal.reason === "OPEN_APPLICATION", "A mailbox with an open application is refused as OPEN_APPLICATION");
check((await rows(`SELECT count(*)::int n FROM partners`))[0].n === partnersBeforeOpen && (await rows(`SELECT 1 FROM partner_applications WHERE mailbox=$1`, [emailO])).length === 1, "The OPEN_APPLICATION refusal creates no partner and no second application");

const emailF = `ppl-f-${id}@fixture.invalid`;
const createdF = await applications.createPartnerApplication(referralInput(emailF), { inboundRequestId: (await claim("f")).id }) as any;
check((await decide(createdF.application.id, { decision: "decline", expectedRevision: 1, note: "Not a fit." }) as any).ok, "Fixture: an application for a second mailbox is declined");
await pool.query(`UPDATE partners SET email=$2 WHERE id=$1`, [createdF.partner.id, `ppl-f-moved-${id}@fixture.invalid`]);
const partnersBeforePrior = (await rows(`SELECT count(*)::int n FROM partners`))[0].n;
const priorRefusal = await applications.createPartnerApplication(referralInput(emailF), { inboundRequestId: (await claim("f2")).id }) as any;
check(priorRefusal.kind === "refused" && priorRefusal.reason === "PRIOR_APPLICATION", "A mailbox with a decided earlier application is refused as PRIOR_APPLICATION (not as an open application)");
check((await rows(`SELECT count(*)::int n FROM partners`))[0].n === partnersBeforePrior && (await rows(`SELECT 1 FROM partner_applications WHERE mailbox=$1`, [emailF])).length === 1, "The PRIOR_APPLICATION refusal creates no partner and no second application");
check((await rows(`SELECT review_status FROM partner_applications WHERE mailbox=$1`, [emailF]))[0].review_status === "declined", "The earlier decision is untouched by the refused re-application");

// USER_EXISTS: a login (any role) already owns the address and no partner row does.
const userMailbox = `ppl-user-${id}@fixture.invalid`;
await pool.query(`INSERT INTO users(email, role, auth_provider) VALUES ($1, 'merchant', 'local')`, [userMailbox]);
const userRefusal = await applications.createPartnerApplication(referralInput(userMailbox), { inboundRequestId: (await claim("u1")).id }) as any;
check(userRefusal.kind === "refused" && userRefusal.reason === "USER_EXISTS", "An address that already has a login is refused as USER_EXISTS");
check((await rows(`SELECT 1 FROM partners WHERE lower(email)=$1`, [userMailbox])).length === 0 && (await rows(`SELECT 1 FROM partner_applications WHERE mailbox=$1`, [userMailbox])).length === 0, "The USER_EXISTS refusal creates no partner and no application");
check((await rows(`SELECT role FROM users WHERE lower(email)=$1`, [userMailbox]))[0].role === "merchant", "The existing login is untouched and keeps its role");
check(new Set([exApp, openRefusal, priorRefusal, userRefusal].map((r: any) => r.reason)).size === 4, "The four refusal reasons (existing partner, open application, prior application, existing login) are distinct");

// ── 4. Published referral policy ─────────────────────────────────────────────────────────────────────────────────────
await pool.query(`DELETE FROM partner_public_policy_versions`);
check((await policy.getPublishedReferralPolicy()).state === "written_agreement", "With nothing published the projection is the written-agreement default");
const badDraft = [
  { sharePercent: 0, scheduleReference: "S", copyVersion: "v1" }, { sharePercent: 101, scheduleReference: "S", copyVersion: "v1" },
  { sharePercent: 12.5, scheduleReference: "S", copyVersion: "v1" }, { sharePercent: "20", scheduleReference: "S", copyVersion: "v1" },
  { sharePercent: 20, scheduleReference: "", copyVersion: "v1" }, { sharePercent: 20, scheduleReference: "S", copyVersion: "not valid!" },
];
for (const input of badDraft) check(!(await policy.createReferralPolicyDraft(input as any, actor)).ok, `Draft ${JSON.stringify(input)} is refused`);
const draft1 = await policy.createReferralPolicyDraft({ sharePercent: 19, scheduleReference: "AGREEMENT-FIXTURE-1", copyVersion: "partner-referral@2026-fixture" }, actor);
check(draft1.ok && draft1.value.status === "draft" && draft1.value.version === 1, "A draft is created as version 1 and is not published");
check((await policy.getPublishedReferralPolicy()).state === "written_agreement", "A draft is never published");
const approved1 = await policy.approveReferralPolicy((draft1 as any).value.id, actor);
check(approved1.ok && approved1.value.status === "approved", "Approving a draft publishes it");
const projected = await policy.getPublishedReferralPolicy();
check(projected.state === "approved" && (projected as any).sharePercent === 19 && (projected as any).version === 1, "The projection reflects exactly the approved version");
check(!(await policy.approveReferralPolicy((draft1 as any).value.id, actor)).ok, "An already-approved policy cannot be approved again");
const draft2 = await policy.createReferralPolicyDraft({ sharePercent: 21, scheduleReference: "AGREEMENT-FIXTURE-2", copyVersion: "partner-referral@2026-fixture-b" }, actor);
const draft3 = await policy.createReferralPolicyDraft({ sharePercent: 23, scheduleReference: "AGREEMENT-FIXTURE-3", copyVersion: "partner-referral@2026-fixture-c" }, actor);
await settle([policy.approveReferralPolicy((draft2 as any).value.id, actor), policy.approveReferralPolicy((draft3 as any).value.id, actor)]);
const approvedNow = await rows(`SELECT version, share_percent FROM partner_public_policy_versions WHERE status='approved'`);
check(approvedNow.length === 1, "Concurrent approvals leave exactly one approved version (the previous one is superseded)");
check((await rows(`SELECT status FROM partner_public_policy_versions WHERE version=1`))[0].status === "revoked", "The previously approved version was revoked by the approval");
const revoked = await policy.revokeReferralPolicy((await rows(`SELECT id FROM partner_public_policy_versions WHERE status='approved'`))[0].id, actor);
check(revoked.ok && (await policy.getPublishedReferralPolicy()).state === "written_agreement", "Revoking returns the projection to the written-agreement default");
check(!(await policy.revokeReferralPolicy((revoked as any).value.id, actor)).ok, "A revoked policy cannot be revoked again");
check((await rows(`SELECT 1 FROM audit_logs WHERE action IN ('partner_policy_approved','partner_policy_revoked','partner_policy_draft_created')`)).length >= 4, "Policy changes are audit-logged");

// ── 5. Introductions ─────────────────────────────────────────────────────────────────────────────────────────────────
const introBody = (businessEmail: string, extra: Record<string, unknown> = {}) => {
  const parsed = intros.parseIntroductionBody({
    businessName: `Intro Biz ${id}`, contactName: "Owner Person", contactEmail: businessEmail, contactPhone: nextPhone(),
    permissionConfirmed: true, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version, ...extra,
  });
  assert(parsed.ok, "fixture introduction body must validate");
  return (parsed as any).data;
};
check(!intros.parseIntroductionBody({ businessName: "X", contactName: "Y", contactEmail: "a@b.co", permissionConfirmed: false, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version }).ok, "An introduction without the permission confirmation is refused");
check(!intros.parseIntroductionBody({ businessName: "X", contactName: "Y", permissionConfirmed: true, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version }).ok, "An introduction with no email and no phone is refused");
check(intros.INTRODUCTION_KEY_PATTERN.test(randomUUID()) && !intros.INTRODUCTION_KEY_PATTERN.test("not-a-key"), "The idempotency key must be a UUIDv4");

const introEmail = `intro-biz-${id}@fixture.invalid`;
const body = introBody(introEmail);
const key = randomUUID();
const first = await intros.recordPartnerIntroduction(acceptedPartner, { userId: null }, key, body) as any;
check(first.kind === "recorded" && first.replayed === false && first.introduction.reviewState === "pending_review", "An active partner's introduction is recorded as pending review");
const replay = await intros.recordPartnerIntroduction(acceptedPartner, { userId: null }, key, body) as any;
check(replay.kind === "recorded" && replay.replayed === true && replay.introduction.id === first.introduction.id, "The same key and body replays the same occurrence");
const conflict = await intros.recordPartnerIntroduction(acceptedPartner, { userId: null }, key, introBody(introEmail, { businessName: "Different Biz" })) as any;
check(conflict.kind === "refused" && conflict.status === 409 && conflict.code === "IDEMPOTENCY_CONFLICT", "The same key with a different body is a conflict");
const inactiveRefusal = await intros.recordPartnerIntroduction({ id: createdD.partner.id }, { userId: null }, randomUUID(), body) as any;
check(inactiveRefusal.kind === "refused" && inactiveRefusal.status === 403 && inactiveRefusal.code === "PARTNER_NOT_ACTIVE", "An inactive partner cannot submit an introduction");
const pendingRefusal = await intros.recordPartnerIntroduction({ id: (concurrent.find((r) => r.status === "fulfilled" && (r.value as any).kind === "created") as any).value.partner.id }, { userId: null }, randomUUID(), body) as any;
check(pendingRefusal.kind === "refused" && pendingRefusal.code === "PARTNER_NOT_ACTIVE", "A pending (unapproved) applicant cannot submit an introduction");

const burstKey = randomUUID();
const burstBody = introBody(`intro-burst-${id}@fixture.invalid`, { businessName: `Burst Biz ${id}` });
const burst = await settle(Array.from({ length: 6 }, () => intros.recordPartnerIntroduction(acceptedPartner, { userId: null }, burstKey, burstBody)));
check(burst.every((r) => r.status === "fulfilled") && (await rows(`SELECT 1 FROM partner_introductions WHERE partner_id=$1 AND idempotency_key=$2`, [acceptedPartner.id, burstKey])).length === 1, "Six concurrent identical submissions store exactly one occurrence");

// Completion is repeatable and keyed on the introduction.
const completedOnce = await intros.completePartnerIntroduction(first.introduction.id);
const completedTwice = await intros.completePartnerIntroduction(first.introduction.id);
check(completedOnce.contactId !== null && completedTwice.contactId === completedOnce.contactId, "Completing twice resolves to the same contact");
check((await rows(`SELECT 1 FROM contacts WHERE lower(email)=$1`, [introEmail])).length === 1, "Exactly one contact exists for the introduced business");
check((await rows(`SELECT 1 FROM referrals WHERE partner_id=$1 AND lower(referred_email)=$2`, [acceptedPartner.id, introEmail])).length === 1, "Exactly one referral records the introduction");
check((await rows(`SELECT 1 FROM notifications WHERE metadata->>'introductionId'=$1`, [first.introduction.id])).length === 1, "Exactly one review notification exists for the introduction");
check(completedOnce.reviewState !== "accepted", "Completion never marks an introduction accepted on its own");

// A second partner introducing the same business goes to review; it never creates a second referral or takes the first.
const secondPartnerEmail = `ppl-p2-${id}@fixture.invalid`;
const second = await applications.createPartnerApplication(referralInput(secondPartnerEmail), { inboundRequestId: (await claim("p2")).id }) as any;
await decide(second.application.id, { decision: "accept", expectedRevision: 1, commissionPercent: 18, scheduleReference: "SCH-P2" });
const p2 = (await storage.getPartner(second.partner.id))!;
const secondIntro = await intros.recordPartnerIntroduction(p2, { userId: null }, randomUUID(), body) as any;
const secondDone = await intros.completePartnerIntroduction(secondIntro.introduction.id);
check(["duplicate_review", "competing_referrer"].includes(secondDone.reviewState), `A second partner introducing the same business is sent to review (${secondDone.reviewState})`);
check((await rows(`SELECT 1 FROM referrals WHERE partner_id=$1 AND lower(referred_email)=$2`, [p2.id, introEmail])).length === 0, "No second partner referral is created for an already-introduced business");
const ownList = await intros.listPartnerIntroductionsFor(acceptedPartner.id);
const view = ownList.find((v) => v.reference === first.introduction.id)!;
const viewJson = JSON.stringify(view);
check(Boolean(view) && !viewJson.includes(introEmail) && !viewJson.includes("Owner Person") && Object.keys(view).sort().join(",") === "businessName,nextStep,reference,status,submittedAt", "The partner-facing view carries only the reference, business name, time, status and next step (no contact details, attribution or commission)");
const listed = await intros.listPartnerIntroductionsFor(acceptedPartner.id);
check(listed.length >= 2 && !JSON.stringify(listed).includes(introEmail), "The partner's own list holds its introductions and no contact details");
const p2List = await intros.listPartnerIntroductionsFor(p2.id);
check(p2List.length === 1 && p2List[0].reference === secondIntro.introduction.id, "One partner's list never shows another partner's introduction");
const staff = await intros.listIntroductionsForReview({ reviewState: secondDone.reviewState, pageSize: 50 });
check(staff.rows.some((r) => r.id === secondIntro.introduction.id) && staff.rows.every((r) => !("contactEmail" in r) && !("contactPhone" in r)), "Staff review lists the review-state introduction without email or phone fields");

// ── 6. Credential boundary: an application that is not accepted never opens a login, a reset or an invitation ────────
const { default: express } = await import("express");
const { registerPartnersRoutes } = await import("../../server/routes/partners");
const { issueAuthAction } = await import("../../server/services/auth-actions");
const { partnerMayHoldCredential } = await import("../../server/services/partner-account");
const credApp = express();
credApp.set("trust proxy", "loopback");
credApp.use(express.json());
registerPartnersRoutes(credApp);
const credServer = await new Promise<import("node:http").Server>((resolve) => { const value = credApp.listen(0, "127.0.0.1", () => resolve(value)); });
const credBase = `http://127.0.0.1:${(credServer.address() as import("node:net").AddressInfo).port}`;
let ipSeq = 10;
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${credBase}${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${ipSeq >> 8}.${ipSeq++ & 255}` }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
};
const actionsFor = async (partnerId: number, purpose: string) => rows(`SELECT id FROM auth_actions WHERE subject_type='partner' AND subject_id=$1 AND purpose=$2`, [String(partnerId), purpose]);

const emailP = `ppl-p-${id}@fixture.invalid`;
const createdP = await applications.createPartnerApplication(referralInput(emailP), { inboundRequestId: (await claim("p")).id }) as any;
const partnerP = createdP.partner;
check(!(await partnerMayHoldCredential(partnerP)), "A pending applicant may not hold a credential");
check(!(await partnerMayHoldCredential((await storage.getPartner(createdD.partner.id))!)), "A declined applicant may not hold a credential");
check(await partnerMayHoldCredential((await storage.getPartner(partnerA.id))!), "An accepted applicant may hold a credential");
check(await partnerMayHoldCredential((await storage.getPartner(existing.id))!), "A legacy partner with a credential keeps credential access");

for (const route of ["/api/partner/reset-password-request", "/api/partners/forgot-password"]) {
  const pendingReset = await post(route, { email: emailP });
  check(pendingReset.status === 200 && /If an account/.test(pendingReset.body?.message), `${route}: a pending applicant gets the same generic answer as an unknown address`);
  const unknownReset = await post(route, { email: `ppl-nobody-${id}@fixture.invalid` });
  check(JSON.stringify(unknownReset.body) === JSON.stringify(pendingReset.body), `${route}: the answer does not reveal whether the address applied`);
}
check((await actionsFor(partnerP.id, "partner_password_reset")).length === 0, "No password-reset token was issued for a pending applicant");
const declinedReset = await post("/api/partners/forgot-password", { email: emailD });
check(declinedReset.status === 200 && (await actionsFor(createdD.partner.id, "partner_password_reset")).length === 0, "No password-reset token was issued for a declined applicant");

// A token that exists anyway (issued earlier or by another path) cannot create the first credential.
const forgedPending = await issueAuthAction({ purpose: "partner_password_reset", subject: { type: "partner", id: partnerP.id }, ttlMs: 60_000 });
const forgedReset = await post("/api/partners/reset-password", { token: forgedPending.token, password: "Applicant-chosen-1" });
check(forgedReset.status === 400, "A reset token for a pending applicant is refused");
const forgedLegacyRoute = await post("/api/partner/reset-password", { token: forgedPending.token, password: "Applicant-chosen-1" });
check(forgedLegacyRoute.status === 400, "The legacy reset route refuses it too");
const forgedInvite = await issueAuthAction({ purpose: "partner_invite", subject: { type: "partner", id: partnerP.id }, ttlMs: 60_000 });
check((await post("/api/partners/set-password", { token: forgedInvite.token, password: "Applicant-chosen-1" })).status === 400, "An invitation token for a pending applicant is refused");
const forgedDeclined = await issueAuthAction({ purpose: "partner_password_reset", subject: { type: "partner", id: createdD.partner.id }, ttlMs: 60_000 });
check((await post("/api/partners/reset-password", { token: forgedDeclined.token, password: "Applicant-chosen-1" })).status === 400, "A reset token for a declined applicant is refused");
const afterP = (await storage.getPartner(partnerP.id))!;
check(afterP.passwordHash === null && afterP.status === "pending", "The pending applicant still has no password and is still pending");
check((await rows(`SELECT 1 FROM users WHERE lower(email) = ANY($1)`, [[emailP, emailD]])).length === 0, "No login user exists for either applicant");

// Defense in depth: even a credential that was planted cannot open a session while the application is not accepted.
await pool.query(`UPDATE partners SET password_hash=$2 WHERE id=$1`, [partnerP.id, "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456"]);
for (const route of ["/api/partner/login", "/api/partners/login"]) {
  const login = await post(route, { email: emailP, password: "anything" });
  check(login.status === 401, `${route}: a pending applicant cannot sign in`);
}
check(!(await partnerMayHoldCredential((await storage.getPartner(partnerP.id))!)), "A planted credential does not make a pending applicant eligible");

// The legitimate paths still work: an accepted partner completes the invitation and may then reset; a credentialed legacy partner resets.
const goodInvite = await issueAuthAction({ purpose: "partner_invite", subject: { type: "partner", id: partnerA.id }, ttlMs: 60_000 });
const invited = await post("/api/partners/set-password", { token: goodInvite.token, password: "Invited-partner-1" });
check(invited.status === 200, "An accepted partner can complete the invitation");
const afterA = (await storage.getPartner(partnerA.id))!;
const userA = await rows(`SELECT role FROM users WHERE lower(email)=$1`, [emailA]);
check(Boolean(afterA.passwordHash) && userA.length === 1 && userA[0].role === "partner", "Completing the invitation creates exactly one partner-role login");
const acceptedReset = await post("/api/partners/forgot-password", { email: emailA });
check(acceptedReset.status === 200 && (await actionsFor(partnerA.id, "partner_password_reset")).length === 1, "An accepted, credentialed partner can request a reset");
const legacyReset = await post("/api/partner/reset-password-request", { email: existing.email });
check(legacyReset.status === 200 && (await actionsFor(existing.id, "partner_password_reset")).length === 1, "A credentialed legacy partner keeps reset access");
await new Promise<void>((resolve) => credServer.close(() => resolve()));

console.log(`\nPartner program lifecycle certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
