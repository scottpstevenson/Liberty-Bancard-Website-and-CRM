/**
 * Payarc Processor Adapter
 *
 * Implements IProcessorAdapter against Payarc's REST API (api.payarc.net/v1).
 * Auth: Bearer token via PAYARC_API_KEY env var.
 * Falls back to simulation mode when the key is absent (dev/test).
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
} from "./IProcessorAdapter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE = "https://api.payarc.net/v1";
const TIMEOUT_MS = 20_000;

function generateMockApplicationId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PAYARC-${ts}-${rand}`;
}

function generateMockMid(): string {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
}

function seededRng(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10_000;
  return x - Math.floor(x);
}

/** Map Payarc applicant status string → our shared status enum */
function mapPayarcStatus(raw: string): BoardingStatusResult["status"] {
  switch ((raw ?? "").toLowerCase()) {
    case "approved":
    case "active":
      return "approved";
    case "declined":
    case "rejected":
    case "denied":
      return "declined";
    case "under_review":
    case "in_review":
    case "review":
    case "processing":
      return "under_review";
    case "more_info_needed":
    case "information_needed":
    case "pending_info":
    case "additional_info":
      return "more_info_needed";
    case "submitted":
    case "pending":
    default:
      return "submitted";
  }
}

/** Build the Payarc applicant payload from our internal MerchantProfile */
function buildApplicantPayload(p: MerchantProfile): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    legal_name: p.legalBusinessName,
    ...(p.dba && { dba_name: p.dba }),
    ...(p.ein && { ein: p.ein }),
    ...(p.businessType && { business_type: p.businessType }),
    ...(p.businessAddress && { address: p.businessAddress }),
    ...(p.businessCity && { city: p.businessCity }),
    ...(p.businessState && { state: p.businessState }),
    ...(p.businessZip && { zip: p.businessZip }),
    ...(p.businessPhone && { phone: p.businessPhone }),
    ...(p.businessEmail && { email: p.businessEmail }),
    ...(p.website && { website: p.website }),
    ...(p.vertical && { mcc_description: p.vertical }),
    ...(p.estimatedMonthlyVolume && {
      monthly_volume: parseFloat(p.estimatedMonthlyVolume) || undefined,
      annual_card_volume: (parseFloat(p.estimatedMonthlyVolume) || 0) * 12,
    }),
    ...(p.estimatedAvgTicket && { avg_ticket: parseFloat(p.estimatedAvgTicket) || undefined }),
    ...(p.preferredProgram && { preferred_program: p.preferredProgram }),
    source: "LibertyBancard-CRM",
  };

  // Owner object
  const hasOwner = p.ownerFirstName || p.ownerLastName || p.ownerEmail || p.ownerSsn;
  if (hasOwner) {
    payload.owner = {
      ...(p.ownerFirstName && { first_name: p.ownerFirstName }),
      ...(p.ownerLastName && { last_name: p.ownerLastName }),
      ...(p.ownerEmail && { email: p.ownerEmail }),
      ...(p.ownerPhone && { phone: p.ownerPhone }),
      ...(p.ownerDob && { dob: p.ownerDob }),
      ...(p.ownerSsn && { ssn: p.ownerSsn }),
      ...(p.ownerAddress && { address: p.ownerAddress }),
      ...(p.ownerCity && { city: p.ownerCity }),
      ...(p.ownerState && { state: p.ownerState }),
      ...(p.ownerZip && { zip: p.ownerZip }),
      ownership_pct: 100,
    };
  }

  // Bank object
  const hasBank = p.bankRoutingNumber || p.bankAccountNumber;
  if (hasBank) {
    payload.bank = {
      ...(p.bankRoutingNumber && { routing_number: p.bankRoutingNumber }),
      ...(p.bankAccountNumber && { account_number: p.bankAccountNumber }),
      ...(p.bankAccountType && { account_type: p.bankAccountType }),
    };
  }

  return payload;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function payarcRequest<T = unknown>(
  apiKey: string,
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<{ ok: boolean; status: number; data: T; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Source": "LibertyBancard-CRM",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await resp.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }

    clearTimeout(timer);
    return { ok: resp.ok, status: resp.status, data, text };
  } catch (err: any) {
    clearTimeout(timer);
    // Retry once on network error (not on 4xx/5xx)
    if (attempt === 0 && (err.name === "AbortError" || err.code === "ECONNRESET")) {
      console.warn(`[PayarcAdapter] ${method} ${path} — retrying after error: ${err.message}`);
      await new Promise(r => setTimeout(r, 1_000));
      return payarcRequest(apiKey, baseUrl, method, path, body, 1);
    }
    throw err;
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class PayarcProcessorAdapter implements IProcessorAdapter {
  readonly name = "payarc";
  readonly displayName = "Payarc";

  private get apiKey(): string | undefined {
    return process.env.PAYARC_API_KEY || undefined;
  }

  private get baseUrl(): string {
    return (process.env.PAYARC_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  }

  private isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── boardMerchant ─────────────────────────────────────────────────────────

  async boardMerchant(profile: MerchantProfile): Promise<BoardingResult> {
    if (this.isConfigured()) {
      try {
        const body = buildApplicantPayload(profile);
        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "POST",
          "/applicants",
          body,
        );

        if (!ok) {
          const msg = data?.message || data?.error || `HTTP ${status}`;
          console.error(`[PayarcAdapter] boardMerchant failed: ${status} — ${msg}`);
          return { success: false, error: `Payarc API error (${status}): ${msg}` };
        }

        // Payarc returns { data: { object_id, id, status, ... } } or flat { object_id, ... }
        const applicant = data?.data ?? data;
        const applicationId = applicant?.object_id || applicant?.id || applicant?.applicant_id;

        if (!applicationId) {
          console.error("[PayarcAdapter] boardMerchant: no application ID in response", data);
          return { success: false, error: "Payarc returned success but no application ID" };
        }

        const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        return {
          success: true,
          processorApplicationId: String(applicationId),
          status: mapPayarcStatus(applicant?.status ?? "submitted"),
          message: `Application ${applicationId} submitted to Payarc. Estimated decision: ${estimatedDate}.`,
          estimatedDecisionDate: applicant?.estimated_decision_date || estimatedDate,
        };
      } catch (err: any) {
        console.error("[PayarcAdapter] boardMerchant exception:", err.message);
        return { success: false, error: err.message };
      }
    }

    // Simulation mode
    console.log("[PayarcAdapter] Simulation mode — PAYARC_API_KEY not set");
    await new Promise(r => setTimeout(r, 250));
    const applicationId = generateMockApplicationId();
    const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    return {
      success: true,
      processorApplicationId: applicationId,
      status: "submitted",
      message: `[Simulation] Application ${applicationId} submitted to Payarc. Estimated decision: ${estimatedDate}.`,
      estimatedDecisionDate: estimatedDate,
    };
  }

  // ── getMerchantStatus ─────────────────────────────────────────────────────

  async getMerchantStatus(processorApplicationId: string): Promise<BoardingStatusResult> {
    if (this.isConfigured()) {
      try {
        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "GET",
          `/applicants/${processorApplicationId}`,
        );

        if (!ok) {
          return {
            success: false,
            processorApplicationId,
            status: "submitted",
            error: `Payarc API error (${status})`,
          };
        }

        const applicant = data?.data ?? data;
        const mappedStatus = mapPayarcStatus(applicant?.status ?? "submitted");
        const mid = applicant?.mid || applicant?.merchant_id || applicant?.merchant?.mid;

        return {
          success: true,
          processorApplicationId,
          status: mappedStatus,
          mid: mid ? String(mid) : undefined,
          message: applicant?.message || applicant?.status_message || undefined,
          moreInfoRequest: applicant?.additional_info_request || applicant?.info_request || undefined,
          declineReason: applicant?.decline_reason || applicant?.rejection_reason || undefined,
          approvedAt: applicant?.approved_at || applicant?.approval_date || undefined,
        };
      } catch (err: any) {
        return {
          success: false,
          processorApplicationId,
          status: "submitted",
          error: err.message,
        };
      }
    }

    // Simulation mode
    await new Promise(r => setTimeout(r, 100));
    const seed =
      processorApplicationId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100;

    let simStatus: BoardingStatusResult["status"] = "under_review";
    let mid: string | undefined;
    let message = "Application is under review.";
    let moreInfoRequest: string | undefined;

    if (seed < 20) {
      simStatus = "submitted";
      message = "[Simulation] Application received and queued for review.";
    } else if (seed < 55) {
      simStatus = "under_review";
      message = "[Simulation] Underwriting team is reviewing your application.";
    } else if (seed < 70) {
      simStatus = "approved";
      mid = generateMockMid();
      message = `[Simulation] Application approved. MID ${mid} has been assigned.`;
    } else if (seed < 80) {
      simStatus = "more_info_needed";
      message = "[Simulation] Payarc requires additional information.";
      moreInfoRequest =
        "Please provide the most recent 3 months of business bank statements and a voided check.";
    } else {
      simStatus = "under_review";
      message = "[Simulation] Application pending final underwriting review.";
    }

    return {
      success: true,
      processorApplicationId,
      status: simStatus,
      mid,
      message,
      moreInfoRequest,
      approvedAt: simStatus === "approved" ? new Date().toISOString() : undefined,
    };
  }

  // ── getTransactions ───────────────────────────────────────────────────────

  async getTransactions(mid: string, startDate: string, endDate: string): Promise<Transaction[]> {
    if (this.isConfigured()) {
      try {
        const params = new URLSearchParams({
          mid,
          "created[gte]": startDate,
          "created[lte]": endDate,
          limit: "200",
        });
        const { ok, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "GET",
          `/charges?${params}`,
        );
        if (!ok) return [];

        const charges: any[] = data?.data ?? data ?? [];
        return charges.map((c: any): Transaction => ({
          id: String(c.object_id || c.id || c.charge_id),
          mid: String(c.mid || mid),
          date: (c.created_at || c.date || "").slice(0, 10),
          amount: parseFloat(c.amount || c.total || "0") / 100, // Payarc amounts in cents
          type:
            c.type === "refund" ? "refund"
            : c.type === "chargeback" ? "chargeback"
            : "sale",
          status:
            c.status === "approved" || c.status === "captured" ? "approved"
            : c.status === "declined" || c.status === "failed" ? "declined"
            : c.status === "voided" || c.status === "reversed" ? "reversed"
            : "pending",
          cardBrand: c.card_brand || c.brand || undefined,
          last4: c.last_4 || c.card_last4 || undefined,
          authCode: c.auth_code || c.authorization_code || undefined,
          orderId: c.order_id || undefined,
        }));
      } catch (err: any) {
        console.error("[PayarcAdapter] getTransactions exception:", err.message);
        return [];
      }
    }
    return [];
  }

  // ── getResiduals ──────────────────────────────────────────────────────────

  async getResiduals(month: string, _agentId?: string): Promise<Residual[]> {
    if (this.isConfigured()) {
      try {
        const params = new URLSearchParams({ month, limit: "500" });
        const { ok, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "GET",
          `/splits?${params}`,
        );
        if (!ok) return [];

        const rows: any[] = data?.data ?? data ?? [];
        return rows.map((r: any): Residual => ({
          mid: String(r.mid || r.merchant_id || ""),
          month: r.month || month,
          grossRevenue: parseFloat(r.gross_revenue || r.gross || "0"),
          processorFees: parseFloat(r.processor_fees || r.fees || "0"),
          agentResidual: parseFloat(r.agent_residual || r.residual || r.net || "0"),
          merchantName: r.merchant_name || r.dba || undefined,
          txCount: parseInt(r.transaction_count || r.tx_count || "0", 10) || undefined,
          volume: parseFloat(r.volume || r.total_volume || "0") || undefined,
        }));
      } catch (err: any) {
        console.error("[PayarcAdapter] getResiduals exception:", err.message);
        return [];
      }
    }
    return [];
  }

  // ── getDailyStats ─────────────────────────────────────────────────────────

  async getDailyStats(mid: string, startDate: string, endDate: string): Promise<DailyStats[]> {
    if (this.isConfigured()) {
      try {
        const params = new URLSearchParams({
          mid,
          start_date: startDate,
          end_date: endDate,
          granularity: "daily",
        });
        const { ok, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "GET",
          `/reports/daily_summary?${params}`,
        );
        if (!ok) return [];

        const rows: any[] = data?.data ?? data ?? [];
        return rows.map((r: any): DailyStats => ({
          mid: String(r.mid || mid),
          date: (r.date || r.report_date || "").slice(0, 10),
          volume: parseFloat(r.volume || r.total_volume || "0"),
          txCount: parseInt(r.transaction_count || r.tx_count || "0", 10),
          avgTicket: parseFloat(r.avg_ticket || "0"),
          effectiveRate: parseFloat(r.effective_rate || r.rate || "0"),
          chargebackCount: parseInt(r.chargeback_count || r.chargebacks || "0", 10),
          chargebackAmount: parseFloat(r.chargeback_amount || "0"),
          refundCount: parseInt(r.refund_count || r.refunds || "0", 10),
        }));
      } catch (err: any) {
        console.error("[PayarcAdapter] getDailyStats exception:", err.message);
        return [];
      }
    }

    // Simulation — deterministic by MID + date so the dashboard stays consistent
    const results: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const cursor = new Date(start);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        const seed = (mid + dateStr).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const baseVolume = 15_000 + seededRng(seed, 1) * 85_000;
        const txCount = Math.floor(50 + seededRng(seed, 2) * 450);
        const avgTicket = txCount > 0 ? baseVolume / txCount : 0;
        const effectiveRate = 0.015 + seededRng(seed, 3) * 0.025;
        const cbCount = seededRng(seed, 4) < 0.03 ? Math.floor(seededRng(seed, 5) * 3) : 0;
        results.push({
          mid,
          date: dateStr,
          volume: Math.round(baseVolume * 100) / 100,
          txCount,
          avgTicket: Math.round(avgTicket * 100) / 100,
          effectiveRate: Math.round(effectiveRate * 10_000) / 10_000,
          chargebackCount: cbCount,
          chargebackAmount: Math.round(cbCount * avgTicket * 100) / 100,
          refundCount: Math.floor(seededRng(seed, 6) * 5),
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return results;
  }

  // ── submitChargeback ──────────────────────────────────────────────────────

  async submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult> {
    if (this.isConfigured()) {
      try {
        const body = {
          mid: submission.mid,
          transaction_id: submission.transactionId,
          amount: Math.round(submission.amount * 100), // Payarc expects cents
          reason: submission.reason,
          card_brand: submission.cardBrand,
          ...(submission.caseNumber && { case_number: submission.caseNumber }),
          ...(submission.responseDeadline && { response_deadline: submission.responseDeadline }),
          ...(submission.evidenceNotes && { evidence_notes: submission.evidenceNotes }),
          source: "LibertyBancard-CRM",
        };

        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "POST",
          "/disputes",
          body,
        );

        if (!ok) {
          const msg = data?.message || data?.error || `HTTP ${status}`;
          return { success: false, error: `Payarc dispute error (${status}): ${msg}` };
        }

        const dispute = data?.data ?? data;
        return {
          success: true,
          caseId: String(dispute?.object_id || dispute?.id || dispute?.dispute_id || ""),
          status: dispute?.status || "submitted",
          message: dispute?.message || "Dispute submitted to Payarc.",
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Simulation
    await new Promise(r => setTimeout(r, 150));
    const caseId = `CB-SIM-${Date.now()}`;
    console.log(`[PayarcAdapter] submitChargeback simulation: MID ${submission.mid} → ${caseId}`);
    return {
      success: true,
      caseId,
      status: "submitted",
      message: `[Simulation] Dispute ${caseId} submitted to Payarc.`,
    };
  }

  // ── updateMerchant ────────────────────────────────────────────────────────

  async updateMerchant(
    processorApplicationId: string,
    updates: Partial<MerchantProfile>,
  ): Promise<MerchantUpdateResult> {
    if (this.isConfigured()) {
      try {
        const body: Record<string, unknown> = {
          ...(updates.legalBusinessName && { legal_name: updates.legalBusinessName }),
          ...(updates.dba && { dba_name: updates.dba }),
          ...(updates.businessPhone && { phone: updates.businessPhone }),
          ...(updates.businessEmail && { email: updates.businessEmail }),
          ...(updates.website && { website: updates.website }),
          ...(updates.businessAddress && { address: updates.businessAddress }),
          ...(updates.businessCity && { city: updates.businessCity }),
          ...(updates.businessState && { state: updates.businessState }),
          ...(updates.businessZip && { zip: updates.businessZip }),
        };

        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          this.baseUrl,
          "PATCH",
          `/applicants/${processorApplicationId}`,
          body,
        );

        if (!ok) {
          const msg = data?.message || data?.error || `HTTP ${status}`;
          return { success: false, error: `Payarc update error (${status}): ${msg}` };
        }

        return { success: true, message: "Merchant profile updated in Payarc." };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    console.log(`[PayarcAdapter] updateMerchant simulation: ${processorApplicationId}`);
    return { success: true, message: "[Simulation] Merchant profile updated." };
  }

  // ── ping ──────────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const { ok, status } = await payarcRequest<any>(
        this.apiKey!,
        this.baseUrl,
        "GET",
        "/accounts/me",
      );
      // 200 or 404 both prove the API is reachable and the token is accepted
      return ok || status === 404;
    } catch {
      return false;
    }
  }
}
