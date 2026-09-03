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
  ProcessorHealthState,
  HeldResult,
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
    // REV-05A: fail-closed unless a snapshot-authorized URL is provided via the profile.
    // Using the env-var base URL without an owner-approved snapshot allows authenticated
    // POST traffic to unapproved endpoints.
    const snapshotAuthorizedBaseUrl = (profile as any).snapshotAuthorizedBaseUrl as string | undefined;
    if (!snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        error: "[REV-05A] NmiAdapter.boardMerchant blocked: snapshotAuthorizedBaseUrl required. " +
               "Obtain an activation snapshot before calling adapter transport methods.",
      };
    }

    if (this.isFullyConfigured()) {
      try {
        // Forward the stable provider idempotency key as the standard HTTP
        // Idempotency-Key header so the NMI boarding endpoint can deduplicate
        // retries server-side. This is a standard REST idempotency pattern.
        const idempotencyHeaders: Record<string, string> = profile.providerIdempotencyKey
          ? { "Idempotency-Key": profile.providerIdempotencyKey }
          : {};
        const effectiveBase = snapshotAuthorizedBaseUrl.replace(/\/$/, "");
        const resp = await fetch(`${effectiveBase}/api/boarding/submit`, {
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
        // REV-05A: ALL exceptions from a POST transport call are ambiguous —
        // any network error may mean the provider received the request but we lost
        // the response. Blind retry risks duplicate merchant applications.
        console.error("[NmiAdapter] boardMerchant network_exception (ambiguous)");
        return {
          success: false,
          ambiguous: true,
          error: "NMI boarding request failed (network_exception) — ambiguous result, hold for reconciliation",
        };
      }
    }

    // REV-05A: NMI boarding is fail-closed when credentials are absent.
    const errMsg = "[REV-05A] NMI boarding blocked: PROCESSOR_API_KEY not configured.";
    console.error(`[NmiAdapter] ${errMsg}`);
    return { success: false, error: errMsg };
  }

  async getMerchantStatus(processorApplicationId: string, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<BoardingStatusResult> {
    // REV-05A: fail-closed unless a snapshot-authorized URL is provided.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        processorApplicationId,
        status: "submitted",
        error: "[REV-05A] NmiAdapter.getMerchantStatus blocked: snapshotAuthorizedBaseUrl required. " +
               "Obtain an activation snapshot before calling adapter transport methods.",
      };
    }

    if (this.isFullyConfigured()) {
      try {
        const effectiveBase = options.snapshotAuthorizedBaseUrl.replace(/\/$/, "");
        const resp = await fetch(
          `${effectiveBase}/api/boarding/status/${processorApplicationId}`,
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
      } catch {
        return {
          success: false,
          processorApplicationId,
          status: "submitted",
          error: "NMI status request failed",
        };
      }
    }

    // REV-05A: NMI status polling is fail-closed when credentials are absent.
    const errMsg = "[REV-05A] NMI status poll blocked: PROCESSOR_API_KEY not configured.";
    console.error(`[NmiAdapter] ${errMsg}`);
    return { success: false, processorApplicationId, status: "submitted", error: errMsg };
  }

  // REV-05A §13/#1737: getTransactions is a #1737-domain function.
  // Returns held result — pending_task_1737 owns transaction data.
  async getTransactions(_mid: string, _startDate: string, _endDate: string): Promise<HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  // REV-05A §13/#1737: getResiduals is a #1737-domain function.
  // Returns held result — pending_task_1737 owns residual data.
  async getResiduals(_month: string, _agentId?: string): Promise<HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  // REV-05A §13/#1737: getDailyStats is a #1737-domain function.
  // Returns held result — pending_task_1737 owns daily stats and
  // all simulation data generation has been removed.
  async getDailyStats(_mid: string, _startDate: string, _endDate: string): Promise<HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  // REV-05A §13/#1737: submitChargeback is a #1737-domain function.
  // Returns held result — pending_task_1737 owns chargeback submissions.
  async submitChargeback(_submission: ChargebackSubmission): Promise<HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  async updateMerchant(processorApplicationId: string, updates: Partial<MerchantProfile>, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<MerchantUpdateResult> {
    // REV-05A: fail-closed unless a snapshot-authorized URL is provided.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        error: "[REV-05A] NmiAdapter.updateMerchant blocked: snapshotAuthorizedBaseUrl required. " +
               "Obtain an activation snapshot before calling adapter transport methods.",
      };
    }

    if (this.isFullyConfigured()) {
      try {
        const effectiveBase = options.snapshotAuthorizedBaseUrl.replace(/\/$/, "");
        const resp = await fetch(`${effectiveBase}/api/boarding/merchant/${processorApplicationId}`, {
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
      } catch {
        return { success: false, error: "NMI update request failed" };
      }
    }
    // REV-05A: updateMerchant is fail-closed when credentials are absent.
    const errMsg = "[REV-05A] NMI updateMerchant blocked: PROCESSOR_API_KEY not configured.";
    console.error(`[NmiAdapter] ${errMsg}`);
    return { success: false, error: errMsg };
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

  // REV-05A: Processor health state (NMI adapter).
  async getHealthState(snapshotAuthorizedBaseUrl?: string | null): Promise<ProcessorHealthState> {
    if (!this.apiBase && !this.securityKey) return "missing_credentials";
    if (!this.isFullyConfigured()) return "configured_unverified";

    // REV-05A: A health probe is an authenticated request to the processor.
    // It MUST use the owner-approved snapshot URL — calling ping() against
    // this.apiBase would send credentials to an endpoint not authorized by
    // the activation snapshot. Without a snapshot URL, return missing_contract.
    if (!snapshotAuthorizedBaseUrl) {
      return "missing_contract";
    }

    if (this.securityKey) {
      // NMI HTTPS POST boarding — no URL substitution needed (fixed endpoint).
      try {
        const parsed = await postToNmiBoarding(this.securityKey, "/api/transact.php", {
          type: "validate",
          amount: "0.00",
        });
        return (parsed.response === "1" || !!parsed.responsetext)
          ? "sandbox_verified"
          : "configured_unverified";
      } catch {
        return "configured_unverified";
      }
    }

    // REST-style NMI: use the snapshot-authorized base URL, not this.apiBase.
    try {
      const resp = await fetch(`${snapshotAuthorizedBaseUrl.replace(/\/$/, "")}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey ?? ""}` },
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok ? "sandbox_verified" : "configured_unverified";
    } catch {
      return "configured_unverified";
    }
  }
}

export { postToNmi, parseNmiResponse };
