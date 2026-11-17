import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

/**
 * Staff partner review workspace in a real browser, against the REAL partner handlers and the compiled client.
 *
 * Applications (administrator, real login page, real pointer input):
 *  - the table and detail show the applicant's company or "Company not provided", the owner or an explicit policy gap,
 *    business-zone times and permission-aware "Open" links to the existing contact and website-request destinations;
 *  - "Mark as needing information" is labelled and confirmed as a status change that sends nothing, needs a written note,
 *    and the request log shows exactly one decision call and no send;
 *  - a declined application is returned to review through the audited reopen form (reason required), the history lists
 *    both transitions with actor and note, and a reload of the deep link restores the same application;
 *  - a manager sees the same detail with no decision or reopen control.
 *
 * Introductions:
 *  - a held introduction (another partner already introduced the business) shows identity evidence naming the other
 *    claim, offers only the commands the server allows, requires a reason, and closing it creates no referral, moves no
 *    attribution and merges no contact;
 *  - filters, the open record and the page live in the URL; linked-record links point at the canonical destinations;
 *  - a manager sees the evidence with no decision control.
 *
 * Narrow screen: 390 px has no horizontal scrolling and keeps the review actions reachable.
 *
 * Nothing is sent to a provider: external hosts are blocked by the private browser. Chromium only. This is not a
 * Safari/WebKit, real-phone or screen-reader run.
 */
const identity = await verifyCandidateIdentity();
const directory = "generated-artifacts/partner-review-browser";
const checks: string[] = [];
const ok = (message: string) => { checks.push(message); console.log(`✓ [PRB-${String(checks.length).padStart(2, "0")}] ${message}`); };

const h = await stage3BHttpFixture(async app => {
  const { registerPartnersRoutes } = await import("../server/routes/partners.ts");
  const { registerPartnerProgramRoutes } = await import("../server/routes/partner-program.ts");
  registerPartnersRoutes(app); registerPartnerProgramRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
  const { static: serveStatic } = await import("express");
  app.use(serveStatic("dist/public"));
  app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
});

