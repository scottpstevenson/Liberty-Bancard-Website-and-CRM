/**
 * BT-04A consent authority.
 *
 * This is the only mutation path for consent, suppression, and reachability
 * facts. It creates an immutable versioned event and updates the rebuildable
 * subject projections in the same database transaction. Legacy entity fields
 * are compatibility outputs only.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

export const CONSENT_SCHEMA_VERSION = 1;
export const DEFAULT_CONSENT_PURPOSE = "outreach";
const MAX_PUBLIC_FUTURE_MS = 5 * 60 * 1000;

export type ConsentSubjectType =
  | "contact"
  | "prospect"
  | "sdr_lead_state"
  | "sdr_merchant_contact";

export type ConsentChannel = "email" | "sms" | "automated_phone" | "manual_call";
export type ConsentCommandKind =
  | "opt_in"
  | "opt_out"
  | "global_dnc"
  | "pewc_opt_in";

export interface ConsentSubjectRef {
  type: ConsentSubjectType;
  id: number;
}

export interface ConsentCommand {
  subject: ConsentSubjectRef;
  kind: ConsentCommandKind;
  channel?: ConsentChannel;
  purpose?: string;
  eventNamespace: string;
  eventKey: string;
  source: string;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  effectiveAt?: Date;
  evidence?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface ConsentCommandResult {
  subjectId: number;
  eventId: number;
  applied: boolean;
  duplicate: boolean;
  recordKind: "canonical_fact" | "decision_trace";
  reasonCode?: "global_dnc" | "newer_restriction" | "legacy_restriction";
}

export interface ReachabilityObservation {
  subject: ConsentSubjectRef;
  channel: "email" | "sms" | "phone";
  state: "unknown" | "reachable" | "bounced" | "invalid" | "undeliverable";
  eventNamespace: string;
  eventKey: string;
  source: string;
  observedAt?: Date;
  details?: Record<string, unknown>;
}

interface SubjectRow {
  id: number;
  subject_type: ConsentSubjectType;
  subject_record_id: number;
  normalized_email: string | null;
  normalized_phone: string | null;
  legacy_dnc: boolean;
  legacy_email_restricted: boolean;
  legacy_sms_restricted: boolean;
}

interface ChannelStateRow {
  id: number;
  permission_state: "unknown" | "permitted" | "withdrawn" | "suppressed";
  effective_at: Date | string;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function normalizeConsentPhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  // The application currently stores North American numbers in mixed forms.
  // Do not guess a country code for non-10/11 digit inputs.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rows(result: unknown): any[] {
  return ((result as { rows?: unknown[] })?.rows ?? []) as any[];
}

function eventIsRestrictive(kind: ConsentCommandKind): boolean {
  return kind === "opt_out" || kind === "global_dnc";
}

function commandChannel(command: ConsentCommand): ConsentChannel {
  if (command.kind === "global_dnc") return "email";
  if (!command.channel) throw new Error(`${command.kind} requires a channel`);
  return command.channel;
}

function commandConsented(command: ConsentCommand): boolean {
  return command.kind === "opt_in" || command.kind === "pewc_opt_in";
}

function eventAction(command: ConsentCommand): string {
  if (command.kind === "pewc_opt_in") return "pewc_opt_in";
  return command.kind;
}

function assertCommandShape(command: ConsentCommand, receiptAt: Date): void {
  if (!command.eventNamespace.trim() || !command.eventKey.trim()) {
    throw new Error("Canonical consent events require a namespaced stable event key");
  }
  if (!command.source.trim()) throw new Error("Canonical consent events require a source");
  if (command.kind !== "global_dnc" && !command.evidence) {
    throw new Error(`${command.kind} requires evidence; address/source inference is not consent`);
  }
  if (command.effectiveAt && command.effectiveAt.getTime() > receiptAt.getTime() + MAX_PUBLIC_FUTURE_MS) {
    throw new Error("Consent effective time cannot be materially in the future");
  }
}

async function resolveSubject(tx: any, ref: ConsentSubjectRef): Promise<SubjectRow> {
  let entity: any;
  switch (ref.type) {
    case "contact":
      entity = rows(await tx.execute(sql`
        SELECT id, email, phone, do_not_contact AS legacy_dnc,
          (email_status IN ('opted_out', 'unsubscribed') OR opted_out_email IS TRUE) AS legacy_email_restricted,
          (sms_status IN ('opted_out', 'unsubscribed', 'blocked')) AS legacy_sms_restricted
        FROM contacts WHERE id = ${ref.id}
      `))[0];
      break;
    case "prospect":
      entity = rows(await tx.execute(sql`
        SELECT id, email, phone, do_not_contact AS legacy_dnc,
          false AS legacy_email_restricted, false AS legacy_sms_restricted
        FROM prospects WHERE id = ${ref.id}
      `))[0];
      break;
    case "sdr_lead_state":
      entity = rows(await tx.execute(sql`
        SELECT id, email, phone, false AS legacy_dnc,
          opted_out_email AS legacy_email_restricted,
          opted_out_sms AS legacy_sms_restricted
        FROM sdr_lead_state WHERE id = ${ref.id}
      `))[0];
      break;
    case "sdr_merchant_contact":
      entity = rows(await tx.execute(sql`
        SELECT id, email, COALESCE(mobile, direct_phone) AS phone, false AS legacy_dnc,
          false AS legacy_email_restricted, false AS legacy_sms_restricted
        FROM sdr_merchant_contacts WHERE id = ${ref.id}
      `))[0];
      break;
  }

  if (!entity) {
    throw new Error(`Consent subject ${ref.type}:${ref.id} does not exist`);
  }

  const canonicalKey = `${ref.type}:${ref.id}`;
  const normalizedEmail = normalizeEmail(entity.email);
  const normalizedPhone = normalizeConsentPhone(entity.phone);
  const subject = rows(await tx.execute(sql`
    INSERT INTO consent_subjects (
      subject_type, subject_record_id, canonical_key, normalized_email, normalized_phone, updated_at
    ) VALUES (
      ${ref.type}, ${ref.id}, ${canonicalKey}, ${normalizedEmail}, ${normalizedPhone}, now()
    )
    ON CONFLICT (subject_type, subject_record_id)
    DO UPDATE SET
      normalized_email = EXCLUDED.normalized_email,
      normalized_phone = EXCLUDED.normalized_phone,
      updated_at = now()
    RETURNING id, subject_type, subject_record_id, normalized_email, normalized_phone
  `))[0];

  // Lock the durable subject fence before evaluating or changing projections.
  const locked = rows(await tx.execute(sql`
    SELECT id, subject_type, subject_record_id, normalized_email, normalized_phone
    FROM consent_subjects WHERE id = ${subject.id} FOR UPDATE
  `))[0];

  return {
    ...locked,
    legacy_dnc: entity.legacy_dnc === true,
    legacy_email_restricted: entity.legacy_email_restricted === true,
    legacy_sms_restricted: entity.legacy_sms_restricted === true,
  } as SubjectRow;
}

async function readGlobalSuppression(tx: any, subjectId: number): Promise<any | null> {
  return rows(await tx.execute(sql`
    SELECT * FROM consent_subject_global_suppressions
    WHERE subject_id = ${subjectId} FOR UPDATE
  `))[0] ?? null;
}

async function readChannelState(
  tx: any,
  subjectId: number,
  channel: ConsentChannel,
  purpose: string,
): Promise<ChannelStateRow | null> {
  return rows(await tx.execute(sql`
    SELECT id, permission_state, effective_at
    FROM consent_subject_channel_states
    WHERE subject_id = ${subjectId} AND channel = ${channel} AND purpose = ${purpose}
    FOR UPDATE
  `))[0] ?? null;
}

function validatePewc(subject: SubjectRow, evidence: Record<string, unknown> | undefined): void {
  const phone = normalizeConsentPhone(typeof evidence?.consentedPhone === "string" ? evidence.consentedPhone : null);
  const disclosureVersion = evidence?.disclosureVersion;
  const disclosureHash = evidence?.disclosureHash;
  if (!subject.normalized_phone || phone !== subject.normalized_phone) {
    throw new Error("PEWC evidence must bind to the subject's current normalized phone");
  }
  if (typeof disclosureVersion !== "string" || !disclosureVersion || typeof disclosureHash !== "string" || !disclosureHash) {
    throw new Error("PEWC evidence requires immutable disclosure version and hash");
  }
}

async function insertEvent(
  tx: any,
  command: ConsentCommand,
  subject: SubjectRow,
  recordKind: "canonical_fact" | "decision_trace",
  receiptAt: Date,
  effectiveAt: Date,
): Promise<{ id: number; duplicate: boolean }> {
  const event = rows(await tx.execute(sql`
    INSERT INTO consent_audit_logs (
      subject_id, contact_id, user_id, channel, action, consented, consent_type,
      source, ip_address, user_agent, details, consented_phone, disclosure_version,
      record_kind, schema_version, event_namespace, event_key, purpose, receipt_at,
      effective_at, evidence, created_at
    ) VALUES (
      ${subject.id},
      ${subject.subject_type === "contact" ? subject.subject_record_id : null},
      ${command.actorId ?? null},
      ${command.kind === "global_dnc" ? "all" : commandChannel(command)},
      ${eventAction(command)},
      ${commandConsented(command)},
      ${command.kind === "pewc_opt_in" ? "express_written" : "general_optin"},
      ${command.source},
      ${command.ipAddress ?? null},
      ${command.userAgent ?? null},
      ${command.details ?? {}},
      ${typeof command.evidence?.consentedPhone === "string" ? command.evidence.consentedPhone : null},
      ${typeof command.evidence?.disclosureVersion === "string" ? command.evidence.disclosureVersion : null},
      ${recordKind},
      ${CONSENT_SCHEMA_VERSION},
      ${command.eventNamespace},
      ${command.eventKey},
      ${command.purpose ?? DEFAULT_CONSENT_PURPOSE},
      ${receiptAt},
      ${effectiveAt},
      ${command.evidence ?? {}},
      ${receiptAt}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `))[0];

  if (event) return { id: event.id, duplicate: false };

  const existing = rows(await tx.execute(sql`
    SELECT id FROM consent_audit_logs
    WHERE record_kind = 'canonical_fact'
      AND event_namespace = ${command.eventNamespace}
      AND event_key = ${command.eventKey}
    LIMIT 1
  `))[0];
  if (!existing) {
    throw new Error("Consent event conflict did not resolve to a canonical event");
  }
  return { id: existing.id, duplicate: true };
}

async function writeCompatibilityProjection(
  tx: any,
  subject: SubjectRow,
  command: ConsentCommand,
  effectiveAt: Date,
): Promise<void> {
  const channel = command.kind === "global_dnc" ? null : commandChannel(command);
  if (subject.subject_type === "contact") {
    if (command.kind === "global_dnc") {
      await tx.execute(sql`
        UPDATE contacts SET do_not_contact = true, do_not_auto_contact = true,
          consent_email = false, consent_sms = false, consent_tier = 'do_not_contact',
          dnc_reason = ${typeof command.evidence?.reason === "string" ? command.evidence.reason : null},
          dnc_date = ${effectiveAt},
          dnc_source = ${command.source},
          suppression_reason = ${typeof command.evidence?.reason === "string" ? `do_not_contact:${command.evidence.reason}` : "do_not_contact"},
          opt_out_status = 'opted_out', opt_out_date = ${effectiveAt}, opt_out_channel = ${command.source},
          updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    } else if (command.kind === "opt_out" && channel === "email") {
      await tx.execute(sql`
        UPDATE contacts SET consent_email = false, opted_out_email = true,
          email_status = 'opted_out', updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    } else if (command.kind === "opt_out" && (channel === "sms" || channel === "automated_phone")) {
      await tx.execute(sql`
        UPDATE contacts SET consent_sms = false, sms_status = 'opted_out',
          updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    } else if (command.kind === "opt_in" && channel === "email") {
      await tx.execute(sql`
        UPDATE contacts SET consent_email = true, opted_out_email = false,
          email_status = 'active', updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    } else if (command.kind === "opt_in" && channel === "sms") {
      await tx.execute(sql`
        UPDATE contacts SET consent_sms = true, sms_status = 'active', updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    } else if (command.kind === "pewc_opt_in") {
      await tx.execute(sql`
        UPDATE contacts SET consent_sms = true, consent_tier = 'pewc_full_automation', updated_at = now()
        WHERE id = ${subject.subject_record_id}
      `);
    }
    return;
  }

  if (subject.subject_type === "prospect" && command.kind === "global_dnc") {
    await tx.execute(sql`UPDATE prospects SET do_not_contact = true, status = 'do_not_contact', updated_at = now() WHERE id = ${subject.subject_record_id}`);
    return;
  }

  if (subject.subject_type === "sdr_lead_state") {
    if (command.kind === "opt_out" && channel === "email") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_email = false, opted_out_email = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_out" && channel === "sms") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_sms = false, opted_out_sms = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_out" && channel === "automated_phone") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_call = false, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_in" && channel === "email") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_email = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_in" && channel === "sms") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_sms = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_in" && channel === "automated_phone") {
      await tx.execute(sql`UPDATE sdr_lead_state SET consent_call = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    }
    return;
  }

  if (subject.subject_type === "sdr_merchant_contact") {
    if (command.kind === "opt_in" && channel === "email") {
      await tx.execute(sql`UPDATE sdr_merchant_contacts SET consent_email = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if ((command.kind === "opt_in" || command.kind === "pewc_opt_in") && channel === "sms") {
      await tx.execute(sql`UPDATE sdr_merchant_contacts SET consent_sms = true, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_out" && channel === "email") {
      await tx.execute(sql`UPDATE sdr_merchant_contacts SET consent_email = false, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    } else if (command.kind === "opt_out" && channel === "sms") {
      await tx.execute(sql`UPDATE sdr_merchant_contacts SET consent_sms = false, updated_at = now() WHERE id = ${subject.subject_record_id}`);
    }
  }
}

/**
 * Apply one consent command. A duplicate canonical event returns the existing
 * event without replaying a projection transition.
 */
