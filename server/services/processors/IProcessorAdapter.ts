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
  preferredProgram?: string;
  offerPath?: string;
  /** Stable per-submission idempotency key derived at enqueue time. Adapters
   *  SHOULD forward this to provider APIs that support request deduplication.
   *  Never log or include in audit records — treated as opaque bytes. */
  providerIdempotencyKey?: string;
}

export interface BoardingResult {
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

export interface AdapterHealthStatus {
  name: string;
  enabled: boolean;
  configured: boolean;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  errorRate: number;
}

export interface IProcessorAdapter {
  readonly name: string;
  readonly displayName: string;

  boardMerchant(profile: MerchantProfile): Promise<BoardingResult>;
  getMerchantStatus(processorApplicationId: string): Promise<BoardingStatusResult>;
  getTransactions(mid: string, startDate: string, endDate: string): Promise<Transaction[]>;
  getResiduals(month: string, agentId?: string): Promise<Residual[]>;
  getDailyStats(mid: string, startDate: string, endDate: string): Promise<DailyStats[]>;
  submitChargeback(submission: ChargebackSubmission): Promise<ChargebackResult>;
  updateMerchant(processorApplicationId: string, updates: Partial<MerchantProfile>): Promise<MerchantUpdateResult>;
  ping(): Promise<boolean>;
}
