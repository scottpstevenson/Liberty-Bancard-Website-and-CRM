/**
 * CRO-05A inbound request authority.
 *
 * This module freezes source policy, claims one request occurrence, creates
 * held effect intents, records assignment evidence, and links work to the
 * request occurrence. It does not send, enroll, sync, create contacts/deals,
 * or replace any existing domain authority.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  inboundAssignmentDecisions,
  inboundRequestEffects,
  inboundRequestWorkLinks,
  inboundRequests,
  deals,
  equipmentOrders,
  notifications,
  tasks,
  taskAuthorityEvents,
  tickets,
  users,
  contacts,
  contactSourceEvents,
  type InboundRequest,
} from "@shared/schema";
import { inboundIntakeCohortIds, type InboundIntakeCohort } from "./inbound-request-summary";
import { resolveWorkAssignee, workPrincipalFields, WorkCommandError } from "./work-item-command";
import { auditChange } from "./audit-change";
import { getRecordedDefaultOwnerId } from "./inbound-default-owner";
import { WEBSITE_LANE_SOURCE_PROGRAMS, laneSourceKey } from "./website-email-contracts";
import { z } from "zod";
import { INQUIRY_GENERAL_INTENTS, INQUIRY_LEASE_ANSWERS, INQUIRY_VOLUME_BANDS } from "@shared/public-inquiry";
type InboundTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Source-policy contract versions. A request stores the version and hash it was claimed under; replay and
 * orchestration resolve THAT contract (see resolveStoredInboundPolicy), never the current one. v2 is frozen below and
 * must never be edited: a retried v2 occurrence keeps exactly its original effect set and never gains a warm effect.
 */
export const INBOUND_MANIFEST_VERSION = "cro05a-v3";
export const INBOUND_MANIFEST_VERSION_V2 = "cro05a-v2";
const INBOUND_CONTEXT_UNAVAILABLE_PREFIX = "Inbound context is unavailable or changed.";
const BUSINESS_DAY_START_HOUR_UTC = 9;
const BUSINESS_DAY_END_HOUR_UTC = 17;
const SALES_SLA_BUSINESS_HOURS = 24;
const SUPPORT_SLA_BUSINESS_HOURS = 4;
const FULFILLMENT_SLA_BUSINESS_HOURS = 24;
export type InboundSourceClass =
  | "sales_request"
  | "support_request"
  | "fulfillment_request"
  | "partner_application_request"
  | "privacy_request"
  | "marketing_opt_in"
  | "content_reputation"
  | "lifecycle_event"
  | "imported_provider_event";

export type EffectDefinition = {
  key: string;
  type: string;
  required: boolean;
  external: boolean;
  prerequisites?: string[];
};

export type SourcePolicy = {
  sourceCategory: string;
  sourceType: string;
  sourceClass: InboundSourceClass;
  effects: readonly EffectDefinition[];
  forbiddenEffects: readonly string[];
};

const SALES_EFFECTS: readonly EffectDefinition[] = [
  { key: "assignment", type: "sales_assignment", required: true, external: false },
  { key: "sales_work", type: "cr05_task", required: true, external: false, prerequisites: ["assignment"] },
  { key: "sales_sla", type: "sla", required: true, external: false, prerequisites: ["sales_work"] },
  { key: "transactional_ack", type: "transactional_ack", required: true, external: true },
];
const FREE_ANALYSIS_EFFECTS: readonly EffectDefinition[] = [
  ...SALES_EFFECTS,
  { key: "workflow_dispatch", type: "workflow_dispatch", required: false, external: true },
  { key: "provider_sync", type: "provider_sync", required: false, external: true },
  { key: "inbound_confirmation", type: "inbound_confirmation", required: false, external: true },
  { key: "referral_attribution", type: "referral_attribution", required: false, external: true },
  { key: "business_enrichment", type: "business_enrichment", required: false, external: true },
  { key: "lead_scoring", type: "lead_scoring", required: false, external: true },
  { key: "deal_blueprint", type: "deal_blueprint", required: false, external: true },
];
const SUPPORT_EFFECTS: readonly EffectDefinition[] = [
  { key: "support_ticket", type: "cr05_ticket", required: true, external: false },
  { key: "support_sla", type: "sla", required: true, external: false, prerequisites: ["support_ticket"] },
  { key: "transactional_ack", type: "transactional_ack", required: true, external: true },
];
const FULFILLMENT_EFFECTS: readonly EffectDefinition[] = [
  { key: "fulfillment", type: "fulfillment_order", required: true, external: false },
  { key: "fulfillment_sla", type: "sla", required: true, external: false, prerequisites: ["fulfillment"] },
  { key: "internal_notification", type: "internal_notification", required: true, external: false, prerequisites: ["fulfillment"] },
  { key: "transactional_ack", type: "transactional_ack", required: true, external: true },
];

// Partner applications and privacy requests are owned by their own records (partners / data_delete_requests). The
// inbound envelope adds the durable occurrence, an admin-only review notification, and the single receipt owner. No
// deadline is promised: no review policy exists for either source, so neither class has an SLA effect.
const REVIEW_QUEUE_EFFECTS: readonly EffectDefinition[] = [
  { key: "review_notification", type: "internal_notification", required: true, external: false },
  { key: "transactional_ack", type: "transactional_ack", required: true, external: true },
];
const REVIEW_QUEUE_FORBIDDEN = ["sales_assignment", "cr05_task", "deal_create", "promotional_enrollment", "proposal_send"] as const;

