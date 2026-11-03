/**
 * Payarc revenue-read contract types (Task #1777).
 *
 * Pure type module — no runtime imports, no database access. Shapes follow the
 * provider documentation re-checked on 2026-11-03 (see
 * docs/rev06a-certification-report.md). Money is carried as exact
 * decimal text exactly as the provider sent it; the provider does not state a
 * universal minor-unit rule for these reports, so nothing here is divided by 100.
 */

/** Which Payarc credential class a read uses. Partner and merchant keys are never interchangeable. */
export type PayarcKeyClass = "partner" | "merchant";

export type PayarcEnvironment = "sandbox" | "production";

/** Exact decimal text as sent by the provider (e.g. "9886.13", "000000000000.00", "16133022"). */
export type DecimalText = string;

/** Evidence attached to every successful read. Never contains response bodies. */
export interface PayarcReadEvidence {
  operation: string;
  keyClass: PayarcKeyClass;
  environment: PayarcEnvironment;
  /** Host only, e.g. "api.payarc.net". */
  host: string;
  /** "declared" when PAYARC_*_KEY_ENVIRONMENT matched the host; "undeclared" otherwise. */
  credentialEnvironment: "declared" | "undeclared";
  pagesFetched: number;
  recordCount: number;
}

export interface ReadWindow {
  /** YYYY-MM-DD */
  fromDate: string;
  /** YYYY-MM-DD */
  toDate: string;
}

// ─── Agent batch reports (partner key) ───────────────────────────────────────

/**
 * The batch report page documents from_date/to_date in a GET requestBody while its own
 * code sample uses query parameters. The accepted placement is unresolved, so callers
 * must choose explicitly; there is no default.
 */
export type BatchFilterPlacement = "query" | "body";

export interface BatchReportRequest extends ReadWindow {
  filterPlacement: BatchFilterPlacement;
  /** Optional exact Merchant_Account_Number. Applied client-side; other merchants are excluded and counted. */
  merchantAccountNumber?: string;
  maxPages?: number;
}

export interface BatchReportRecord {
  merchantAccountNumber: string;
  settlementDate: string;
  batchReferenceNumber: string;
  dbaName: string | null;
  accountType: string | null;
  rejectRecord: string | null;
  /** Provider field "Amounts": total sales amount processed. NOT net. */
  salesAmount: DecimalText;
  totalRefunds: DecimalText | null;
  /** Provider field "total_net_amt". NOT gross. */
  totalNetAmount: DecimalText | null;
  adjustedTotalSale: DecimalText | null;
  adjustedTotalRefunds: DecimalText | null;
  adjustedNetAmount: DecimalText | null;
  rejectedTotalSale: DecimalText | null;
  rejectedTotalRefunds: DecimalText | null;
  rejectedNetAmount: DecimalText | null;
  transactionCount: number;
}

export interface BatchMerchantTotals {
  merchantAccountNumber: string;
  batchCount: number;
  transactionCount: number;
  salesAmount: DecimalText;
  totalRefunds: DecimalText;
  totalNetAmount: DecimalText;
}

export interface BatchReportResult {
  kind: "agent_batch_report";
  window: ReadWindow;
  filterPlacement: BatchFilterPlacement;
  records: BatchReportRecord[];
  /** Per-merchant sums over distinct batches (a repeated identical batch row is counted once). */
  merchantTotals: BatchMerchantTotals[];
  duplicatesIgnored: number;
  otherMerchantRowsExcluded: number;
  boundMerchantAccountNumber: string | null;
  /** The provider documents no currency/minor-unit rule for this report. */
  monetaryUnits: "provider_unspecified";
  evidence: PayarcReadEvidence;
}

// ─── Residuals (partner key) ─────────────────────────────────────────────────

/**
 * Three distinct documented routes. They overlap in what they describe and must not be
 * added together:
 *   agent_residual_summary    GET /v1/agent_residual/summary     bank REQUIRED
 *   residual_table_summaries  GET /v1/residual_table_summaries   bank optional, dates required
 *   residual_details          GET /v1/residual-details           fee line items, bank optional
 * (/v1/agent_residual/details is a different route and is intentionally not implemented.)
 */
export type ResidualSource = "agent_residual_summary" | "residual_table_summaries" | "residual_details";

export interface ResidualReportRequest extends ReadWindow {
  source: ResidualSource;
  /** Required by agent_residual_summary. Four digits. */
  bank?: string;
  /** Exact MID string (leading zeros preserved). Every returned row must match. */
  mid?: string;
  /** Not supported by agent_residual_summary. */
  agentId?: string;
  /** residual_details only. */
  limit?: number;
  maxPages?: number;
}

