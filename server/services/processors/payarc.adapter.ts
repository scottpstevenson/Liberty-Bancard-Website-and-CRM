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
  DisputeEvidenceSubmission,
  ChargebackResult,
  MerchantUpdateResult,
  ProcessorHealthState,
  HeldResult,
} from "./IProcessorAdapter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE = "https://api.payarc.net/v1";

/** Mask a MID/account identifier for safe log output — shows only last 4 chars. */
function maskMid(mid: string): string {
  if (!mid || mid.length <= 4) return "***";
  return `***${mid.slice(-4)}`;
}
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

/**
 * Configurable rate-limit back-off delay (ms). Applied when Payarc returns
 * X-RateLimit-Remaining ≤ 1 or when the header is absent (fail-safe).
 * Default: 2 000 ms. Override via PAYARC_RATE_LIMIT_BACKOFF_MS env var.
 */
function getRateLimitBackoffMs(): number {
  const val = parseInt(process.env.PAYARC_RATE_LIMIT_BACKOFF_MS ?? "", 10);
  return Number.isFinite(val) && val > 0 ? val : 2_000;
}

/**
 * After every Payarc response, inspect X-RateLimit-Remaining.
 * If the value is 0, absent, or unparseable, insert a back-off delay
 * before the next request to prevent 429 exhaustion.
 */
async function applyRateLimitBackoff(headers: Headers, path: string): Promise<void> {
  const remaining = headers.get("x-ratelimit-remaining") ?? headers.get("X-RateLimit-Remaining");
  const remainingCount = remaining !== null ? parseInt(remaining, 10) : NaN;
  if (isNaN(remainingCount) || remainingCount <= 1) {
    const delayMs = getRateLimitBackoffMs();
    console.warn(
      `[PayarcAdapter] Rate-limit back-off: X-RateLimit-Remaining=${remaining ?? "absent"} on ${path} — pausing ${delayMs}ms`,
    );
    await new Promise(r => setTimeout(r, delayMs));
  }
}

