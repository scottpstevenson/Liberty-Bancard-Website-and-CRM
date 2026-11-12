/**
 * Default owner for new inbound requests.
 *
 * An administrator records one account (an active admin or manager) in system_settings. Nothing is invented: with no
 * valid owner recorded, new requests are held for management review exactly as before. The recorded owner receives:
 *  - a sales request's follow-up task, when its contact is production and not already owned by someone else
 *    (the contact and deal ownership move to the owner in the same transaction, so the assignment stays coherent);
 *  - the generic review task of a request whose contact is still unclassified (no ownership change, no classification);
 *  - a support ticket created from the public support form.
 * A contact that already belongs to another person is never taken over.
 */
import { pool } from "../db";
import { storage } from "../storage";
import { reviewerState, type OwnerState } from "./inbound-review-policy";

export const INBOUND_DEFAULT_OWNER_KEY = "inbound_default_owner";

function parseRecordedOwner(raw: unknown): string | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const id = value && typeof value === "object" ? (value as { ownerUserId?: unknown }).ownerUserId : null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** The recorded owner's user id, or null when none is recorded. Validity is checked separately. */
export async function getRecordedDefaultOwnerId(): Promise<string | null> {
  return parseRecordedOwner(await storage.getSystemSetting(INBOUND_DEFAULT_OWNER_KEY));
}

export interface DefaultOwnerStatus {
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerState: OwnerState | "not_configured";
}

export async function getDefaultOwnerStatus(): Promise<DefaultOwnerStatus> {
  const ownerUserId = await getRecordedDefaultOwnerId();
  if (!ownerUserId) return { ownerUserId: null, ownerEmail: null, ownerState: "not_configured" };
  const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [ownerUserId]);
  return { ownerUserId, ownerEmail: rows[0]?.email ?? null, ownerState: await reviewerState(ownerUserId) };
}

/** Email of the recorded owner when that account is currently an active admin or manager; otherwise null. */
export async function resolveDefaultOwnerEmail(): Promise<string | null> {
  const status = await getDefaultOwnerStatus();
  return status.ownerState === "ok" && status.ownerEmail ? status.ownerEmail : null;
}

/** Record (or clear, with null) the default owner. The owner must be an existing, active admin or manager. */
export async function setDefaultOwner(ownerUserId: string | null, actor: string): Promise<DefaultOwnerStatus> {
  if (ownerUserId !== null) {
    if (typeof ownerUserId !== "string" || !ownerUserId.trim() || (await reviewerState(ownerUserId.trim())) !== "ok") {
      throw new Error("INVALID_DEFAULT_OWNER");
    }
  }
  const previous = await getRecordedDefaultOwnerId();
  await storage.setSystemSetting(INBOUND_DEFAULT_OWNER_KEY, ownerUserId === null ? {} : { ownerUserId: ownerUserId.trim() });
  await storage.createAuditLog({
    action: "inbound_default_owner_set", entityType: "system_setting", entityId: 0,
    details: { actor, ownerUserId: ownerUserId === null ? null : ownerUserId.trim(), previousOwnerUserId: previous },
  } as any);
  return getDefaultOwnerStatus();
}
