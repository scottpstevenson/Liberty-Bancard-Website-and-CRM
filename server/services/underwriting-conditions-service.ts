/**
 * S5-10 — Underwriting conditions: strict commands, legal transitions, exact-context evidence binding,
 * preserved history. Every command runs in one transaction with the condition row locked, writes the
 * real string actor id, and an audit row. Nothing here sends or calls a provider.
 */
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { underwritingConditions, underwritingDecisions, deals, documents } from "@shared/schema";
import { auditChange } from "./audit-change";

export class ConditionError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = "ConditionError";
  }
}

export const CONDITION_STATUSES = ["pending", "submitted", "approved", "waived"] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

/** Legal moves. Anything back to `pending` is a reversal and requires a reason; waiving requires a reason. */
const TRANSITIONS: Record<ConditionStatus, ReadonlySet<ConditionStatus>> = {
  pending: new Set(["submitted", "waived"]),
  submitted: new Set(["approved", "waived", "pending"]),
  approved: new Set(["pending"]),
  waived: new Set(["pending"]),
};
export const canConditionTransition = (from: string, to: string) =>
  !!TRANSITIONS[from as ConditionStatus]?.has(to as ConditionStatus);

const isoOrNull = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable();

export const createConditionDto = z.object({
  conditionType: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  merchantVisible: z.boolean().optional(),
  dueDate: isoOrNull.optional(),
  decisionId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();

export const updateConditionDto = z.object({
  status: z.enum(CONDITION_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
  waivedReason: z.string().max(2000).nullable().optional(),
  reversalReason: z.string().max(2000).nullable().optional(),
  dueDate: isoOrNull.optional(),
  documentId: z.number().int().positive().nullable().optional(),
}).strict();

export const supersedeConditionDto = z.object({
  reason: z.string().trim().min(3).max(2000),
}).strict();

type Actor = { id: string | null; role?: string | null };

function requireActor(actor: Actor): string {
  if (!actor.id || typeof actor.id !== "string") {
    throw new ConditionError(401, "An authenticated actor id is required", "actor_required");
  }
  return actor.id;
}

/** The document must belong to this exact deal, or to the deal's own contact. Never a foreign deal's file. */
async function assertDocumentInContext(tx: any, dealId: number, documentId: number): Promise<void> {
  const [deal] = await tx.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new ConditionError(404, "Deal not found", "deal_not_found");
  const [doc] = await tx.select({ id: documents.id, dealId: documents.dealId, contactId: documents.contactId })
    .from(documents).where(eq(documents.id, documentId)).limit(1);
  const belongs = !!doc && (doc.dealId === dealId || (doc.dealId == null && deal.contactId != null && doc.contactId === deal.contactId));
  if (!belongs) throw new ConditionError(400, "Document does not belong to this deal", "document_out_of_context");
}

async function assertDecisionInDeal(tx: any, dealId: number, decisionId: number): Promise<void> {
  const [d] = await tx.select({ dealId: underwritingDecisions.dealId }).from(underwritingDecisions)
    .where(eq(underwritingDecisions.id, decisionId)).limit(1);
  if (!d || d.dealId !== dealId) throw new ConditionError(400, "Decision does not belong to this deal", "decision_out_of_context");
}

export async function listConditions(dealId: number, opts: { includeSuperseded?: boolean } = {}) {
  const where = opts.includeSuperseded
    ? eq(underwritingConditions.dealId, dealId)
    : and(eq(underwritingConditions.dealId, dealId), isNull(underwritingConditions.supersededAt));
  return db.select().from(underwritingConditions).where(where).orderBy(underwritingConditions.createdAt, underwritingConditions.id);
}

export async function createCondition(dealId: number, body: unknown, actor: Actor) {
  const parsed = createConditionDto.parse(body ?? {});
  const actorId = requireActor(actor);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) throw new ConditionError(404, "Deal not found", "deal_not_found");
    if (parsed.decisionId != null) await assertDecisionInDeal(tx, dealId, parsed.decisionId);
    if (parsed.documentId != null) await assertDocumentInContext(tx, dealId, parsed.documentId);
    const [row] = await tx.insert(underwritingConditions).values({
      dealId,
      decisionId: parsed.decisionId ?? null,
      documentId: parsed.documentId ?? null,
      conditionType: parsed.conditionType,
      description: parsed.description,
      merchantVisible: parsed.merchantVisible !== false,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      notes: parsed.notes ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    }).returning();
    await auditChange({ userId: actorId, action: "underwriting_condition_created", entityType: "underwriting_condition", entityId: row.id,
      details: { dealId, conditionType: parsed.conditionType, decisionId: parsed.decisionId ?? null, documentId: parsed.documentId ?? null } }, tx);
    return row;
  });
}

