#!/usr/bin/env tsx
/**
 * Website email lifecycle: pure contract certification (no database, Redis, network or provider transport).
 *
 * Covers the pure halves of E01 (consent contract), E02 (frozen policy), E05 (scoped authority), E07 (sender and MIME),
 * E08 (outcome classification), E09 (mailbox classification) and E10 (stop predicate), plus the CR-06 invariants.
 * Every positive assertion has a negative control that fails when the guarded behavior is removed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROGRAM_PURPOSE,
  WARM_CAPABLE_MANIFEST_VERSIONS,
  WEBSITE_LANE_SOURCE_PROGRAMS,
  buildEmailOnlySteps,
  classifyGmailFailure,
  classifyMailboxMessage,
  cr06DecisionForProgram,
  decideWarmStop,
  decideWebsiteWarmAdmission,
  deriveRfcMessageId,
  emailTokenHash,
  extractAddress,
  hashLaneConfig,
  hashWarmSnapshot,
  isHeldReason,
  mailboxEvidenceHash,
  resolveEmailConsentSubmission,
  validateSourceProgramMap,
  validateWarmSnapshot,
  warmCapacityScope,
  warmIdempotencyKey,
  warmStopWhereSql,
  websiteDisclosureHash,
  type MailboxMessageHeaders,
  type WarmAdmissionFacts,
  type WarmProgram,
  type WarmSnapshot,
} from "../server/services/website-email-contracts";
import { WEBSITE_EMAIL_DISCLOSURES, disclosureForSurface } from "../shared/website-email-disclosures";
import { MimeError, buildGmailMime, encodeHeaderValue, encodeQuotedPrintable, htmlToPlainText } from "../server/services/gmail-mime";
import { NON_COLD_GMAIL_SENDER_CATEGORY, resolvePolicy } from "../server/services/sender-policy";
import { decideCr06PromotionalLifecycle } from "../server/services/cr06-promotional-lifecycle-decision";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log(`PASS [${String(checks).padStart(3, "0")}] ${name}`);
}
const throwsWith = (fn: () => unknown, code: string) => {
  assert.throws(fn, (err: unknown) => err instanceof MimeError && err.message.includes(code) || (err as { code?: string }).code === code);
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const NOW = new Date("2026-11-08T15:00:00Z");
const RECEIVED = new Date("2026-11-08T14:00:00Z");
const STARTS = new Date("2026-11-08T12:00:00Z");

function snapshotFor(program: WarmProgram): WarmSnapshot {
  return {
    version: 1,
    program,
    purpose: PROGRAM_PURPOSE[program].warm,
    allowedChannels: ["email"],
    steps: [
      { order: 0, channel: "email", delayMinutes: 0, subject: "Thanks for reaching out", bodyHtml: "<p>Hello</p>" },
      { order: 1, channel: "email", delayMinutes: 2880, subject: "A quick follow-up", bodyHtml: "<p>Checking in</p>" },
    ],
    sourceSequence: { id: null, name: null },
  };
}

function facts(program: WarmProgram, over: Partial<WarmAdmissionFacts> = {}): WarmAdmissionFacts {
  const snapshot = snapshotFor(program);
  const hash = hashWarmSnapshot(snapshot);
  const source = "website_form|estimate_form";
  return {
    boundary: "creation",
    program,
    request: { sourceCategory: "website_form", sourceType: "estimate_form", manifestVersion: "cro05a-v3", receivedAt: RECEIVED, submittedEmailHash: emailTokenHash("owner@example.com") },
    config: {
      id: 7, revision: 3, status: "open", sourceProgramMap: { [source]: { [program]: 11 } },
      senderCategory: "accounts", senderAccount: "scott@libertybancard.com", eligibilityStartsAt: STARTS, dailyLimit: 25,
    },
    warmRevision: { id: 11, program, state: "approved", snapshot, snapshotHash: hash, unsupportedStepCount: 0 },
    contact: { id: 5, email: "owner@example.com", emailGeneration: 2, recordClass: "production" },
    consent: { emailState: program === "nurture" ? "permitted" : "unknown", optInForThisOccurrence: program === "nurture" },
    sender: { category: "accounts", replyPathProven: true },
    ledgerReady: true,
    admission: null,
    heldSince: null,
    now: NOW,
    ...over,
  };
}

function admission(program: WarmProgram, over: Record<string, unknown> = {}) {
  const f = facts(program);
  return {
    state: "active", channel: "email", program, warmRevisionId: 11, warmRevisionHash: f.warmRevision!.snapshotHash,
    emailTokenHash: emailTokenHash("owner@example.com")!, emailGeneration: 2, ...over,
  } as NonNullable<WarmAdmissionFacts["admission"]>;
}

const refusal = (f: WarmAdmissionFacts) => {
  const d = decideWebsiteWarmAdmission(f);
  assert.equal(d.allowed, false, "expected refusal");
  return d as { allowed: false; reason: string; held: boolean };
};

// ── CR-06 invariants (unchanged by the lane) ────────────────────────────────
check("CR-06 dispatch constant is exported false and untouched", () => {
  const src = readFileSync("server/services/cr06-premium-campaigns.ts", "utf8");
  assert.match(src, /export const CR06_DISPATCH_AVAILABLE = false;/);
  assert.doesNotMatch(src, /CR06_DISPATCH_AVAILABLE\s*=\s*true/);
});
check("pure CR-06 decision still refuses promotional, unknown and malformed purposes", () => {
  assert.equal(decideCr06PromotionalLifecycle({ boundary: "sequence_transport" }).allowed, false);
  assert.equal(decideCr06PromotionalLifecycle({ boundary: "sequence_transport", purpose: "promotional" }).allowed, false);
  assert.equal(decideCr06PromotionalLifecycle({ boundary: "queue_runner", purpose: "bogus" as never }).allowed, false);
  assert.equal(decideCr06PromotionalLifecycle({ boundary: "queue_runner", purpose: "" as never }).allowed, false);
});
check("nurture is never relabeled: CR-06 still refuses its classification; follow-up keeps human_response", () => {
  assert.equal(PROGRAM_PURPOSE.nurture.cr06, "promotional");
  assert.equal(PROGRAM_PURPOSE.nurture.warm, "promotional");
  assert.equal(PROGRAM_PURPOSE.nurture.transport, "marketing_outreach");
  assert.equal(cr06DecisionForProgram("nurture").allowed, false);
  assert.equal(PROGRAM_PURPOSE.requested_followup.cr06, "human_response");
  assert.equal(cr06DecisionForProgram("requested_followup").allowed, true);
  assert.notEqual(PROGRAM_PURPOSE.nurture.cr06, "transactional");
  assert.notEqual(PROGRAM_PURPOSE.nurture.cr06, "human_response");
});

// ── E01: consent submission contract ────────────────────────────────────────
check("E01 unchecked, omitted or null email checkbox records nothing (no grant, no withdrawal)", () => {
  for (const body of [{}, { emailMarketingOptIn: false }, { emailMarketingOptIn: null }, { emailMarketingOptIn: undefined, emailDisclosureId: "website_email_marketing@1" }, { emailMarketingOptIn: false, emailDisclosureId: "website_email_marketing@1" }]) {
    assert.deepEqual(resolveEmailConsentSubmission("estimate_form", body), { kind: "not_given" });
  }
});
check("E01 checked box needs a supported disclosure for that exact surface; wording comes from the server", () => {
  for (const [surface, id] of [["estimate_form", "website_email_marketing@1"], ["get_started_form", "website_email_marketing@1"], ["free_analysis", "website_email_marketing@1"], ["newsletter_signup", "newsletter_email_marketing@1"]] as const) {
    const r = resolveEmailConsentSubmission(surface, { emailMarketingOptIn: true, emailDisclosureId: id });
    assert.equal(r.kind, "granted", `${surface} grants with its own disclosure`);
    if (r.kind === "granted") assert.equal(r.disclosureHash, websiteDisclosureHash(r.disclosure));
  }
  const bad = (surface: string, body: Record<string, unknown>) => (resolveEmailConsentSubmission(surface, body) as { reason?: string }).reason;
  assert.equal(bad("estimate_form", { emailMarketingOptIn: true }), "EMAIL_DISCLOSURE_MISSING");
  assert.equal(bad("estimate_form", { emailMarketingOptIn: true, emailDisclosureId: "" }), "EMAIL_DISCLOSURE_MISSING");
  assert.equal(bad("estimate_form", { emailMarketingOptIn: true, emailDisclosureId: "made_up@9" }), "EMAIL_DISCLOSURE_UNSUPPORTED");
  assert.equal(bad("estimate_form", { emailMarketingOptIn: true, emailDisclosureId: 7 }), "EMAIL_DISCLOSURE_UNSUPPORTED");
  assert.equal(bad("estimate_form", { emailMarketingOptIn: true, emailDisclosureId: "newsletter_email_marketing@1" }), "EMAIL_DISCLOSURE_SURFACE_MISMATCH");
  assert.equal(bad("newsletter_signup", { emailMarketingOptIn: true, emailDisclosureId: "website_email_marketing@1" }), "EMAIL_DISCLOSURE_SURFACE_MISMATCH");
  for (const nonBoolean of ["true", 1, "yes", {}, []]) assert.equal(bad("estimate_form", { emailMarketingOptIn: nonBoolean, emailDisclosureId: "website_email_marketing@1" }), "EMAIL_CONSENT_NOT_BOOLEAN");
});
check("E01 browser-supplied wording, hash or timestamps never reach the recorded evidence", () => {
  const r = resolveEmailConsentSubmission("estimate_form", {
    emailMarketingOptIn: true, emailDisclosureId: "website_email_marketing@1", emailDisclosureText: "I agree to everything", emailDisclosureHash: "f".repeat(64), consentedAt: "1999-01-01",
  } as never);
  assert.equal(r.kind, "granted");
  if (r.kind === "granted") {
    assert.notEqual(r.disclosureHash, "f".repeat(64));
    assert.ok(!JSON.stringify(r).includes("I agree to everything"));
  }
});
check("E01 disclosure registry is versioned, separate per surface family, and never mentions SMS or phone", () => {
  assert.ok(WEBSITE_EMAIL_DISCLOSURES.length >= 2);
  const ids = new Set(WEBSITE_EMAIL_DISCLOSURES.map((d) => d.id));
  assert.equal(ids.size, WEBSITE_EMAIL_DISCLOSURES.length);
  for (const d of WEBSITE_EMAIL_DISCLOSURES) {
    assert.match(d.id, /@\d+$/);
    assert.doesNotMatch(`${d.label} ${d.helper}`, /\b(sms|text message|phone|call)\b/i);
    assert.match(`${d.label} ${d.helper}`, /unsubscribe/i);
  }
  assert.equal(disclosureForSurface("newsletter_signup")?.key, "newsletter_email_marketing");
  assert.equal(disclosureForSurface("estimate_form")?.key, "website_email_marketing");
  assert.equal(disclosureForSurface("contact_support"), null);
});
check("E01 source matrix: only the four website sources reach the lane; support, privacy, statement, PDF, phone-only and callback do not", () => {
  assert.deepEqual(Object.keys(WEBSITE_LANE_SOURCE_PROGRAMS).sort(), [
    "website_form|estimate_form", "website_form|free_analysis", "website_form|get_started_form", "website_form|newsletter_signup",
  ]);
  assert.deepEqual(WEBSITE_LANE_SOURCE_PROGRAMS["website_form|newsletter_signup"], ["nurture"]);
  for (const [category, type] of [["website_form", "contact_support"], ["website_form", "privacy_request"], ["website_form", "statement_upload"], ["website_form", "pdf_download"], ["website_form", "callback_request"], ["phone", "inbound_call"], ["ghl", "workflow"]]) {
    const f = facts("requested_followup", { request: { sourceCategory: category, sourceType: type, manifestVersion: "cro05a-v3", receivedAt: RECEIVED, submittedEmailHash: emailTokenHash("owner@example.com") } });
    assert.equal(refusal(f).reason, "SOURCE_NOT_IN_LANE", `${category}|${type}`);
  }
  const newsletterFollowup = facts("requested_followup", { request: { sourceCategory: "website_form", sourceType: "newsletter_signup", manifestVersion: "cro05a-v3", receivedAt: RECEIVED, submittedEmailHash: emailTokenHash("owner@example.com") } });
  assert.equal(refusal(newsletterFollowup).reason, "SOURCE_NOT_IN_LANE", "a newsletter signup is never a requested service follow-up");
});

// ── E02: frozen policy replay ───────────────────────────────────────────────
check("E02 an occurrence frozen under an older inbound contract never gains a warm effect", () => {
  assert.deepEqual([...WARM_CAPABLE_MANIFEST_VERSIONS], ["cro05a-v3"]);
  for (const version of ["cro05a-v2", "cro05a-v1", "", "cro05a-v4"]) {
    const f = facts("nurture", { request: { sourceCategory: "website_form", sourceType: "estimate_form", manifestVersion: version, receivedAt: RECEIVED, submittedEmailHash: emailTokenHash("owner@example.com") } });
    assert.equal(refusal(f).reason, "FROZEN_POLICY_NO_WARM_EFFECT", version || "(empty)");
    assert.equal(refusal(f).held, false, "a frozen policy is terminal, not held");
  }
  assert.equal(decideWebsiteWarmAdmission(facts("nurture")).allowed, true, "negative control: the current contract is admitted");
});

// ── E05: scoped authority ───────────────────────────────────────────────────
check("E05 a fully valid request is admitted with explicit purpose, revision, hash and consent basis", () => {
  const nurture = decideWebsiteWarmAdmission(facts("nurture"));
  assert.ok(nurture.allowed);
  if (nurture.allowed) {
    assert.equal(nurture.consentBasis, "email_marketing_opt_in");
    assert.equal(nurture.purpose.warm, "promotional");
    assert.equal(nurture.warmRevisionId, 11);
    assert.equal(nurture.emailGeneration, 2);
    assert.equal(nurture.emailTokenHash, emailTokenHash("owner@example.com"));
  }
  const follow = decideWebsiteWarmAdmission(facts("requested_followup"));
  assert.ok(follow.allowed);
  if (follow.allowed) {
    assert.equal(follow.consentBasis, "request_specific");
    assert.equal(follow.purpose.warm, "human_response");
  }
});
check("E05 forged or unknown program refuses before anything else", () => {
  for (const program of ["promotional", "transactional", "marketing", "", null, undefined, 7, {}, ["nurture"]]) {
    assert.equal(refusal(facts("nurture", { program })).reason, "PROGRAM_INVALID");
  }
});
check("E05 configuration missing, closed, revoked or malformed holds or refuses with no admission", () => {
  assert.deepEqual(pick(refusal(facts("nurture", { config: null }))), { reason: "CONFIG_MISSING", held: true });
  const base = facts("nurture").config!;
  assert.deepEqual(pick(refusal(facts("nurture", { config: { ...base, status: "closed" } }))), { reason: "CONFIG_CLOSED", held: true });
  assert.deepEqual(pick(refusal(facts("nurture", { config: { ...base, status: "revoked" } }))), { reason: "CONFIG_REVOKED", held: false });
  assert.deepEqual(pick(refusal(facts("nurture", { config: { ...base, status: "OPEN" } }))), { reason: "CONFIG_MALFORMED", held: false });
  assert.deepEqual(pick(refusal(facts("nurture", { config: { ...base, sourceProgramMap: {} } }))), { reason: "PROGRAM_NOT_MAPPED", held: false });
  assert.equal(refusal(facts("nurture", { config: { ...base, sourceProgramMap: [] } })).reason, "PROGRAM_NOT_MAPPED");
  assert.equal(refusal(facts("nurture", { config: { ...base, eligibilityStartsAt: null } })).reason, "BEFORE_ELIGIBILITY_START");
});
function pick(d: { reason: string; held: boolean }) { return { reason: d.reason, held: d.held }; }

check("E05 warm revision must be the mapped, approved, supported, hash-verified revision", () => {
  const f = facts("nurture");
  const rev = f.warmRevision!;
  assert.equal(refusal({ ...f, warmRevision: null }).reason, "WARM_REVISION_MISSING");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, id: 12 } }).reason, "WARM_REVISION_MISSING", "a revision other than the mapped one is not trusted");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, state: "inactive" } }).reason, "WARM_REVISION_NOT_APPROVED");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, state: "retired" } }).reason, "WARM_REVISION_RETIRED");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, program: "requested_followup" } }).reason, "WARM_REVISION_PROGRAM_MISMATCH");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, unsupportedStepCount: 1 } }).reason, "WARM_REVISION_INVALID");
  assert.equal(refusal({ ...f, warmRevision: { ...rev, snapshot: { ...(rev.snapshot as object), version: 2 } } }).reason, "WARM_REVISION_INVALID");
  const tampered = { ...snapshotFor("nurture"), steps: [{ ...snapshotFor("nurture").steps[0], subject: "Edited after approval" }, snapshotFor("nurture").steps[1]] };
  assert.deepEqual(pick(refusal({ ...f, warmRevision: { ...rev, snapshot: tampered } })), { reason: "WARM_REVISION_HASH_DRIFT", held: true });
  assert.equal(refusal({ ...f, warmRevision: { ...rev, snapshotHash: "0".repeat(64) } }).reason, "WARM_REVISION_HASH_DRIFT");
});
check("E05 request before the eligibility start is terminal (no backdating, no catch-up); old held intents expire", () => {
  const f = facts("nurture");
  const early = refusal({ ...f, request: { ...f.request!, receivedAt: new Date(STARTS.getTime() - 1) } });
  assert.deepEqual(pick(early), { reason: "BEFORE_ELIGIBILITY_START", held: false });
  assert.equal(decideWebsiteWarmAdmission({ ...f, request: { ...f.request!, receivedAt: STARTS } }).allowed, true, "boundary instant is eligible");
  const stale = refusal({ ...f, heldSince: new Date(NOW.getTime() - 73 * 3600_000) });
  assert.deepEqual(pick(stale), { reason: "HELD_TOO_LONG", held: false });
  assert.equal(decideWebsiteWarmAdmission({ ...f, heldSince: new Date(NOW.getTime() - 71 * 3600_000) }).allowed, true);
});
check("E05 contact, address and consent bindings", () => {
  const f = facts("nurture");
  assert.equal(refusal({ ...f, contact: null }).reason, "CONTACT_MISSING");
  assert.equal(refusal({ ...f, contact: { ...f.contact!, email: null } }).reason, "EMAIL_MISSING");
  assert.equal(refusal({ ...f, contact: { ...f.contact!, email: "  " } }).reason, "EMAIL_MISSING");
  assert.equal(refusal({ ...f, contact: { ...f.contact!, emailGeneration: null } }).reason, "EMAIL_MISSING");
  assert.equal(refusal({ ...f, consent: { emailState: "withdrawn", optInForThisOccurrence: true } }).reason, "CONSENT_WITHDRAWN");
  assert.equal(refusal({ ...f, consent: { emailState: "suppressed", optInForThisOccurrence: true } }).reason, "CONSENT_WITHDRAWN");
  assert.equal(refusal({ ...f, consent: { emailState: "unavailable", optInForThisOccurrence: true } }).reason, "CONSENT_MISSING");
  assert.equal(refusal({ ...f, consent: { emailState: "unknown", optInForThisOccurrence: true } }).reason, "CONSENT_MISSING");
  assert.equal(refusal({ ...f, consent: { emailState: "permitted", optInForThisOccurrence: false } }).reason, "CONSENT_MISSING", "an older permission without THIS occurrence's opt-in is not enough for nurture");
  const fu = facts("requested_followup");
  assert.equal(decideWebsiteWarmAdmission({ ...fu, consent: { emailState: "unknown", optInForThisOccurrence: false } }).allowed, true, "a requested follow-up rides on the request, not on marketing consent");
  assert.equal(refusal({ ...fu, consent: { emailState: "withdrawn", optInForThisOccurrence: false } }).reason, "CONSENT_WITHDRAWN", "withdrawal beats the request for both programs");
  assert.equal(refusal({ ...fu, consent: { emailState: "unavailable", optInForThisOccurrence: false } }).reason, "CONSENT_MISSING", "unavailable consent evidence is never read as permission");
});
check("E04 a contact whose address changed after intake is a different recipient; an occurrence that carried no address admits nothing", () => {
  for (const program of ["nurture", "requested_followup"] as const) {
    const f = facts(program);
    assert.equal(decideWebsiteWarmAdmission(f).allowed, true, "negative control: the typed address still matches");
    assert.equal(refusal({ ...f, request: { ...f.request!, submittedEmailHash: emailTokenHash("older-address@example.com") } }).reason, "EMAIL_CHANGED");
    assert.equal(refusal({ ...f, request: { ...f.request!, submittedEmailHash: null } }).reason, "EMAIL_MISSING");
    assert.equal(decideWebsiteWarmAdmission({ ...f, request: { ...f.request!, submittedEmailHash: emailTokenHash("  OWNER@example.com ") } }).allowed, true, "normalization: whitespace and case do not turn a real match into a change");
  }
});
check("E05 record class: unknown holds for review for BOTH programs; test and archived are terminal; nothing promotes", () => {
  for (const program of ["nurture", "requested_followup"] as const) {
    const f = facts(program);
    assert.deepEqual(pick(refusal({ ...f, contact: { ...f.contact!, recordClass: "unknown" } })), { reason: "CLASS_REVIEW_PENDING", held: true });
    for (const cls of ["test", "archived", "internal", ""]) assert.deepEqual(pick(refusal({ ...f, contact: { ...f.contact!, recordClass: cls } })), { reason: "CLASS_NOT_PRODUCTION", held: false }, cls || "(empty)");
  }
});
check("E05 sender must be the non-cold reply-proven identity", () => {
  const f = facts("nurture");
  assert.equal(refusal({ ...f, sender: null }).reason, "SENDER_UNAVAILABLE");
  assert.equal(refusal({ ...f, sender: { category: "cold_outreach", replyPathProven: true } }).reason, "SENDER_UNAVAILABLE");
  assert.deepEqual(pick(refusal({ ...f, sender: { category: "accounts", replyPathProven: false } })), { reason: "SENDER_REPLY_PATH_UNPROVEN", held: true });
});
check("E05 a ledger that cannot record Gmail refuses at every boundary and never reads as ready by omission", () => {
  for (const boundary of ["creation", "claim", "before_io"] as const) {
    const base = facts("nurture", { boundary, ...(boundary === "creation" ? {} : { admission: admission("nurture") }) });
    assert.equal(decideWebsiteWarmAdmission(base).allowed, true, `${boundary} negative control: a ready ledger is admitted`);
    assert.deepEqual(pick(refusal({ ...base, ledgerReady: false })), { reason: "PROVIDER_LEDGER_NOT_READY", held: true }, `${boundary} ledger not ready`);
    assert.equal(refusal({ ...base, ledgerReady: undefined as never }).reason, "PROVIDER_LEDGER_NOT_READY", `${boundary} a missing ledger fact is never read as ready`);
  }
  const follow = facts("requested_followup");
  assert.equal(refusal({ ...follow, ledgerReady: false }).reason, "PROVIDER_LEDGER_NOT_READY", "the human-response program needs a recordable ledger too");
});
check("E05 claim and before-I/O boundaries re-bind the admission to the live address, revision, hash, channel and state", () => {
  for (const boundary of ["claim", "before_io"] as const) {
    const f = facts("nurture", { boundary });
    assert.equal(refusal(f).reason, "ADMISSION_MISSING", `${boundary} without an admission`);
    assert.equal(decideWebsiteWarmAdmission({ ...f, admission: admission("nurture") }).allowed, true, `${boundary} negative control`);
    assert.equal(refusal({ ...f, admission: admission("nurture", { state: "revoked" }) }).reason, "ADMISSION_REVOKED");
    assert.equal(refusal({ ...f, admission: admission("nurture", { state: "completed" }) }).reason, "ADMISSION_REVOKED");
    assert.equal(refusal({ ...f, admission: admission("nurture", { channel: "sms" }) }).reason, "CHANNEL_NOT_EMAIL");
    assert.equal(refusal({ ...f, admission: admission("nurture", { program: "requested_followup" }) }).reason, "ADMISSION_BINDING_MISMATCH");
    assert.equal(refusal({ ...f, admission: admission("nurture", { warmRevisionId: 99 }) }).reason, "ADMISSION_BINDING_MISMATCH");
    assert.equal(refusal({ ...f, admission: admission("nurture", { warmRevisionHash: "a".repeat(64) }) }).reason, "WARM_REVISION_HASH_DRIFT");
    assert.equal(refusal({ ...f, admission: admission("nurture", { emailTokenHash: emailTokenHash("someone-else@example.com")! }) }).reason, "EMAIL_CHANGED");
    assert.equal(refusal({ ...f, admission: admission("nurture", { emailGeneration: 1 }) }).reason, "EMAIL_CHANGED", "a changed or merged address generation never rides an old admission");
  }
});
check("E05 held reasons are exactly the recoverable ones; every other reason is terminal", () => {
  const held = ["CONFIG_MISSING", "CONFIG_CLOSED", "WARM_REVISION_NOT_APPROVED", "WARM_REVISION_HASH_DRIFT", "CLASS_REVIEW_PENDING", "SENDER_REPLY_PATH_UNPROVEN", "SENDER_UNAVAILABLE", "PROVIDER_LEDGER_NOT_READY", "ENROLLMENT_CONFLICT_ACTIVE", "ENROLLMENT_CONFLICT_PAUSED"];
  for (const r of held) assert.equal(isHeldReason(r as never), true, r);
  for (const r of ["CONFIG_REVOKED", "CONSENT_WITHDRAWN", "CLASS_NOT_PRODUCTION", "EMAIL_CHANGED", "BEFORE_ELIGIBILITY_START", "PRIOR_JOURNEY_EXISTS", "SOURCE_NOT_IN_LANE"]) assert.equal(isHeldReason(r as never), false, r);
});
check("E05 lane configuration validation: only lane sources and their allowed programs map to positive integer revisions", () => {
  assert.deepEqual(validateSourceProgramMap({ "website_form|estimate_form": { nurture: 3, requested_followup: 4 } }), { ok: true });
  assert.deepEqual(validateSourceProgramMap({}), { ok: true });
  assert.equal((validateSourceProgramMap({ "website_form|newsletter_signup": { requested_followup: 3 } }) as { reason: string }).reason.startsWith("PROGRAM_NOT_ALLOWED_FOR_SOURCE"), true);
  assert.equal((validateSourceProgramMap({ "sfp|cold": { nurture: 3 } }) as { reason: string }).reason.startsWith("SOURCE_NOT_IN_LANE"), true);
  assert.equal((validateSourceProgramMap({ "website_form|estimate_form": { nurture: 0 } }) as { reason: string }).reason.startsWith("MAP_REVISION_ID_INVALID"), true);
  assert.equal((validateSourceProgramMap({ "website_form|estimate_form": { nurture: 1.5 } }) as { reason: string }).reason.startsWith("MAP_REVISION_ID_INVALID"), true);
  assert.equal((validateSourceProgramMap({ "website_form|estimate_form": { nurture: "3" } }) as { reason: string }).reason.startsWith("MAP_REVISION_ID_INVALID"), true);
  assert.equal(validateSourceProgramMap(null).ok, false);
  assert.equal(validateSourceProgramMap([]).ok, false);
  const a = hashLaneConfig({ status: "closed", sourceProgramMap: {}, senderCategory: "accounts", senderAccount: null, eligibilityStartsAt: null, dailyLimit: 0 });
  const b = hashLaneConfig({ status: "open", sourceProgramMap: {}, senderCategory: "accounts", senderAccount: null, eligibilityStartsAt: null, dailyLimit: 0 });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(hashLaneConfig({ dailyLimit: 0, senderAccount: null, senderCategory: "accounts", sourceProgramMap: {}, status: "closed", eligibilityStartsAt: null }), a, "key order does not change the hash");
});

// ── Immutable warm revision and email-only mask ─────────────────────────────
check("warm revision: non-email steps are reported unsupported, never silently skipped; waits only add delay", () => {
  const out = buildEmailOnlySteps([
    { stepOrder: 3, actionType: "email", delayDays: 2, subject: "Second", body: "<p>b</p>" },
    { stepOrder: 1, actionType: "email", delayDays: 0, subject: "First", body: "<p>a</p>" },
    { stepOrder: 2, actionType: "sms", body: "text" },
    { stepOrder: 4, actionType: "wait", delayHours: 5 },
    { stepOrder: 5, actionType: "email", delayHours: 1, subject: "Third", body: "<p>c</p>" },
    { stepOrder: 6, actionType: "workflow" },
    { stepOrder: 7, actionType: "email", subject: "", body: "<p>empty subject</p>" },
  ]);
  assert.deepEqual(out.steps.map((s) => [s.order, s.subject, s.delayMinutes]), [[0, "First", 0], [1, "Second", 2880], [2, "Third", 360]]);
  assert.deepEqual(out.unsupported.map((u) => [u.stepOrder, u.reason]), [[2, "NON_EMAIL_STEP"], [6, "UNSUPPORTED_STEP_TYPE"], [7, "EMAIL_STEP_WITHOUT_CONTENT"]]);
});
check("warm revision snapshot validation and hashing are strict and key-order independent", () => {
  const s = snapshotFor("nurture");
  assert.equal(validateWarmSnapshot(s).ok, true);
  assert.equal(hashWarmSnapshot(s), hashWarmSnapshot(JSON.parse(JSON.stringify({ steps: s.steps, sourceSequence: s.sourceSequence, purpose: s.purpose, program: s.program, version: s.version, allowedChannels: s.allowedChannels }))));
  assert.notEqual(hashWarmSnapshot(s), hashWarmSnapshot({ ...s, steps: [s.steps[0]] }));
  const reason = (v: unknown) => (validateWarmSnapshot(v) as { reason?: string }).reason;
  assert.equal(reason(null), "SNAPSHOT_MALFORMED");
  assert.equal(reason({ ...s, version: 2 }), "SNAPSHOT_VERSION_UNSUPPORTED");
  assert.equal(reason({ ...s, program: "other" }), "SNAPSHOT_PROGRAM_INVALID");
  assert.equal(reason({ ...s, purpose: "human_response" }), "SNAPSHOT_PURPOSE_MISMATCH", "a nurture snapshot cannot claim a human-response purpose");
  assert.equal(reason({ ...s, allowedChannels: ["email", "sms"] }), "SNAPSHOT_CHANNEL_MASK_INVALID");
  assert.equal(reason({ ...s, steps: [] }), "SNAPSHOT_HAS_NO_STEPS");
  assert.equal(reason({ ...s, steps: [{ ...s.steps[0], channel: "sms" }] }), "SNAPSHOT_STEP_INVALID");
  assert.equal(reason({ ...s, steps: [{ ...s.steps[0], order: 1 }] }), "SNAPSHOT_STEP_INVALID");
  assert.equal(reason({ ...s, steps: [{ ...s.steps[0], delayMinutes: -1 }] }), "SNAPSHOT_STEP_DELAY_INVALID");
  assert.equal(reason({ ...s, steps: [{ ...s.steps[0], subject: " " }] }), "SNAPSHOT_STEP_CONTENT_MISSING");
});

// ── E07: sender policy and MIME ─────────────────────────────────────────────
check("E07 the non-cold Gmail category is registered, never cold, and the old category fails closed", () => {
  assert.equal(NON_COLD_GMAIL_SENDER_CATEGORY, "accounts");
  const policy = resolvePolicy(NON_COLD_GMAIL_SENDER_CATEGORY);
  assert.match(policy.from, /@libertybancard\.com$/);
  assert.doesNotMatch(policy.from, /^scott@mail\./i, "never the dedicated cold mailbox");
  assert.throws(() => resolvePolicy("department_accounts" as never), /no policy registered/, "negative control: the previous unregistered category still throws");
});
check("E07 sequence worker no longer passes an unregistered Gmail category", () => {
  const src = readFileSync("server/services/sequence-worker.ts", "utf8");
  assert.doesNotMatch(src, /department_accounts/);
  assert.match(src, /category: NON_COLD_GMAIL_SENDER_CATEGORY/);
});

function decodeQuotedPrintable(qp: string): string {
  const joined = qp.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9A-F]{2}$/.test(joined.slice(i + 1, i + 3))) { bytes.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(joined[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}
function part(mime: string, type: string): { headers: string; body: string } {
  const boundary = /boundary="([^"]+)"/.exec(mime)![1];
  const segment = mime.split(`--${boundary}`).find((s) => s.includes(`Content-Type: ${type}`))!;
  const [headers, ...rest] = segment.replace(/^\r\n/, "").split("\r\n\r\n");
  return { headers, body: rest.join("\r\n\r\n").replace(/\r\n$/, "") };
}
const MESSAGE_ID = deriveRfcMessageId(warmIdempotencyKey(41, 0));

check("E07 MIME: real From, Reply-To, Message-ID, multipart text and HTML, links with equals signs and Unicode survive", () => {
  const link = "https://libertybancard.com/go?a=1&b=2&utm_source=email=x";
  const html = `<p>Héllo — “Ωmega” ✓</p><p><a href="${link}">Pick a time</a></p>`;
  const { mime, raw, messageId } = buildGmailMime({
    from: "accounts@libertybancard.com", fromName: "Liberty Bancard", to: "owner@example.com", replyTo: "accounts@libertybancard.com",
    subject: "Thanks — your estimate request ✓", html, messageId: MESSAGE_ID, date: NOW,
    unsubscribeUrl: "https://libertybancard.com/unsubscribe?token=abc==", unsubscribeMailto: "accounts@libertybancard.com",
  });
  assert.equal(messageId, MESSAGE_ID);
  assert.match(mime, /^From: Liberty Bancard <accounts@libertybancard\.com>\r\n/);
  assert.match(mime, /\r\nTo: owner@example\.com\r\n/);
  assert.match(mime, /\r\nReply-To: accounts@libertybancard\.com\r\n/);
  assert.ok(mime.includes(`\r\nMessage-ID: ${MESSAGE_ID}\r\n`));
  assert.match(mime, /\r\nList-Unsubscribe: <mailto:accounts@libertybancard\.com>, <https:\/\/libertybancard\.com\/unsubscribe\?token=abc==>\r\n/);
  assert.match(mime, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.match(mime, /\r\nSubject: =\?UTF-8\?B\?/, "non-ASCII subject is RFC 2047 encoded");
  const text = decodeQuotedPrintable(part(mime, "text/plain").body);
  assert.ok(text.includes(`Pick a time (${link})`), "plain text keeps the link target including equals signs");
  assert.ok(text.includes("Héllo — “Ωmega” ✓"));
  const decodedHtml = Buffer.from(part(mime, "text/html").body.replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(decodedHtml, html, "HTML round-trips byte for byte");
  assert.equal(Buffer.from(raw, "base64url").toString("utf8"), mime, "raw payload is the same message");
  for (const line of mime.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 998, "no overlong physical line");
  for (const line of part(mime, "text/plain").body.split("\r\n")) assert.ok(line.length <= 76, "quoted-printable soft breaks keep lines short");
});
check("E07 MIME: long headers fold into compliant encoded words; display names with specials are encoded or quoted safely", () => {
  const long = "Ünïcode ".repeat(30).trim();
  const encoded = encodeHeaderValue(long);
  for (const word of encoded.split("\r\n ")) assert.ok(word.length <= 75, `encoded word ${word.length}`);
  assert.equal(encoded.split("\r\n ").map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ""), "base64").toString("utf8")).join(""), long);
  const { mime } = buildGmailMime({ from: "accounts@libertybancard.com", fromName: "Liberty, Bancard <Ops>", to: "owner@example.com", subject: "Hi", html: "<p>x</p>", messageId: MESSAGE_ID, date: NOW });
  assert.equal(mime.split("\r\n")[0], 'From: "Liberty, Bancard <Ops>" <accounts@libertybancard.com>', "a display name with specials is emitted only as a quoted string");
  const quoted = buildGmailMime({ from: "accounts@libertybancard.com", fromName: 'Say "hi" \\ ok', to: "owner@example.com", subject: "Hi", html: "<p>x</p>", messageId: MESSAGE_ID, date: NOW }).mime.split("\r\n")[0];
  assert.equal(quoted, 'From: "Say \\"hi\\" \\\\ ok" <accounts@libertybancard.com>', "quotes and backslashes in a display name are escaped");
});
check("E07 MIME: injection, malformed or missing values are refused before any transport", () => {
  const base = { from: "accounts@libertybancard.com", to: "owner@example.com", subject: "Hi", html: "<p>x</p>", messageId: MESSAGE_ID, date: NOW };
  throwsWith(() => buildGmailMime({ ...base, subject: "Hi\r\nBcc: attacker@example.com" }), "HEADER_INJECTION");
  throwsWith(() => buildGmailMime({ ...base, to: "owner@example.com\r\nBcc: x@example.com" }), "INVALID_RECIPIENT");
  throwsWith(() => buildGmailMime({ ...base, to: "a@example.com, b@example.com" }), "INVALID_RECIPIENT");
  throwsWith(() => buildGmailMime({ ...base, to: "" }), "INVALID_RECIPIENT");
  throwsWith(() => buildGmailMime({ ...base, replyTo: "not an address" }), "INVALID_REPLY_TO");
  throwsWith(() => buildGmailMime({ ...base, subject: "   " }), "SUBJECT_MISSING");
  throwsWith(() => buildGmailMime({ ...base, html: "  " }), "BODY_MISSING");
  throwsWith(() => buildGmailMime({ ...base, messageId: "no-brackets@example.com" }), "INVALID_MESSAGE_ID");
  throwsWith(() => buildGmailMime({ ...base, messageId: "<a b@example.com>" }), "INVALID_MESSAGE_ID");
  throwsWith(() => buildGmailMime({ ...base, unsubscribeUrl: "http://insecure.example.com/u" }), "INVALID_UNSUBSCRIBE_URL");
  throwsWith(() => buildGmailMime({ ...base, unsubscribeUrl: "https://ok.example.com/u\r\nX: y" }), "HEADER_INJECTION");
  assert.ok(buildGmailMime({ ...base }).mime.includes("To: owner@example.com"), "negative control: the same input without the fault builds");
});
check("E07 plain-text derivation keeps links, drops scripts and styles, and decodes entities", () => {
  const text = htmlToPlainText(`<style>p{}</style><script>alert(1)</script><p>A &amp; B</p><ul><li>One</li><li>Two</li></ul><a href="javascript:alert(1)">bad</a> <a href="https://x.example/a?b=1&amp;c=2">go</a>`);
  assert.ok(!/alert|p\{\}/.test(text.replace("bad", "")));
  assert.ok(text.includes("A & B") && text.includes("- One") && text.includes("go (https://x.example/a?b=1&c=2)"));
  assert.ok(!text.includes("javascript:"));
  assert.equal(decodeQuotedPrintable(encodeQuotedPrintable("a=b\nc")), "a=b\r\nc", "quoted-printable carries canonical CRLF line breaks and escapes the equals sign");
});

// ── E08: outcomes, identity and capacity ────────────────────────────────────
check("E08 only a definite provider refusal is 'unsent'; timeouts, 5xx, network and unknown shapes stay 'uncertain'", () => {
  assert.equal(classifyGmailFailure({ response: { status: 400 } }), "unsent");
  assert.equal(classifyGmailFailure({ status: 403 }), "unsent");
  assert.equal(classifyGmailFailure({ code: 429 }), "unsent");
  assert.equal(classifyGmailFailure({ code: "401" }), "unsent");
  assert.equal(classifyGmailFailure({ response: { status: 408 } }), "uncertain", "408 may have been processed");
  for (const e of [{ response: { status: 500 } }, { status: 503 }, { code: "ETIMEDOUT" }, { code: "ECONNRESET" }, {}, null, undefined, { status: "oops" }, { code: 200 }]) {
    assert.equal(classifyGmailFailure(e as never), "uncertain", JSON.stringify(e));
  }
});
check("E08 Message-IDs are stable per attempt, application-owned, recognizable and distinct per step", () => {
  const a = deriveRfcMessageId(warmIdempotencyKey(7, 0));
  assert.equal(a, deriveRfcMessageId(warmIdempotencyKey(7, 0)));
  assert.notEqual(a, deriveRfcMessageId(warmIdempotencyKey(7, 1)));
  assert.notEqual(a, deriveRfcMessageId(warmIdempotencyKey(8, 0)));
  assert.match(a, /^<lbw\.[0-9a-f]{32}@libertybancard\.com>$/);
  assert.equal(warmIdempotencyKey(7, 0), "website-warm:7:0");
});
check("E08 warm capacity is per real mailbox (case-insensitive), distinct per account, and never a cold scope", () => {
  assert.equal(warmCapacityScope("Scott@LibertyBancard.com"), warmCapacityScope("scott@libertybancard.com"));
  assert.notEqual(warmCapacityScope("scott@libertybancard.com"), warmCapacityScope("other@libertybancard.com"));
  assert.match(warmCapacityScope("scott@libertybancard.com"), /^warm_gmail:/);
  assert.doesNotMatch(warmCapacityScope("scott@libertybancard.com"), /cold|sfp/i);
});

// ── E09: mailbox classification ─────────────────────────────────────────────
const headers = (over: Partial<MailboxMessageHeaders> = {}): MailboxMessageHeaders => ({
  from: "Owner <owner@example.com>", subject: "Re: Thanks", messageId: "<reply-1@example.com>", inReplyTo: MESSAGE_ID, references: MESSAGE_ID,
  autoSubmitted: null, precedence: null, xAutoreply: null, xFailedRecipients: null, contentType: "text/plain", labelIds: ["INBOX"], ...over,
});
check("E09 a genuine reply references our application-created Message-ID", () => {
  const c = classifyMailboxMessage(headers());
  assert.equal(c.kind, "reply");
  assert.deepEqual(c.ourRfcIds, [MESSAGE_ID.toLowerCase()]);
  assert.equal(c.fromAddress, "owner@example.com");
});
check("E09 forged or mismatched references are not correlated to us", () => {
  assert.equal(classifyMailboxMessage(headers({ inReplyTo: "<abc@example.com>", references: "<abc@example.com> <lbw.zz@x.com>" })).kind, "other");
  assert.equal(classifyMailboxMessage(headers({ inReplyTo: null, references: null })).kind, "other");
  assert.deepEqual(classifyMailboxMessage(headers({ inReplyTo: "<lbw.0123@libertybancard.com>", references: null })).ourRfcIds, [], "a malformed id is not ours");
});
check("E09 bounce notices (including ones carrying Auto-Submitted) are bounces and expose failed recipients", () => {
  const b = classifyMailboxMessage(headers({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", autoSubmitted: "auto-replied", xFailedRecipients: "Owner@Example.com" }));
  assert.equal(b.kind, "bounce");
  assert.deepEqual(b.failedRecipients, ["owner@example.com"]);
  assert.equal(classifyMailboxMessage(headers({ from: "postmaster@example.com" })).kind, "bounce");
  assert.equal(classifyMailboxMessage(headers({ contentType: 'multipart/report; report-type=delivery-status; boundary="x"' })).kind, "bounce");
  assert.equal(classifyMailboxMessage(headers({ xFailedRecipients: "x@example.com" })).kind, "bounce");
});
check("E09 auto-replies are evidence only and never classified as a human reply", () => {
  for (const over of [{ autoSubmitted: "auto-replied" }, { precedence: "bulk" }, { xAutoreply: "yes" }, { subject: "Automatic reply: Thanks" }, { subject: "Out of office" }]) {
    assert.equal(classifyMailboxMessage(headers(over)).kind, "auto_reply", JSON.stringify(over));
  }
  assert.equal(classifyMailboxMessage(headers({ autoSubmitted: "no" })).kind, "reply", "Auto-Submitted: no is not an auto-reply");
});
check("E09 messages from our own Sent folder only ever settle a send; they are never replies or bounces", () => {
  const c = classifyMailboxMessage(headers({ labelIds: ["SENT"], from: "accounts@libertybancard.com" }));
  assert.equal(c.fromSentFolder, true);
  assert.equal(c.kind, "other");
  assert.equal(classifyMailboxMessage(headers({ labelIds: ["SENT"], from: "mailer-daemon@x.com" })).kind, "other");
});
check("E09 address extraction handles display names, bare addresses, trailing punctuation and garbage", () => {
  assert.equal(extractAddress('"Owner, Jr." <Owner@Example.com>'), "owner@example.com");
  assert.equal(extractAddress("owner@example.com."), "owner@example.com");
  assert.equal(extractAddress(""), null);
  assert.equal(extractAddress(null), null);
  assert.equal(extractAddress("no address here"), null);
});
check("E09 evidence identity is stable per provider message and differs by kind, account and message", () => {
  const base = { account: "Scott@libertybancard.com", providerMessageId: "m1", kind: "reply" as const, messageId: "<a@b.com>" };
  assert.equal(mailboxEvidenceHash(base), mailboxEvidenceHash({ ...base, account: "scott@libertybancard.com" }));
  assert.notEqual(mailboxEvidenceHash(base), mailboxEvidenceHash({ ...base, kind: "bounce" }));
  assert.notEqual(mailboxEvidenceHash(base), mailboxEvidenceHash({ ...base, providerMessageId: "m2" }));
  assert.notEqual(mailboxEvidenceHash(base), mailboxEvidenceHash({ ...base, account: "other@libertybancard.com" }));
});

// ── E10: one stop predicate ─────────────────────────────────────────────────
check("E10 the stop predicate orders by inbound event id after entry, excludes only this occurrence's own intake row, and is fail-visible", () => {
  const where = warmStopWhereSql({ contact: "$1", entry: "$2", request: "$3" });
  assert.match(where, /inbound\.id > \$2/);
  assert.match(where, /inbound\.contact_id = \$1/);
  assert.match(where, /inbound\.direction = 'inbound'/);
  assert.match(where, /metadata->>'submissionId' = \$3/);
  assert.doesNotMatch(where, /created_at|occurred_at|received_at/, "ordering never depends on a timestamp a sender can backdate");
  assert.doesNotMatch(where, /intent_classification|automation_stopped/, "unclassified inbound activity still stops the journey");
  assert.deepEqual(decideWarmStop([]), { stop: false });
  assert.deepEqual(decideWarmStop([{ id: 9 }]), { stop: true, reason: "INBOUND_AFTER_ENTRY" });
  assert.deepEqual(decideWarmStop(null), { stop: "unavailable" }, "evidence that cannot be read is never read as 'no reply'");
});

// ── Static separation checks ────────────────────────────────────────────────
check("lane code never sends through legacy transports and never uses the CR-06 enrollment fence or SFP preparation", () => {
  for (const file of ["server/services/website-email-runtime.ts", "server/services/website-email-lane-store.ts", "server/services/website-email-tick.ts", "server/services/gmail-mailbox-reader.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /enrollThroughCr04Fence|prepareCanonicalRecipient|sendSmtpEmail|sendEmailViaGhl|ghlSendEmail/, file);
    assert.doesNotMatch(src, /CR06_DISPATCH_AVAILABLE/, file);
    assert.doesNotMatch(src, /process\.env\.[A-Z_]*(PROFILE|ENABLED|CAPABILITY)/, `${file} must not read enablement from the environment`);
  }
});
check("no checked-in configuration enables the website email capability or opens the lane", () => {
  const profile = readFileSync("server/services/background-profile.ts", "utf8");
  assert.match(profile, /"website-email"/);
  assert.doesNotMatch(readFileSync(".replit", "utf8"), /website-email/i);
  assert.match(readFileSync("migrations/0382_website_email_lifecycle.sql", "utf8"), /status text NOT NULL DEFAULT 'closed'/);
  assert.match(readFileSync("migrations/0382_website_email_lifecycle.sql", "utf8"), /daily_limit integer NOT NULL DEFAULT 0/);
  assert.doesNotMatch(readFileSync("migrations/0382_website_email_lifecycle.sql", "utf8"), /INSERT INTO\s+website_lifecycle_config_revisions/i, "the migration seeds no open revision");
});

console.log(`\nwebsite-email contracts: ${checks} checks passed`);
