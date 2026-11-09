/**
 * W-C public forms and CRM handoff certification (disposable database, deny-by-default egress, no provider transport).
 *
 * Drives the REAL public routes (equipment and general inquiry modes of /api/public/get-started, /api/public/support, the
 * multipart statement upload) and the REAL operator routes (Inbound Operations list, statement handoff status) against a
 * disposable database. It proves, with fixtures and negative controls:
 *   - frozen contracts did not move (golden manifest and fingerprint hashes), and the new modes share no warm/nurture lane;
 *   - strict DTOs reject unknown keys, optional phone is never invented or erased, and text permission needs a real number;
 *   - one durable occurrence/contact/deal/task/notification per submission, a truthful replay, and a conflict on a changed payload;
 *   - a legacy-fingerprint statement retry replays instead of conflicting, and validation failures create nothing;
 *   - the public status check is capability-bound (receipt + original key + caller), never a short-reference read;
 *   - staff see the frozen inquiry context and the protected-file link; the statement handoff read model never calls a
 *     held or handed-off step "done", never turns a failed read into an empty list, and never says analysis ran when it was held.
 *
 * It never sends mail, never calls a provider, never enables a capability beyond its own disposable database and keeps
 * the global outbound pause in force for the entire run.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Public W-C intake certification" });
applyCertificationProviderDenyBoundary({ fatal: true });
process.env.APP_URL = "https://libertybancard.com";
process.env.BACKGROUND_JOB_PROFILE = "off";

const { pool } = await import("../../server/db");
const { setupAuth } = await import("../../server/replit_integrations/auth/replitAuth");
const { csrfTokenEndpoint } = await import("../../server/middleware/csrf");
const { registerPublicRoutes } = await import("../../server/routes/public");
const { registerLeadOpsRoutes } = await import("../../server/routes/lead-ops");
const { registerBoardingRoutes } = await import("../../server/routes/boarding");
const authority = await import("../../server/services/inbound-request-authority");
const notificationAuthority = await import("../../server/services/notification-authority");
const websiteContracts = await import("../../server/services/website-email-contracts");
const statementFields = await import("../../server/services/public-statement-fields");
const idempotency = await import("../../server/services/statement-upload-idempotency");
const occurrence = await import("../../server/services/public-sales-occurrence");
const readModel = await import("../../server/services/statement-chain-read-model");
const chainState = await import("../../shared/statement-chain-state");
const inquiry = await import("../../shared/public-inquiry");
const supportModule = await import("../../server/routes/public-support");
const { storage } = await import("../../server/storage");

let checks = 0;
const check = (value: unknown, message: string) => {
  assert(value, message);
  checks++;
  console.log(`✓ [WC-${String(checks).padStart(3, "0")}] ${message}`);
};
const tag = randomUUID().slice(0, 8);

// Real pause state: the global outbound pause stays in force for the whole certification.
{
  const updated = await pool.query(`UPDATE outbound_pause_control SET state='paused', reason='public W-C certification', committed_at=NOW()`);
  if (updated.rowCount === 0) {
    await pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at)
      VALUES ('paused','public W-C certification',1,'wc-cert',$1,NOW())`, [`wc-cert-${randomUUID()}`]);
  }
  (await import("../../server/services/outbound-pause-authority")).invalidatePauseStateCache();
}

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), Buffer.alloc(1024, 0x20)]);

// ── Frozen contracts: golden hashes computed from the pre-W-C code ──────────────────────────────
{
  const hashPayload = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => { out[key] = (value as any)[key]; return out; }, {});
  })).digest("hex");
  const GOLDEN: Record<string, string> = {
    "website_form|estimate_form": "da98e295292aac2d4c6019695b4744ea644e2a1e793aefd8926ac0b6244ef747",
    "website_form|get_started_form": "7ecd999b92ec788ca434bfbd0482f31605474fae02a0a655755d47a9d1571346",
    "website_form|callback_form": "42cbea3e3722e478d53c8aee694ece3faba83ae5515789cb49d1f8d1b2fe86d8",
    "website_form|free_analysis": "878d266b846824eac5ae5ab6d0e387a0b033ac997349aa25db4024bff307e3c5",
    "website_form|statement_upload": "b42972d11d78929452bf3edc0448af815a58bfa5ea177e402eb278bc37aeac99",
    "website_form|integration_request": "ce6c699512d4099c42dfce6d3c209a34e676f83265097ab19af192416ece8663",
    "website_form|support_form": "0717409c5c853b71d4c036cb9913a61fdf815ec58efec0bd6c76103a84322666",
    "website_form|equipment_order": "1c3fb6d142cb2a97a17253bc4d1f8435051149886cb6f627e4aee14cbb03845e",
    "website_form|testimonial_submit": "8d03744da86600dca74e3112c0a610f5559ccb0e348d8d88d411c081ff864ad6",
    "website_form|newsletter_signup": "6e56c0d4f3b874949672ce61d33d5de3bad69501a2ceb905ad79e3d9476c8c87",
    "website_form|partner_application": "afa9452fe02d3b50a49ecda80e0dce3ad9eb9dc05a648f82354af66c3f90d2ee",
    "website_form|privacy_request": "43b2cd9802a014394a0e669331b4a3ea0df02a911e2d18e83174d3f4814d09b3",
    "ghl_webhook|inbound_message": "45a209099df58bcc2bd77482d61152dfb1cec44113389020745f9d204ac3dd96",
    "ghl_webhook|appointment_booked": "a5074ce3017296c57b07606bdcbb57984cdf734ab6b2d69389e6baa44efdaba7",
    "manual_crm|dashboard": "cf77b9265bc196d81a4ca85379809c90afea039121b8f8ea19db40a0f8321dbc",
  };
  const policies = new Map(authority.INBOUND_SOURCE_POLICIES.map((p) => [`${p.sourceCategory}|${p.sourceType}`, p]));
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const actual = hashPayload({ version: authority.INBOUND_MANIFEST_VERSION, policy: policies.get(key) });
    assert.equal(actual, expected, `Source contract ${key} must keep its pre-W-C manifest hash`);
  }
  check(true, `${Object.keys(GOLDEN).length} existing source contracts keep their exact pre-W-C manifest hashes (no stored occurrence can drift)`);

  const legacy = idempotency.computeRequestFingerprint({
    fields: { email: "golden@example.com", mobile: "+13055550123", businessName: "golden cafe", source: "website", utmSource: null, utmCampaign: null, landingPage: "/upload-statement", existingContactId: null, existingDealId: null },
    fileBuffer: Buffer.from("%PDF-1.4 golden fixture"),
  });
  check(legacy === "5d94c0a0e29ecce302dcd4fb56a8f57fa8ebcfca90810112661c7a7ba036c514", "The pre-W-C statement request fingerprint is byte-for-byte unchanged");
  const parsedGolden = statementFields.parseStatementFields({ businessName: "Golden Cafe", contactName: "Ada Golden", email: "Golden@Example.com", mobile: "(305) 555-0123" });
  assert(parsedGolden.ok);
  const v2 = (overrides: Record<string, unknown> = {}, file = Buffer.from("%PDF-1.4 golden fixture")) => {
    const parsed = statementFields.parseStatementFields({ businessName: "Golden Cafe", contactName: "Ada Golden", email: "Golden@Example.com", mobile: "(305) 555-0123", ...overrides });
    assert(parsed.ok);
    return statementFields.computeStatementFingerprintV2({ data: parsed.data, existingContactId: null, existingDealId: null, fileBuffer: file });
  };
  check(v2() === "c5dec20631e72830731eac1fa9e1af953c694e5120f19fbdeb4925688d33e241", "The versioned v2 statement fingerprint matches its golden value and is 64 lowercase hex characters (the stored column shape)");
  check(v2({ utmSource: "x", landingPage: "/somewhere", gclid: "abc", referrerUrl: "https://example.com/" }) === v2(), "Observational metadata (UTM, landing page, click id, referrer) does not change the request identity");
  check(v2({ mobile: "305-555-0123", email: " GOLDEN@example.com " }) === v2(), "Phone formatting and email case do not change the request identity");
  check(v2({ contactName: "Someone Else" }) !== v2() && v2({ notes: "x" }) !== v2() && v2({}, Buffer.from("%PDF-1.4 other")) !== v2(), "A changed name, note or file is a different request");
}

// ── New modes stay outside the warm lane and carry no promotional authority ───────────────────────
{
  const sales = authority.INBOUND_SOURCE_POLICIES.filter((p) => p.sourceType === "equipment_inquiry" || p.sourceType === "general_inquiry");
  check(sales.length === 2 && sales.every((p) => p.sourceClass === "sales_request" && p.sourceCategory === "website_form"), "Equipment and general inquiry are sales requests from the website form source");
  const effectKeys = sales.flatMap((p) => p.effects.map((e) => e.key));
  check(!effectKeys.some((key) => /warm|nurture|promot|enroll|sequence|campaign/i.test(key)), "Neither new mode declares a warm, nurture, promotional or sequence effect");
  check(sales.every((p) => (p.forbiddenEffects ?? []).includes("promotional_enrollment")), "Both new modes explicitly forbid promotional enrollment");
  const lane = Object.keys(websiteContracts.WEBSITE_LANE_SOURCE_PROGRAMS);
  check(!lane.includes("equipment_inquiry") && !lane.includes("general_inquiry") && !lane.some((k) => /equipment_inquiry|general_inquiry/.test(k)), "Neither new mode is in the warm website lane source table");
  check(occurrence.RECOVERABLE_SALES_SOURCE_TYPES.includes("equipment_inquiry" as never) && occurrence.RECOVERABLE_SALES_SOURCE_TYPES.includes("general_inquiry" as never), "Both new modes are recoverable sales sources (an interrupted request resumes, never duplicates)");
}

// ── Strict DTO contracts ──────────────────────────────────────────────────────────────────────────
{
  const base = { mode: "equipment_inquiry", businessName: "Strict Cafe", name: "Ada Strict", email: "strict@example.com", businessType: "Restaurant", volumeBand: "under_5000", currentlyLeasing: "no" };
  check(inquiry.equipmentInquirySchema.safeParse(base).success, "A minimal equipment inquiry (no phone) is valid");
  check(!inquiry.equipmentInquirySchema.safeParse({ ...base, emailMarketingOptIn: true }).success, "An unknown key (marketing opt-in) is rejected, not ignored");
  check(!inquiry.equipmentInquirySchema.safeParse({ ...base, volumeBand: "a lot" }).success && !inquiry.equipmentInquirySchema.safeParse({ ...base, currentlyLeasing: "maybe" }).success, "Free-text volume or lease answers are rejected");
  check(inquiry.equipmentInquirySchema.safeParse({ ...base, phone: "" }).success && inquiry.equipmentInquirySchema.safeParse({ ...base, phone: "   " }).success, "A blank phone means not provided");
  check(!inquiry.equipmentInquirySchema.safeParse({ ...base, phone: "12345" }).success, "A non-blank phone must be a real number");
  check(inquiry.inquiryConsentIssues({ pewcConsent: true }).length === 1 && inquiry.inquiryConsentIssues({ pewcConsent: true, phone: "3055550188" }).length === 0 && inquiry.inquiryConsentIssues({ pewcConsent: false }).length === 0, "Text permission needs a valid phone number; declining needs nothing");
  check(!inquiry.generalInquirySchema.safeParse({ mode: "general_inquiry", businessName: "G", name: "G G", email: "g@example.com" }).success, "A general inquiry requires an intent");
  check(!inquiry.generalInquirySchema.safeParse({ mode: "general_inquiry", businessName: "G", name: "G G", email: "g@example.com", intent: "processing", note: "x".repeat(inquiry.INQUIRY_NOTE_MAX + 1) }).success, "The note is bounded");
  check(!supportModule.supportRequestSchema.safeParse({ name: "S", businessName: "S", email: "s@example.com", issueType: "Other", priority: "Normal", message: "m", emailMarketingOptIn: true }).success, "Support rejects unknown keys");
  check(supportModule.supportRequestSchema.safeParse({ name: "S", businessName: "S", email: "s@example.com", issueType: "Other", priority: "Normal", message: "m" }).success, "Support accepts a request with no phone");

  const missingName = statementFields.parseStatementFields({ businessName: "B", email: "b@example.com" });
  check(!missingName.ok && missingName.issues.some((i) => i.path === "contactName"), "A statement request without your name is refused with the field named");
  const marketing = statementFields.parseStatementFields({ businessName: "B", contactName: "C C", email: "b@example.com", emailMarketingOptIn: "true" });
  check(!marketing.ok, "A statement request cannot carry a marketing opt-in");
  const noPhonePewc = statementFields.parseStatementFields({ businessName: "B", contactName: "C C", email: "b@example.com", pewcConsent: "true" });
  check(!noPhonePewc.ok && noPhonePewc.issues.some((i) => i.path === "pewcConsent"), "Statement text permission without a phone is a field error");
  check(statementFields.parseStatementFields({ businessName: "B", contactName: "C C", email: "b@example.com", mobile: "" }).ok, "A blank statement phone is accepted as not provided");
}

// ── Handoff normaliser (the same pure code runs in the server and the browser panel) ─────────────
{
  const s = chainState;
  check(s.classifyChainStep({ success: false }) === "failed" && s.classifyChainStep({ success: true }) === "done", "A failed step is failed; a plain success is done");
  check(s.classifyChainStep({ success: true, data: { state: "held" } }) === "held" && s.classifyChainStep({ success: true, data: { enrollmentStatus: "held" } }) === "held", "A step that reported success but was held is HELD, not done");
  check(s.classifyChainStep({ success: true, data: { state: "handed_off", providerComplete: false } }) === "handed_off" && s.classifyChainStep({ success: true, data: { providerComplete: false } }) === "handed_off", "A provider handoff that is not confirmed is handed off, not done");
  const stored = s.toStoredChainSteps([
    { step: 4, name: "File attached", success: true, data: { documentId: 9, storageKey: "protected://secret-object-reference-0123456789abcdef" } },
    { step: 5, name: "AI analysis held", success: true, data: { state: "held", reason: "STATEMENT_AUTO_ANALYSIS_NOT_ENABLED" } },
    { step: 8, name: "Pipeline stage set", success: false, error: "x@example.com failed with token abcdef0123456789abcdef0123456789abcdef" },
  ]);
  check(!JSON.stringify(stored).includes("secret-object") && !JSON.stringify(stored).includes("@example.com") && !JSON.stringify(stored).includes("abcdef0123456789abcdef0123456789"), "Stored step detail carries no storage reference, email address or secret-shaped token");
  check(stored[1].detail === "STATEMENT_AUTO_ANALYSIS_NOT_ENABLED", "A plain reason code survives sanitising (it is not mistaken for a secret)");
  const status = (steps: any, extra: Record<string, unknown> = {}) => s.deriveOccurrenceStatus({ lifecycleState: "accepted", terminalReason: null, commandStatus: "succeeded", steps, ...extra } as any);
  const done = { step: 1, name: "a", state: "done" as const };
  check(status([done]) === "complete", "All steps done is complete");
  check(status([done, { step: 5, name: "b", state: "held" }]) === "held", "A held step is never 'complete'");
  check(status([done, { step: 7, name: "c", state: "handed_off" }]) === "held", "An unconfirmed handoff is never 'complete'");
  check(status([done, { step: 8, name: "d", state: "failed" }]) === "needs_attention", "A failed step needs attention");
  check(status([]) === "unrecorded" && status(null) === "unrecorded", "A command with no recorded steps is 'not recorded', never 'complete'");
  check(status([done], { commandStatus: "in_progress" }) === "in_progress" && status([done], { commandStatus: null }) === "in_progress", "A command that has not finished is in progress");
  check(status([done], { lifecycleState: "review_required", terminalReason: "STATEMENT_PROCESSING_DEFERRED:STATEMENT_QUEUE_PRODUCER_UNAVAILABLE", commandStatus: "in_progress" }) === "manual_review", "A deferred handoff is a manual review");
  const analysis = (dealId: number | null, analysisStatus: string | null, autoAnalysisEnabled: boolean) => s.deriveAnalysisState({ dealId, analysisStatus, autoAnalysisEnabled });
  check(analysis(null, null, true) === "held" && analysis(5, "none", false) === "held" && analysis(5, null, false) === "held", "No deal, or automatic analysis off, is 'held' (never queued or complete)");
  check(analysis(5, "complete", false) === "completed" && analysis(5, "processing", false) === "queued" && analysis(5, "failed", true) === "failed" && analysis(5, "none", true) === "not_started", "Analysis states come only from the deal's recorded status");
  const parsed = readModel.parseStoredChainSteps({ steps: [{ step: 1, name: "ok", state: "done" }, { step: "2", name: "bad", state: "done" }, { step: 3, name: "worse", state: "great" }, null, "x"] });
  check(parsed.length === 1 && readModel.parseStoredChainSteps({}).length === 0 && readModel.parseStoredChainSteps(null).length === 0, "Only well-formed stored steps are read; anything else is 'no recorded steps', never guessed success");
}

// ── Test app: the real public, Lead Ops and boarding routes with real local sign-in ───────────────
const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(cookieParser());
await setupAuth(app);
app.get("/api/csrf-token", csrfTokenEndpoint);
registerPublicRoutes(app);
registerLeadOpsRoutes(app);
registerBoardingRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const url = `http://127.0.0.1:${(server.address() as any).port}`;
let ipCounter = 40;
let phoneSeq = 1;
const callers = new Map<string, string>();
const nextIp = () => `198.51.100.${ipCounter++}`;
const uniquePhone = () => {
  const n = phoneSeq++;
  const exchange = 200 + (Number.parseInt(tag, 16) % 700);
  return `(3${String(10 + (n % 80))}) ${exchange}-${String(1000 + n).padStart(4, "0")}`;
};
const ipFor = (key: string) => callers.get(key) ?? callers.set(key, nextIp()).get(key)!;

async function post(path: string, body: unknown, options: { key?: string | null; ip?: string } = {}) {
  const key = options.key === null ? null : options.key ?? randomUUID();
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": options.ip ?? (key ? ipFor(key) : nextIp()) };
  if (key) headers["idempotency-key"] = key;
  const response = await fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  let json: any = null;
  try { json = await response.json(); } catch { /* non-JSON */ }
  return { status: response.status, body: json, key };
}

