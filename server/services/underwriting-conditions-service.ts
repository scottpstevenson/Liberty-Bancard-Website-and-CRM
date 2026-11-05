/**
 * S5-10 — Underwriting conditions: strict commands, legal transitions, exact-context evidence binding,
 * preserved history. Every command runs in one transaction with the condition row locked, writes the
 * real string actor id, and an audit row. Nothing here sends or calls a provider.
 */
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
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

/**
 * A new or re-opened merchant-visible obligation changes what the chase must say. Bump the obligation version and
 * re-open a settled chase so the merchant is told about it. A chase currently `sending` is left alone: its settle
 * step compares versions and re-opens itself.
 */
async function markChaseObligationChanged(tx: any, dealId: number): Promise<void> {
  const updated = await tx.execute(sql`
    UPDATE underwriting_condition_chases
    SET obligation_version = obligation_version + 1,
        status = CASE WHEN status IN ('sent','not_applicable') THEN 'owed' ELSE status END,
        next_check_at = NULL, updated_at = now()
    WHERE deal_id = ${dealId} AND channel = 'email'
    RETURNING id`);
  if (((updated as any).rows ?? updated).length > 0) return;
  // The first manual condition for a deal has no chase row to update: create the owed obligation in the same
  // transaction, capturing the current mailbox owner (version 1). A concurrent first writer is a no-op.
  await tx.execute(sql`
    INSERT INTO underwriting_condition_chases (deal_id, channel, recipient_email, recipient_name, status)
    SELECT d.id, 'email', NULLIF(trim(c.email), ''), NULLIF(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), 'owed'
    FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ${dealId}
    ON CONFLICT (deal_id, channel) DO UPDATE SET
      obligation_version = underwriting_condition_chases.obligation_version + 1,
      status = CASE WHEN underwriting_condition_chases.status IN ('sent','not_applicable') THEN 'owed' ELSE underwriting_condition_chases.status END,
      next_check_at = NULL, updated_at = now()`);
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
    if (row.merchantVisible) await markChaseObligationChanged(tx, dealId);
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
      if (to === "approved" || to === "waived") {
        // Effective state: a reversal is in force only until the condition is settled again. Readiness reads
        // `reversed_at IS NULL`, so a re-approved condition must clear it; the reversal itself (actor, time, reason)
        // stays in this condition's audit history, which this update's before/after state records.
        updates.reversedAt = null;
        updates.reversedBy = null;
        updates.reversalReason = null;
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
    if (updates.status === "pending" && row.status !== "pending" && row.merchantVisible) await markChaseObligationChanged(tx, row.dealId);
    await auditChange({
      userId: actorId, action: "underwriting_condition_updated", entityType: "underwriting_condition", entityId: id,
      before: { status: row.status, documentId: row.documentId, approvedAt: row.approvedAt, waivedAt: row.waivedAt, waivedReason: row.waivedReason,
        reversedAt: row.reversedAt, reversedBy: row.reversedBy, reversalReason: row.reversalReason },
      after: { status: updated.status, documentId: updated.documentId, approvedAt: updated.approvedAt, waivedAt: updated.waivedAt, waivedReason: updated.waivedReason,
        reversedAt: updated.reversedAt, reversedBy: updated.reversedBy, reversalReason: updated.reversalReason },
      details: {
        dealId: row.dealId, transition: to !== undefined && to !== from ? `${from}->${to}` : null,
        ...(updates.status === "pending" ? { reversalReason: updates.reversalReason } : {}),
        ...(updates.documentId !== undefined && updates.documentId !== row.documentId ? { documentId: updates.documentId } : {}),
      },
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

/**
 * Read-only chase state for the operator. `held` means an earlier send may have reached the merchant: the operator
 * can see it but there is deliberately no resend path for it.
 */
export async function readChaseState(dealId: number) {
  const res = (await db.execute(sql`
    SELECT status, attempts, last_reason, last_attempt_at, sent_at, recipient_version, obligation_version,
           sent_recipient_version, sent_obligation_version, next_check_at,
           (recipient_email IS NOT NULL) AS has_recipient
    FROM underwriting_condition_chases WHERE deal_id = ${dealId} AND channel = 'email'`)) as any;
  const r = res.rows?.[0];
  if (!r) return null;
  const reason = typeof r.last_reason === "string" ? r.last_reason : null;
  return {
    status: r.status as string,
    state: r.status === "sending" ? "held_unknown_outcome" : r.status === "owed" ? "owed" : r.status === "sent" ? "sent" : "not_applicable",
    attempts: Number(r.attempts),
    reason: reason ? reason.split(":")[0] + (reason.includes(":") ? `:${reason.split(":")[1]}` : "") : null,
    lastAttemptAt: r.last_attempt_at, sentAt: r.sent_at, nextCheckAt: r.next_check_at,
    recipientVersion: Number(r.recipient_version), obligationVersion: Number(r.obligation_version),
    sentRecipientVersion: r.sent_recipient_version, sentObligationVersion: r.sent_obligation_version,
    hasRecipient: r.has_recipient === true,
  };
}

/**
 * Documents that may be attached as evidence to this deal's conditions: exactly the set `assertDocumentInContext`
 * accepts (this deal's own files, or the deal contact's files not bound to another deal). Display fields only: no
 * storage key, path or access token is ever returned.
 */
export async function listEligibleConditionDocuments(dealId: number) {
  const [deal] = await db.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new ConditionError(404, "Deal not found", "deal_not_found");
  const res = (await db.execute(sql`
    SELECT id, file_name, type, status, created_at FROM documents
    WHERE deal_id = ${dealId} ${deal.contactId != null ? sql`OR (deal_id IS NULL AND contact_id = ${deal.contactId})` : sql``}
    ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 200`)) as any;
  return (res.rows ?? []).map((r: any) => ({ id: r.id as number, fileName: r.file_name as string, type: r.type as string, status: r.status as string | null, uploadedAt: r.created_at as string | null }));
}

export async function readConditionHistory(conditionId: number) {
  const [row] = await db.select({ id: underwritingConditions.id }).from(underwritingConditions).where(eq(underwritingConditions.id, conditionId)).limit(1);
  if (!row) throw new ConditionError(404, "Condition not found", "condition_not_found");
  const res = (await db.execute(sql`
    SELECT id, user_id, action, details, before_state, after_state, created_at FROM audit_logs
    WHERE entity_type = 'underwriting_condition' AND entity_id = ${conditionId}
    ORDER BY id DESC LIMIT 100`)) as any;
  return (res.rows ?? []).map((r: any) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const after = (r.after_state ?? {}) as Record<string, unknown>;
    const before = (r.before_state ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    // Who, when, which transition and why: the reason is whichever one the command carried.
    const reason = str(d.reversalReason) ?? str(d.reason) ?? (d.transition && String(d.transition).endsWith("->waived") ? str(after.waivedReason) : null);
    const evidenceChanged = (before.documentId ?? null) !== (after.documentId ?? null) && r.action === "underwriting_condition_updated";
    return {
      id: r.id, actorId: r.user_id, action: r.action, details: r.details, at: r.created_at,
      transition: str(d.transition), reason,
      documentId: evidenceChanged ? ((after.documentId as number | null) ?? null) : null,
      evidenceChanged,
    };
  });
}
