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
  ["get", "/api/partners/me/introductions", ["partner"]],
  ["post", "/api/partners/me/introductions", ["partner"]],
  ["get", "/api/partner-introductions", ["admin", "manager"]],
];
for (const [method, route, roles] of matrix) {
  const layer = find(method, route);
  ok(layer, `${method.toUpperCase()} ${route} is registered`);
  ok(JSON.stringify(rolesOf(layer)) === JSON.stringify(roles), `${method.toUpperCase()} ${route} requires ${roles ? roles.join("+") : "no role (public)"}`);
}
ok(!layers.some((l) => ["put", "patch", "delete"].some((m) => l.route.methods[m])), "The partner-program routes expose no PUT/PATCH/DELETE");
ok(!rolesOf(find("post", "/api/partner-applications/:id/decision")!)!.includes("manager"), "A manager cannot decide an application (read-only role)");
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

console.log(`Partner program contracts: ${checks} checks passed`);
process.exit(0);
