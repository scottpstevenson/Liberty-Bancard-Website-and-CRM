/**
 * Website email lifecycle: durable lane state (configuration revisions, immutable warm revisions, intents, admissions).
 *
 * Every send decision is made by the pure `decideWebsiteWarmAdmission`; this module only loads the facts for it and
 * persists the result. The lane is closed until an admin appends an `open` configuration revision, and a revision
 * only opens with an approved, hash-verified, email-only warm revision mapped for each source/program.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { lockCommercialGraph } from "./commercial-graph-locks";
import { lockContactMailboxes } from "./contact-mailbox-identity";
import { communicationContactLockKey } from "./communication-contact-lock";
import { NON_COLD_GMAIL_SENDER_CATEGORY, resolvePolicy } from "./sender-policy";
import {
  PROGRAM_PURPOSE,
  WARM_PROGRAMS,
  WEBSITE_LANE_SOURCE_PROGRAMS,
  buildEmailOnlySteps,
  decideWebsiteWarmAdmission,
  emailTokenHash,
  hashLaneConfig,
  hashWarmSnapshot,
  isHeldReason,
  laneSourceKey,
  mappedWarmRevisionId,
  validateSourceProgramMap,
  validateWarmSnapshot,
  type LaneConfigFacts,
  type LegacyStepInput,
  type UnsupportedStep,
  type WarmAdmissionBinding,
  type WarmAdmissionDecision,
  type WarmBoundary,
  type WarmConsentFacts,
  type WarmProgram,
  type WarmRefusalReason,
  type WarmRevisionFacts,
  type WarmSnapshot,
  type WarmSnapshotStep,
} from "./website-email-contracts";

export type Exec = { execute: (query: any) => Promise<any> };
export const rowsOf = <T = Record<string, any>>(result: any): T[] => (result?.rows ?? result ?? []) as T[];

export const WEBSITE_EMAIL_CONSENT_NAMESPACE = "public_form";
export const websiteEmailConsentEventKey = (requestId: string) => `website_email:${requestId}`;

/** The reader must have reported success this recently for a reply path to count as proven. */
export const READER_FRESH_MS = 15 * 60 * 1000;

// ── Configuration ────────────────────────────────────────────────────────────

export async function readCurrentLaneConfig(exec: Exec = db): Promise<LaneConfigFacts | null> {
  const row = rowsOf(await exec.execute(sql`
    SELECT id, revision, status, source_program_map, sender_category, sender_account, eligibility_starts_at, daily_limit, config_hash
    FROM website_lifecycle_config_revisions ORDER BY revision DESC LIMIT 1
  `))[0];
  if (!row) return null;
  const facts: LaneConfigFacts = {
    id: Number(row.id),
    revision: Number(row.revision),
    status: String(row.status),
    sourceProgramMap: row.source_program_map,
    senderCategory: String(row.sender_category),
    senderAccount: row.sender_account ?? null,
    eligibilityStartsAt: row.eligibility_starts_at ? new Date(row.eligibility_starts_at) : null,
    dailyLimit: Number(row.daily_limit),
  };
  // A stored revision whose bytes no longer match its hash is never trusted as open.
  if (hashLaneConfig(facts) !== String(row.config_hash)) return { ...facts, status: "malformed" };
  return facts;
}

export interface ProposedLaneConfig {
  status: "closed" | "open" | "revoked";
  sourceProgramMap: unknown;
  senderAccount: string | null;
  eligibilityStartsAt: Date | null;
  dailyLimit: number;
}

export interface LaneChangeReview {
  ok: boolean;
  problems: string[];
  currentRevision: number;
  nextRevision: number;
  configHash: string | null;
  /** The instant before which no request is ever eligible (never earlier than the change itself). */
  effectiveEligibilityStartsAt: string | null;
}

