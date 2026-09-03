/**
 * Payarc Processor Adapter (REV-05A)
 *
 * Implements IProcessorAdapter against Payarc's REST API (api.payarc.net/v1).
 * Auth: Bearer token via PAYARC_API_KEY env var.
 *
 * CHANGES FROM PRE-REV-05A:
 *   - ping() no longer returns true on HTTP 404. Only 2xx = success.
 *   - getHealthState() returns typed ProcessorHealthState enum.
 *   - Simulation fallback in boardMerchant() is preserved (dev/test only).
 *   - #1737 domain functions (getDailyStats, getResiduals, getTransactions,
 *     submitChargeback) return HeldResult when credentials ARE configured
 *     (they were previously calling live Payarc endpoints, but those paths
 *     are Task #1737 scope and must not be certified here).
 *   - Simulation path in getDailyStats REMOVED; now returns HeldResult.
 *   - updateMerchant simulation path REMOVED; returns error when unconfigured.
 *   - Transport remains paused until activation snapshot is confirmed.
 *
 * Program-aware routing:
 *   Traditional: POST /v1/applicants
 *   Payfac: POST /v1/agent-hub/apply/add-lead/ (NOT activated — program must
 *           be confirmed in activation snapshot before Payfac transport activates)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE = "https://api.payarc.net/v1";
const TIMEOUT_MS = 20_000;

function generateMockApplicationId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PAYARC-${ts}-${rand}`;
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
  extraHeaders?: Record<string, string>,
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
        ...extraHeaders,
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
    // REV-05A: Never retry POST/PATCH/DELETE on AbortError or network errors.
    // A timeout without a known provider ID is an ambiguous result — the
    // request may have succeeded on the provider side. Retrying could create
    // a duplicate merchant application. Payarc idempotency-header dedup is
    // NOT certified, so caller must use the reconciliation_required path.
    // Only GET (read-only) requests are safe to retry on transient errors.
    if (attempt === 0 && method === "GET" && err.code === "ECONNRESET") {
      console.warn(`[PayarcAdapter] GET ${path} — retrying after ECONNRESET`);
      await new Promise(r => setTimeout(r, 1_000));
      return payarcRequest(apiKey, baseUrl, method, path, body, 1, extraHeaders);
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

  // ── getHealthState ─────────────────────────────────────────────────────────

  /**
   * Returns the typed health/readiness state of this adapter.
   *
   * Rules:
   *   - HTTP 404 from identity endpoint = configured_unverified (not valid).
   *   - Any non-2xx = configured_unverified or lower.
   *   - sandbox_verified requires explicit authenticated 2xx from identity endpoint.
   *   - production_authorized requires sandbox_verified + activation snapshot.
   */
  async getHealthState(snapshotAuthorizedBaseUrl?: string | null): Promise<ProcessorHealthState> {
    if (!this.isConfigured()) {
      return "missing_credentials";
    }

    // REV-05A: A health probe is an authenticated request to the processor.
    // It MUST use the owner-approved snapshot URL — falling back to the
    // environment-variable base URL would send credentials to an endpoint
    // not authorized by the activation snapshot.
    // If no snapshot URL is provided (e.g. called before a snapshot exists),
    // return missing_contract rather than probing an unapproved endpoint.
    if (!snapshotAuthorizedBaseUrl) {
      return "missing_contract";
    }
    const probeBase = snapshotAuthorizedBaseUrl.replace(/\/$/, "");

    try {
      const { ok, status } = await payarcRequest<any>(
        this.apiKey!,
        probeBase,
        "GET",
        "/accounts/me",
      );

      if (ok) {
        // Only 2xx proves the token is valid and the API is reachable.
        // We do not check activation snapshot here — that is a separate gate
        // in the outbox worker. Health state is about credential validity only.
        return "sandbox_verified";
      }

      // Non-2xx — including 404 — does NOT prove the token works.
      if (status === 401 || status === 403) {
        return "configured_unverified";
      }

      // Other errors (429, 5xx, etc.) — credentials may be fine but server error
      return "configured_unverified";
    } catch {
      // Network error — cannot determine state
      return "configured_unverified";
    }
  }

  // ── ping ──────────────────────────────────────────────────────────────────

  /**
   * Returns true only when the adapter is sandbox_verified or production_authorized.
   * HTTP 404 is NOT a valid ping result; any non-2xx returns false.
   */
  async ping(snapshotAuthorizedBaseUrl?: string | null): Promise<boolean> {
    // REV-05A: ping() must also use the snapshot-authorized URL.
    // Without it, getHealthState returns missing_contract (not sandbox_verified).
    const state = await this.getHealthState(snapshotAuthorizedBaseUrl);
    return state === "sandbox_verified" || state === "production_authorized";
  }

  // ── boardMerchant ─────────────────────────────────────────────────────────

  async boardMerchant(profile: MerchantProfile): Promise<BoardingResult> {
    if (this.isConfigured()) {
      try {
        const body = buildApplicantPayload(profile);
        // Forward the stable provider idempotency key as the standard HTTP
        // Idempotency-Key header so Payarc can deduplicate retries server-side.
        // NOTE: Payarc server-side deduplication via this header is NOT certified
        // by public docs. Liberty-local idempotency (outbox dedupe) is authoritative.
        const idempotencyHeaders: Record<string, string> = profile.providerIdempotencyKey
          ? { "Idempotency-Key": profile.providerIdempotencyKey }
          : {};

        // Program-aware endpoint routing (REV-05A §5):
        // Traditional: POST /v1/applicants
        // Payfac: POST /v1/agent-hub/apply/add-lead/
        // The program is sourced from the activation snapshot, passed via profile.
        const program = (profile as any).processorProgram ?? "traditional";
        const submitPath = program === "payfac"
          ? "/agent-hub/apply/add-lead/"
          : "/applicants";

        // REV-05A: fail-closed when no snapshot-authorized URL is provided.
        // No fallback to the env-var URL — using an unapproved endpoint for
        // authenticated merchant submissions is an authorization boundary violation.
        const snapshotUrl = (profile as any).snapshotAuthorizedBaseUrl as string | undefined;
        if (!snapshotUrl) {
          return {
            success: false,
            error: "[REV-05A] PayarcAdapter.boardMerchant blocked: snapshotAuthorizedBaseUrl required. " +
                   "Obtain an activation snapshot before calling adapter transport methods.",
          };
        }
        const effectiveBaseUrl = snapshotUrl.replace(/\/$/, "");

        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          effectiveBaseUrl,
          "POST",
          submitPath,
          body,
          0,
          idempotencyHeaders,
        );

        if (!ok) {
          console.error(`[PayarcAdapter] boardMerchant failed: HTTP ${status}`);
          return { success: false, error: `Payarc API error (${status})` };
        }

        // Payarc returns { data: { object_id, id, status, ... } } or flat { object_id, ... }
        const applicant = data?.data ?? data;
        const applicationId = applicant?.object_id || applicant?.id || applicant?.applicant_id;

        if (!applicationId) {
          // No application ID in response — classify as ambiguous.
          // Caller must NOT retry immediately; use ambiguous_reconciliation path.
          console.error("[PayarcAdapter] boardMerchant: no application ID in response — classifying as ambiguous");
          return {
            success: false,
            ambiguous: true,
            error: "Payarc returned success but no application ID — ambiguous result, hold for reconciliation",
          };
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
        // REV-05A: ALL exceptions from a POST transport call are classified as
        // ambiguous — any network exception (AbortError timeout, connection reset,
        // ECONNRESET, EPIPE, fetch failed, etc.) could mean the provider received
        // the request but we lost the response. Blind retry risks creating duplicate
        // merchant applications at the provider. Classify as ambiguous so the
        // caller holds for reconciliation instead of retrying immediately.
        const isTimeout = err?.name === "AbortError";
        const errLabel = isTimeout ? "timeout" : "network_exception";
        console.error(`[PayarcAdapter] boardMerchant ${errLabel}`);
        return {
          success: false,
          ambiguous: true,  // always ambiguous for POST transport errors
          error: isTimeout
            ? "Payarc request timed out — ambiguous result, hold for reconciliation"
            : `Payarc boarding request failed (${errLabel}) — ambiguous result, hold for reconciliation`,
        };
      }
    }

    // REV-05A: Simulation paths removed. Payarc adapter is fail-closed when
    // credentials are absent. Use MockProcessorAdapter for non-production testing.
    return {
      success: false,
      error: "[REV-05A] PayarcAdapter.boardMerchant: PAYARC_API_KEY not configured. " +
             "Simulation mode has been removed. Use MockProcessorAdapter for testing.",
    };
  }

  // ── getMerchantStatus ─────────────────────────────────────────────────────

  async getMerchantStatus(processorApplicationId: string, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<BoardingStatusResult> {
    // REV-05A: fail-closed when no snapshot-authorized URL is provided.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        processorApplicationId,
        status: "submitted",
        error: "[REV-05A] PayarcAdapter.getMerchantStatus blocked: snapshotAuthorizedBaseUrl required. " +
               "Obtain an activation snapshot before calling adapter transport methods.",
      };
    }
    const effectiveBaseUrl = options.snapshotAuthorizedBaseUrl.replace(/\/$/, "");
    if (this.isConfigured()) {
      try {
        const { ok, status, data } = await payarcRequest<any>(
          this.apiKey!,
          effectiveBaseUrl,
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
      } catch {
        return {
          success: false,
          processorApplicationId,
          status: "submitted",
          error: "Payarc status request failed",
        };
      }
    }

    // REV-05A: Simulation paths removed. Payarc adapter is fail-closed when
    // credentials are absent. Use MockProcessorAdapter for non-production testing.
    return {
      success: false,
      processorApplicationId,
      status: "submitted",
      error: "[REV-05A] PayarcAdapter.getMerchantStatus: PAYARC_API_KEY not configured. " +
             "Simulation mode has been removed. Use MockProcessorAdapter for testing.",
    };
  }

  // ── #1737 DOMAIN FUNCTIONS ────────────────────────────────────────────────
  // getTransactions, getResiduals, getDailyStats, submitChargeback are all
  // Task #1737 (REV-06A) scope. They return HeldResult here regardless of
  // whether credentials are configured. The simulation paths have been REMOVED.

  async getTransactions(_mid: string, _startDate: string, _endDate: string): Promise<Transaction[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  async getResiduals(_month: string, _agentId?: string): Promise<Residual[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  async getDailyStats(_mid: string, _startDate: string, _endDate: string): Promise<DailyStats[] | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  async submitChargeback(_submission: ChargebackSubmission): Promise<ChargebackResult | HeldResult> {
    return { status: "held", reason: "pending_task_1737" };
  }

  // ── updateMerchant ────────────────────────────────────────────────────────

  async updateMerchant(
    processorApplicationId: string,
    updates: Partial<MerchantProfile>,
    options?: { snapshotAuthorizedBaseUrl?: string },
  ): Promise<MerchantUpdateResult> {
    // REV-05A: fail-closed unless a snapshot-authorized URL is provided.
    // Using the env-var base URL without an owner-approved snapshot allows
    // authenticated PATCH traffic to unapproved endpoints.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        success: false,
        error: "[REV-05A] PayarcAdapter.updateMerchant blocked: snapshotAuthorizedBaseUrl required. " +
               "Obtain an activation snapshot before calling adapter transport methods.",
      };
    }

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
          options.snapshotAuthorizedBaseUrl.replace(/\/$/, ""),
          "PATCH",
          `/applicants/${processorApplicationId}`,
          body,
        );

        if (!ok) {
          const msg = data?.message || data?.error || `HTTP ${status}`;
          return { success: false, error: `Payarc update error (${status}): ${msg}` };
        }

        return { success: true, message: "Merchant profile updated in Payarc." };
      } catch {
        return { success: false, error: "Payarc update request failed" };
      }
    }

    // Simulation REMOVED — return error when unconfigured
    return {
      success: false,
      error: "PAYARC_API_KEY not configured. Cannot update merchant profile.",
    };
  }
}
