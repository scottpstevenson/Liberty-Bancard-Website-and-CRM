import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contactSourceEvents, deals, inboundRequests, notifications,
  type InboundRequest, type InsertNotification,
} from "@shared/schema";
import { storage } from "../storage";

/**
 * Durable progress binding for the public sales occurrences (estimate, get-started, callback).
 *
 * A handler writes its contact, consent and deal BEFORE the authority links them to the request. A failure between
 * those writes used to leave real rows with no occurrence link, so the response was a generic 400 that hid them.
 * This module binds each committed step to the occurrence as it happens and, when a bind itself did not land,
 * reconstructs progress ONLY from immutable occurrence-keyed evidence (contact_source_events event key containing the
 * request id, deals.inbound_request_id). It never guesses an identity from email, name or phone.
 */

export const INBOUND_HANDOFF_RECOVERABLE = "INBOUND_HANDOFF_RECOVERABLE";
export const INBOUND_HANDOFF_RECOVERING = "INBOUND_HANDOFF_RECOVERING";

/** A claimed/processing request is only re-entered once its first execution has been silent this long. */
export function inboundRecoveryLeaseMs(): number {
  const configured = Number(process.env.INBOUND_RECOVERY_LEASE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 120_000;
}

export const RECOVERABLE_SALES_SOURCE_TYPES = ["estimate_form", "get_started_form", "callback_form"] as const;

export interface OccurrenceProgress { contactId: number | null; dealId: number | null }

/**
 * Link committed progress to the request. Refuses to change an existing link; never touches lifecycle.
 * Throws INBOUND_REQUEST_LINK_CHANGED on conflict and when the deal does not belong to this occurrence/contact.
 */
export async function bindOccurrenceProgress(requestId: string, refs: { contactId?: number | null; dealId?: number | null }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`);
    const [request] = await tx.select().from(inboundRequests).where(eq(inboundRequests.id, requestId)).for("update");
    if (!request) throw new Error("INBOUND_REQUEST_NOT_FOUND");
    if ((request.contactId && refs.contactId && request.contactId !== refs.contactId) ||
      (request.dealId && refs.dealId && request.dealId !== refs.dealId)) throw new Error("INBOUND_REQUEST_LINK_CHANGED");
    const contactId = refs.contactId ?? request.contactId;
    if (refs.dealId) {
      const [deal] = await tx.select({ contactId: deals.contactId, inboundRequestId: deals.inboundRequestId }).from(deals).where(eq(deals.id, refs.dealId));
      if (!deal || deal.inboundRequestId !== requestId || (contactId && deal.contactId !== contactId)) throw new Error("INBOUND_REQUEST_LINK_CHANGED");
    }
    const nextContact = request.contactId ?? refs.contactId ?? null;
    const nextDeal = request.dealId ?? refs.dealId ?? null;
    if (nextContact === request.contactId && nextDeal === request.dealId) return;
    await tx.update(inboundRequests).set({
      contactId: nextContact,
      dealId: nextDeal,
      ...(nextContact
        ? { submittedEmail: sql`COALESCE(${inboundRequests.submittedEmail}, (SELECT NULLIF(lower(btrim(email)), '') FROM contacts WHERE id = ${nextContact}))` }
        : {}),
      updatedAt: new Date(),
    }).where(eq(inboundRequests.id, requestId));
  });
}

/**
 * Committed progress for one occurrence from its own immutable links/evidence. Returns null when nothing is committed or
 * the evidence is ambiguous/conflicting (never bind on a guess).
 */
export async function resolveCommittedOccurrenceProgress(requestId: string): Promise<OccurrenceProgress | null> {
  const [request] = await db.select().from(inboundRequests).where(eq(inboundRequests.id, requestId)).limit(1);
  if (!request || request.sourceCategory !== "website_form") return null;
  const eventKey = `form:${request.sourceType}:${request.id}`;
  const evidence = await db.selectDistinct({ contactId: contactSourceEvents.contactId }).from(contactSourceEvents).where(and(
    eq(contactSourceEvents.sourceCategory, "website_form"),
    eq(contactSourceEvents.sourceType, request.sourceType),
    eq(contactSourceEvents.eventKey, eventKey),
  ));
  if (evidence.length > 1) return null;
  const evidencedContact = evidence[0]?.contactId ?? null;
  if (request.contactId && evidencedContact && request.contactId !== evidencedContact) return null;
  const [deal] = await db.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.inboundRequestId, request.id)).limit(1);
  if (request.dealId && deal && request.dealId !== deal.id) return null;
  const contactId = request.contactId ?? evidencedContact ?? deal?.contactId ?? null;
  if (deal && contactId && deal.contactId !== contactId) return null;
  const dealId = request.dealId ?? deal?.id ?? null;
  if (!contactId) return null;
  return { contactId, dealId };
}

/** True when the retained contact already carries THIS occurrence's immutable source event (fresh write completed). */
export async function contactHasOccurrenceEvidence(requestId: string, sourceType: string, contactId: number): Promise<boolean> {
  const rows = await db.select({ id: contactSourceEvents.id }).from(contactSourceEvents).where(and(
    eq(contactSourceEvents.contactId, contactId),
    eq(contactSourceEvents.sourceCategory, "website_form"),
    eq(contactSourceEvents.sourceType, sourceType),
    eq(contactSourceEvents.eventKey, `form:${sourceType}:${requestId}`),
  )).limit(1);
  return rows.length > 0;
}

/** Existing deal for this occurrence (unique on inbound_request_id). */
export async function findOccurrenceDeal(requestId: string) {
  const [deal] = await db.select().from(deals).where(eq(deals.inboundRequestId, requestId)).limit(1);
  return deal ?? null;
}

/** True when the PEWC canonical fact for this exact occurrence event is already recorded. */
export async function pewcDecisionRecorded(eventKey: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 AS present FROM consent_audit_logs
    WHERE record_kind = 'canonical_fact' AND event_namespace = 'pewc' AND event_key = ${`${eventKey}:pewc`}
    LIMIT 1`)) as unknown as { rows?: unknown[] } | unknown[];
  const list = Array.isArray(rows) ? rows : rows.rows ?? [];
  return list.length > 0;
}