/** Validation shared by the read-only preview and the append (so what was previewed is exactly what is checked). */
async function reviewProposedConfig(
  exec: Exec,
  proposed: ProposedLaneConfig,
  gmail: { account: string | null; aliases: string[] },
  now: Date,
): Promise<LaneChangeReview & { normalized: ProposedLaneConfig }> {
  const problems: string[] = [];
  const current = await readCurrentLaneConfig(exec);
  const mapCheck = validateSourceProgramMap(proposed.sourceProgramMap);
  if (!mapCheck.ok) problems.push(mapCheck.reason);
  const normalized: ProposedLaneConfig = { ...proposed };
  if (!Number.isInteger(proposed.dailyLimit) || proposed.dailyLimit < 0 || proposed.dailyLimit > 500) problems.push("DAILY_LIMIT_OUT_OF_RANGE");
  if (proposed.status === "open") {
    if (!proposed.senderAccount) problems.push("SENDER_ACCOUNT_REQUIRED");
    else if (!gmail.account || proposed.senderAccount.toLowerCase() !== gmail.account) problems.push("SENDER_ACCOUNT_NOT_CONNECTED_GMAIL");
    if (proposed.dailyLimit <= 0) problems.push("DAILY_LIMIT_REQUIRED");
    if (!(await readProviderLedgerReady(exec))) problems.push("PROVIDER_LEDGER_NOT_READY");
    // No backdating: an open lane never admits a request that predates the change. A change to an ALREADY-open lane (for
    // example a new daily limit) keeps the lane's existing start so journeys it already admitted stay eligible; the start
    // can move later, never earlier. Opening from closed/revoked/absent floors to the change time.
    const carried = current && current.status === "open" ? current.eligibilityStartsAt : null;
    const floor = carried && carried.getTime() <= now.getTime() ? carried : now;
    const wanted = proposed.eligibilityStartsAt;
    normalized.eligibilityStartsAt = wanted && wanted.getTime() > floor.getTime() ? wanted : floor;
    try {
      const policy = resolvePolicy(NON_COLD_GMAIL_SENDER_CATEGORY);
      const sender = policy.replyTo ?? policy.from;
      const accepted = gmail.account !== null && (sender.toLowerCase() === gmail.account || gmail.aliases.includes(sender.toLowerCase()));
      if (!accepted) problems.push("REPLY_ADDRESS_NOT_ACCEPTED_BY_CONNECTED_GMAIL");
    } catch {
      problems.push("SENDER_POLICY_UNAVAILABLE");
    }
    if (mapCheck.ok) {
      const map = proposed.sourceProgramMap as Record<string, Record<string, number>>;
      const ids = [...new Set(Object.values(map).flatMap((programs) => Object.values(programs)))];
      if (ids.length === 0) problems.push("NO_PROGRAM_MAPPED");
      for (const [source, programs] of Object.entries(map)) {
        for (const [program, id] of Object.entries(programs)) {
          const revision = await loadWarmRevision(exec, id);
          if (!revision) problems.push(`WARM_REVISION_MISSING:${source}:${program}`);
          else if (revision.program !== program) problems.push(`WARM_REVISION_PROGRAM_MISMATCH:${source}:${program}`);
          else if (revision.state !== "approved") problems.push(`WARM_REVISION_NOT_APPROVED:${source}:${program}`);
          else if (revision.unsupportedStepCount > 0) problems.push(`WARM_REVISION_HAS_UNSUPPORTED_STEPS:${source}:${program}`);
        }
      }
    }
  }
  const nextRevision = (current?.revision ?? 0) + 1;
  const configHash = mapCheck.ok
    ? hashLaneConfig({
        status: normalized.status,
        sourceProgramMap: normalized.sourceProgramMap,
        senderCategory: NON_COLD_GMAIL_SENDER_CATEGORY,
        senderAccount: normalized.senderAccount ? normalized.senderAccount.toLowerCase() : null,
        eligibilityStartsAt: normalized.eligibilityStartsAt,
        dailyLimit: normalized.dailyLimit,
      })
    : null;
  return {
    ok: problems.length === 0,
    problems,
    currentRevision: current?.revision ?? 0,
    nextRevision,
    configHash,
    effectiveEligibilityStartsAt: normalized.eligibilityStartsAt ? normalized.eligibilityStartsAt.toISOString() : null,
    normalized,
  };
}

/** Read-only: validates a proposed revision without writing anything. */
export async function previewLaneChange(
  proposed: ProposedLaneConfig,
  gmail: { account: string | null; aliases: string[] },
  now: Date = new Date(),
): Promise<LaneChangeReview> {
  const { normalized: _normalized, ...review } = await reviewProposedConfig(db, proposed, gmail, now);
  return review;
}

export type AppendLaneResult =
  | { ok: true; revisionId: number; revision: number; configHash: string }
  | { ok: false; code: "STALE_REVISION" | "INVALID"; problems: string[]; currentRevision: number };

/** Admin-only (route enforces the role). Append-only; compare-and-swap on the revision number the admin previewed. */
export async function appendLaneConfigRevision(input: {
  actorId: string;
  expectedRevision: number;
  proposed: ProposedLaneConfig;
  gmail: { account: string | null; aliases: string[] };
  note?: string | null;
  now?: Date;
}): Promise<AppendLaneResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('website-email:config', 1700))`);
    const review = await reviewProposedConfig(tx, input.proposed, input.gmail, now);
    if (review.currentRevision !== input.expectedRevision) {
      return { ok: false, code: "STALE_REVISION", problems: ["STALE_REVISION"], currentRevision: review.currentRevision } as const;
    }
    if (!review.ok || !review.configHash) return { ok: false, code: "INVALID", problems: review.problems, currentRevision: review.currentRevision } as const;
    const n = review.normalized;
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO website_lifecycle_config_revisions
        (revision, status, source_program_map, sender_category, sender_account, eligibility_starts_at, daily_limit, config_hash, created_by, note)
      VALUES (${review.nextRevision}, ${n.status}, ${JSON.stringify(n.sourceProgramMap)}::jsonb, ${NON_COLD_GMAIL_SENDER_CATEGORY},
              ${n.senderAccount ? n.senderAccount.toLowerCase() : null}, ${n.eligibilityStartsAt}, ${n.dailyLimit}, ${review.configHash},
              ${input.actorId}, ${input.note ?? null})
      RETURNING id, revision
    `))[0];
    return { ok: true, revisionId: Number(inserted.id), revision: Number(inserted.revision), configHash: review.configHash } as const;
  });
}

