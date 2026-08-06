import { storage } from "../storage";
import type { Deal } from "@shared/schema";
import { isGhlConfigured } from "./ghl";
import { syncDealToGhl } from "./ghl-sync";
import { recordAnalyticsEvent } from "./analytics-events";
import { CALL_BOOKED, PROPOSAL_SENT, CLOSED_WON, DEAL_STAGE_CHANGED } from "@shared/analytics-events";

/** Stage names that map to dedicated funnel analytics events */
const STAGE_EVENT_MAP: Record<string, string> = {
  "Call Booked": CALL_BOOKED,
  "Proposal Sent": PROPOSAL_SENT,
  "Closed Won": CLOSED_WON,
};

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

  // Record dedicated funnel event for key stages, plus generic stage-changed
  const funnelEvent = STAGE_EVENT_MAP[newStage];
  if (funnelEvent) {
    recordAnalyticsEvent({
      eventName: funnelEvent,
      dealId,
      dealStage: newStage,
      contactId: updated.contactId ?? undefined,
      metadata: { trigger },
    }).catch(() => {});
  }

  recordAnalyticsEvent({
    eventName: DEAL_STAGE_CHANGED,
    dealId,
    dealStage: newStage,
    contactId: updated.contactId ?? undefined,
    metadata: { trigger, newStage },
  }).catch(() => {});

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
