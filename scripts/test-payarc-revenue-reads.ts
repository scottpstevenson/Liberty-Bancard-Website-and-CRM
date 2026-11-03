#!/usr/bin/env npx tsx
/**
 * test-payarc-revenue-reads.ts — Task #1777 deterministic contract tests.
 *
 * Fake transports and sanitized documented fixtures only: no database, no network, no provider
 * credentials. Proves request construction, envelope parsing, decimal precision, leading-zero
 * identifiers, pagination, provider errors, credential/environment separation, MID binding,
 * authorization/revocation precedence, canary refusals, and redaction.
 *
 * Run: npx tsx scripts/test-payarc-revenue-reads.ts
 */
import { readFileSync } from "node:fs";
import { PayarcProcessorAdapter } from "../server/services/processors/payarc.adapter";
import { NmiProcessorAdapter } from "../server/services/processors/nmi.adapter";
import { MockProcessorAdapter } from "../server/services/processors/mock.adapter";
import { resolveOperationSnapshot } from "../server/services/processors/operation-snapshot";
import { summarizeRead } from "../server/services/processors/payarc-read-summary";
import { runCanary } from "../server/services/processors/payarc-access-canary";
import {
  addDecimals,
  decimalsEqual,
  parseExactJson,
  decimalOrNull,
  MalformedPayarcResponse,
} from "../server/services/processors/payarc-report-parsers";
import { ResponseTooLargeError, classifyReportingBase } from "../server/services/processors/payarc-read-transport";
import { isHeld, monthToWindow, runBatchReports } from "../server/services/processors/payarc-reads";
import type { ReadTransport, ReadTransportRequest } from "../server/services/processors/payarc-read-transport";

// ── harness ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const PARTNER_KEY = "SENTINEL_PARTNER_KEY_value";
const MERCHANT_KEY = "SENTINEL_MERCHANT_KEY_value";
const SANDBOX = "https://testapi.payarc.net/v1";
const PRODUCTION = "https://api.payarc.net/v1";
process.env.PAYARC_API_KEY = PARTNER_KEY;
process.env.PAYARC_MERCHANT_API_KEY = MERCHANT_KEY;
process.env.PAYARC_RATE_LIMIT_BACKOFF_MS = "1";
delete process.env.PAYARC_PARTNER_KEY_ENVIRONMENT;
delete process.env.PAYARC_MERCHANT_KEY_ENVIRONMENT;

// Any real network use is a test failure.
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async () => {
  throw new Error("unexpected real fetch in deterministic test");
};

interface Reply {
  status?: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  throws?: Error;
}
function fake(replies: Reply[] | ((req: ReadTransportRequest, n: number) => Reply)) {
  const requests: ReadTransportRequest[] = [];
  const transport: ReadTransport = async (req) => {
    requests.push(req);
    const r = typeof replies === "function" ? replies(req, requests.length) : replies[Math.min(requests.length - 1, replies.length - 1)];
    if (r.throws) throw r.throws;
    return {
      status: r.status ?? 200,
      text: r.raw ?? JSON.stringify(r.body ?? {}),
      headers: { "x-ratelimit-remaining": "100", ...(r.headers ?? {}) },
    };
  };
  return { transport, requests };
}
const noSleep = async () => {};

// ── sanitized documented fixtures (values synthetic) ─────────────────────────
const batchRow = (over: Record<string, unknown> = {}) => ({
  Merchant_Account_Number: "0700100000084881",
  dba_name: "Test Merchant",
  account_type: "Visa",
  Settlement_Date: "2026-10-02",
  Batch_Reference_Number: "000123",
  Amounts: 16133022,
  Transactions: 796,
  total_refunds: 100,
  total_net_amt: 16132922,
  ad_total_sale: null,
  ad_total_refunds: null,
  ad_net_amt: null,
  rj_total_sale: null,
  rj_total_refunds: null,
  rj_net_amt: null,
  ...over,
});