// ── Immutable warm revisions ─────────────────────────────────────────────────

export async function loadWarmRevision(exec: Exec, id: number): Promise<(WarmRevisionFacts & { sourceSequenceId: number | null }) | null> {
  const row = rowsOf(await exec.execute(sql`
    SELECT id, program, state, snapshot, snapshot_hash, unsupported_steps, source_sequence_id
    FROM website_warm_revisions WHERE id = ${id}
  `))[0];
  if (!row) return null;
  const unsupported = Array.isArray(row.unsupported_steps) ? row.unsupported_steps : [];
  return {
    id: Number(row.id),
    program: String(row.program),
    state: String(row.state),
    snapshot: row.snapshot,
    snapshotHash: String(row.snapshot_hash),
    unsupportedStepCount: unsupported.length,
    sourceSequenceId: row.source_sequence_id === null ? null : Number(row.source_sequence_id),
  };
}

export type CreateWarmRevisionResult =
  | { ok: true; revisionId: number; created: boolean; unsupported: UnsupportedStep[]; stepCount: number }
  | { ok: false; code: "SEQUENCE_NOT_FOUND" | "NO_EMAIL_STEPS" | "PROGRAM_INVALID" | "SNAPSHOT_INVALID"; detail?: string; unsupported?: UnsupportedStep[] };

/**
 * Freeze an email-only copy of an existing sequence. The source sequence is only READ: it is never edited, activated,
 * unpaused or enrolled. Non-email steps are listed as unsupported and block approval.
 */
export async function createWarmRevisionFromSequence(input: {
  sequenceId: number;
  program: string;
  actorId: string;
}): Promise<CreateWarmRevisionResult> {
  if (!(WARM_PROGRAMS as readonly string[]).includes(input.program)) return { ok: false, code: "PROGRAM_INVALID" };
  const program = input.program as WarmProgram;
  const sequence = rowsOf(await db.execute(sql`SELECT id, name FROM follow_up_sequences WHERE id = ${input.sequenceId}`))[0];
  if (!sequence) return { ok: false, code: "SEQUENCE_NOT_FOUND" };
  const steps = rowsOf<any>(await db.execute(sql`
    SELECT step_order, action_type, delay_days, delay_hours, subject, body
    FROM sequence_steps WHERE sequence_id = ${input.sequenceId} ORDER BY step_order ASC
  `)).map((s): LegacyStepInput => ({
    stepOrder: Number(s.step_order), actionType: String(s.action_type), delayDays: s.delay_days, delayHours: s.delay_hours, subject: s.subject, body: s.body,
  }));
  const built = buildEmailOnlySteps(steps);
  if (built.steps.length === 0) return { ok: false, code: "NO_EMAIL_STEPS", unsupported: built.unsupported };
  const snapshot: WarmSnapshot = {
    version: 1,
    program,
    purpose: PROGRAM_PURPOSE[program].warm,
    allowedChannels: ["email"],
    steps: built.steps as WarmSnapshotStep[],
    sourceSequence: { id: Number(sequence.id), name: String(sequence.name) },
  };
  const checked = validateWarmSnapshot(snapshot);
  if (!checked.ok) return { ok: false, code: "SNAPSHOT_INVALID", detail: checked.reason };
  const hash = hashWarmSnapshot(snapshot);
  const inserted = rowsOf(await db.execute(sql`
    INSERT INTO website_warm_revisions (program, source_sequence_id, communication_purpose, snapshot, snapshot_hash, unsupported_steps, state, created_by)
    VALUES (${program}, ${input.sequenceId}, ${PROGRAM_PURPOSE[program].warm}, ${JSON.stringify(snapshot)}::jsonb, ${hash},
            ${JSON.stringify(built.unsupported)}::jsonb, 'inactive', ${input.actorId})
    ON CONFLICT (program, snapshot_hash) DO NOTHING
    RETURNING id
  `))[0];
  if (inserted) return { ok: true, revisionId: Number(inserted.id), created: true, unsupported: built.unsupported, stepCount: built.steps.length };
  const existing = rowsOf(await db.execute(sql`SELECT id FROM website_warm_revisions WHERE program = ${program} AND snapshot_hash = ${hash}`))[0];
  return { ok: true, revisionId: Number(existing.id), created: false, unsupported: built.unsupported, stepCount: built.steps.length };
}

export type ApproveWarmRevisionResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "NOT_INACTIVE" | "HAS_UNSUPPORTED_STEPS" | "SNAPSHOT_INVALID" | "HASH_DRIFT"; detail?: string };

