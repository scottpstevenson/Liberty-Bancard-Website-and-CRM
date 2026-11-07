/**
 * Website email lifecycle: pure, database-free contracts.
 *
 * Nothing here reads or writes state, the clock (except through an explicit `now`), the environment or the network, so
 * it can be imported by CLI tools and tests that must never open a database connection.
 *
 * Two programs share one default-closed lane:
 *   - requested_followup: substantive follow-up to something the person asked for (estimate, get started, free
 *     analysis). Its approved purpose is a human response; it never sends promotional content.
 *   - nurture: separately consented email-marketing. It KEEPS its promotional classification. Admission is a narrow,
 *     centrally decided exception beside the unchanged CR-06 pure decision, not a relabel of the content.
 *
 * `decideWebsiteWarmAdmission` is the only place that can allow a warm send. It ignores any caller-supplied purpose:
 * the purpose is derived from the program table below, and the program must be mapped by the current lane
 * configuration to an approved, hash-verified, email-only warm revision.
 */
import { createHash } from "node:crypto";
import { decideCr06PromotionalLifecycle, type Cr06CommunicationPurpose } from "./cr06-promotional-lifecycle-decision";
import { findDisclosure, type WebsiteEmailDisclosure } from "@shared/website-email-disclosures";

// ── Programs and purposes ────────────────────────────────────────────────────

export const WARM_PROGRAMS = ["requested_followup", "nurture"] as const;
export type WarmProgram = (typeof WARM_PROGRAMS)[number];

export interface ProgramPurpose {
  /** Classification the CR-06 boundary sees. Nurture stays promotional: it is never relabeled. */
  cr06: Cr06CommunicationPurpose;
  /** Purpose stored on the immutable warm revision. */
  warm: "human_response" | "promotional";
  /** Purpose understood by the Gmail transport and the footer renderer. */
  transport: "marketing_outreach" | "transactional_response";
}

export const PROGRAM_PURPOSE: Readonly<Record<WarmProgram, ProgramPurpose>> = Object.freeze({
  requested_followup: { cr06: "human_response", warm: "human_response", transport: "transactional_response" },
  nurture: { cr06: "promotional", warm: "promotional", transport: "marketing_outreach" },
});

/** Sources that can ever reach the lane, and the programs each may request. Everything else is not in the lane. */
export const WEBSITE_LANE_SOURCE_PROGRAMS: Readonly<Record<string, readonly WarmProgram[]>> = Object.freeze({
  "website_form|estimate_form": ["requested_followup", "nurture"],
  "website_form|get_started_form": ["requested_followup", "nurture"],
  "website_form|free_analysis": ["requested_followup", "nurture"],
  "website_form|newsletter_signup": ["nurture"],
});

export function laneSourceKey(sourceCategory: string, sourceType: string): string {
  return `${sourceCategory}|${sourceType}`;
}

/** Inbound manifest versions whose frozen contract includes the warm effects. Older versions never gain them. */
export const WARM_CAPABLE_MANIFEST_VERSIONS: readonly string[] = ["cro05a-v3"];

/** A held intent older than this is refused instead of released: no historical catch-up. */
export const WARM_HELD_MAX_AGE_MS = 72 * 60 * 60 * 1000;

// ── Stable hashing ───────────────────────────────────────────────────────────

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = (v as Record<string, unknown>)[key];
      return out;
    }, {});
  });
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256Hex(stableJson(value));
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v.length ? v : null;
}

/** Binding hash for an address. The address itself is never stored in admission or evidence rows. */
export function emailTokenHash(email: string | null | undefined): string | null {
  const v = normalizeEmail(email);
  return v ? sha256Hex(`website-email-v1:${v}`) : null;
}

// ── Immutable warm revision snapshot ─────────────────────────────────────────

export interface WarmSnapshotStep {
  order: number;
  channel: "email";
  /** Minutes after the previous touch (or after admission for the first step). */
  delayMinutes: number;
  subject: string;
  bodyHtml: string;
}

