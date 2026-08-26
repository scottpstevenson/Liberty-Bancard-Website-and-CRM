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
      details: { contactId: row.contactId, dealId: row.dealId, mid: row.mid, source: "merchant-mid-service" },
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

export const MID_LEGAL_TRANSITIONS = LEGAL;