/** Approval is explicit, admin-only (route), and re-validates the stored snapshot against its hash. */
export async function approveWarmRevision(input: { revisionId: number; actorId: string }): Promise<ApproveWarmRevisionResult> {
  return db.transaction(async (tx) => {
    const row = rowsOf(await tx.execute(sql`
      SELECT id, program, state, snapshot, snapshot_hash, unsupported_steps FROM website_warm_revisions WHERE id = ${input.revisionId} FOR UPDATE
    `))[0];
    if (!row) return { ok: false, code: "NOT_FOUND" } as const;
    if (row.state !== "inactive") return { ok: false, code: "NOT_INACTIVE" } as const;
    if (Array.isArray(row.unsupported_steps) && row.unsupported_steps.length > 0) return { ok: false, code: "HAS_UNSUPPORTED_STEPS" } as const;
    const checked = validateWarmSnapshot(row.snapshot);
    if (!checked.ok || checked.snapshot.program !== row.program) return { ok: false, code: "SNAPSHOT_INVALID", detail: checked.ok ? "PROGRAM" : checked.reason } as const;
    if (hashWarmSnapshot(checked.snapshot) !== row.snapshot_hash) return { ok: false, code: "HASH_DRIFT" } as const;
    await tx.execute(sql`
      UPDATE website_warm_revisions SET state = 'approved', approved_by = ${input.actorId}, approved_at = now() WHERE id = ${input.revisionId}
    `);
    return { ok: true } as const;
  });
}

export async function retireWarmRevision(input: { revisionId: number; actorId: string }): Promise<{ ok: boolean }> {
  const updated = rowsOf(await db.execute(sql`
    UPDATE website_warm_revisions SET state = 'retired' WHERE id = ${input.revisionId} AND state <> 'retired' RETURNING id
  `));
  return { ok: updated.length === 1 };
}

// ── Fact loading ─────────────────────────────────────────────────────────────

export async function readEmailConsentFacts(exec: Exec, contactId: number, requestId: string): Promise<WarmConsentFacts> {
  try {
    const state = rowsOf(await exec.execute(sql`
      SELECT cs.permission_state FROM consent_subject_channel_states cs
      JOIN consent_subjects s ON s.id = cs.subject_id
      WHERE s.subject_type = 'contact' AND s.subject_record_id = ${contactId} AND cs.channel = 'email' AND cs.purpose = 'outreach'
      LIMIT 1
    `))[0];
    const global = rowsOf(await exec.execute(sql`
      SELECT g.is_suppressed FROM consent_subject_global_suppressions g
      JOIN consent_subjects s ON s.id = g.subject_id
      WHERE s.subject_type = 'contact' AND s.subject_record_id = ${contactId} LIMIT 1
    `))[0];
    const optIn = rowsOf(await exec.execute(sql`
      SELECT 1 AS ok FROM consent_audit_logs
      WHERE event_namespace = ${WEBSITE_EMAIL_CONSENT_NAMESPACE} AND event_key = ${websiteEmailConsentEventKey(requestId)} AND record_kind = 'canonical_fact'
      LIMIT 1
    `))[0];
    const raw = String(state?.permission_state ?? "unknown");
    const emailState: WarmConsentFacts["emailState"] = global?.is_suppressed === true ? "suppressed"
      : raw === "permitted" || raw === "withdrawn" || raw === "suppressed" ? raw : "unknown";
    return { emailState, optInForThisOccurrence: Boolean(optIn) };
  } catch {
    return { emailState: "unavailable", optInForThisOccurrence: false };
  }
}

/** Reply path is proven only when the connected mailbox owns the reply address AND its reader recently reported success. */
/**
 * Proves from the catalog that the communication ledger in this database can record a Gmail send. A CHECK on an existing
 * table is the one part of migration 0382 that a publish can silently skip, and a send that cannot be recorded must
 * never be dispatched. Every CHECK that constrains the provider column must name 'gmail'; no such CHECK also passes.
 */
export async function readProviderLedgerReady(exec: Exec): Promise<boolean> {
  const row = rowsOf<any>(await exec.execute(sql`
    SELECT count(*)::int AS blocking
    FROM pg_constraint
    WHERE conrelid = 'public.communication_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '[[:<:]]provider[[:>:]]'
      AND pg_get_constraintdef(oid) NOT LIKE '%''gmail''%'
  `))[0];
  return row !== undefined && Number(row.blocking) === 0;
}

export async function readSenderFacts(exec: Exec, now: Date): Promise<{ category: string; replyPathProven: boolean; account: string | null; replyTo: string } | null> {
  let policy: { from: string; replyTo?: string };
  try {
    policy = resolvePolicy(NON_COLD_GMAIL_SENDER_CATEGORY);
  } catch {
    return null;
  }
  const replyTo = (policy.replyTo ?? policy.from).toLowerCase();
  const { readGmailSenderEvidence } = await import("./gmail-oauth");
  const evidence = await readGmailSenderEvidence();
  const owns = evidence.account !== null && (replyTo === evidence.account || evidence.aliases.includes(replyTo));
  let fresh = false;
  if (evidence.account) {
    const reader = rowsOf(await exec.execute(sql`
      SELECT state, last_success_at FROM gmail_mailbox_reader_state WHERE account_email = ${evidence.account}
    `))[0];
    fresh = Boolean(reader && reader.state === "active" && reader.last_success_at
      && now.getTime() - new Date(reader.last_success_at).getTime() <= READER_FRESH_MS);
  }
  return { category: NON_COLD_GMAIL_SENDER_CATEGORY, replyPathProven: owns && fresh, account: evidence.account, replyTo };
}

