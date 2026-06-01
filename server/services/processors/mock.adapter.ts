import type {
  IProcessorAdapter,
  MerchantProfile,
  BoardingResult,
  BoardingStatusResult,
  Transaction,
  DailyStats,
  Residual,
  ChargebackSubmission,
  ChargebackResult,
  MerchantUpdateResult,
} from "./IProcessorAdapter";

function generateMockApplicationId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `APP-${ts}-${rand}`;
}

function generateMockMid(): string {
  return Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("");
}

function seededRng(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

function generateMockDailyStats(mid: string, date: string): DailyStats {
  const seed = (mid + date).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const baseVolume = 15000 + seededRng(seed, 1) * 85000;
  const txCount = Math.floor(50 + seededRng(seed, 2) * 450);
  const avgTicket = txCount > 0 ? baseVolume / txCount : 0;
  const effectiveRate = 0.015 + seededRng(seed, 3) * 0.025;
  const chargebackCount = seededRng(seed, 4) < 0.03 ? Math.floor(seededRng(seed, 5) * 3) : 0;
  const chargebackAmount = chargebackCount * avgTicket;
  const refundCount = Math.floor(seededRng(seed, 6) * 5);

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

export class MockProcessorAdapter implements IProcessorAdapter {
  readonly name = "mock";
  readonly displayName = "Mock / Sandbox";

  async boardMerchant(profile: MerchantProfile): Promise<BoardingResult> {
    await new Promise(r => setTimeout(r, 200));
    const applicationId = generateMockApplicationId();
    const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    console.log(`[MockAdapter] boardMerchant: deal ${profile.dealId} → ${applicationId}`);
    return {
      success: true,
      processorApplicationId: applicationId,
      status: "submitted",
      message: `[Sandbox] Application ${applicationId} submitted. Estimated decision: ${estimatedDate}.`,
      estimatedDecisionDate: estimatedDate,
    };
  }

  async getMerchantStatus(processorApplicationId: string): Promise<BoardingStatusResult> {
    await new Promise(r => setTimeout(r, 100));
    const seed = processorApplicationId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100;

    let status: BoardingStatusResult["status"] = "under_review";
    let mid: string | undefined;
    let message = "Application is under review by the processor.";
    let moreInfoRequest: string | undefined;

    if (seed < 20) {
      status = "submitted";
      message = "[Sandbox] Application received and queued for review.";
    } else if (seed < 55) {
      status = "under_review";
      message = "[Sandbox] Underwriting team is reviewing your application.";
    } else if (seed < 70) {
      status = "approved";
      mid = generateMockMid();
      message = `[Sandbox] Application approved. MID ${mid} has been assigned.`;
    } else if (seed < 80) {
      status = "more_info_needed";
      message = "[Sandbox] Processor requires additional information.";
      moreInfoRequest = "Please provide 3 months of business bank statements and a void check.";
    } else {
      status = "under_review";
      message = "[Sandbox] Application pending final underwriting review.";
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

  async getTransactions(mid: string, startDate: string, endDate: string): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      const seed = (mid + dateStr).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const dailyCount = Math.floor(5 + seededRng(seed, 1) * 20);

      for (let i = 0; i < dailyCount; i++) {
        const amount = Math.round((20 + seededRng(seed + i, 2) * 480) * 100) / 100;
        const brands = ["Visa", "Mastercard", "Amex", "Discover"];
        transactions.push({
          id: `MOCK-${mid}-${dateStr}-${i}`,
          mid,
          date: dateStr,
          amount,
          type: seededRng(seed + i, 3) > 0.95 ? "refund" : "sale",
          status: seededRng(seed + i, 4) > 0.02 ? "approved" : "declined",
          cardBrand: brands[Math.floor(seededRng(seed + i, 5) * brands.length)],
          last4: String(Math.floor(1000 + seededRng(seed + i, 6) * 9000)),
          authCode: `AUTH${Math.floor(100000 + seededRng(seed + i, 7) * 900000)}`,
        });
      }
      current.setDate(current.getDate() + 1);
    }
    return transactions;
  }

  async getResiduals(month: string, _agentId?: string): Promise<Residual[]> {
    const seed = month.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const count = Math.floor(3 + seededRng(seed, 1) * 10);
    const residuals: Residual[] = [];

    for (let i = 0; i < count; i++) {
      const volume = Math.round(20000 + seededRng(seed + i, 2) * 180000);
      const grossRevenue = Math.round(volume * (0.02 + seededRng(seed + i, 3) * 0.01) * 100) / 100;
      const processorFees = Math.round(grossRevenue * 0.6 * 100) / 100;
      const agentResidual = Math.round((grossRevenue - processorFees) * 100) / 100;
      residuals.push({
        mid: generateMockMid(),
        month,
        grossRevenue,
        processorFees,
        agentResidual,
        merchantName: `Mock Merchant ${i + 1}`,
        txCount: Math.floor(50 + seededRng(seed + i, 4) * 500),
        volume,
      });
    }
    return residuals;
  }

  async getDailyStats(mid: string, startDate: string, endDate: string): Promise<DailyStats[]> {
    const results: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        results.push(generateMockDailyStats(mid, dateStr));
      }
      current.setDate(current.getDate() + 1);
    }
    return results;
  }

  async submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult> {
    await new Promise(r => setTimeout(r, 150));
    const caseId = `CB-MOCK-${Date.now()}`;
    console.log(`[MockAdapter] submitChargeback: MID ${submission.mid}, txId ${submission.transactionId} → ${caseId}`);
    return {
      success: true,
      caseId,
      status: "submitted",
      message: `[Sandbox] Chargeback case ${caseId} submitted for review.`,
    };
  }

  async updateMerchant(processorApplicationId: string, _updates: Partial<MerchantProfile>): Promise<MerchantUpdateResult> {
    await new Promise(r => setTimeout(r, 100));
    console.log(`[MockAdapter] updateMerchant: ${processorApplicationId}`);
    return { success: true, message: "[Sandbox] Merchant profile updated." };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
