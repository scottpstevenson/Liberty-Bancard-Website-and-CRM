import { storage } from "../storage";
import type { Deal } from "@shared/schema";
import { isGhlConfigured } from "./ghl";
import { syncDealToGhl } from "./ghl-sync";

/**
 * Central deal stage transition service.
 *
 * All stage mutations in the app should go through this function so that GHL
 * opportunity stage sync is always guaranteed after a local update.
 *
 * Usage:
 *   await advanceDealStage(dealId, "Underwriting Submitted", "document_auto_advance");
 */
export async function advanceDealStage(
  dealId: number,
  newStage: string,
  trigger: string
): Promise<Deal | null> {
  const updated = await storage.updateDeal(dealId, { stage: newStage });
  if (!updated) return null;

  console.log(`[DealStage] Deal ${dealId} → "${newStage}" (trigger: ${trigger})`);

  if (isGhlConfigured()) {
    syncDealToGhl(dealId).catch((err: Error) => {
      console.warn(`[DealStage] GHL sync failed for deal ${dealId} after stage change to "${newStage}":`, err.message);
    });
  }

  return updated;
}

/**
 * Batch stage transition — updates multiple deals in one pass with GHL sync for each.
 */
export async function advanceDealsStageBatch(
  dealIds: number[],
  newStage: string,
  trigger: string
): Promise<number> {
  let count = 0;
  for (const dealId of dealIds) {
    const result = await advanceDealStage(dealId, newStage, trigger);
    if (result) count++;
  }
  return count;
}