async function upload(input: { bytes?: Buffer; key?: string | null; email?: string; business?: string; contactName?: string | null; mobile?: string | null; extra?: Record<string, string> }) {
  const form = new FormData();
  if (input.bytes) form.append("statementFile", new Blob([input.bytes], { type: "application/pdf" }), "statement.pdf");
  form.append("businessName", input.business ?? `Statement Cafe ${tag}`);
  if (input.contactName !== null) form.append("contactName", input.contactName ?? "Ada Statement");
  form.append("email", input.email ?? `wc-${tag}-${randomUUID().slice(0, 6)}@example.com`);
  if (input.mobile !== null) form.append("mobile", input.mobile ?? uniquePhone());
  for (const [k, v] of Object.entries(input.extra ?? {})) form.append(k, v);
  const key = input.key === null ? null : input.key ?? randomUUID();
  const headers: Record<string, string> = { "x-forwarded-for": key ? ipFor(key) : nextIp() };
  if (key) headers["idempotency-key"] = key;
  const response = await fetch(`${url}/api/public/statement-upload`, { method: "POST", body: form, headers });
  let body: any = null;
  try { body = await response.json(); } catch { /* non-JSON */ }
  return { status: response.status, body, key };
}

const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);
const baseline = async () => ({
  contacts: await count(`SELECT count(*) n FROM contacts`),
  deals: await count(`SELECT count(*) n FROM deals`),
  tasks: await count(`SELECT count(*) n FROM tasks`),
  notifications: await count(`SELECT count(*) n FROM notifications`),
  tickets: await count(`SELECT count(*) n FROM tickets`),
  objects: await count(`SELECT count(*) n FROM protected_objects`),
  commands: await count(`SELECT count(*) n FROM statement_upload_commands`),
});
const requestFor = async (key: string) => (await pool.query(`SELECT * FROM inbound_requests WHERE idempotency_key=$1`, [key])).rows[0];
const contactByEmail = async (email: string) => (await pool.query(`SELECT * FROM contacts WHERE lower(email)=lower($1)`, [email])).rows[0];