/** FROZEN cro05a-v2 contract. Do not edit: its hash pins historical occurrences. */
const INBOUND_SOURCE_POLICIES_V2: readonly SourcePolicy[] = [
  { sourceCategory: "website_form", sourceType: "estimate_form", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "get_started_form", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "callback_form", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "free_analysis", sourceClass: "sales_request", effects: FREE_ANALYSIS_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "statement_upload", sourceClass: "sales_request", effects: [...SALES_EFFECTS, { key: "statement_review", type: "statement_handoff", required: true, external: false }], forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "integration_request", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "support_form", sourceClass: "support_request", effects: SUPPORT_EFFECTS, forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "promotional_enrollment"] },
  // This adapter may create one request-owned fulfillment deal as its durable
  // order container. It remains forbidden from creating sales work or
  // promotional enrollment.
  { sourceCategory: "website_form", sourceType: "equipment_order", sourceClass: "fulfillment_request", effects: FULFILLMENT_EFFECTS, forbiddenEffects: ["sales_assignment", "cr05_task", "promotional_enrollment"] },
  { sourceCategory: "website_form", sourceType: "testimonial_submit", sourceClass: "content_reputation", effects: [{ key: "moderation", type: "moderation_review", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "promotional_enrollment"] },
  { sourceCategory: "website_form", sourceType: "newsletter_signup", sourceClass: "marketing_opt_in", effects: [{ key: "consent_evidence", type: "consent_evidence", required: true, external: false }, { key: "cr04_readiness", type: "cr04_eligibility", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "promotional_enrollment"] },
  { sourceCategory: "manual_crm", sourceType: "dashboard", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "ghl_sync", sourceType: "inbound", sourceClass: "imported_provider_event", effects: [{ key: "projection", type: "acquisition_evidence", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence"] },
  { sourceCategory: "csv_import", sourceType: "csv_contact", sourceClass: "imported_provider_event", effects: [{ key: "acquisition", type: "acquisition_evidence", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence"] },
  { sourceCategory: "csv_import", sourceType: "outscraper", sourceClass: "imported_provider_event", effects: [{ key: "acquisition", type: "acquisition_evidence", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence"] },
  { sourceCategory: "csv_import", sourceType: "apollo", sourceClass: "imported_provider_event", effects: [{ key: "acquisition", type: "acquisition_evidence", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence"] },
  { sourceCategory: "discovery", sourceType: "apollo", sourceClass: "imported_provider_event", effects: [{ key: "acquisition", type: "acquisition_evidence", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence"] },
  { sourceCategory: "partner_referral", sourceType: "partner_form", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  // Co-branded partner portal lead form: a sales request like any other website lead.
  { sourceCategory: "partner_referral", sourceType: "partner_portal", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "partner_application", sourceClass: "partner_application_request", effects: REVIEW_QUEUE_EFFECTS, forbiddenEffects: REVIEW_QUEUE_FORBIDDEN },
  { sourceCategory: "website_form", sourceType: "privacy_request", sourceClass: "privacy_request", effects: REVIEW_QUEUE_EFFECTS, forbiddenEffects: REVIEW_QUEUE_FORBIDDEN },
  // A verified provider event is an occurrence, but is not itself permission
  // to create sales work.  The provider handler remains the owner of its
  // projection/lifecycle transition; this envelope only records the event.
  { sourceCategory: "ghl_webhook", sourceType: "inbound_message", sourceClass: "lifecycle_event", effects: [{ key: "projection", type: "provider_event_projection", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence", "promotional_enrollment"] },
  { sourceCategory: "ghl_webhook", sourceType: "inbound_call", sourceClass: "lifecycle_event", effects: [{ key: "projection", type: "provider_event_projection", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence", "promotional_enrollment"] },
  { sourceCategory: "ghl_webhook", sourceType: "appointment_booked", sourceClass: "lifecycle_event", effects: [{ key: "projection", type: "provider_event_projection", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence", "promotional_enrollment"] },
  { sourceCategory: "ghl_webhook", sourceType: "chat_message", sourceClass: "lifecycle_event", effects: [{ key: "projection", type: "provider_event_projection", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence", "promotional_enrollment"] },
  { sourceCategory: "ghl_webhook", sourceType: "chat_booking", sourceClass: "lifecycle_event", effects: [{ key: "projection", type: "provider_event_projection", required: true, external: false }], forbiddenEffects: ["sales_assignment", "cr05_task", "deal_create", "consent_evidence", "promotional_enrollment"] },
];

/**
 * cro05a-v3 adds ONLY non-required, external warm-lifecycle intents to the website sources that can request them.
 * They never block the internal request (reconciliation counts required internal effects only), and the forbidden
 * list is unchanged: the legacy promotional_enrollment effect is still forbidden for these sources.
 */
function withWarmEffects(policy: SourcePolicy): SourcePolicy {
  const programs = WEBSITE_LANE_SOURCE_PROGRAMS[laneSourceKey(policy.sourceCategory, policy.sourceType)];
  if (!programs) return policy;
  return {
    ...policy,
    effects: [
      ...policy.effects,
      ...programs.map((program): EffectDefinition => ({ key: `warm_${program}`, type: "website_warm_intent", required: false, external: true })),
    ],
  };
}

/**
 * Sources added to the CURRENT (v3) contract only. They are not in the frozen v2 table (no v2 occurrence can exist for
 * them) and are deliberately absent from WEBSITE_LANE_SOURCE_PROGRAMS, so they get no warm/nurture effect, no
 * requested-follow-up eligibility and no promotional enrollment merely because they share the get-started route.
 * Their semantic intent is frozen on the occurrence by the public inquiry handler, never inferred from mutable contact data.
 */
const INBOUND_SOURCE_POLICIES_V3_ADDITIONS: readonly SourcePolicy[] = [
  { sourceCategory: "website_form", sourceType: "equipment_inquiry", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
  { sourceCategory: "website_form", sourceType: "general_inquiry", sourceClass: "sales_request", effects: SALES_EFFECTS, forbiddenEffects: ["promotional_enrollment", "proposal_send"] },
];

export const INBOUND_SOURCE_POLICIES: readonly SourcePolicy[] = [
  ...INBOUND_SOURCE_POLICIES_V2.map(withWarmEffects),
  ...INBOUND_SOURCE_POLICIES_V3_ADDITIONS,
];

const policyKey = (policy: Pick<SourcePolicy, "sourceCategory" | "sourceType">) => `${policy.sourceCategory}|${policy.sourceType}`;
const POLICY_MAP = new Map(INBOUND_SOURCE_POLICIES.map((policy) => [policyKey(policy), policy]));
const POLICY_MAP_V2 = new Map(INBOUND_SOURCE_POLICIES_V2.map((policy) => [policyKey(policy), policy]));

export function getInboundSourcePolicy(sourceCategory: string, sourceType: string): SourcePolicy {
  const policy = POLICY_MAP.get(`${sourceCategory}|${sourceType}`);
  if (!policy) throw new Error(`INVALID_INBOUND_SOURCE_COMBINATION:${sourceCategory}|${sourceType}`);
  return policy;
}

/**
 * Resolve the contract a stored occurrence was claimed under. An unknown version or a hash that no longer matches the
 * retained contract refuses visibly; it never falls back to the current (more permissive) contract.
 */
export function resolveStoredInboundPolicy(row: {
  sourceCategory: string;
  sourceType: string;
  manifestVersion: string;
  manifestHash: string;
}): SourcePolicy {
  const table = row.manifestVersion === INBOUND_MANIFEST_VERSION ? POLICY_MAP
    : row.manifestVersion === INBOUND_MANIFEST_VERSION_V2 ? POLICY_MAP_V2
    : null;
  if (!table) throw new Error(`INBOUND_POLICY_VERSION_UNSUPPORTED:${row.manifestVersion}`);
  const policy = table.get(`${row.sourceCategory}|${row.sourceType}`);
  if (!policy) throw new Error(`INVALID_INBOUND_SOURCE_COMBINATION:${row.sourceCategory}|${row.sourceType}`);
  if (manifestHash(policy, row.manifestVersion) !== row.manifestHash) {
    throw new Error(`INBOUND_POLICY_DRIFT:${row.manifestVersion}:${row.sourceCategory}|${row.sourceType}`);
  }
  return policy;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = value[key];
      return out;
    }, {});
  })).digest("hex");
}

function manifestHash(policy: SourcePolicy, version: string = INBOUND_MANIFEST_VERSION): string {
  return hashPayload({ version, policy });
}

/**
 * Add business hours using a stable UTC calendar. This intentionally has no
 * runtime locale, host timezone, or DST dependency, so a replay calculates
 * the same due instant on every worker.
 */
export function addBusinessHoursUtc(receivedAt: Date, hours: number): Date {
  if (!Number.isFinite(hours) || hours < 0) throw new Error("INVALID_BUSINESS_HOURS");
  const due = new Date(receivedAt.getTime());
  const moveToBusinessOpen = () => {
    while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() + 1);
    due.setUTCHours(BUSINESS_DAY_START_HOUR_UTC, 0, 0, 0);
  };
  if (due.getUTCDay() === 0 || due.getUTCDay() === 6
    || due.getUTCHours() >= BUSINESS_DAY_END_HOUR_UTC) {
    due.setUTCDate(due.getUTCDate() + 1);
    moveToBusinessOpen();
  } else if (due.getUTCHours() < BUSINESS_DAY_START_HOUR_UTC) {
    moveToBusinessOpen();
  }

  let remaining = hours;
  while (remaining > 0) {
    const close = new Date(due);
    close.setUTCHours(BUSINESS_DAY_END_HOUR_UTC, 0, 0, 0);
    const available = (close.getTime() - due.getTime()) / 3_600_000;
    if (remaining <= available) {
      due.setTime(due.getTime() + remaining * 3_600_000);
      break;
    }
    remaining -= available;
    due.setUTCDate(due.getUTCDate() + 1);
    moveToBusinessOpen();
  }
  return due;
}

export function inboundSlaDueAt(sourceClass: InboundSourceClass, receivedAt: Date): Date | null {
  if (sourceClass === "sales_request") return addBusinessHoursUtc(receivedAt, SALES_SLA_BUSINESS_HOURS);
  if (sourceClass === "support_request") return addBusinessHoursUtc(receivedAt, SUPPORT_SLA_BUSINESS_HOURS);
  if (sourceClass === "fulfillment_request") return addBusinessHoursUtc(receivedAt, FULFILLMENT_SLA_BUSINESS_HOURS);
  return null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InboundClaimResult =
  | { outcome: "claimed"; request: InboundRequest; policy: SourcePolicy }
  | { outcome: "replay"; request: InboundRequest; policy: SourcePolicy }
  | { outcome: "conflict" }
  | { outcome: "scope_mismatch" };

/**
 * The deliberately small public view of an inbound occurrence. Keep this
 * separate from InboundRequest so a status reader cannot accidentally return
 * entity links, assignment data, protected-object references, or payload
 * metadata to an unauthenticated caller.
 */
export type PublicInboundRequestStatus = Readonly<{
  requestReceipt: string;
  status: string;
  /** True only while a saved request still awaits its same-key recovery (never discloses the stored reason). */
  recoverable: boolean;
}>;

export async function claimInboundRequest(input: {
  idempotencyKey: string;
  occurrenceKey?: string;
  /**
   * A producer-supplied canonical fingerprint for multipart/binary requests.
   * JSON adapters use the canonical payload hash below; binary adapters must
   * include their bytes in this value before claiming the occurrence.
   */
  requestFingerprint?: string;
  /**
   * Fingerprints the SAME logical request was stored under by earlier fingerprint versions. A stored occurrence that
   * matches one of them replays exactly as before (old hashes are never rewritten, and a retry that started under an
   * older build is never turned into a conflict or a second submission). A new occurrence is always stored under the
   * current `requestFingerprint`.
   */
  legacyRequestFingerprints?: readonly string[];
  sourceCategory: string;
  sourceType: string;
  callerScope: string;
  actorType: string;
  actorId?: string | null;
  payload: unknown;
  sourceReceivedAt?: Date;
}): Promise<InboundClaimResult> {
  if (!UUID_V4.test(input.idempotencyKey)) throw new Error("INVALID_INBOUND_IDEMPOTENCY_KEY");
  const policy = getInboundSourcePolicy(input.sourceCategory, input.sourceType);
  const requestFingerprint = input.requestFingerprint || hashPayload(input.payload);
  const inserted = await db.transaction(async (tx) => {
    const [request] = await tx.insert(inboundRequests).values({
      idempotencyKey: input.idempotencyKey,
      occurrenceKey: input.occurrenceKey || input.idempotencyKey,
      requestFingerprint,
      sourceCategory: input.sourceCategory,
      sourceType: input.sourceType,
      sourceClass: policy.sourceClass,
      callerScope: input.callerScope,
      actorType: input.actorType,
      actorId: input.actorId || null,
      sourceReceivedAt: input.sourceReceivedAt || new Date(),
      manifestVersion: INBOUND_MANIFEST_VERSION,
      manifestHash: manifestHash(policy),
      lifecycleState: "claimed",
      reconciliationState: "not_required",
    }).onConflictDoNothing({ target: inboundRequests.idempotencyKey }).returning();
    if (!request) return null;
    for (const effect of policy.effects) {
      await tx.insert(inboundRequestEffects).values({
        requestId: request.id,
        effectKey: effect.key,
        effectType: effect.type,
        required: effect.required,
        externalSideEffect: effect.external,
        prerequisites: effect.prerequisites || [],
        state: "held",
      }).onConflictDoNothing({ target: [inboundRequestEffects.requestId, inboundRequestEffects.effectKey] });
    }
    return request;
  });
  if (inserted) return { outcome: "claimed", request: inserted, policy };
  const [existing] = await db.select().from(inboundRequests).where(eq(inboundRequests.idempotencyKey, input.idempotencyKey)).limit(1);
  if (!existing) return claimInboundRequest(input);
  const fingerprintMatches = existing.requestFingerprint === requestFingerprint
    || (input.legacyRequestFingerprints ?? []).includes(existing.requestFingerprint);
  if (!fingerprintMatches || existing.sourceType !== input.sourceType || existing.sourceCategory !== input.sourceCategory) return { outcome: "conflict" };
  if (existing.callerScope !== input.callerScope) return { outcome: "scope_mismatch" };
  // Replay keeps the contract the occurrence was claimed under (frozen v2 never gains v3 effects).
  return { outcome: "replay", request: existing, policy: resolveStoredInboundPolicy(existing) };
}

/** Convert a verified provider event identity into the UUID command shape used
 * by the authority.  The stable occurrence key remains the provider identity;
 * the UUID is solely the authority's replay-safe command key. */
export function providerEventCommandId(source: string, eventId: string): string {
  const hex = createHash("sha256").update(`${source}:${eventId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function claimVerifiedProviderEvent(input: {
  sourceType: "inbound_message" | "inbound_call" | "appointment_booked" | "chat_message" | "chat_booking";
  eventId: string;
  payload: unknown;
}): Promise<InboundClaimResult> {
  if (!input.eventId.trim()) throw new Error("VERIFIED_PROVIDER_EVENT_ID_REQUIRED");
  return claimInboundRequest({
    idempotencyKey: providerEventCommandId(`ghl_webhook:${input.sourceType}`, input.eventId),
    occurrenceKey: `ghl:${input.sourceType}:${input.eventId}`,
    sourceCategory: "ghl_webhook",
    sourceType: input.sourceType,
    callerScope: "provider:ghl:verified",
    actorType: "service_principal",
    actorId: "ghl",
    payload: input.payload,
  });
}

export async function linkInboundRequest(requestId: string, refs: {
  contactId?: number | null;
  dealId?: number | null;
  ticketId?: number | null;
  /** Opaque protected_objects.object_ref; never the internal row id. */
  protectedObjectRef?: string | null;
  slaDueAt?: Date | null;
  /**
   * For sources with no contact (privacy requests): the mailbox captured with the occurrence. Same immutability
   * rule as the contact snapshot; the first captured value wins.
   */
  submittedEmail?: string | null;
  lifecycleState?: "claimed" | "processing" | "accepted" | "completed" | "failed" | "cancelled" | "review_required";
}): Promise<InboundRequest | null> {
  const [updated] = await db.update(inboundRequests).set({
    contactId: refs.contactId,
    // First link snapshots the submitted mailbox; COALESCE keeps it immutable on every later link.
    ...(refs.contactId
      ? { submittedEmail: sql`COALESCE(${inboundRequests.submittedEmail}, (SELECT NULLIF(lower(btrim(email)), '') FROM contacts WHERE id = ${refs.contactId}))` }
      : refs.submittedEmail
        ? { submittedEmail: sql`COALESCE(${inboundRequests.submittedEmail}, ${refs.submittedEmail.trim().toLowerCase()})` }
        : {}),
    dealId: refs.dealId,
    ticketId: refs.ticketId,
    protectedObjectRef: refs.protectedObjectRef,
    slaDueAt: refs.slaDueAt,
    lifecycleState: refs.lifecycleState,
    updatedAt: new Date(),
  }).where(eq(inboundRequests.id, requestId)).returning();
  return updated || null;
}

export async function setInboundRequestLifecycle(
  requestId: string,
  lifecycleState: "claimed" | "processing" | "accepted" | "completed" | "failed" | "cancelled" | "review_required",
  terminalReason?: string | null,
): Promise<void> {
  await db.update(inboundRequests).set({
    lifecycleState,
    terminalReason: terminalReason || null,
    updatedAt: new Date(),
  }).where(eq(inboundRequests.id, requestId));
}

export async function transitionInboundEffect(effectId: string, input: {
  state: "held" | "ready" | "attempting" | "sent" | "failed" | "suppressed";
  terminalReason?: string | null;
  providerReceipt?: string | null;
}): Promise<boolean> {
  const result = await db.update(inboundRequestEffects).set({
    state: input.state,
    terminalReason: input.terminalReason || null,
    providerReceipt: input.providerReceipt || null,
    updatedAt: new Date(),
  }).where(and(eq(inboundRequestEffects.id, effectId), inArray(inboundRequestEffects.state, ["held", "ready", "attempting"]))).returning({ id: inboundRequestEffects.id });
  return result.length === 1;
}

type RequiredInternalEffectState = Pick<typeof inboundRequestEffects.$inferSelect, "state">;

/**
 * External intents are deliberately excluded: a held acknowledgement must not
 * prevent the internal request from advancing. Required internal intents do.
 */
export function decideInboundLifecycle(
  effects: readonly RequiredInternalEffectState[],
  incompleteState: "processing" | "review_required" = "processing",
  completedState: "accepted" | "completed" = "accepted",
): "processing" | "review_required" | "accepted" | "completed" | "failed" {
  if (effects.some((effect) => effect.state === "failed")) return "failed";
  if (effects.some((effect) => effect.state !== "sent")) return incompleteState;
  return completedState;
}

export async function reconcileInboundRequestLifecycle(input: {
  requestId: string;
  incompleteState?: "processing" | "review_required";
  completedState?: "accepted" | "completed";
  terminalReason?: string | null;
}): Promise<InboundRequest | null> {
  const effects = await db.select({ state: inboundRequestEffects.state })
    .from(inboundRequestEffects)
    .where(and(
      eq(inboundRequestEffects.requestId, input.requestId),
      eq(inboundRequestEffects.required, true),
      eq(inboundRequestEffects.externalSideEffect, false),
    ));
  const lifecycleState = decideInboundLifecycle(
    effects,
    input.incompleteState,
    input.completedState,
  );
  const [updated] = await db.update(inboundRequests).set({
    lifecycleState,
    terminalReason: lifecycleState === "failed"
      ? input.terminalReason || "REQUIRED_INTERNAL_EFFECT_FAILED"
      : null,
    updatedAt: new Date(),
  }).where(eq(inboundRequests.id, input.requestId)).returning();
  return updated || null;
}

export async function transitionInboundEffectByKey(input: {
  requestId: string;
  effectKey: string;
  state: "held" | "ready" | "attempting" | "sent" | "failed" | "suppressed";
  terminalReason?: string | null;
}): Promise<boolean> {
  const result = await db.update(inboundRequestEffects).set({
    state: input.state,
    terminalReason: input.terminalReason || null,
    updatedAt: new Date(),
  }).where(and(
    eq(inboundRequestEffects.requestId, input.requestId),
    eq(inboundRequestEffects.effectKey, input.effectKey),
  )).returning({ id: inboundRequestEffects.id });
  return result.length === 1;
}

type AssignmentPolicy = { version: string; reps: Array<{ id: string; active?: boolean; territory?: string; capacity?: number; load?: number; serviceHours?: Record<string, unknown> }> };
function readAssignmentPolicy(): { policy: AssignmentPolicy | null; hash: string } {
  const raw = process.env.INBOUND_ASSIGNMENT_POLICY_JSON;
  if (!raw) return { policy: null, hash: hashPayload({ missing: true }) };
  try {
    const policy = z.object({version:z.string().min(1).max(190),reps:z.array(z.object({
      id:z.string().min(1).max(190),active:z.boolean().optional(),territory:z.string().max(190).optional(),
      capacity:z.number().int().nonnegative().optional(),load:z.number().int().nonnegative().optional(),
      serviceHours:z.record(z.unknown()).optional(),
    }).strict()).max(200)}).strict().parse(JSON.parse(raw)) as AssignmentPolicy;
    if (new Set(policy.reps.map(r=>r.id)).size!==policy.reps.length) return {policy:null,hash:hashPayload({invalid:true})};
    return { policy, hash: hashPayload(policy) };
  } catch {
    return { policy: null, hash: hashPayload({ invalid: true }) };
  }
}

export async function evaluateInboundAssignment(input: {
  requestId: string;
  currentOwner?: string | null;
  territory?: string | null;
  actorType?: string;
  actorId?: string | null;
  contactId?: number | null;
  dealId?: number | null;
}, existingTx?: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<{ status: string; assignedTo: string | null; reasonCode: string; policyVersion: string; reviewOwner?: string | null }> {
  const { policy, hash: policyHash } = readAssignmentPolicy();
  // The administrator-recorded default owner is part of the decision's identity: changing it records a new decision.
  const defaultOwnerId = await getRecordedDefaultOwnerId();
  const hash = defaultOwnerId ? hashPayload({ base: policyHash, defaultOwnerId }) : policyHash;
  if (input.actorType && !["system","user"].includes(input.actorType)) throw new Error("INBOUND_ASSIGNMENT_ACTOR_UNAVAILABLE");
  const execute = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`);
    const [request] = await tx.select().from(inboundRequests).where(eq(inboundRequests.id,input.requestId));
    if (!request) throw new Error("INBOUND_REQUEST_NOT_FOUND");
    // Only an actual assignment is immutable. A review-required decision (class review, unavailable context, missing
    // policy) is a pending obligation that a later, genuinely different evaluation may supersede with a new ordinal.
    const [accepted] = await tx.select().from(inboundAssignmentDecisions)
      .where(and(eq(inboundAssignmentDecisions.requestId,input.requestId),isNotNull(inboundAssignmentDecisions.assignedTo)))
      .orderBy(asc(inboundAssignmentDecisions.decisionOrdinal)).limit(1);
    if ((request.contactId && input.contactId && request.contactId!==input.contactId) ||
      (request.dealId && input.dealId && request.dealId!==input.dealId)) throw new Error("INBOUND_REQUEST_LINK_CHANGED");
    const contactId = input.contactId ?? request.contactId;
    const dealId = input.dealId ?? request.dealId;
    // Trusted occurrence metadata prepares the complete principal lock set.
    // Actual ownership is rechecked below after user/agent identity pins.
    const [ownerSnapshot] = contactId ? await tx.select({assignedTo:contacts.assignedTo}).from(contacts).where(eq(contacts.id,contactId)) : [];
    // Pool identity is user ID/email only. Configured names and emails never
    // override actual account state. Pin all candidate principals before graph.
    const identities = [...new Set([...(policy?.reps.map(r=>r.id) ?? []),accepted?.assignedTo,
      input.currentOwner,request.assignedTo,ownerSnapshot?.assignedTo,defaultOwnerId].filter((id):id is string=>typeof id==="string" && !!id))];
    const principals = identities.length ? await tx.select(workPrincipalFields).from(users)
      .where(sql`${users.id} IN (${sql.join(identities.map(id=>sql`${id}`),sql`,`)})
        OR lower(${users.email}) IN (${sql.join(identities.map(id=>sql`${id.toLowerCase()}`),sql`,`)})`)
      .orderBy(asc(users.id)).for("share") : [];
    const resolved = new Map<string,typeof principals[number]>();
    for (const identity of identities) {
      try { resolved.set(identity,await resolveWorkAssignee(identity,tx,principals,true)); }
      catch(error) { if (!(error instanceof WorkCommandError)) throw error; }
    }
    // The recorded default owner is a management account (not a sales rep), so it resolves without the sales-rep link
    // requirement but must still be an active admin or manager.
    let defaultOwner: typeof principals[number] | undefined;
    if (defaultOwnerId) {
      try {
        const candidate = await resolveWorkAssignee(defaultOwnerId,tx,principals,false);
        if (["admin","manager"].includes(candidate.role || "")) defaultOwner = candidate;
      } catch(error) { if (!(error instanceof WorkCommandError)) throw error; }
    }
    // A possible ownership handoff updates these rows, so take the write-intent lock up front (a share lock held by
    // two requests for one contact would deadlock on upgrade). It still permits foreign-key checks on child rows.
    const lockMode = defaultOwner ? "no key update" : "share";
    const [contact] = contactId ? await tx.select().from(contacts).where(eq(contacts.id,contactId)).for(lockMode) : [];
    const [deal] = dealId ? await tx.select().from(deals).where(eq(deals.id,dealId)).for(lockMode) : [];
    // Newly accepted first-party contacts remain unknown until the separate
    // classification authority acts. Only this exact occurrence's immutable
    // provenance permits a generic, unlinked management review obligation.
    // It never admits the contact/deal into rep production work or assigns it.
    const occurrenceKey=request.sourceCategory==="website_form"
      ? `form:${request.sourceType}:${request.id}`
      : request.sourceCategory==="partner_referral" && request.sourceType==="partner_portal"
        ? `form:partner_portal:${request.id}`
        : request.sourceCategory==="manual_crm" && request.sourceType==="dashboard"
        ? `manual:${request.id}` : null;
    const occurrenceEvidence=contact && contact.recordClass==="unknown" && occurrenceKey
      ? await tx.select({id:contactSourceEvents.id}).from(contactSourceEvents).where(and(
        eq(contactSourceEvents.contactId,contact.id),
        eq(contactSourceEvents.sourceCategory,request.sourceCategory),
        eq(contactSourceEvents.sourceType,request.sourceType),
        eq(contactSourceEvents.eventKey,occurrenceKey),
      )).for("share") : [];
    // A deal created for the same fresh occurrence is itself unclassified (its class derives from the contact). It stays
    // inside the generic review path only while it is nonarchived, unclassified (never an explicit nonproduction class)
    // and belongs to this exact contact. A foreign-linked, archived or explicitly classified deal is still refused.
    const dealWithinClassReview=!dealId || (!!deal && !!contact && !deal.archivedAt && deal.recordClass==="unknown" && deal.contactId===contact.id);
    const classReview=occurrenceEvidence.length===1 && dealWithinClassReview;
    if (!contact || contact.archivedAt || (contact.recordClass!=="production" && !classReview) ||
      (dealId && (!deal || deal.archivedAt || (deal.recordClass!=="production" && !classReview) || deal.contactId!==contact.id))) {
      throw new WorkCommandError(`${INBOUND_CONTEXT_UNAVAILABLE_PREFIX} Review the retained request; no linked work was created.`,409);
    }
    const owns = (email:string) => !!contact && !contact.archivedAt && contact.recordClass==="production" &&
      contact.assignedTo===email && (!dealId || (!!deal && !deal.archivedAt && deal.recordClass==="production" &&
        deal.contactId===contact.id && deal.owner===email));
    let result:{status:string;assignedTo:string|null;reasonCode:string;policyVersion:string;reviewOwner?:string|null};
    if (accepted) {
      let current = accepted.assignedTo ? resolved.get(accepted.assignedTo) : undefined;
      if (accepted.assignedTo && !current && accepted.reasonCode==="DEFAULT_OWNER_ASSIGNED") {
        // A default-owner assignment names a management account, which is never a sales-rep identity.
        try {
          const management = await resolveWorkAssignee(accepted.assignedTo,tx,principals,false);
          if (["admin","manager"].includes(management.role || "")) current = management;
        } catch(error) { if (!(error instanceof WorkCommandError)) throw error; }
      }
      result = {...accepted,status:accepted.assignedTo && (!current || !owns(current.email!)) ? "review_required":accepted.status,
        reasonCode:accepted.assignedTo && (!current || !owns(current.email!)) ? "ACCEPTED_ASSIGNMENT_CURRENTLY_UNAVAILABLE":accepted.reasonCode,
        policyVersion:accepted.policyVersion ?? "missing"};
      // Never re-elect or rewrite accepted assignment or its retained task.
      await tx.update(inboundRequests).set({assignmentStatus:result.status,updatedAt:new Date()}).where(eq(inboundRequests.id,request.id));
      return result;
    }
    const eligible = (policy?.reps ?? []).filter(rep=>rep.active!==false &&
      (!input.territory || !rep.territory || rep.territory===input.territory) &&
      (rep.capacity===undefined || (rep.load ?? 0)<rep.capacity) && resolved.has(rep.id));
    const priorOwner = input.currentOwner ?? contact?.assignedTo;
    const owner = priorOwner ? resolved.get(priorOwner) : undefined;
    const selected = owner && owns(owner.email!) ? owner : [...eligible].sort((a,b)=>
      ((a.load ?? 0)-(b.load ?? 0)) || a.id.localeCompare(b.id)).map(r=>resolved.get(r.id)!).find(u=>owns(u.email!));
    // Automatic default-owner rule. Applies only when no rep owns/qualifies, the contact (and deal) are production and
    // either unowned or already the default owner's. A record that belongs to anyone else is never taken over.
    const sameEmail = (a:string|null|undefined,b:string) => !!a && a.toLowerCase()===b.toLowerCase();
    const defaultOwnerEmail = defaultOwner?.email ?? null;
    const defaultOwnerMayTake = !!defaultOwnerEmail && !classReview && !selected && !!contact && !contact.archivedAt &&
      contact.recordClass==="production" && (!contact.assignedTo || sameEmail(contact.assignedTo,defaultOwnerEmail)) &&
      (!dealId || (!!deal && !deal.archivedAt && deal.recordClass==="production" && deal.contactId===contact.id &&
        (!deal.owner || sameEmail(deal.owner,defaultOwnerEmail))));
    result = classReview ? {status:"review_required",assignedTo:null,
      reasonCode:"CONTACT_CLASS_REVIEW_REQUIRED",policyVersion:policy?.version ?? "missing",
      reviewOwner:defaultOwnerEmail} :
      selected ? {status:owner===selected?"preserved":"assigned",assignedTo:selected.email,
      reasonCode:owner===selected?"OWNER_PRESERVED":"POLICY_DETERMINISTIC_MATCH",policyVersion:policy?.version ?? "existing-owner"}
      : defaultOwnerMayTake ? {status:"assigned",assignedTo:defaultOwnerEmail,reasonCode:"DEFAULT_OWNER_ASSIGNED",
        policyVersion:`default-owner:${defaultOwner!.id}`}
      : {status:"review_required",assignedTo:null,reasonCode:!policy?"UNASSIGNED_POLICY_MISSING":
        !eligible.length?"NO_CURRENT_ELIGIBLE_REP":"OWNERSHIP_HANDOFF_REQUIRED",policyVersion:policy?.version ?? "missing"};
    // The ownership handoff commits with the decision (same transaction) so work is never assigned to an account that
    // does not own the contact it is linked to. Writes only the owner field; no sync, send or provider call is involved.
    const ownershipHandoff = async () => {
      if (!defaultOwnerMayTake || !contact || !defaultOwnerEmail) return;
      if (contact.assignedTo!==defaultOwnerEmail) {
        await tx.update(contacts).set({assignedTo:defaultOwnerEmail,updatedAt:new Date()}).where(eq(contacts.id,contact.id));
        await auditChange({actorType:"system",action:"contact_assigned",entityType:"contact",entityId:contact.id,
          details:{assignedTo:defaultOwnerEmail,previousAssignedTo:contact.assignedTo ?? null,reason:"INBOUND_DEFAULT_OWNER",requestId:request.id}},tx);
      }
      if (deal && deal.owner!==defaultOwnerEmail) {
        await tx.update(deals).set({owner:defaultOwnerEmail,updatedAt:new Date()}).where(eq(deals.id,deal.id));
        await auditChange({actorType:"system",action:"deal_owner_assigned",entityType:"deal",entityId:deal.id,
          details:{owner:defaultOwnerEmail,previousOwner:deal.owner ?? null,reason:"INBOUND_DEFAULT_OWNER",requestId:request.id}},tx);
      }
    };
    await ownershipHandoff();
    // An unchanged pending decision is not re-recorded: replays and re-evaluations leave exactly one row per distinct state.
    const [latest] = await tx.select().from(inboundAssignmentDecisions).where(eq(inboundAssignmentDecisions.requestId, input.requestId))
      .orderBy(desc(inboundAssignmentDecisions.decisionOrdinal)).limit(1);
    if (latest && latest.status===result.status && latest.assignedTo===result.assignedTo && latest.reasonCode===result.reasonCode
      && latest.policyHash===hash) {
      await tx.update(inboundRequests).set({assignmentStatus:result.status,assignedTo:result.assignedTo,updatedAt:new Date()}).where(eq(inboundRequests.id,request.id));
      return result;
    }
    const [ordinal] = await tx.select({ next: sql<number>`coalesce(max(${inboundAssignmentDecisions.decisionOrdinal}), -1) + 1` }).from(inboundAssignmentDecisions).where(eq(inboundAssignmentDecisions.requestId, input.requestId));
    await tx.insert(inboundAssignmentDecisions).values({
      requestId: input.requestId,
      decisionOrdinal: Number(ordinal?.next || 0),
      status: result.status,
      assignedTo: result.assignedTo,
      reasonCode: result.reasonCode,
      policyVersion: result.policyVersion,
      policyHash: hash,
      territory: input.territory || null,
      capacitySnapshot: {mode:"configured_load_advisory_not_reserved",reps:policy?.reps ?? [],
        defaultOwner:defaultOwnerEmail ? {userId:defaultOwner!.id,email:defaultOwnerEmail} : null},
      serviceHoursSnapshot: {mode:"not_enforced",configured:(policy?.reps ?? []).some(r=>!!r.serviceHours),
        reason:"No accepted timezone/interval enforcement contract"},
      actorType: input.actorType || "system",
      actorId: input.actorId || null,
      priorAssignee: input.currentOwner || null,
      fence: Number(ordinal?.next || 0),
    }).onConflictDoNothing({ target: [inboundAssignmentDecisions.requestId, inboundAssignmentDecisions.decisionOrdinal] });
    await tx.update(inboundRequests).set({
      assignedTo: result.assignedTo,
      assignmentStatus: result.status,
      updatedAt: new Date(),
    }).where(eq(inboundRequests.id, input.requestId));
    await auditChange({actorType:input.actorType==="user" ? "user":"system",userId:input.actorId,action:"inbound_assignment_decided",
      entityType:"inbound_request",entityKey:request.id,details:{...result,capacityMode:"advisory_not_reserved",serviceHoursMode:"not_enforced"}},tx);
    return result;
  };
  return existingTx ? execute(existingTx) : db.transaction(execute);
}

export async function linkInboundWork(input: {
  requestId: string;
  workType: "task" | "ticket";
  taskId?: number;
  ticketId?: number;
}, existingTx?: InboundTx) {
  const executor = existingTx ?? db;
  const commandKey = `inbound:${input.requestId}:${input.workType}`;
  const [link] = await executor.insert(inboundRequestWorkLinks).values({
    requestId: input.requestId,
    workType: input.workType,
    taskId: input.taskId || null,
    ticketId: input.ticketId || null,
    commandKey,
  }).onConflictDoNothing({ target: [inboundRequestWorkLinks.requestId, inboundRequestWorkLinks.workType] }).returning();
  if (link) return link;
  const [existing] = await executor.select().from(inboundRequestWorkLinks).where(and(eq(inboundRequestWorkLinks.requestId, input.requestId), eq(inboundRequestWorkLinks.workType, input.workType))).limit(1);
  return existing || null;
}

async function completeInternalEffects(requestId: string, effectKeys: readonly string[], existingTx?: InboundTx): Promise<void> {
  const executor = existingTx ?? db;
  if (!effectKeys.length) return;
  const updated = await executor.update(inboundRequestEffects).set({
    state: "sent",
    terminalReason: "INTERNAL_AUTHORITY_COMPLETED",
    updatedAt: new Date(),
  }).where(and(
    eq(inboundRequestEffects.requestId, requestId),
    inArray(inboundRequestEffects.effectKey, [...effectKeys]),
    inArray(inboundRequestEffects.state, ["held", "ready", "attempting"]),
  )).returning({ effectKey: inboundRequestEffects.effectKey });
  // A replay can find effects already truthfully completed, but an absent or
  // terminally failed required effect must never be presented as accepted.
  const completed = new Set(updated.map((effect) => effect.effectKey));
  const existing = await executor.select({
    effectKey: inboundRequestEffects.effectKey,
    state: inboundRequestEffects.state,
  }).from(inboundRequestEffects).where(and(
    eq(inboundRequestEffects.requestId, requestId),
    inArray(inboundRequestEffects.effectKey, [...effectKeys]),
  ));
  for (const effect of existing) {
    if (effect.state === "sent") completed.add(effect.effectKey);
  }
  if (completed.size !== effectKeys.length) throw new Error("INBOUND_INTERNAL_EFFECT_TRANSITION_FAILED");
}

/**
 * An SLA is complete only when the request-scoped work link and the work
 * item's own durable deadline both exist. Work creation alone is not SLA
 * evidence: a task or ticket without its deadline remains actionable only
 * after operator review.
 */
async function completeSlaEffectWhenDurable(
  requestId: string,
  effectKey: string,
  durable: boolean,
  heldReason: string,
  existingTx?: InboundTx,
): Promise<boolean> {
  if (durable) {
    await completeInternalEffects(requestId, [effectKey],existingTx);
    return true;
  }
  // Correct a previously optimistic state as well as preserving a new held
  // intent. Failed/suppressed effects retain their own terminal evidence.
  await (existingTx ?? db).update(inboundRequestEffects).set({
    state: "held",
    terminalReason: heldReason,
    updatedAt: new Date(),
  }).where(and(
    eq(inboundRequestEffects.requestId, requestId),
    eq(inboundRequestEffects.effectKey, effectKey),
    inArray(inboundRequestEffects.state, ["held", "ready", "attempting", "sent"]),
  ));
  return false;
}

async function holdInternalEffects(
  requestId: string,
  effectKeys: readonly string[],
  reason: string,
): Promise<void> {
  if (!effectKeys.length) return;
  await db.update(inboundRequestEffects).set({
    state: "held",
    terminalReason: reason,
    updatedAt: new Date(),
  }).where(and(
    eq(inboundRequestEffects.requestId, requestId),
    inArray(inboundRequestEffects.effectKey, [...effectKeys]),
    inArray(inboundRequestEffects.state, ["held", "ready", "attempting", "sent"]),
  ));
}

/**
 * Durable, truthful evidence that a sales occurrence's retained contact/deal are not an authorized production context.
 * Records one review-required assignment decision (not repeated on replay), holds the internal sales effects with the
 * reason, and creates no task and no assignment. The request keeps its exact contact/deal links.
 */
async function retainInboundContextRefusal(requestId: string, territory?: string | null): Promise<{ review: boolean }> {
  const { hash } = readAssignmentPolicy();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`);
    const [latest] = await tx.select().from(inboundAssignmentDecisions).where(eq(inboundAssignmentDecisions.requestId, requestId))
      .orderBy(desc(inboundAssignmentDecisions.decisionOrdinal)).limit(1);
    if (!(latest && latest.status === "review_required" && latest.assignedTo === null && latest.reasonCode === "INBOUND_CONTEXT_UNAVAILABLE")) {
      const [ordinal] = await tx.select({ next: sql<number>`coalesce(max(${inboundAssignmentDecisions.decisionOrdinal}), -1) + 1` })
        .from(inboundAssignmentDecisions).where(eq(inboundAssignmentDecisions.requestId, requestId));
      await tx.insert(inboundAssignmentDecisions).values({
        requestId, decisionOrdinal: Number(ordinal?.next || 0), status: "review_required", assignedTo: null,
        reasonCode: "INBOUND_CONTEXT_UNAVAILABLE", policyVersion: "context-refused", policyHash: hash, territory: territory || null,
        capacitySnapshot: { mode: "not_evaluated_context_refused", reps: [] },
        serviceHoursSnapshot: { mode: "not_enforced", configured: false, reason: "Context refused before assignment" },
        actorType: "system", actorId: null, priorAssignee: null, fence: Number(ordinal?.next || 0),
      }).onConflictDoNothing({ target: [inboundAssignmentDecisions.requestId, inboundAssignmentDecisions.decisionOrdinal] });
      await auditChange({ actorType: "system", action: "inbound_assignment_decided", entityType: "inbound_request", entityKey: requestId,
        details: { status: "review_required", reasonCode: "INBOUND_CONTEXT_UNAVAILABLE", assignedTo: null } }, tx);
    }
    await tx.update(inboundRequests).set({ assignedTo: null, assignmentStatus: "review_required", updatedAt: new Date() }).where(eq(inboundRequests.id, requestId));
    await tx.update(inboundRequestEffects).set({ state: "held", terminalReason: "INBOUND_CONTEXT_UNAVAILABLE", updatedAt: new Date() }).where(and(
      eq(inboundRequestEffects.requestId, requestId),
      inArray(inboundRequestEffects.effectKey, ["assignment", "sales_work", "sales_sla"]),
      inArray(inboundRequestEffects.state, ["held", "ready", "attempting"]),
    ));
  });
  return { review: true };
}

/**
 * Continue a retained review-required sales occurrence once its contact/deal became production through the separate
 * classification authority. It re-enters the same orchestration with the request's retained links: the same request,
 * contact, deal and task are reused, so no row is duplicated.
 */
export async function resumeInboundSalesRequestAfterReview(requestId: string): Promise<InboundRequest> {
  const request = await getInboundRequestById(requestId);
  if (!request) throw new Error("INBOUND_REQUEST_NOT_FOUND");
  if (!request.contactId) throw new Error("INBOUND_RESUME_REQUIRES_RETAINED_CONTACT");
  return orchestrateInboundRequest({ requestId, contactId: request.contactId, dealId: request.dealId });
}

export type InboundResumeOutcome =
  | { outcome: "continued"; requestReceipt: string; lifecycleState: string; assignmentStatus: string | null; assignedTo: string | null;
      taskId: number | null; reviewRevision: number | null }
  | { outcome: "already_continued"; requestReceipt: string; lifecycleState: string; assignmentStatus: string | null; assignedTo: string | null;
      taskId: number | null; reviewRevision: number | null }
  | { outcome: "blocked"; reason: string; message: string; status: 404 | 409 | 422; reviewRevision: number | null };

/** Latest assignment-decision ordinal: the revision an operator must have seen to act on a retained review. */
export async function currentInboundReviewRevision(requestId: string): Promise<number | null> {
  const [row] = await db.select({ max: sql<number | null>`max(${inboundAssignmentDecisions.decisionOrdinal})` })
    .from(inboundAssignmentDecisions).where(eq(inboundAssignmentDecisions.requestId, requestId));
  return row?.max === null || row?.max === undefined ? null : Number(row.max);
}

/**
 * Scoped, authorized continuation of one retained sales review (admin/manager entrance). Every identity, classification,
 * archive, ownership, revision and task precondition is re-read now; a failed precondition returns its real reason and
 * changes nothing. It never classifies a record, never elects an owner on its own (the existing assignment authority
 * decides from current ownership), never reopens completed human work or a terminal request, and leaves every external
 * effect held. Repeating it after success is a read-only "already continued".
 */
export async function resumeInboundSalesRequestForActor(input: {
  requestId: string;
  actorId: string;
  expectedReviewRevision: number | null;
}): Promise<InboundResumeOutcome> {
  const blocked = async (reason: string, message: string, status: 404 | 409 | 422 = 409): Promise<InboundResumeOutcome> =>
    ({ outcome: "blocked", reason, message, status, reviewRevision: await currentInboundReviewRevision(input.requestId).catch(() => null) });
  const request = await getInboundRequestById(input.requestId);
  if (!request) return blocked("REQUEST_NOT_FOUND", "The retained request no longer exists.", 404);
  if (request.sourceClass !== "sales_request") return blocked("NOT_A_SALES_REQUEST", "Only retained sales requests can be continued here.");
  const summarize = async (kind: "continued" | "already_continued", row: InboundRequest): Promise<InboundResumeOutcome> => {
    const [link] = await db.select({ taskId: inboundRequestWorkLinks.taskId }).from(inboundRequestWorkLinks).where(and(
      eq(inboundRequestWorkLinks.requestId, row.id), eq(inboundRequestWorkLinks.workType, "task"))).limit(1);
    return { outcome: kind, requestReceipt: row.id, lifecycleState: row.lifecycleState, assignmentStatus: row.assignmentStatus,
      assignedTo: row.assignedTo, taskId: link?.taskId ?? null, reviewRevision: await currentInboundReviewRevision(row.id) };
  };
  if (["accepted", "completed"].includes(request.lifecycleState)) return summarize("already_continued", request);
  if (request.lifecycleState !== "review_required") {
    return blocked("REQUEST_NOT_IN_REVIEW", `The request is ${request.lifecycleState}; only a request waiting for review can be continued.`);
  }
  if (!request.contactId) return blocked("RETAINED_CONTACT_MISSING", "The request has no retained contact link to continue from.");
  const revision = await currentInboundReviewRevision(request.id);
  if (revision === null) return blocked("NO_REVIEW_DECISION", "No review decision was recorded for this request yet.");
  if (input.expectedReviewRevision !== revision) {
    return blocked("STALE_REVIEW", "The review changed since this page loaded. Reload and review the current state.");
  }
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, request.contactId));
  if (!contact) return blocked("RETAINED_CONTACT_MISSING", "The retained contact no longer exists.");
  if (contact.archivedAt) return blocked("CONTACT_ARCHIVED", "The retained contact is archived.");
  if (request.submittedEmail && contact.email?.trim().toLowerCase() !== request.submittedEmail) {
    return blocked("CONTACT_IDENTITY_CHANGED", "The retained contact no longer matches the email captured with this request.");
  }
  if (contact.recordClass !== "production") {
    return blocked("CONTACT_NOT_CLASSIFIED_PRODUCTION", `The retained contact is classified ${contact.recordClass}; the classification review must make it production first.`, 422);
  }
  if (request.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, request.dealId));
    if (!deal) return blocked("RETAINED_DEAL_MISSING", "The retained deal no longer exists.");
    if (deal.inboundRequestId !== request.id || deal.contactId !== contact.id) {
      return blocked("DEAL_LINKED_TO_ANOTHER_OCCURRENCE", "The retained deal belongs to a different request or contact.");
    }
    if (deal.archivedAt) return blocked("DEAL_ARCHIVED", "The retained deal is archived.");
    if (deal.recordClass !== "production") {
      return blocked("DEAL_NOT_CLASSIFIED_PRODUCTION", `The retained deal is classified ${deal.recordClass}; it must be production first.`, 422);
    }
  }
  const [workLink] = await db.select({ taskId: inboundRequestWorkLinks.taskId }).from(inboundRequestWorkLinks).where(and(
    eq(inboundRequestWorkLinks.requestId, request.id), eq(inboundRequestWorkLinks.workType, "task"))).limit(1);
  if (workLink?.taskId) {
    const [task] = await db.select({ status: tasks.status, completedAt: tasks.completedAt }).from(tasks).where(eq(tasks.id, workLink.taskId));
    if (task && (task.completedAt || ["completed", "cancelled", "canceled"].includes(task.status ?? ""))) {
      return blocked("HUMAN_WORK_ALREADY_TERMINAL", "The review task was already completed or cancelled; it is not reopened.");
    }
  }
  const resumed = await orchestrateInboundRequest({ requestId: request.id, contactId: request.contactId, dealId: request.dealId });
  await auditChange({ actorType: "user", userId: input.actorId, action: "inbound_review_resumed", entityType: "inbound_request",
    entityKey: request.id, details: { fromRevision: revision, lifecycleState: resumed.lifecycleState, assignmentStatus: resumed.assignmentStatus,
      assignedTo: resumed.assignedTo, externalEffects: "held" } });
  return summarize("continued", resumed);
}

/**
 * Complete the internal portion of a claimed public occurrence.  This is the
 * only public-adapter handoff that is allowed to create CR-05 work: its command
 * key is request-derived, so two occurrences for one contact remain distinct
 * while delivery of one occurrence is replay safe.  External effects are
 * deliberately left in their original held state.
 */
/** Short, human-quotable reference for an occurrence: the first eight characters of its id, upper-cased. */
export function inboundShortRef(requestId: string): string {
  return requestId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Operator-facing copy for a statement occurrence. Only the business name and the short reference appear; no
 * statement content, file name or financial figure ever enters a task.
 */
async function statementReviewCopy(requestId: string, contactId: number | null | undefined): Promise<{ title: string; description: string }> {
  let business: string | null = null;
  if (contactId) {
    const [c] = await db.select({ companyName: contacts.companyName }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    business = c?.companyName?.trim() || null;
  }
  return {
    title: `Review statement — ${business ?? "business name not provided"}`,
    description: `Inbound statement_upload request (reference ${inboundShortRef(requestId)})`,
  };
}

/**
 * Operator-facing task copy for the W-C inquiry modes, built from the context frozen on the occurrence (never from mutable
 * contact fields). Contains the business, the intent and the answers needed to open the review, and no free text beyond the
 * bounded note, which stays on the request details.
 */
function inquiryReviewCopy(request: InboundRequest): { title: string; description: string } | null {
  if (request.sourceType !== "equipment_inquiry" && request.sourceType !== "general_inquiry") return null;
  const refs = request.attributionRefs as Record<string, unknown> | null;
  if (!refs || refs.schema !== "wc-inquiry-v1") return null;
  const business = typeof refs.businessName === "string" && refs.businessName.trim() ? refs.businessName.trim() : "business name not provided";
  const equipment = request.sourceType === "equipment_inquiry";
  const parts: string[] = [`Inbound ${request.sourceType} request (reference ${inboundShortRef(request.id)})`];
  if (equipment) {
    const band = INQUIRY_VOLUME_BANDS.find((b) => b.code === refs.volumeBand)?.label;
    const lease = INQUIRY_LEASE_ANSWERS.find((a) => a.code === refs.currentlyLeasing)?.label;
    if (typeof refs.businessType === "string") parts.push(`business type: ${refs.businessType}`);
    if (band) parts.push(`monthly card volume: ${band}`);
    if (lease) parts.push(`current terminal lease: ${lease}`);
    const offer = refs.offer as { id?: string } | null;
    if (offer?.id) parts.push(`offer: ${offer.id}`);
  } else {
    const intent = INQUIRY_GENERAL_INTENTS.find((i) => i.code === refs.intent)?.label;
    if (intent) parts.push(`interested in: ${intent}`);
  }
  return {
    title: `${equipment ? "Review equipment inquiry" : "Follow up business inquiry"} — ${business}`,
    description: parts.join("; "),
  };
}

export async function orchestrateInboundRequest(input: {
  requestId: string;
  contactId?: number | null;
  dealId?: number | null;
  ticketId?: number | null;
  equipmentOrderIds?: number[];
  notificationId?: number | null;
  territory?: string | null;
  /** Contactless sources only (privacy requests). */
  submittedEmail?: string | null;
}): Promise<InboundRequest> {
  const request = await getInboundRequestById(input.requestId);
  if (!request) throw new Error("INBOUND_REQUEST_NOT_FOUND");
  for (const key of ["contactId","dealId","ticketId"] as const) {
    if (request[key] && input[key] && request[key]!==input[key]) throw new Error("INBOUND_REQUEST_LINK_CHANGED");
  }
  const policy = resolveStoredInboundPolicy(request);
  const slaDueAt = inboundSlaDueAt(policy.sourceClass, request.sourceReceivedAt);

  try {
    const initialLink = await linkInboundRequest(request.id, {
      contactId: input.contactId ?? request.contactId,
      dealId: input.dealId ?? request.dealId,
      ticketId: input.ticketId ?? request.ticketId,
      slaDueAt: slaDueAt ?? request.slaDueAt,
      submittedEmail: input.submittedEmail,
      lifecycleState: "processing",
    });
    if (!initialLink) throw new Error("INBOUND_REQUEST_LINK_FAILED");
    let reviewRequired = false;
    if (policy.sourceClass === "sales_request") {
      let sales: { review: boolean };
      // A statement occurrence is operator work named for the business, with the short reference the merchant was
      // shown, so it can be found from the task list without opening the request first.
      const statementCopy = request.sourceType === "statement_upload"
        ? await statementReviewCopy(request.id, input.contactId ?? request.contactId)
        : inquiryReviewCopy(request);
      try {
      sales = await db.transaction(async tx => {
      const assignment = await evaluateInboundAssignment({
        requestId: request.id,
        currentOwner: request.assignedTo,
        territory: input.territory,
        actorType: "system",
        contactId:input.contactId ?? request.contactId,
        dealId:input.dealId ?? request.dealId,
      },tx);
      if (!input.contactId) throw new Error("INBOUND_SALES_REQUEST_CONTACT_REQUIRED");
      const task = await storage.createAuthorityTask({
        contactId: assignment.reasonCode==="CONTACT_CLASS_REVIEW_REQUIRED" ? undefined : input.contactId,
        dealId: assignment.reasonCode==="CONTACT_CLASS_REVIEW_REQUIRED" ? undefined : input.dealId ?? undefined,
        title: statementCopy?.title
          ?? (assignment.reasonCode==="CONTACT_CLASS_REVIEW_REQUIRED" ? "Review retained inbound request" : "Follow up inbound sales request"),
        description: `${statementCopy?.description ?? `Inbound ${request.sourceType} request`}${!assignment.assignedTo ? ` — Management assignment review: ${assignment.reasonCode}` : ""}`,
        // A request still waiting on class review has no rep owner; its generic review task goes to the recorded
        // default owner (if any). Every other review-required decision leaves the task unassigned.
        assignedTo: assignment.status==="review_required"
          ? (assignment.reasonCode==="CONTACT_CLASS_REVIEW_REQUIRED" ? assignment.reviewOwner ?? undefined : undefined)
          : assignment.assignedTo ?? undefined,
        dueDate: slaDueAt ?? undefined,
        status: "pending",
        priority: "normal",
        source: "inbound_request",
        automationKey: `inbound-sales:${request.id}`,
      }, {
        producer: "inbound_request",
        commandKey: `inbound:${request.id}:task`,
        issueKey: `inbound-sales:${request.id}`,
        context:{requestId:request.id,slaDueAt:slaDueAt?.toISOString() ?? null,assignmentReason:assignment.reasonCode,
          // Exact retained evidence for a generic review task that deliberately carries no contact/deal link.
          ...(assignment.reasonCode==="CONTACT_CLASS_REVIEW_REQUIRED" ? {retainedContactId:input.contactId,retainedDealId:input.dealId ?? null} : {})},
      },tx);
      if (assignment.reasonCode!=="CONTACT_CLASS_REVIEW_REQUIRED" && task.contactId==null) {
        // Continuation of a retained class-review obligation after the separate classification authority made the
        // contact/deal production: the SAME task (same command key, no second row) gains its links and, if one is
        // elected, its owner. Nothing here reclassifies a record.
        const owner = assignment.status==="review_required" ? null : assignment.assignedTo;
        const resumed = await tx.update(tasks).set({
          contactId: input.contactId, dealId: input.dealId ?? null,
          title: statementCopy?.title ?? "Follow up inbound sales request",
          description: `${statementCopy?.description ?? `Inbound ${request.sourceType} request`}${!assignment.assignedTo ? ` — Management assignment review: ${assignment.reasonCode}` : ""}`,
          // With no elected owner the task keeps whoever already holds it (for example the default review owner).
          ...(owner ? { assignedTo: owner, canonicalAssignee: owner } : {}),
          authorityFence: sql`${tasks.authorityFence} + 1`,
        }).where(and(eq(tasks.id,task.id),sql`${tasks.contactId} IS NULL`,
          // Completed or cancelled human work is never reopened or relinked by a continuation.
          sql`${tasks.completedAt} IS NULL AND coalesce(${tasks.status},'pending') NOT IN ('completed','cancelled','canceled')`)).returning({id:tasks.id,fence:tasks.authorityFence});
        if (resumed[0]) {
          await tx.insert(taskAuthorityEvents).values({
            taskId: task.id, eventKey: `inbound-class-review-resolved:${request.id}`, eventType: "inbound_class_review_resolved",
            producer: "inbound_request", commandKey: `inbound:${request.id}:task`, fence: resumed[0].fence,
            payload: { requestId: request.id, contactId: input.contactId, dealId: input.dealId ?? null, assignedTo: owner },
          }).onConflictDoNothing({ target: [taskAuthorityEvents.taskId, taskAuthorityEvents.eventKey] });
        }
      }
      const link = await linkInboundWork({ requestId: request.id, workType: "task", taskId: task.id },tx);
      if (!link?.taskId || link.taskId !== task.id) throw new Error("INBOUND_SALES_WORK_LINK_FAILED");
      // Occurrence replay must not overwrite a later human deadline.
      const [taskWithDueDate] = await tx.select({
        id: tasks.id,
        dueDate: tasks.dueDate,
      }).from(tasks).where(eq(tasks.id,task.id));
      await completeInternalEffects(request.id, ["sales_work"],tx);
      let review = assignment.status==="review_required";
      if (!await completeSlaEffectWhenDurable(
        request.id,
        "sales_sla",
        Boolean(link.taskId && taskWithDueDate?.dueDate && slaDueAt
          && taskWithDueDate.dueDate.getTime() === slaDueAt.getTime()),
        "SALES_SLA_TASK_DUE_DATE_OR_LINK_MISSING",
        tx,
      )) {
        review = true;
      }
      if (assignment.assignedTo && !review) {
        await completeInternalEffects(request.id, ["assignment"],tx);
      } else {
        review = true;
        await tx.update(inboundRequestEffects).set({state:"held",terminalReason:assignment.reasonCode,updatedAt:new Date()})
          .where(and(eq(inboundRequestEffects.requestId,request.id),eq(inboundRequestEffects.effectKey,"assignment")));
      }
      return {review};
      });
      } catch (error) {
        // The occurrence's retained contact/deal are not an authorized production context (explicit nonproduction class,
        // archived, or linked to another contact). Nothing is assigned or linked; the refusal is retained as durable
        // review evidence on the request instead of surfacing as a failure that hides the partial result.
        if (!(error instanceof WorkCommandError) || error.status !== 409 || !error.message.startsWith(INBOUND_CONTEXT_UNAVAILABLE_PREFIX)) throw error;
        sales = await retainInboundContextRefusal(request.id, input.territory);
      }
      reviewRequired ||= sales.review;
    } else if (policy.sourceClass === "support_request") {
      if (!input.ticketId) throw new Error("INBOUND_SUPPORT_REQUEST_TICKET_REQUIRED");
      const link = await linkInboundWork({ requestId: request.id, workType: "ticket", ticketId: input.ticketId });
      if (!link?.ticketId || link.ticketId !== input.ticketId) throw new Error("INBOUND_SUPPORT_WORK_LINK_FAILED");
      const [ticketWithDueDate] = await db.update(tickets).set({
        slaDeadline: slaDueAt ?? null,
      }).where(eq(tickets.id, input.ticketId)).returning({
        id: tickets.id,
        slaDeadline: tickets.slaDeadline,
      });
      await completeInternalEffects(request.id, ["support_ticket"]);
      if (!await completeSlaEffectWhenDurable(
        request.id,
        "support_sla",
        Boolean(link.ticketId && ticketWithDueDate?.slaDeadline && slaDueAt
          && ticketWithDueDate.slaDeadline.getTime() === slaDueAt.getTime()),
        "SUPPORT_SLA_TICKET_DUE_DATE_OR_LINK_MISSING",
      )) {
        reviewRequired = true;
      }
    } else if (policy.sourceClass === "fulfillment_request") {
      if (!input.contactId || !input.dealId || !input.notificationId
        || !input.equipmentOrderIds?.length || !slaDueAt) {
        throw new Error("FULFILLMENT_AUTHORITY_HANDOFF_REQUIRED");
      }
      const orderIds = [...new Set(input.equipmentOrderIds)];
      const [ownedDeal] = await db.select({ id: deals.id }).from(deals).where(and(
        eq(deals.id, input.dealId),
        eq(deals.inboundRequestId, request.id),
        eq(deals.contactId, input.contactId),
        eq(deals.pipeline, "fulfillment"),
      )).limit(1);
      const ownedOrders = await db.select({
        id: equipmentOrders.id,
        fulfillmentDueAt: equipmentOrders.fulfillmentDueAt,
      }).from(equipmentOrders).where(and(
        inArray(equipmentOrders.id, orderIds),
        eq(equipmentOrders.inboundRequestId, request.id),
        eq(equipmentOrders.dealId, input.dealId),
        eq(equipmentOrders.contactId, input.contactId),
      ));
      const [ownedNotification] = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.id, input.notificationId),
        eq(notifications.inboundRequestId, request.id),
        eq(notifications.commandKey, `inbound:${request.id}:equipment-notification`),
      )).limit(1);
      const durableSla = ownedOrders.length === orderIds.length
        && ownedOrders.every((order) => order.fulfillmentDueAt?.getTime() === slaDueAt.getTime());
      if (!ownedDeal || !ownedNotification || !durableSla) {
        await holdInternalEffects(
          request.id,
          ["fulfillment", "fulfillment_sla", "internal_notification"],
          "FULFILLMENT_DURABLE_EVIDENCE_MISSING",
        );
        reviewRequired = true;
      } else {
        // Only evidence already committed by the existing equipment/deal/
        // notification authorities can complete these internal effects.
        await completeInternalEffects(request.id, [
          "fulfillment",
          "fulfillment_sla",
          "internal_notification",
        ]);
      }
    } else if (policy.sourceClass === "partner_application_request" || policy.sourceClass === "privacy_request") {
      // The review notification is the only internal effect. It completes only when the admin-audience notification
      // created for THIS request is durably linked to it; otherwise it stays held and the request needs review.
      if (!input.notificationId) throw new Error("REVIEW_QUEUE_NOTIFICATION_HANDOFF_REQUIRED");
      const [ownedNotification] = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.id, input.notificationId),
        eq(notifications.inboundRequestId, request.id),
        eq(notifications.commandKey, `inbound:${request.id}:review-notification`),
      )).limit(1);
      if (!ownedNotification) {
        await holdInternalEffects(request.id, ["review_notification"], "REVIEW_NOTIFICATION_EVIDENCE_MISSING");
        reviewRequired = true;
      } else {
        await completeInternalEffects(request.id, ["review_notification"]);
      }
    } else {
      // No competing fulfillment, moderation, marketing, or import authority
      // exists here. Their required internal effects remain held for that
      // authority rather than being falsely completed by this envelope.
      reviewRequired = true;
    }

    const linked = await linkInboundRequest(request.id, {
      contactId: input.contactId ?? request.contactId,
      dealId: input.dealId ?? request.dealId,
      ticketId: input.ticketId ?? request.ticketId,
      slaDueAt: slaDueAt ?? request.slaDueAt,
      lifecycleState: reviewRequired ? "review_required" : "processing",
    });
    if (!linked) throw new Error("INBOUND_REQUEST_LINK_FAILED");
    const reconciled = await reconcileInboundRequestLifecycle({
      requestId: request.id,
      incompleteState: reviewRequired ? "review_required" : "processing",
      completedState: "accepted",
    });
    if (!reconciled) throw new Error("INBOUND_REQUEST_RECONCILIATION_FAILED");
    return reconciled;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "INBOUND_ORCHESTRATION_FAILED";
    await setInboundRequestLifecycle(request.id, reason.includes("POLICY") || reason.includes("REVIEW")
      ? "review_required"
      : "failed", reason);
    throw error;
  }
}

/**
 * An ambiguous callback has sales intent, but no safe contact identity.
 * Keep its sales effects held until an operator resolves identity. A
 * request-keyed notification is the actionable, contactless review handoff.
 * Both the handoff and review state commit atomically.
 */
export async function queueAmbiguousCallbackReview(input: {
  requestId: string;
  candidateContactIds: number[];
  name: string;
  phone: string;
  bestTime?: string;
}): Promise<InboundRequest> {
  if (input.candidateContactIds.length < 2) throw new Error("CALLBACK_REVIEW_REQUIRES_MULTIPLE_CANDIDATES");
  const request = await getInboundRequestById(input.requestId);
  if (!request || request.sourceCategory !== "website_form" || request.sourceType !== "callback_form") {
    throw new Error("CALLBACK_REVIEW_REQUEST_NOT_FOUND");
  }
  const dueAt = inboundSlaDueAt("sales_request", request.sourceReceivedAt);
  const commandKey = `inbound:${request.id}:callback-identity-review`;
  return db.transaction(async (tx) => {
    await tx.insert(notifications).values({
      inboundRequestId: request.id,
      commandKey,
      channel: "#sales",
      title: "Callback identity needs review",
      message: `Callback from ${input.name} (${input.phone}); best time: ${input.bestTime || "Anytime"}. Multiple contacts match this number. Review request ${request.id} before attaching to a contact or creating sales work.`,
      type: "alert",
      metadata: { candidateContactIds: [...new Set(input.candidateContactIds)], dueAt: dueAt?.toISOString() },
    }).onConflictDoNothing();
    const [notice] = await tx.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.inboundRequestId, request.id), eq(notifications.commandKey, commandKey))).limit(1);
    if (!notice) throw new Error("CALLBACK_REVIEW_NOTIFICATION_MISSING");
    const [updated] = await tx.update(inboundRequests).set({
      lifecycleState: "review_required",
      terminalReason: "AMBIGUOUS_CALLBACK_IDENTITY",
      assignmentStatus: "review_required",
      slaDueAt: dueAt,
      updatedAt: new Date(),
    }).where(eq(inboundRequests.id, request.id)).returning();
    if (!updated) throw new Error("CALLBACK_REVIEW_REQUEST_NOT_FOUND");
    // Sales assignment, work, SLA, and external effects remain held; no
    // candidate is treated as the owner merely because their number matches.
    return updated;
  });
}

export async function getInboundRequestById(id: string): Promise<InboundRequest | null> {
  const [row] = await db.select().from(inboundRequests).where(eq(inboundRequests.id, id)).limit(1);
  return row || null;
}

/**
 * Read a public receipt only when every capability presented by its original
 * caller matches. A miss intentionally has one result for unknown receipts,
 * incorrect idempotency keys, and caller-scope mismatches.
 */
export async function getPublicInboundRequestStatus(input: {
  requestReceipt: string;
  idempotencyKey: string;
  callerScope: string;
}): Promise<PublicInboundRequestStatus | null> {
  const [row] = await db.select({
    requestReceipt: inboundRequests.id,
    status: inboundRequests.lifecycleState,
    recoverable: sql<boolean>`coalesce(${inboundRequests.lifecycleState} = 'review_required' AND ${inboundRequests.terminalReason} = 'INBOUND_HANDOFF_RECOVERABLE', false)`,
  }).from(inboundRequests).where(and(
    eq(inboundRequests.id, input.requestReceipt),
    eq(inboundRequests.idempotencyKey, input.idempotencyKey),
    eq(inboundRequests.callerScope, input.callerScope),
  )).limit(1);
  return row || null;
}

/**
 * The short reference a requester is shown (first eight hex characters of the request id) as a lookup prefix, or null
 * when the input is not a plausible reference. Dashes and case are ignored; anything non-hex is rejected rather than
 * interpolated.
 */
export function parseInboundShortRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{4,8}$/.test(cleaned) ? cleaned : null;
}

export async function listInboundRequests(input: {
  limit?: number;
  offset?: number;
  sourceClass?: string;
  lifecycleState?: string;
  /** Exact short reference (or prefix of at least four characters) as quoted by the requester. */
  shortRef?: string;
  /** One of the Today/Overview intake populations. Uses the very predicate that counts it (inbound-request-summary.ts). */
  cohort?: { kind: InboundIntakeCohort; windowDays?: number };
}) {
  const limit = Math.min(Math.max(input.limit || 50, 1), 200);
  const offset = Math.max(input.offset || 0, 0);
  const filters = [];
  if (input.sourceClass) filters.push(eq(inboundRequests.sourceClass, input.sourceClass));
  if (input.lifecycleState) filters.push(eq(inboundRequests.lifecycleState, input.lifecycleState));
  const ref = parseInboundShortRef(input.shortRef);
  // The first uuid group is the short reference, so a text prefix on the canonical form is exact.
  if (ref) filters.push(sql`${inboundRequests.id}::text LIKE ${`${ref}%`}`);
  if (input.cohort) filters.push(sql`${inboundRequests.id} IN (${inboundIntakeCohortIds(input.cohort.kind, input.cohort.windowDays)})`);
  return db.select().from(inboundRequests)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(inboundRequests.createdAt))
    .limit(limit)
    .offset(offset);
}