export interface WarmSnapshot {
  version: 1;
  program: WarmProgram;
  purpose: ProgramPurpose["warm"];
  allowedChannels: readonly ["email"];
  steps: WarmSnapshotStep[];
  sourceSequence: { id: number | null; name: string | null };
}

export function hashWarmSnapshot(snapshot: WarmSnapshot): string {
  return hashJson(snapshot);
}

export interface UnsupportedStep {
  stepOrder: number;
  actionType: string;
  reason: "NON_EMAIL_STEP" | "UNSUPPORTED_STEP_TYPE" | "EMAIL_STEP_WITHOUT_CONTENT";
}

export interface LegacyStepInput {
  stepOrder: number;
  actionType: string;
  delayDays?: number | null;
  delayHours?: number | null;
  subject?: string | null;
  body?: string | null;
}

/**
 * Convert an existing step list into email-only warm steps. SMS, voice, workflow, task and condition steps are never
 * silently skipped as if the sequence were complete: they are returned as `unsupported` and block approval. A legacy
 * `wait` step contributes only its delay to the next email.
 */
export function buildEmailOnlySteps(steps: readonly LegacyStepInput[]): { steps: WarmSnapshotStep[]; unsupported: UnsupportedStep[] } {
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const out: WarmSnapshotStep[] = [];
  const unsupported: UnsupportedStep[] = [];
  let carryMinutes = 0;
  for (const step of ordered) {
    const delay = Math.max(0, (step.delayDays ?? 0) * 1440 + (step.delayHours ?? 0) * 60);
    if (step.actionType === "wait") {
      carryMinutes += delay;
      continue;
    }
    if (step.actionType !== "email") {
      const nonEmail = ["sms", "call", "call_reminder", "voicemail_drop"].includes(step.actionType);
      unsupported.push({ stepOrder: step.stepOrder, actionType: step.actionType, reason: nonEmail ? "NON_EMAIL_STEP" : "UNSUPPORTED_STEP_TYPE" });
      continue;
    }
    const subject = (step.subject ?? "").trim();
    const bodyHtml = (step.body ?? "").trim();
    if (!subject || !bodyHtml) {
      unsupported.push({ stepOrder: step.stepOrder, actionType: step.actionType, reason: "EMAIL_STEP_WITHOUT_CONTENT" });
      continue;
    }
    out.push({ order: out.length, channel: "email", delayMinutes: delay + carryMinutes, subject, bodyHtml });
    carryMinutes = 0;
  }
  return { steps: out, unsupported };
}

export function validateWarmSnapshot(value: unknown): { ok: true; snapshot: WarmSnapshot } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "SNAPSHOT_MALFORMED" };
  const s = value as Partial<WarmSnapshot>;
  if (s.version !== 1) return { ok: false, reason: "SNAPSHOT_VERSION_UNSUPPORTED" };
  if (!s.program || !(WARM_PROGRAMS as readonly string[]).includes(s.program)) return { ok: false, reason: "SNAPSHOT_PROGRAM_INVALID" };
  if (s.purpose !== PROGRAM_PURPOSE[s.program].warm) return { ok: false, reason: "SNAPSHOT_PURPOSE_MISMATCH" };
  if (!Array.isArray(s.allowedChannels) || s.allowedChannels.length !== 1 || s.allowedChannels[0] !== "email") {
    return { ok: false, reason: "SNAPSHOT_CHANNEL_MASK_INVALID" };
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) return { ok: false, reason: "SNAPSHOT_HAS_NO_STEPS" };
  for (const [index, step] of s.steps.entries()) {
    if (!step || step.channel !== "email" || step.order !== index) return { ok: false, reason: "SNAPSHOT_STEP_INVALID" };
    if (!Number.isInteger(step.delayMinutes) || step.delayMinutes < 0) return { ok: false, reason: "SNAPSHOT_STEP_DELAY_INVALID" };
    if (typeof step.subject !== "string" || !step.subject.trim() || typeof step.bodyHtml !== "string" || !step.bodyHtml.trim()) {
      return { ok: false, reason: "SNAPSHOT_STEP_CONTENT_MISSING" };
    }
  }
  return { ok: true, snapshot: s as WarmSnapshot };
}