const summaryEnvelope = (rows: unknown[], footer: unknown) => ({
  header_data: [{ column_name: "MID", column_id: "mid", type: "string" }],
  row_data: rows,
  footer_data: footer === undefined ? undefined : [footer],
});
const sRow = (over: Record<string, unknown> = {}) => ({
  dba_name: "Test Merchant", agent_name: "Test Agent ", mid: "0926700001306034",
  s_am: 0, txn: 0, inc: 9886.13, exp: 9539.26, net: 346.87, ag_net: 69.37, bps: "0.00", perc: 20, auth: "8969", ...over,
});
const sFooter = (over: Record<string, unknown> = {}) => ({
  dba_name: null, agent_name: null, mid: null, s_am: 0, txn: 0, inc: 9886.13, exp: 9539.26, net: 346.87, ag_net: 69.37, bps: 0, perc: 20, auth: 8969, ...over,
});
const dRow = (over: Record<string, unknown> = {}) => ({
  merchant_id: "567000000000018", dba_name: null, fee_category_description: "MISC Per Item Fees",
  sales_count: "0000000001", sales_amount: "000000000000.00", credit_count: "0000000000", credit_amount: "000000000000.00",
  interchange_fee: "000000000000.00", report_date: "2026-09-01", payarc_calculated_expense: null,
  payarc_calculated_income: null, payarc_calculated_profit: null, payarc_calculated_residual: null,
  payarc_agent_id: "7", income_amount: "000000000012.50", object: "ResidualRecordType2", id: "lwj3enjwdqwm7pka", ...over,
});
const detailEnvelope = (rows: unknown[], page = 1, totalPages = 1, total = rows.length) => ({
  header_data: [], row_data: rows,
  meta: { include: [], custom: [], pagination: { total, count: rows.length, per_page: 2, current_page: page, total_pages: totalPages, links: {} } },
});
const caseRow = (over: Record<string, unknown> = {}) => ({
  object: "Cases", id: "WB9MAbddbRV0Aw10", merchant_number: "0567092559357930", report_date: "2026-10-05",
  transaction_date: "2026-09-16", case_amount: 179, merchant_amount: 179, reason_code: "13.2", reason_desc: "Consumer Dispute",
  case_type: "Collaboration Reversal", status: "Pending", response: "Not responded", is_primary_case: false, case_submitted: false,
  bank_number: 9267, card_number: "407204*********7793", card_last4: "7793", acquirer_reference_number: "24027322168400017100211",
  merchant_dba_name: "DANIEL A ROSEN INC", merchant_city: "LOS ANGELES", file: { data: [] }, ...over,
});

const winOct = { fromDate: "2026-10-01", toDate: "2026-10-07" };
const partnerAdapter = (t: ReadTransport) => new PayarcProcessorAdapter({ readTransport: t });
const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prior[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
};

