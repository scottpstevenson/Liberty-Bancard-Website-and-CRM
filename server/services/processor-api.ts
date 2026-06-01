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

const PROCESSOR_API_BASE = process.env.PROCESSOR_API_BASE_URL || "";
const PROCESSOR_API_KEY = process.env.PROCESSOR_API_KEY || "";
const PROCESSOR_NAME = process.env.PROCESSOR_NAME || "NMI";

function isProcessorConfigured(): boolean {
  return !!(PROCESSOR_API_BASE && PROCESSOR_API_KEY);
}

function generateMockApplicationId(): string {
  const prefix = "APP";
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

function generateMockMid(): string {
  const digits = Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("");
  return digits;
}

function generateMockDailyVolume(mid: string, date: string): MidTransactionSummary {
  const seed = (mid + date).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = (offset: number) => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  const baseVolume = 15000 + rng(1) * 85000;
  const txCount = Math.floor(50 + rng(2) * 450);
  const avgTicket = txCount > 0 ? baseVolume / txCount : 0;
  const effectiveRate = 0.015 + rng(3) * 0.025;
  const chargebackCount = rng(4) < 0.03 ? Math.floor(rng(5) * 3) : 0;
  const chargebackAmount = chargebackCount * avgTicket;
  const refundCount = Math.floor(rng(6) * 5);

  return {
    mid,
    date,
    volume: Math.round(baseVolume * 100) / 100,
    txCount,
    avgTicket: Math.round(avgTicket * 100) / 100,
    effectiveRate: Math.round(effectiveRate * 10000) / 10000,
    chargebackCount,
    chargebackAmount: Math.round(chargebackAmount * 100) / 100,
    refundCount,
  };
}

export async function submitMerchantToProcessor(payload: ProcessorBoardingPayload): Promise<BoardingSubmissionResult> {
  if (isProcessorConfigured()) {
    try {
      const resp = await fetch(`${PROCESSOR_API_BASE}/api/boarding/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${PROCESSOR_API_KEY}`,
          "X-Source": "LibertyBancard-CRM",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error(`[Processor API] Submit failed: ${resp.status} ${errBody}`);
        return { success: false, error: `Processor API error: ${resp.status}` };
      }

      const data = await resp.json() as any;
      return {
        success: true,
        processorApplicationId: data.applicationId || data.id,
        status: data.status || "submitted",
        message: data.message,
        estimatedDecisionDate: data.estimatedDecisionDate,
      };
    } catch (err: any) {
      console.error("[Processor API] Submit exception:", err.message);
      return { success: false, error: err.message };
    }
  }

  console.log(`[Processor API] Running in simulation mode — no PROCESSOR_API_KEY configured`);
  await new Promise(resolve => setTimeout(resolve, 300));

  const applicationId = generateMockApplicationId();
  const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return {
    success: true,
    processorApplicationId: applicationId,
    status: "submitted",
    message: `Application ${applicationId} submitted to ${PROCESSOR_NAME}. Estimated decision: ${estimatedDate}.`,
    estimatedDecisionDate: estimatedDate,
  };
}

export async function checkBoardingStatus(processorApplicationId: string): Promise<BoardingStatusResult> {
  if (isProcessorConfigured()) {
    try {
      const resp = await fetch(`${PROCESSOR_API_BASE}/api/boarding/status/${processorApplicationId}`, {
        headers: {
          "Authorization": `Bearer ${PROCESSOR_API_KEY}`,
          "X-Source": "LibertyBancard-CRM",
        },
      });

      if (!resp.ok) {
        return { success: false, processorApplicationId, status: "submitted", error: `Processor API error: ${resp.status}` };
      }

      const data = await resp.json() as any;
      return {
        success: true,
        processorApplicationId,
        status: data.status,
        mid: data.mid,
        message: data.message,
        moreInfoRequest: data.moreInfoRequest,
        declineReason: data.declineReason,
        approvedAt: data.approvedAt,
      };
    } catch (err: any) {
      return { success: false, processorApplicationId, status: "submitted", error: err.message };
    }
  }

  await new Promise(resolve => setTimeout(resolve, 150));
  const seed = processorApplicationId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100;

  let status: BoardingStatusResult["status"] = "under_review";
  let mid: string | undefined;
  let message = "Application is under review by the processor.";
  let moreInfoRequest: string | undefined;

  if (seed < 20) {
    status = "submitted";
    message = "Application received and queued for review.";
  } else if (seed < 55) {
    status = "under_review";
    message = "Underwriting team is reviewing your application.";
  } else if (seed < 70) {
    status = "approved";
    mid = generateMockMid();
    message = `Application approved. MID ${mid} has been assigned.`;
  } else if (seed < 80) {
    status = "more_info_needed";
    message = "Processor requires additional information.";
    moreInfoRequest = "Please provide the most recent 3 months of business bank statements and a copy of a void check.";
  } else {
    status = "under_review";
    message = "Application pending final underwriting review.";
  }

  return {
    success: true,
    processorApplicationId,
    status,
    mid,
    message,
    moreInfoRequest,
    approvedAt: status === "approved" ? new Date().toISOString() : undefined,
  };
}

export async function fetchMidDailyStats(mid: string, startDate: string, endDate: string): Promise<MidTransactionSummary[]> {
  if (isProcessorConfigured()) {
    try {
      const resp = await fetch(
        `${PROCESSOR_API_BASE}/api/reporting/mid/${mid}/daily?start=${startDate}&end=${endDate}`,
        {
          headers: {
            "Authorization": `Bearer ${PROCESSOR_API_KEY}`,
            "X-Source": "LibertyBancard-CRM",
          },
        }
      );

      if (!resp.ok) {
        console.error(`[Processor API] Fetch MID stats failed: ${resp.status}`);
        return [];
      }

      return (await resp.json()) as MidTransactionSummary[];
    } catch (err: any) {
      console.error("[Processor API] Fetch MID stats exception:", err.message);
      return [];
    }
  }

  const results: MidTransactionSummary[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      results.push(generateMockDailyVolume(mid, dateStr));
    }
    current.setDate(current.getDate() + 1);
  }

  return results;
}

