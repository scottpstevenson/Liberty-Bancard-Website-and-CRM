/**
 * Payarc revenue-read parsers (Task #1777). Pure: no database, network, or env access.
 *
 * Contract notes (provider documentation re-checked 2026-11-03):
 *  - Batch reports: `data[]` with case-sensitive keys (Merchant_Account_Number, Settlement_Date,
 *    Amounts, Transactions, Batch_Reference_Number, ...). Adjusted/rejected fields are nullable.
 *  - Residuals: `header_data` / `row_data` / `footer_data` (or `meta.pagination`) tabular envelopes.
 *    Summary rows are merchant aggregates; detail rows are fee line items. Never combine them.
 *  - Cases: `data[]` / `meta`. Dispute chart: pi_chart_data / dispute_volume_chart_data /
 *    dispute_count_chart_data (aggregate only).
 *
 * Numeric JSON tokens are read as exact text (JSON.parse source access) so "9886.130" and
 * integers above 2^53 keep their published precision. Identifiers (MIDs, batch references) are
 * always text and keep leading zeros.
 */
import type {
  BatchMerchantTotals,
  BatchReportRecord,
  DecimalText,
  DisputeCaseRecord,
  DisputeChartResult,
  ResidualDetailRow,
  ResidualFooterReconciliation,
  ResidualSummaryRow,
} from "./payarc-report-types";

// ─── Exact JSON ──────────────────────────────────────────────────────────────

/** A JSON number token kept as its original text. */
export class ExactNumber {
  constructor(public readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

export type ExactJson = null | boolean | string | ExactNumber | ExactJson[] | { [k: string]: ExactJson };

export class MalformedPayarcResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPayarcResponse";
  }
}

export function parseExactJson(text: string): ExactJson {
  try {
    return JSON.parse(text, ((_k: string, v: unknown, ctx?: { source?: string }) =>
      typeof v === "number" && ctx?.source !== undefined ? new ExactNumber(ctx.source) : v) as any) as ExactJson;
  } catch {
    throw new MalformedPayarcResponse("response body is not valid JSON");
  }
}

type Obj = { [k: string]: ExactJson };

export function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof ExactNumber);
}

/** Text of a scalar (string or exact number); undefined for null/bool/containers. */
export function scalarText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v instanceof ExactNumber) return v.text;
  return undefined;
}

// ─── Decimal helpers ─────────────────────────────────────────────────────────

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimalText(s: string): boolean {
  return DECIMAL_RE.test(s);
}

/** null/absent -> null; valid decimal text -> itself; anything else throws (never coerced). */
export function decimalOrNull(v: unknown, field: string): DecimalText | null {
  if (v === null || v === undefined) return null;
  const t = scalarText(v);
  if (t === undefined) throw new MalformedPayarcResponse(`${field} is not a scalar decimal`);
  const trimmed = t.trim();
  if (trimmed === "") return null;
  if (!DECIMAL_RE.test(trimmed)) throw new MalformedPayarcResponse(`${field} is not a plain decimal`);
  return trimmed;
}

function splitDecimal(t: string): { neg: boolean; int: string; frac: string } {
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  const [int, frac = ""] = body.split(".");
  return { neg, int, frac };
}

/** Exact decimal addition (BigInt-scaled). Result keeps the larger scale; no float math. */
export function addDecimals(a: DecimalText, b: DecimalText): DecimalText {
  const pa = splitDecimal(a);
  const pb = splitDecimal(b);
  const scale = Math.max(pa.frac.length, pb.frac.length);
  const toBig = (p: { neg: boolean; int: string; frac: string }) => {
    const v = BigInt(p.int + p.frac.padEnd(scale, "0"));
    return p.neg ? -v : v;
  };
  const sum = toBig(pa) + toBig(pb);
  const neg = sum < 0n;
  let digits = (neg ? -sum : sum).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? digits.slice(digits.length - scale) : "";
  return `${neg ? "-" : ""}${int}${scale > 0 ? "." + frac : ""}`;
}