export async function applyConsentCommand(command: ConsentCommand): Promise<ConsentCommandResult> {
  const receiptAt = new Date();
  assertCommandShape(command, receiptAt);
  const effectiveAt = command.effectiveAt ?? receiptAt;

  return db.transaction(async (tx) => {
    const subject = await resolveSubject(tx, command.subject);
    // Occurrence identity spans both accepted facts and rejected decision
    // traces. Check it under the subject fence before re-evaluating state, so a
    // retry cannot turn yesterday's rejected grant into today's permission.
    const priorOccurrence = rows(await tx.execute(sql`
      SELECT id, record_kind FROM consent_audit_logs
      WHERE event_namespace = ${command.eventNamespace}
        AND event_key = ${command.eventKey}
        AND record_kind IN ('canonical_fact', 'decision_trace')
      LIMIT 1
      FOR UPDATE
    `))[0];
    if (priorOccurrence) {
      return {
        subjectId: subject.id,
        eventId: priorOccurrence.id,
        applied: false,
        duplicate: true,
        recordKind: priorOccurrence.record_kind as "canonical_fact" | "decision_trace",
      };
    }
    if (command.kind === "pewc_opt_in") validatePewc(subject, command.evidence);

    const purpose = command.purpose ?? DEFAULT_CONSENT_PURPOSE;
    const channel = command.kind === "global_dnc" ? null : commandChannel(command);
    const global = await readGlobalSuppression(tx, subject.id);
    const state = channel ? await readChannelState(tx, subject.id, channel, purpose) : null;
    // PEWC is a single grant covering both automated channels. Lock and assess
    // both before appending its event so it can never commit one projection or
    // compatibility tier while the other is protected by a newer withdrawal.
    const pewcPhoneState = command.kind === "pewc_opt_in"
      ? await readChannelState(tx, subject.id, "automated_phone", purpose)
      : null;

    let applied = true;
    let reasonCode: ConsentCommandResult["reasonCode"];
    if (eventIsRestrictive(command.kind) && state) {
      // A restriction is still history, but an older restriction must not
      // rewrite a newer permission projection or its compatibility output.
      if (effectiveAt.getTime() < asDate(state.effective_at).getTime()) {
        applied = false;
        reasonCode = "newer_restriction";
      }
    } else if (!eventIsRestrictive(command.kind)) {
      const legacyRestricted = !state && (
        subject.legacy_dnc ||
        (channel === "email" && subject.legacy_email_restricted) ||
        ((channel === "sms" || channel === "automated_phone") && subject.legacy_sms_restricted)
      );
      const protectedStates = [state, pewcPhoneState].filter(Boolean) as ChannelStateRow[];
      const currentRestrictionWins = protectedStates.some((candidate) =>
        ["withdrawn", "suppressed"].includes(candidate.permission_state) &&
        effectiveAt.getTime() <= asDate(candidate.effective_at).getTime()
      );
      if (global?.is_suppressed || subject.legacy_dnc) {
        applied = false;
        reasonCode = "global_dnc";
      } else if (legacyRestricted) {
        applied = false;
        reasonCode = "legacy_restriction";
      } else if (currentRestrictionWins) {
        // Equal-time conflicts are deliberately restrictive.
        applied = false;
        reasonCode = "newer_restriction";
      }
    }

    const recordKind = applied ? "canonical_fact" : "decision_trace";
    const event = await insertEvent(tx, command, subject, recordKind, receiptAt, effectiveAt);
    if (event.duplicate) {
      return { subjectId: subject.id, eventId: event.id, applied: false, duplicate: true, recordKind };
    }

    if (!applied) {
      return { subjectId: subject.id, eventId: event.id, applied: false, duplicate: false, recordKind, reasonCode };
    }

    if (command.kind === "global_dnc") {
      await tx.execute(sql`
        INSERT INTO consent_subject_global_suppressions (
          subject_id, is_suppressed, restriction_reason, source_event_id, effective_at, updated_at
        ) VALUES (${subject.id}, true, 'global_dnc', ${event.id}, ${effectiveAt}, now())
        ON CONFLICT (subject_id) DO UPDATE SET
          is_suppressed = true,
          restriction_reason = 'global_dnc',
          source_event_id = EXCLUDED.source_event_id,
          effective_at = GREATEST(consent_subject_global_suppressions.effective_at, EXCLUDED.effective_at),
          updated_at = now()
      `);
    } else {
      const permissionState = eventIsRestrictive(command.kind) ? "withdrawn" : "permitted";
      const channels = command.kind === "pewc_opt_in" ? ["sms", "automated_phone"] : [channel];
      for (const projectionChannel of channels) {
        await tx.execute(sql`
          INSERT INTO consent_subject_channel_states (
            subject_id, channel, purpose, permission_state, restriction_reason,
            source_event_id, effective_at, updated_at, evidence
          ) VALUES (
            ${subject.id}, ${projectionChannel}, ${purpose}, ${permissionState},
            ${eventIsRestrictive(command.kind) ? command.kind : null},
            ${event.id}, ${effectiveAt}, now(), ${command.evidence ?? {}}
          )
          ON CONFLICT (subject_id, channel, purpose) DO UPDATE SET
            permission_state = EXCLUDED.permission_state,
            restriction_reason = EXCLUDED.restriction_reason,
            source_event_id = EXCLUDED.source_event_id,
            effective_at = EXCLUDED.effective_at,
            updated_at = now(),
            evidence = EXCLUDED.evidence
          WHERE
            EXCLUDED.effective_at > consent_subject_channel_states.effective_at
            OR (
              EXCLUDED.effective_at = consent_subject_channel_states.effective_at
              AND EXCLUDED.permission_state IN ('withdrawn', 'suppressed')
              AND consent_subject_channel_states.permission_state NOT IN ('withdrawn', 'suppressed')
            )
        `);
      }
    }

    await writeCompatibilityProjection(tx, subject, command, effectiveAt);
    return { subjectId: subject.id, eventId: event.id, applied: true, duplicate: false, recordKind };
  });
}

