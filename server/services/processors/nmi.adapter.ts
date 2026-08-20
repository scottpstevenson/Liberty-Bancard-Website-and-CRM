import https from "https";
import querystring from "querystring";
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

function parseNmiResponse(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  raw.split("&").forEach((pair) => {
    const [key, value] = pair.split("=");
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return result;
}

function postToNmi(params: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(params);
    const options = {
      hostname: "secure.nmi.com",
      path: "/api/transact.php",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function postToNmiBoarding(
  securityKey: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, string>> {
  const body = querystring.stringify({ security_key: securityKey, ...params });
  const options = {
    hostname: "secure.nmi.com",
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(parseNmiResponse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function generateMockMid(): string {
  return Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("");
}

export class NmiProcessorAdapter implements IProcessorAdapter {
  readonly name = "nmi";
  readonly displayName = "NMI (Network Merchants, Inc.)";

  private get securityKey(): string | undefined {
    return process.env.NMI_SECURITY_KEY || undefined;
  }

  private get apiBase(): string | undefined {
    return process.env.PROCESSOR_API_BASE_URL || undefined;
  }

  private get apiKey(): string | undefined {
    return process.env.PROCESSOR_API_KEY || undefined;
  }

  private isFullyConfigured(): boolean {
    return !!(this.apiBase && this.apiKey);
  }

  async boardMerchant(profile: MerchantProfile): Promise<BoardingResult> {
    if (this.isFullyConfigured()) {
      try {
        // Forward the stable provider idempotency key as the standard HTTP
        // Idempotency-Key header so the NMI boarding endpoint can deduplicate
        // retries server-side. This is a standard REST idempotency pattern.
        const idempotencyHeaders: Record<string, string> = profile.providerIdempotencyKey
          ? { "Idempotency-Key": profile.providerIdempotencyKey }
          : {};
        const resp = await fetch(`${this.apiBase}/api/boarding/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "X-Source": "LibertyBancard-CRM",
            ...idempotencyHeaders,
          },
          body: JSON.stringify(profile),
        });

        if (!resp.ok) {
          // Never log raw provider error body — status code only.
          console.error(`[NmiAdapter] boardMerchant failed: HTTP ${resp.status}`);
          return { success: false, error: `NMI API error: ${resp.status}` };
        }

        const data = (await resp.json()) as any;
        return {
          success: true,
          processorApplicationId: data.applicationId || data.id,
          status: data.status || "submitted",
          message: data.message,
          estimatedDecisionDate: data.estimatedDecisionDate,
        };
      } catch {
        // Never log raw exception message — generic status-based error only.
        console.error("[NmiAdapter] boardMerchant exception");
        return { success: false, error: "NMI boarding request failed" };
      }
    }

    console.log("[NmiAdapter] Running in simulation mode — no PROCESSOR_API_KEY configured");
    await new Promise(r => setTimeout(r, 300));
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const applicationId = `APP-${ts}-${rand}`;
    const estimatedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return {
      success: true,
      processorApplicationId: applicationId,
      status: "submitted",
      message: `Application ${applicationId} submitted to NMI. Estimated decision: ${estimatedDate}.`,
      estimatedDecisionDate: estimatedDate,
    };
  }

  async getMerchantStatus(processorApplicationId: string): Promise<BoardingStatusResult> {
    if (this.isFullyConfigured()) {
      try {
        const resp = await fetch(
          `${this.apiBase}/api/boarding/status/${processorApplicationId}`,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "X-Source": "LibertyBancard-CRM",
            },
          },
        );

        if (!resp.ok) {
          return {
            success: false,
            processorApplicationId,
            status: "submitted",
            error: `NMI API error: ${resp.status}`,
          };
        }

        const data = (await resp.json()) as any;
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
        return {
          success: false,
          processorApplicationId,
          status: "submitted",
          error: err.message,
        };
      }
    }

    await new Promise(r => setTimeout(r, 150));
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

  async getTransactions(mid: string, startDate: string, endDate: string): Promise<Transaction[]> {
    if (this.isFullyConfigured()) {
      try {
        const resp = await fetch(
          `${this.apiBase}/api/reporting/mid/${mid}/transactions?start=${startDate}&end=${endDate}`,
          { headers: { Authorization: `Bearer ${this.apiKey}`, "X-Source": "LibertyBancard-CRM" } },
        );
        if (!resp.ok) return [];
        return (await resp.json()) as Transaction[];
      } catch {
        return [];
      }
    }
    return [];
  }

  async getResiduals(month: string, _agentId?: string): Promise<Residual[]> {
    if (this.isFullyConfigured()) {
      try {
        const resp = await fetch(
          `${this.apiBase}/api/reporting/residuals?month=${month}`,
          { headers: { Authorization: `Bearer ${this.apiKey}`, "X-Source": "LibertyBancard-CRM" } },
        );
        if (!resp.ok) return [];
        return (await resp.json()) as Residual[];
      } catch {
        return [];
      }
    }
    return [];
  }

  async getDailyStats(mid: string, startDate: string, endDate: string): Promise<DailyStats[]> {
    if (this.isFullyConfigured()) {
      try {
        const resp = await fetch(
          `${this.apiBase}/api/reporting/mid/${mid}/daily?start=${startDate}&end=${endDate}`,
          { headers: { Authorization: `Bearer ${this.apiKey}`, "X-Source": "LibertyBancard-CRM" } },
        );
        if (!resp.ok) {
          console.error(`[NmiAdapter] getDailyStats failed: ${resp.status}`);
          return [];
        }
        return (await resp.json()) as DailyStats[];
      } catch (err: any) {
        console.error("[NmiAdapter] getDailyStats exception:", err.message);
        return [];
      }
    }

    const results: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const seed = (mid + dateStr).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const rng = (o: number) => { const x = Math.sin(seed + o) * 10000; return x - Math.floor(x); };
        const baseVolume = 15000 + rng(1) * 85000;
        const txCount = Math.floor(50 + rng(2) * 450);
        const avgTicket = txCount > 0 ? baseVolume / txCount : 0;
        const effectiveRate = 0.015 + rng(3) * 0.025;
        const chargebackCount = rng(4) < 0.03 ? Math.floor(rng(5) * 3) : 0;
        const chargebackAmount = chargebackCount * avgTicket;
        const refundCount = Math.floor(rng(6) * 5);
        results.push({
          mid,
          date: dateStr,
          volume: Math.round(baseVolume * 100) / 100,
          txCount,
          avgTicket: Math.round(avgTicket * 100) / 100,
          effectiveRate: Math.round(effectiveRate * 10000) / 10000,
          chargebackCount,
          chargebackAmount: Math.round(chargebackAmount * 100) / 100,
          refundCount,
        });
      }
      current.setDate(current.getDate() + 1);
    }
    return results;
  }

  async submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult> {
    if (this.securityKey) {
      try {
        const params: Record<string, string> = {
          type: "chargeback",
          transactionid: submission.transactionId,
          amount: String(submission.amount),
          merchant_id: submission.mid,
        };
        const parsed = await postToNmiBoarding(this.securityKey, "/api/transact.php", params);
        const approved = parsed.response === "1";
        return {
          success: approved,
          caseId: parsed.transactionid,
          status: approved ? "submitted" : "failed",
          message: parsed.responsetext,
          error: approved ? undefined : parsed.responsetext,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    console.log("[NmiAdapter] submitChargeback in simulation mode");
    return {
      success: true,
      caseId: `CB-SIM-${Date.now()}`,
      status: "submitted",
      message: "Chargeback case submitted (simulation).",
    };
  }

  async updateMerchant(processorApplicationId: string, updates: Partial<MerchantProfile>): Promise<MerchantUpdateResult> {
    if (this.isFullyConfigured()) {
      try {
        const resp = await fetch(`${this.apiBase}/api/boarding/merchant/${processorApplicationId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "X-Source": "LibertyBancard-CRM",
          },
          body: JSON.stringify(updates),
        });
        if (!resp.ok) {
          return { success: false, error: `NMI API error: ${resp.status}` };
        }
        return { success: true, message: "Merchant profile updated." };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    console.log(`[NmiAdapter] updateMerchant simulation: ${processorApplicationId}`);
    return { success: true, message: "Merchant profile updated (simulation)." };
  }

  async ping(): Promise<boolean> {
    if (this.securityKey) {
      try {
        const parsed = await postToNmiBoarding(this.securityKey, "/api/transact.php", {
          type: "validate",
          amount: "0.00",
        });
        return parsed.response === "1" || !!parsed.responsetext;
      } catch {
        return false;
      }
    }
    if (this.apiBase && this.apiKey) {
      try {
        const resp = await fetch(`${this.apiBase}/health`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        return resp.ok;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export { postToNmi, parseNmiResponse };