/** One internal sales notification per occurrence (command-key identity); a recovery never creates a second. */
export async function ensureOccurrenceNotification(requestId: string, input: InsertNotification) {
  const commandKey = `inbound:${requestId}:sales-notification`;
  const [existing] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.commandKey, commandKey)).limit(1);
  if (existing) return existing;
  try {
    return await storage.createNotification({ ...input, inboundRequestId: requestId, commandKey });
  } catch (error) {
    const [raced] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.commandKey, commandKey)).limit(1);
    if (raced) return raced;
    throw error;
  }
}

/**
 * Atomically take the right to re-enter a public sales handler for an unfinished occurrence. Only the winner returns
 * the request; a concurrent or later replay gets null and answers normally. Eligible: an explicit recoverable hold, or a
 * claimed/processing request whose first execution has been silent past the lease.
 */
export async function claimInboundRecovery(requestId: string): Promise<InboundRequest | null> {
  const leaseMs = inboundRecoveryLeaseMs();
  const [claimed] = await db.update(inboundRequests).set({
    lifecycleState: "processing", terminalReason: INBOUND_HANDOFF_RECOVERING, updatedAt: new Date(),
  }).where(and(
    eq(inboundRequests.id, requestId),
    inArray(inboundRequests.sourceType, [...RECOVERABLE_SALES_SOURCE_TYPES]),
    sql`(
      (${inboundRequests.lifecycleState} = 'review_required' AND ${inboundRequests.terminalReason} = ${INBOUND_HANDOFF_RECOVERABLE})
      OR (${inboundRequests.lifecycleState} IN ('claimed','processing') AND ${inboundRequests.updatedAt} < now() - (${leaseMs} * interval '1 millisecond'))
    )`,
  )).returning();
  return claimed ?? null;
}
