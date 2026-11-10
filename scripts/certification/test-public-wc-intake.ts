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
 * It never sends mail, never calls a real provider (the worker cases use a fake transport on loopback), never enables a
 * capability beyond its own disposable database and keeps the global outbound pause in force for the entire run.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";
import type { AnalysisEvidence } from "../../shared/statement-chain-state";

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

/**
 * Closure-correction sections (the WC-PV01 to PV05 behaviours) report every failing section in one run instead of stopping at
 * the first failed check, so a regression names each broken contract. Any failed section still fails the whole certification.
 */
const sectionFailures: string[] = [];
const section = async (name: string, body: () => Promise<void>) => {
  try { await body(); } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 300);
    sectionFailures.push(`${name}: ${message}`);
    console.log(`✗ [${name}] ${message}`);
  }
};

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
  await section("WC-PV04 pure derivation", async () => {
    // WC-PV04: analysis is read from this occurrence's OWN evidence. The deal's status is one shared, last-writer-wins value, so it
    // describes an upload only where that upload queued the work and no later queue attempt has taken it over.
    const analysis = (over: Partial<AnalysisEvidence> = {}) => s.deriveAnalysisState({
      dealId: 5, analysisStatus: "none", autoAnalysisEnabled: false, ownStep: "none", ownsDealStatus: false, documentOutcome: "none", finishedWithoutSteps: false, ...over,
    });
    check(analysis({ dealId: null, ownStep: "queued", ownsDealStatus: true, analysisStatus: "complete" }) === "held" && analysis({ dealId: null, autoAnalysisEnabled: true }) === "held", "With no deal there is nothing to analyse: 'held' for manual review, whatever else is recorded");
    check(analysis({ ownStep: "held", analysisStatus: "complete" }) === "held" && analysis({ ownStep: "held", analysisStatus: "complete", ownsDealStatus: true, autoAnalysisEnabled: true }) === "held",
      "An upload whose own analysis step was held is 'held', even when the shared deal status says complete (an earlier upload's result is never its result)");
    check(analysis({ ownStep: "failed", analysisStatus: "pending", ownsDealStatus: true }) === "not_queued" && analysis({ ownStep: "failed", analysisStatus: "processing", ownsDealStatus: true }) === "not_queued",
      "A failed enqueue is 'not queued' even though the deal was left 'pending', never 'queued'");
    check(analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "pending" }) === "queued"
      && analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "processing" }) === "queued" && analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "failed" }) === "failed",
      "An upload that queued the work and still owns the deal status reports that status while it is pending, processing or failed");
    // WC-PV04 repair: the deal status is set to complete when the BLUEPRINT finishes, before the structured extraction runs, and an extraction
    // failure does not revert it. It therefore can never complete a statement: only a result record that names the document can.
    check(analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "complete" }) === "not_recorded" && analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "completed" }) === "not_recorded"
      && analysis({ ownStep: "queued", ownsDealStatus: false, analysisStatus: "complete" }) === "not_recorded" && analysis({ ownStep: "none", analysisStatus: "complete", autoAnalysisEnabled: true }) === "not_started",
      "A deal status of complete alone (the blueprint finished) never says this statement's analysis completed, whoever owns the status");
    check(analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "none" }) === "not_recorded" && analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: null }) === "not_recorded",
      "A queued upload whose deal status is blank or reset is 'not recorded', never guessed");
    check(analysis({ ownStep: "queued", ownsDealStatus: false, analysisStatus: "complete" }) === "not_recorded" && analysis({ ownStep: "queued", ownsDealStatus: false, analysisStatus: "pending" }) === "not_recorded",
      "A queued upload whose deal status was taken over by a later attempt is 'not recorded' (the status is no longer about it)");
    check(analysis({ ownStep: "held", documentOutcome: "completed" }) === "completed" && analysis({ ownStep: "queued", ownsDealStatus: false, documentOutcome: "completed" }) === "completed"
      && analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "complete", documentOutcome: "completed" }) === "completed",
      "A durable analysis-complete record naming this upload's own document makes it 'completed', whoever owns the deal status now");
    check(analysis({ ownStep: "queued", ownsDealStatus: true, analysisStatus: "complete", documentOutcome: "failed" }) === "failed" && analysis({ ownStep: "held", documentOutcome: "failed" }) === "failed"
      && analysis({ ownStep: "queued", ownsDealStatus: false, analysisStatus: "complete", documentOutcome: "failed" }) === "failed" && analysis({ ownStep: "failed", documentOutcome: "failed" }) === "failed",
      "A durable analysis-failed record naming this upload's own document makes it 'failed', even though the blueprint left the deal status at complete");
    check(analysis({ finishedWithoutSteps: true, analysisStatus: "complete" }) === "not_recorded" && analysis({ finishedWithoutSteps: true, autoAnalysisEnabled: true }) === "not_recorded",
      "A finished command with no recorded steps and no document-bound record is 'not recorded', even when the deal says complete");
    check(analysis({ autoAnalysisEnabled: false }) === "held" && analysis({ autoAnalysisEnabled: true }) === "not_started" && analysis({ analysisStatus: "complete" }) === "held",
      "With no recorded step, the owner switch alone decides held or not started, and the deal status is never borrowed");
    const stepOf = (state: string) => s.analysisStepOutcome([{ step: 4, name: "File attached", state: "done" }, { step: 5, name: "AI analysis", state } as any]);
    check(s.analysisStepOutcome([]) === "none" && s.analysisStepOutcome(null) === "none" && s.analysisStepOutcome([{ step: 4, name: "x", state: "done" }]) === "none" && stepOf("held") === "held" && stepOf("failed") === "failed" && stepOf("done") === "queued",
      "Step 5 is read as held, failed, queued or not recorded");
    check(JSON.stringify(Object.keys(s.ANALYSIS_LABEL).sort()) === JSON.stringify(["completed", "failed", "held", "not_queued", "not_recorded", "not_started", "queued"])
      && Object.values(s.ANALYSIS_LABEL).every((label) => label.length > 10) && !/complete/i.test(s.ANALYSIS_LABEL.not_queued) && !/complete/i.test(s.ANALYSIS_LABEL.not_recorded),
      "Every analysis state has its own label, and neither unqueued nor unrecorded analysis reads as complete");
  });
  const parsed = readModel.parseStoredChainSteps({ steps: [{ step: 1, name: "ok", state: "done" }, { step: "2", name: "bad", state: "done" }, { step: 3, name: "worse", state: "great" }, null, "x"] });
  check(parsed.length === 1 && readModel.parseStoredChainSteps({}).length === 0 && readModel.parseStoredChainSteps(null).length === 0, "Only well-formed stored steps are read; anything else is 'no recorded steps', never guessed success");
}

