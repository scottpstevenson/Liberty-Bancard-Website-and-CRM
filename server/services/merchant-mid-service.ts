/**
 * Merchant MID Service (REV-05A)
 *
 * Changes from pre-REV-05A:
 *   - createMerchantMid audit: raw MID removed from details (masked with last 4 digits).
 *   - writeMidAccessReceipt() added: every full-MID read creates a security receipt.
 *   - assignMerchantMidToCanonical() exported for boarding.ts to use instead of
 *     calling storage.updateDeal() + createAuditLog() directly.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { deals, merchantMids, type MerchantMid } from "@shared/schema";
import { auditChange } from "./audit-change";

const LEGAL: Record<string, readonly string[]> = {
  assigned: ["active", "suspended", "closed"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

export class MerchantMidTransitionError extends Error {
  constructor(readonly code: "MID_NOT_FOUND" | "MID_ILLEGAL_TRANSITION" | "MID_LINK_MISMATCH", message: string) {
    super(message);
  }
}

/** Mask a MID for audit logs — keeps last 4 digits, masks the rest. */
function maskMid(mid: string): string {
  if (!mid || mid.length <= 4) return "****";
  return "*".repeat(mid.length - 4) + mid.slice(-4);
}

async function assertLinkedDeal(tx: any, contactId: number, dealId: number | null | undefined): Promise<void> {
  if (!dealId) return;
  const [deal] = await tx.select({ id: deals.id }).from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.contactId, contactId))).limit(1);
  if (!deal) throw new MerchantMidTransitionError("MID_LINK_MISMATCH", "MID deal must belong to the specified contact");
}

export async function createMerchantMid(input: {
  contactId: number; dealId?: number | null; mid: string; tids?: string[];
  processorName?: string; monthlyVolumeCap?: string | null; notes?: string | null;
  actorId?: string | null; actorType?: string;
}): Promise<MerchantMid> {
  return db.transaction(async (tx) => {
    await assertLinkedDeal(tx, input.contactId, input.dealId);
    const [row] = await tx.insert(merchantMids).values({
      contactId: input.contactId, dealId: input.dealId ?? null, mid: input.mid.trim(),
      tids: input.tids ?? [], processorName: input.processorName ?? "payarc",
      monthlyVolumeCap: input.monthlyVolumeCap ?? null, notes: input.notes ?? null,
    }).returning();
    await auditChange({
      action: "mid_created", entityType: "merchant_mid", entityId: row.id,
      actorType: (input.actorType as any) ?? "user", actorId: input.actorId ?? null,
      // REV-05A: raw MID removed from audit details; masked value only.
      details: { contactId: row.contactId, dealId: row.dealId, midMasked: maskMid(row.mid), source: "merchant-mid-service" },
    }, tx);
    return row;
  });
}

export async function updateMerchantMid(input: {
  id: number; status?: string; tids?: string[]; monthlyVolumeCap?: string | null;
  notes?: string | null; suspensionReason?: string | null; actorId?: string | null; actorType?: string;
}): Promise<MerchantMid> {
  return db.transaction(async (tx) => {
    const raw = await tx.execute(sql`SELECT * FROM merchant_mids WHERE id = ${input.id} FOR UPDATE`);
    const current = ((raw.rows ?? raw)[0] as MerchantMid | undefined);
    if (!current) throw new MerchantMidTransitionError("MID_NOT_FOUND", "MID record not found");
    if (input.status && input.status !== current.status && !(LEGAL[current.status] ?? []).includes(input.status)) {
      throw new MerchantMidTransitionError("MID_ILLEGAL_TRANSITION", `Illegal MID transition ${current.status} → ${input.status}`);
    }
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.status && input.status !== current.status) {
      updates.status = input.status;
      if (input.status === "active") updates.activatedAt = now;
      if (input.status === "suspended") updates.suspendedAt = now;
      if (input.status === "closed") updates.closedAt = now;
    }
    if (input.tids !== undefined) updates.tids = input.tids;
    if (input.monthlyVolumeCap !== undefined) updates.monthlyVolumeCap = input.monthlyVolumeCap;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.suspensionReason !== undefined) updates.suspensionReason = input.suspensionReason;
    const [row] = await tx.update(merchantMids).set(updates as any).where(eq(merchantMids.id, input.id)).returning();
    await auditChange({
      action: "mid_updated", entityType: "merchant_mid", entityId: row.id,
      actorType: (input.actorType as any) ?? "user", actorId: input.actorId ?? null,
      details: { fromStatus: current.status, toStatus: row.status, source: "merchant-mid-service" },
    }, tx);
    return row;
  });
}