export interface RequestFacts {
  id: string;
  occurrenceKey: string;
  sourceCategory: string;
  sourceType: string;
  manifestVersion: string;
  manifestHash: string;
  contactId: number | null;
  receivedAt: Date;
  submittedEmailHash: string | null;
}

export async function loadRequestFacts(exec: Exec, requestId: string): Promise<RequestFacts | null> {
  const row = rowsOf(await exec.execute(sql`
    SELECT id, occurrence_key, source_category, source_type, manifest_version, manifest_hash, contact_id, source_received_at, submitted_email
    FROM inbound_requests WHERE id = ${requestId}::uuid
  `))[0];
  if (!row) return null;
  return {
    id: String(row.id), occurrenceKey: String(row.occurrence_key), sourceCategory: String(row.source_category), sourceType: String(row.source_type),
    manifestVersion: String(row.manifest_version), manifestHash: String(row.manifest_hash),
    contactId: row.contact_id === null ? null : Number(row.contact_id), receivedAt: new Date(row.source_received_at),
    submittedEmailHash: emailTokenHash(row.submitted_email as string | null),
  };
}

async function loadContactFacts(exec: Exec, contactId: number) {
  const row = rowsOf(await exec.execute(sql`
    SELECT id, email, email_mutation_generation, record_class FROM contacts WHERE id = ${contactId}
  `))[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    email: (row.email as string | null) ?? null,
    emailGeneration: row.email_mutation_generation === null || row.email_mutation_generation === undefined ? null : Number(row.email_mutation_generation),
    recordClass: String(row.record_class ?? "unknown"),
  };
}

export interface AdmissionRow {
  id: number;
  intentId: number;
  enrollmentId: number | null;
  contactId: number;
  program: string;
  requestId: string;
  channel: string;
  warmRevisionId: number;
  warmRevisionHash: string;
  configRevisionId: number;
  emailTokenHash: string;
  emailGeneration: number;
  consentBasis: string;
  entryEventId: number;
  state: string;
}

export async function loadAdmission(exec: Exec, admissionId: number): Promise<AdmissionRow | null> {
  const row = rowsOf(await exec.execute(sql`
    SELECT id, intent_id, enrollment_id, contact_id, program, request_id, channel, warm_revision_id, warm_revision_hash, config_revision_id,
           email_token_hash, email_generation, consent_basis, entry_event_id, state
    FROM website_lifecycle_admissions WHERE id = ${admissionId}
  `))[0];
  if (!row) return null;
  return {
    id: Number(row.id), intentId: Number(row.intent_id), enrollmentId: row.enrollment_id === null ? null : Number(row.enrollment_id),
    contactId: Number(row.contact_id), program: String(row.program), requestId: String(row.request_id), channel: String(row.channel),
    warmRevisionId: Number(row.warm_revision_id), warmRevisionHash: String(row.warm_revision_hash), configRevisionId: Number(row.config_revision_id),
    emailTokenHash: String(row.email_token_hash), emailGeneration: Number(row.email_generation), consentBasis: String(row.consent_basis),
    entryEventId: Number(row.entry_event_id), state: String(row.state),
  };
}

export interface DecisionContext {
  decision: WarmAdmissionDecision;
  request: RequestFacts | null;
  config: LaneConfigFacts | null;
  revision: (WarmRevisionFacts & { sourceSequenceId: number | null }) | null;
  contact: { id: number; email: string | null; emailGeneration: number | null; recordClass: string } | null;
  sender: { category: string; replyPathProven: boolean; account: string | null; replyTo: string } | null;
}

