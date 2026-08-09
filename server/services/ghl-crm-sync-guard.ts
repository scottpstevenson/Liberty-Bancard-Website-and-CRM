/**
 * ghl-crm-sync-guard.ts
 *
 * Enforces the GHL_CRM_SYNC_MODE flag for all inbound CRM write-back functions.
 * This is the single enforcement point for the GHL CRM decoupling (Wave B1).
 *
 * Usage in each syncXFromGhl function:
 *
 *   const guard = await checkGhlCrmSyncAllowed("syncContactFromGhl");
 *   if (guard.blocked) return guard.noOpResult;
 *   if (guard.shadowMode) {
 *     await logGhlShadowIntent("syncContactFromGhl", { entityType: "contact", ghlId: ghlContact.id, payload: ghlContact });
 *     return { contactId: /* resolved id * /, created: false }; // pretend-success
 *   }
 *   // proceed with normal write
 */

import { getGhlCrmSyncMode, type GhlCrmSyncMode } from "./feature-flags";
import { db } from "../db";
import { ghlShadowLog } from "@shared/schema";

export interface GhlCrmSyncGuardResult<T> {
  /** If true, the caller should return noOpResult immediately */
  blocked: boolean;
  /** If true, the caller is in shadow mode — log then return a pretend-success */
  shadowMode: boolean;
  /** The safe no-op return value to use when blocked or shadow */
  noOpResult: T;
  mode: GhlCrmSyncMode;
}

/**
 * Check whether a from-GHL sync operation should proceed.
 * Returns a guard object — see GhlCrmSyncGuardResult.
 */
export function checkGhlCrmSyncAllowed<T>(
  functionName: string,
  noOpResult: T
): GhlCrmSyncGuardResult<T> {
  const mode = getGhlCrmSyncMode();

  if (mode === "disabled") {
    // Silent no-op — outbound sends and inbound event handling still work.
    // Do not log every call to avoid noise; use a sampled warn instead.
    return { blocked: true, shadowMode: false, noOpResult, mode };
  }

  if (mode === "shadow") {
    return { blocked: false, shadowMode: true, noOpResult, mode };
  }

  // mode === "enabled" — current legacy behaviour
  return { blocked: false, shadowMode: false, noOpResult, mode };
}

export interface ShadowLogPayload {
  entityType: "contact" | "deal" | "task" | "company" | "tags";
  entityId?: number | null;
  ghlId?: string | null;
  /** Key→[currentValue, ghlValue] for field-level diffs (optional — use for fine-grained diffs) */
  fieldDiffs?: Record<string, { current: unknown; ghl: unknown }>;
  /** Full GHL payload when field-level diff is not computed */
  rawPayload?: unknown;
}

/**
 * Write a shadow log entry for an inbound GHL sync that was blocked in shadow mode.
 * Non-blocking — never throws.
 */
export async function logGhlShadowIntent(
  syncFunction: string,
  opts: ShadowLogPayload
): Promise<void> {
  try {
    const { entityType, entityId, ghlId, fieldDiffs, rawPayload } = opts;

    if (fieldDiffs && Object.keys(fieldDiffs).length > 0) {
      // Log one row per differing field
      const rows = Object.entries(fieldDiffs).map(([field, { current, ghl }]) => ({
        entityType,
        entityId: entityId ?? null,
        syncFunction,
        ghlId: ghlId ?? null,
        field,
        currentValue: current !== undefined ? (current as any) : null,
        ghlValue: ghl !== undefined ? (ghl as any) : null,
        wouldHaveWritten: true,
        metadata: null,
      }));
      await db.insert(ghlShadowLog).values(rows);
    } else {
      // Log a single row with the raw payload
      await db.insert(ghlShadowLog).values({
        entityType,
        entityId: entityId ?? null,
        syncFunction,
        ghlId: ghlId ?? null,
        field: null,
        currentValue: null,
        ghlValue: rawPayload !== undefined ? (rawPayload as any) : null,
        wouldHaveWritten: true,
        metadata: null,
      });
    }
  } catch (err: any) {
    // Shadow logging must never break the webhook receiver
    console.warn(`[GhlShadowLog] Failed to write shadow log (${syncFunction}):`, err?.message);
  }
}

/**
 * Compute field-level diffs between a Liberty record and an incoming GHL payload.
 * Only returns entries where the values actually differ.
 */
export function computeFieldDiffs(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, { current: unknown; ghl: unknown }> {
  const diffs: Record<string, { current: unknown; ghl: unknown }> = {};
  for (const [key, ghlVal] of Object.entries(incoming)) {
    if (ghlVal === undefined) continue;
    const currentVal = current[key];
    // Simple equality — works for primitives; stringify for objects
    const currentStr = typeof currentVal === "object" ? JSON.stringify(currentVal) : String(currentVal ?? "");
    const ghlStr = typeof ghlVal === "object" ? JSON.stringify(ghlVal) : String(ghlVal ?? "");
    if (currentStr !== ghlStr) {
      diffs[key] = { current: currentVal, ghl: ghlVal };
    }
  }
  return diffs;
}