export async function ingestMidDataForActiveMids(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const activeMidDeals = allDeals.filter(d => d.mid && d.boardingStatus === "approved");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 2);

    const endStr = endDate.toISOString().split("T")[0];
    const startStr = startDate.toISOString().split("T")[0];

    for (const deal of activeMidDeals) {
      if (!deal.mid) continue;
      try {
        const stats = await fetchMidDailyStats(deal.mid, startStr, endStr);

        for (const stat of stats) {
          const existing = await storage.getMidDailyStatByMidAndDate(deal.mid, stat.date);
          const payload: InsertMidDailyStat = {
            mid: deal.mid,
            dealId: deal.id,
            contactId: deal.contactId || undefined,
            date: stat.date,
            volume: stat.volume,
            txCount: stat.txCount,
            avgTicket: stat.avgTicket,
            effectiveRate: stat.effectiveRate,
            chargebackCount: stat.chargebackCount,
            chargebackAmount: stat.chargebackAmount,
            refundCount: stat.refundCount,
            fetchedAt: new Date(),
          };

          if (existing) {
            await storage.updateMidDailyStat(existing.id, payload);
          } else {
            await storage.createMidDailyStat(payload);
          }
        }

        await checkAndUpdateMerchantHealthFromMidData(deal.id, deal.mid);
        processed++;
      } catch (err: any) {
        console.error(`[MID Ingestion] Error for MID ${deal.mid}:`, err.message);
        errors++;
      }
    }

    console.log(`[MID Ingestion] Processed ${processed} MIDs, ${errors} errors`);
  } catch (err: any) {
    console.error("[MID Ingestion] Fatal error:", err.message);
    errors++;
  }

  return { processed, errors };
}

export async function checkAndUpdateMerchantHealthFromMidData(dealId: number, mid: string) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const stats = await storage.getMidDailyStatsByDeal(dealId, 30);

    if (!stats || stats.length === 0) return;

    const deal = await storage.getDeal(dealId);
    if (!deal) return;

    const recentStats = stats.slice(0, 7);
    const olderStats = stats.slice(7, 14);

    const recentVolume = recentStats.reduce((s, r) => s + (r.volume || 0), 0);
    const olderVolume = olderStats.reduce((s, r) => s + (r.volume || 0), 0);

    const totalChargebacks = stats.reduce((s, r) => s + (r.chargebackCount || 0), 0);

    const hasNoProcessing = recentStats.length >= 5 && recentStats.every(r => (r.volume || 0) < 100);
    const hasVolumeDrop = olderVolume > 0 && recentVolume < olderVolume * 0.5;
    const hasChargebackSpike = totalChargebacks >= 3;

    const existing = await storage.getActiveHealthAlerts();
    const dealAlerts = existing.filter(a => a.dealId === dealId);
    const existingTypes = new Set(dealAlerts.map(a => a.alertType));

    if (hasNoProcessing && !existingTypes.has("no_processing")) {
      await storage.createHealthAlert({
        dealId,
        contactId: deal.contactId || undefined,
        alertType: "no_processing",
        severity: "critical",
        title: `No Processing Detected — MID ${mid}`,
        description: `MID ${mid} has had less than $100 in volume for 5+ consecutive days. Merchant may have stopped processing.`,
        metric: "daily_volume",
        currentValue: `$${recentVolume.toFixed(2)}`,
        threshold: "$100/day",
        status: "active",
      });
    }

    if (hasVolumeDrop && !existingTypes.has("volume_decline")) {
      const dropPct = olderVolume > 0 ? Math.round((1 - recentVolume / olderVolume) * 100) : 0;
      await storage.createHealthAlert({
        dealId,
        contactId: deal.contactId || undefined,
        alertType: "volume_decline",
        severity: dropPct > 70 ? "critical" : "warning",
        title: `Volume Decline ${dropPct}% — MID ${mid}`,
        description: `MID ${mid} volume dropped ${dropPct}% (recent 7d: $${recentVolume.toFixed(0)}, prior 7d: $${olderVolume.toFixed(0)}).`,
        metric: "7d_volume",
        currentValue: `$${recentVolume.toFixed(0)}`,
        previousValue: `$${olderVolume.toFixed(0)}`,
        threshold: "50% decline",
        status: "active",
      });
    }

    if (hasChargebackSpike && !existingTypes.has("chargeback_spike")) {
      await storage.createHealthAlert({
        dealId,
        contactId: deal.contactId || undefined,
        alertType: "chargeback_spike",
        severity: totalChargebacks >= 5 ? "critical" : "warning",
        title: `Chargeback Spike — MID ${mid}`,
        description: `MID ${mid} has ${totalChargebacks} chargebacks in the last 30 days. Review required.`,
        metric: "chargeback_count_30d",
        currentValue: String(totalChargebacks),
        threshold: "3 per 30 days",
        status: "active",
      });
    }
  } catch (err: any) {
    console.error(`[MID Health] Error checking deal ${dealId}:`, err.message);
  }
}