// ── Lane configuration ───────────────────────────────────────────────────────

export type LaneConfigStatus = "closed" | "open" | "revoked";

export interface LaneConfigFacts {
  id: number;
  revision: number;
  status: LaneConfigStatus | string;
  /** { "<category>|<type>": { "<program>": warmRevisionId } } */
  sourceProgramMap: unknown;
  senderCategory: string;
  senderAccount: string | null;
  eligibilityStartsAt: Date | null;
  dailyLimit: number;
}

export function hashLaneConfig(config: {
  status: string;
  sourceProgramMap: unknown;
  senderCategory: string;
  senderAccount: string | null;
  eligibilityStartsAt: Date | null;
  dailyLimit: number;
}): string {
  return hashJson({
    status: config.status,
    sourceProgramMap: config.sourceProgramMap,
    senderCategory: config.senderCategory,
    senderAccount: config.senderAccount,
    eligibilityStartsAt: config.eligibilityStartsAt ? config.eligibilityStartsAt.toISOString() : null,
    dailyLimit: config.dailyLimit,
  });
}

export function mappedWarmRevisionId(config: LaneConfigFacts | null, source: string, program: WarmProgram): number | null {
  const map = config?.sourceProgramMap;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const forSource = (map as Record<string, unknown>)[source];
  if (!forSource || typeof forSource !== "object" || Array.isArray(forSource)) return null;
  const id = (forSource as Record<string, unknown>)[program];
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** Validate a proposed mapping (read-only preview and change code share this). */
export function validateSourceProgramMap(map: unknown): { ok: true } | { ok: false; reason: string } {
  if (!map || typeof map !== "object" || Array.isArray(map)) return { ok: false, reason: "MAP_MALFORMED" };
  for (const [source, programs] of Object.entries(map as Record<string, unknown>)) {
    const allowed = WEBSITE_LANE_SOURCE_PROGRAMS[source];
    if (!allowed) return { ok: false, reason: `SOURCE_NOT_IN_LANE:${source}` };
    if (!programs || typeof programs !== "object" || Array.isArray(programs)) return { ok: false, reason: `MAP_MALFORMED:${source}` };
    for (const [program, id] of Object.entries(programs as Record<string, unknown>)) {
      if (!(allowed as readonly string[]).includes(program)) return { ok: false, reason: `PROGRAM_NOT_ALLOWED_FOR_SOURCE:${source}:${program}` };
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return { ok: false, reason: `MAP_REVISION_ID_INVALID:${source}:${program}` };
    }
  }
  return { ok: true };
}

// ── Admission decision (pure) ────────────────────────────────────────────────

export type WarmBoundary = "creation" | "claim" | "before_io";

export type WarmRefusalReason =
  | "PROGRAM_INVALID"
  | "SOURCE_NOT_IN_LANE"
  | "FROZEN_POLICY_NO_WARM_EFFECT"
  | "CONFIG_MISSING"
  | "CONFIG_CLOSED"
  | "CONFIG_REVOKED"
  | "CONFIG_MALFORMED"
  | "PROGRAM_NOT_MAPPED"
  | "WARM_REVISION_MISSING"
  | "WARM_REVISION_NOT_APPROVED"
  | "WARM_REVISION_RETIRED"
  | "WARM_REVISION_PROGRAM_MISMATCH"
  | "WARM_REVISION_HASH_DRIFT"
  | "WARM_REVISION_INVALID"
  | "BEFORE_ELIGIBILITY_START"
  | "HELD_TOO_LONG"
  | "CONTACT_MISSING"
  | "EMAIL_MISSING"
  | "EMAIL_CHANGED"
  | "CONSENT_MISSING"
  | "CONSENT_WITHDRAWN"
  | "CLASS_REVIEW_PENDING"
  | "CLASS_NOT_PRODUCTION"
  | "SENDER_REPLY_PATH_UNPROVEN"
  | "SENDER_UNAVAILABLE"
  | "PROVIDER_LEDGER_NOT_READY"
  | "ADMISSION_MISSING"
  | "ADMISSION_REVOKED"
  | "ADMISSION_BINDING_MISMATCH"
  | "CHANNEL_NOT_EMAIL"
  | "ENROLLMENT_CONFLICT_ACTIVE"
  | "ENROLLMENT_CONFLICT_PAUSED"
  | "PRIOR_JOURNEY_EXISTS";

/**
 * Recoverable reasons stay `held` (a later pass may admit once the blocker clears); everything else is terminal for
 * that occurrence. A held reason never produces a send.
 */
const HELD_REASONS: ReadonlySet<WarmRefusalReason> = new Set<WarmRefusalReason>([
  "CONFIG_MISSING", "CONFIG_CLOSED", "WARM_REVISION_NOT_APPROVED", "WARM_REVISION_HASH_DRIFT", "CLASS_REVIEW_PENDING",
  "SENDER_REPLY_PATH_UNPROVEN", "SENDER_UNAVAILABLE", "PROVIDER_LEDGER_NOT_READY", "ENROLLMENT_CONFLICT_ACTIVE", "ENROLLMENT_CONFLICT_PAUSED",
]);

export function isHeldReason(reason: WarmRefusalReason): boolean {
  return HELD_REASONS.has(reason);
}

export interface WarmRevisionFacts {
  id: number;
  program: string;
  state: string;
  snapshot: unknown;
  snapshotHash: string;
  unsupportedStepCount: number;
}

export interface WarmContactFacts {
  id: number;
  email: string | null;
  emailGeneration: number | null;
  recordClass: string;
}

export interface WarmConsentFacts {
  /** Canonical email/outreach state from the consent authority (never a legacy flag). */
  emailState: "permitted" | "withdrawn" | "suppressed" | "unknown" | "unavailable";
  /** True only when THIS occurrence recorded an email opt-in through the canonical authority. */
  optInForThisOccurrence: boolean;
}

export interface WarmAdmissionBinding {
  state: string;
  channel: string;
  program: string;
  warmRevisionId: number;
  warmRevisionHash: string;
  emailTokenHash: string;
  emailGeneration: number;
}

export interface WarmAdmissionFacts {
  boundary: WarmBoundary;
  /** Untrusted by construction: validated against WARM_PROGRAMS. */
  program: unknown;
  /** submittedEmailHash is the address the person typed into THIS occurrence (hash only); null when the occurrence never carried one. */
  request: { sourceCategory: string; sourceType: string; manifestVersion: string; receivedAt: Date; submittedEmailHash: string | null } | null;
  config: LaneConfigFacts | null;
  warmRevision: WarmRevisionFacts | null;
  contact: WarmContactFacts | null;
  consent: WarmConsentFacts;
  sender: { category: string; replyPathProven: boolean } | null;
  /**
   * True only when the communication ledger in THIS database accepts a Gmail provider value. Publish can deliver new
   * tables without delivering a CHECK change on an existing table, so the runtime proves it from the catalog instead of
   * assuming the migration ran; anything but `true` refuses (held) so a send is never dispatched that cannot be recorded.
   */
  ledgerReady: boolean;
  /** Required for claim / before_io; absent at creation. */
  admission: WarmAdmissionBinding | null;
  heldSince: Date | null;
  now: Date;
}

export type WarmAdmissionDecision =
  | {
      allowed: true;
      program: WarmProgram;
      purpose: ProgramPurpose;
      warmRevisionId: number;
      warmRevisionHash: string;
      configRevisionId: number;
      consentBasis: "email_marketing_opt_in" | "request_specific";
      emailTokenHash: string;
      emailGeneration: number;
    }
  | { allowed: false; reason: WarmRefusalReason; held: boolean };

function refuse(reason: WarmRefusalReason): WarmAdmissionDecision {
  return { allowed: false, reason, held: isHeldReason(reason) };
}

export function decideWebsiteWarmAdmission(facts: WarmAdmissionFacts): WarmAdmissionDecision {
  if (typeof facts.program !== "string" || !(WARM_PROGRAMS as readonly string[]).includes(facts.program)) return refuse("PROGRAM_INVALID");
  const program = facts.program as WarmProgram;
  if (!facts.request) return refuse("SOURCE_NOT_IN_LANE");
  const source = laneSourceKey(facts.request.sourceCategory, facts.request.sourceType);
  const laneSource = WEBSITE_LANE_SOURCE_PROGRAMS[source];
  if (!laneSource || !laneSource.includes(program)) return refuse("SOURCE_NOT_IN_LANE");
  if (!WARM_CAPABLE_MANIFEST_VERSIONS.includes(facts.request.manifestVersion)) return refuse("FROZEN_POLICY_NO_WARM_EFFECT");

  const config = facts.config;
  if (!config) return refuse("CONFIG_MISSING");
  if (config.status === "revoked") return refuse("CONFIG_REVOKED");
  if (config.status !== "open") return refuse(config.status === "closed" ? "CONFIG_CLOSED" : "CONFIG_MALFORMED");
  const mapped = mappedWarmRevisionId(config, source, program);
  if (mapped === null) return refuse("PROGRAM_NOT_MAPPED");

  const revision = facts.warmRevision;
  if (!revision || revision.id !== mapped) return refuse("WARM_REVISION_MISSING");
  if (revision.program !== program) return refuse("WARM_REVISION_PROGRAM_MISMATCH");
  if (revision.state === "retired") return refuse("WARM_REVISION_RETIRED");
  if (revision.state !== "approved") return refuse("WARM_REVISION_NOT_APPROVED");
  if (revision.unsupportedStepCount > 0) return refuse("WARM_REVISION_INVALID");
  const snapshot = validateSourceSnapshot(revision.snapshot, program);
  if (!snapshot) return refuse("WARM_REVISION_INVALID");
  if (hashWarmSnapshot(snapshot) !== revision.snapshotHash) return refuse("WARM_REVISION_HASH_DRIFT");

  if (!config.eligibilityStartsAt) return refuse("BEFORE_ELIGIBILITY_START");
  if (facts.request.receivedAt.getTime() < config.eligibilityStartsAt.getTime()) return refuse("BEFORE_ELIGIBILITY_START");
  if (facts.boundary === "creation" && facts.heldSince && facts.now.getTime() - facts.heldSince.getTime() > WARM_HELD_MAX_AGE_MS) {
    return refuse("HELD_TOO_LONG");
  }

  const contact = facts.contact;
  if (!contact) return refuse("CONTACT_MISSING");
  const currentHash = emailTokenHash(contact.email);
  if (!currentHash || contact.emailGeneration === null) return refuse("EMAIL_MISSING");
  // The address bound to a new admission must be the one this occurrence actually carried. A contact whose address was
  // changed or merged after intake is a different recipient; the original opt-in/request never covered it.
  if (facts.boundary === "creation") {
    if (!facts.request.submittedEmailHash) return refuse("EMAIL_MISSING");
    if (facts.request.submittedEmailHash !== currentHash) return refuse("EMAIL_CHANGED");
  }

  if (facts.boundary !== "creation") {
    const a = facts.admission;
    if (!a) return refuse("ADMISSION_MISSING");
    if (a.state !== "active") return refuse("ADMISSION_REVOKED");
    if (a.channel !== "email") return refuse("CHANNEL_NOT_EMAIL");
    if (a.program !== program || a.warmRevisionId !== revision.id) return refuse("ADMISSION_BINDING_MISMATCH");
    if (a.warmRevisionHash !== revision.snapshotHash) return refuse("WARM_REVISION_HASH_DRIFT");
    if (a.emailTokenHash !== currentHash || a.emailGeneration !== contact.emailGeneration) return refuse("EMAIL_CHANGED");
  }

  if (facts.consent.emailState === "withdrawn" || facts.consent.emailState === "suppressed") return refuse("CONSENT_WITHDRAWN");
  if (facts.consent.emailState === "unavailable") return refuse("CONSENT_MISSING");
  if (program === "nurture" && !(facts.consent.emailState === "permitted" && facts.consent.optInForThisOccurrence)) {
    return refuse("CONSENT_MISSING");
  }

  // Unknown class follows the existing authorized class-review continuation for BOTH programs: a held intent resumes
  // on a later pass once that authority makes the record production. This lane never promotes a record itself.
  if (contact.recordClass === "unknown") return refuse("CLASS_REVIEW_PENDING");
  if (contact.recordClass !== "production") return refuse("CLASS_NOT_PRODUCTION");

  if (facts.ledgerReady !== true) return refuse("PROVIDER_LEDGER_NOT_READY");
  if (!facts.sender) return refuse("SENDER_UNAVAILABLE");
  if (facts.sender.category === "cold_outreach") return refuse("SENDER_UNAVAILABLE");
  if (!facts.sender.replyPathProven) return refuse("SENDER_REPLY_PATH_UNPROVEN");

  return {
    allowed: true,
    program,
    purpose: PROGRAM_PURPOSE[program],
    warmRevisionId: revision.id,
    warmRevisionHash: revision.snapshotHash,
    configRevisionId: config.id,
    consentBasis: program === "nurture" ? "email_marketing_opt_in" : "request_specific",
    emailTokenHash: currentHash,
    emailGeneration: contact.emailGeneration,
  };
}

function validateSourceSnapshot(value: unknown, program: WarmProgram): WarmSnapshot | null {
  const checked = validateWarmSnapshot(value);
  return checked.ok && checked.snapshot.program === program ? checked.snapshot : null;
}

/**
 * Companion to the CR-06 pure decision. A warm context never changes what CR-06 says: promotional stays refused there.
 * This helper only reports what the unchanged function decides for the program's classification, so tests and the ledger
 * can show the lane did not relabel anything.
 */
export function cr06DecisionForProgram(program: WarmProgram) {
  return decideCr06PromotionalLifecycle({ boundary: "sequence_transport", purpose: PROGRAM_PURPOSE[program].cr06 });
}

// ── Consent submission contract ──────────────────────────────────────────────

export type EmailConsentSubmission =
  | { kind: "not_given" }
  | { kind: "granted"; disclosure: WebsiteEmailDisclosure; disclosureHash: string }
  | { kind: "invalid"; reason: "EMAIL_DISCLOSURE_MISSING" | "EMAIL_DISCLOSURE_UNSUPPORTED" | "EMAIL_DISCLOSURE_SURFACE_MISMATCH" | "EMAIL_CONSENT_NOT_BOOLEAN" };

/** The exact text a visitor read; hashed with the same algorithm the consent authority uses for disclosure text. */
export function websiteDisclosureText(disclosure: WebsiteEmailDisclosure): string {
  return `${disclosure.label}\n${disclosure.helper}`;
}

export function websiteDisclosureHash(disclosure: WebsiteEmailDisclosure): string {
  return sha256Hex(websiteDisclosureText(disclosure));
}

/**
 * Resolve the optional email-marketing checkbox. Unchecked, omitted or false means NO event at all: it is neither a
 * grant nor a withdrawal, so an optional unchecked field can never turn into an opt-out through the merge helper. A
 * checked box is honored only with a disclosure id the server supports for that surface; wording, hashes, timestamps
 * and ids supplied by the browser are ignored.
 */
export function resolveEmailConsentSubmission(surface: string, body: { emailMarketingOptIn?: unknown; emailDisclosureId?: unknown }): EmailConsentSubmission {
  const checked = body.emailMarketingOptIn;
  if (checked === undefined || checked === null || checked === false) return { kind: "not_given" };
  if (checked !== true) return { kind: "invalid", reason: "EMAIL_CONSENT_NOT_BOOLEAN" };
  if (body.emailDisclosureId === undefined || body.emailDisclosureId === null || body.emailDisclosureId === "") {
    return { kind: "invalid", reason: "EMAIL_DISCLOSURE_MISSING" };
  }
  const disclosure = findDisclosure(body.emailDisclosureId);
  if (!disclosure) return { kind: "invalid", reason: "EMAIL_DISCLOSURE_UNSUPPORTED" };
  if (!(disclosure.surfaces as readonly string[]).includes(surface)) return { kind: "invalid", reason: "EMAIL_DISCLOSURE_SURFACE_MISMATCH" };
  return { kind: "granted", disclosure, disclosureHash: websiteDisclosureHash(disclosure) };
}

// ── Warm stop predicate (one definition for the read decision and the SQL fence) ──

export interface WarmStopPlaceholders {
  contact: string;
  entry: string;
  request: string;
}

/**
 * WHERE body shared by the read decision and the final dispatch fence. An inbound event counts only when it was
 * inserted AFTER the admission's entry event (by id, so a delayed or backdated timestamp cannot reorder it) and is not
 * this occurrence's own intake bookkeeping row. Any other inbound event, including an unclassified one, stops the
 * journey: the predicate is conservative and never infers "no reply" from missing evidence.
 */
export function warmStopWhereSql(p: WarmStopPlaceholders): string {
  return `inbound.contact_id = ${p.contact}
    AND inbound.direction = 'inbound'
    AND inbound.id > ${p.entry}
    AND NOT (inbound.channel = 'form' AND inbound.provider = 'internal' AND inbound.metadata->>'submissionId' = ${p.request})`;
}

export type WarmStopDecision = { stop: false } | { stop: true; reason: "INBOUND_AFTER_ENTRY" } | { stop: "unavailable" };

export function decideWarmStop(rows: readonly { id: number }[] | null): WarmStopDecision {
  if (rows === null) return { stop: "unavailable" };
  return rows.length > 0 ? { stop: true, reason: "INBOUND_AFTER_ENTRY" } : { stop: false };
}

// ── Gmail transport outcome contract ─────────────────────────────────────────

export type TransportOutcome = "accepted" | "unsent" | "uncertain";

/**
 * Classify a Gmail API failure. `unsent` is reserved for failures that prove the provider did not accept the message
 * (a definite 4xx rejection, or a refusal before any request left this process). Network errors, timeouts, 5xx and
 * anything without a status are `uncertain`: dispatch may have happened, so the attempt stays fenced.
 */
export function classifyGmailFailure(error: { code?: unknown; status?: unknown; response?: { status?: unknown } } | null | undefined): Exclude<TransportOutcome, "accepted"> {
  const raw = error?.response?.status ?? error?.status ?? error?.code;
  const status = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{3}$/.test(raw) ? Number(raw) : null;
  // 408 (request timeout) is ambiguous: the server may have processed the request. Everything else in 4xx is a refusal.
  if (status !== null && status >= 400 && status < 500 && status !== 408) return "unsent";
  return "uncertain";
}

/** Application-created, stable RFC 5322 Message-ID bound to the attempt before provider I/O. */
export function deriveRfcMessageId(idempotencyKey: string, domain = "libertybancard.com"): string {
  return `<lbw.${sha256Hex(`rfc-message-id:${idempotencyKey}`).slice(0, 32)}@${domain}>`;
}

export function warmIdempotencyKey(admissionId: number, stepOrder: number): string {
  return `website-warm:${admissionId}:${stepOrder}`;
}

/** Warm Gmail capacity scope: the real mailbox, shared across all of its aliases. Never the cold scopes. */
export function warmCapacityScope(accountEmail: string): string {
  return `warm_gmail:${accountEmail.trim().toLowerCase()}`;
}

// ── Mailbox evidence classification (pure) ───────────────────────────────────

export type MailboxEvidenceKind = "reply" | "bounce" | "auto_reply" | "other";

export interface MailboxMessageHeaders {
  from: string | null;
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  xAutoreply: string | null;
  xFailedRecipients: string | null;
  contentType: string | null;
  labelIds: readonly string[];
}

export interface MailboxClassification {
  kind: MailboxEvidenceKind;
  /** True for messages the mailbox itself sent (SENT label); these only ever settle an uncertain attempt. */
  fromSentFolder: boolean;
  /** Our application-created Message-IDs referenced by this message. */
  ourRfcIds: string[];
  failedRecipients: string[];
  fromAddress: string | null;
}

const OUR_RFC_ID = /<lbw\.[0-9a-f]{32}@[^>\s]+>/gi;

export function extractAddress(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const angled = raw.match(/<([^<>\s@]+@[^<>\s]+)>/);
  const bare = raw.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  const addr = (angled?.[1] ?? bare?.[0] ?? "").toLowerCase().replace(/[.,;]+$/, "");
  return addr.includes("@") ? addr : null;
}

export function extractAddresses(value: string | null | undefined): string[] {
  const found = (value ?? "").match(/[^\s<>"',;:]+@[^\s<>"',;:]+/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase().replace(/[.,;]+$/, "")))];
}

/**
 * Classify one mailbox message from metadata headers only (never body text). Bounce detection precedes auto-reply
 * because delivery-failure notices usually also carry Auto-Submitted. An auto-reply is EVIDENCE ONLY: it neither stops
 * a journey nor counts as a human reply.
 */
export function classifyMailboxMessage(h: MailboxMessageHeaders): MailboxClassification {
  const fromAddress = extractAddress(h.from);
  const refs = `${h.inReplyTo ?? ""} ${h.references ?? ""}`;
  const ourRfcIds = [...new Set((refs.match(OUR_RFC_ID) ?? []).map((id) => id.toLowerCase()))];
  const fromSentFolder = h.labelIds.includes("SENT");
  const failedRecipients = extractAddresses(h.xFailedRecipients);
  const base = { fromSentFolder, ourRfcIds, failedRecipients, fromAddress };
  if (fromSentFolder) return { ...base, kind: "other" };
  const isDaemon = /(^|[<\s"])(mailer-daemon|postmaster)@/i.test(h.from ?? "") || /mail delivery (sub)?system/i.test(h.from ?? "");
  const isReport = /report-type\s*=\s*"?delivery-status/i.test(h.contentType ?? "");
  if (isDaemon || isReport || failedRecipients.length > 0) return { ...base, kind: "bounce" };
  const auto = (h.autoSubmitted ?? "").trim().toLowerCase();
  const precedence = (h.precedence ?? "").trim().toLowerCase();
  const autoSubject = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of office|away from)/i.test(h.subject ?? "");
  if ((auto !== "" && auto !== "no") || ["bulk", "junk", "auto_reply", "list"].includes(precedence) || (h.xAutoreply ?? "").trim() !== "" || autoSubject) {
    return { ...base, kind: "auto_reply" };
  }
  if (ourRfcIds.length > 0) return { ...base, kind: "reply" };
  return { ...base, kind: "other" };
}

/** Stable per-message evidence fingerprint: provider ids and header identity only, never body content. */
export function mailboxEvidenceHash(input: { account: string; providerMessageId: string; kind: MailboxEvidenceKind; messageId: string | null }): string {
  return hashJson({ account: input.account.toLowerCase(), providerMessageId: input.providerMessageId, kind: input.kind, messageId: input.messageId });
}