/**
 * BT-07 merge handoff. Subjects and their immutable facts remain where they
 * originated; this appends only restrictive survivor facts keyed by operation.
 * It is safe to retry and intentionally has no inverse operation.
 */
export async function carryRestrictiveConsentForContactMerge(
  survivorContactId: number,
  deprecatedContactId: number,
  operationId: string,
): Promise<void> {
  const source = rows(await db.execute(sql`
    SELECT cs.id,
      EXISTS(SELECT 1 FROM consent_subject_global_suppressions gs WHERE gs.subject_id = cs.id) AS global_restricted
    FROM consent_subjects cs
    WHERE cs.subject_type = 'contact' AND cs.subject_record_id = ${deprecatedContactId}
    LIMIT 1
  `))[0];
  const legacy = rows(await db.execute(sql`
    SELECT do_not_contact AS global_restricted,
      (email_status IN ('opted_out', 'unsubscribed') OR opted_out_email IS TRUE) AS email_restricted,
      sms_status IN ('opted_out', 'unsubscribed', 'blocked') AS sms_restricted
    FROM contacts WHERE id = ${deprecatedContactId}
  `))[0];
  const globalRestricted = source?.global_restricted === true || legacy?.global_restricted === true;
  if (globalRestricted) {
    await applyConsentCommand({
      subject: { type: "contact", id: survivorContactId },
      kind: "global_dnc",
      purpose: DEFAULT_CONSENT_PURPOSE,
      eventNamespace: "contact_merge",
      eventKey: `${operationId}:global`,
      source: "contact_merge_restrictive_handoff",
      evidence: { operationId, sourceContactId: deprecatedContactId, handoff: "restrictive_only" },
    });
  }
  const restrictions = source ? rows(await db.execute(sql`
    SELECT channel, purpose FROM consent_subject_channel_states
    WHERE subject_id = ${source.id} AND permission_state IN ('withdrawn', 'suppressed')
  `)) : [];
  if (legacy?.email_restricted) restrictions.push({ channel: "email", purpose: DEFAULT_CONSENT_PURPOSE });
  if (legacy?.sms_restricted) restrictions.push({ channel: "sms", purpose: DEFAULT_CONSENT_PURPOSE });
  for (const restriction of restrictions) {
    const channel = restriction.channel as ConsentChannel;
    // A merge never creates a permission grant. The existing canonical command
    // vocabulary maps all channel restrictions to an opt-out fact.
    await applyConsentCommand({
      subject: { type: "contact", id: survivorContactId },
      kind: "opt_out",
      channel,
      purpose: restriction.purpose ?? DEFAULT_CONSENT_PURPOSE,
      eventNamespace: "contact_merge",
      eventKey: `${operationId}:${channel}:${restriction.purpose ?? DEFAULT_CONSENT_PURPOSE}`,
      source: "contact_merge_restrictive_handoff",
      evidence: { operationId, sourceContactId: deprecatedContactId, handoff: "restrictive_only" },
    });
  }
}