try {
  // ── Equipment inquiry ───────────────────────────────────────────────────
  const equipmentEmail = `wc-${tag}-equip@example.com`;
  const equipmentBusiness = `Equipment Cafe ${tag}`;
  const equipmentBody = { mode: "equipment_inquiry", offer: "free-terminal", businessName: equipmentBusiness, name: "Ada Equipment", email: equipmentEmail,
    businessType: "Restaurant", volumeBand: "5000_24999", currentlyLeasing: "yes", utmSource: "cert", landingPage: "/get-started" };
  const equipmentKey = randomUUID();
  const equipment = await post("/api/public/get-started", equipmentBody, { key: equipmentKey });
  check(equipment.status === 201 && /^[0-9A-F]{8}$/.test(equipment.body?.reference ?? "") && equipment.body?.inquiry?.mode === "equipment_inquiry" && equipment.body?.inquiry?.offerId === "free-terminal",
    "An equipment inquiry with no phone is accepted (201) with a short reference and the server-resolved offer");
  const equipmentRequest = await requestFor(equipmentKey);
  check(equipmentRequest.source_type === "equipment_inquiry" && equipmentRequest.source_class === "sales_request" && equipmentRequest.manifest_version === authority.INBOUND_MANIFEST_VERSION,
    "The occurrence is stored under the equipment-inquiry source contract (not the generic get-started one)");
  check(equipmentRequest.attribution_refs?.schema === "wc-inquiry-v1" && equipmentRequest.attribution_refs.offer?.id === "free-terminal" && equipmentRequest.attribution_refs.volumeBand === "5000_24999"
    && equipmentRequest.attribution_refs.currentlyLeasing === "yes" && equipmentRequest.attribution_refs.phoneProvided === false && equipmentRequest.attribution_refs.smsPermissionRequested === false,
    "The semantic context (offer, volume band, lease answer, phone and text permission) is frozen on the occurrence");
  const equipmentContact = await contactByEmail(equipmentEmail);
  check(equipmentContact && equipmentContact.phone === "" && equipmentContact.company_name === equipmentBusiness, "The contact is created with an empty phone (never invented) and the business name");
  check(await count(`SELECT count(*) n FROM deals WHERE inbound_request_id=$1`, [equipmentRequest.id]) === 1, "Exactly one deal belongs to the occurrence");
  const equipmentEffects = (await pool.query(`SELECT effect_key, state FROM inbound_request_effects WHERE request_id=$1`, [equipmentRequest.id])).rows.map((r) => r.effect_key);
  check(!equipmentEffects.some((k: string) => /warm|nurture|promot|enroll|sequence|campaign/i.test(k)), "The occurrence has no warm, nurture, promotional or sequence effect");
  check(await count(`SELECT count(*) n FROM sequence_enrollments WHERE contact_id=$1`, [equipmentContact.id]) === 0, "The contact is not enrolled in any sequence");
  const equipmentTask = (await pool.query(`SELECT t.* FROM inbound_request_work_links l JOIN tasks t ON t.id=l.task_id WHERE l.request_id=$1 AND l.work_type='task'`, [equipmentRequest.id])).rows;
  check(equipmentTask.length === 1 && equipmentTask[0].title === `Review equipment inquiry — ${equipmentBusiness}` && equipmentTask[0].due_date, "Exactly one review task names the business and has a due date");
  check(/Under|\$5,000|monthly card volume: \$5,000/.test(equipmentTask[0].description) && /current terminal lease: Yes/.test(equipmentTask[0].description), "The task carries the band label and the lease answer, from the frozen context");
  const equipmentNotes = (await pool.query(`SELECT metadata, message FROM notifications WHERE inbound_request_id=$1`, [equipmentRequest.id])).rows;
  check(equipmentNotes.length === 1 && equipmentNotes[0].metadata.link === `/dashboard/lead-ops?tab=pipeline&ref=${equipment.body.reference}` && equipmentNotes[0].metadata.contactId === undefined && equipmentNotes[0].metadata.dealId === undefined,
    "Exactly one internal notification links to the request by short reference and has no typed contact or deal target");

  // Replay and conflict
  {
    const before = await baseline();
    const replay = await post("/api/public/get-started", equipmentBody, { key: equipmentKey });
    check(replay.status === 200 && replay.body?.replayed === true && replay.body?.requestReceipt === equipment.body.requestReceipt, "Replaying the same submission returns the same receipt");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "A replay creates no second contact, deal, task, notification or ticket");
    const changed = await post("/api/public/get-started", { ...equipmentBody, volumeBand: "under_5000" }, { key: equipmentKey });
    check(changed.status === 409, "The same key with a different payload is a conflict, never a second submission");
    check((await requestFor(equipmentKey)).attribution_refs.volumeBand === "5000_24999", "The frozen context is never replaced by a conflicting retry");
    const otherCaller = await post("/api/public/get-started", equipmentBody, { key: equipmentKey, ip: "198.51.100.250" });
    check(otherCaller.status === 404, "The same key from a different caller is indistinguishable from an unknown request");
  }

  // Validation failures create nothing
  {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["text permission without a phone", { ...equipmentBody, email: `wc-${tag}-e1@example.com`, pewcConsent: true }, "pewcConsent"],
      ["a malformed phone", { ...equipmentBody, email: `wc-${tag}-e2@example.com`, phone: "123" }, "phone"],
      ["an unknown marketing field", { ...equipmentBody, email: `wc-${tag}-e3@example.com`, emailMarketingOptIn: true }, "emailMarketingOptIn"],
      ["an unsupported offer", { ...equipmentBody, email: `wc-${tag}-e4@example.com`, offer: "free-everything" }, "offer"],
      ["a missing volume band", { ...equipmentBody, email: `wc-${tag}-e5@example.com`, volumeBand: undefined }, "volumeBand"],
    ];
    for (const [label, body, path] of cases) {
      const before = await baseline();
      const response = await post("/api/public/get-started", body);
      check(response.status === 400 && response.body?.error === "INVALID_SUBMISSION" && JSON.stringify(response.body.details ?? []).includes(path), `Equipment inquiry with ${label} is a 400 naming the field`);
      check(JSON.stringify(before) === JSON.stringify(await baseline()), `Equipment inquiry with ${label} created no contact, deal, task, notification or ticket`);
      const row = await requestFor(response.key!);
      check(row?.lifecycle_state === "failed", `Equipment inquiry with ${label} closes its claim as failed`);
    }
    const leak = await post("/api/public/get-started", { ...equipmentBody, email: `wc-${tag}-e6@example.com`, phone: "123" });
    check(!/stack|\/home\/|node_modules|postgres|select /i.test(JSON.stringify(leak.body)), "Validation answers expose no stack trace, path or SQL");
  }

  // Optional phone with permission, and a blank phone never erases
  {
    const email = `wc-${tag}-phone@example.com`;
    const phone = uniquePhone();
    const first = await post("/api/public/get-started", { ...equipmentBody, email, businessName: `Phone Cafe ${tag}`, phone, pewcConsent: true });
    check(first.status === 201, "An equipment inquiry with a valid phone and text permission is accepted");
    const request = await requestFor(first.key!);
    check(request.attribution_refs.phoneProvided === true && request.attribution_refs.smsPermissionRequested === true, "The frozen context records that a phone and text permission were provided");
    check(await occurrence.pewcDecisionRecorded(`equipment_inquiry:${request.id}`), "The text-permission decision is recorded once, bound to the occurrence");
    const stored = await contactByEmail(email);
    const digits = (value: string) => value.replace(/\D/g, "");
    check(digits(stored.phone).endsWith(digits(phone).slice(-10)), "The typed phone is stored on the contact");
    const second = await post("/api/public/get-started", { ...equipmentBody, email, businessName: `Phone Cafe ${tag}` });
    check(second.status === 201, "A later inquiry from the same email with no phone is accepted");
    check((await contactByEmail(email)).phone === stored.phone, "A blank phone never erases the stored number");
    const noConsent = await post("/api/public/get-started", { ...equipmentBody, email: `wc-${tag}-nophone@example.com`, pewcConsent: false });
    const noConsentRequest = await requestFor(noConsent.key!);
    check(noConsent.status === 201 && !(await occurrence.pewcDecisionRecorded(`equipment_inquiry:${noConsentRequest.id}`)), "Declining text permission records no permission decision");
  }

  // ── General inquiry ─────────────────────────────────────────────────────
  {
    const email = `wc-${tag}-general@example.com`;
    const body = { mode: "general_inquiry", businessName: `General Cafe ${tag}`, name: "Gina General", email, intent: "new_business", note: "Opening in spring." };
    const key = randomUUID();
    const response = await post("/api/public/get-started", body, { key });
    check(response.status === 201 && response.body?.inquiry?.mode === "general_inquiry" && response.body?.inquiry?.offerId === null, "A general inquiry is accepted with no offer");
    const request = await requestFor(key);
    check(request.source_type === "general_inquiry" && request.attribution_refs.intent === "new_business" && request.attribution_refs.note === "Opening in spring." && request.attribution_refs.offer === null, "Its intent and bounded note are frozen on the occurrence");
    const task = (await pool.query(`SELECT t.title FROM inbound_request_work_links l JOIN tasks t ON t.id=l.task_id WHERE l.request_id=$1`, [request.id])).rows;
    check(task.length === 1 && task[0].title === `Follow up business inquiry — General Cafe ${tag}`, "One follow-up task names the business");
    check((await post("/api/public/get-started", { ...body, intent: undefined, email: `wc-${tag}-g2@example.com` })).status === 400, "A general inquiry without an intent is a 400");
    check((await post("/api/public/get-started", { ...body, note: undefined, email: `wc-${tag}-g3@example.com` })).status === 201, "The note is optional");
  }

  // The mode value is an allowlist; the legacy body is untouched
  {
    const before = await baseline();
    const unknownMode = await post("/api/public/get-started", { mode: "admin_override", businessName: "X", name: "X X", email: `wc-${tag}-m@example.com` });
    check(unknownMode.status === 400, "An unknown mode is refused by the generic strict schema");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "An unknown mode created nothing");
    check((await requestFor(unknownMode.key!)).source_type === "get_started_form", "An unknown mode is claimed under the legacy get-started source, never an inquiry source");
    const legacyKey = randomUUID();
    const legacy = await post("/api/public/get-started", {
      goal: "not sure", vertical: "Retail", monthlyVolume: "$5k-$15k", needTerminal: false, interestedIn0Percent: false,
      firstName: "Leo", lastName: "Legacy", email: `wc-${tag}-legacy@example.com`, phone: uniquePhone(),
    }, { key: legacyKey });
    check(legacy.status === 201 && (await requestFor(legacyKey)).source_type === "get_started_form", "The legacy get-started body still succeeds under its frozen contract");
  }

  // ── Support ─────────────────────────────────────────────────────────────
  const supportEmail = `wc-${tag}-support@example.com`;
  const supportBody = { name: "Sam Support", businessName: `Support Cafe ${tag}`, email: supportEmail, issueType: "Funding / Deposits", priority: "Normal", message: "My deposit is late." };
  const supportKey = randomUUID();
  const support = await post("/api/public/support", supportBody, { key: supportKey });
  const supportRequest = await requestFor(supportKey);
  check(support.status === 201 && /^[0-9A-F]{8}$/.test(support.body?.reference ?? "") && supportRequest.source_type === "support_form", "A support request with no phone is accepted with a short reference");
  check(await count(`SELECT count(*) n FROM tickets WHERE contact_id=(SELECT id FROM contacts WHERE lower(email)=lower($1))`, [supportEmail]) === 1, "Exactly one ticket exists");
  const ticketId = (await pool.query(`SELECT ticket_id FROM inbound_request_work_links WHERE request_id=$1 AND work_type='ticket'`, [supportRequest.id])).rows[0]?.ticket_id;
  check(ticketId && await count(`SELECT count(*) n FROM ticket_comments WHERE ticket_id=$1`, [ticketId]) === 1, "Exactly one factual receipt comment is on the ticket");
  const comment = (await pool.query(`SELECT content FROM ticket_comments WHERE ticket_id=$1`, [ticketId])).rows[0].content as string;
  check(!/within|hours|minutes|guarantee|priority|soon/i.test(comment), "The receipt comment makes no response-time, staffing or priority promise");
  const supportNotes = (await pool.query(`SELECT metadata FROM notifications WHERE inbound_request_id=$1`, [supportRequest.id])).rows;
  check(supportNotes.length === 1 && supportNotes[0].metadata.link === `/dashboard/lead-ops?tab=pipeline&ref=${support.body.reference}` && supportNotes[0].metadata.ticketId === undefined && supportNotes[0].metadata.contactId === undefined,
    "Exactly one support notification links to the request, with no typed ticket or contact target");
  {
    const before = await baseline();
    const replay = await post("/api/public/support", supportBody, { key: supportKey });
    check(replay.status === 200 && replay.body?.replayed === true && replay.body?.requestReceipt === support.body.requestReceipt, "Replaying a support request returns the same receipt");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "A support replay creates no second contact, ticket, comment or notification");
    const withBad = await post("/api/public/support", { ...supportBody, email: `wc-${tag}-rej2@example.com`, consentSms: true });
    check(withBad.status === 400 && JSON.stringify(withBad.body?.details).includes("consentSms"), "Support text permission without a phone is a field error");
    const unknown = await post("/api/public/support", { ...supportBody, email: `wc-${tag}-rej3@example.com`, emailMarketingOptIn: true });
    check(unknown.status === 400, "Support refuses an unknown field");
    check(await count(`SELECT count(*) n FROM contacts WHERE email LIKE $1`, [`wc-${tag}-rej%@example.com`]) === 0, "Rejected support requests wrote no contact");
  }

  // ── Statement upload ────────────────────────────────────────────────────
  {
    const before = await baseline();
    const noName = await upload({ bytes: PDF, contactName: null });
    check(noName.status === 400 && noName.body?.error === "INVALID_SUBMISSION" && JSON.stringify(noName.body.details).includes("contactName"), "A statement without your name is a 400 naming the field");
    const marketing = await upload({ bytes: PDF, extra: { emailMarketingOptIn: "true" } });
    check(marketing.status === 400 && marketing.body?.error === "INVALID_SUBMISSION", "A statement with a marketing opt-in field is refused");
    const consent = await upload({ bytes: PDF, mobile: null, extra: { pewcConsent: "true" } });
    check(consent.status === 400 && JSON.stringify(consent.body.details).includes("pewcConsent"), "A statement with text permission but no phone is a field error");
    const badPhone = await upload({ bytes: PDF, mobile: "12" });
    check(badPhone.status === 400 && JSON.stringify(badPhone.body.details).includes("mobile"), "A statement with a malformed phone is a field error");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "Every rejected statement left no request, contact, retained object, command, task or notification");
    check(await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key = ANY($1)`, [[noName.key, marketing.key, consent.key, badPhone.key]]) === 0, "Rejected statements never claimed an occurrence");
  }
  const stmtEmail = `wc-${tag}-stmt-a@example.com`;
  const stmtKey = randomUUID();
  const statementA = await upload({ bytes: PDF, key: stmtKey, email: stmtEmail, business: `Statement Cafe A ${tag}`, mobile: null });
  check(statementA.status === 202 && statementA.body?.statementProcessing === "deferred" && /^[0-9A-F]{8}$/.test(statementA.body?.reference ?? ""), "A statement with no phone is accepted (202) and truthfully deferred");
  const statementARequest = await requestFor(stmtKey);
  check((await contactByEmail(stmtEmail)).phone === "", "A statement without a phone stores an empty phone, never an invented one");
  {
    const stored = statementARequest.request_fingerprint as string;
    check(/^[0-9a-f]{64}$/.test(stored), "A new statement occurrence is stored under a fingerprint of the exact shape the database constraint requires");
    // Rewrite to what the pre-W-C build would have stored for this exact request, as if the retry began before deploy.
    const legacy = idempotency.computeRequestFingerprint({
      fields: { email: stmtEmail, mobile: "", businessName: `statement cafe a ${tag}`, source: "website", utmSource: null, utmCampaign: null, landingPage: "/upload-statement", existingContactId: null, existingDealId: null },
      fileBuffer: PDF,
    });
    await pool.query(`UPDATE inbound_requests SET request_fingerprint=$2 WHERE idempotency_key=$1`, [stmtKey, legacy]);
    await pool.query(`UPDATE statement_upload_commands SET request_fingerprint=$2 WHERE request_id=$1`, [stmtKey, legacy]);
    const before = await baseline();
    const replay = await upload({ bytes: PDF, key: stmtKey, email: stmtEmail, business: `Statement Cafe A ${tag}`, mobile: null });
    check(replay.status === 200 && replay.body?.reference === statementA.body.reference && replay.body?.statementProcessing === "deferred", "A retry that began under the old fingerprint replays exactly once with the same reference");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "The legacy-fingerprint replay created nothing");
    check((await requestFor(stmtKey)).request_fingerprint === legacy, "The stored legacy fingerprint is never rewritten");
    const changed = await upload({ bytes: Buffer.concat([PDF, Buffer.from("changed")]), key: stmtKey, email: stmtEmail, business: `Statement Cafe A ${tag}`, mobile: null });
    check(changed.status === 409, "A legacy-fingerprint occurrence still conflicts when the file changes");
  }
  {
    const key = randomUUID();
    const email = `wc-${tag}-stmt-v2@example.com`;
    const first = await upload({ bytes: PDF, key, email, business: `Statement Cafe V2 ${tag}`, mobile: null });
    assert.equal(first.status, 202);
    const before = await baseline();
    const same = await upload({ bytes: PDF, key, email, business: `Statement Cafe V2 ${tag}`, mobile: null });
    check(same.status === 200 && same.body?.reference === first.body.reference, "A retry of a new statement occurrence replays with the same reference");
    const renamed = await upload({ bytes: PDF, key, email, business: `Statement Cafe V2 ${tag}`, mobile: null, contactName: "Someone Else" });
    check(renamed.status === 409, "After an ambiguous response, a retry with a changed name is a conflict, never a second submission");
    const noted = await upload({ bytes: PDF, key, email, business: `Statement Cafe V2 ${tag}`, mobile: null, extra: { notes: "different" } });
    check(noted.status === 409, "A retry with a changed note is a conflict");
    check(JSON.stringify(before) === JSON.stringify(await baseline()), "Replays and conflicts created nothing");
  }

  // Optional bookkeeping after acceptance must never turn a retained upload into a failure answer: the visitor would be
  // told it failed, retry, and the client would have no reason to keep the original key.
  {
    const realAudit = storage.createAuditLog.bind(storage);
    const key = randomUUID();
    const email = `wc-${tag}-stmt-auditfault@example.com`;
    (storage as any).createAuditLog = async (entry: any) => {
      if (entry?.action === "statement_uploaded") throw new Error("injected audit write fault");
      return realAudit(entry);
    };
    let first;
    try {
      first = await upload({ bytes: PDF, key, email, business: `Statement Audit Fault ${tag}`, mobile: null });
    } finally {
      (storage as any).createAuditLog = realAudit;
    }
    const row = await requestFor(key);
    check(first.status === 202 && first.body?.requestReceipt === row?.id && /^[0-9A-F]{8}$/.test(first.body?.reference ?? "") && first.body?.statementProcessing === "deferred",
      "A fault in the optional upload audit write after acceptance still answers with the accepted receipt (202), never a failure");
    check(row && row.lifecycle_state !== "failed" && row.lifecycle_state !== "cancelled", "The accepted request is not marked failed by a fault in an optional write");
    const before = await baseline();
    const replay = await upload({ bytes: PDF, key, email, business: `Statement Audit Fault ${tag}`, mobile: null });
    check(replay.status === 200 && replay.body?.requestReceipt === first.body.requestReceipt && replay.body?.reference === first.body.reference, "Retrying that key returns the original receipt");
    check(JSON.stringify(before) === JSON.stringify(await baseline()) && await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key=$1`, [key]) === 1, "The retry created no second request, object, command or task");
  }
  {
    const marker = `WCEVENTFAULT${tag}`;
    const key = randomUUID();
    const email = `wc-${tag}-stmt-eventfault@example.com`;
    await pool.query(`CREATE OR REPLACE FUNCTION wc_fault_communication_event() RETURNS trigger AS $f$ BEGIN IF NEW.subject LIKE '%${marker}%' THEN RAISE EXCEPTION 'injected timeline write fault'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER wc_fault_communication_event BEFORE INSERT ON communication_events FOR EACH ROW EXECUTE FUNCTION wc_fault_communication_event()`);
    let first;
    try {
      first = await upload({ bytes: PDF, key, email, business: `Statement ${marker}`, mobile: null });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS wc_fault_communication_event ON communication_events`);
      await pool.query(`DROP FUNCTION IF EXISTS wc_fault_communication_event()`);
    }
    const row = await requestFor(key);
    check(first.status === 202 && first.body?.requestReceipt === row?.id && first.body?.statementProcessing === "deferred",
      "A fault in the optional timeline write after acceptance still answers with the accepted receipt (202)");
    check(row && row.lifecycle_state !== "failed" && await count(`SELECT count(*) n FROM communication_events WHERE subject LIKE $1`, [`%${marker}%`]) === 0, "The faulted timeline row was not written, and the request was not marked failed");
    check(await count(`SELECT count(*) n FROM audit_logs WHERE action='statement_occurrence_event_failed' AND entity_id=$1::int`, [Number(row?.contact_id)]) === 1, "The skipped timeline write left an audit record for operators");
    const replay = await upload({ bytes: PDF, key, email, business: `Statement ${marker}`, mobile: null });
    check(replay.status === 200 && replay.body?.reference === first.body.reference && await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key=$1`, [key]) === 1, "Retrying that key replays the one request");
  }

  // Public status capability
  {
    const receipt = statementA.body.requestReceipt as string;
    const status = async (key: string | null, ip: string | null, id = receipt) => {
      const headers: Record<string, string> = { "x-forwarded-for": ip ?? nextIp() };
      if (key) headers["idempotency-key"] = key;
      const response = await fetch(`${url}/api/public/inbound-requests/${id}/status`, { headers });
      let body: any = null;
      try { body = await response.json(); } catch { /* */ }
      return { status: response.status, body };
    };
    const ok = await status(stmtKey, ipFor(stmtKey));
    check(ok.status === 200 && typeof ok.body === "object" && !/@|statement\.pdf|contact_id|protected/i.test(JSON.stringify(ok.body)), "The original key from the original caller can read a bounded status with no contact or file detail");
    check((await status(null, ipFor(stmtKey))).status === 404, "A receipt alone (no key) reads nothing");
    check((await status(randomUUID(), ipFor(stmtKey))).status === 404, "A wrong key reads nothing");
    check((await status(stmtKey, "198.51.100.251")).status === 404, "The right key from another caller reads nothing");
    check((await status(stmtKey, ipFor(stmtKey), statementA.body.reference)).status === 404, "The short reference is not a read capability");
    check(JSON.stringify((await status(randomUUID(), null)).body) === JSON.stringify((await status(null, null)).body), "Every refused check looks the same (no existence disclosure)");
  }

  // ── Sign-in fixtures ────────────────────────────────────────────────────
  const password = randomUUID(), hash = await bcrypt.hash(password, 4);
  const sessions: Record<string, { cookie: string; id: string }> = {};
  for (const role of ["admin", "manager", "agent"]) {
    const email = `${randomUUID()}@example.invalid`, id = randomUUID();
    await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, [id, email, hash, role]);
    const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200, `Real local ${role} sign-in must succeed`);
    sessions[role] = { id, cookie: login.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") };
  }
  const get = (role: string | null, path: string) => fetch(url + path, { headers: role ? { cookie: sessions[role].cookie } : {} });

  // Notification visibility
  {
    const visible = async (role: string, shortRef: string) => ((await notificationAuthority.listActorNotifications({ userId: sessions[role].id, limit: 300, offset: 0 })).data as any[])
      .some((n: any) => n.metadata?.shortRef === shortRef || String(n.message ?? "").includes(shortRef));
    for (const [label, ref] of [["equipment inquiry", equipment.body.reference], ["support request", support.body.reference], ["statement", statementA.body.reference]] as const) {
      check(await visible("admin", ref) && await visible("manager", ref), `Admins and managers see the ${label} notification`);
      check(!(await visible("agent", ref)), `Agents do not see the ${label} notification`);
    }
    const adminList = (await notificationAuthority.listActorNotifications({ userId: sessions.admin.id, limit: 300, offset: 0 })).data as any[];
    const mine = adminList.find((n: any) => n.metadata?.shortRef === equipment.body.reference);
    check(mine?.target?.state === "available" && mine.target.url === `/dashboard/lead-ops?tab=pipeline&ref=${equipment.body.reference}`, "An unclassified public contact's notification still opens the exact request");
  }

  // Inbound Operations list: inquiry context and protected-file access
  {
    const list = async (role: string, ref: string) => (await (await get(role, `/api/lead-ops/inbound-requests?ref=${ref}`)).json()) as any[];
    check((await get(null, "/api/lead-ops/inbound-requests")).status === 401 && (await get("agent", "/api/lead-ops/inbound-requests")).status === 403, "The request list is for signed-in admins and managers only");
    for (const role of ["admin", "manager"]) {
      const rows = await list(role, equipment.body.reference);
      check(rows.length === 1 && rows[0].inquiry?.mode === "equipment_inquiry" && rows[0].inquiry.volumeBand === "$5,000–$24,999" && rows[0].inquiry.currentlyLeasing === "Yes" && rows[0].inquiry.businessType === "Restaurant" && rows[0].inquiry.phoneProvided === false,
        `${role}: the equipment row shows the labelled volume band, lease answer, business type and that no phone was given`);
      check(rows[0].statement === null, `${role}: a non-statement row has no statement block`);
    }
    const statementRows = await list("manager", statementA.body.reference);
    check(statementRows[0].statement?.available === true && statementRows[0].statement.analysis === "held" && statementRows[0].statement.documentHref === null && statementRows[0].inquiry === null,
      "A deferred statement row says analysis is held and has no file link when none is linked");
    check(!/protected:\/\/|storage_key|storageKey|statement\.pdf/i.test(JSON.stringify(statementRows)), "The row exposes no storage reference or file name");
  }

  // ── Statement handoff read model: fixtures for every state ───────────────
  const seedStatement = async (label: string, shape: { lifecycle: string; terminal: string | null; command: string | null; steps: any[] | null; dealAnalysis?: string; withDocument?: boolean }) => {
    const key = randomUUID();
    const response = await upload({ bytes: PDF, key, email: `wc-${tag}-chain-${label}@example.com`, business: `Chain ${label} ${tag}` });
    assert.equal(response.status, 202, `fixture ${label} accepted`);
    const request = await requestFor(key);
    let documentId: number | null = null;
    if (shape.withDocument) {
      documentId = (await pool.query(`INSERT INTO documents (contact_id, type, file_name, category, access_scope, status) VALUES ($1,'statement',$2,'Statements','internal','active') RETURNING id`,
        [request.contact_id, `fixture-${label}.pdf`])).rows[0].id;
    }
    await pool.query(`UPDATE inbound_requests SET lifecycle_state=$2, terminal_reason=$3 WHERE id=$1`, [request.id, shape.lifecycle, shape.terminal]);
    await pool.query(`UPDATE statement_upload_commands SET status=$2, result=$3::jsonb, document_id=$4 WHERE request_id=$1`,
      [key, shape.command ?? "in_progress", shape.steps === null ? null : JSON.stringify({ steps: shape.steps, allSuccess: !shape.steps.some((s) => s.state === "failed") }), documentId]);
    if (shape.dealAnalysis) {
      // The deferred upload has no deal (the chain never ran); the "chain ran" fixtures link one, as the chain would.
      const dealId = (await pool.query(`INSERT INTO deals (contact_id, pipeline, stage, analysis_status) VALUES ($1,'sales','New Lead',$2) RETURNING id`, [request.contact_id, shape.dealAnalysis])).rows[0].id;
      await pool.query(`UPDATE inbound_requests SET deal_id=$2 WHERE id=$1`, [request.id, dealId]);
    }
    return { key, request, shortRef: authority.inboundShortRef(request.id), documentId };
  };
  const done = (step: number, name: string) => ({ step, name, state: "done" });
  const heldSteps = [done(4, "File attached"), { step: 5, name: "AI analysis held", state: "held", detail: "STATEMENT_AUTO_ANALYSIS_NOT_ENABLED" }, { step: 7, name: "Projection handoff recorded", state: "handed_off" }, { step: 11, name: "Follow-up sequence held", state: "held" }];
  const held = await seedStatement("held", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: heldSteps, withDocument: true });
  const complete = await seedStatement("complete", { lifecycle: "completed", terminal: null, command: "succeeded", steps: [done(4, "File attached"), done(6, "Rep notified")], dealAnalysis: "complete" });
  const failed = await seedStatement("failed", { lifecycle: "accepted", terminal: null, command: "recoverable_failed", steps: [done(4, "File attached"), { step: 8, name: "Pipeline stage set", state: "failed", detail: "Stage change refused" }] });
  const unrecorded = await seedStatement("unrecorded", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: null, dealAnalysis: "none" });
  const running = await seedStatement("running", { lifecycle: "processing", terminal: null, command: "in_progress", steps: null });
  const deferred = { shortRef: statementARequest ? authority.inboundShortRef(statementARequest.id) : "" };

  const model = await readModel.readStatementChain({ limit: 200 });
  const byRef = new Map(model.rows.map((row) => [row.shortRef, row]));
  check(model.scope.limit === 200 && model.scope.returned === model.rows.length && typeof model.asOf === "string" && model.autoAnalysisEnabled === false, "The read model states its window, its as-of time and the analysis setting");
  check(byRef.get(held.shortRef)?.status === "held" && byRef.get(held.shortRef)?.analysis === "held", "A chain with held and handed-off steps is 'held', and analysis is held (never 'complete')");
  check(byRef.get(held.shortRef)?.steps.map((s) => s.state).join(",") === "done,held,handed_off,held" && byRef.get(held.shortRef)?.documentId === held.documentId, "Each step keeps its own state and the retained file is linked");
  check(byRef.get(complete.shortRef)?.status === "complete" && byRef.get(complete.shortRef)?.analysis === "completed", "A chain whose steps all ran, on a deal whose analysis is recorded complete, is 'complete'");
  check(byRef.get(failed.shortRef)?.status === "needs_attention", "A chain with a failed step needs attention");
  check(byRef.get(unrecorded.shortRef)?.status === "unrecorded" && byRef.get(unrecorded.shortRef)?.steps.length === 0, "A command with no recorded steps is 'not recorded', never 'complete'");
  check(byRef.get(running.shortRef)?.status === "in_progress", "An unfinished command is in progress");
  check(byRef.get(deferred.shortRef)?.status === "manual_review" && byRef.get(deferred.shortRef)?.diagnostics.terminalReason === "STATEMENT_PROCESSING_DEFERRED:STATEMENT_QUEUE_PRODUCER_UNAVAILABLE", "A deferred statement is a manual review with its sanitised reason");
  const onlyFailures = await readModel.readStatementChain({ limit: 200, failuresOnly: true });
  const failureRefs = onlyFailures.rows.map((r) => r.shortRef);
  check(failureRefs.includes(failed.shortRef) && failureRefs.includes(deferred.shortRef) && !failureRefs.includes(held.shortRef) && !failureRefs.includes(complete.shortRef), "The attention filter returns failed and deferred requests, not held or complete ones");
  check(onlyFailures.scope.failuresOnly === true && onlyFailures.scope.needsAttention === model.scope.needsAttention, "The attention count describes the same loaded window");
  const small = await readModel.readStatementChain({ limit: 2 });
  check(small.rows.length === 2 && small.scope.limit === 2, "A small window is honoured and reported as such");
  check(!/protected:\/\/|storage|@example\.com|statement\.pdf/i.test(JSON.stringify(model)), "The read model carries no storage reference, email address or file name");

  // The read model reads the owner switch exactly the way the upload chain does (a strict string comparison on the stored value),
  // so what staff see is what the chain actually decided. drizzle's jsonb mapping parses a stored JSON string once more, so only
  // a value that survives that second parse as the string "true" is an enabled switch to the chain.
  await storage.setSystemSetting("statement_auto_analysis_enabled", "true");
  try {
    const plain = await readModel.readStatementChain({ limit: 200 });
    check(plain.autoAnalysisEnabled === false && plain.rows.find((r) => r.shortRef === unrecorded.shortRef)?.analysis === "held",
      "A switch value the chain does not treat as enabled is reported as held, never as 'not started' or 'queued'");
  } finally {
    await storage.setSystemSetting("statement_auto_analysis_enabled", "false");
  }
  await storage.setSystemSetting("statement_auto_analysis_enabled", '"true"');
  try {
    check(await storage.getSystemSetting("statement_auto_analysis_enabled") === "true", "Fixture: the switch is stored in the form the chain recognises as enabled");
    const enabled = await readModel.readStatementChain({ limit: 200 });
    const row = enabled.rows.find((r) => r.shortRef === unrecorded.shortRef);
    check(enabled.autoAnalysisEnabled === true && row?.analysis === "not_started", "With the owner switch on and nothing recorded, analysis is 'not started' (still never 'complete')");
    check(enabled.rows.find((r) => r.shortRef === held.shortRef)?.analysis === "held" && enabled.rows.find((r) => r.shortRef === complete.shortRef)?.analysis === "completed",
      "With no deal to analyse a held-step chain stays 'held' even when the switch is on; a recorded completion stays 'completed'");
  } finally {
    await storage.setSystemSetting("statement_auto_analysis_enabled", "false");
  }

  // Operator route and document access
  {
    check((await get(null, "/api/operator/statement-chain")).status === 401, "The statement handoff view requires sign-in");
    check((await get("agent", "/api/operator/statement-chain")).status === 403, "Agents cannot open the statement handoff view");
    for (const role of ["admin", "manager"]) {
      const response = await get(role, "/api/operator/statement-chain?limit=200");
      const body = await response.json() as any;
      check(response.status === 200 && response.headers.get("cache-control") === "no-store" && body.rows.some((r: any) => r.shortRef === held.shortRef && r.status === "held"), `${role}: the handoff view loads, is not cached and shows the held chain as held`);
    }
    const bounded = await (await get("admin", "/api/operator/statement-chain?limit=100000")).json() as any;
    check(bounded.scope.limit === 200, "An oversized window request is capped");
    const heldRow = (await (await get("admin", `/api/lead-ops/inbound-requests?ref=${held.shortRef}`)).json() as any[])[0];
    check(heldRow.statement?.documentHref === `/api/documents/download/${held.documentId}` && heldRow.statement.analysis === "held", "A statement with a linked retained file shows the protected download route, never a public link");
    const documentsSource = (await import("node:fs")).readFileSync(new URL("../../server/routes/documents.ts", import.meta.url), "utf8");
    check(/app\.get\("\/api\/documents\/download\/:id", requireRole\("admin", "manager"\)/.test(documentsSource), "The linked file route is the existing admin/manager-only protected download, not a new or public path");
    const noDealRow = (await (await get("admin", `/api/lead-ops/inbound-requests?ref=${deferred.shortRef}`)).json() as any[])[0];
    check(noDealRow && noDealRow.statement.analysis === "held", "A request with no linked file or deal still shows a truthful held state for manual review");
  }

  // A failed read is an error, not an empty list
  {
    // Make the underlying query fail by hiding its table for the duration of this block.
    await pool.query(`ALTER TABLE statement_upload_commands RENAME TO statement_upload_commands_wc_hidden`);
    try {
      const response = await get("admin", "/api/operator/statement-chain");
      const body = await response.json() as any;
      check(response.status === 503 && body.error === "STATEMENT_CHAIN_UNAVAILABLE" && !Array.isArray(body.rows), "When the data cannot be read the answer is a 503 error, never an empty all-clear");
      check(!/relation|statement_upload_commands|postgres|stack/i.test(JSON.stringify(body)), "The 503 exposes no database detail");
      const list = await get("admin", `/api/lead-ops/inbound-requests?ref=${held.shortRef}`);
      const rows = await list.json() as any[];
      check(list.status === 200 && rows[0].statement?.available === false && rows[0].statement.analysis === null, "The request list still loads and marks statement detail unavailable (never 'held' or 'completed')");
    } finally {
      await pool.query(`ALTER TABLE statement_upload_commands_wc_hidden RENAME TO statement_upload_commands`);
    }
  }
} finally {
  server.close();
  await pool.end().catch(() => {});
}

console.log(`\nPublic W-C intake certification: ${checks} checks passed`);
process.exit(0);