export async function updateCondition(id: number, body: unknown, actor: Actor) {
  const parsed = updateConditionDto.parse(body ?? {});
  const actorId = requireActor(actor);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(underwritingConditions).where(eq(underwritingConditions.id, id)).for("update").limit(1);
    if (!row) throw new ConditionError(404, "Condition not found", "condition_not_found");
    if (row.supersededAt) throw new ConditionError(409, "A superseded condition is preserved history and cannot change", "condition_superseded");

    const now = new Date();
    const updates: Record<string, unknown> = { updatedBy: actorId, updatedAt: now };
    if (parsed.notes !== undefined) updates.notes = parsed.notes;
    if (parsed.dueDate !== undefined) updates.dueDate = parsed.dueDate ? new Date(parsed.dueDate) : null;
    if (parsed.documentId !== undefined) {
      if (parsed.documentId != null) await assertDocumentInContext(tx, row.dealId, parsed.documentId);
      updates.documentId = parsed.documentId;
    }
    if (parsed.waivedReason !== undefined && parsed.status !== "waived") {
      throw new ConditionError(400, "waivedReason is only valid when waiving", "waived_reason_without_waive");
    }
    if (parsed.reversalReason !== undefined && !(parsed.status === "pending" && row.status !== "pending")) {
      throw new ConditionError(400, "reversalReason is only valid when reversing to pending", "reversal_reason_without_reversal");
    }

    const from = row.status as ConditionStatus;
    const to = parsed.status;
    if (to !== undefined && to !== from) {
      if (!canConditionTransition(from, to)) {
        throw new ConditionError(409, `Cannot move a condition from ${from} to ${to}`, "invalid_transition");
      }
      updates.status = to;
      if (to === "submitted") updates.submittedAt = now;
      if (to === "approved") {
        updates.approvedAt = now;
      }
      if (to === "waived") {
        const reason = (parsed.waivedReason ?? "").trim();
        if (reason.length < 3) throw new ConditionError(400, "A waiver reason is required", "waiver_reason_required");
        if (!(actor.role === "admin" || actor.role === "manager")) {
          throw new ConditionError(403, "Only an admin or manager can waive a condition", "waiver_not_authorized");
        }
        updates.waivedAt = now;
        updates.waivedReason = reason;
        updates.waivedBy = actorId;
      }
      if (to === "pending") {
        const reason = (parsed.reversalReason ?? "").trim();
        if (reason.length < 3) throw new ConditionError(400, "A reversal reason is required", "reversal_reason_required");
        // Reversal: the active-state timestamps clear; the prior outcome stays in the audit row.
        updates.reversedAt = now;
        updates.reversedBy = actorId;
        updates.reversalReason = reason;
        updates.submittedAt = null;
        updates.approvedAt = null;
        updates.waivedAt = null;
        updates.waivedReason = null;
        updates.waivedBy = null;
      }
    } else if (to !== undefined && parsed.waivedReason !== undefined) {
      throw new ConditionError(400, "waivedReason is only valid when waiving", "waived_reason_without_waive");
    }

    const [updated] = await tx.update(underwritingConditions).set(updates as any).where(eq(underwritingConditions.id, id)).returning();
    await auditChange({
      userId: actorId, action: "underwriting_condition_updated", entityType: "underwriting_condition", entityId: id,
      before: { status: row.status, documentId: row.documentId, approvedAt: row.approvedAt, waivedAt: row.waivedAt, waivedReason: row.waivedReason },
      after: { status: updated.status, documentId: updated.documentId, approvedAt: updated.approvedAt, waivedAt: updated.waivedAt, waivedReason: updated.waivedReason },
      details: { dealId: row.dealId, transition: to !== undefined && to !== from ? `${from}->${to}` : null },
    }, tx);
    return updated;
  });
}

/** Replaces destructive deletion: the row stays as evidence, marked superseded with who/when/why. Idempotent. */
export async function supersedeCondition(id: number, body: unknown, actor: Actor) {
  const parsed = supersedeConditionDto.parse(body ?? {});
  const actorId = requireActor(actor);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(underwritingConditions).where(eq(underwritingConditions.id, id)).for("update").limit(1);
    if (!row) throw new ConditionError(404, "Condition not found", "condition_not_found");
    if (row.supersededAt) return { condition: row, alreadySuperseded: true };
    const now = new Date();
    const [updated] = await tx.update(underwritingConditions)
      .set({ supersededAt: now, supersededBy: actorId, supersededReason: parsed.reason, updatedBy: actorId, updatedAt: now })
      .where(eq(underwritingConditions.id, id)).returning();
    await auditChange({ userId: actorId, action: "underwriting_condition_superseded", entityType: "underwriting_condition", entityId: id,
      before: { status: row.status }, details: { dealId: row.dealId, reason: parsed.reason } }, tx);
    return { condition: updated, alreadySuperseded: false };
  });
}
