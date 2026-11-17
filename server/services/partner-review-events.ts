/**
 * Append-only history of staff transitions on partner applications and introductions.
 *
 * Contract
 *  - `appendReviewEvent` takes the caller's transaction handle: the event commits or rolls back together with the status,
 *    revision and decision fields it describes. A committed transition therefore always has its actor, time, note and
 *    before/after status and revision.
 *  - This module only INSERTs and SELECTs `partner_review_events`. No code path updates or deletes a row (the source
 *    guard in the lifecycle certification fails if one appears).
 *  - Actor identity is the staff user id from the session, resolved to a display name only when read.
 */
import { asc, eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { partnerReviewEvents, users } from "@shared/schema";
import type { PartnerReviewEvent } from "@shared/schema";

export type ReviewSubjectType = "application" | "introduction";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReviewEventInput {
  subjectType: ReviewSubjectType;
  subjectId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  fromRevision: number | null;
  toRevision: number | null;
  actorId: string;
  note?: string | null;
  details?: Record<string, unknown>;
  at: Date;
}

export async function appendReviewEvent(tx: Tx, input: ReviewEventInput): Promise<PartnerReviewEvent> {
  if (!input.actorId) throw new Error("REVIEW_EVENT_ACTOR_REQUIRED");
  const [event] = await tx.insert(partnerReviewEvents).values({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    fromRevision: input.fromRevision,
    toRevision: input.toRevision,
    actorId: input.actorId,
    note: input.note ? input.note : null,
    details: input.details ?? {},
    createdAt: input.at,
  }).returning();
  return event;
}

export interface ReviewEventView {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  fromRevision: number | null;
  toRevision: number | null;
  actorId: string;
  actorName: string | null;
  note: string | null;
  details: Record<string, unknown>;
  at: string;
}

/** Oldest first, so the list reads as the order things happened. Bounded: a subject has a handful of transitions. */
export async function listReviewEvents(subjectType: ReviewSubjectType, subjectId: string, limit = 100): Promise<ReviewEventView[]> {
  const rows = await db.select().from(partnerReviewEvents)
    .where(and(eq(partnerReviewEvents.subjectType, subjectType), eq(partnerReviewEvents.subjectId, subjectId)))
    .orderBy(asc(partnerReviewEvents.createdAt), asc(partnerReviewEvents.id)).limit(Math.min(Math.max(limit, 1), 200));
  const names = await staffDisplayNames(rows.map((r) => r.actorId));
  return rows.map((r) => ({
    id: r.id, eventType: r.eventType, fromStatus: r.fromStatus, toStatus: r.toStatus,
    fromRevision: r.fromRevision, toRevision: r.toRevision, actorId: r.actorId, actorName: names.get(r.actorId) ?? null,
    note: r.note, details: (r.details ?? {}) as Record<string, unknown>, at: r.createdAt.toISOString(),
  }));
}

/** Display names for staff user ids; an id that no longer resolves stays null so the page shows the id, never a guess. */
export async function staffDisplayNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100);
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const rows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users).where(inArray(users.id, unique));
  for (const row of rows) {
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    if (name || row.email) out.set(row.id, name || String(row.email));
  }
  return out;
}