// ── WC-PV02: the server-rendered /get-started says what the hydrated terminal page says ─────────────
{
  const { registerSsrRoutes } = await import("../../server/routes/ssr-routes");
  const ssrApp = express();
  registerSsrRoutes(ssrApp);
  const ssrServer = await new Promise<ReturnType<typeof ssrApp.listen>>((resolve) => { const listening = ssrApp.listen(0, "127.0.0.1", () => resolve(listening)); });
  const ssrBase = `http://127.0.0.1:${(ssrServer.address() as any).port}`;
  const page = async (query: string) => { const response = await fetch(`${ssrBase}/get-started${query}`); return { status: response.status, html: await response.text(), cache: response.headers.get("cache-control") }; };
  try {
    // The behaviour a crawler, link preview or slow-hydration visitor sees, stated with the visitor-facing words only.
    await section("WC-PV02 terminal first HTML behaviour", async () => {
      for (const query of ["?offer=free-terminal", "?terminal=yes"]) {
        const { html } = await page(query);
        check(html.includes("Let’s review your terminal options.") && !html.includes("Start Accepting Payments with Liberty Bancard"), `The first HTML for /get-started${query} says the hydrated terminal heading, not the application-start heading`);
        check(!/What You(?:'|&#39;|’)ll Need to Apply|\bEIN\/SSN\b|government-issued/.test(html), `The first HTML for /get-started${query} does not list application prerequisites (EIN/SSN, identity, bank account)`);
      }
      check((await page("")).html.includes("Start Accepting Payments with Liberty Bancard") && (await page("?offer=unsupported")).html.includes("Start Accepting Payments with Liberty Bancard"), "A plain or unsupported /get-started keeps the generic first HTML");
    });
    await section("WC-PV02 terminal first HTML contract", async () => {
      const terminalPage = await import("../../shared/public-terminal-inquiry");
      const page$ = terminalPage.TERMINAL_INQUIRY_PAGE;
      const GENERIC_ONLY = /Start Accepting Payments with Liberty Bancard|What You(?:'|&#39;|’)ll Need to Apply|EIN\/SSN|Start Your Application/;
      const intakeStatement = /\bEIN\b|\bSSN\b|government-issued|3 months of processing statements/;
      for (const query of ["?offer=free-terminal", "?terminal=yes", "?offer=free-terminal&utm_source=cert&utm_campaign=terminal"]) {
        const { status, html } = await page(query);
        check(status === 200 && html.includes(`<h1>${page$.heading}</h1>`) && html.includes(page$.body), `The first HTML for /get-started${query.split("&")[0]} carries the terminal inquiry heading and intro`);
        check(html.includes(`<title>${page$.title} | Liberty Bancard</title>`) && html.includes(page$.description) && html.includes('href="https://libertybancard.com/get-started"'), `/get-started${query.split("&")[0]}: the title, description and canonical agree with the hydrated page`);
        check(page$.asks.every((ask) => html.includes(ask)) && html.includes(page$.asksNote) && html.includes('href="tel:9542668214"'), `/get-started${query.split("&")[0]}: the first HTML lists what the short inquiry asks, and offers the phone`);
        check(!GENERIC_ONLY.test(html) && !intakeStatement.test(html.replace(page$.asksNote, "")), `/get-started${query.split("&")[0]}: the first HTML never shows the application-prerequisite list or statement and identity requirements`);
      }
      for (const query of ["", "?offer=unsupported", "?offer=free-terminal-evil", "?terminal=no", "?terminal=YES", "?offer="]) {
        const { status, html } = await page(query);
        check(status === 200 && html.includes("Start Accepting Payments with Liberty Bancard") && !html.includes(page$.heading) && !html.includes(page$.asksHeading), `/get-started${query || " (no query)"}: an unsupported or absent entrance keeps the generic first HTML`);
      }
      const reflected = await page("?terminal=yes&offer=%3Cscript%3Ealert(1)%3C%2Fscript%3E&x=%3Cimg%20src%3Dx%3E");
      const plain = await page("?terminal=yes");
      check(reflected.html === plain.html && !/alert\(1\)|<img src=x|%3Cscript/i.test(reflected.html), "Nothing from the query string is reflected into the terminal HTML (it is identical to the plain entrance)");
      check(terminalPage.readTerminalIntent("?offer=free-terminal").terminal && terminalPage.readTerminalIntent("?terminal=yes").offer === null && !terminalPage.readTerminalIntent("?offer=nope").terminal && !terminalPage.readTerminalIntent("").terminal,
        "The shared entrance contract selects the terminal inquiry only for the allowlisted offer and terminal=yes");
      const fs = await import("node:fs");
      const clientSource = fs.readFileSync(new URL("../../client/src/pages/GetStartedTerminal.tsx", import.meta.url), "utf8");
      check(/@shared\/public-terminal-inquiry/.test(clientSource) && !clientSource.includes(page$.heading) && !clientSource.includes(page$.title) && !clientSource.includes(page$.body),
        "The hydrated page takes its heading, title and intro from the same shared contract instead of its own copy");
    });
    // WC-PV01: both statement deep links exist in the first HTML, so a crawler, a link preview and the browser's own fragment
    // resolution all find the form region and a focusable heading before any script runs.
    await section("WC-PV01 statement anchors in the first HTML", async () => {
      const html = await (await fetch(`${ssrBase}/upload-statement`)).text();
      check(/id="statement-review-form"/.test(html) && /id="upload-form"/.test(html), "The first HTML of /upload-statement carries both deep-link targets (#statement-review-form and #upload-form)");
      check(/<h2[^>]*id="statement-form-heading"[^>]*tabindex="-1"/.test(html), "The first HTML names the form heading and makes it programmatically focusable");
    });
  } finally {
    ssrServer.close();
  }
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

  // ── Isolated actors: signed-in people on the public forms, and merchant/partner/affiliate sessions on staff surfaces ───
  // The public CSRF policy is NOT changed or relaxed here. Every case runs against the real session layer and the real
  // csrfProtection (mounted by setupAuth), with each actor's own persisted session and token.
  await section("Signed-in actors: public submissions, CSRF policy and staff-surface refusals", async () => {
    const actors: Record<string, { cookie: string; id: string; token: string }> = {};
    const csrfFor = async (cookie: string) => {
      const response = await fetch(`${url}/api/csrf-token`, { headers: { cookie } });
      const token = ((await response.json()) as { token: string }).token;
      const jar = [...cookie.split("; "), ...response.headers.getSetCookie().map((v) => v.split(";")[0])];
      return { token, cookie: jar.join("; ") };
    };
    for (const role of ["admin", "manager", "agent"]) actors[role] = { id: sessions[role].id, ...(await csrfFor(sessions[role].cookie)) };
    for (const role of ["merchant", "partner", "affiliate"]) {
      const email = `${randomUUID()}@example.invalid`, id = randomUUID();
      await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, [id, email, hash, role]);
      const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200, `Real local ${role} sign-in must succeed`);
      actors[role] = { id, ...(await csrfFor(login.headers.getSetCookie().map((v) => v.split(";")[0]).join("; "))) };
    }
    check(Object.keys(actors).length === 6 && new Set(Object.values(actors).map((a) => a.cookie)).size === 6, "Six distinct signed-in actors (admin, manager, agent, merchant, partner, affiliate) each hold their own session and token");

    const signed = async (role: string, method: string, path: string, body: unknown, options: { key?: string; token?: "valid" | "none" | "wrong" } = {}) => {
      const actor = actors[role];
      const key = options.key ?? randomUUID();
      const headers: Record<string, string> = { "content-type": "application/json", cookie: actor.cookie, "x-forwarded-for": ipFor(key), "idempotency-key": key };
      if ((options.token ?? "valid") === "valid") headers["x-csrf-token"] = actor.token;
      if (options.token === "wrong") headers["x-csrf-token"] = "0".repeat(actor.token.length);
      const response = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json: any = null;
      try { json = await response.json(); } catch { /* non-JSON */ }
      return { status: response.status, body: json, key };
    };

    // The public form is a public surface: a person who happens to be signed in, with or without a token, submits exactly the
    // same single, idempotent, source-labelled request an anonymous visitor does.
    for (const role of Object.keys(actors)) {
      for (const mode of ["none", "valid"] as const) {
        const email = `wc-${tag}-${role}-${mode}@example.com`;
        const body = { name: `Signed ${role}`, businessName: `Signed ${role} ${mode} ${tag}`, email, issueType: "Funding / Deposits", priority: "Normal", message: "Signed-in public submission." };
        const sent = await signed(role, "POST", "/api/public/support", body, { token: mode });
        const row = await requestFor(sent.key);
        check(sent.status === 201 && /^[0-9A-F]{8}$/.test(sent.body?.reference ?? "") && row?.source_type === "support_form" && row.source_class === supportRequest.source_class && row.manifest_version === supportRequest.manifest_version,
          `${role} (${mode === "none" ? "no CSRF token" : "valid CSRF token"}): a signed-in support submission is accepted and labelled exactly like an anonymous one`);
        check(await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key=$1`, [sent.key]) === 1
          && await count(`SELECT count(*) n FROM tickets WHERE contact_id=(SELECT id FROM contacts WHERE lower(email)=lower($1))`, [email]) === 1
          && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [row.id]) === 1,
          `${role} (${mode}): one request, one ticket and one management notification — signing in does not multiply or hide the work`);
        const replay = await signed(role, "POST", "/api/public/support", body, { key: sent.key, token: mode });
        check(replay.status === 200 && replay.body?.replayed === true && replay.body?.requestReceipt === sent.body.requestReceipt, `${role} (${mode}): replaying the same key returns the same receipt`);
        const changed = await signed(role, "POST", "/api/public/support", { ...body, message: "A different message." }, { key: sent.key, token: mode });
        check(changed.status === 409 && await count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key=$1`, [sent.key]) === 1, `${role} (${mode}): the same key with a changed payload is still a conflict, never a second submission`);
      }
    }
    const wrongToken = await signed("merchant", "POST", "/api/public/support", { name: "Wrong Token", businessName: `Wrong token ${tag}`, email: `wc-${tag}-wrong-token@example.com`, issueType: "Funding / Deposits", priority: "Normal", message: "A stale token on a public form." }, { token: "wrong" });
    check(wrongToken.status === 201, "A stale or wrong token on the public form does not block a signed-in visitor (the public route stays outside CSRF)");

    // Negative control: the CSRF layer is live and unchanged for every signed-in actor on a non-public mutation, so the cases
    // above prove the public exemption rather than a missing middleware. The probe path has no handler; CSRF runs before routing.
    for (const role of Object.keys(actors)) {
      const missing = await signed(role, "POST", "/api/csrf-policy-probe", {}, { token: "none" });
      const wrong = await signed(role, "POST", "/api/csrf-policy-probe", {}, { token: "wrong" });
      const valid = await signed(role, "POST", "/api/csrf-policy-probe", {}, { token: "valid" });
      check(missing.status === 403 && missing.body?.code === "csrf_missing" && wrong.status === 403 && wrong.body?.code === "csrf_mismatch" && valid.status === 404,
        `${role}: a non-public mutation without a token (403 csrf_missing) or with a wrong one (403 csrf_mismatch) is refused, and a valid token passes the CSRF layer (404, no handler)`);
    }
    const anonymousProbe = await fetch(`${url}/api/csrf-policy-probe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check(anonymousProbe.status === 404, "With no session there is nothing to forge: the same probe is not blocked by CSRF (policy unchanged)");

    // Merchant, partner and affiliate sessions are not staff: every handoff surface refuses them, with a valid token so the
    // refusal is the role guard and not a CSRF refusal. Nothing is changed by any of these calls.
    const staffReads = ["/api/lead-ops/inbound-requests", `/api/lead-ops/inbound-requests?ref=${equipment.body.reference}`, "/api/lead-ops/inbound-requests/summary", "/api/operator/statement-chain?limit=5"];
    for (const role of ["merchant", "partner", "affiliate"]) {
      const statuses: number[] = [];
      for (const path of staffReads) statuses.push((await fetch(`${url}${path}`, { headers: { cookie: actors[role].cookie } })).status);
      check(statuses.every((s) => s === 403), `${role}: the request list, a lookup by reference, the summary and the statement handoff are all refused (${statuses.join(",")})`);
      const resume = await signed(role, "POST", `/api/lead-ops/inbound-requests/${equipment.body.requestReceipt}/resume`, {});
      const recovery = await signed(role, "POST", `/api/lead-ops/inbound-requests/${statementA.body.requestReceipt}/statement-recovery`, {});
      check(resume.status === 403 && recovery.status === 403 && resume.body?.code === undefined, `${role}: resume and statement recovery are refused by the role guard even with a valid token`);
    }
    const anonymous = await Promise.all(staffReads.map(async (path) => (await fetch(`${url}${path}`)).status));
    check(anonymous.every((s) => s === 401), `Without a session every handoff read is refused as unauthenticated (${anonymous.join(",")})`);

    // Management notifications are for admin/manager only: other signed-in people never see them, and the signed-in public
    // submissions above are not visible to a merchant/partner/affiliate session either.
    const refsNow = (await pool.query(`SELECT metadata->>'shortRef' AS ref FROM notifications WHERE inbound_request_id IS NOT NULL`)).rows.map((r) => r.ref as string).filter(Boolean);
    check(refsNow.length >= 12, `The disposable database holds ${refsNow.length} request-bound management notifications to test visibility against`);
    for (const role of ["agent", "merchant", "partner", "affiliate"]) {
      const list = (await notificationAuthority.listActorNotifications({ userId: actors[role].id, limit: 300, offset: 0 })).data as any[];
      check(!list.some((n: any) => refsNow.includes(n.metadata?.shortRef)), `${role}: none of the request-bound management notifications is visible`);
    }
    const adminSeen = (await notificationAuthority.listActorNotifications({ userId: actors.admin.id, limit: 300, offset: 0 })).data as any[];
    check(refsNow.slice(0, 3).every((ref) => adminSeen.some((n: any) => n.metadata?.shortRef === ref)), "Negative control: an admin session does see the same notifications (the checks above can fail)");

    // A session is not a read capability for a public status check: the receipt, the original key and the original caller are still required.
    const readStatus = async (role: string, key: string | null, ip: string) => {
      const headers: Record<string, string> = { cookie: actors[role].cookie, "x-forwarded-for": ip };
      if (key) headers["idempotency-key"] = key;
      return (await fetch(`${url}/api/public/inbound-requests/${statementA.body.requestReceipt}/status`, { headers })).status;
    };
    check(await readStatus("merchant", null, ipFor(stmtKey)) === 404 && await readStatus("partner", randomUUID(), ipFor(stmtKey)) === 404 && await readStatus("admin", stmtKey, "198.51.100.249") === 404,
      "A merchant, partner or even admin session cannot read another visitor's public status without that visitor's key and caller");
    check(await readStatus("admin", stmtKey, ipFor(stmtKey)) === 200, "Negative control: the original key from the original caller still reads the bounded status, whoever is signed in");
  });

  // ── Statement handoff read model: fixtures for every state ───────────────
  const seedStatement = async (label: string, shape: { lifecycle: string; terminal: string | null; command: string | null; steps: any[] | null; dealAnalysis?: string; withDocument?: boolean; sharedDealId?: number; minutesAgo?: number }) => {
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
    let dealId: number | null = shape.sharedDealId ?? null;
    if (shape.dealAnalysis && dealId === null) {
      // The deferred upload has no deal (the chain never ran); the "chain ran" fixtures link one, as the chain would.
      dealId = (await pool.query(`INSERT INTO deals (contact_id, pipeline, stage, analysis_status) VALUES ($1,'sales','New Lead',$2) RETURNING id`, [request.contact_id, shape.dealAnalysis])).rows[0].id as number;
    }
    if (dealId !== null) await pool.query(`UPDATE inbound_requests SET deal_id=$2 WHERE id=$1`, [request.id, dealId]);
    // Several uploads can share one deal, and which one queued work last decides who owns the deal's shared analysis status.
    if (shape.minutesAgo !== undefined) await pool.query(`UPDATE inbound_requests SET created_at = now() - make_interval(mins => $2::int) WHERE id=$1`, [request.id, shape.minutesAgo]);
    return { key, request, shortRef: authority.inboundShortRef(request.id), documentId, dealId };
  };
  const done = (step: number, name: string) => ({ step, name, state: "done" });
  const heldSteps = [done(4, "File attached"), { step: 5, name: "AI analysis held", state: "held", detail: "STATEMENT_AUTO_ANALYSIS_NOT_ENABLED" }, { step: 7, name: "Projection handoff recorded", state: "handed_off" }, { step: 11, name: "Follow-up sequence held", state: "held" }];
  const held = await seedStatement("held", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: heldSteps, withDocument: true });
  const complete = await seedStatement("complete", { lifecycle: "completed", terminal: null, command: "succeeded", steps: [done(4, "File attached"), done(5, "AI analysis queued"), done(6, "Rep notified")], dealAnalysis: "complete", withDocument: true });
  // WC-PV04: a deal status of complete only records that the blueprint finished. This fixture is genuinely analysed only because the analyzer's
  // own result record names its retained document (the same audit row the real analyzer writes).
  await pool.query(`INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details) VALUES ('statement_analysis_complete','deal',$1,'system',$2::jsonb)`,
    [complete.dealId, JSON.stringify({ documentId: complete.documentId })]);
  const failed = await seedStatement("failed", { lifecycle: "accepted", terminal: null, command: "recoverable_failed", steps: [done(4, "File attached"), { step: 8, name: "Pipeline stage set", state: "failed", detail: "Stage change refused" }] });
  const unrecorded = await seedStatement("unrecorded", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: null, dealAnalysis: "none" });
  const running = await seedStatement("running", { lifecycle: "processing", terminal: null, command: "in_progress", steps: null, dealAnalysis: "none" });
  const deferred = { shortRef: statementARequest ? authority.inboundShortRef(statementARequest.id) : "" };

  const model = await readModel.readStatementChain({ limit: 200 });
  const byRef = new Map<string, any>(model.rows.map((row) => [row.shortRef, row] as [string, any]));
  check(model.scope.limit === 200 && model.scope.returned === model.rows.length && typeof model.asOf === "string" && model.autoAnalysisEnabled === false, "The read model states its window, its as-of time and the analysis setting");
  check(byRef.get(held.shortRef)?.status === "held" && byRef.get(held.shortRef)?.analysis === "held", "A chain with held and handed-off steps is 'held', and analysis is held (never 'complete')");
  check(byRef.get(held.shortRef)?.steps.map((s) => s.state).join(",") === "done,held,handed_off,held" && byRef.get(held.shortRef)?.documentId === held.documentId, "Each step keeps its own state and the retained file is linked");
  check(byRef.get(complete.shortRef)?.status === "complete" && byRef.get(complete.shortRef)?.analysis === "completed", "A chain whose steps all ran, on a deal whose analyzer recorded a result for its own document, is 'complete' and its analysis is 'completed'");
  check(byRef.get(failed.shortRef)?.status === "needs_attention", "A chain with a failed step needs attention");
  check(byRef.get(unrecorded.shortRef)?.status === "unrecorded" && byRef.get(unrecorded.shortRef)?.steps.length === 0, "A command with no recorded steps is 'not recorded', never 'complete'");
  await section("WC-PV04 historical command", async () => {
    check(byRef.get(unrecorded.shortRef)?.analysis === "not_recorded", "A historical command with no steps on a deal marked 'none' reports analysis as 'not recorded', not held or completed");
  });
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
    check(plain.autoAnalysisEnabled === false && plain.rows.find((r) => r.shortRef === running.shortRef)?.analysis === "held",
      "A switch value the chain does not treat as enabled is reported as held, never as 'not started' or 'queued'");
  } finally {
    await storage.setSystemSetting("statement_auto_analysis_enabled", "false");
  }
  await storage.setSystemSetting("statement_auto_analysis_enabled", '"true"');
  try {
    check(await storage.getSystemSetting("statement_auto_analysis_enabled") === "true", "Fixture: the switch is stored in the form the chain recognises as enabled");
    const enabled = await readModel.readStatementChain({ limit: 200 });
    const row = enabled.rows.find((r) => r.shortRef === running.shortRef);
    check(enabled.autoAnalysisEnabled === true && row?.analysis === "not_started", "With the owner switch on and nothing recorded, analysis is 'not started' (still never 'complete')");
    check(enabled.rows.find((r) => r.shortRef === held.shortRef)?.analysis === "held" && enabled.rows.find((r) => r.shortRef === complete.shortRef)?.analysis === "completed",
      "With no deal to analyse a held-step chain stays 'held' even when the switch is on; a recorded completion stays 'completed'");
  } finally {
    await storage.setSystemSetting("statement_auto_analysis_enabled", "false");
  }

  // ── WC-PV04: analysis truth is bound to the occurrence, not borrowed from the deal ──────────────────
  await section("WC-PV04 occurrence-bound analysis", async () => {
      const queuedSteps = [done(4, "File attached"), done(5, "AI analysis queued"), done(6, "Rep notified")];
      const failedEnqueueSteps = [done(4, "File attached"), { step: 5, name: "AI analysis queued", state: "failed", detail: "STATEMENT_ANALYSIS_QUEUE_UNAVAILABLE" }, done(6, "Rep notified")];
      const analysisOf = async (...refs: string[]) => {
        const chain = await readModel.readStatementChain({ limit: 200 });
        return Object.fromEntries(refs.map((ref) => [ref, chain.rows.find((row) => row.shortRef === ref)?.analysis]));
      };

      // Two uploads on one deal: the earlier one's analysis completed; the current one's analysis was held.
      const earlier = await seedStatement("pv04-earlier", { lifecycle: "completed", terminal: null, command: "succeeded", steps: queuedSteps, dealAnalysis: "complete", withDocument: true, minutesAgo: 90 });
      const current = await seedStatement("pv04-current", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: heldSteps, withDocument: true, sharedDealId: earlier.dealId!, minutesAgo: 10 });
      let state = await analysisOf(earlier.shortRef, current.shortRef);
      check(state[earlier.shortRef] === "not_recorded", "The earlier upload queued the work and owns a deal status of complete, but no result record names its document: 'not recorded', never 'completed' (the blueprint finished, not the statement analysis)");
      check(state[current.shortRef] === "held", "The current upload, whose own analysis step was held, is 'held' even though its deal's status says complete");
      // A completion record for the EARLIER document completes only the earlier upload, never the current upload's own document.
      await pool.query(`INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details) VALUES ('statement_analysis_complete','deal',$1,'system',$2::jsonb)`,
        [earlier.dealId, JSON.stringify({ documentId: earlier.documentId })]);
      state = await analysisOf(earlier.shortRef, current.shortRef);
      check(state[earlier.shortRef] === "completed" && state[current.shortRef] === "held", "A completion record naming the earlier document completes that upload only, and does not complete the current, held upload");

      // The enqueue failed after the deal was set to 'pending': that upload is 'not queued', never 'queued', and it took over the status.
      const wasQueued = await seedStatement("pv04-wasqueued", { lifecycle: "completed", terminal: null, command: "succeeded", steps: queuedSteps, dealAnalysis: "complete", withDocument: true, minutesAgo: 90 });
      const unqueued = await seedStatement("pv04-unqueued", { lifecycle: "accepted", terminal: null, command: "recoverable_failed", steps: failedEnqueueSteps, withDocument: true, sharedDealId: wasQueued.dealId!, minutesAgo: 10 });
      await pool.query(`UPDATE deals SET analysis_status='pending' WHERE id=$1`, [wasQueued.dealId]);
      state = await analysisOf(wasQueued.shortRef, unqueued.shortRef);
      check(state[unqueued.shortRef] === "not_queued", "An upload whose enqueue failed after the deal was set to 'pending' is 'not queued', never 'queued'");
      check(state[wasQueued.shortRef] === "not_recorded", "The earlier upload, whose deal status a later queue attempt overwrote, is 'not recorded' rather than 'queued' or 'completed'");

      // A document-bound completion is the only thing that completes a upload that no longer owns the deal status.
      const first = await seedStatement("pv04-first", { lifecycle: "completed", terminal: null, command: "succeeded", steps: queuedSteps, dealAnalysis: "processing", withDocument: true, minutesAgo: 90 });
      const second = await seedStatement("pv04-second", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: queuedSteps, withDocument: true, sharedDealId: first.dealId!, minutesAgo: 30 });
      const third = await seedStatement("pv04-third", { lifecycle: "accepted", terminal: null, command: "succeeded", steps: heldSteps, withDocument: true, sharedDealId: first.dealId!, minutesAgo: 5 });
      state = await analysisOf(first.shortRef, second.shortRef, third.shortRef);
      check(state[first.shortRef] === "not_recorded" && state[second.shortRef] === "queued" && state[third.shortRef] === "held",
        "Without a completion record the older queued upload is 'not recorded', the newest queue attempt reports the live status, and the held upload stays 'held'");
      await pool.query(`INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details) VALUES ('statement_analysis_complete','deal',$1,'system',$2::jsonb)`,
        [first.dealId, JSON.stringify({ documentId: first.documentId })]);
      state = await analysisOf(first.shortRef, second.shortRef, third.shortRef);
      check(state[first.shortRef] === "completed" && state[second.shortRef] === "queued" && state[third.shortRef] === "held",
        "A completion record that names the first upload's document completes only that upload, not the newer queued or held ones");

      // Historical or missing association: nothing ties any result to the upload, so none is claimed.
      const historical = await seedStatement("pv04-historical", { lifecycle: "completed", terminal: null, command: "succeeded", steps: null, dealAnalysis: "complete", withDocument: true });
      const reset = await seedStatement("pv04-reset", { lifecycle: "completed", terminal: null, command: "succeeded", steps: queuedSteps, dealAnalysis: "none", withDocument: true });
      state = await analysisOf(historical.shortRef, reset.shortRef);
      check(state[historical.shortRef] === "not_recorded", "A historical upload with no recorded steps on a deal marked complete is 'not recorded', never 'completed'");
      check(state[reset.shortRef] === "not_recorded", "A queued upload whose deal status was reset to none is 'not recorded'");

      // No deal: held for manual review, whatever the owner switch says.
      const noDeal = await analysisOf(held.shortRef, deferred.shortRef);
      check(noDeal[held.shortRef] === "held" && noDeal[deferred.shortRef] === "held", "Uploads with no deal are 'held' for manual review");

      // Both staff consumers read the same per-occurrence answer and carry labels that do not read as complete.
      for (const [ref, expected] of [[current.shortRef, "held"], [unqueued.shortRef, "not_queued"], [wasQueued.shortRef, "not_recorded"], [first.shortRef, "completed"], [historical.shortRef, "not_recorded"]] as const) {
        const list = await (await get("admin", `/api/lead-ops/inbound-requests?ref=${ref}`)).json() as any[];
        const operator = await (await get("admin", "/api/operator/statement-chain?limit=200")).json() as any;
        check(list[0]?.statement?.available === true && list[0].statement.analysis === expected && operator.rows.find((row: any) => row.shortRef === ref)?.analysis === expected,
          `Inbound Operations and the handoff view agree that ${ref} analysis is '${expected}'`);
      }
    });

  // ── WC-PV04: the REAL blueprint-then-analysis worker, with a fake provider transport on loopback ──────
  // runStatementBlueprintJob sets the deal's analysis status to complete when the BLUEPRINT finishes, BEFORE the structured extraction,
  // and an extraction failure never reverts it. These cases drive the real worker, the real analyzer, real retained objects and real audit
  // rows (no hand-assigned deal status), then read the answer back through both staff surfaces.
  await section("WC-PV04 worker-bound analysis", async () => {
    const nodeHttp = await import("node:http");
    const queueManager = await import("../../server/services/queue-manager");
    const protectedObjects = await import("../../server/services/protected-object");
    const deny = await import("../certification-provider-deny");
    const blockedBefore = deny.getBlockedCertificationNetworkAttemptCount();

    const fake = { blueprint: "ok" as "ok" | "error", extraction: "ok" as "ok" | "provider_error" | "garbage" | "empty" | "schema", calls: [] as string[] };
    const validExtraction = { processorName: "Fixture Processor", monthlyVolume: 50000, totalFees: 1500, fixedFees: 10, authFees: 20, batchFees: 5, pciFees: 0, cardMix: { visa: 50 }, topCostDrivers: ["Interchange"] };
    const blueprint = { recommendedProgram: "Fixture program", hardwarePackage: "Fixture terminal", estMonthlyRevenue: "$100", underwritingPath: "standard", competitivePositioning: "Fixture", repBriefing: "Fixture", repOpener: "Fixture", likelyObjections: ["Fixture"], keyFindings: ["Fixture"], riskFlags: [] };
    const provider = nodeHttp.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let model = "unknown";
        try { model = JSON.parse(Buffer.concat(chunks).toString()).model ?? "unknown"; } catch { /* unreadable body */ }
        fake.calls.push(model);
        const reply = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
        const completion = (content: string) => reply(200, { id: "chatcmpl-fixture", object: "chat.completion", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
        // A 400 is not retried by the client library, so a refusal is immediate and deterministic.
        const refuse = () => reply(400, { error: { message: "fixture provider refusal", type: "invalid_request_error" } });
        if (model.startsWith("gpt-4o-mini")) return fake.blueprint === "error" ? refuse() : completion(JSON.stringify(blueprint));
        switch (fake.extraction) {
          case "provider_error": return refuse();
          case "garbage": return completion("this is not json");
          case "empty": return completion("");
          case "schema": return completion(JSON.stringify({ monthlyVolume: -5, totalFees: "not a number" }));
          default: return completion(JSON.stringify(validExtraction));
        }
      });
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", () => resolve()));
    const providerBase = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
    const envKeys = ["AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY", "TEST_MODE", "SKIP_AI"] as const;
    const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    try {
      deny.installCertificationLocalAiConstructorEnvironment();
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = providerBase;
      process.env.OPENAI_BASE_URL = providerBase;
      // The fixture-extraction shortcut would hide the real extraction path, so it must be off for this section.
      delete process.env.TEST_MODE;
      delete process.env.SKIP_AI;

      const workerSteps = [done(4, "File attached"), done(5, "AI analysis queued"), done(6, "Rep notified")];
      const statementText = "Merchant statement fixture. Processor: Fixture Processor. Monthly volume 50000 dollars. Total fees 1500 dollars. Interchange pass-through, assessments and monthly fixed fees listed below.";
      const upload1 = async (label: string, opts: { minutesAgo: number; sharedDealId?: number; text?: string; storageKey?: string }) => {
        const seeded = await seedStatement(label, { lifecycle: "completed", terminal: null, command: "succeeded", steps: workerSteps, dealAnalysis: opts.sharedDealId ? undefined : "pending", sharedDealId: opts.sharedDealId, minutesAgo: opts.minutesAgo });
        const contactId = (await pool.query(`SELECT contact_id FROM deals WHERE id=$1`, [seeded.dealId])).rows[0].contact_id as number;
        await pool.query(`UPDATE inbound_requests SET contact_id=$2 WHERE id=$1`, [seeded.request.id, contactId]);
        const storageKey = opts.storageKey
          ?? (await protectedObjects.putProtectedObject({ bytes: Buffer.from(opts.text ?? statementText), mimeType: "text/plain", fileName: `${label}.txt`, tenantScope: `contact:${contactId}` })).objectRef;
        const documentId = (await pool.query(
          `INSERT INTO documents (contact_id, deal_id, type, category, file_name, storage_key, access_scope, status, created_at)
           VALUES ($1,$2,'merchant_statement','Statements',$3,$4,'internal','active', now() - make_interval(mins => $5::int)) RETURNING id`,
          [contactId, seeded.dealId, `${label}.txt`, storageKey, opts.minutesAgo])).rows[0].id as number;
        await pool.query(`UPDATE statement_upload_commands SET document_id=$2 WHERE request_id=$1`, [seeded.key, documentId]);
        return { ...seeded, dealId: seeded.dealId as number, documentId };
      };
      const run = async (dealId: number) => { await queueManager.runStatementBlueprintJob(dealId); };
      const dealStatus = async (dealId: number) => (await pool.query(`SELECT analysis_status s FROM deals WHERE id=$1`, [dealId])).rows[0].s as string;
      const records = async (dealId: number) => (await pool.query(
        `SELECT action, details FROM audit_logs WHERE entity_type='deal' AND entity_id=$1 AND action IN ('statement_analysis_complete','statement_analysis_failed') ORDER BY id`, [dealId])).rows as Array<{ action: string; details: any }>;
      const surfaces = async (ref: string) => {
        const list = await (await get("admin", `/api/lead-ops/inbound-requests?ref=${ref}`)).json() as any[];
        const operator = await (await get("admin", "/api/operator/statement-chain?limit=200")).json() as any;
        return { inbound: list[0]?.statement?.analysis as string | undefined, handoff: operator.rows.find((row: any) => row.shortRef === ref)?.analysis as string | undefined };
      };
      const agree = async (ref: string, expected: string) => {
        const seen = await surfaces(ref);
        return seen.inbound === expected && seen.handoff === expected;
      };
      const proposalStatus = async (dealId: number) => (await pool.query(`SELECT status FROM statement_proposals WHERE deal_id=$1`, [dealId])).rows[0]?.status as string | undefined;

      // 1. The blueprint finishes, then the structured extraction fails or is unusable: no completion is recorded and neither surface says completed.
      for (const mode of ["provider_error", "garbage", "empty", "schema"] as const) {
        fake.blueprint = "ok"; fake.extraction = mode; fake.calls.length = 0;
        const upload = await upload1(`pv04w-${mode}`, { minutesAgo: 20 });
        await run(upload.dealId);
        const rows = await records(upload.dealId);
        check(await dealStatus(upload.dealId) === "complete" && fake.calls.includes("gpt-4o-mini") && fake.calls.includes("gpt-4o"),
          `[${mode}] The blueprint ran and left the deal status at 'complete' even though the structured extraction then failed (the precondition of the false completion)`);
        check(rows.length === 1 && rows[0].action === "statement_analysis_failed" && String(rows[0].details.documentId) === String(upload.documentId) && await proposalStatus(upload.dealId) === "failed",
          `[${mode}] The analyzer recorded exactly one failure that names the retained document, and no completion record exists`);
        check(await agree(upload.shortRef, "failed"), `[${mode}] Inbound Operations and the handoff view both say 'failed', never 'completed'`);
      }
      // A blueprint that itself failed still leaves the status at complete; a structured failure after it is still the upload's own failure.
      fake.blueprint = "error"; fake.extraction = "provider_error";
      const noBlueprint = await upload1("pv04w-noblueprint", { minutesAgo: 20 });
      await run(noBlueprint.dealId);
      check(await dealStatus(noBlueprint.dealId) === "complete" && await agree(noBlueprint.shortRef, "failed"), "Even when the blueprint produced nothing and the extraction failed, a deal status of complete is not read as a completed analysis");
      fake.blueprint = "ok";

      // 2. A failure that is thrown (not recorded by the analyzer itself) is tagged with the document and recorded by the worker, once.
      fake.extraction = "ok";
      const legacy = await upload1("pv04w-legacy", { minutesAgo: 20, storageKey: "/uploads/legacy/statement.txt" });
      await run(legacy.dealId);
      const legacyRows = await records(legacy.dealId);
      check(legacyRows.length === 1 && legacyRows[0].action === "statement_analysis_failed" && String(legacyRows[0].details.documentId) === String(legacy.documentId) && /LEGACY_LOCAL_PATH_UNRECOVERABLE/.test(String(legacyRows[0].details.error)),
        "A thrown analyzer fault (an unrecoverable legacy file reference) is recorded once by the worker and names the document it was analysing");
      check(await dealStatus(legacy.dealId) === "complete" && await agree(legacy.shortRef, "failed"), "That thrown fault reads as 'failed' on both surfaces while the deal status stays 'complete'");
      const unreadable = await upload1("pv04w-unreadable", { minutesAgo: 20, text: "too short" });
      await run(unreadable.dealId);
      check((await records(unreadable.dealId)).length === 1 && await agree(unreadable.shortRef, "failed"), "A retained file with no readable text is a document-bound failure, never a completion");

      // 3. Genuine success: the analyzer's own result record names the matching document.
      fake.extraction = "ok"; fake.calls.length = 0;
      const genuine = await upload1("pv04w-genuine", { minutesAgo: 20 });
      await run(genuine.dealId);
      const genuineRows = await records(genuine.dealId);
      check(genuineRows.length === 1 && genuineRows[0].action === "statement_analysis_complete" && String(genuineRows[0].details.documentId) === String(genuine.documentId) && await proposalStatus(genuine.dealId) === "analyzed"
        && fake.calls.filter((model) => model === "gpt-4o").length === 1,
        "A successful extraction writes one completion record that names its document, and the transport saw exactly one extraction request");
      check(await agree(genuine.shortRef, "completed"), "A genuine matching-document completion is 'completed' on both surfaces");

      // 4. Latest record for a document wins: a failed run, a retry that succeeds, then a later failure.
      const retry = await upload1("pv04w-retry", { minutesAgo: 20 });
      fake.extraction = "provider_error"; await run(retry.dealId);
      const afterFail = await agree(retry.shortRef, "failed");
      fake.extraction = "ok"; await run(retry.dealId);
      const afterRetry = await agree(retry.shortRef, "completed");
      fake.extraction = "garbage"; await run(retry.dealId);
      const afterLater = await agree(retry.shortRef, "failed");
      check(afterFail && afterRetry && afterLater, "The newest durable outcome for the document decides: failed, then completed after a successful retry, then failed again after a later failed run");

      // 5. Several uploads on one deal, processed out of order. The analyzer always reads the NEWEST retained document, so a late run for
      //    an older upload can never complete that older upload.
      fake.extraction = "ok";
      const older = await upload1("pv04w-older", { minutesAgo: 120 });
      const newer = await upload1("pv04w-newer", { minutesAgo: 30, sharedDealId: older.dealId });
      await pool.query(`UPDATE deals SET analysis_status='pending' WHERE id=$1`, [older.dealId]);
      check(await agree(older.shortRef, "not_recorded") && await agree(newer.shortRef, "queued"), "Before any worker runs, the older upload (status taken over by the newer one) is 'not recorded' and the newest queue attempt is 'queued'");
      await run(older.dealId);
      await run(older.dealId);
      const multiRows = await records(older.dealId);
      check(multiRows.length === 2 && multiRows.every((row) => row.action === "statement_analysis_complete" && String(row.details.documentId) === String(newer.documentId)),
        "Two worker runs (the older upload's job finishing late) both analysed the newest document, so the completion records name only the newer document");
      check(await dealStatus(older.dealId) === "complete" && await agree(newer.shortRef, "completed") && await agree(older.shortRef, "not_recorded"),
        "The newer upload is 'completed'; the older upload, never analysed itself, stays 'not recorded' even though the deal status says complete");

      // 6. An upload analysed first stays completed after a newer upload queues behind it and then fails.
      fake.extraction = "ok";
      const first = await upload1("pv04w-first", { minutesAgo: 60 });
      await run(first.dealId);
      await pool.query(`UPDATE deals SET analysis_status='pending' WHERE id=$1`, [first.dealId]);
      const second = await upload1("pv04w-second", { minutesAgo: 5, sharedDealId: first.dealId });
      check(await agree(first.shortRef, "completed") && await agree(second.shortRef, "queued"), "A completed upload stays 'completed' (bound to its document) while a newer upload on the same deal is 'queued'");
      fake.extraction = "provider_error";
      await run(first.dealId);
      check(await dealStatus(first.dealId) === "complete" && await agree(first.shortRef, "completed") && await agree(second.shortRef, "failed"),
        "When the newer upload's extraction then fails, only the newer upload is 'failed'; the earlier completion is unchanged and the deal status is still 'complete'");

      check(deny.getBlockedCertificationNetworkAttemptCount() === blockedBefore, "The whole worker section reached only the loopback fake transport (no blocked external attempt)");
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      // Lifecycle advancement after an analysis run is fire-and-forget; let it finish before the database is closed.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  // ── WC-RESTORE: a confirmed direct save is retained, restored and replayed without a second occurrence ───────────
  // This runs the REAL shared client library (client/src/lib/public-intake.ts: the code every public form calls) against the REAL public
  // route handlers. Only the browser's globals are supplied: an in-memory session store and a fetch that adds the caller address and can
  // lose an answer AFTER the server processed the request. Mounted-page behavior (reload, Back, Forward, the visible confirmation and the
  // conversion events) is proven by the browser suite; this section proves the identity, replay and exactly-once rules underneath it.
  await section("WC-RESTORE confirmed-save restoration", async () => {
    const g = globalThis as any;
    const store = new Map<string, string>();
    const previous = { window: g.window, document: g.document, fetch: g.fetch };
    const realFetch = g.fetch as typeof fetch;
    const posts: Array<{ path: string; key: string | null }> = [];
    let lose = false;
    // The public lead limiter allows 10 submissions per caller address; every scenario below is a separate visitor.
    let callerIp = nextIp();
    g.window = { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) } };
    g.document = { cookie: "" };
    g.fetch = async (input: any, init: any = {}) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init.headers);
      headers.set("x-forwarded-for", callerIp);
      const method = String(init.method ?? "GET").toUpperCase();
      if (method === "POST") posts.push({ path: raw, key: headers.get("idempotency-key") });
      const response = await realFetch(raw.startsWith("/") ? `${url}${raw}` : raw, { ...init, headers });
      // The server really processed the request; only the answer the page would see is lost.
      if (method === "POST" && lose) { await response.arrayBuffer(); throw new TypeError("Failed to fetch"); }
      return response;
    };
    try {
      const lib = await import("../../client/src/lib/public-intake");
      const slot = (form: string) => `lb:public-intake:${form}`;
      const occurrences = async (keys: Array<string | null>) => count(`SELECT count(*) n FROM inbound_requests WHERE idempotency_key = ANY($1::text[])`, [keys.filter(Boolean)]);
      const forms = [
        { label: "equipment inquiry", form: "equipment_inquiry", path: "/api/public/get-started", pii: [] as string[],
          build: (n: string) => ({ mode: "equipment_inquiry", businessName: `Restore Equip ${tag} ${n}`, name: "Ada Restore", email: `wc-${tag}-restore-equip-${n}@example.com`, businessType: "Restaurant", volumeBand: "under_5000", currentlyLeasing: "no" }) },
        { label: "general inquiry", form: "general_inquiry", path: "/api/public/get-started", pii: [] as string[],
          build: (n: string) => ({ mode: "general_inquiry", businessName: `Restore General ${tag} ${n}`, name: "Gina Restore", email: `wc-${tag}-restore-general-${n}@example.com`, intent: "processing", note: "Restore general note" }) },
        { label: "support request", form: "support", path: "/api/public/support", pii: [] as string[],
          build: (n: string) => ({ name: "Sam Restore", businessName: `Restore Support ${tag} ${n}`, email: `wc-${tag}-restore-support-${n}@example.com`, issueType: "Other", priority: "Normal", message: "Restore support message" }) },
        { label: "callback request", form: "callback_home", path: "/api/public/callback", pii: [] as string[],
          build: (_n: string) => ({ name: "Cal Restore", phone: uniquePhone(), bestTime: "ASAP" }) },
        // The two other callback widgets (the floating bubble and the signed-in help panel) use their own storage slots on the same endpoint.
        { label: "callback bubble", form: "callback_bubble", path: "/api/public/callback", pii: [] as string[],
          build: (_n: string) => ({ name: "Bea Restore", phone: uniquePhone(), bestTime: "ASAP" }) },
        { label: "help-panel callback", form: "callback_help", path: "/api/public/callback", pii: [] as string[],
          build: (_n: string) => ({ name: "Hal Restore", phone: uniquePhone(), bestTime: "ASAP" }) },
      ];
      for (const { label, form, path, build } of forms) {
        store.clear(); posts.length = 0; callerIp = nextIp();
        const payload = build("a");
        const detail = Object.values(payload).filter((v): v is string => typeof v === "string" && v.length > 3);
        const first = await lib.submitPublicIntake(form as any, path, payload);
        if (first.kind !== "saved" || first.fresh !== true) console.log(`[WC-RESTORE] ${label}: unexpected first outcome ${JSON.stringify(first)}`);
        check(first.kind === "saved" && first.fresh === true, `[${label}] A confirmed direct save is reported as a fresh conversion exactly once`);
        if (first.kind !== "saved") continue;
        const kept = lib.loadIntent(form as any);
        check(kept?.state === "saved" && kept.receipt === first.receipt && kept.key === posts[0].key && kept.tracked === true && kept.pendingReview === first.pendingReview,
          `[${label}] The confirmed save is retained (original key, receipt, review state, conversion claimed), not cleared after the answer`);
        const rawStored = store.get(slot(form)) ?? "";
        check(Object.keys(JSON.parse(rawStored)).every((k) => ["key", "fingerprint", "receipt", "state", "pendingReview", "tracked", "thankYouTracked"].includes(k)) && detail.every((v) => !rawStored.includes(v)),
          `[${label}] The retained record holds only identity and state: no name, email, phone, business, note or message`);
        check(await occurrences([first.receipt === kept?.receipt ? posts[0].key : null]) === 1, `[${label}] The first save created exactly one occurrence`);

        // Reload: the same session record restores; submitting the identical details again replays under the ORIGINAL key.
        const replay = await lib.submitPublicIntake(form as any, path, payload);
        check(replay.kind === "saved" && replay.receipt === first.receipt && replay.fresh === false && posts[1].key === posts[0].key && lib.loadIntent(form as any)?.key === kept!.key,
          `[${label}] An identical resubmission after a confirmed save reuses the original key and receipt and is not a fresh conversion`);
        check(await occurrences(posts.map((p) => p.key)) === 1, `[${label}] The replay created no second occurrence`);

        // A replay whose answer is lost does not turn a confirmed save back into an unconfirmed one, or re-arm the conversion.
        lose = true;
        const lostReplay = await lib.submitPublicIntake(form as any, path, payload);
        lose = false;
        check(lostReplay.kind === "unresolved" && lib.loadIntent(form as any)?.state === "saved" && lib.loadIntent(form as any)?.tracked === true, `[${label}] A lost answer on a replay leaves the confirmed save confirmed and its conversion claimed`);
        const afterLost = await lib.submitPublicIntake(form as any, path, payload);
        check(afterLost.kind === "saved" && afterLost.fresh === false && await occurrences(posts.map((p) => p.key)) === 1, `[${label}] The next replay is still not fresh and still one occurrence`);

        // A read-only status check of a confirmed save keeps its identity and does not claim a conversion.
        const read = await lib.checkIntakeStatus(form as any);
        check(read?.saved === true && lib.loadIntent(form as any)?.receipt === first.receipt && lib.loadIntent(form as any)?.key === kept!.key && lib.loadIntent(form as any)?.tracked === true,
          `[${label}] A status read of the confirmed save keeps the original key and receipt`);

        // The explicit "send another" choice: it clears the confirmed save and the same details become exactly one NEW occurrence.
        lib.clearIntent(form as any);
        check(lib.loadIntent(form as any) === null, `[${label}] Starting a new request clears the retained confirmed save`);
        const second = await lib.submitPublicIntake(form as any, path, payload);
        const keys = [...new Set(posts.map((p) => p.key))];
        if (!(second.kind === "saved" && second.fresh === true && keys.length === 2)) console.log(`[WC-RESTORE] ${label}: unexpected new-request outcome ${JSON.stringify(second)} keys=${keys.length} posts=${posts.length}`);
        check(second.kind === "saved" && second.fresh === true && second.receipt !== first.receipt && keys.length === 2 && keys[1] !== keys[0] && await occurrences(keys) === 2,
          `[${label}] A deliberate new request mints one new key and creates exactly one new occurrence, with a new reference and a new conversion`);
        check(lib.loadIntent(form as any)?.key === keys[1] && lib.loadIntent(form as any)?.receipt === second.receipt, `[${label}] The new confirmed save is the one now retained`);

        // A lost answer, then the same details: the one request is finished under its own key, and its conversion is claimed once.
        store.clear(); posts.length = 0; callerIp = nextIp();
        const lostPayload = build("b");
        lose = true;
        const lost = await lib.submitPublicIntake(form as any, path, lostPayload);
        lose = false;
        const lostKey = posts[0].key;
        check(lost.kind === "unresolved" && lib.loadIntent(form as any)?.state === "unresolved" && lib.loadIntent(form as any)?.key === lostKey && await occurrences([lostKey]) === 1,
          `[${label}] A lost answer is unconfirmed, keeps its key, and the server really saved one occurrence`);
        const finished = await lib.submitPublicIntake(form as any, path, lostPayload);
        check(finished.kind === "saved" && finished.fresh === true && posts[1].key === lostKey && await occurrences([lostKey]) === 1 && lib.loadIntent(form as any)?.state === "saved",
          `[${label}] The same details finish that request under the same key: still one occurrence, and the conversion is claimed now, once`);
        const again = await lib.submitPublicIntake(form as any, path, lostPayload);
        check(again.kind === "saved" && again.fresh === false && await occurrences([lostKey]) === 1, `[${label}] A further replay is not a second conversion and not a second occurrence`);
      }

      // The thank-you page view that follows a confirmed save is claimed once per saved request.
      store.clear(); posts.length = 0; callerIp = nextIp();
      const supportPayload = forms[2].build("thanks");
      const saved = await lib.submitPublicIntake("support" as any, "/api/public/support", supportPayload);
      check(saved.kind === "saved" && lib.claimThankYouView("support" as any) === true && lib.claimThankYouView("support" as any) === false && lib.claimThankYouView("support" as any) === false,
        "The thank-you page view after a confirmed save is claimed once: a reload, Back or Forward to it adds none");
      check(lib.loadIntent("support" as any)?.thankYouTracked === true && lib.loadIntent("support" as any)?.receipt === (saved.kind === "saved" ? saved.receipt : null), "The thank-you claim is kept on the same retained record, with the original receipt");
      const replayAfterThanks = await lib.submitPublicIntake("support" as any, "/api/public/support", supportPayload);
      check(replayAfterThanks.kind === "saved" && lib.claimThankYouView("support" as any) === false, "A replay of the confirmed save does not re-arm the thank-you page view");
      lib.clearIntent("support" as any);
      check(lib.claimThankYouView("support" as any) === true, "With no confirmed save retained (a direct visit), the thank-you page view is claimed as it was before");
    } finally {
      for (const key of ["window", "document", "fetch"] as const) {
        if (previous[key] === undefined) delete g[key];
        else g[key] = previous[key];
      }
    }
  });

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

if (sectionFailures.length) {
  console.error(`\nPublic W-C intake certification FAILED (${checks} checks passed before/around ${sectionFailures.length} failed section(s)):`);
  for (const failure of sectionFailures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`\nPublic W-C intake certification: ${checks} checks passed`);
process.exit(0);
