/**
 * processor-api.ts — LEGACY SHIM (REV-05A)
 *
 * All simulation paths have been removed. Callers MUST migrate to the
 * registry adapter (server/services/processors/registry.ts).
 *
 * The live HTTP functions (submitMerchantToProcessor, checkBoardingStatus)
 * are preserved here for now to avoid breaking callers, but they no longer
 * have simulation fallbacks — if credentials are absent they return an error.
 *
 * Functions in the #1737 domain (fetchMidDailyStats, ingestMidDataForActiveMids,
 * checkAndUpdateMerchantHealthFromMidData) return held/unsupported results.
 *
 * Kill line: no caller may import this file in production scheduler code.
 * Use server/services/processors/registry.ts instead.
 */
import { storage } from "../storage";
import type { InsertMidDailyStat } from "@shared/schema";

export interface ProcessorBoardingPayload {
  dealId: number;
  legalBusinessName: string;
  dba?: string;
  ein?: string;
  businessType?: string;
  businessAddress?: string;
  businessCity?: string;
  businessState?: string;
  businessZip?: string;
  businessPhone?: string;
  businessEmail?: string;
  website?: string;
  vertical?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerDob?: string;
  ownerSsn?: string;
  ownerAddress?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZip?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  bankAccountType?: string;
  estimatedMonthlyVolume?: string;
  estimatedAvgTicket?: string;
  preferredProgram?: string;
  offerPath?: string;
}

export interface BoardingSubmissionResult {
  success: boolean;
  processorApplicationId?: string;
  status?: string;
  message?: string;
  error?: string;
  estimatedDecisionDate?: string;
}

export interface BoardingStatusResult {
  success: boolean;
  processorApplicationId: string;
  status: "submitted" | "under_review" | "approved" | "declined" | "more_info_needed";
  mid?: string;
  message?: string;
  moreInfoRequest?: string;
  declineReason?: string;
  approvedAt?: string;
  error?: string;
}

export interface MidTransactionSummary {
  mid: string;
  date: string;
  volume: number;
  txCount: number;
  avgTicket: number;
  effectiveRate: number;
  chargebackCount: number;
  chargebackAmount: number;
  refundCount: number;
}

const PROCESSOR_API_BASE = process.env.PAYARC_API_BASE_URL || process.env.PROCESSOR_API_BASE_URL || "";
const PROCESSOR_API_KEY = process.env.PAYARC_API_KEY || process.env.PROCESSOR_API_KEY || "";

function isProcessorConfigured(): boolean {
  return !!(PROCESSOR_API_BASE && PROCESSOR_API_KEY);
}

/**
 * submitMerchantToProcessor — REMOVED (REV-05A).
 *
 * This function previously made live HTTP calls to the processor API without
 * any activation snapshot gate — a direct boarding authority bypass. It is now
 * unconditionally hard-failed regardless of credential presence.
 *
 * Migrate all callers to:
 *   server/services/processors/registry.ts → getDefaultProcessor().boardMerchant()
 * which enforces the activation snapshot gate before any provider I/O.
 */
export async function submitMerchantToProcessor(_payload: ProcessorBoardingPayload): Promise<BoardingSubmissionResult> {
  return {
    success: false,
    error: "[REV-05A] submitMerchantToProcessor is removed. Migrate to registry adapter: getDefaultProcessor().boardMerchant()",
  };
}

/**
 * checkBoardingStatus — REMOVED (REV-05A).
 *
 * This function previously made live HTTP calls to the processor API without
 * any activation snapshot gate — a direct boarding authority bypass. It is now
 * unconditionally hard-failed regardless of credential presence.
 *
 * Migrate all callers to:
 *   server/services/processors/registry.ts → getDefaultProcessor().getMerchantStatus()
 * which enforces the activation snapshot gate before any provider I/O.
 */
export async function checkBoardingStatus(processorApplicationId: string): Promise<BoardingStatusResult> {
  return {
    success: false,
    processorApplicationId,
    status: "submitted",
    error: "[REV-05A] checkBoardingStatus is removed. Migrate to registry adapter: getDefaultProcessor().getMerchantStatus()",
  };
}

/**
 * fetchMidDailyStats — #1737 DOMAIN (held/unsupported).
 * Daily stats, residuals, chargebacks are Task #1737 scope.
 * Returns held result; callers must check status before using data.
 */
export async function fetchMidDailyStats(_mid: string, _startDate: string, _endDate: string): Promise<MidTransactionSummary[]> {
  // #1737 domain: held/unsupported until REV-06A certifies this path.
  console.warn("[processor-api] fetchMidDailyStats: held pending task #1737 (REV-06A). Returning empty.");
  return [];
}

/**
 * ingestMidDataForActiveMids — DEPRECATED. Delegates to registry.
 * Simulation path REMOVED. #1737 domain functions return held results inside registry.
 */
export async function ingestMidDataForActiveMids(): Promise<{ processed: number; errors: number; held?: boolean }> {
  // Delegate to registry which has the proper held returns for #1737 domain functions.
  const { ingestMidDataForActiveMids: registryIngest } = await import("./processors/registry");
  return registryIngest();
}

/**
 * checkAndUpdateMerchantHealthFromMidData — #1737 DOMAIN (held/unsupported).
 * Health alerts derived from MID data are Task #1737 scope.
 */
export async function checkAndUpdateMerchantHealthFromMidData(_dealId: number, _mid: string): Promise<{ status: "held"; reason: string }> {
  // #1737 domain: held/unsupported until REV-06A certifies this path.
  return { status: "held", reason: "pending_task_1737" };
}