type Browser = Awaited<ReturnType<typeof privateStage3Browser>>;
const browsers: Browser[] = [];
const open = async () => {
  const browser = await privateStage3Browser(h.base, "", h.originalFetch, directory, { realInput: true });
  browsers.push(browser);
  return browser;
};
const until = async (browser: Browser, expression: string, label = expression) => {
  for (let n = 0; n < 300; n++) { if (await browser.evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`UI condition not reached: ${label}`);
};
const text = (browser: Browser, selector: string) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`) as Promise<string>;
const exists = (browser: Browser, selector: string) => browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`) as Promise<boolean>;
const attr = (browser: Browser, selector: string, name: string) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)})`) as Promise<string | null>;
const where = (browser: Browser) => browser.evaluate(`location.pathname+location.search`) as Promise<string>;
const overflow = (browser: Browser) => browser.evaluate(`({over:document.documentElement.scrollWidth>window.innerWidth+1,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth})`) as Promise<{ over: boolean; scrollWidth: number; innerWidth: number }>;
const signIn = async (browser: Browser, role: "admin" | "manager") => {
  await browser.navigate("/login"); await browser.waitFor(/Sign In/);
  await browser.set('[data-testid="input-email"]', h.email(role)); await browser.set('[data-testid="input-password"]', h.password);
  await browser.click('[data-testid="button-login"]'); await browser.waitFor(/Dashboard|Today|My Day/);
  await browser.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')");
};

// ── Fixtures, created through the real services (no provider, no send) ────────────────────────────────────────────────
const auth = await import("../server/services/inbound-request-authority");
const applications = await import("../server/services/partner-application");
const review = await import("../server/services/partner-application-review");
const intros = await import("../server/services/partner-introductions");
const { PARTNER_INTRODUCTION_PERMISSION } = await import("../shared/partner-public-content");
const { PARTNER_APPLICATION_CONSENT } = await import("../shared/partner-application");
const { storage } = await import("../server/storage");

const tag = h.prefix.slice(-8).toLowerCase();
let phoneSeq = Number.parseInt(tag.slice(0, 6), 16) % 9000;
const nextPhone = () => `+1555${String(1000 + (phoneSeq++ % 9000)).padStart(7, "0")}`.slice(0, 12);
const adminId = h.userId("admin");
const claim = async (label: string) => {
  const c = await auth.claimInboundRequest({ idempotencyKey: randomUUID(), sourceCategory: "website_form", sourceType: "partner_application", callerScope: "public:cert", actorType: "public", payload: { label } });
  assert.equal(c.outcome, "claimed");
  return (c as any).request as { id: string };
};
const applicationInput = (email: string, name: string, extra: Record<string, unknown> = {}) => ({
  path: "referral", fullName: name, email, phone: nextPhone(), company: `${name} Advisory`, profession: "cpa",
  referralNetwork: "Small business clients", contactPreference: "email", consentVersion: PARTNER_APPLICATION_CONSENT.version,
  marketingOptIn: false, sourcePage: "/partners/referrals", attribution: {}, ...extra,
}) as any;
const apply = async (label: string, name: string, extra: Record<string, unknown> = {}) => {
  const email = `${tag}-${label}@example.test`;
  const created = await applications.createPartnerApplication(applicationInput(email, name, extra), { inboundRequestId: (await claim(label)).id }) as any;
  assert.equal(created.kind, "created");
  return { email, partner: created.partner, application: created.application };
};
const acceptedPartner = async (label: string, name: string) => {
  const a = await apply(label, name);
  const decided = await review.decidePartnerApplication(a.application.id, { decision: "accept", expectedRevision: 1, commissionPercent: 15, scheduleReference: `SCH-${label}-${tag}` } as any, adminId) as any;
  assert(decided.ok, `fixture partner ${label} accepted`);
  return (await storage.getPartner(a.partner.id))!;
};
const introduce = async (partner: { id: number }, business: string, phone: string, extra: Record<string, unknown> = {}) => {
  const parsed = intros.parseIntroductionBody({ businessName: business, contactName: "Owner Person", contactPhone: phone, permissionConfirmed: true, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version, ...extra });
  assert((parsed as any).ok);
  const recorded = await intros.recordPartnerIntroduction(partner as any, { userId: null }, randomUUID(), (parsed as any).data) as any;
  assert.equal(recorded.kind, "recorded");
  return intros.completePartnerIntroduction(recorded.introduction.id);
};
const one = async (sql: string, params: unknown[] = []) => (await h.pool.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query(sql, params)).rowCount ?? 0;

const noCompany = await apply("nocompany", "Nora Nocompany", { company: undefined });
const flow = await apply("flow", "Flora Flow");
const first = await acceptedPartner("p1", "Pia First");
const second = await acceptedPartner("p2", "Sol Second");
// A canonical business already in the CRM with its own contact: a different person introduced at the same domain is held.
const regDomain = `registry-${tag.replace(/[^a-z0-9]/g, "")}.example.test`;
const registryBusiness = await one(`INSERT INTO businesses(canonical_name, normalized_name, website_domain) VALUES ($1,$2,$3) RETURNING id`, [`Registry Cafe ${tag}`, `registry cafe ${tag}`, regDomain]);
const registryContact = await one(`INSERT INTO contacts(first_name,last_name,phone,email,company_name,business_id) VALUES ('Reg','Owner',$1,$2,$3,$4) RETURNING id`, [nextPhone(), `owner@${regDomain}`, `Registry Cafe ${tag}`, registryBusiness.id]);
const dupIntro = await introduce(second, `Registry Cafe ${tag}`, nextPhone(), { contactEmail: `manager@${regDomain}`, website: `https://${regDomain}` });
const site = `https://gamma-garage-${tag.replace(/[^a-z0-9]/g, "")}.example.test`;
const gammaFirst = await introduce(first, `Gamma Garage ${tag}`, nextPhone(), { website: site });
const compIntro = await introduce(second, `Gamma Garage ${tag}`, nextPhone(), { website: site });
const plainIntro = await introduce(first, `Beta Bakery ${tag}`, nextPhone());
assert.equal(gammaFirst.reviewState, "pending_review", "the first introduction of the garage is an ordinary pending review");
assert.equal(dupIntro.reviewState, "duplicate_review", `the second partner's introduction of a business with an existing contact is held for review against that business (${dupIntro.reviewState})`);
assert.equal(compIntro.reviewState, "competing_referrer", `the second partner's introduction of the same website is held as a competing referrer (${compIntro.reviewState})`);
const referralsBefore = await count(`SELECT 1 FROM referrals`);
const contactsBefore = await count(`SELECT 1 FROM contacts`);
const attributionBefore = (await one(`SELECT COALESCE(total_referrals,0)::int a FROM partners WHERE id=$1`, [first.id])).a;
const secondAttributionBefore = (await one(`SELECT COALESCE(total_referrals,0)::int a FROM partners WHERE id=$1`, [second.id])).a;

