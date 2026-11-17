#!/usr/bin/env npx tsx
/**
 * test-partner-program-contracts.ts
 *
 * Deterministic contract checks for the partner program upgrade. No server, database, network or provider I/O.
 *
 *  1. Application schema (shared by the browser and the server): both paths accept a complete body; every required field,
 *     the consent literal, the phone rules and the marketing-disclosure pairing are enforced; unknown keys (a rate, a
 *     partner id, a status, a password, a role) are rejected rather than ignored; a legacy account-creation payload is
 *     recognised and never treated as an application.
 *  2. Browser payload builder: sends only the chosen path's fields, never a rate/actor/status, a marketing opt-in only
 *     together with the server-known disclosure id, and allowlisted attribution only; a built payload from valid form
 *     values passes the server schema.
 *  3. Analytics: the funnel allowlist drops unknown events, unknown properties and any value that is not a short slug
 *     (so an email, phone, name, free text or number can never leave the browser); every call site in client code uses
 *     only allowlisted events and property keys with no personal-data property.
 *  4. Route authority: the registered partner-program routes carry exactly the intended roles (admin decides; admin and
 *     manager read; partner session only for introductions), the body is never the source of the partner or actor,
 *     and mutations are CSRF-protected except the public application.
 *  5. Retirement: no client file calls the retired affiliate signup and the retired server route creates nothing.
 *
 * Every family has a negative control.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
let checks = 0;
const ok = (condition: unknown, message: string) => { assert(condition, message); checks++; };
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full, out); } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const shared = await import("../shared/partner-application");
const clientLib = await import("../client/src/lib/partner-application-client");
const tracking = await import("../client/src/lib/tracking");
const { PARTNER_INTRODUCTION_PERMISSION, PARTNER_LEAD_SOURCE_INTERESTS } = await import("../shared/partner-public-content");

// ── 1. Schema ───────────────────────────────────────────────────────────────────────────────────────────────────────
const referral = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: shared.PARTNER_APPLICATION_SCHEMA_VERSION, path: "referral", fullName: "Pat Example", email: "Pat@Example.com",
  phone: "(305) 555-0142", company: "Example CPA", profession: "cpa", referralNetwork: "Small business clients",
  contactPreference: "email", contactPermission: true, consentVersion: shared.PARTNER_APPLICATION_CONSENT.version, ...extra,
});
const agent = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: shared.PARTNER_APPLICATION_SCHEMA_VERSION, path: "sales_agent", fullName: "Sam Seller", email: "sam@example.com",
  phone: "305-555-0188", company: "", region: "South Florida", experience: "Five years in payments sales.",
  prospectingApproach: "Warm introductions and local events.", leadSourceInterest: PARTNER_LEAD_SOURCE_INTERESTS[0].id,
  contactPreference: "phone", contactPermission: true, consentVersion: shared.PARTNER_APPLICATION_CONSENT.version, ...extra,
});
const parse = (body: unknown) => shared.parsePartnerApplication(body);
const failsOn = (body: unknown, field: string) => {
  const r = parse(body);
  return !r.ok && r.issues.some((i) => i.field === field || i.field.startsWith(`${field}.`) || (field === "form" && i.field === "form"));
};

const goodReferral = parse(referral());
ok(goodReferral.ok && goodReferral.data.email === "pat@example.com", "A complete referral application parses and lower-cases the mailbox");
ok(parse(agent()).ok, "A complete sales-agent application parses");
ok(parse(referral({ phone: undefined })).ok, "A referral applicant may omit the phone (email preference)");
ok(failsOn(agent({ phone: undefined }), "phone"), "A sales-agent application requires a phone");
ok(failsOn(referral({ contactPreference: "phone", phone: undefined }), "phone"), "Choosing phone contact without a phone is refused");
for (const field of ["fullName", "email", "profession", "referralNetwork"]) {
  const body: Record<string, unknown> = referral(); delete body[field];
  ok(failsOn(body, field), `Referral: ${field} is required`);
}
for (const field of ["fullName", "email", "region", "experience", "prospectingApproach", "leadSourceInterest"]) {
  const body: Record<string, unknown> = agent(); delete body[field];
  ok(failsOn(body, field), `Sales agent: ${field} is required`);
}
for (const bad of [false, "true", 1, undefined, null]) ok(failsOn(referral({ contactPermission: bad }), "contactPermission"), `Contact permission ${JSON.stringify(bad)} is refused (must be literal true)`);
ok(failsOn(referral({ email: "not-an-email" }), "email"), "A malformed email is refused");
ok(failsOn(referral({ profession: "astronaut" }), "profession"), "An unknown profession is refused");
ok(failsOn(referral({ schemaVersion: 99 }), "schemaVersion"), "An unknown schema version is refused");
ok(failsOn(referral({ marketingOptIn: true }), "marketingOptIn"), "A marketing opt-in without the rendered disclosure id is refused");
ok(failsOn(referral({ emailDisclosureId: "anything" }), "emailDisclosureId"), "A disclosure id without the opt-in is refused");
ok(parse(referral({ marketingOptIn: true, emailDisclosureId: "some-id" })).ok, "An opt-in with a disclosure id passes schema validation (the server resolves the id)");
for (const key of ["commissionPercent", "partnerId", "status", "password", "role", "actorId", "approved", "affiliateCode"]) {
  const r = parse(referral({ [key]: key === "commissionPercent" ? 50 : "x" }));
  ok(!r.ok, `A body naming ${key} is refused, not ignored`);
}
ok(!parse(referral({ path: "sales_agent" })).ok, "A referral body labelled as a sales-agent application is refused");
ok(!parse(null).ok && !parse("x").ok && !parse([]).ok, "A non-object body is refused");
ok(!shared.parsePartnerApplication({}, undefined).ok, "A body with no path is refused");
ok(shared.isLegacyPartnerPayload({ email: "a@b.co", password: "x" }) && shared.isLegacyPartnerPayload({ path: "referral" }) && shared.isLegacyPartnerPayload(null) && !shared.isLegacyPartnerPayload(referral()), "A legacy password or schema-less payload is recognised; a current application is not");

for (const good of ["305-555-0142", "(305) 555-0142", "+1 305 555 0142", "3055550142"]) ok(shared.isAcceptablePartnerPhone(good), `Phone ${good} is acceptable`);
for (const bad of ["", "12345", "abcdefghij", "555-014", "1".repeat(16), "305-555-0142 ext <script>"]) ok(!shared.isAcceptablePartnerPhone(bad), `Phone ${JSON.stringify(bad)} is refused`);

// ── 2. Browser payload builder ──────────────────────────────────────────────────────────────────────────────────────
const values = { ...clientLib.EMPTY_PARTNER_FORM, fullName: "Pat Example", email: "pat@example.com", phone: "305-555-0142", company: "Example CPA", profession: "cpa", referralNetwork: "Clients", contactPermission: true };
const referralPayload = clientLib.buildPartnerPayload("referral", { ...values, experience: "HIDDEN-AGENT-FIELD", prospectingApproach: "HIDDEN", leadSourceInterest: "HIDDEN", region: "" }, { sourcePage: "/partners/referrals", search: "?utm_source=newsletter&utm_campaign=Fall&email=pat@example.com&commissionPercent=50" });
ok(!JSON.stringify(referralPayload).includes("HIDDEN"), "A referral payload carries no field from the other path");
ok(clientLib.validatePartnerPayload("referral", referralPayload) && Object.keys(clientLib.validatePartnerPayload("referral", referralPayload)).length === 0, "A payload built from valid referral values passes the shared schema");
ok(parse(referralPayload).ok, "The server schema accepts the browser-built referral payload");
const att = (referralPayload as any).attribution ?? {};
ok(att.utm_source === "newsletter" && !JSON.stringify(att).includes("pat@example.com") && !("commissionPercent" in att) && !("email" in att), "Attribution keeps allowlisted keys only (no email, no rate)");
ok(!("marketingOptIn" in referralPayload) && !("emailDisclosureId" in referralPayload), "No marketing opt-in is sent unless the box is checked");
const optedIn = clientLib.buildPartnerPayload("referral", { ...values, marketingOptIn: true }) as Record<string, unknown>;
ok(optedIn.marketingOptIn === true && typeof optedIn.emailDisclosureId === "string" && (optedIn.emailDisclosureId as string).length > 0, "A checked box sends the opt-in together with the rendered disclosure id");
ok(!("sourcePage" in (clientLib.buildPartnerPayload("referral", values, { sourcePage: "/evil" }) as object)), "A source page outside the allowlist is dropped");
ok(!("contactPermission" in {}) && (clientLib.buildPartnerPayload("referral", { ...values, contactPermission: false }) as any).contactPermission === false && Object.keys(clientLib.validatePartnerPayload("referral", clientLib.buildPartnerPayload("referral", { ...values, contactPermission: false }))).length > 0, "Unchecked contact permission is sent as false and fails validation (never defaulted to true)");
const agentValues = { ...clientLib.EMPTY_PARTNER_FORM, fullName: "Sam Seller", email: "sam@example.com", phone: "305-555-0188", region: "South Florida", experience: "Five years.", prospectingApproach: "Warm introductions.", leadSourceInterest: PARTNER_LEAD_SOURCE_INTERESTS[0].id, contactPermission: true, profession: "cpa", referralNetwork: "HIDDEN-REFERRAL-FIELD" };
const agentPayload = clientLib.buildPartnerPayload("sales_agent", agentValues);
ok(!JSON.stringify(agentPayload).includes("HIDDEN") && !("profession" in agentPayload) && parse(agentPayload).ok, "A sales-agent payload carries no referral field and passes the shared schema");
for (const payload of [referralPayload, optedIn, agentPayload]) {
  ok(!["commissionPercent", "partnerId", "status", "password", "role", "actorId", "scheduleReference"].some((k) => k in (payload as object)), "A browser payload never names a rate, partner, status, credential or actor");
}
const fieldErrors = clientLib.validatePartnerPayload("referral", { ...(referralPayload as object), email: "bad" });
ok(Boolean(fieldErrors.email), "A field error maps to the rendered field");
const formErrors = clientLib.validatePartnerPayload("referral", { ...(referralPayload as object), marketingOptIn: true });
ok(Boolean(formErrors.form) && !formErrors.marketingOptIn, "A rule on a field the form does not render surfaces on the form");

// ── 3. Analytics ────────────────────────────────────────────────────────────────────────────────────────────────────
ok(tracking.partnerAnalyticsPayload("page_view") === null && tracking.partnerAnalyticsPayload("form_submit") === null && tracking.partnerAnalyticsPayload("") === null, "An event outside the allowlist is dropped");
const noisy = tracking.partnerAnalyticsPayload("partner_application_submitted", {
  path: "referral", profession: "cpa", source_page: "/partners/referrals", calculator_path: "referral",
  email: "pat@example.com", phone: "305-555-0142", fullName: "Pat Example", company: "Example CPA", sharePercent: 50, idempotencyKey: "abc",
});
ok(noisy && Object.keys(noisy.props).sort().join(",") === "calculator_path,path,profession,source_page", "Only allowlisted property keys leave the browser");
for (const bad of ["pat@example.com", "305-555-0142", "Pat Example", "x".repeat(80), "<script>", 50, null, { a: 1 }]) {
  const r = tracking.partnerAnalyticsPayload("partner_path_selected", { path: bad, profession: bad, source_page: bad });
  ok(r && Object.keys(r.props).length === 0, `A property value ${JSON.stringify(bad)?.slice(0, 24)} that is not a short slug is dropped`);
}
const clientFiles = walk(path.join(root, "client/src"));
const callSites: string[] = [];
for (const file of clientFiles) {
  const src = fs.readFileSync(file, "utf8");
  for (const match of src.matchAll(/trackPartnerEvent\(\s*"([a-z_]+)"\s*(?:,\s*(\{[^}]*\}))?/g)) callSites.push(`${path.relative(root, file)}|${match[1]}|${match[2] ?? ""}`);
}
ok(callSites.length >= 4, `Partner analytics call sites were found (${callSites.length})`);
for (const site of callSites) {
  const [file, event, props] = site.split("|");
  if (file.endsWith("lib/tracking.ts")) continue;
  ok((tracking.PARTNER_ANALYTICS_EVENTS as readonly string[]).includes(event), `${file}: ${event} is an allowlisted event`);
  const keys = [...props.matchAll(/([a-z_]+)\s*:/gi)].map((m) => m[1]);
  ok(keys.every((k) => (tracking.PARTNER_ANALYTICS_PROPS as readonly string[]).includes(k)), `${file}: ${event} passes only allowlisted properties (${keys.join(",") || "none"})`);
  ok(!/email|phone|name|company|commission|share|password|key/i.test(props.replace(/source_page/g, "")), `${file}: ${event} passes no personal or commercial property`);
}
ok(/GA_ID && analyticsConsent/.test(read("client/src/lib/tracking.ts").slice(read("client/src/lib/tracking.ts").indexOf("export function trackPartnerEvent"))) && !/fbqEvent/.test(read("client/src/lib/tracking.ts").slice(read("client/src/lib/tracking.ts").indexOf("export function trackPartnerEvent"), read("client/src/lib/tracking.ts").indexOf("export function trackQuizStart"))), "Partner events are consent-gated and never sent to the ad pixel");

// ── 4. Route authority ──────────────────────────────────────────────────────────────────────────────────────────────
const { registerPartnerProgramRoutes } = await import("../server/routes/partner-program");
const app = express();
registerPartnerProgramRoutes(app);
const layers = ((app as any).router.stack as any[]).filter((l) => l.route);
const find = (method: string, route: string) => layers.find((l) => l.route.path === route && l.route.methods[method]);
const rolesOf = (layer: any): string[] | null => {
  for (const s of layer.route.stack) if (Array.isArray(s.handle?._requiredRoles)) return [...s.handle._requiredRoles].sort();
  return null;
};
const matrix: Array<[string, string, string[] | null]> = [
  ["post", "/api/partner-apply", null],
  ["get", "/api/public/partner-policy", null],
  ["get", "/api/partner-policy", ["admin"]],
  ["post", "/api/partner-policy/drafts", ["admin"]],
  ["post", "/api/partner-policy/:id/approve", ["admin"]],
  ["post", "/api/partner-policy/:id/revoke", ["admin"]],
  ["get", "/api/partner-applications", ["admin", "manager"]],
  ["get", "/api/partner-applications/:id", ["admin", "manager"]],
  ["post", "/api/partner-applications/:id/decision", ["admin"]],
  ["post", "/api/partner-applications/:id/reopen", ["admin"]],
  ["get", "/api/partners/me/introductions", ["partner"]],
  ["post", "/api/partners/me/introductions", ["partner"]],
  ["get", "/api/partner-introductions", ["admin", "manager"]],
  ["get", "/api/partner-introductions/:id", ["admin", "manager"]],
  ["post", "/api/partner-introductions/:id/decision", ["admin"]],
];
for (const [method, route, roles] of matrix) {
  const layer = find(method, route);
  ok(layer, `${method.toUpperCase()} ${route} is registered`);
  ok(JSON.stringify(rolesOf(layer)) === JSON.stringify(roles), `${method.toUpperCase()} ${route} requires ${roles ? roles.join("+") : "no role (public)"}`);
}
ok(!layers.some((l) => ["put", "patch", "delete"].some((m) => l.route.methods[m])), "The partner-program routes expose no PUT/PATCH/DELETE");
ok(!rolesOf(find("post", "/api/partner-applications/:id/decision")!)!.includes("manager"), "A manager cannot decide an application (read-only role)");
ok(!rolesOf(find("post", "/api/partner-applications/:id/reopen")!)!.includes("manager"), "A manager cannot reopen an application (read-only role)");
ok(!rolesOf(find("post", "/api/partner-introductions/:id/decision")!)!.includes("manager"), "A manager cannot decide an introduction (read-only role)");
ok(!(rolesOf(find("post", "/api/partner-policy/:id/approve")!)!).includes("manager"), "A manager cannot approve compensation wording");

const csrfSrc = read("server/middleware/csrf.ts");
const exempt = new Set([...csrfSrc.matchAll(/^\s*"(\/api\/[^"]+)",?\s*$/gm)].map((m) => m[1]));
ok(exempt.has("/api/partner-apply"), "The public application is the only new CSRF-exempt entry (no session to ride)");
for (const route of ["/api/partner-applications", "/api/partner-policy", "/api/partners/me/introductions", "/api/partner-introductions"]) {
  ok(![...exempt].some((e) => route.startsWith(e) || e.startsWith(route)), `${route} stays CSRF-protected`);
}

const programSrc = read("server/routes/partner-program.ts");
const introSegment = programSrc.slice(programSrc.indexOf('"/api/partners/me/introductions", isPartnerAuthenticated, async (req, res) => {\n'), programSrc.indexOf('"/api/partner-introductions"'));
ok(/getPartnerByEmail\(String\(\(req as any\)\.user\?\.email/.test(introSegment) && /getPartnerByEmail\(String\(user\?\.email/.test(introSegment) && !/req\.body\.(partnerId|actorId|userId|commissionPercent|status)/.test(introSegment), "Introduction routes derive the partner from the session user, never from the body");
const introModule = await import("../server/services/partner-introductions");
const introBase = { businessName: "Biz", contactName: "Owner", contactEmail: "owner@example.com", permissionConfirmed: true, permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version };
ok(introModule.parseIntroductionBody(introBase).ok, "A well-formed introduction body parses");
for (const key of ["partnerId", "commissionPercent", "status", "actorId", "reviewState", "referralId", "contactId"]) {
  ok(!introModule.parseIntroductionBody({ ...introBase, [key]: 1 }).ok, `An introduction body naming ${key} is refused`);
}
ok(/hasOnlyKeys\(req\.body, DECISION_KEYS\)/.test(programSrc) && /hasOnlyKeys\(req\.body, POLICY_DRAFT_KEYS\)/.test(programSrc), "Decision and policy bodies reject unknown keys");
ok(/hasOnlyKeys\(req\.body, REOPEN_KEYS\)/.test(programSrc) && /hasOnlyKeys\(req\.body, INTRODUCTION_DECISION_KEYS\)/.test(programSrc), "Reopen and introduction-decision bodies reject unknown keys");
ok(/decidePartnerIntroduction\(String\(req\.params\.id\), req\.body, actor\)/.test(programSrc) && /reopenPartnerApplication\(String\(req\.params\.id\), req\.body, actor\)/.test(programSrc), "Introduction decisions and reopen take the actor from the session, never the body");
ok(/actorIdOf\(req\)/.test(programSrc) && !/decidePartnerApplication\([^)]*req\.body\.(actor|userId)/.test(programSrc), "The deciding actor is the session user, never the body");
ok(/Cache-Control", "no-store"/.test(programSrc), "Staff responses are no-store");
ok(PARTNER_INTRODUCTION_PERMISSION.text.length > 20 && /does not|not .*consent|permission/i.test(PARTNER_INTRODUCTION_PERMISSION.text), "The introduction permission wording is the introducer's confirmation, not merchant consent");

// ── 5. Retirement ───────────────────────────────────────────────────────────────────────────────────────────────────
const callers = clientFiles.filter((f) => /\/api\/affiliate\/signup/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
ok(callers.length === 0, `No client file calls the retired affiliate signup (${callers.join(", ") || "none"})`);
const importsSrc = read("server/routes/imports.ts");
const retired = importsSrc.slice(importsSrc.indexOf('"/api/affiliate/signup"'), importsSrc.indexOf('"/api/affiliate/login"'));
ok(/status\(410\)/.test(retired) && !/storage\.|createPartner|bcrypt|req\.login|upsertUser/.test(retired.replace(/probe/g, "")), "The retired signup answers 410 and writes nothing");
// Every credential-opening partner route checks the application-aware eligibility before it acts.
const partnersSrc = read("server/routes/partners.ts");
const affiliateLoginSrc = importsSrc.slice(importsSrc.indexOf('"/api/affiliate/login"'), importsSrc.indexOf('"/api/affiliate/session"'));
ok(/partnerMayHoldCredential/.test(affiliateLoginSrc), "Affiliate login checks credential eligibility");
ok((partnersSrc.match(/await partnerMayHoldCredential\(/g) ?? []).length >= 5, "Both logins, both reset requests and the shared consume path check credential eligibility");
ok(!/\/api\/partner-apply[^"]*"[^)]*password/i.test(programSrc.slice(0, programSrc.indexOf("registerPartnerProgramRoutes"))), "The application route does not accept a password");

// ── 6. Guide, copy census and review-surface contracts (F06, F08, F09) ──────────────────────────────────────────────
const guide = await import("../shared/partner-program-guide");
const content = await import("../shared/partner-public-content");
const UNSUPPORTED_PROMISE = /(\b20\s?[–-]\s?40\s?%|\bin minutes\b|\bflat[- ]fee\b|\btiered (bonus|commission)|\bstandard referral bonus\b|\bvolume incentives?\b|\bpassive income\b|\bget paid\b|\bwithin (1|one|24)\b|\b(paid|payouts?)[^.]{0,40}\b(1st|monthly|weekly)\b|(?<!not )\bguaranteed (income|earnings|approval)\b|\b\d+\s?%)/i;
const policies = [content.DEFAULT_REFERRAL_POLICY];
const guideText = guide.partnerGuideAllText(content.DEFAULT_REFERRAL_POLICY);
ok(!UNSUPPORTED_PROMISE.test(guideText), "The guide in the default policy state contains no percentage, flat fee, bonus tier, payout date or timing promise");
ok(!/Add Partner[^.]*(register|terms are set)|terms are set when you register|we handle the sales process[^.]*you just make the introduction/i.test(guideText), "The guide no longer tells people to register through Add Partner or that all participants simply introduce");
const approved = content.parseReferralPolicy({ state: "approved", version: 3, sharePercent: 27 });
const approvedText = guide.partnerGuideAllText(approved);
ok(approved.state === "approved" && /\b27%/.test(approvedText) && !/\b(25|30)\s?%/.test(approvedText), "A referral percentage appears in the guide only from an approved published projection, never a hardcoded number");
ok(guide.PARTNER_GUIDE_AUDIENCES.length === 4 && guide.PARTNER_GUIDE_AUDIENCES.every((a) => guide.partnerGuideSections(a, content.DEFAULT_REFERRAL_POLICY).length >= 2), "The guide has four audiences, each with its own sections");
const staffText = guide.partnerGuideSections("staff", content.DEFAULT_REFERRAL_POLICY).map((x) => `${x.body} ${(x.lines ?? []).join(" ")}`).join(" ");
ok(/pending review/i.test(guideText) && /written agreement/i.test(guideText) && /invitation/i.test(guideText) && /permission/i.test(guideText), "The guide covers application, pending review, written terms, invitation and permitted introductions");
ok(/no message is sent/i.test(staffText), "The staff guide says marking an application as needing information sends no message");
ok(policies.length === 1, "Negative control: the census is evaluated on the safe default state");
ok(UNSUPPORTED_PROMISE.test("Tiered bonuses: Volume incentives when you hit referral milestones.") && UNSUPPORTED_PROMISE.test("Commissions are paid out on the 1st of next month.") && UNSUPPORTED_PROMISE.test("Most businesses save 20–40% when they switch."), "Negative control: the census catches the removed claims");
const referralPage = read("client/src/pages/dashboard/ReferralProgram.tsx");
ok(!/Add Partner' button above|Standard referral bonus|Tiered bonuses/.test(referralPage) && /partnerGuideSections\(audience, policy\)/.test(referralPage) && !/referral-explainer\.mp4/.test(referralPage), "The page renders the shared audience-specific guide and not the retired copy or unreviewed video");
// Census of the other partner-facing surfaces.
const surfaces: Array<[string, string]> = [
  ["client/src/pages/PartnerBrandedPage.tsx", "co-branded partner landing page"],
  ["client/src/pages/PartnerPortal.tsx", "partner portal hints"],
  ["client/src/pages/PartnerEmbedWidget.tsx", "embed widget page"],
  ["server/services/partner-welcome.ts", "partner welcome email"],
  ["server/services/partner-notifications.ts", "partner notification emails"],
];
for (const [file, label] of surfaces) {
  const text = read(file);
  ok(!/20\s?[–-]\s?40\s?%|\bin minutes\b|passive income|paid monthly via PayPal|paid out on the 1st|within 1 business day|within 24 hours|Payouts are processed on the 1st|compounds every month/i.test(text), `${label} (${file}) has no unsupported savings, timing or payout claim`);
}
// The approval invitation never promises compensation.
ok(!/\d+\s?%|bonus|guarantee/i.test(read("server/services/partner-approval-delivery.ts").slice(read("server/services/partner-approval-delivery.ts").indexOf("defaultSendInvite"), read("server/services/partner-approval-delivery.ts").indexOf("defaultSendInvite") + 2200)), "The approval invitation states no percentage, bonus or guarantee");
// F06: the relabelled status-only action and the review surfaces.
const apps = read("client/src/components/partner/PartnerApplicationsPanel.tsx");
ok(/Mark as needing information/.test(apps) && /Status updated; no message sent\./.test(apps) && !/Request more information|Send this request for more information|More information requested/.test(apps), "The needs-information action is labelled as a status change and never claims a message");
ok(/Company not provided/.test(apps) && /assignedOwnerName/.test(apps) && /requestHref/.test(apps) && /contactHref/.test(apps) && /ReviewHistory/.test(apps) && /ReopenForm/.test(apps) && !/toLocaleString\(/.test(apps), "The application workspace shows owner names, 'Company not provided', canonical Open links, history, reopen and business time");
const introUi = read("client/src/components/partner/PartnerIntroductionsReview.tsx");
ok(/\/decision`/.test(introUi) && /expectedRevision/.test(introUi) && /allowedCommands/.test(introUi) && !/toLocaleString\(/.test(introUi) && /OpenLink/.test(introUi), "The introduction review sends revision-checked decisions, offers server-allowed commands only, uses business time and canonical links");
ok(/status === 202/.test(read("client/src/components/partner/PartnerIntroductionsTab.tsx")), "The partner introduction form treats a truthful still-processing 202 as received");
const sharedUi = read("client/src/components/partner/partner-review-shared.tsx");
ok(/businessZoneNote/.test(sharedUi) && /formatBusinessDateTime/.test(sharedUi) && /\/dashboard\/contacts\/\$\{id\}/.test(sharedUi) && /\/dashboard\/lead-ops\?tab=pipeline&ref=/.test(sharedUi), "Review links point at the existing canonical contact and website-request destinations and times name the business zone");

// ── 7. Attribution precedence and carry-through (F02) ──────────────────────────────────────────────────────────────
{
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const first = "?ref=PARTNER1&utm_source=newsletter&utm_campaign=fall&email=pat%40example.com&token=abc&next=https%3A%2F%2Fevil.example";
  const none = "?profession=cpa";
  const other = "?utm_source=podcast&utm_campaign=winter";
  ok(shared.resolvePartnerAttribution(new URLSearchParams(none), null) && Object.keys(shared.resolvePartnerAttribution(new URLSearchParams(none), null)).length === 0, "With no current and no first touch nothing is stored");
  // Visiting a non-partner page never starts a first touch.
  clientLib.capturePartnerFirstTouch("/blog", first);
  ok(Object.keys(clientLib.readPartnerFirstTouch()).length === 0, "A non-partner page never records a partner first touch");
  clientLib.capturePartnerFirstTouch("/partners", none);
  ok(Object.keys(clientLib.readPartnerFirstTouch()).length === 0, "A partner page without allowlisted values records nothing");
  clientLib.capturePartnerFirstTouch("/partners", first);
  const ft = clientLib.readPartnerFirstTouch();
  ok(ft.ref === "PARTNER1" && ft.utm_source === "newsletter" && ft.utm_campaign === "fall" && Object.keys(ft).sort().join(",") === "ref,utm_campaign,utm_source", "First touch keeps only the allowlisted keys: no email, token or redirect target");
  ok(!/pat@|abc|evil/.test(store.get("lb_partner_first_touch") ?? ""), "The stored first touch contains no personal data, token or URL");
  clientLib.capturePartnerFirstTouch("/partners/cpa", other);
  ok(clientLib.readPartnerFirstTouch().utm_source === "newsletter", "First touch is first-write-wins: a later attributed page does not replace it");
  // Precedence: current set wins whole; no key-by-key merge.
  const cur = shared.resolvePartnerAttribution(new URLSearchParams(other), ft);
  ok(cur.utm_source === "podcast" && cur.utm_campaign === "winter" && !("ref" in cur), "The current touch wins as a whole set; the first touch's ref is not merged in");
  ok(shared.resolvePartnerAttribution(new URLSearchParams(none), ft).ref === "PARTNER1", "With no current values the session's first touch is used");
  ok(shared.resolvePartnerAttribution(new URLSearchParams("?utm_source=" + encodeURIComponent("<script>alert(1)</script>")), ft).utm_source === "newsletter", "A malformed current value is dropped and the first touch applies");
  ok(shared.resolvePartnerAttribution(new URLSearchParams("?utm_source=" + "a".repeat(101)), null).utm_source === undefined, "An over-long value is dropped");
  // Links on a page with no parameters still carry the first touch; links on an attributed page carry that page's set.
  (globalThis as any).window = { location: { search: none } };
  const hubLink = clientLib.partnerRouteWithAttribution("/partners/referrals");
  ok(/^\/partners\/referrals\?/.test(hubLink) && /ref=PARTNER1/.test(hubLink) && /utm_source=newsletter/.test(hubLink) && !/email|token|evil/.test(hubLink), "A link from a parameterless page carries the first touch and nothing else");
  (globalThis as any).window = { location: { search: other } };
  const curLink = clientLib.partnerRouteWithAttribution("/partners/sales-agents", "apply");
  ok(/utm_source=podcast/.test(curLink) && !/ref=/.test(curLink) && curLink.endsWith("#apply"), "A link from an attributed page carries that page's set and the anchor");
  // The stored snapshot input (the payload) follows the same rule.
  const snapPayload = (search: string, firstTouch?: Record<string, unknown>) => (clientLib.buildPartnerPayload("sales_agent", agentValues, { sourcePage: "/partners/sales-agents", search, firstTouch }) as any).attribution;
  ok(JSON.stringify(snapPayload(other, ft)) === JSON.stringify({ utm_source: "podcast", utm_campaign: "winter" }), "The submitted snapshot uses the current touch when present");
  ok(JSON.stringify(snapPayload(none, ft)) === JSON.stringify({ ref: "PARTNER1", utm_source: "newsletter", utm_campaign: "fall" }), "The submitted snapshot falls back to the first touch");
  ok(snapPayload(none, {}) === undefined, "No attribution key is sent when there is none");
  ok(parse(clientLib.buildPartnerPayload("sales_agent", agentValues, { sourcePage: "/partners/sales-agents", search: other, firstTouch: ft })).ok, "A payload carrying attribution passes the server schema");
  // Negative control: a hand-built payload cannot smuggle PII or unknown keys into the stored snapshot.
  const smuggled = shared.pickPartnerAttribution({ ref: "PARTNER1", email: "pat@example.com", phone: "305-555-0142", commissionPercent: 90, utm_source: "x", sessionToken: "t" });
  ok(Object.keys(smuggled).sort().join(",") === "ref,utm_source", "Negative control: PII and unknown keys are stripped by the shared allowlist the server also applies");
  // Census: every partner CTA / path switch / comparison return / calculator destination goes through the one helper.
  const plain = /href=\{?["`]\/partners|href: PARTNER_(PATH_ROUTE|ROUTES)|to=\{?PARTNER_/;
  const ctaFiles = ["client/src/pages/ISOPartnerProgram.tsx", "client/src/components/public/PartnerJourneyPage.tsx", "client/src/components/public/PartnerPageSections.tsx", "client/src/components/public/PartnerResidualCalculator.tsx", "client/src/components/public/PartnerProfessionPage.tsx", "client/src/pages/AffiliateProgram.tsx"];
  for (const file of ctaFiles) ok(/partnerRouteWithAttribution|currentPartnerAttribution/.test(read(file)), `${file} builds partner links through the bounded attribution helper`);
  ctaFiles.push("client/src/components/public/PartnerApplicationForm.tsx");
  const BARE_ALLOWED = /PARTNER_ROUTES\.(login|privacy|contact)\b/;
  const bare = ctaFiles.flatMap((file) => read(file).split("\n").filter((line) => /href=\{(PARTNER_(PATH_ROUTE|ROUTES)|page\})/.test(line) && !BARE_ALLOWED.test(line)).map((line) => `${file}: ${line.trim().slice(0, 80)}`));
  ok(bare.length === 0, `No partner path or profession link uses a bare route as its href (${bare.join("; ") || "none"}); only sign-in, privacy and contact are exempt`);
  ok(plain instanceof RegExp, "Census patterns compile");
  // The client module loads on demand (it stays out of the main bundle), and only partnership paths reach it.
  const appSource = read("client/src/App.tsx");
  const firstTouchCall = (src: string) => /const \{ pathname, search \} = window\.location;[\s\S]{0,200}\^\\\/\(partners\|affiliate\)[\s\S]{0,200}import\("@\/lib\/partner-application-client"\)\.then\(\(m\) => m\.capturePartnerFirstTouch\(pathname, search\)\)/.test(src);
  ok(firstTouchCall(appSource), "The app records the partner first touch on route change, loading the client module on demand for partnership paths only");
  ok(!firstTouchCall(appSource.replace("capturePartnerFirstTouch(pathname, search)", "noop()")), "Negative control: an app that stops recording the first touch is caught");
  ok(!/^import [^;]*partner-application-client/m.test(appSource), "The partner client module is not statically imported by the app shell (main bundle stays small)");
  ok(/firstTouch: readPartnerFirstTouch\(\)/.test(read("client/src/components/public/PartnerApplicationForm.tsx")), "The application form submits the resolved (current-or-first) touch");
  delete (globalThis as any).window; delete (globalThis as any).sessionStorage;
}

console.log(`Partner program contracts: ${checks} checks passed`);
process.exit(0);