/** Numeric equality independent of leading/trailing zeros ("0.10" == "0.1"). */
export function decimalsEqual(a: DecimalText, b: DecimalText): boolean {
  const norm = (t: string) => {
    const { neg, int, frac } = splitDecimal(t);
    const i = int.replace(/^0+(?=\d)/, "");
    const f = frac.replace(/0+$/, "");
    const zero = /^0*$/.test(i) && f === "";
    return `${neg && !zero ? "-" : ""}${i}${f ? "." + f : ""}`;
  };
  return norm(a) === norm(b);
}

// ─── Small field helpers ─────────────────────────────────────────────────────

function textOrNull(v: unknown): string | null {
  const t = scalarText(v);
  if (t === undefined) return null;
  const s = t.trim();
  return s === "" ? null : s;
}

function requireText(row: Obj, key: string, ctx: string): string {
  const t = textOrNull(row[key]);
  if (t === null) throw new MalformedPayarcResponse(`${ctx}: missing ${key}`);
  return t;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Date part (YYYY-MM-DD) of an ISO date or timestamp; null when not date-like. */
export function datePart(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && isIsoDate(m[1]) ? m[1] : null;
}

export function inWindow(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

// ─── Pagination metadata ─────────────────────────────────────────────────────

export interface PageMeta {
  currentPage: number | null;
  totalPages: number | null;
  total: number | null;
}

export function readPageMeta(envelope: Obj): PageMeta {
  const meta = isObject(envelope.meta) ? envelope.meta : null;
  const pag = meta && isObject(meta.pagination) ? meta.pagination : meta;
  const num = (v: unknown): number | null => {
    const t = scalarText(v);
    return t !== undefined && /^\d+$/.test(t) ? parseInt(t, 10) : null;
  };
  if (!pag) return { currentPage: null, totalPages: null, total: null };
  return {
    currentPage: num(pag.current_page),
    totalPages: num(pag.total_pages) ?? num(pag.last_page),
    total: num(pag.total),
  };
}

// ─── Batch reports ───────────────────────────────────────────────────────────

export function requireEnvelope(json: ExactJson, what: string): Obj {
  if (!isObject(json)) throw new MalformedPayarcResponse(`${what}: response is not a JSON object`);
  return json;
}

export function parseBatchRows(envelope: Obj): BatchReportRecord[] {
  const data = envelope.data;
  if (!Array.isArray(data)) throw new MalformedPayarcResponse("batch report: data is not an array");
  return data.map((raw, i) => {
    if (!isObject(raw)) throw new MalformedPayarcResponse(`batch report row ${i} is not an object`);
    const ctx = `batch report row ${i}`;
    const txText = requireText(raw, "Transactions", ctx);
    if (!/^\d+$/.test(txText)) throw new MalformedPayarcResponse(`${ctx}: Transactions is not a count`);
    const sales = decimalOrNull(raw.Amounts, `${ctx} Amounts`);
    if (sales === null) throw new MalformedPayarcResponse(`${ctx}: missing Amounts`);
    const settlement = requireText(raw, "Settlement_Date", ctx);
    if (!isIsoDate(settlement)) throw new MalformedPayarcResponse(`${ctx}: Settlement_Date is not YYYY-MM-DD`);
    return {
      merchantAccountNumber: requireText(raw, "Merchant_Account_Number", ctx),
      settlementDate: settlement,
      batchReferenceNumber: requireText(raw, "Batch_Reference_Number", ctx),
      dbaName: textOrNull(raw.dba_name),
      accountType: textOrNull(raw.account_type),
      rejectRecord: textOrNull(raw.reject_record),
      salesAmount: sales,
      totalRefunds: decimalOrNull(raw.total_refunds, `${ctx} total_refunds`),
      totalNetAmount: decimalOrNull(raw.total_net_amt, `${ctx} total_net_amt`),
      adjustedTotalSale: decimalOrNull(raw.ad_total_sale, `${ctx} ad_total_sale`),
      adjustedTotalRefunds: decimalOrNull(raw.ad_total_refunds, `${ctx} ad_total_refunds`),
      adjustedNetAmount: decimalOrNull(raw.ad_net_amt, `${ctx} ad_net_amt`),
      rejectedTotalSale: decimalOrNull(raw.rj_total_sale, `${ctx} rj_total_sale`),
      rejectedTotalRefunds: decimalOrNull(raw.rj_total_refunds, `${ctx} rj_total_refunds`),
      rejectedNetAmount: decimalOrNull(raw.rj_net_amt, `${ctx} rj_net_amt`),
      transactionCount: parseInt(txText, 10),
    };
  });
}

const batchKey = (r: BatchReportRecord) => `${r.merchantAccountNumber}|${r.batchReferenceNumber}|${r.settlementDate}`;

/**
 * Collapse byte-identical repeated batch rows (counted once) and refuse conflicting rows that
 * share the same merchant/batch/date identity. Returns the distinct records.
 */
export function dedupeBatchRecords(records: BatchReportRecord[]): { records: BatchReportRecord[]; duplicatesIgnored: number } {
  const seen = new Map<string, BatchReportRecord>();
  let duplicatesIgnored = 0;
  for (const r of records) {
    const k = batchKey(r);
    const prior = seen.get(k);
    if (!prior) {
      seen.set(k, r);
    } else if (JSON.stringify(prior) === JSON.stringify(r)) {
      duplicatesIgnored++;
    } else {
      throw new MalformedPayarcResponse("batch report: conflicting rows share one merchant/batch/date identity");
    }
  }
  return { records: [...seen.values()], duplicatesIgnored };
}

export function totalBatchesByMerchant(records: BatchReportRecord[]): BatchMerchantTotals[] {
  const byMerchant = new Map<string, BatchMerchantTotals>();
  for (const r of records) {
    let t = byMerchant.get(r.merchantAccountNumber);
    if (!t) {
      t = {
        merchantAccountNumber: r.merchantAccountNumber,
        batchCount: 0,
        transactionCount: 0,
        salesAmount: "0",
        totalRefunds: "0",
        totalNetAmount: "0",
      };
      byMerchant.set(r.merchantAccountNumber, t);
    }
    t.batchCount += 1;
    t.transactionCount += r.transactionCount;
    t.salesAmount = addDecimals(t.salesAmount, r.salesAmount);
    if (r.totalRefunds !== null) t.totalRefunds = addDecimals(t.totalRefunds, r.totalRefunds);
    if (r.totalNetAmount !== null) t.totalNetAmount = addDecimals(t.totalNetAmount, r.totalNetAmount);
  }
  return [...byMerchant.values()];
}

// ─── Residual tables ─────────────────────────────────────────────────────────

export interface TabularEnvelope {
  rows: Obj[];
  footer: Obj | null;
}

export function parseTabularEnvelope(envelope: Obj, what: string): TabularEnvelope {
  if (!Array.isArray(envelope.header_data)) throw new MalformedPayarcResponse(`${what}: header_data is not an array`);
  if (!Array.isArray(envelope.row_data)) throw new MalformedPayarcResponse(`${what}: row_data is not an array`);
  const rows = envelope.row_data.map((r, i) => {
    if (!isObject(r)) throw new MalformedPayarcResponse(`${what}: row ${i} is not an object`);
    return r;
  });
  let footer: Obj | null = null;
  const f = envelope.footer_data;
  if (Array.isArray(f)) {
    const first = f[0];
    if (first !== undefined) {
      if (!isObject(first)) throw new MalformedPayarcResponse(`${what}: footer_data[0] is not an object`);
      footer = first;
    }
  } else if (isObject(f)) {
    footer = f;
  } else if (f !== undefined && f !== null) {
    throw new MalformedPayarcResponse(`${what}: footer_data has an unexpected shape`);
  }
  return { rows, footer };
}

export function parseSummaryRows(rows: Obj[], what: string): ResidualSummaryRow[] {
  return rows.map((r, i) => {
    const ctx = `${what} row ${i}`;
    return {
      mid: requireText(r, "mid", ctx), // string: leading zeros preserved
      dbaName: textOrNull(r.dba_name),
      agentName: textOrNull(r.agent_name),
      agentId: textOrNull(r.agent_id),
      authorizations: decimalOrNull(r.auth, `${ctx} auth`),
      captures: decimalOrNull(r.txn, `${ctx} txn`),
      capturedSales: decimalOrNull(r.s_am, `${ctx} s_am`),
      revenue: decimalOrNull(r.inc, `${ctx} inc`),
      expense: decimalOrNull(r.exp, `${ctx} exp`),
      grossProfit: decimalOrNull(r.net, `${ctx} net`),
      splitPercent: decimalOrNull(r.perc, `${ctx} perc`),
      agentIncome: decimalOrNull(r.ag_net, `${ctx} ag_net`),
      bps: decimalOrNull(r.bps, `${ctx} bps`),
      boardedDate: textOrNull(r.boarded_date),
      residualDate: textOrNull(r.residual_date),
      bank: textOrNull(r.bank),
      providerAccountRef: textOrNull(r.hashed_account_id),
    };
  });
}

const FOOTER_SUM_FIELDS: Array<{ footerKey: string; rowKey: keyof ResidualSummaryRow }> = [
  { footerKey: "s_am", rowKey: "capturedSales" },
  { footerKey: "txn", rowKey: "captures" },
  { footerKey: "inc", rowKey: "revenue" },
  { footerKey: "exp", rowKey: "expense" },
  { footerKey: "net", rowKey: "grossProfit" },
  { footerKey: "ag_net", rowKey: "agentIncome" },
  { footerKey: "auth", rowKey: "authorizations" },
];

/** Normalise a footer to decimal text and compare it with the row sums. Report-only; never merges. */
export function reconcileFooter(
  rows: ResidualSummaryRow[],
  footer: Obj | null,
  what: string,
): { footer: Record<string, DecimalText | null> | null; status: ResidualFooterReconciliation } {
  if (!footer) return { footer: null, status: "footer_absent" };
  const normalised: Record<string, DecimalText | null> = {};
  for (const [k, v] of Object.entries(footer)) {
    if (v === null || scalarText(v) !== undefined) normalised[k] = decimalOrNull(v, `${what} footer ${k}`);
  }
  let compared = 0;
  let differs = false;
  for (const { footerKey, rowKey } of FOOTER_SUM_FIELDS) {
    const f = normalised[footerKey];
    if (f === null || f === undefined) continue;
    let sum: DecimalText = "0";
    let complete = true;
    for (const r of rows) {
      const v = r[rowKey] as DecimalText | null;
      if (v === null) {
        complete = false;
        break;
      }
      sum = addDecimals(sum, v);
    }
    if (!complete) continue;
    compared++;
    if (!decimalsEqual(sum, f)) differs = true;
  }
  if (compared === 0) return { footer: normalised, status: "not_comparable" };
  return { footer: normalised, status: differs ? "differs" : "matches" };
}

export function parseDetailRows(rows: Obj[], what: string): ResidualDetailRow[] {
  return rows.map((r, i) => {
    const ctx = `${what} row ${i}`;
    const reportDate = requireText(r, "report_date", ctx);
    if (datePart(reportDate) === null) throw new MalformedPayarcResponse(`${ctx}: report_date is not a date`);
    return {
      providerRowId: textOrNull(r.id),
      merchantId: requireText(r, "merchant_id", ctx),
      dbaName: textOrNull(r.dba_name),
      feeCategoryDescription: textOrNull(r.fee_category_description),
      feeItemName: textOrNull(r.fee_item_name),
      statementDescription: textOrNull(r.statement_description),
      salesCount: textOrNull(r.sales_count),
      salesAmount: decimalOrNull(r.sales_amount, `${ctx} sales_amount`),
      creditCount: textOrNull(r.credit_count),
      creditAmount: decimalOrNull(r.credit_amount, `${ctx} credit_amount`),
      interchangeFee: decimalOrNull(r.interchange_fee, `${ctx} interchange_fee`),
      incomeAmount: decimalOrNull(r.income_amount, `${ctx} income_amount`),
      reportDate,
      calculatedExpense: decimalOrNull(r.payarc_calculated_expense, `${ctx} payarc_calculated_expense`),
      calculatedIncome: decimalOrNull(r.payarc_calculated_income, `${ctx} payarc_calculated_income`),
      calculatedProfit: decimalOrNull(r.payarc_calculated_profit, `${ctx} payarc_calculated_profit`),
      calculatedResidual: decimalOrNull(r.payarc_calculated_residual, `${ctx} payarc_calculated_residual`),
      splitUsed: decimalOrNull(r.payarc_split_used, `${ctx} payarc_split_used`),
      agentId: textOrNull(r.payarc_agent_id),
      merchantStatus: textOrNull(r.merchant_status),
      createdAt: textOrNull(r.created_at),
      updatedAt: textOrNull(r.updated_at),
    };
  });
}

// ─── Disputes ────────────────────────────────────────────────────────────────

export function parseCaseRows(envelope: Obj): DisputeCaseRecord[] {
  const data = envelope.data;
  if (!Array.isArray(data)) throw new MalformedPayarcResponse("case list: data is not an array");
  return data.map((raw, i) => {
    if (!isObject(raw)) throw new MalformedPayarcResponse(`case list row ${i} is not an object`);
    const ctx = `case list row ${i}`;
    const files = isObject(raw.file) && Array.isArray(raw.file.data) ? raw.file.data.length : null;
    return {
      providerCaseId: requireText(raw, "id", ctx),
      caseNumber: textOrNull(raw.case_number),
      merchantNumber: textOrNull(raw.merchant_number),
      reportDate: textOrNull(raw.report_date),
      transactionDate: textOrNull(raw.transaction_date),
      caseAmount: decimalOrNull(raw.case_amount, `${ctx} case_amount`),
      merchantAmount: decimalOrNull(raw.merchant_amount, `${ctx} merchant_amount`),
      reasonCode: textOrNull(raw.reason_code),
      reasonDescription: textOrNull(raw.reason_desc),
      caseType: textOrNull(raw.case_type),
      status: textOrNull(raw.status),
      response: textOrNull(raw.response),
      respondedDate: textOrNull(raw.responded_date),
      lastUpdatedDate: textOrNull(raw.last_updated_date),
      isPrimaryCase: boolOrNull(raw.is_primary_case),
      caseSubmitted: boolOrNull(raw.case_submitted),
      bankNumber: textOrNull(raw.bank_number),
      evidenceFileCount: files,
    };
  });
}

export function parseDisputeChart(
  envelope: Obj,
): Pick<DisputeChartResult, "statusBreakdown" | "volumeSeries" | "countSeries"> {
  const arr = (key: string): Obj[] => {
    const v = envelope[key];
    if (!Array.isArray(v)) throw new MalformedPayarcResponse(`dispute chart: ${key} is not an array`);
    return v.map((x, i) => {
      if (!isObject(x)) throw new MalformedPayarcResponse(`dispute chart: ${key}[${i}] is not an object`);
      return x;
    });
  };
  const need = (o: Obj, k: string, ctx: string): DecimalText => {
    const d = decimalOrNull(o[k], `${ctx} ${k}`);
    if (d === null) throw new MalformedPayarcResponse(`${ctx}: missing ${k}`);
    return d;
  };
  return {
    statusBreakdown: arr("pi_chart_data").map((o, i) => ({
      label: requireText(o, "data_type", `pi_chart_data[${i}]`),
      disputeCount: need(o, "dispute_count", `pi_chart_data[${i}]`),
    })),
    volumeSeries: arr("dispute_volume_chart_data").map((o, i) => ({
      label: requireText(o, "label", `dispute_volume_chart_data[${i}]`),
      disputeVolume: need(o, "dispute_volume", `dispute_volume_chart_data[${i}]`),
      ratioVolume: decimalOrNull(o.ratio_volume, `dispute_volume_chart_data[${i}] ratio_volume`),
    })),
    countSeries: arr("dispute_count_chart_data").map((o, i) => ({
      label: requireText(o, "label", `dispute_count_chart_data[${i}]`),
      disputeCount: need(o, "dispute_count", `dispute_count_chart_data[${i}]`),
      ratioCount: decimalOrNull(o.ratio_count, `dispute_count_chart_data[${i}] ratio_count`),
    })),
  };
}
