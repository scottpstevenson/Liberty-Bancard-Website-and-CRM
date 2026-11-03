/**
 * Operator-safe summaries of Payarc read results (Task #1777). Pure.
 * Counts, scope labels, and hold codes only — no identifiers, amounts, case ids, or sample rows.
 */
import type { HeldResult } from "./IProcessorAdapter";
import type {
  BatchReportResult,
  DisputeCaseListResult,
  DisputeChartResult,
  PayarcReadEvidence,
  ResidualReportResult,
} from "./payarc-report-types";
import { maskMid } from "../../utils/mask-mid";

export type PayarcReadResult = BatchReportResult | ResidualReportResult | DisputeCaseListResult | DisputeChartResult;

export interface ReadSummary {
  status: "ok" | "held";
  code?: string;
  reason?: string;
  kind?: string;
  scope?: string;
  window?: { fromDate: string; toDate: string };
  recordCount?: number;
  distinctMerchants?: number;
  boundMidMasked?: string | null;
  footerReconciliation?: string;
  notes: string[];
  evidence?: PayarcReadEvidence;
}

export function summarizeRead(result: PayarcReadResult | HeldResult): ReadSummary {
  if ("status" in result && result.status === "held") {
    return { status: "held", code: result.code, reason: result.reason, notes: [] };
  }
  const r = result as PayarcReadResult;
  switch (r.kind) {
    case "agent_batch_report":
      return {
        status: "ok",
        kind: r.kind,
        scope: "partner_credential_portfolio",
        window: r.window,
        recordCount: r.records.length,
        distinctMerchants: r.merchantTotals.length,
        boundMidMasked: maskMid(r.boundMerchantAccountNumber),
        notes: [
          `filterPlacement=${r.filterPlacement}`,
          `duplicatesIgnored=${r.duplicatesIgnored}`,
          `otherMerchantRowsExcluded=${r.otherMerchantRowsExcluded}`,
          "monetary units are not stated by the provider; values are not converted",
          "read-only: nothing was ingested, posted, or reconciled",
        ],
        evidence: r.evidence,
      };
    case "residual_summary":
      return {
        status: "ok",
        kind: r.kind,
        scope: `partner_credential_${r.source}`,
        window: r.window,
        recordCount: r.rows.length,
        distinctMerchants: new Set(r.rows.map((x) => x.mid)).size,
        boundMidMasked: maskMid(r.boundMid),
        footerReconciliation: r.footerReconciliation,
        notes: ["merchant-level aggregates; do not add to fee line items", "read-only: nothing was ingested or paid"],
        evidence: r.evidence,
      };
    case "residual_fee_line_items":
      return {
        status: "ok",
        kind: r.kind,
        scope: "partner_credential_residual_details",
        window: r.window,
        recordCount: r.rows.length,
        distinctMerchants: new Set(r.rows.map((x) => x.merchantId)).size,
        boundMidMasked: maskMid(r.boundMid),
        notes: [
          `rowsWithDifferentAgent=${r.rowsWithDifferentAgent}`,
          "fee line items; do not add to merchant aggregates",
          "read-only: nothing was ingested or paid",
        ],
        evidence: r.evidence,
      };
    case "dispute_case_list":
      return {
        status: "ok",
        kind: r.kind,
        scope: "merchant_credential_account (not portfolio-wide)",
        window: r.window,
        recordCount: r.records.length,
        boundMidMasked: maskMid(r.boundMid),
        notes: ["individual cases; chart totals are a separate aggregate capability", "no evidence was uploaded"],
        evidence: r.evidence,
      };
    case "dispute_chart_aggregate":
      return {
        status: "ok",
        kind: r.kind,
        scope: "merchant_credential_account (aggregate only)",
        window: r.window,
        recordCount: r.countSeries.length,
        notes: ["aggregate chart metrics only; not individual cases"],
        evidence: r.evidence,
      };
  }
}
