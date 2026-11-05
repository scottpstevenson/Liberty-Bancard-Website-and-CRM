/**
 * Merchant MID Service (REV-05A)
 *
 * Changes from pre-REV-05A:
 *   - createMerchantMid audit: raw MID removed from details (masked with last 4 digits).
 *   - writeMidAccessReceipt() added: every full-MID read creates a security receipt.
 *   - assignMerchantMidToCanonical() exported for boarding.ts to use instead of
 *     calling storage.updateDeal() + createAuditLog() directly.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
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
  constructor(readonly code: "MID_NOT_FOUND" | "MID_ILLEGAL_TRANSITION" | "MID_LINK_MISMATCH" | "MID_ALREADY_ASSIGNED" | "MID_CLOSED" | "MID_INVALID_STATUS", message: string) {
    super(message);
  }
}

/** Exact case relationship; callers authorize both case contact/deal first.
 * The MID registry, never a free-form client string, supplies submission MID. */
export async function readChargebackMidOptions(contactId:number, dealId:number|null) {
  return db.select({id:merchantMids.id,mid:merchantMids.mid,status:merchantMids.status})
    .from(merchantMids).where(and(eq(merchantMids.contactId,contactId),
      ...(dealId ? [sql`(${merchantMids.dealId} IS NULL OR ${merchantMids.dealId}=${dealId})`] : [])));
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
    // S5-20: keep the compatibility alias in step with the canonical row. Only an
    // empty alias is filled (never overwrite a different MID the deal already shows);
    // the deal row lock orders this against assign/refresh writers.
    if (row.dealId) {
      await tx.execute(sql`SELECT id FROM deals WHERE id = ${row.dealId} FOR UPDATE`);
      await tx.update(deals)
        .set({ mid: row.mid, updatedAt: new Date() } as any)
        .where(and(eq(deals.id, row.dealId), or(isNull(deals.mid), eq(deals.mid, ""))));
    }
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
    // R08: closing a MID must not leave it as the deal's compatibility alias, where an alias reader (or a later
    // write that trusts it) would treat a closed MID as live. The alias moves to the oldest other non-closed MID of
    // the deal, or clears; the closed row itself stays as history.
    let aliasMovedTo: "other_mid" | "cleared" | null = null;
    if (input.status === "closed" && current.status !== "closed" && row.dealId) {
      await tx.execute(sql`SELECT id FROM deals WHERE id = ${row.dealId} FOR UPDATE`);
      const [dealAlias] = await tx.select({ mid: deals.mid }).from(deals).where(eq(deals.id, row.dealId)).limit(1);
      if (dealAlias?.mid === row.mid) {
        const others = await tx.select().from(merchantMids)
          .where(and(eq(merchantMids.dealId, row.dealId), sql`${merchantMids.id} <> ${row.id}`, sql`${merchantMids.status} <> 'closed'`))
          .orderBy(merchantMids.id).limit(1);
        await tx.update(deals).set({ mid: others[0]?.mid ?? null, updatedAt: new Date() } as any).where(eq(deals.id, row.dealId));
        aliasMovedTo = others[0] ? "other_mid" : "cleared";
      }
    }
    await auditChange({
      action: "mid_updated", entityType: "merchant_mid", entityId: row.id,
      actorType: (input.actorType as any) ?? "user", actorId: input.actorId ?? null,
      details: { fromStatus: current.status, toStatus: row.status, aliasMovedTo, source: "merchant-mid-service" },
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
 * assignMerchantMidToCanonical — canonical path for manual or provider-reported MID assignment.
 *
 * Rules (R08):
 *  - A deal may hold SEVERAL MIDs (no one-per-deal uniqueness). `merchant_mids.mid` is globally unique.
 *  - An assignment never rewrites a different MID value: a new value creates a new row, history stays intact.
 *  - A MID already attached to another deal is refused (MID_ALREADY_ASSIGNED); a closed row is history and is never
 *    reused or reopened (MID_CLOSED).
 *  - An existing row honors the explicitly requested status (legal transitions only) and processor. Omitting
 *    `status` changes nothing on an existing row (the provider-refresh path must not demote an active MID).
 *  - `deals.mid` is only a compatibility alias for the PRIMARY MID: the first live MID. It is set when empty or when the
 *    aliased MID is closed/unknown; otherwise the new MID is secondary and the alias is left alone.
 *  - Masked audit only.
 */
export async function assignMerchantMidToCanonical(input: {
  dealId: number;
  contactId: number | null;
  mid: string;
  processorName?: string;
  /** Requested status. Omitted = no change to an existing row; a new row starts as "assigned". */
  status?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Run inside the caller's transaction (S5-18) so MID, deal state and audit commit together. */
  tx?: any;
}): Promise<{ midRow: MerchantMid; previousMidMasked: string | null; isPrimary: boolean; created: boolean }> {
  const trimmedMid = input.mid.trim();
  if (input.status !== undefined && !(input.status in LEGAL)) {
    throw new MerchantMidTransitionError("MID_INVALID_STATUS", `Unknown MID status '${input.status}'`);
  }

  const run = async (tx: any) => {
    // Serialize concurrent assignments for one deal (S5-20) and capture the previous alias.
    await tx.execute(sql`SELECT id FROM deals WHERE id = ${input.dealId} FOR UPDATE`);
    const [deal] = await tx.select({ mid: deals.mid }).from(deals).where(eq(deals.id, input.dealId)).limit(1);
    const previousMidMasked = deal?.mid ? maskMid(deal.mid) : null;

    const raw = await tx.execute(sql`SELECT * FROM merchant_mids WHERE mid = ${trimmedMid} FOR UPDATE`);
    const found = ((raw.rows ?? raw)[0] as any | undefined);
    const toRow = (r: any): MerchantMid => ({
      ...r, contactId: r.contact_id ?? r.contactId, dealId: r.deal_id ?? r.dealId, processorName: r.processor_name ?? r.processorName,
    });

    let midRow: MerchantMid;
    let created = false;
    if (found) {
      const foundDealId = found.deal_id ?? found.dealId ?? null;
      const foundContactId = found.contact_id ?? found.contactId;
      const adoptable = foundDealId === null && input.contactId !== null && foundContactId === input.contactId;
      if (foundDealId !== input.dealId && !adoptable) {
        throw new MerchantMidTransitionError("MID_ALREADY_ASSIGNED", "That MID is already attached to a different deal");
      }
      if (found.status === "closed" && !(input.status === undefined || input.status === "closed")) {
        throw new MerchantMidTransitionError("MID_CLOSED", "A closed MID is history and is not reused; assign a new MID value");
      }
      if (found.status === "closed") throw new MerchantMidTransitionError("MID_CLOSED", "A closed MID is history and is not reused; assign a new MID value");
      const now = new Date();
      const updates: Record<string, unknown> = { updatedAt: now };
      if (adoptable) updates.dealId = input.dealId;
      if (input.processorName && input.processorName !== (found.processor_name ?? found.processorName)) updates.processorName = input.processorName;
      if (input.status !== undefined && input.status !== found.status) {
        if (!(LEGAL[found.status] ?? []).includes(input.status)) {
          throw new MerchantMidTransitionError("MID_ILLEGAL_TRANSITION", `Illegal MID transition ${found.status} → ${input.status}`);
        }
        updates.status = input.status;
        if (input.status === "active") updates.activatedAt = now;
        if (input.status === "suspended") updates.suspendedAt = now;
        if (input.status === "closed") updates.closedAt = now;
      }
      const [updated] = await tx.update(merchantMids).set(updates as any).where(eq(merchantMids.id, found.id)).returning();
      midRow = updated;
    } else if (input.contactId) {
      const startStatus = input.status ?? "assigned";
      if (startStatus !== "assigned" && startStatus !== "active") {
        throw new MerchantMidTransitionError("MID_ILLEGAL_TRANSITION", `A new MID cannot start as '${startStatus}'`);
      }
      const [row] = await tx.insert(merchantMids).values({
        contactId: input.contactId,
        dealId: input.dealId,
        mid: trimmedMid,
        tids: [],
        processorName: input.processorName ?? "payarc",
        status: startStatus,
        ...(startStatus === "active" ? { activatedAt: new Date() } : {}),
      }).returning();
      midRow = row;
      created = true;
    } else {
      throw new Error("Cannot create MID without contactId");
    }

    // Primary / alias: only a live MID may be the alias, and an existing live alias is not displaced.
    let isPrimary = deal?.mid === trimmedMid;
    if (!isPrimary && midRow.status !== "closed") {
      let aliasLive = false;
      if (deal?.mid) {
        const [aliasRow] = await tx.select({ status: merchantMids.status }).from(merchantMids)
          .where(and(eq(merchantMids.mid, deal.mid), eq(merchantMids.dealId, input.dealId))).limit(1);
        aliasLive = !!aliasRow && aliasRow.status !== "closed";
      }
      if (!aliasLive) {
        await tx.update(deals).set({ mid: trimmedMid, updatedAt: new Date() } as any).where(eq(deals.id, input.dealId));
        isPrimary = true;
      }
    }

    await auditChange({
      action: "mid_assigned",
      entityType: "deal",
      entityId: input.dealId,
      actorType: "user",
      actorId: input.actorId ?? null,
      details: {
        midMasked: maskMid(trimmedMid),
        previousMidMasked,
        midId: midRow.id,
        created,
        isPrimary,
        processorName: midRow.processorName ?? input.processorName ?? null,
        status: midRow.status,
        assignedBy: input.actorEmail ?? "admin",
        source: "merchant-mid-service",
      },
    }, tx);

    return { midRow, previousMidMasked, isPrimary, created };
  };
  return input.tx ? run(input.tx) : db.transaction(run);
}

export const MID_LEGAL_TRANSITIONS = LEGAL;