/**
 * Write a security access receipt when a full MID value is returned to a caller.
 * Every full-MID read from a role-authorized endpoint MUST call this.
 *
 * REV-05A requirement: public/list/search/task/notification/log/audit/metric/error
 * responses omit or mask full MID. Full MID is only returned via dedicated
 * purpose-bound endpoints, and every such access writes a receipt here.
 */
export async function writeMidAccessReceipt(input: {
  midId: number;
  contactId?: number | null;
  userId?: string | null;
  endpoint: string;
  purpose?: string;
}): Promise<void> {
  // REV-05A: Receipt write must be durable — throw on failure so awaiting callers
  // know the receipt was not persisted. Callers that must not fail on receipt errors
  // (e.g. bulk list endpoints) must handle the rejection explicitly.
  await db.execute(sql`
    INSERT INTO merchant_mid_access_receipts (mid_id, contact_id, user_id, endpoint, purpose, accessed_at)
    VALUES (
      ${input.midId},
      ${input.contactId ?? null},
      ${input.userId ?? null},
      ${input.endpoint},
      ${input.purpose ?? "manual_lookup"},
      now()
    )
  `);
  // If the INSERT throws, the error propagates to the caller — intentionally.
}

/**
 * assignMerchantMidToCanonical — canonical path for manual MID assignment.
 *
 * REV-05A: All MID writes go through canonical service.
 * - Creates/updates merchant_mids row
 * - Updates deals.mid (compatibility alias only)
 * - Writes masked audit (no raw MID in details)
 */
export async function assignMerchantMidToCanonical(input: {
  dealId: number;
  contactId: number | null;
  mid: string;
  processorName?: string;
  status?: string;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<{ midRow: MerchantMid; previousMidMasked: string | null }> {
  const trimmedMid = input.mid.trim();

  return db.transaction(async (tx) => {
    // Get current deal to capture previous MID
    const [deal] = await tx.select({ mid: deals.mid }).from(deals).where(eq(deals.id, input.dealId)).limit(1);
    const previousMidMasked = deal?.mid ? maskMid(deal.mid) : null;

    // Check for existing merchant_mids row for this deal
    const existing = await tx
      .select()
      .from(merchantMids)
      .where(eq(merchantMids.dealId, input.dealId))
      .limit(1);

    let midRow: MerchantMid;
    if (existing.length > 0) {
      // Update existing row
      const [updated] = await tx.update(merchantMids)
        .set({ mid: trimmedMid, updatedAt: new Date() })
        .where(eq(merchantMids.id, existing[0].id))
        .returning();
      midRow = updated;
    } else if (input.contactId) {
      // Create new canonical MID row
      const [created] = await tx.insert(merchantMids).values({
        contactId: input.contactId,
        dealId: input.dealId,
        mid: trimmedMid,
        tids: [],
        processorName: input.processorName ?? "payarc",
      }).returning();
      midRow = created;
    } else {
      throw new Error("Cannot create MID without contactId");
    }

    // Update deals.mid as compatibility alias (after canonical merchant_mids commit)
    await tx.update(deals)
      .set({ mid: trimmedMid, updatedAt: new Date() } as any)
      .where(eq(deals.id, input.dealId));

    // Write masked audit (no raw MID in details)
    await auditChange({
      action: "mid_assigned",
      entityType: "deal",
      entityId: input.dealId,
      actorType: "user",
      actorId: input.actorId ?? null,
      details: {
        midMasked: maskMid(trimmedMid),
        previousMidMasked,
        processorName: input.processorName ?? null,
        status: input.status ?? "assigned",
        assignedBy: input.actorEmail ?? "admin",
        source: "merchant-mid-service",
      },
    }, tx);

    return { midRow, previousMidMasked };
  });
}

export const MID_LEGAL_TRANSITIONS = LEGAL;