const decisionRequests = (browser: Browser) => browser.requests.filter(r => r.method === "POST" && /\/api\/partner-(applications|introductions)\//.test(r.url));

try {
  await mkdir(directory, { recursive: true });
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  const admin = await open();
  await signIn(admin, "admin");

  // ── 1. Applications: list, company/owner/time/links ────────────────────────────────────────────────────────────────
  await admin.navigate("/dashboard/referral-program?tab=applications&appStatus=all");
  await until(admin, `!!document.querySelector('[data-testid="partner-applications-panel"]')`, "applications panel");
  await until(admin, `document.body.innerText.includes('Nora Nocompany')`, "no-company applicant listed");
  const table = await text(admin, '[data-testid="applications-table-desktop"]');
  assert.ok(/Company not provided/.test(table), `A row with no submitted company says "Company not provided" (${table.replace(/\s+/g, " ").slice(0, 240)})`);
  assert.ok(!/Nora Nocompany Advisory/.test(table), "The applicant's name is not passed off as a company");
  assert.ok(/Unassigned: assignment policy required/.test(table), "With no recorded policy the owner column says why it is unassigned instead of a blank or a staff id");
  ok("The application table says 'Company not provided' for a missing company and names the policy gap behind an empty owner");

  await admin.click(`[data-testid="button-open-application-${noCompany.application.id}"]`);
  await until(admin, `!!document.querySelector('[data-testid="application-detail"]')`, "detail");
  assert.ok((await where(admin)).includes(`application=${noCompany.application.id}`), "The open application is in the URL");
  assert.ok(/Company not provided/.test(await text(admin, '[data-testid="application-company"]')), "The detail shows 'Company not provided'");
  const requestHref = await attr(admin, '[data-testid="link-open-request"]', "href");
  assert.ok(requestHref && /^\/dashboard\/lead-ops\?tab=pipeline&ref=[0-9A-F]{8}$/.test(requestHref), `The request link goes to the website-request destination with its short reference (${requestHref})`);
  assert.ok(/Eastern|ET\b|business time/i.test(await text(admin, '[data-testid="business-time-note"]')), "Times are labelled with the business zone");
  const submitted = await text(admin, '[aria-label="Submitted answers"]');
  assert.ok(/CPA or accountant/.test(submitted) && !/^cpa$/m.test(submitted) && !/^email$/m.test(submitted), `Submitted answers show the applicant's wording, not stored identifiers (${submitted.replace(/\s+/g, " ").slice(0, 200)})`);
  await new Promise(r => setTimeout(r, 800)); // let the side panel finish sliding in before the picture is taken
  await admin.screenshot("review-application-detail");
  ok("The application detail shows the company state, a canonical request link, the URL-backed selection and business-zone time");

  // ── 2. Needs-information is a status change that sends nothing; decline; audited reopen ────────────────────────────
  await admin.navigate(`/dashboard/referral-program?tab=applications&appStatus=all&application=${flow.application.id}`);
  await until(admin, `!!document.querySelector('[data-testid="application-decision-form"]')`, "decision form");
  assert.ok(/Mark as needing information/.test(await text(admin, '[data-testid="application-decision-form"]')), "The action is labelled 'Mark as needing information'");
  assert.ok(!/Request more information|Send this request/i.test(await text(admin, '[data-testid="application-detail"]')), "No label implies a message is sent");
  const requestsBefore = decisionRequests(admin).length;
  await admin.click(`[data-testid="application-decision-needs_info"]`);
  assert.ok(/Status updated; no message sent\./.test(await text(admin, '[data-testid="needs-info-no-message"]')), "Choosing it states that no message is sent");
  await admin.click(`[data-testid="application-decision-submit"]`);
  await until(admin, `/note is required/i.test(document.querySelector('[data-testid="application-decision-error"]')?.innerText||'')`, "note required");
  await admin.set('[data-testid="application-note-input"]', "Need the applicant's client count; contact them from the contact page.");
  await admin.click(`[data-testid="application-decision-submit"]`);
  await until(admin, `!!document.querySelector('[data-testid="application-decision-confirm"]')`, "confirm");
  assert.ok(/no message sent/i.test(await admin.evaluate(`document.querySelector('[role="group"][aria-label="Confirm decision"]').innerText`) as string), "The confirmation repeats that nothing is sent");
  await admin.click(`[data-testid="application-decision-confirm"]`);
  await until(admin, `document.querySelectorAll('[data-testid="review-history-event"]').length>=1`, "history shows the transition");
  assert.equal((await one(`SELECT review_status s FROM partner_applications WHERE id=$1`, [flow.application.id])).s, "needs_info", "The application is now needing information");
  assert.equal(decisionRequests(admin).length, requestsBefore + 1, "Exactly one decision call was made and nothing else was posted");
  assert.ok(/Marked as needing information/.test(await text(admin, '[data-testid="review-history"]')) && /No message was sent\./.test(await text(admin, '[data-testid="review-history"]')), "The history records the transition and that no message was sent");
  assert.equal(await count(`SELECT 1 FROM outbound_messages WHERE lower(to_email)=$1`, [flow.email]), 0, "No outbound message exists for the applicant");
  ok("Marking an application as needing information needs a note, repeats that no message is sent, makes one call and is recorded in the history");

  await admin.click(`[data-testid="application-decision-decline"]`);
  await admin.set('[data-testid="application-note-input"]', "Closing: not a fit now.");
  await admin.click(`[data-testid="application-decision-submit"]`);
  await admin.click(`[data-testid="application-decision-confirm"]`);
  await until(admin, `!!document.querySelector('[data-testid="application-decision-closed"]')`, "declined");
  await until(admin, `!!document.querySelector('[data-testid="application-reopen-form"]')`, "reopen form offered for a declined application");
  await admin.click(`[data-testid="application-reopen-submit"]`);
  await until(admin, `/required/i.test(document.querySelector('[data-testid="application-reopen-error"]')?.innerText||'')`, "reopen reason required");
  await admin.set('[data-testid="application-reopen-note"]', "Applicant replied with their client count; reviewing again.");
  await admin.click(`[data-testid="application-reopen-submit"]`);
  await until(admin, `!!document.querySelector('[data-testid="application-reopen-confirm"]')`, "reopen confirm");
  await admin.click(`[data-testid="application-reopen-confirm"]`);
  await until(admin, `!!document.querySelector('[data-testid="application-decision-form"]')`, "open for decision again");
  const reopened = await one(`SELECT review_status s, revision r FROM partner_applications WHERE id=$1`, [flow.application.id]);
  assert.equal(reopened.s, "pending_review", "The same application is back in review");
  assert.equal(await count(`SELECT 1 FROM partner_applications WHERE mailbox=$1`, [flow.email]), 1, "Reopening reused the application: still one row for the mailbox");
  const historyText = await text(admin, '[data-testid="review-history"]');
  for (const expectation of [/Marked as needing information/, /Declined/, /Returned to review/, /Applicant replied with their client count/]) assert.ok(expectation.test(historyText), `The history lists ${expectation}`);
  assert.equal(await count(`SELECT 1 FROM partner_review_events WHERE subject_type='application' AND subject_id=$1`, [flow.application.id]), 3, "Three append-only events are stored for the application");
  await new Promise(r => setTimeout(r, 800));
  await admin.screenshot("review-application-reopened");
  ok("A declined application is returned to review through the audited form with a required reason; the same row is reused and the history lists all three transitions");

  await admin.navigate(`/dashboard/referral-program?tab=applications&appStatus=all&application=${flow.application.id}`);
  await until(admin, `!!document.querySelector('[data-testid="application-detail"]')`, "deep link restores detail");
  assert.ok(/Flora Flow/.test(await text(admin, '[data-testid="application-detail"]')), "Reloading the deep link restores the same application");
  ok("A reload of the application deep link restores the same application");

  // ── 3. Introductions: two held records, evidence, allowed commands, decisions with no side effects ────────────────────
  const holds = [
    { label: "same business as an existing contact", intro: dupIntro, partner: second, state: "duplicate_review", command: "resolve_duplicate", note: "Same business as the contact already on file; closing as a duplicate.",
      offered: ["accept", "decline", "resolve_duplicate"], history: /Resolved as a duplicate of an existing record/ },
    { label: "competing referrer", intro: compIntro, partner: second, state: "competing_referrer", command: "keep_existing_referrer", note: "Pia First introduced this business first; keeping that attribution.",
      offered: ["decline", "keep_existing_referrer"], history: /Kept the existing referrer/ },
  ] as const;
  for (const hold of holds) {
    const id = hold.intro.id;
    await admin.navigate(`/dashboard/referral-program?tab=introductions&introState=${hold.state}`);
    await until(admin, `!!document.querySelector('[data-testid="partner-introductions-review"]')`, "introductions panel");
    await until(admin, `!!document.querySelector('[data-testid="button-open-introduction-${id}"]')`, `${hold.label}: listed under its filter`);
    assert.ok(!(await exists(admin, `[data-testid="button-open-introduction-${plainIntro.id}"]`)), `${hold.label}: the state filter (kept in the URL) excludes introductions in other states`);
    await admin.click(`[data-testid="button-open-introduction-${id}"]`);
    await until(admin, `!!document.querySelector('[data-testid="introduction-detail"]')`, `${hold.label}: detail`);
    const url = await where(admin);
    assert.ok(url.includes(`introduction=${id}`) && url.includes(`introState=${hold.state}`), `${hold.label}: the open introduction and the filter are both in the URL (${url})`);
    const evidence = await text(admin, '[data-testid="introduction-evidence"]');
    const linked = await text(admin, '[data-testid="introduction-linked"]');
    assert.ok(/Staff only/.test(evidence), `${hold.label}: the evidence is marked staff only`);
    if (hold.state === "competing_referrer") assert.ok(/Another introduction from Pia First/.test(evidence), `${hold.label}: the evidence names the competing partner's earlier introduction (${evidence.replace(/\s+/g, " ").slice(0, 300)})`);
    else assert.ok(new RegExp(`Open contact #${registryContact.id}\\b`).test(evidence), `${hold.label}: the evidence lists the contact already at this business (${evidence.replace(/\s+/g, " ").slice(0, 300)})`);
    const offered = (await admin.evaluate(`Array.from(document.querySelectorAll('input[type="radio"][name="introduction-decision"]')).map(e=>e.value)`) as string[]).sort();
    assert.deepEqual(offered, [...hold.offered].sort(), `${hold.label}: only the server-allowed commands are offered (${offered.join(",")})`);
    const RAW_CODE = /\b[A-Z]{3,}(?:_[A-Z]{2,})+\b/;
    const visible = await text(admin, '[data-testid="partner-introductions-review"]') + " " + await text(admin, '[data-testid="introduction-detail"]');
    assert.ok(!RAW_CODE.test(visible), `${hold.label}: no internal reason code is shown to staff (${(visible.match(RAW_CODE) ?? [""])[0]})`);
    assert.ok(!/partner_introduction_permission|@\d/.test(visible), `${hold.label}: the stored permission version label is not shown to staff`);
    assert.ok(/The partner confirmed on .+ that this contact agreed to be introduced\./.test(await text(admin, '[data-testid="introduction-permission-statement"]')), `${hold.label}: staff read a plain statement of who confirmed the permission and when`);
    await new Promise(r => setTimeout(r, 800)); // let the side panel finish sliding in before the picture is taken
    await admin.screenshot(`review-introduction-${hold.state.replace(/_/g, "-")}`);
    const links = await admin.evaluate(`Array.from(document.querySelectorAll('[data-testid="introduction-linked"] a, [data-testid="introduction-evidence"] a')).map(a=>a.getAttribute('href'))`) as string[];
    assert.ok(links.every(href => /^\/dashboard\/(contacts\/\d+|referral-program\?tab=referrals)$/.test(href)), `${hold.label}: every linked-record link points at an existing canonical destination (${links.join(", ")})`);
    if (hold.state === "duplicate_review") assert.ok(links.length >= 1, `${hold.label}: at least one canonical contact link is offered`);
    await admin.click(`[data-testid="introduction-decision-${hold.command}"]`);
    await admin.click(`[data-testid="introduction-decision-submit"]`);
    await until(admin, `/required/i.test(document.querySelector('[data-testid="introduction-decision-error"]')?.innerText||'')`, `${hold.label}: reason required`);
    assert.equal((await one(`SELECT review_state s FROM partner_introductions WHERE id=$1`, [id])).s, hold.state, `${hold.label}: a refused decision changed nothing`);
    await admin.set('[data-testid="introduction-note-input"]', hold.note);
    await admin.click(`[data-testid="introduction-decision-submit"]`);
    await until(admin, `!!document.querySelector('[data-testid="introduction-decision-confirm"]')`, `${hold.label}: confirm`);
    await admin.click(`[data-testid="introduction-decision-confirm"]`);
    await until(admin, `!!document.querySelector('[data-testid="introduction-decision-closed"]')`, `${hold.label}: decided`);
    const closed = await one(`SELECT review_state s, decided_by FROM partner_introductions WHERE id=$1`, [id]);
    assert.equal(closed.s, "declined", `${hold.label}: the held introduction is closed`);
    assert.equal(closed.decided_by, adminId, `${hold.label}: the deciding staff member is the signed-in administrator`);
    assert.equal(await count(`SELECT 1 FROM referrals`), referralsBefore, `${hold.label}: closing it created no referral`);
    assert.equal(await count(`SELECT 1 FROM contacts`), contactsBefore, `${hold.label}: closing it merged or created no contact`);
    assert.equal((await one(`SELECT COALESCE(total_referrals,0)::int a FROM partners WHERE id=$1`, [first.id])).a, attributionBefore, `${hold.label}: the first partner's attribution did not move`);
    assert.equal((await one(`SELECT COALESCE(total_referrals,0)::int a FROM partners WHERE id=$1`, [second.id])).a, secondAttributionBefore, `${hold.label}: the second partner received no credit`);
    const historyText = await text(admin, '[data-testid="review-history"]');
    assert.ok(hold.history.test(historyText) && historyText.includes(hold.note), `${hold.label}: the history shows the decision and the written reason (${historyText.replace(/\s+/g, " ").slice(0, 240)})`);
    assert.equal(await count(`SELECT 1 FROM partner_review_events WHERE subject_type='introduction' AND subject_id=$1`, [id]), 1, `${hold.label}: exactly one append-only event was stored`);
    const view = (await intros.listPartnerIntroductionsFor(hold.partner.id)).find(v => v.reference === id);
    assert.ok(view, `${hold.label}: the introducing partner can still see their own introduction`);
    assert.ok(!JSON.stringify(view).includes("Pia First") && !/duplicate|competing/i.test(JSON.stringify(view)), `${hold.label}: the introducing partner's own view carries no other-partner or identity-case detail`);
  }
  assert.equal((await one(`SELECT review_state s FROM partner_introductions WHERE id=$1`, [gammaFirst.id])).s, "pending_review", "The earlier introduction that holds the attribution is untouched");
  ok("Both held introductions show their identity evidence and only server-allowed commands, need a reason, and closing either creates no referral, moves no attribution and merges no contact");

  // ── 4. Manager: read-only ──────────────────────────────────────────────────────────────────────────────────────────
  const manager = await open();
  await signIn(manager, "manager");
  await manager.navigate(`/dashboard/referral-program?tab=applications&appStatus=all&application=${noCompany.application.id}`);
  await until(manager, `!!document.querySelector('[data-testid="application-detail"]')`, "manager detail");
  assert.ok(/Only an administrator can decide/.test(await text(manager, '[data-testid="application-read-only"]')), "A manager is told only an administrator can decide an application");
  assert.ok(!(await exists(manager, '[data-testid="application-decision-form"]')) && !(await exists(manager, '[data-testid="application-reopen-form"]')), "A manager sees no decision or reopen control");
  await manager.navigate(`/dashboard/referral-program?tab=introductions&introduction=${plainIntro.id}`);
  await until(manager, `!!document.querySelector('[data-testid="introduction-detail"]')`, "manager introduction detail");
  assert.ok(/Only an administrator can decide/.test(await text(manager, '[data-testid="introduction-read-only"]')) && !(await exists(manager, '[data-testid="introduction-decision-form"]')), "A manager sees the introduction with no decision control");
  assert.equal(decisionRequests(manager).length, 0, "The manager's browser made no decision call");
  ok("A manager can read applications and introductions with their evidence but is offered no decision or reopen control");

  // ── 4b. Dark theme: the shared review links stay readable on populated screens ──────────────────────────────────────
  // Contrast is computed from the rendered page (the colour of each link against the layers actually painted behind it), on
  // screens that really contain the links: an application with its request link, and an introduction with its contact links.
  await admin.evaluate("localStorage.setItem('liberty-theme','dark')");
  const DARK_CONTRAST = `(()=>{
    const parse=(c)=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
    const over=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});
    const backdrop=(el)=>{const layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=0.999)break}}
      let acc={r:255,g:255,b:255,a:1};for(let i=layers.length-1;i>=0;i--)acc=over(layers[i],acc);return acc};
    const lum=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
    const ratio=(a,b)=>{const hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05)};
    const rows=Array.from(document.querySelectorAll('[data-testid^="link-open-"], [data-testid="introduction-linked"] a, [data-testid="introduction-evidence"] a')).filter(a=>{const r=a.getBoundingClientRect();return r.width>0&&r.height>0}).map(a=>{
      const fg=parse(getComputedStyle(a).color);const bg=backdrop(a);const text=over(fg,bg);
      return {label:(a.getAttribute('data-testid')||a.textContent||'').trim().slice(0,40),ratio:Math.round(ratio(lum(text),lum(bg))*100)/100}});
    return {dark:document.documentElement.classList.contains('dark'),rows};
  })()`;
  const darkScreens: { label: string; url: string; ready: string }[] = [
    { label: "application with its request link", url: `/dashboard/referral-program?tab=applications&appStatus=all&application=${noCompany.application.id}`, ready: `!!document.querySelector('[data-testid="link-open-request"]')` },
    { label: "introduction with its contact links", url: `/dashboard/referral-program?tab=introductions&introState=all&introduction=${dupIntro.id}`, ready: `!!document.querySelector('[data-testid="introduction-detail"] a[href^="/dashboard/contacts/"]')` },
  ];
  const darkReport: { screen: string; links: { label: string; ratio: number }[] }[] = [];
  for (const screen of darkScreens) {
    await admin.navigate(screen.url);
    await until(admin, screen.ready, `dark: ${screen.label}`);
    await new Promise(r => setTimeout(r, 800));
    const result = await admin.evaluate(DARK_CONTRAST) as { dark: boolean; rows: { label: string; ratio: number }[] };
    assert.ok(result.dark, `The dark theme is applied on the ${screen.label} screen`);
    assert.ok(result.rows.length >= 1, `The ${screen.label} screen shows at least one review link to measure`);
    const weak = result.rows.filter(r => r.ratio < 4.5);
    assert.deepEqual(weak, [], `Dark theme: every review link on the ${screen.label} screen has 4.5:1 text contrast (${result.rows.map(r => `${r.label} ${r.ratio}`).join("; ")})`);
    darkReport.push({ screen: screen.label, links: result.rows });
    await admin.screenshot(`review-dark-${screen.label.split(" ")[0]}`);
  }
  // Negative control: the measurement itself catches the old light-theme blue on the dark surface.
  const oldBlue = await admin.evaluate(`(()=>{const a=document.querySelector('[data-testid^="link-open-"],[data-testid="introduction-detail"] a');a.classList.remove('dark:text-blue-300');a.style.color='rgb(29, 78, 216)';return null})()`).then(() => admin.evaluate(DARK_CONTRAST)) as { rows: { ratio: number }[] };
  assert.ok(oldBlue.rows.some(r => r.ratio < 4.5), "Negative control: the old blue-700 link on the dark surface is reported below 4.5:1");
  await admin.evaluate("localStorage.setItem('liberty-theme','light')");
  ok(`In the dark theme every shared review link on the populated application and introduction screens keeps at least 4.5:1 contrast (${darkReport.map(d => `${d.screen}: ${d.links.map(l => l.ratio).join("/")}`).join("; ")})`);

  // ── 5. Narrow screen ──────────────────────────────────────────────────────────────────────────────────────────────
  await admin.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const url of [`/dashboard/referral-program?tab=applications&appStatus=all`, `/dashboard/referral-program?tab=introductions&introState=all`, `/dashboard/referral-program?tab=applications&appStatus=all&application=${flow.application.id}`, `/dashboard/referral-program?tab=introductions&introduction=${plainIntro.id}`]) {
    await admin.navigate(url);
    await until(admin, `!!document.querySelector('[data-testid="partner-applications-panel"],[data-testid="partner-introductions-review"]')`, `narrow ${url}`);
    await new Promise(r => setTimeout(r, 600));
    const o = await overflow(admin);
    assert.ok(!o.over, `No horizontal scrolling at 390 px on ${url} (${JSON.stringify(o)})`);
  }
  await admin.navigate(`/dashboard/referral-program?tab=introductions&introduction=${plainIntro.id}`);
  await until(admin, `!!document.querySelector('[data-testid="introduction-decision-form"]')`, "narrow decision form");
  // A caption above a text field is not a target: the field it names is. Radio and checkbox labels are the target and are checked.
  const small = await admin.evaluate(`Array.from(document.querySelectorAll('[data-testid="introduction-detail"] button, [data-testid="introduction-detail"] a, [data-testid="introduction-detail"] label, [data-testid="introduction-detail"] textarea, [data-testid="introduction-detail"] select, [data-testid="introduction-detail"] input')).filter(e=>{
    if(e.tagName==='LABEL'){const f=e.htmlFor&&document.getElementById(e.htmlFor);if(f&&(f.tagName==='TEXTAREA'||f.tagName==='SELECT'||(f.tagName==='INPUT'&&!/^(radio|checkbox)$/.test(f.type))))return false;}
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43&&!(e.tagName==='INPUT'&&/^(radio|checkbox)$/.test(e.type))}).map(e=>(e.getAttribute('data-testid')||e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height))`) as string[];
  assert.deepEqual(small, [], `Review controls keep a 44 px target at 390 px (${small.join(", ")})`);
  await admin.screenshot("review-introduction-390");
  ok("At 390 px the review lists and details do not scroll sideways and every review control keeps a 44 px target");

  assert.equal(admin.exceptions.length + manager.exceptions.length, 0, `No uncaught page exception (${[...admin.exceptions, ...manager.exceptions].join(" || ")})`);
  ok("No page raised an uncaught exception");

  await writeFile(`${directory}/receipt.json`, JSON.stringify({
    status: "passed", candidate: { sourceHead: identity.sourceHead, inputHash: identity.inputHash }, checks,
    scope: "Chromium only; real handlers and compiled client; external hosts blocked; not Safari/WebKit, a real phone or a screen reader",
  }, null, 2));
  console.log(`Partner review browser: ${checks.length} checks passed`);
} finally {
  for (const browser of browsers) await browser.close().catch(() => undefined);
  await h.close();
}