export interface ResidualSummaryRow {
  mid: string;
  dbaName: string | null;
  agentName: string | null;
  agentId: string | null;
  authorizations: DecimalText | null;
  captures: DecimalText | null;
  capturedSales: DecimalText | null;
  /** Provider "inc" */
  revenue: DecimalText | null;
  /** Provider "exp" */
  expense: DecimalText | null;
  /** Provider "net" — gross profit, not agent income. */
  grossProfit: DecimalText | null;
  splitPercent: DecimalText | null;
  /** Provider "ag_net" — the agent's monthly income. */
  agentIncome: DecimalText | null;
  bps: DecimalText | null;
  boardedDate: string | null;
  residualDate: string | null;
  bank: string | null;
  providerAccountRef: string | null;
}

export type ResidualFooterReconciliation = "matches" | "differs" | "footer_absent" | "not_comparable";

export interface ResidualSummaryResult {
  kind: "residual_summary";
  source: "agent_residual_summary" | "residual_table_summaries";
  /** Rows are merchant-level aggregates; they are not fee line items. */
  semantics: "merchant_aggregate";
  window: ReadWindow;
  rows: ResidualSummaryRow[];
  /** Provider-supplied totals row. Never added to `rows`. */
  footer: Record<string, DecimalText | null> | null;
  footerReconciliation: ResidualFooterReconciliation;
  boundMid: string | null;
  bank: string | null;
  monetaryUnits: "decimal_as_published";
  overlapPolicy: "single_source_only";
  evidence: PayarcReadEvidence;
}

export interface ResidualDetailRow {
  providerRowId: string | null;
  merchantId: string;
  dbaName: string | null;
  feeCategoryDescription: string | null;
  feeItemName: string | null;
  statementDescription: string | null;
  salesCount: string | null;
  salesAmount: DecimalText | null;
  creditCount: string | null;
  creditAmount: DecimalText | null;
  interchangeFee: DecimalText | null;
  incomeAmount: DecimalText | null;
  reportDate: string;
  /** Nullable: the provider leaves calculated values null when it has not calculated them. */
  calculatedExpense: DecimalText | null;
  calculatedIncome: DecimalText | null;
  calculatedProfit: DecimalText | null;
  calculatedResidual: DecimalText | null;
  splitUsed: DecimalText | null;
  agentId: string | null;
  merchantStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ResidualDetailResult {
  kind: "residual_fee_line_items";
  source: "residual_details";
  /** A line item is not automatically a monthly residual payment. */
  semantics: "fee_line_items";
  window: ReadWindow;
  rows: ResidualDetailRow[];
  providerTotalReported: number | null;
  requestedAgentId: string | null;
  /** The provider documents that the authenticated agent's scope takes precedence over agent_id. */
  rowsWithDifferentAgent: number;
  boundMid: string | null;
  bank: string | null;
  monetaryUnits: "decimal_as_published";
  overlapPolicy: "single_source_only";
  evidence: PayarcReadEvidence;
}

export type ResidualReportResult = ResidualSummaryResult | ResidualDetailResult;

// ─── Disputes (merchant key) ─────────────────────────────────────────────────

export interface DisputeCaseListRequest extends ReadWindow {
  /** Canonical MID string. When set, every case must carry the same merchant_number. */
  mid?: string;
  maxPages?: number;
}

/** Deliberately omits card number, last four, ARN, and cardholder/merchant address data. */
export interface DisputeCaseRecord {
  providerCaseId: string;
  caseNumber: string | null;
  merchantNumber: string | null;
  reportDate: string | null;
  transactionDate: string | null;
  caseAmount: DecimalText | null;
  merchantAmount: DecimalText | null;
  reasonCode: string | null;
  reasonDescription: string | null;
  caseType: string | null;
  status: string | null;
  response: string | null;
  respondedDate: string | null;
  lastUpdatedDate: string | null;
  isPrimaryCase: boolean | null;
  caseSubmitted: boolean | null;
  bankNumber: string | null;
  evidenceFileCount: number | null;
}

export interface DisputeCaseListResult {
  kind: "dispute_case_list";
  /** A merchant key sees one merchant account. This is never portfolio-wide chargeback coverage. */
  credentialScope: "merchant_credential_account";
  portfolioCoverage: false;
  window: ReadWindow;
  records: DisputeCaseRecord[];
  boundMid: string | null;
  monetaryUnits: "provider_unspecified";
  evidence: PayarcReadEvidence;
}

export interface DisputeChartRequest extends ReadWindow {}

export interface DisputeChartResult {
  kind: "dispute_chart_aggregate";
  /** Aggregate chart metrics only; there are no individual case records here. */
  aggregateOnly: true;
  credentialScope: "merchant_credential_account";
  window: ReadWindow;
  statusBreakdown: Array<{ label: string; disputeCount: DecimalText }>;
  volumeSeries: Array<{ label: string; disputeVolume: DecimalText; ratioVolume: DecimalText | null }>;
  countSeries: Array<{ label: string; disputeCount: DecimalText; ratioCount: DecimalText | null }>;
  monetaryUnits: "provider_unspecified";
  evidence: PayarcReadEvidence;
}

/** Options shared by every gated read. The URL must come from the activation snapshot gate. */
export interface PayarcReadOptions {
  snapshotAuthorizedBaseUrl?: string | null;
}
