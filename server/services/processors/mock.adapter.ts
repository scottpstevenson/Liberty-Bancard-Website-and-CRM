/**
 * Mock Processor Adapter — TEST AND SANDBOX ONLY
 *
 * Every return from this adapter is permanently fake / sandboxed data.
 * This adapter MUST NEVER be enabled in production with real merchant data.
 * Registry warns when mock is enabled in production (NODE_ENV=production).
 *
 * #1737 domain functions (getTransactions, getResiduals, getDailyStats,
 * submitChargeback) return HeldResult — these are Task #1737 (REV-06A) scope.
 */
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
  ProcessorHealthState,
  HeldResult,
} from "./IProcessorAdapter";

const FAKE_LABEL = "[SANDBOX — NOT REAL DATA]";

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

export class MockProcessorAdapter implements IProcessorAdapter {
  readonly name = "mock";
  readonly displayName = "Mock / Sandbox";

  async boardMerchant(profile: MerchantProfile): Promise<BoardingResult> {
    // REV-05A: fail-closed when no snapshot-authorized URL is provided.
    // Mock adapter is exempt in non-production (synthetic snapshot used by outbox worker),
    // but direct adapter calls without a snapshot URL are always blocked.
    const snapshotUrl = (profile as any).snapshotAuthorizedBaseUrl as string | undefined;
    if (!snapshotUrl && process.env.NODE_ENV === "production") {
      return {
        success: false,
        error: "[REV-05A] MockAdapter.boardMerchant blocked in production: mock adapter disabled. " +
               "Configure a real processor adapter with a confirmed activation snapshot.",
      };
    }
    if (!snapshotUrl && process.env.NODE_ENV !== "production") {
      // In non-production, Mock boarding is allowed only through the registry's
      // snapshot-gated path (which supplies a synthetic snapshot URL).
      // Direct calls without a URL are blocked to mirror production behavior.
      return {
        success: false,
        error: "[REV-05A] MockAdapter.boardMerchant blocked: snapshotAuthorizedBaseUrl required " +
               "even in non-production. Use the registry's gated path (outbox worker) instead.",
      };
    }
    await new Promise(r => setTimeout(r, 200));
    const applicationId = generateMockApplicationId();
    const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    console.log(`[MockAdapter] ${FAKE_LABEL} boardMerchant: deal ${profile.dealId} → ${applicationId}`);
    return {
      success: true,
      processorApplicationId: applicationId,
      status: "submitted",
      message: `${FAKE_LABEL} Application ${applicationId} submitted. Estimated decision: ${estimatedDate}.`,
      estimatedDecisionDate: estimatedDate,
    };
  }

  async getMerchantStatus(processorApplicationId: string, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<BoardingStatusResult> {
    // REV-05A: fail-closed when no snapshot-authorized URL is provided.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        processorApplicationId,
        status: "submitted",
        error: "[REV-05A] MockAdapter.getMerchantStatus blocked: snapshotAuthorizedBaseUrl required. " +
               "Use the registry's gated path instead.",
      };
    }
    await new Promise(r => setTimeout(r, 100));
    const seed = processorApplicationId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100;

    let status: BoardingStatusResult["status"] = "under_review";
    let mid: string | undefined;
    let message = "Application is under review by the processor.";
    let moreInfoRequest: string | undefined;

    if (seed < 20) {
      status = "submitted";
      message = `${FAKE_LABEL} Application received and queued for review.`;
    } else if (seed < 55) {
      status = "under_review";
      message = `${FAKE_LABEL} Underwriting team is reviewing your application.`;
    } else if (seed < 70) {
      status = "approved";
      mid = generateMockMid();
      message = `${FAKE_LABEL} Application approved. MID assigned.`;
    } else if (seed < 80) {
      status = "more_info_needed";
      message = `${FAKE_LABEL} Processor requires additional information.`;
      moreInfoRequest = "Please provide 3 months of business bank statements and a void check.";
    } else {
      status = "under_review";
      message = `${FAKE_LABEL} Application pending final underwriting review.`;
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

  /**
   * getTransactions — #1737 DOMAIN — returns HeldResult.
   * Transactions/stats are Task #1737 (REV-06A) scope. Never fake.
   */
  async getTransactions(_mid: string, _startDate: string, _endDate: string): Promise<Transaction[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  /**
   * getResiduals — #1737 DOMAIN — returns HeldResult.
   */
  async getResiduals(_month: string, _agentId?: string): Promise<Residual[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  /**
   * getDailyStats — #1737 DOMAIN — returns HeldResult.
   */
  async getDailyStats(_mid: string, _startDate: string, _endDate: string): Promise<DailyStats[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  /**
   * submitChargeback — #1737 DOMAIN — returns HeldResult.
   */
  async submitChargeback(_submission: ChargebackSubmission): Promise<ChargebackResult | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  async updateMerchant(processorApplicationId: string, _updates: Partial<MerchantProfile>, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<MerchantUpdateResult> {
    // REV-05A: fail-closed when no snapshot-authorized URL is provided.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        error: "[REV-05A] MockAdapter.updateMerchant blocked: snapshotAuthorizedBaseUrl required. " +
               "Use the registry's gated path instead.",
      };
    }
    await new Promise(r => setTimeout(r, 100));
    console.log(`[MockAdapter] ${FAKE_LABEL} updateMerchant: ${processorApplicationId}`);
    return { success: true, message: `${FAKE_LABEL} Merchant profile updated.` };
  }

  async getHealthState(_snapshotAuthorizedBaseUrl?: string | null): Promise<ProcessorHealthState> {
    // Mock adapter is always in sandbox state — never production_authorized.
    return process.env.NODE_ENV === "production" ? "held" : "sandbox_verified";
  }

  async ping(): Promise<boolean> {
    const state = await this.getHealthState();
    return state === "sandbox_verified" || state === "production_authorized";
  }
}