/** Load every fact the pure decision needs, then decide. Used at creation, claim and immediately before provider I/O. */
export async function evaluateWarmDecision(
  exec: Exec,
  input: { boundary: WarmBoundary; program: string; requestId: string; contactId: number | null; admission: AdmissionRow | null; heldSince: Date | null; now: Date },
): Promise<DecisionContext> {
  const request = await loadRequestFacts(exec, input.requestId);
  const config = await readCurrentLaneConfig(exec);
  const source = request ? laneSourceKey(request.sourceCategory, request.sourceType) : "";
  const mapped = mappedWarmRevisionId(config, source, input.program as WarmProgram);
  const revisionId = input.admission ? input.admission.warmRevisionId : mapped;
  const revision = revisionId ? await loadWarmRevision(exec, revisionId) : null;
  const contactId = input.contactId ?? request?.contactId ?? null;
  const contact = contactId ? await loadContactFacts(exec, contactId) : null;
  const consent = contactId ? await readEmailConsentFacts(exec, contactId, input.requestId) : { emailState: "unavailable" as const, optInForThisOccurrence: false };
  const sender = await readSenderFacts(exec, input.now);
  const ledgerReady = await readProviderLedgerReady(exec);
  const admission: WarmAdmissionBinding | null = input.admission
    ? {
        state: input.admission.state, channel: input.admission.channel, program: input.admission.program, warmRevisionId: input.admission.warmRevisionId,
        warmRevisionHash: input.admission.warmRevisionHash, emailTokenHash: input.admission.emailTokenHash, emailGeneration: input.admission.emailGeneration,
      }
    : null;
  const decision = decideWebsiteWarmAdmission({
    boundary: input.boundary,
    program: input.program,
    request: request ? { sourceCategory: request.sourceCategory, sourceType: request.sourceType, manifestVersion: request.manifestVersion, receivedAt: request.receivedAt, submittedEmailHash: request.submittedEmailHash } : null,
    config,
    // At claim/before-I/O the admission's frozen revision is judged, not whatever the map points to now: a re-mapped
    // lane never silently swaps content under an existing journey.
    warmRevision: revision,
    contact,
    consent,
    sender: sender ? { category: sender.category, replyPathProven: sender.replyPathProven } : null,
    ledgerReady,
    admission,
    heldSince: input.heldSince,
    now: input.now,
  });
  return { decision, request, config, revision, contact, sender };
}

// ── Intent intake and admission ──────────────────────────────────────────────

export type IntentOutcome =
  | { state: "admitted"; intentId: number; admissionId: number; enrollmentId: number }
  | { state: "held" | "refused"; intentId: number | null; reason: WarmRefusalReason | "EFFECT_NOT_FOUND" | "REQUEST_NOT_LINKED" }
  | { state: "unchanged"; intentId: number; intentState: string };

type EffectRow = { effectId: string; effectKey: string; requestId: string; effectCreatedAt: Date };

async function setEffectState(exec: Exec, requestId: string, effectKey: string, state: "held" | "ready" | "sent" | "suppressed", reason: string | null, receipt?: string) {
  await exec.execute(sql`
    UPDATE inbound_request_effects
    SET state = ${state}, terminal_reason = ${reason}, provider_receipt = ${receipt ?? null}, updated_at = now()
    WHERE request_id = ${requestId}::uuid AND effect_key = ${effectKey} AND state IN ('held', 'ready', 'attempting')
  `);
}

/**
 * Evaluate one durable warm effect and persist the intent (and, when allowed, the enrollment + admission) under the
 * contact's graph, mailbox and communication locks. Idempotent per (occurrence, program).
 */
