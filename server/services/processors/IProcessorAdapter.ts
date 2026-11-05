// ─── Processor Health State Enum ─────────────────────────────────────────────

/**
 * Typed health/readiness state for a processor adapter.
 *
 * disabled               — adapter not enabled in this environment.
 * missing_contract       — no activation snapshot with status ≥ owner_confirmed.
 * missing_credentials    — activation snapshot present but API key absent.
 * configured_unverified  — credentials present but no successful authenticated call yet.
 * sandbox_verified       — explicit authenticated 2xx from provider identity endpoint (sandbox).
 * production_authorized  — activation snapshot at production_authorized + sandbox_verified.
 * expired_or_drifted     — previously verified but snapshot has expired or drifted.
 * held                   — operator hold; transport suspended pending resolution.
 */
export type ProcessorHealthState =
  | "disabled"
  | "missing_contract"
  | "missing_credentials"
  | "configured_unverified"
  | "sandbox_verified"
  | "production_authorized"
  | "expired_or_drifted"
  | "held";

// ─── Held Result ─────────────────────────────────────────────────────────────

/**
 * Returned by #1737-domain functions (daily stats, residuals, chargebacks,
 * health alerts) until Task #1737 (REV-06A) certifies these paths.
 * Callers MUST check `status === "held"` and never treat the result as data.
 */
export interface HeldResult {
  status: "held";
  reason: string;
  /**
   * Machine-readable hold code (optional; legacy holds carry only `reason`). Examples:
   * entitlement_required, bank_required, filter_placement_unverified, filters_ignored,
   * environment_mismatch, snapshot_url_required, malformed_response, mid_binding_mismatch.
   */
  code?: string;
}

import type {
  BatchReportRequest,
  BatchReportResult,
  DisputeCaseListRequest,
  DisputeCaseListResult,
  DisputeChartRequest,
  DisputeChartResult,
  PayarcReadOptions,
  ResidualReportRequest,
  ResidualReportResult,
} from "./payarc-report-types";

// ─── Merchant Profile ────────────────────────────────────────────────────────

export interface MerchantProfile {
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
  /**
   * Program confirmed in the activation snapshot.
   * 'traditional' | 'payfac' — determines which provider endpoints are used.
   * MUST be confirmed by owner via activation snapshot before transport activates.
   */
  processorProgram?: "traditional" | "payfac";
  preferredProgram?: string;
  offerPath?: string;
  /** Stable per-submission idempotency key derived at enqueue time. Adapters
   *  SHOULD forward this to provider APIs that support request deduplication.
   *  Never log or include in audit records — treated as opaque bytes. */
  providerIdempotencyKey?: string;
}

// ─── Boarding Result ─────────────────────────────────────────────────────────

export interface BoardingResult {
  success: boolean;
  processorApplicationId?: string;
  status?: string;
  message?: string;
  error?: string;
  estimatedDecisionDate?: string;
  /**
   * Set to 'ambiguous' when the provider call timed out or returned no
   * application ID. Callers must NOT retry immediately — classify as
   * ambiguous_reconciliation_required and hold for reconciliation.
   */
  ambiguous?: boolean;
  /** HTTP status of a definite provider rejection, when there was one. */
  httpStatus?: number;
  /** True when repeating the same request cannot succeed (bad request, credential, refused destination). */
  permanent?: boolean;
  /** True when the provider declined to process now and a later retry is reasonable (rate limit). */
  retryable?: boolean;
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
  /** True when the provider response itself named the requested application; false when attribution rests on the request path alone. */
  identityEchoed?: boolean;
  error?: string;
}

// ─── #1737 Domain Types ───────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  mid: string;
  date: string;
  amount: number;
  type: "sale" | "refund" | "chargeback" | "adjustment";
  status: "approved" | "declined" | "pending" | "reversed";
  cardBrand?: string;
  last4?: string;
  authCode?: string;
  orderId?: string;
  description?: string;
}