async function payarcRequest<T = unknown>(
  apiKey: string,
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  attempt = 0,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: T; text: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        // extraHeaders first — any caller-supplied overrides are placed here.
        // The four required headers below ALWAYS win; they cannot be displaced
        // by extraHeaders regardless of what the caller passes.
        ...extraHeaders,
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

    // Apply rate-limit back-off before returning so every call site is protected.
    await applyRateLimitBackoff(resp.headers, path);

    return { ok: resp.ok, status: resp.status, data, text, headers: resp.headers };
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

/**
 * Paginated list fetch for Payarc list endpoints.
 *
 * Payarc list responses use the shape: { data: [...], meta: { current_page, last_page } }
 * or { data: { data: [...], current_page, last_page } }.
 * This helper fetches all pages and returns the concatenated item array.
 *
 * Exported so adapter callers and smoke tests can exercise it directly with
 * controlled fetch stubs to verify multi-page looping behavior.
 *
 * @param pageSize — items per page (default 100, Payarc's safe ceiling).
 */
/**
 * Error thrown by payarcFetchAll on any non-2xx response or malformed envelope.
 * Callers should catch this and return HeldResult rather than treating as empty.
 */
export class PayarcFetchError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Payarc fetch failed: ${httpStatus} on ${path} — ${body.slice(0, 120)}`);
    this.name = "PayarcFetchError";
  }
}

/** Safety ceiling for paginated requests — prevents runaway loops on bad metadata. */
const PAYARC_FETCH_MAX_PAGES = 500;
const PAYARC_FETCH_MAX_RECORDS = 100_000;

export async function payarcFetchAll<T = unknown>(
  apiKey: string,
  baseUrl: string,
  basePath: string,
  pageSize = 100,
  extraHeaders?: Record<string, string>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    // Absolute ceiling — prevents runaway loops from buggy/malicious metadata.
    if (page > PAYARC_FETCH_MAX_PAGES) {
      throw new PayarcFetchError(200, basePath, `Pagination exceeded ${PAYARC_FETCH_MAX_PAGES} pages — possible loop or malformed last_page metadata`);
    }

    const sep = basePath.includes("?") ? "&" : "?";
    const path = `${basePath}${sep}limit=${pageSize}&page=${page}`;

    const { ok, status, data, text } = await payarcRequest<any>(
      apiKey,
      baseUrl,
      "GET",
      path,
      undefined,
      0,
      extraHeaders,
    );

    // Non-2xx on any page = throw; never silently return partial data as success.
    if (!ok) {
      throw new PayarcFetchError(status, path, text ?? "");
    }

    // Resolve envelope to item array.
    // Supported shapes:
    //   { data: T[], meta: { current_page, last_page } }           — flat
    //   { data: T[], meta: { pagination: { current_page, total_pages } } } — nested meta
    //   { data: { data: T[], current_page, last_page } }           — nested data
    // Any other shape is contract drift → throw.
    let rows: T[];
    if (Array.isArray(data?.data)) {
      rows = data.data as T[];
    } else if (data?.data && Array.isArray(data.data?.data)) {
      rows = data.data.data as T[];
    } else if (Array.isArray(data)) {
      rows = data as T[];
    } else {
      throw new PayarcFetchError(200, path, `Unexpected response shape: ${text?.slice(0, 200)}`);
    }

    items.push(...rows);

    // Record ceiling — prevents OOM from unreasonably large datasets.
    if (items.length > PAYARC_FETCH_MAX_RECORDS) {
      throw new PayarcFetchError(200, path, `Response exceeded ${PAYARC_FETCH_MAX_RECORDS} total records — possible metadata error or credential scope mismatch`);
    }

    // Pagination termination: resolve authoritative metadata first.
    const meta = data?.meta;
    const lastPage: number | undefined =
      meta?.last_page ??
      meta?.pagination?.total_pages ??
      data?.data?.last_page;
    const reportedCurrentPage: number | undefined =
      meta?.current_page ??
      meta?.pagination?.current_page ??
      data?.data?.current_page;

    // Progress guard: when the provider reports a current_page, it must match
    // the page we requested. A mismatch means the provider is ignoring our page
    // parameter or has inconsistent state — continuing would loop indefinitely.
    if (reportedCurrentPage !== undefined && reportedCurrentPage !== page) {
      throw new PayarcFetchError(
        200,
        path,
        `Pagination progress mismatch: requested page=${page} but provider reported current_page=${reportedCurrentPage}. Aborting to prevent infinite loop.`,
      );
    }

    // Termination rule:
    // When authoritative metadata is present, respect it — continue until
    // reportedCurrentPage >= lastPage, even on a short (< pageSize) page.
    // When no authoritative metadata is available, fall back to short-page heuristic.
    if (lastPage !== undefined) {
      if (page >= lastPage) break;
    } else if (rows.length < pageSize) {
      break;
    }

    page++;
  }

  return items;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

// ── REV-06A Merchant API constants ────────────────────────────────────────────
//
// Payarc has two separate API credential classes:
//   PARTNER KEY (PAYARC_API_KEY)         — boarding, applicant status
//   MERCHANT KEY (PAYARC_MERCHANT_API_KEY) — charges, statements, disputes
//
// Both use Bearer token auth. In sandbox, both keys work on testapi.payarc.net.
// Probe-verified (Sept 9 2026):
//   GET /charges                                    → 200 (MERCHANT_KEY, testapi)
//   GET /merchant_statements?from_date=&to_date=   → 200 (MERCHANT_KEY, testapi)
//   GET /cases?report_date[gte]=&report_date[lte]= → 200 (MERCHANT_KEY, testapi)
//
// HELD (no verified 2xx):
//   GET /residuals (405 — POST only)
//   GET /deposits (404)
//   POST /cases/{id}/upload (not yet probed)
//   All partner key data endpoints on api.payarc.net (401 — permissions not granted)

const MERCHANT_SANDBOX_BASE = "https://testapi.payarc.net/v1";

export class PayarcProcessorAdapter implements IProcessorAdapter {
  readonly name = "payarc";
  readonly displayName = "Payarc";

  private get apiKey(): string | undefined {
    return process.env.PAYARC_API_KEY || undefined;
  }

  /** Merchant-scoped API key — authorized for charges, statements, and dispute listing. */
  private get merchantApiKey(): string | undefined {
    return process.env.PAYARC_MERCHANT_API_KEY || undefined;
  }

  private get baseUrl(): string {
    return (process.env.PAYARC_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  }

  /**
   * Base URL for merchant-scoped operations (charges, statements, disputes).
   * Probe confirmed: PAYARC_MERCHANT_API_KEY (sandbox) works on testapi.payarc.net.
   * Production merchant key and base URL not yet issued/verified — held until
   * a production merchant key probe succeeds and a new production_authorized
   * snapshot is issued.
   */
  private get merchantApiBase(): string {
    const configuredBase = this.baseUrl;
    // If the partner base is sandbox, use the same host for merchant API too
    if (configuredBase.includes("testapi")) return configuredBase;
    // Partner base is production (api.payarc.net), but merchant key is sandbox-only.
    // Use the verified sandbox base until a production merchant key is issued.
    return MERCHANT_SANDBOX_BASE;
  }

  private isConfigured(): boolean {
    return !!this.apiKey;
  }

  private isMerchantConfigured(): boolean {
    return !!this.merchantApiKey;
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
        // Traditional: POST /v1/applications  (canonical path for sandbox and production)
        // Payfac:      POST /v1/agent-hub/apply/add-lead/  (NOT activated — owner must
        //              set processorProgram='payfac' in activation snapshot)
        // The program is sourced from the activation snapshot, passed via profile.
        const program = (profile as any).processorProgram ?? "traditional";
        const submitPath = program === "payfac"
          ? "/agent-hub/apply/add-lead/"
          : "/applications";

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
          `/applications/${processorApplicationId}`,
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
  // ─── REV-06A HeldResult domain (getDailyStats, getResiduals, getTransactions,
  //     submitDisputeEvidence) ───────────────────────────────────────────────────
  //
  // ── TWO-API ARCHITECTURE (discovered Sept 2026 from docs.payarc.net) ──────────
  //
  // Payarc exposes TWO separate API bases with separate credentials:
  //
  //   PARTNER/AGENT API  → https://testapi.payarc.net/v1  (sandbox)
  //                        Credential: PAYARC_API_KEY (static Bearer from Partner Hub)
  //                        Endpoints: applicants, merchants, agent batch, residuals,
  //                                   disputes (agent-scoped)
  //
  //   MERCHANT API       → https://testap1.payarc.net/v1  (sandbox)
  //                        Credential: PAYARC_MERCHANT_API_KEY (from merchant dashboard)
  //                        Endpoints: charges, deposits, residuals (merchant-scoped),
  //                                   disputes, statements, accounts
  //                        Confirmed from docs:
  //                          GET /v1/accounts  (List All Accounts)
  //                          GET /v1/merchant_statements?from_date=&to_date=
  //
  // ── CREDENTIAL AUTHORITY MATRIX — FINAL PROBE RESULTS (Sept 9 2026) ───────────
  //
  //  PARTNER KEY (PAYARC_API_KEY) — production key
  //    api.payarc.net/v1    /accounts/me             ✓ 200 (identity confirmed)
  //    api.payarc.net/v1    /agent/batch/reports      ✗ 401 (permissions not granted)
  //    api.payarc.net/v1    /agent_residual/summary   ✗ 401
  //    api.payarc.net/v1    /dispute-chart            ✗ 401
  //    api.payarc.net/v1    /charges                  ✗ 401 (merchant key required)
  //    api.payarc.net/v1    /merchant_statements       ✗ 401
  //    testapi.payarc.net/v1 all endpoints            ✗ 401 (production key vs sandbox)
  //
  //  MERCHANT KEY (PAYARC_MERCHANT_API_KEY) — sandbox token
  //    testapi.payarc.net/v1 /accounts/me            ✓ 200 ✓ VERIFIED
  //    testapi.payarc.net/v1 /charges                ✓ 200 ✓ VERIFIED (pagination: limit/page)
  //    testapi.payarc.net/v1 /merchant_statements    ✓ 200 ✓ VERIFIED (from_date/to_date)
  //    testapi.payarc.net/v1 /cases (date range)     ✓ 200 ✓ VERIFIED (report_date[gte/lte])
  //    testapi.payarc.net/v1 /deposits               ✗ 404 (route not found)
  //    testapi.payarc.net/v1 /residuals              ✗ 405 (POST only)
  //    testapi.payarc.net/v1 /disputes               ✗ 404 (route not found)
  //    api.payarc.net/v1    all endpoints            ✗ 401 (sandbox key vs production)
  //
  // ── IMPLEMENTED OPERATIONS ─────────────────────────────────────────────────
  //   get_charges   → GET /charges           (MERCHANT_KEY, testapi.payarc.net)
  //   get_daily_stats → GET /merchant_statements (MERCHANT_KEY, testapi.payarc.net)
  //   get_disputes  → GET /cases (date range) (MERCHANT_KEY, testapi.payarc.net)
  //
  // ── HELD OPERATIONS (no verified 2xx) ─────────────────────────────────────
  //   getResiduals          → /residuals 405 (POST only), agent residual 401
  //   submitDisputeEvidence → POST /cases/{id}/upload not yet probed
  //   agent batch reports   → partner key 401, permissions not granted by Payarc
  //
  // ── IMPLEMENTATION PLAN (once credentials verified) ──────────────────────────
  //   - getDailyStats        → MERCHANT_API GET /v1/merchant_statements or
  //                            PARTNER_API  GET /v1/agent/batch/reports  (amounts in cents)
  //   - getResiduals         → PARTNER_API  GET /v1/agent_residual/summary
  //                            (requires bank param — get from Payarc support)
  //   - getTransactions      → MERCHANT_API GET /v1/charges
  //   - submitDisputeEvidence→ PARTNER_API  POST /v1/cases/{hashedId}/upload
  //                            (disputes listed via GET /v1/dispute-chart)
  //
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Fetch charges (transactions) for a merchant via GET /v1/charges.
   *
   * REV-06A: Verified sandbox 2xx (Sept 9 2026).
   * Credential: PAYARC_MERCHANT_API_KEY on testapi.payarc.net/v1.
   * Response shape: { data: Charge[], meta: { pagination: { total_pages, current_page } } }
   *
   * Field mapping is conservative — sandbox data[] was empty so schema is partially
   * inferred from Payarc API conventions. Unmapped fields are preserved in raw form.
   * Amounts are assumed to be in cents (divide by 100). Missing fields stay absent.
   *
   * @param mid — Canonical MID generation identifier (used to scope the request).
   * @param startDate — YYYY-MM-DD
   * @param endDate   — YYYY-MM-DD
   */
  async getTransactions(
    mid: string,
    startDate: string,
    endDate: string,
    options?: { snapshotAuthorizedBaseUrl?: string | null },
  ): Promise<Transaction[] | HeldResult> {
    if (!this.isMerchantConfigured()) {
      return { status: "held", reason: "PAYARC_MERCHANT_API_KEY not configured" };
    }

    // Snapshot-authorized URL is mandatory — no fallback to a derived host.
    // Transport host may only be selected by the activation-snapshot gate;
    // any direct caller that omits it is missing a required authorization step.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        status: "held",
        reason: "getTransactions blocked: snapshotAuthorizedBaseUrl required. Call requireConfirmedActivationSnapshot('payarc','get_charges') before this method.",
      };
    }
    const baseUrl = options.snapshotAuthorizedBaseUrl.replace(/\/$/, "");

    const midMasked = maskMid(mid);

    try {
      const basePath = `/charges?from_date=${encodeURIComponent(startDate)}&to_date=${encodeURIComponent(endDate)}`;
      const raw = await payarcFetchAll<Record<string, unknown>>(
        this.merchantApiKey!,
        baseUrl,
        basePath,
        100,
      );

      if (raw.length === 0) {
        console.info(`[PayarcAdapter] getTransactions: 0 charges (${startDate}–${endDate}, mid=${midMasked})`);
        return [];
      }

      // MID correlation: every record in the response must be attributable to the
      // expected merchant. A record with no merchant identifier cannot be verified —
      // fail held rather than accept and relabel unverifiable data.
      for (let i = 0; i < raw.length; i++) {
        const rec = raw[i];
        const recAccountId = String(
          rec.merchant_account_number ?? rec.mid ?? rec.merchant_id ?? ""
        );
        if (!recAccountId) {
          // No identifier — cannot verify binding; fail closed.
          console.error(`[PayarcAdapter] getTransactions: record[${i}] missing merchant identifier — cannot verify MID binding (mid=${midMasked})`);
          return {
            status: "held",
            reason: `Record[${i}] has no merchant identifier — MID binding unverifiable. Cannot persist against merchant mid=${midMasked}.`,
          };
        }
        if (recAccountId !== mid) {
          console.error(`[PayarcAdapter] getTransactions: record[${i}] MID mismatch (expected=${midMasked}, got=${maskMid(recAccountId)})`);
          return {
            status: "held",
            reason: `MID correlation mismatch on record[${i}]: expected ${midMasked} but got ${maskMid(recAccountId)}. Credential may be scoped to a different merchant. Cannot persist misattributed data.`,
          };
        }
      }

      // Validate all records before mapping — any malformed required field
      // returns HeldResult for the whole call rather than persisting fabricated values.
      const KNOWN_STATUSES = new Set(["approved", "captured", "declined", "failed", "reversed", "voided", "refunded"]);
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        // amount must be a number — no zero-fill for missing/non-numeric amounts
        if (typeof c.amount !== "number") {
          console.error(`[PayarcAdapter] getTransactions: record[${i}] amount is not numeric (mid=${midMasked})`);
          return { status: "held", reason: `Record[${i}] amount is not numeric (got ${typeof c.amount}) — cannot persist fabricated zero value. Provider schema may have drifted.` };
        }
        // date must be present — no substitution with startDate
        const dateRaw = c.created_at ?? c.transaction_date;
        if (!dateRaw) {
          console.error(`[PayarcAdapter] getTransactions: record[${i}] missing date field (mid=${midMasked})`);
          return { status: "held", reason: `Record[${i}] has no date field — cannot persist with fabricated date. Provider schema may have drifted.` };
        }
        // status must map to a known value — no default "pending" for unknown statuses
        const statusRaw = String(c.status ?? c.charge_status ?? "").toLowerCase();
        if (!statusRaw || !KNOWN_STATUSES.has(statusRaw)) {
          console.error(`[PayarcAdapter] getTransactions: record[${i}] unrecognized status="${statusRaw}" (mid=${midMasked})`);
          return { status: "held", reason: `Record[${i}] has unrecognized status "${statusRaw}" — cannot map to known transaction state. Provider schema may have drifted.` };
        }
      }

      return raw.map((c): Transaction => {
        const amountCents = c.amount as number; // validated above
        const statusRaw = String(c.status ?? c.charge_status ?? "").toLowerCase();
        const mappedStatus: Transaction["status"] =
          statusRaw === "approved" || statusRaw === "captured" ? "approved"
          : statusRaw === "declined" || statusRaw === "failed" ? "declined"
          : "reversed"; // refunded | reversed | voided — all validated above

        return {
          id: String(c.id ?? c.charge_id ?? ""),
          mid,
          date: String(c.created_at ?? c.transaction_date), // validated above — always present
          amount: amountCents / 100,
          type: "sale",
          status: mappedStatus,
          cardBrand: c.card_brand ? String(c.card_brand) : undefined,
          last4: c.last_four ? String(c.last_four) : undefined,
          authCode: c.auth_code ? String(c.auth_code) : undefined,
          orderId: c.order_id ? String(c.order_id) : undefined,
          description: c.description ? String(c.description) : undefined,
        };
      });
    } catch (err: any) {
      if (err instanceof PayarcFetchError) {
        console.error(`[PayarcAdapter] getTransactions: provider returned HTTP ${err.httpStatus} (mid=${midMasked})`);
        return { status: "held", reason: `Provider returned HTTP ${err.httpStatus} on ${err.path}` };
      }
      console.error(`[PayarcAdapter] getTransactions error (mid=${midMasked}): ${err?.message}`);
      return { status: "held", reason: `getTransactions fetch failed: ${err?.message}` };
    }
  }

  /**
   * HeldResult: GET /v1/residuals → 405 (POST only in Payarc sandbox).
   * GET residuals endpoint does not exist — POST /v1/residuals is used to
   * query residual data but the required POST body schema is not yet confirmed.
   * Partner key agent_residual endpoints also return 401.
   */
  async getResiduals(_month: string, _agentId?: string): Promise<Residual[] | HeldResult> {
    return {
      status: "held",
      reason: "GET /v1/residuals returns 405 (POST only). POST body schema not confirmed. Agent residual endpoint (agent_residual/summary) requires partner key permissions not yet granted by Payarc.",
    };
  }

  /**
   * Fetch daily statistics via GET /v1/merchant_statements.
   *
   * REV-06A: Verified sandbox 2xx (Sept 9 2026).
   * Credential: PAYARC_MERCHANT_API_KEY on testapi.payarc.net/v1.
   * Params: from_date (YYYY-MM-DD), to_date (YYYY-MM-DD).
   * Response: { data: Statement[], meta: { pagination: { total_pages, current_page } } }
   *
   * Missing days remain absent — never zero-filled (§10).
   * Amount field mapping is speculative (sandbox data[] empty). Amounts assumed in cents.
   *
   * @param mid — Canonical MID, used to tag returned records (not a filter param).
   * @param startDate — YYYY-MM-DD
   * @param endDate   — YYYY-MM-DD
   */
  async getDailyStats(
    mid: string,
    startDate: string,
    endDate: string,
    options?: { snapshotAuthorizedBaseUrl?: string | null },
  ): Promise<DailyStats[] | HeldResult> {
    if (!this.isMerchantConfigured()) {
      return { status: "held", reason: "PAYARC_MERCHANT_API_KEY not configured" };
    }

    // Snapshot-authorized URL is mandatory — no fallback to a derived host.
    if (!options?.snapshotAuthorizedBaseUrl) {
      return {
        status: "held",
        reason: "getDailyStats blocked: snapshotAuthorizedBaseUrl required. Call requireConfirmedActivationSnapshot('payarc','get_daily_stats') before this method.",
      };
    }
    const baseUrl = options.snapshotAuthorizedBaseUrl.replace(/\/$/, "");

    const midMasked = maskMid(mid);

    try {
      const basePath = `/merchant_statements?from_date=${encodeURIComponent(startDate)}&to_date=${encodeURIComponent(endDate)}`;
      const raw = await payarcFetchAll<Record<string, unknown>>(
        this.merchantApiKey!,
        baseUrl,
        basePath,
        100,
      );

      if (raw.length === 0) {
        // Missing days stay missing — never zero-fill (§10)
        console.info(`[PayarcAdapter] getDailyStats: 0 statements (${startDate}–${endDate}, mid=${midMasked})`);
        return [];
      }

      // MID correlation: every statement record must carry a verifiable merchant
      // identifier that matches the expected MID. A record without an identifier
      // cannot be safely attributed — fail closed rather than relabel it.
      for (let i = 0; i < raw.length; i++) {
        const rec = raw[i];
        const recAccountId = String(
          rec.merchant_account_number ?? rec.mid ?? rec.merchant_id ?? ""
        );
        if (!recAccountId) {
          console.error(`[PayarcAdapter] getDailyStats: record[${i}] missing merchant identifier (mid=${midMasked})`);
          return {
            status: "held",
            reason: `Record[${i}] has no merchant identifier — MID binding unverifiable. Cannot persist against merchant mid=${midMasked}.`,
          };
        }
        if (recAccountId !== mid) {
          console.error(`[PayarcAdapter] getDailyStats: record[${i}] MID mismatch (expected=${midMasked}, got=${maskMid(recAccountId)})`);
          return {
            status: "held",
            reason: `MID correlation mismatch on record[${i}]: expected ${midMasked} but got ${maskMid(recAccountId)}. Credential may be scoped to a different merchant. Cannot persist misattributed data.`,
          };
        }
      }

      // Validate all records before mapping — any malformed required field
      // returns HeldResult for the whole call rather than persisting fabricated values.
      for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        // date must be present and non-empty — no empty-string date permitted
        const dateRaw = s.date ?? s.batch_date ?? s.from_date ?? s.settlement_date;
        if (!dateRaw || String(dateRaw).trim() === "") {
          console.error(`[PayarcAdapter] getDailyStats: record[${i}] missing date field (mid=${midMasked})`);
          return { status: "held", reason: `Record[${i}] has no date field — cannot persist statement without a date. Provider schema may have drifted.` };
        }
        // At least one primary financial field must be a number.
        // All-absent financials are a contract drift signal, not legitimate zero-activity.
        const hasGross = typeof s.gross_amount === "number"
          || typeof s.net_amount === "number"
          || typeof s.settled_amount === "number";
        if (!hasGross) {
          console.error(`[PayarcAdapter] getDailyStats: record[${i}] no recognizable primary amount field (mid=${midMasked})`);
          return { status: "held", reason: `Record[${i}] has no recognizable gross/net/settled amount field — cannot persist fabricated zero-dollar statement. Provider schema may have drifted.` };
        }
      }

      return raw.map((s): DailyStats => {
        // Field mapping — amounts in cents → dollars.
        // All records are pre-validated above; required fields are present.
        const grossCents = typeof s.gross_amount === "number" ? s.gross_amount
          : typeof s.net_amount === "number" ? s.net_amount
          : (s.settled_amount as number); // at least one guaranteed by validation
        const feeCents = typeof s.fee_amount === "number" ? s.fee_amount
          : typeof s.fees === "number" ? s.fees : undefined;
        const txCount = typeof s.transaction_count === "number" ? s.transaction_count
          : typeof s.count === "number" ? s.count : undefined;
        const refundCents = typeof s.refund_amount === "number" ? s.refund_amount : undefined;
        const refundCount = typeof s.refund_count === "number" ? s.refund_count : undefined;
        const cbCents = typeof s.chargeback_amount === "number" ? s.chargeback_amount : undefined;
        const cbCount = typeof s.chargeback_count === "number" ? s.chargeback_count : undefined;

        const gross = grossCents / 100;
        const fee = feeCents !== undefined ? feeCents / 100 : undefined;
        const effectiveRate = (fee !== undefined && gross > 0) ? fee / gross : undefined;
        const avgTicket = (txCount !== undefined && txCount > 0) ? gross / txCount : undefined;

        return {
          mid,
          date: String(s.date ?? s.batch_date ?? s.from_date ?? s.settlement_date), // validated above
          volume: gross,
          txCount,
          avgTicket,
          effectiveRate,
          chargebackCount: cbCount,
          chargebackAmount: cbCents !== undefined ? cbCents / 100 : undefined,
          refundCount,
        };
      });
    } catch (err: any) {
      if (err instanceof PayarcFetchError) {
        console.error(`[PayarcAdapter] getDailyStats: provider returned HTTP ${err.httpStatus} (mid=${midMasked})`);
        return { status: "held", reason: `Provider returned HTTP ${err.httpStatus} on ${err.path}` };
      }
      console.error(`[PayarcAdapter] getDailyStats error (mid=${midMasked}): ${err?.message}`);
      return { status: "held", reason: `getDailyStats fetch failed: ${err?.message}` };
    }
  }

  /**
   * Submit dispute response evidence to the processor for an EXISTING provider case.
   * REV-06A §9: Liberty never creates a chargeback — this uploads evidence to an
   * existing Payarc case via POST /v1/cases/{id}/upload.
   *
   * HeldResult: POST /v1/cases/{id}/upload not yet probed.
   * GET /v1/cases → 200 confirmed (dispute listing works).
   * Upload endpoint requires multipart/form-data with evidence files — not confirmed.
   * Will implement once evidence upload is verified via sandbox probe.
   */
  async submitDisputeEvidence(_submission: DisputeEvidenceSubmission): Promise<ChargebackResult | HeldResult> {
    return {
      status: "held",
      reason: "POST /v1/cases/{id}/upload not yet probed. GET /v1/cases confirmed 200 (dispute listing works). Evidence upload requires multipart/form-data — field schema not confirmed. Will implement after sandbox upload probe succeeds.",
    };
  }

  /**
   * @deprecated — Use submitDisputeEvidence(). Compatibility wrapper.
   * Delegates to submitDisputeEvidence() so existing callers continue to work
   * without modification during the REV-06A transition.
   */
  async submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult | HeldResult> {
    return this.submitDisputeEvidence({
      mid: submission.mid,
      caseId: submission.caseNumber ?? "",
      transactionId: submission.transactionId,
      amount: submission.amount,
      reason: submission.reason,
      cardBrand: submission.cardBrand,
      responseDeadline: submission.responseDeadline,
      evidenceNotes: submission.evidenceNotes,
      providerIdempotencyKey: submission.providerIdempotencyKey,
    });
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
          `/applications/${processorApplicationId}`,
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