async function main() {
  console.log("\n== exact decimal and JSON handling ==");
  ok("addDecimals exact", addDecimals("9886.13", "0.87") === "9887.00");
  ok("addDecimals negative", addDecimals("1.5", "-2.25") === "-0.75");
  ok("addDecimals large integer", addDecimals("12345678901234567890", "1") === "12345678901234567891");
  ok("decimalsEqual ignores padding", decimalsEqual("000000000012.50", "12.5") && !decimalsEqual("12.5", "12.51"));
  const exact = parseExactJson('{"a":12345678901234567890,"b":9886.130}') as any;
  ok("JSON numbers keep source text", exact.a.text === "12345678901234567890" && exact.b.text === "9886.130");
  let threw = false;
  try { decimalOrNull(parseExactJson('1e5'), "x"); } catch (e) { threw = e instanceof MalformedPayarcResponse; }
  ok("exponent notation is malformed, not coerced", threw);
  ok("month window handles leap February", monthToWindow("2028-02")?.toDate === "2028-02-29" && monthToWindow("2026-13") === null);

  console.log("\n== host classification ==");
  ok("sandbox/production reporting hosts", classifyReportingBase(SANDBOX) === "sandbox" && classifyReportingBase(`${PRODUCTION}/`) === "production");
  ok("Connect and lookalike hosts refused",
    [ "https://connect.payarc.net/v3", "https://api.payarc.net.evil.test/v1", "http://api.payarc.net/v1", "https://testap1.payarc.net/v1", "https://api.payarc.net/v3", "https://u:p@api.payarc.net/v1" ]
      .every((u) => classifyReportingBase(u) === null));

  console.log("\n== batch reports (partner key) ==");
  {
    const f = fake([{ body: { data: [batchRow(), batchRow({ Merchant_Account_Number: "0700100000099999", Batch_Reference_Number: "000124", Amounts: "100.10", Transactions: 2, total_refunds: null, total_net_amt: "100.10" })] } }]);
    const a = partnerAdapter(f.transport);
    const r = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("query placement: dates in query string, no body", f.requests.length === 1 && f.requests[0].jsonBody === undefined && f.requests[0].url.startsWith(`${SANDBOX}/agent/batch/reports?`) && f.requests[0].url.includes("from_date=2026-10-01") && f.requests[0].url.includes("to_date=2026-10-07"));
    ok("uses partner key only", f.requests[0].headers.Authorization === `Bearer ${PARTNER_KEY}`);
    ok("parsed", !isHeld(r) && r.kind === "agent_batch_report");
    if (!isHeld(r) && r.kind === "agent_batch_report") {
      ok("MID leading zero preserved as string", r.records[0].merchantAccountNumber === "0700100000084881");
      ok("batch reference leading zeros preserved", r.records[0].batchReferenceNumber === "000123");
      ok("integer amount kept as published (not divided by 100)", r.records[0].salesAmount === "16133022");
      ok("decimal string kept", r.records[1].salesAmount === "100.10");
      ok("nullable adjusted/rejected fields stay null", r.records[0].adjustedNetAmount === null && r.records[0].rejectedTotalSale === null);
      ok("gross and net are separate fields", r.records[0].salesAmount !== r.records[0].totalNetAmount);
      ok("units explicitly unspecified", r.monetaryUnits === "provider_unspecified");
      ok("per-merchant totals", r.merchantTotals.length === 2 && r.merchantTotals[1].salesAmount === "100.10" && r.merchantTotals[1].totalRefunds === "0");
    }
    const fb = fake([{ body: { data: [] } }]);
    await partnerAdapter(fb.transport).getBatchReports({ ...winOct, filterPlacement: "body" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("body placement: GET body carries dates, URL has no query", fb.requests[0].url === `${SANDBOX}/agent/batch/reports` && JSON.stringify(fb.requests[0].jsonBody) === JSON.stringify({ from_date: "2026-10-01", to_date: "2026-10-07" }));
  }
  {
    const f = fake([{ body: { data: [] } }]);
    const r = await partnerAdapter(f.transport).getBatchReports({ ...winOct } as any, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("missing filter placement holds before any request", isHeld(r) && r.code === "filter_placement_unverified" && f.requests.length === 0);
    const w = await partnerAdapter(f.transport).getBatchReports({ fromDate: "2026-01-01", toDate: "2026-06-30", filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("oversized window held before any request", isHeld(w) && w.code === "window_too_large" && f.requests.length === 0);
    const bad = await partnerAdapter(f.transport).getBatchReports({ fromDate: "2026-10-9", toDate: "2026-10-10", filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("non-ISO date rejected", isHeld(bad) && bad.code === "invalid_request");
  }
  {
    const f = fake([{ body: { data: [batchRow({ Settlement_Date: "2026-09-01" })] } }]);
    const r = await partnerAdapter(f.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("ignored date filters are held, not returned", isHeld(r) && r.code === "filters_ignored");
    const dup = fake([{ body: { data: [batchRow(), batchRow()] } }]);
    const d = await partnerAdapter(dup.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("identical repeated batch counted once", !isHeld(d) && d.kind === "agent_batch_report" && d.records.length === 1 && d.duplicatesIgnored === 1 && d.merchantTotals[0].transactionCount === 796);
    const conf = fake([{ body: { data: [batchRow(), batchRow({ Amounts: 5 })] } }]);
    const c = await partnerAdapter(conf.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("conflicting rows with one identity are held", isHeld(c) && c.code === "malformed_response");
    const two = fake([{ body: { data: [batchRow(), batchRow({ Merchant_Account_Number: "0700100000099999", Batch_Reference_Number: "9" })] } }]);
    const b = await partnerAdapter(two.transport).getBatchReports({ ...winOct, filterPlacement: "query", merchantAccountNumber: "0700100000099999" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("MID filter keeps only that exact MID and counts the rest", !isHeld(b) && b.kind === "agent_batch_report" && b.records.length === 1 && b.otherMerchantRowsExcluded === 1);
    const noMid = fake([{ body: { data: [batchRow({ Merchant_Account_Number: undefined })] } }]);
    const n = await partnerAdapter(noMid.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("row without merchant identity is malformed", isHeld(n) && n.code === "malformed_response");
    const pages = fake((_req, n) => ({ body: { data: [batchRow({ Batch_Reference_Number: String(n) })], meta: { pagination: { current_page: n, total_pages: 2, total: 2 } } } }));
    const p = await partnerAdapter(pages.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("paginated batch reports follow pages", !isHeld(p) && p.kind === "agent_batch_report" && p.records.length === 2 && pages.requests[1].url.includes("page=2"));
  }

  console.log("\n== residuals (partner key) ==");
  {
    const f = fake([{ body: summaryEnvelope([sRow()], sFooter()) }]);
    const a = partnerAdapter(f.transport);
    const r = await a.getResidualReport({ source: "agent_residual_summary", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "9267" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("summary request: GET /agent_residual/summary with bank + dates", f.requests[0].url.startsWith(`${PRODUCTION}/agent_residual/summary?`) && f.requests[0].url.includes("bank=9267") && f.requests[0].url.includes("from_date=2026-09-01"));
    ok("never POST /residuals", f.requests.every((q) => !q.url.includes("/residuals")));
    ok("summary parsed with partner key", !isHeld(r) && r.kind === "residual_summary" && f.requests[0].headers.Authorization === `Bearer ${PARTNER_KEY}`);
    if (!isHeld(r) && r.kind === "residual_summary") {
      ok("16-digit MID with leading zero preserved", r.rows[0].mid === "0926700001306034");
      ok("decimals kept at source text; ag_net is agentIncome, net is grossProfit", r.rows[0].agentIncome === "69.37" && r.rows[0].grossProfit === "346.87" && r.rows[0].revenue === "9886.13");
      ok("string auth count kept", r.rows[0].authorizations === "8969");
      ok("footer reconciles but is not added to rows", r.footerReconciliation === "matches" && r.rows.length === 1);
      ok("marked single-source (no double counting)", r.overlapPolicy === "single_source_only" && r.semantics === "merchant_aggregate");
    }
    const differ = fake([{ body: summaryEnvelope([sRow()], sFooter({ ag_net: 70.0 })) }]);
    const d = await partnerAdapter(differ.transport).getResidualReport({ source: "agent_residual_summary", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "9267" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("footer mismatch is reported, not hidden", !isHeld(d) && d.kind === "residual_summary" && d.footerReconciliation === "differs");
    const noBank = fake([{ body: summaryEnvelope([], undefined) }]);
    const nb = await partnerAdapter(noBank.transport).getResidualReport({ source: "agent_residual_summary", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("bank required for /agent_residual/summary: held before request", isHeld(nb) && nb.code === "bank_required" && noBank.requests.length === 0);
    const agent = await partnerAdapter(noBank.transport).getResidualReport({ source: "agent_residual_summary", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "9267", agentId: "5" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("summary route has no agent filter", isHeld(agent) && agent.code === "agent_filter_unsupported" && noBank.requests.length === 0);
    const badBank = await partnerAdapter(noBank.transport).getResidualReport({ source: "residual_table_summaries", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "1234" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("undocumented bank value rejected", isHeld(badBank) && badBank.code === "invalid_request");
    const mid = fake([{ body: summaryEnvelope([sRow(), sRow({ mid: "0926700001306099" })], undefined) }]);
    const m = await partnerAdapter(mid.transport).getResidualReport({ source: "agent_residual_summary", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "9267", mid: "0926700001306034" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("rows for another MID are held, not attributed", isHeld(m) && m.code === "mid_binding_mismatch");
    ok("MID in the hold is masked", isHeld(m) && !m.reason.includes("0926700001306034") && m.reason.includes("1306034".slice(-4)));
  }
  {
    const f = fake([{ body: { header_data: [], row_data: [{ boarded_date: "2020-06-11", dba_name: "X", mid: "0926700349283458", s_am: 0, txn: 0, inc: 0, exp: 0, net: 0, ag_net: 0, bps: 0, perc: 0, auth: 0, residual_date: "2026-09-30", bank: "9267", agent_id: 5, hashed_account_id: "7e04nxeV97NRVG9Z" }], footer_data: [{ ag_net: null, inc: null }] } }]);
    const r = await partnerAdapter(f.transport).getResidualReport({ source: "residual_table_summaries", fromDate: "2026-09-01", toDate: "2026-09-30", agentId: "5" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("table summaries: bank optional (not sent), agent_id forwarded", !f.requests[0].url.includes("bank=") && f.requests[0].url.includes("agent_id=5") && f.requests[0].url.includes("/residual_table_summaries?"));
    ok("table summary parsed; null footer fields are not comparable, not zero", !isHeld(r) && r.kind === "residual_summary" && r.footerReconciliation === "not_comparable" && r.rows[0].agentId === "5");
    const outside = fake([{ body: { header_data: [], row_data: [{ mid: "1", residual_date: "2025-01-31", inc: 1 }] } }]);
    const o = await partnerAdapter(outside.transport).getResidualReport({ source: "residual_table_summaries", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("rows outside the window are held", isHeld(o) && o.code === "filters_ignored");
  }
  {
    const f = fake([{ body: detailEnvelope([dRow(), dRow({ id: "b", payarc_agent_id: "9", merchant_id: "567000000000026" })]) }]);
    const r = await partnerAdapter(f.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30", agentId: "7", limit: 10 }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("details request: /residual-details with tsys filters absent, limit and agent_id", f.requests[0].url.startsWith(`${PRODUCTION}/residual-details?`) && f.requests[0].url.includes("limit=10") && f.requests[0].url.includes("agent_id=7") && !f.requests[0].url.includes("excel"));
    ok("details parsed as fee line items", !isHeld(r) && r.kind === "residual_fee_line_items" && r.semantics === "fee_line_items");
    if (!isHeld(r) && r.kind === "residual_fee_line_items") {
      ok("zero-padded decimal strings preserved", r.rows[0].salesAmount === "000000000000.00" && r.rows[0].incomeAmount === "000000000012.50");
      ok("nullable calculated values stay null (not 0)", r.rows[0].calculatedResidual === null && r.rows[0].calculatedIncome === null);
      ok("leading-zero count text preserved", r.rows[0].salesCount === "0000000001");
      ok("agent scope: other-agent rows are counted", r.rowsWithDifferentAgent === 1 && r.requestedAgentId === "7");
    }
    const pg = fake((_q, n) => ({ body: detailEnvelope([dRow({ id: `p${n}` }), dRow({ id: `q${n}` })], n, 2, 4) }));
    const p = await partnerAdapter(pg.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30", limit: 2 }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("pagination collects every page", !isHeld(p) && p.kind === "residual_fee_line_items" && p.rows.length === 4 && pg.requests.length === 2 && pg.requests[1].url.includes("page=2") && !pg.requests[0].url.includes("page="));
    const stuck = fake(() => ({ body: detailEnvelope([dRow()], 1, 3, 3) }));
    const s = await partnerAdapter(stuck.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30", limit: 1 }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("provider ignoring page is stopped (no infinite loop)", isHeld(s) && s.code === "pagination_no_progress" && stuck.requests.length === 2);
    const short = fake([{ body: detailEnvelope([dRow()], 1, 1, 5) }]);
    const sh = await partnerAdapter(short.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("collected count must match provider total", isHeld(sh) && sh.code === "pagination_incomplete");
    const full = fake([{ body: { header_data: [], row_data: [dRow(), dRow({ id: "z" })] } }]);
    const fl = await partnerAdapter(full.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30", limit: 2 }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("a full page without pagination metadata cannot be called complete", isHeld(fl) && fl.code === "pagination_unverified");
    const out = fake([{ body: detailEnvelope([dRow({ report_date: "2025-01-01" })]) }]);
    const ou = await partnerAdapter(out.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("line items outside the window are held", isHeld(ou) && ou.code === "filters_ignored");
    const emptyDetail = fake([{ body: detailEnvelope([], 1, 1, 0) }]);
    const e = await partnerAdapter(emptyDetail.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("empty tabular response is an empty result, not an error", !isHeld(e) && e.kind === "residual_fee_line_items" && e.rows.length === 0);
    const noRows = fake([{ body: { header_data: [] } }]);
    const nr = await partnerAdapter(noRows.transport).getResidualReport({ source: "residual_details", fromDate: "2026-09-01", toDate: "2026-09-30" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
    ok("missing row_data is malformed", isHeld(nr) && nr.code === "malformed_response");
  }

  console.log("\n== disputes (merchant key) ==");
  {
    const f = fake([{ body: { data: [caseRow()], meta: { include: ["file"], custom: [] } } }]);
    const r = await partnerAdapter(f.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31", mid: "0567092559357930" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    const url = decodeURIComponent(f.requests[0].url);
    ok("cases: YYYY/MM/DD bounds, merchant key", url.includes("report_date[gte]=2026/10/01") && url.includes("report_date[lte]=2026/10/31") && f.requests[0].headers.Authorization === `Bearer ${MERCHANT_KEY}` && url.startsWith(`${SANDBOX}/cases?`));
    ok("case list parsed and scoped to one merchant account", !isHeld(r) && r.kind === "dispute_case_list" && r.credentialScope === "merchant_credential_account" && r.portfolioCoverage === false);
    if (!isHeld(r) && r.kind === "dispute_case_list") {
      const json = JSON.stringify(r);
      ok("card data, ARN, and addresses are not carried", !json.includes("407204") && !json.includes("7793") && !json.includes("24027322168400017100211") && !json.includes("LOS ANGELES") && !json.includes("ROSEN"));
      ok("provider case id kept for later detail retrieval", r.records[0].providerCaseId === "WB9MAbddbRV0Aw10" && r.records[0].bankNumber === "9267");
      ok("amount unit not guessed", r.records[0].caseAmount === "179" && r.monetaryUnits === "provider_unspecified");
    }
    const other = fake([{ body: { data: [caseRow({ merchant_number: "0567099999999999" })] } }]);
    const m = await partnerAdapter(other.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31", mid: "0567092559357930" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("case for an unrelated MID is held, not attributed", isHeld(m) && m.code === "mid_binding_mismatch");
    const nomn = fake([{ body: { data: [caseRow({ merchant_number: null })] } }]);
    const nm = await partnerAdapter(nomn.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31", mid: "0567092559357930" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("case without merchant_number cannot be bound", isHeld(nm) && nm.code === "mid_binding_unverifiable");
    const unbound = fake([{ body: { data: [caseRow(), caseRow({ id: "x2", merchant_number: "0567099999999999" })] } }]);
    const ub = await partnerAdapter(unbound.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("unbound listing is allowed and labeled, with no MID attribution", !isHeld(ub) && ub.kind === "dispute_case_list" && ub.boundMid === null && ub.records.length === 2);
    const dupe = fake([{ body: { data: [caseRow(), caseRow()] } }]);
    const dp = await partnerAdapter(dupe.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("duplicate case ids are malformed", isHeld(dp) && dp.code === "malformed_response");
    const pages = fake((_q, n) => ({ body: { data: n === 1 ? Array.from({ length: 100 }, (_x, i) => caseRow({ id: `a${i}` })) : [caseRow({ id: "last" })] } }));
    const pg = await partnerAdapter(pages.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("short-page heuristic continues past a full first page", !isHeld(pg) && pg.kind === "dispute_case_list" && pg.records.length === 101 && pages.requests.length === 2);
    const emp = fake([{ body: { data: [], meta: { include: [], custom: [] } } }]);
    const em = await partnerAdapter(emp.transport).listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("empty 200 is an empty list (access, not reconciliation)", !isHeld(em) && em.kind === "dispute_case_list" && em.records.length === 0);
  }
  {
    const chart = { pi_chart_data: [{ dispute_count: 2, data_type: "Pending" }], dispute_volume_chart_data: [{ dispute_volume: "12.50", ratio_volume: 0, label: "2026-10-01" }], dispute_count_chart_data: [{ dispute_count: 2, ratio_count: 0, label: "2026-10-01" }] };
    const f = fake([{ body: chart }]);
    const r = await partnerAdapter(f.transport).getDisputeChart({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("chart: separate route, merchant key", decodeURIComponent(f.requests[0].url).startsWith(`${SANDBOX}/dispute-chart?report_date[gte]=2026/10/01`) && f.requests[0].headers.Authorization === `Bearer ${MERCHANT_KEY}`);
    ok("chart is aggregate-only with no case records", !isHeld(r) && r.kind === "dispute_chart_aggregate" && r.aggregateOnly === true && !("records" in r));
    ok("chart decimals kept", !isHeld(r) && r.kind === "dispute_chart_aggregate" && r.volumeSeries[0].disputeVolume === "12.50");
    const bad = fake([{ body: { pi_chart_data: [] } }]);
    const b = await partnerAdapter(bad.transport).getDisputeChart({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    ok("incomplete chart payload is malformed", isHeld(b) && b.code === "malformed_response");
  }

  console.log("\n== provider errors, transport failures, redaction ==");
  {
    const mk = (reply: Reply) => fake([reply]);
    const run = (t: ReadTransport) => partnerAdapter(t).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    const e401 = await run(mk({ status: 401, body: { message: "SECRET_BODY_TEXT" } }).transport);
    ok("401 is an entitlement result, not a code failure", isHeld(e401) && e401.code === "entitlement_required" && /entitlement/.test(e401.reason));
    ok("403 is the same", (await run(mk({ status: 403, body: {} }).transport) as any).code === "entitlement_required");
    ok("422 maps to rejected parameters", (await run(mk({ status: 422, body: { errors: { bank: ["x"] } } }).transport) as any).code === "provider_rejected_parameters");
    const nm = await run(mk({ status: 422, body: { message: "You don't have any merchants attached to your Agent account." } }).transport) as any;
    ok("422 'no merchants attached' is its own hold, not a parameter error", isHeld(nm) && nm.code === "no_merchants_attached" && !/attached to your Agent/.test(nm.reason));
    ok("429 maps to rate_limited", (await run(mk({ status: 429, body: {} }).transport) as any).code === "rate_limited");
    ok("500 maps to provider_error", (await run(mk({ status: 500, body: {} }).transport) as any).code === "provider_error");
    const html = await run(mk({ raw: "<html>SECRET_BODY_TEXT</html>" }).transport);
    ok("non-JSON 200 is malformed", isHeld(html) && html.code === "malformed_response");
    ok("JSON array envelope is malformed", ((await run(mk({ raw: "[]" }).transport)) as any).code === "malformed_response");
    const net = await run(mk({ throws: Object.assign(new Error("boom SECRET_BODY_TEXT"), { code: "ECONNRESET" }) }).transport);
    ok("network failure becomes a transport hold", isHeld(net) && net.code === "transport_error");
    const big = await run(mk({ throws: new ResponseTooLargeError() }).transport);
    ok("oversized response is held", isHeld(big) && big.code === "response_too_large");
    const all = [e401, html, net, big].filter(isHeld).map((h) => h.reason).join("|");
    ok("holds never contain bodies, error text, or key values", !all.includes("SECRET_BODY_TEXT") && !all.includes(PARTNER_KEY) && !all.includes(MERCHANT_KEY));
    // rate-limit pause is applied (header low) — completes quickly with a 1ms back-off.
    const t0 = Date.now();
    await run(mk({ body: { data: [] }, headers: { "x-ratelimit-remaining": "0" } }).transport);
    ok("rate-limit back-off path executes", Date.now() - t0 < 2000);
  }
  {
    const f = fake([{ body: { data: [batchRow()] } }]);
    const r = await partnerAdapter(f.transport).getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
    const s = summarizeRead(r as any);
    const json = JSON.stringify(s);
    ok("operator summary: counts only, no MID digits, amounts, or sample rows", s.recordCount === 1 && !json.includes("0700100000084881") && !json.includes("16133022") && !json.includes("Test Merchant"));
    const h = summarizeRead({ status: "held", reason: "x", code: "bank_required" });
    ok("held summary keeps the code", h.status === "held" && h.code === "bank_required");
  }

  console.log("\n== credential/environment separation and authorization ==");
  {
    const f = fake([{ body: { data: [] } }]);
    const a = partnerAdapter(f.transport);
    const noSnap = await a.getBatchReports({ ...winOct, filterPlacement: "query" });
    ok("no snapshot URL: held, nothing sent", isHeld(noSnap) && noSnap.code === "snapshot_url_required" && f.requests.length === 0);
    const connect = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: "https://connect.payarc.net/v3" });
    ok("Connect host refused, nothing sent", isHeld(connect) && connect.code === "host_not_reporting" && f.requests.length === 0);
    await withEnv({ PAYARC_PARTNER_KEY_ENVIRONMENT: "production" }, async () => {
      const m = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
      ok("production-declared key never sent to the sandbox host", isHeld(m) && m.code === "environment_mismatch" && f.requests.length === 0);
      const okRun = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
      ok("matching declaration proceeds and is recorded", !isHeld(okRun) && okRun.kind === "agent_batch_report" && okRun.evidence.credentialEnvironment === "declared" && okRun.evidence.environment === "production");
    });
    await withEnv({ PAYARC_MERCHANT_KEY_ENVIRONMENT: "sandbox" }, async () => {
      const m = await a.listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: PRODUCTION });
      ok("sandbox-declared merchant key refused on the production host", isHeld(m) && m.code === "environment_mismatch");
    });
    await withEnv({ PAYARC_PARTNER_KEY_ENVIRONMENT: "staging" }, async () => {
      const m = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
      ok("invalid declaration refused", isHeld(m) && m.code === "environment_invalid");
    });
    await withEnv({ PAYARC_API_KEY: undefined }, async () => {
      const m = await a.getBatchReports({ ...winOct, filterPlacement: "query" }, { snapshotAuthorizedBaseUrl: SANDBOX });
      ok("missing partner key holds without using the merchant key", isHeld(m) && m.code === "credential_missing");
    });
    await withEnv({ PAYARC_MERCHANT_API_KEY: undefined }, async () => {
      const m = await a.listDisputeCases({ fromDate: "2026-10-01", toDate: "2026-10-31" }, { snapshotAuthorizedBaseUrl: SANDBOX });
      ok("missing merchant key holds without using the partner key", isHeld(m) && m.code === "credential_missing");
    });
    const wrong = await runBatchReports({ keyClass: "merchant", apiKey: MERCHANT_KEY, baseUrl: SANDBOX, transport: f.transport }, { ...winOct, filterPlacement: "query" });
    ok("batch reports refuse the merchant key class", isHeld(wrong) && wrong.code === "wrong_key_class");

    // Revocation: a newer held/expired snapshot for the operation overrides an older owner_confirmed one.
    const rows = [
      { status: "held", supportedOperations: ["get_batch_reports"] },
      { status: "owner_confirmed", supportedOperations: ["get_batch_reports", "get_disputes"] },
    ];
    ok("revocation precedence is per operation", resolveOperationSnapshot(rows, "get_batch_reports")?.status === "held" && resolveOperationSnapshot(rows, "get_disputes")?.status === "owner_confirmed" && resolveOperationSnapshot(rows, "get_residual_details") === undefined);
  }

  console.log("\n== adapter surface and legacy holds ==");
  {
    const legacy = await new PayarcProcessorAdapter().getResiduals("2026-09");
    ok("legacy getResiduals stays a hold and points at the typed report", !Array.isArray(legacy) && legacy.code === "use_typed_residual_report" && !/POST \/v1\/residuals|POST \/residuals/.test(legacy.reason));
    const nmi = new NmiProcessorAdapter() as any;
    const mock = new MockProcessorAdapter() as any;
    for (const [n, adapter] of [["NMI", nmi], ["Mock", mock]] as const) {
      const rs = await Promise.all([adapter.getBatchReports({}), adapter.getResidualReport({}), adapter.listDisputeCases({}), adapter.getDisputeChart({})]);
      ok(`${n} adapter holds the Payarc-specific reads`, rs.every((r: any) => r.status === "held" && r.code === "not_supported"));
    }
    const up = await new PayarcProcessorAdapter().submitDisputeEvidence({ mid: "1", caseId: "x", transactionId: "t", amount: 1, reason: "r", cardBrand: "v" });
    ok("evidence upload remains held", (up as any).status === "held");
  }

  console.log("\n== access canary (fake transport) ==");
  {
    const env = (extra: Record<string, string> = {}) => ({ PAYARC_API_KEY: PARTNER_KEY, PAYARC_MERCHANT_API_KEY: MERCHANT_KEY, ...extra }) as NodeJS.ProcessEnv;
    const f = fake([{ body: { data: [{ id: "1", amount: 5 }] } }]);
    const base = { environment: "sandbox" as const, operation: "dispute-chart" as const, fromDate: "2026-10-01", toDate: "2026-10-31" };
    const r1 = await runCanary(base, { env: env({ PAYARC_MERCHANT_KEY_ENVIRONMENT: "sandbox" }), transport: f.transport, sleep: noSleep });
    ok("canary refuses without PAYARC_SANDBOX_LIVE=1", r1.code === "live_not_enabled" && r1.freshAccess === "not_attempted" && f.requests.length === 0);
    const r2 = await runCanary(base, { env: env({ PAYARC_SANDBOX_LIVE: "1" }), transport: f.transport, sleep: noSleep });
    ok("canary refuses an undeclared credential environment", r2.code === "environment_not_declared" && f.requests.length === 0);
    const r3 = await runCanary(base, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_MERCHANT_KEY_ENVIRONMENT: "production" }), transport: f.transport, sleep: noSleep });
    ok("canary refuses a mismatched credential environment", r3.code === "environment_mismatch" && f.requests.length === 0);
    const r4 = await runCanary({ ...base, environment: "production" }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_MERCHANT_KEY_ENVIRONMENT: "production" }), transport: f.transport, sleep: noSleep });
    ok("production host needs explicit confirmation", r4.code === "production_read_not_confirmed" && f.requests.length === 0);
    const r5 = await runCanary({ ...base, operation: "identity" }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_PARTNER_KEY_ENVIRONMENT: "sandbox" }), transport: f.transport, sleep: noSleep });
    ok("identity canary: one GET on the selected host with the partner key", r5.freshAccess === "granted" && f.requests.length === 1 && f.requests[0].url === `${SANDBOX}/accounts/me` && f.requests[0].headers.Authorization === `Bearer ${PARTNER_KEY}`);
    ok("receipt records field NAMES only", r5.recordFieldNames.join() === "amount,id" && !JSON.stringify(r5).includes('"amount":5'));
    ok("receipt never grants use and is not contract validation for identity", r5.authorizedUse === "not_granted" && r5.populatedContractValidated === false && r5.documentedSupport === true);
    const f401 = fake([{ status: 401, body: { message: "no" } }]);
    const r6 = await runCanary({ ...base, environment: "production", operation: "residual-summary", fromDate: "2026-09-01", toDate: "2026-09-30", bank: "9267", allowProductionRead: true }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_PARTNER_KEY_ENVIRONMENT: "production" }), transport: f401.transport, sleep: noSleep });
    ok("partner 401 is reported as an entitlement result", r6.freshAccess === "entitlement_required" && r6.code === "entitlement_required" && f401.requests.length === 1);
    const fe = fake([{ body: { data: [] } }]);
    const r7 = await runCanary({ environment: "production", operation: "batch-placement-compare", fromDate: "2026-10-01", allowProductionRead: true }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_PARTNER_KEY_ENVIRONMENT: "production" }), transport: fe.transport, sleep: noSleep });
    ok("placement compare sends both placements for one day", fe.requests.length === 2 && fe.requests[0].jsonBody === undefined && fe.requests[1].jsonBody !== undefined);
    ok("empty responses do not resolve the placement question", r7.freshAccess === "granted" && r7.notes.some((n) => /NOT resolved/.test(n)) && r7.populatedContractValidated === false);
    const rb = await runCanary({ environment: "sandbox", operation: "batch-reports", fromDate: "2026-10-01", toDate: "2026-10-02" }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_PARTNER_KEY_ENVIRONMENT: "sandbox" }), transport: fe.transport, sleep: noSleep });
    ok("batch canary requires an explicit placement", rb.code === "filter_placement_required");
    const wh = fake([{ body: { data: [{ id: "w", url: "https://example.test/hook", event_types: [{ event_type: "dispute.won" }] }] } }]);
    const rw = await runCanary({ environment: "sandbox", operation: "webhooks-list" }, { env: env({ PAYARC_SANDBOX_LIVE: "1", PAYARC_MERCHANT_KEY_ENVIRONMENT: "sandbox" }), transport: wh.transport, sleep: noSleep });
    ok("webhook listing is read-only and exposes no subscription URLs", wh.requests.length === 1 && wh.requests[0].url === `${SANDBOX}/webhooks` && !JSON.stringify(rw).includes("example.test") && rw.recordCount === 1);

    // Static: the canary and probe never reference forbidden paths or hosts.
    const forbidden = [/\/residuals/, /oauth/i, /\/v3\//, /testap1|ap1\.payarc/, /\/upload/, /method:\s*"(POST|PATCH|DELETE|PUT)"/, /\/agent_residual\/details/];
    for (const file of ["server/services/processors/payarc-access-canary.ts", "server/services/processors/payarc-reads.ts", "server/services/processors/payarc-read-transport.ts", "scripts/probe-payarc-endpoints.ts"]) {
      const src = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
      const hits = forbidden.filter((re) => re.test(src)).map(String);
      ok(`${file}: no forbidden endpoint/host/method`, hits.length === 0, hits.join(","));
    }
  }

  (globalThis as any).fetch = realFetch;
  console.log(`\n[test-payarc-revenue-reads] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test-payarc-revenue-reads] fatal:", e);
  process.exit(1);
});