export interface DailyStats {
  mid: string;
  date: string;
  /** Gross/settled volume in dollars. Always present (primary required field). */
  volume: number;
  /** Transaction count — absent when provider does not include it for this record. */
  txCount?: number;
  /** Average ticket — derived only when txCount is present. */
  avgTicket?: number;
  /** Effective rate — derived only when fee is present. */
  effectiveRate?: number;
  /** Chargeback count — absent when provider does not include it for this record. */
  chargebackCount?: number;
  /** Chargeback amount in dollars — absent when provider does not include it. */
  chargebackAmount?: number;
  /** Refund count — absent when provider does not include it for this record. */
  refundCount?: number;
}

export interface Residual {
  mid: string;
  month: string;
  grossRevenue: number;
  processorFees: number;
  agentResidual: number;
  merchantName?: string;
  txCount?: number;
  volume?: number;
}

/**
 * REV-06A §9 corrected: Liberty never creates a chargeback. Disputes originate
 * externally. This type represents the evidence submission payload sent to an
 * EXISTING provider-verified dispute case via POST /v1/cases/{id}/upload.
 */
export interface DisputeEvidenceSubmission {
  /** Canonical MID generation identifier */
  mid: string;
  /** Payarc dispute/case ID (not fabricated — must be from provider) */
  caseId: string;
  /** Original transaction ID matched to the dispute */
  transactionId: string;
  amount: number;
  reason: string;
  cardBrand: string;
  /** ISO date: deadline for evidence response (from provider) */
  responseDeadline?: string;
  /** Narrative description of the evidence */
  evidenceNotes?: string;
  /** Stable command UUID, forwarded to processors that support idempotent requests. */
  providerIdempotencyKey?: string;
}

/**
 * @deprecated — Use DisputeEvidenceSubmission. Kept for backward compatibility.
 * Liberty never creates a chargeback; this interface proxied to evidence submission.
 */
export interface ChargebackSubmission {
  mid: string;
  transactionId: string;
  amount: number;
  reason: string;
  cardBrand: string;
  caseNumber?: string;
  responseDeadline?: string;
  evidenceNotes?: string;
  /** Stable command UUID, forwarded to processors that support idempotent requests. */
  providerIdempotencyKey?: string;
}

export interface ChargebackResult {
  success: boolean;
  caseId?: string;
  status?: string;
  message?: string;
  error?: string;
}

export interface MerchantUpdateResult {
  success: boolean;
  message?: string;
  error?: string;
}

// ─── Adapter Health Status ────────────────────────────────────────────────────

export interface AdapterHealthStatus {
  name: string;
  enabled: boolean;
  configured: boolean;
  healthState: ProcessorHealthState;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  errorRate: number;
}

// ─── Adapter Interface ────────────────────────────────────────────────────────

export interface IProcessorAdapter {
  readonly name: string;
  readonly displayName: string;

  /** Submit a new merchant application to the processor. */
  boardMerchant(profile: MerchantProfile): Promise<BoardingResult>;