export async function admitWebsiteWarmEffect(effect: EffectRow, now: Date = new Date()): Promise<IntentOutcome> {
  const program = effect.effectKey.replace(/^warm_/, "");
  const head = await loadRequestFacts(db, effect.requestId);
  if (!head || head.contactId === null) return { state: "held", intentId: null, reason: "REQUEST_NOT_LINKED" };
  const contactId = head.contactId;
  const preEmail = (await loadContactFacts(db, contactId))?.email ?? null;

  return db.transaction(async (tx) => {
    // Order: mailbox → graph → communication (mailbox before any row lock, per the contact-email lock rule).
    await lockContactMailboxes(tx, [preEmail]);
    await lockCommercialGraph(tx, [{ type: "contact", id: contactId }], ["identity"]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${communicationContactLockKey(contactId).toString()}::bigint)`);

    const prior = rowsOf(await tx.execute(sql`
      SELECT id, state FROM website_lifecycle_intents WHERE occurrence_key = ${head.occurrenceKey} AND program = ${program} FOR UPDATE
    `))[0];
    if (prior && prior.state !== "held") return { state: "unchanged", intentId: Number(prior.id), intentState: String(prior.state) } as const;

    const ctx = await evaluateWarmDecision(tx, {
      boundary: "creation", program, requestId: effect.requestId, contactId, admission: null, heldSince: effect.effectCreatedAt, now,
    });
    let decision = ctx.decision;
    let reason: WarmRefusalReason | null = decision.allowed ? null : decision.reason;

    // Journey/enrollment conflicts never overwrite or contend with legacy rows. One journey per contact and program: the
    // check is deliberately independent of the warm revision and the source sequence, so remapping the program to different
    // content or a different sequence can never start a second overlapping journey for the same person.
    if (decision.allowed && ctx.revision) {
      const journey = rowsOf(await tx.execute(sql`
        SELECT id FROM website_lifecycle_admissions
        WHERE contact_id = ${contactId} AND program = ${program} AND state IN ('active', 'completed') LIMIT 1
      `))[0];
      if (journey) reason = "PRIOR_JOURNEY_EXISTS";
      else if (ctx.revision.sourceSequenceId !== null) {
        const legacy = rowsOf(await tx.execute(sql`
          SELECT status FROM sequence_enrollments
          WHERE contact_id = ${contactId} AND sequence_id = ${ctx.revision.sourceSequenceId} AND status IN ('active', 'paused') LIMIT 1
        `))[0];
        if (legacy) reason = legacy.status === "paused" ? "ENROLLMENT_CONFLICT_PAUSED" : "ENROLLMENT_CONFLICT_ACTIVE";
      }
    }

    const held = reason !== null && isHeldReason(reason);
    const intentState = reason === null ? "admitted" : held ? "held" : "refused";
    const allowed = decision.allowed && reason === null ? decision : null;

    const intent = rowsOf(await tx.execute(sql`
      INSERT INTO website_lifecycle_intents
        (occurrence_key, program, source_category, source_type, contact_id, state, reason, consent_basis, consent_event_key,
         email_token_hash, email_generation, manifest_version, manifest_hash, config_revision_id, warm_revision_id)
      VALUES (${head.occurrenceKey}, ${program}, ${head.sourceCategory}, ${head.sourceType}, ${contactId}, ${intentState}, ${reason},
              ${allowed ? allowed.consentBasis : null}, ${websiteEmailConsentEventKey(effect.requestId)},
              ${allowed ? allowed.emailTokenHash : emailTokenHash(ctx.contact?.email)}, ${allowed ? allowed.emailGeneration : ctx.contact?.emailGeneration ?? null},
              ${head.manifestVersion}, ${head.manifestHash}, ${ctx.config?.id ?? null}, ${ctx.revision?.id ?? null})
      ON CONFLICT (occurrence_key, program) DO UPDATE
        SET state = EXCLUDED.state, reason = EXCLUDED.reason, consent_basis = EXCLUDED.consent_basis, email_token_hash = EXCLUDED.email_token_hash,
            email_generation = EXCLUDED.email_generation, config_revision_id = EXCLUDED.config_revision_id, warm_revision_id = EXCLUDED.warm_revision_id,
            updated_at = now()
        WHERE website_lifecycle_intents.state = 'held'
      RETURNING id
    `))[0];
    const intentId = Number(intent?.id ?? prior?.id);

    if (!allowed) {
      await setEffectState(tx, effect.requestId, effect.effectKey, held ? "held" : "suppressed", reason);
      return { state: held ? "held" : "refused", intentId, reason: reason as WarmRefusalReason } as const;
    }

    const steps = (ctx.revision!.snapshot as WarmSnapshot).steps;
    const firstDelayMs = steps[0].delayMinutes * 60_000;
    const entry = rowsOf(await tx.execute(sql`SELECT COALESCE(MAX(id), 0) AS max_id FROM communication_events WHERE contact_id = ${contactId}`))[0];
    const enrollment = rowsOf(await tx.execute(sql`
      INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, next_action_at, metadata)
      VALUES (${ctx.revision!.sourceSequenceId}, ${contactId}, 0, 'active', ${new Date(now.getTime() + firstDelayMs)},
              ${JSON.stringify({ websiteLifecycle: { program, requestId: effect.requestId } })}::jsonb)
      ON CONFLICT (contact_id, sequence_id) WHERE status IN ('active', 'paused') DO NOTHING
      RETURNING id
    `))[0];
    if (!enrollment) {
      await tx.execute(sql`
        UPDATE website_lifecycle_intents SET state = 'held', reason = 'ENROLLMENT_CONFLICT_ACTIVE', updated_at = now() WHERE id = ${intentId}
      `);
      await setEffectState(tx, effect.requestId, effect.effectKey, "held", "ENROLLMENT_CONFLICT_ACTIVE");
      return { state: "held", intentId, reason: "ENROLLMENT_CONFLICT_ACTIVE" } as const;
    }
    const admission = rowsOf(await tx.execute(sql`
      INSERT INTO website_lifecycle_admissions
        (intent_id, enrollment_id, contact_id, program, request_id, channel, warm_revision_id, warm_revision_hash, config_revision_id,
         email_token_hash, email_generation, consent_basis, consent_event_key, entry_event_id, state)
      VALUES (${intentId}, ${Number(enrollment.id)}, ${contactId}, ${program}, ${effect.requestId}, 'email', ${allowed.warmRevisionId}, ${allowed.warmRevisionHash},
              ${allowed.configRevisionId}, ${allowed.emailTokenHash}, ${allowed.emailGeneration}, ${allowed.consentBasis},
              ${allowed.consentBasis === "email_marketing_opt_in" ? websiteEmailConsentEventKey(effect.requestId) : null}, ${Number(entry.max_id)}, 'active')
      RETURNING id
    `))[0];
    await tx.execute(sql`UPDATE sequence_enrollments SET website_admission_id = ${Number(admission.id)} WHERE id = ${Number(enrollment.id)}`);
    await setEffectState(tx, effect.requestId, effect.effectKey, "ready", null, `website_admission:${Number(admission.id)}`);
    return { state: "admitted", intentId, admissionId: Number(admission.id), enrollmentId: Number(enrollment.id) } as const;
  });
}

/** Held warm effects whose request is linked to a contact, oldest first. Recently evaluated held intents are skipped. */
export async function listPendingWarmEffects(limit: number, recheckAfterMs = 10 * 60 * 1000): Promise<EffectRow[]> {
  const rows = rowsOf<any>(await db.execute(sql`
    SELECT e.id AS effect_id, e.effect_key, e.request_id, e.created_at
    FROM inbound_request_effects e
    JOIN inbound_requests r ON r.id = e.request_id
    LEFT JOIN website_lifecycle_intents i ON i.occurrence_key = r.occurrence_key AND i.program = replace(e.effect_key, 'warm_', '')
    WHERE e.effect_type = 'website_warm_intent' AND e.state = 'held' AND r.contact_id IS NOT NULL
      AND (i.id IS NULL OR (i.state = 'held' AND i.updated_at < now() - (${Math.floor(recheckAfterMs / 1000)} * interval '1 second')))
    ORDER BY e.created_at ASC
    LIMIT ${limit}
  `));
  return rows.map((r) => ({ effectId: String(r.effect_id), effectKey: String(r.effect_key), requestId: String(r.request_id), effectCreatedAt: new Date(r.created_at) }));
}

export async function processWebsiteLifecycleIntents(opts: { limit?: number; now?: Date } = {}): Promise<{ examined: number; admitted: number; held: number; refused: number; unchanged: number }> {
  const effects = await listPendingWarmEffects(opts.limit ?? 50);
  const tally = { examined: effects.length, admitted: 0, held: 0, refused: 0, unchanged: 0 };
  for (const effect of effects) {
    const result = await admitWebsiteWarmEffect(effect, opts.now ?? new Date());
    tally[result.state === "admitted" ? "admitted" : result.state === "held" ? "held" : result.state === "refused" ? "refused" : "unchanged"]++;
  }
  return tally;
}

// ── Revocation and live verification ─────────────────────────────────────────

/** Revoke one active admission and cancel its enrollment in the caller's transaction. Idempotent. */
export async function revokeAdmissionInTx(tx: Exec, admissionId: number, reason: string): Promise<boolean> {
  const updated = rowsOf(await tx.execute(sql`
    UPDATE website_lifecycle_admissions SET state = 'revoked', revoked_reason = ${reason}, revoked_at = now()
    WHERE id = ${admissionId} AND state = 'active' RETURNING id, enrollment_id, request_id, program
  `))[0];
  if (!updated) return false;
  if (updated.enrollment_id !== null) {
    await tx.execute(sql`
      UPDATE sequence_enrollments SET status = 'cancelled', updated_at = now() WHERE id = ${Number(updated.enrollment_id)} AND status IN ('active', 'paused')
    `);
  }
  await tx.execute(sql`
    UPDATE website_lifecycle_intents SET state = 'cancelled', reason = ${reason}, updated_at = now()
    WHERE id = (SELECT intent_id FROM website_lifecycle_admissions WHERE id = ${admissionId}) AND state = 'admitted'
  `);
  await tx.execute(sql`
    UPDATE inbound_request_effects SET state = 'suppressed', terminal_reason = ${reason}, updated_at = now()
    WHERE request_id = ${String(updated.request_id)}::uuid AND effect_key = ${`warm_${String(updated.program)}`} AND state IN ('held', 'ready', 'attempting')
  `);
  return true;
}

export async function revokeAdmission(admissionId: number, reason: string): Promise<boolean> {
  return db.transaction((tx) => revokeAdmissionInTx(tx, admissionId, reason));
}

/** Revoke every active admission bound to an address (bounce evidence, address change). */
export async function revokeActiveAdmissionsForContact(contactId: number, reason: string): Promise<number> {
  const ids = rowsOf<{ id: number }>(await db.execute(sql`
    SELECT id FROM website_lifecycle_admissions WHERE contact_id = ${contactId} AND state = 'active'
  `));
  let revoked = 0;
  for (const row of ids) if (await revokeAdmission(Number(row.id), reason)) revoked++;
  return revoked;
}

/**
 * Live check used by the contactability boundary: a caller-supplied label proves nothing; only an active admission for
 * this contact and this exact inbound request, for the requested-follow-up program, over the email channel, counts.
 */
export async function verifyLiveRequestedFollowupAdmission(input: { admissionId: number; contactId: number; inboundRequestId: string }): Promise<boolean> {
  if (!Number.isInteger(input.admissionId) || input.admissionId <= 0) return false;
  const row = rowsOf(await db.execute(sql`
    SELECT 1 AS ok FROM website_lifecycle_admissions a
    JOIN sequence_enrollments e ON e.id = a.enrollment_id AND e.website_admission_id = a.id
    WHERE a.id = ${input.admissionId} AND a.state = 'active' AND a.program = 'requested_followup' AND a.channel = 'email'
      AND a.contact_id = ${input.contactId} AND a.request_id = ${input.inboundRequestId} AND e.status = 'active' LIMIT 1
  `))[0];
  return Boolean(row);
}

export const WEBSITE_LANE_SOURCES = Object.keys(WEBSITE_LANE_SOURCE_PROGRAMS);
