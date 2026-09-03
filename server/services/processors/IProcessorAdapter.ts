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
}

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
  volume: number;
  txCount: number;
  avgTicket: number;
  effectiveRate: number;
  chargebackCount: number;
  chargebackAmount: number;
  refundCount: number;
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
  getTransactions(mid: string, startDate: string, endDate: string): Promise<Transaction[] | HeldResult>;

  /**
   * Fetch residuals for a given month.
   * #1737 DOMAIN — returns HeldResult until REV-06A certifies this path.
   */
  getResiduals(month: string, agentId?: string): Promise<Residual[] | HeldResult>;

  /**
   * Fetch daily stats for a MID over a date range.
   * #1737 DOMAIN — returns HeldResult until REV-06A certifies this path.
   */
  getDailyStats(mid: string, startDate: string, endDate: string): Promise<DailyStats[] | HeldResult>;

  /**
   * Submit chargeback evidence to the processor.
   * #1737 DOMAIN — returns HeldResult until REV-06A certifies this path.
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