  /** Poll the processor for the status of a previously submitted application. */
  getMerchantStatus(processorApplicationId: string, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<BoardingStatusResult>;

  /**
   * Fetch transactions for a MID over a date range.
   * #1737 DOMAIN — returns HeldResult until REV-06A certifies this path.
   */
  getTransactions(mid: string, startDate: string, endDate: string, options?: { snapshotAuthorizedBaseUrl?: string | null }): Promise<Transaction[] | HeldResult>;

  /**
   * Legacy numeric residual shape (cannot carry decimal text, nullable calculated values, or
   * the summary/line-item distinction). Adapters keep this as a correctly-worded hold; use
   * getResidualReport() for documented partner residual reads.
   */
  getResiduals(month: string, agentId?: string): Promise<Residual[] | HeldResult>;

  /**
   * Partner-key agent batch report (GET /v1/agent/batch/reports). Bounded dates; the caller must
   * choose the filter placement because the provider docs contradict themselves.
   * Authorized per operation: snapshot operation `get_batch_reports`.
   */
  getBatchReports(request: BatchReportRequest, options?: PayarcReadOptions): Promise<BatchReportResult | HeldResult>;

  /**
   * Partner-key residual read from ONE documented source (summary, table summary, or fee line
   * items). Sources overlap and are never combined. Snapshot operation per source:
   * get_residual_summary | get_residual_table_summaries | get_residual_details.
   */
  getResidualReport(request: ResidualReportRequest, options?: PayarcReadOptions): Promise<ResidualReportResult | HeldResult>;

  /**
   * Merchant-key dispute CASE listing (GET /v1/cases). One merchant account — not portfolio-wide.
   * Snapshot operation `get_disputes`.
   */
  listDisputeCases(request: DisputeCaseListRequest, options?: PayarcReadOptions): Promise<DisputeCaseListResult | HeldResult>;

  /**
   * Merchant-key AGGREGATE dispute chart (GET /v1/dispute-chart). Chart metrics only — not a case
   * source. Snapshot operation `get_dispute_chart`.
   */
  getDisputeChart(request: DisputeChartRequest, options?: PayarcReadOptions): Promise<DisputeChartResult | HeldResult>;

  /**
   * Fetch daily stats for a MID over a date range.
   * #1737 DOMAIN — returns HeldResult until REV-06A certifies this path.
   */
  getDailyStats(mid: string, startDate: string, endDate: string, options?: { snapshotAuthorizedBaseUrl?: string | null }): Promise<DailyStats[] | HeldResult>;

  /**
   * Submit dispute response evidence to the processor for an EXISTING provider case.
   * REV-06A §9 corrected: Liberty never creates a chargeback. Disputes originate
   * externally. This method uploads evidence to an existing Payarc case via the
   * provider's verified dispute API.
   * #1737 DOMAIN — returns HeldResult until POST /v1/cases/{id}/upload is
   * confirmed authorized via sandbox probe (currently 401 — credential entitlement
   * not yet granted by Payarc for this operation).
   */
  submitDisputeEvidence(submission: DisputeEvidenceSubmission): Promise<ChargebackResult | HeldResult>;

  /**
   * @deprecated — Use submitDisputeEvidence(). Compatibility wrapper preserved
   * so existing callers (chargeback-submission-service.ts) don't break during
   * the REV-06A transition. Delegates to submitDisputeEvidence().
   * Liberty never creates a chargeback — the name was a misnomer.
   */
  submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult | HeldResult>;

  /**
   * Update merchant profile fields at the processor.
   * REV-05A: options.snapshotAuthorizedBaseUrl MUST be provided — transport fails closed otherwise.
   * The URL is taken from the activation snapshot so the request targets only the owner-approved endpoint.
   */
  updateMerchant(processorApplicationId: string, updates: Partial<MerchantProfile>, options?: { snapshotAuthorizedBaseUrl?: string }): Promise<MerchantUpdateResult>;

  /**
   * Return the current health/readiness state of this adapter.
   * MUST NOT return sandbox_verified or production_authorized unless an
   * authenticated 2xx has been observed from a documented identity endpoint.
   * HTTP 404 is NOT a valid positive result.
   */
  /**
   * Returns the adapter's health/readiness state.
   * @param snapshotAuthorizedBaseUrl — When provided, use this URL for the identity
   *   probe instead of the env-configured default. Callers (registry getProcessorHealthState)
   *   should always pass the snapshot's authorizedBaseUrl so the ping targets only the
   *   owner-approved endpoint, not an arbitrary env var.
   */
  getHealthState(snapshotAuthorizedBaseUrl?: string | null): Promise<ProcessorHealthState>;

  /**
   * @deprecated — Use getHealthState() for a typed result.
   * Returns true only when getHealthState() returns sandbox_verified or
   * production_authorized. Never returns true on HTTP 404 or any non-2xx.
   */
  ping(): Promise<boolean>;
}