/**
 * Delivery state is deliberately recorded separately from consent. Bounces and
 * invalid addresses must never erase historical permission evidence.
 */
export async function recordReachabilityObservation(observation: ReachabilityObservation): Promise<void> {
  const receiptAt = new Date();
  if (!observation.eventNamespace || !observation.eventKey || !observation.source) {
    throw new Error("Reachability observations require a namespaced event identity and source");
  }
  const observedAt = observation.observedAt ?? receiptAt;

  await db.transaction(async (tx) => {
    const subject = await resolveSubject(tx, observation.subject);
    // The subject fence is locked by resolveSubject. Check first so a replay is
    // idempotent even on a database that has not yet received the partial
    // uniqueness index; the index remains the cross-subject race backstop.
    const existing = rows(await tx.execute(sql`
      SELECT id FROM consent_audit_logs
      WHERE record_kind = 'reachability_fact'
        AND event_namespace = ${observation.eventNamespace}
        AND event_key = ${observation.eventKey}
      LIMIT 1
      FOR UPDATE
    `))[0];
    if (existing) return;
    const inserted = rows(await tx.execute(sql`
      INSERT INTO consent_audit_logs (
        subject_id, contact_id, channel, action, consented, consent_type, source,
        details, record_kind, schema_version, event_namespace, event_key,
        receipt_at, effective_at, evidence, created_at
      ) VALUES (
        ${subject.id},
        ${subject.subject_type === "contact" ? subject.subject_record_id : null},
        ${observation.channel}, 'reachability_observed', false, 'delivery_status',
        ${observation.source}, ${observation.details ?? {}}, 'reachability_fact',
        ${CONSENT_SCHEMA_VERSION}, ${observation.eventNamespace}, ${observation.eventKey},
        ${receiptAt}, ${observedAt}, ${observation.details ?? {}}, ${receiptAt}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `))[0];
    // An occurrence key identifies immutable evidence. A concurrent insert can
    // win after the preflight check; never apply caller-supplied state on that
    // replay either.
    if (!inserted) return;
    const event = inserted;

    await tx.execute(sql`
      INSERT INTO consent_subject_reachability (
        subject_id, channel, reachability_state, source_event_id, observed_at, updated_at, details
      ) VALUES (
        ${subject.id}, ${observation.channel}, ${observation.state}, ${event.id},
        ${observedAt}, now(), ${observation.details ?? {}}
      )
      ON CONFLICT (subject_id, channel) DO UPDATE SET
        reachability_state = EXCLUDED.reachability_state,
        source_event_id = EXCLUDED.source_event_id,
        observed_at = GREATEST(consent_subject_reachability.observed_at, EXCLUDED.observed_at),
        updated_at = now(),
        details = EXCLUDED.details
      WHERE EXCLUDED.observed_at > consent_subject_reachability.observed_at
    `);
    const [current] = rows(await tx.execute(sql`
      SELECT source_event_id FROM consent_subject_reachability
      WHERE subject_id = ${subject.id} AND channel = ${observation.channel}
      FOR UPDATE
    `));
    // Legacy reachability columns remain compatibility outputs. Apply them only
    // when this observation is the projection winner; a stale replay must not
    // regress a newer contact status.
    if (current?.source_event_id === event.id && subject.subject_type === "contact") {
      if (observation.channel === "email" && observation.state === "bounced") {
        await tx.execute(sql`
          UPDATE contacts SET email_status = 'bounced', bounced_at = ${observedAt}, updated_at = now()
          WHERE id = ${subject.subject_record_id}
        `);
      } else if (observation.channel === "sms" && observation.state === "undeliverable") {
        await tx.execute(sql`
          UPDATE contacts SET sms_status = 'undeliverable', updated_at = now()
          WHERE id = ${subject.subject_record_id}
        `);
      }
    }
  });
}

export function disclosureHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}