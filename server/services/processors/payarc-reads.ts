/**
 * Payarc documented revenue/dispute reads (Task #1777). No database access.
 *
 * Every function:
 *  - takes an explicit key class (partner vs merchant) and the snapshot-authorized base URL;
 *  - refuses any host that is not one of the two documented reporting hosts;
 *  - refuses a credential whose DECLARED environment (PAYARC_*_KEY_ENVIRONMENT) differs from the
 *    host environment (an undeclared environment is allowed here because the activation
 *    snapshot governs the host; the access canary requires the declaration);
 *  - sends only GET requests, with bounded dates and a hard page/record ceiling;
 *  - returns HeldResult (with a machine-readable `code`) instead of partial or guessed data;
 *  - never puts response bodies or credential values into results.
 *
 * Not implemented on purpose: POST /residuals, /agent_residual/details, uploads, webhooks,
 * Connect (terminal) calls, OAuth exchanges, token-reveal endpoints.
 */
import type { HeldResult } from "./IProcessorAdapter";
import { maskMid } from "../../utils/mask-mid";
import {
  MalformedPayarcResponse,
  type ExactJson,
  datePart,
  dedupeBatchRecords,
  inWindow,
  isIsoDate,
  parseBatchRows,
  parseCaseRows,
  parseDetailRows,
  parseDisputeChart,
  parseExactJson,
  parseSummaryRows,
  parseTabularEnvelope,
  readPageMeta,
  reconcileFooter,
  requireEnvelope,
  totalBatchesByMerchant,
} from "./payarc-report-parsers";
import {
  PAYARC_KEY_ENV_VARS,
  ResponseTooLargeError,
  bindCredentialEnvironment,
  classifyReportingBase,
  defaultReadTransport,
  rateLimitPause,
  type ReadTransport,
} from "./payarc-read-transport";
import type {
  BatchReportRequest,
  BatchReportResult,
  DisputeCaseListRequest,
  DisputeCaseListResult,
  DisputeChartRequest,
  DisputeChartResult,
  PayarcEnvironment,
  PayarcKeyClass,
  PayarcReadEvidence,
  ReadWindow,
  ResidualDetailResult,
  ResidualReportRequest,
  ResidualReportResult,
  ResidualSummaryResult,
  ResidualSource,
} from "./payarc-report-types";

export interface ReadContext {
  keyClass: PayarcKeyClass;
  apiKey: string | undefined;
  /** Must come from the activation snapshot gate. */
  baseUrl: string | null | undefined;
  env?: NodeJS.ProcessEnv;
  transport?: ReadTransport;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Documented bank values. The residual-summary page shows only an example; the table-summary 422 lists these. */
export const DOCUMENTED_BANKS = ["5670", "6719", "8999", "9267", "9999"] as const;

export const MAX_WINDOW_DAYS = { batch: 31, residual: 93, disputes: 93 } as const;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CEILING = 50;
const MAX_RECORDS = 20_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function held(code: string, reason: string): HeldResult {
  return { status: "held", reason, code };
}

export function isHeld(v: unknown): v is HeldResult {
  return typeof v === "object" && v !== null && (v as HeldResult).status === "held";
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function validateWindow(w: ReadWindow, maxDays: number): HeldResult | null {
  if (!isIsoDate(w.fromDate) || !isIsoDate(w.toDate)) {
    return held("invalid_request", "fromDate and toDate must be explicit YYYY-MM-DD dates");
  }
  if (w.fromDate > w.toDate) return held("invalid_request", "fromDate must not be after toDate");
  if (daysInclusive(w.fromDate, w.toDate) > maxDays) {
    return held("window_too_large", `date window exceeds the ${maxDays}-day bound for this read`);
  }
  return null;
}

export function isoToSlash(d: string): string {
  return d.replace(/-/g, "/");
}

/** First/last day of a YYYY-MM month. */
export function monthToWindow(month: string): ReadWindow | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const mm = parseInt(m[2], 10);
  if (mm < 1 || mm > 12) return null;
  const last = new Date(Date.UTC(parseInt(m[1], 10), mm, 0)).getUTCDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, "0")}` };
}

const DIGITS = /^\d+$/;

// ─── Request execution ───────────────────────────────────────────────────────

interface Prepared {
  apiKey: string;
  baseUrl: string;
  environment: PayarcEnvironment;
  host: string;
  credentialEnvironment: "declared" | "undeclared";
}

function prepare(ctx: ReadContext, operation: string): Prepared | HeldResult {
  const env = ctx.env ?? process.env;
  const names = PAYARC_KEY_ENV_VARS[ctx.keyClass];
  if (!ctx.apiKey) {
    return held("credential_missing", `${operation}: ${names.key} (${ctx.keyClass} key) is not configured`);
  }
  if (!ctx.baseUrl) {
    return held(
      "snapshot_url_required",
      `${operation}: an activation snapshot listing this operation with an authorizedBaseUrl is required before any request`,
    );
  }
  const baseUrl = ctx.baseUrl.replace(/\/+$/, "");
  const environment = classifyReportingBase(baseUrl);
  if (!environment) {
    return held(
      "host_not_reporting",
      `${operation}: base URL is not a documented Payarc reporting host (testapi.payarc.net/v1 or api.payarc.net/v1); Connect and other hosts are refused`,
    );
  }
  const binding = bindCredentialEnvironment(ctx.keyClass, environment, env);
  if (binding.status === "invalid_declaration") {
    return held("environment_invalid", `${operation}: ${names.environment} must be 'sandbox' or 'production'`);
  }
  if (binding.status === "mismatch") {
    return held(
      "environment_mismatch",
      `${operation}: ${ctx.keyClass} key is declared ${binding.declared} but the authorized host is ${binding.host}; refusing to send it`,
    );
  }
  return {
    apiKey: ctx.apiKey,
    baseUrl,
    environment,
    host: new URL(baseUrl).hostname,
    credentialEnvironment: binding.status === "declared_match" ? "declared" : "undeclared",
  };
}

function httpHeld(status: number, operation: string, route: string, bodyText = ""): HeldResult {
  if (status === 401 || status === 403) {
    return held(
      "entitlement_required",
      `${operation}: HTTP ${status} on ${route} — Payarc has not enabled this endpoint for this credential (account entitlement, not a code failure)`,
    );
  }
  if (status === 404) return held("route_not_found", `${operation}: HTTP 404 on ${route}`);
  if (status === 405) return held("method_not_allowed", `${operation}: HTTP 405 on ${route} — the documented method was refused`);
  if (status === 422) {
    // Fixed phrase only; the provider body is never echoed.
    if (/(don.?t\s+have\s+any|no)\s+merchants\s+attached/i.test(bodyText)) {
      return held(
        "no_merchants_attached",
        `${operation}: HTTP 422 on ${route} — Payarc reports no merchants are attached to this agent account (no data yet, not a parameter or permission error)`,
      );
    }
    return held("provider_rejected_parameters", `${operation}: HTTP 422 on ${route} — the provider rejected the request parameters`);
  }
  if (status === 429) return held("rate_limited", `${operation}: HTTP 429 on ${route}`);
  return held("provider_error", `${operation}: HTTP ${status} on ${route}`);
}

type Obj = Record<string, ExactJson>;

async function getEnvelope(
  prep: Prepared,
  ctx: ReadContext,
  operation: string,
  route: string,
  params: Record<string, string>,
  placement: "query" | "body",
): Promise<Obj | HeldResult> {
  const transport = ctx.transport ?? defaultReadTransport;
  const env = ctx.env ?? process.env;
  const qs = placement === "query" && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "";
  let resp;
  try {
    resp = await transport({
      url: `${prep.baseUrl}${route}${qs}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${prep.apiKey}`,
        "X-Source": "LibertyBancard-CRM",
      },
      jsonBody: placement === "body" ? params : undefined,
      timeoutMs: ctx.timeoutMs ?? 20_000,
      maxBytes: ctx.maxBytes ?? 8 * 1024 * 1024,
    });
  } catch (err: any) {
    if (err instanceof ResponseTooLargeError) {
      return held("response_too_large", `${operation}: response on ${route} exceeded the byte ceiling (filters may be ignored)`);
    }
    const label = err?.name === "AbortError" || err?.code === "ETIMEDOUT" ? "timeout" : err?.code ?? "network_error";
    return held("transport_error", `${operation}: request to ${route} failed (${label})`);
  }
  await rateLimitPause(resp.headers, env, ctx.sleep);
  if (resp.status < 200 || resp.status >= 300) return httpHeld(resp.status, operation, route, resp.text);
  try {
    return requireEnvelope(parseExactJson(resp.text), operation) as Obj;
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${operation}: ${err.message}`);
    throw err;
  }
}

function evidence(
  prep: Prepared,
  operation: string,
  keyClass: PayarcKeyClass,
  pagesFetched: number,
  recordCount: number,
): PayarcReadEvidence {
  return {
    operation,
    keyClass,
    environment: prep.environment,
    host: prep.host,
    credentialEnvironment: prep.credentialEnvironment,
    pagesFetched,
    recordCount,
  };
}

interface CollectOptions {
  operation: string;
  route: string;
  baseParams: Record<string, string>;
  placement: "query" | "body";
  /** Page size sent as `limit`; when undefined no limit/size heuristics apply. */
  limit?: number;
  /** What to do with a full page that carries no pagination metadata. */
  fullPageWithoutMeta: "continue" | "hold";
  maxPages: number;
  extractRows: (env: Obj) => unknown[];
}

async function collectPages(
  prep: Prepared,
  ctx: ReadContext,
  o: CollectOptions,
): Promise<{ envelopes: Obj[]; rowCount: number; reportedTotal: number | null } | HeldResult> {
  const envelopes: Obj[] = [];
  let rowCount = 0;
  let previousSignature: string | null = null;
  let reportedTotal: number | null = null;
  for (let page = 1; page <= o.maxPages; page++) {
    const params: Record<string, string> = { ...o.baseParams };
    if (o.limit !== undefined) params.limit = String(o.limit);
    if (page > 1) params.page = String(page);
    const env = await getEnvelope(prep, ctx, o.operation, o.route, params, o.placement);
    if (isHeld(env)) return env;
    let rows: unknown[];
    try {
      rows = o.extractRows(env);
    } catch (err) {
      if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${o.operation}: ${err.message}`);
      throw err;
    }
    const meta = readPageMeta(env);
    if (meta.currentPage !== null && meta.currentPage !== page) {
      return held(
        "pagination_no_progress",
        `${o.operation}: requested page ${page} but the provider reported page ${meta.currentPage}`,
      );
    }
    const signature = JSON.stringify(rows, (_k, v) => (v && typeof v === "object" && "text" in v && Object.keys(v).length === 1 ? v.text : v));
    if (page > 1 && rows.length > 0 && signature === previousSignature) {
      return held("pagination_no_progress", `${o.operation}: page ${page} repeated page ${page - 1}`);
    }
    previousSignature = signature;
    envelopes.push(env);
    rowCount += rows.length;
    if (rowCount > MAX_RECORDS) return held("pagination_ceiling", `${o.operation}: more than ${MAX_RECORDS} records returned`);
    if (meta.total !== null) reportedTotal = meta.total;

    if (meta.totalPages !== null) {
      if (page >= meta.totalPages) break;
    } else if (o.limit !== undefined && rows.length >= o.limit) {
      if (o.fullPageWithoutMeta === "hold") {
        return held(
          "pagination_unverified",
          `${o.operation}: a full page returned with no pagination metadata; completeness cannot be shown`,
        );
      }
    } else {
      break;
    }
    if (page === o.maxPages) {
      return held("pagination_ceiling", `${o.operation}: page ceiling (${o.maxPages}) reached before the last page`);
    }
  }
  if (reportedTotal !== null && reportedTotal !== rowCount) {
    return held(
      "pagination_incomplete",
      `${o.operation}: collected ${rowCount} records but the provider reported ${reportedTotal}`,
    );
  }
  return { envelopes, rowCount, reportedTotal };
}

function clampPages(n: number | undefined): number {
  return Math.min(Math.max(n ?? DEFAULT_MAX_PAGES, 1), MAX_PAGES_CEILING);
}

// ─── Batch reports (partner key) ─────────────────────────────────────────────

export async function runBatchReports(ctx: ReadContext, req: BatchReportRequest): Promise<BatchReportResult | HeldResult> {
  const op = "get_batch_reports";
  if (ctx.keyClass !== "partner") return held("wrong_key_class", `${op}: batch reports use the partner key`);
  if (req.filterPlacement !== "query" && req.filterPlacement !== "body") {
    return held(
      "filter_placement_unverified",
      `${op}: the provider docs place from_date/to_date in a GET body but their code sample uses query parameters; select filterPlacement explicitly`,
    );
  }
  const bad = validateWindow(req, MAX_WINDOW_DAYS.batch);
  if (bad) return bad;
  if (req.merchantAccountNumber !== undefined && !DIGITS.test(req.merchantAccountNumber)) {
    return held("invalid_request", `${op}: merchantAccountNumber must be digits only`);
  }
  const prep = prepare(ctx, op);
  if (isHeld(prep)) return prep;

  const collected = await collectPages(prep, ctx, {
    operation: op,
    route: "/agent/batch/reports",
    baseParams: { from_date: req.fromDate, to_date: req.toDate },
    placement: req.filterPlacement,
    fullPageWithoutMeta: "continue",
    maxPages: clampPages(req.maxPages),
    extractRows: (env) => {
      if (!Array.isArray(env.data)) throw new MalformedPayarcResponse("batch report: data is not an array");
      return env.data;
    },
  });
  if (isHeld(collected)) return collected;

  let all;
  try {
    all = collected.envelopes.flatMap((e) => parseBatchRows(e));
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${op}: ${err.message}`);
    throw err;
  }
  const outside = all.filter((r) => !inWindow(r.settlementDate, req.fromDate, req.toDate)).length;
  if (outside > 0) {
    return held(
      "filters_ignored",
      `${op}: ${outside} of ${all.length} rows fall outside the requested window — the provider did not honor ${req.filterPlacement}-placed date filters`,
    );
  }
  let deduped;
  try {
    deduped = dedupeBatchRecords(all);
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${op}: ${err.message}`);
    throw err;
  }
  const bound = req.merchantAccountNumber ?? null;
  const records = bound ? deduped.records.filter((r) => r.merchantAccountNumber === bound) : deduped.records;
  return {
    kind: "agent_batch_report",
    window: { fromDate: req.fromDate, toDate: req.toDate },
    filterPlacement: req.filterPlacement,
    records,
    merchantTotals: totalBatchesByMerchant(records),
    duplicatesIgnored: deduped.duplicatesIgnored,
    otherMerchantRowsExcluded: deduped.records.length - records.length,
    boundMerchantAccountNumber: bound,
    monetaryUnits: "provider_unspecified",
    evidence: evidence(prep, op, "partner", collected.envelopes.length, records.length),
  };
}

// ─── Residuals (partner key) ─────────────────────────────────────────────────

const RESIDUAL_ROUTES: Record<ResidualSource, { route: string; operation: string }> = {
  agent_residual_summary: { route: "/agent_residual/summary", operation: "get_residual_summary" },
  residual_table_summaries: { route: "/residual_table_summaries", operation: "get_residual_table_summaries" },
  residual_details: { route: "/residual-details", operation: "get_residual_details" },
};

/** Snapshot operation name that authorizes each residual source. */
export function residualOperationFor(source: ResidualSource): string {
  return RESIDUAL_ROUTES[source].operation;
}

export async function runResidualReport(ctx: ReadContext, req: ResidualReportRequest): Promise<ResidualReportResult | HeldResult> {
  const route = RESIDUAL_ROUTES[req.source];
  if (!route) return held("invalid_request", "unknown residual source");
  const op = route.operation;
  if (ctx.keyClass !== "partner") return held("wrong_key_class", `${op}: residual reads use the partner key`);
  const bad = validateWindow(req, MAX_WINDOW_DAYS.residual);
  if (bad) return bad;

  if (req.source === "agent_residual_summary") {
    if (!req.bank) return held("bank_required", `${op}: bank is required by GET /agent_residual/summary; supply Liberty's bank value`);
    if (req.agentId !== undefined) {
      return held("agent_filter_unsupported", `${op}: /agent_residual/summary documents no agent filter; the credential's agent scope applies`);
    }
  }
  if (req.bank !== undefined && !(DOCUMENTED_BANKS as readonly string[]).includes(req.bank)) {
    return held("invalid_request", `${op}: bank is not one of the documented bank numbers (${DOCUMENTED_BANKS.join(", ")})`);
  }
  if (req.mid !== undefined && !DIGITS.test(req.mid)) return held("invalid_request", `${op}: mid must be digits only (string, leading zeros preserved)`);
  if (req.agentId !== undefined && !DIGITS.test(req.agentId)) return held("invalid_request", `${op}: agentId must be digits only`);
  if (req.limit !== undefined && (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > MAX_LIMIT)) {
    return held("invalid_request", `${op}: limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  const prep = prepare(ctx, op);
  if (isHeld(prep)) return prep;

  const params: Record<string, string> = { from_date: req.fromDate, to_date: req.toDate };
  if (req.bank) params.bank = req.bank;
  if (req.source === "agent_residual_summary") {
    if (req.mid) params.mid = req.mid;
  } else {
    if (req.mid) params.tsys_mid = req.mid;
    if (req.agentId) params.agent_id = req.agentId;
  }
  const window = { fromDate: req.fromDate, toDate: req.toDate };

  try {
    if (req.source === "residual_details") {
      const limit = req.limit ?? DEFAULT_LIMIT;
      const collected = await collectPages(prep, ctx, {
        operation: op,
        route: route.route,
        baseParams: params,
        placement: "query",
        limit,
        fullPageWithoutMeta: "hold",
        maxPages: clampPages(req.maxPages),
        extractRows: (env) => parseTabularEnvelope(env, op).rows,
      });
      if (isHeld(collected)) return collected;
      const rows = collected.envelopes.flatMap((e) => parseDetailRows(parseTabularEnvelope(e, op).rows, op));
      const outside = rows.filter((r) => !inWindow(datePart(r.reportDate)!, req.fromDate, req.toDate)).length;
      if (outside > 0) {
        return held("filters_ignored", `${op}: ${outside} of ${rows.length} line items fall outside the requested window`);
      }
      if (req.mid && rows.some((r) => r.merchantId !== req.mid)) {
        return held("mid_binding_mismatch", `${op}: returned rows do not all carry the requested MID ${maskMid(req.mid)}`);
      }
      const result: ResidualDetailResult = {
        kind: "residual_fee_line_items",
        source: "residual_details",
        semantics: "fee_line_items",
        window,
        rows,
        providerTotalReported: collected.reportedTotal,
        requestedAgentId: req.agentId ?? null,
        rowsWithDifferentAgent: req.agentId ? rows.filter((r) => r.agentId !== null && r.agentId !== req.agentId).length : 0,
        boundMid: req.mid ?? null,
        bank: req.bank ?? null,
        monetaryUnits: "decimal_as_published",
        overlapPolicy: "single_source_only",
        evidence: evidence(prep, op, "partner", collected.envelopes.length, rows.length),
      };
      return result;
    }

    // Summary routes: a single, unpaginated request.
    const env = await getEnvelope(prep, ctx, op, route.route, params, "query");
    if (isHeld(env)) return env;
    const meta = readPageMeta(env);
    if (meta.totalPages !== null && meta.totalPages > 1) {
      return held("pagination_unsupported", `${op}: the response reports ${meta.totalPages} pages but this route documents no pagination`);
    }
    const table = parseTabularEnvelope(env, op);
    const rows = parseSummaryRows(table.rows, op);
    const dated = rows.filter((r) => r.residualDate !== null);
    if (dated.some((r) => !inWindow(datePart(r.residualDate)!, req.fromDate, req.toDate))) {
      return held("filters_ignored", `${op}: some rows fall outside the requested window`);
    }
    if (req.mid && rows.some((r) => r.mid !== req.mid)) {
      return held("mid_binding_mismatch", `${op}: returned rows do not all carry the requested MID ${maskMid(req.mid)}`);
    }
    const rec = reconcileFooter(rows, table.footer, op);
    const result: ResidualSummaryResult = {
      kind: "residual_summary",
      source: req.source,
      semantics: "merchant_aggregate",
      window,
      rows,
      footer: rec.footer,
      footerReconciliation: rec.status,
      boundMid: req.mid ?? null,
      bank: req.bank ?? null,
      monetaryUnits: "decimal_as_published",
      overlapPolicy: "single_source_only",
      evidence: evidence(prep, op, "partner", 1, rows.length),
    };
    return result;
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${op}: ${err.message}`);
    throw err;
  }
}

// ─── Disputes (merchant key) ─────────────────────────────────────────────────

export async function runDisputeCaseList(ctx: ReadContext, req: DisputeCaseListRequest): Promise<DisputeCaseListResult | HeldResult> {
  const op = "get_disputes";
  if (ctx.keyClass !== "merchant") return held("wrong_key_class", `${op}: case listing uses the merchant key`);
  const bad = validateWindow(req, MAX_WINDOW_DAYS.disputes);
  if (bad) return bad;
  if (req.mid !== undefined && !DIGITS.test(req.mid)) return held("invalid_request", `${op}: mid must be digits only`);
  const prep = prepare(ctx, op);
  if (isHeld(prep)) return prep;

  const collected = await collectPages(prep, ctx, {
    operation: op,
    route: "/cases",
    baseParams: { "report_date[gte]": isoToSlash(req.fromDate), "report_date[lte]": isoToSlash(req.toDate) },
    placement: "query",
    limit: DEFAULT_LIMIT,
    fullPageWithoutMeta: "continue",
    maxPages: clampPages(req.maxPages),
    extractRows: (env) => {
      if (!Array.isArray(env.data)) throw new MalformedPayarcResponse("case list: data is not an array");
      return env.data;
    },
  });
  if (isHeld(collected)) return collected;
  let records;
  try {
    records = collected.envelopes.flatMap((e) => parseCaseRows(e));
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${op}: ${err.message}`);
    throw err;
  }
  const dated = records.filter((r) => datePart(r.reportDate) !== null);
  if (dated.some((r) => !inWindow(datePart(r.reportDate)!, req.fromDate, req.toDate))) {
    return held("filters_ignored", `${op}: some cases fall outside the requested report_date window`);
  }
  if (new Set(records.map((r) => r.providerCaseId)).size !== records.length) {
    return held("malformed_response", `${op}: duplicate provider case ids in one listing`);
  }
  if (req.mid) {
    if (records.some((r) => r.merchantNumber === null)) {
      return held("mid_binding_unverifiable", `${op}: some cases carry no merchant_number, so they cannot be bound to MID ${maskMid(req.mid)}`);
    }
    if (records.some((r) => r.merchantNumber !== req.mid)) {
      return held("mid_binding_mismatch", `${op}: cases carry a merchant_number different from the requested MID ${maskMid(req.mid)}`);
    }
  }
  return {
    kind: "dispute_case_list",
    credentialScope: "merchant_credential_account",
    portfolioCoverage: false,
    window: { fromDate: req.fromDate, toDate: req.toDate },
    records,
    boundMid: req.mid ?? null,
    monetaryUnits: "provider_unspecified",
    evidence: evidence(prep, op, "merchant", collected.envelopes.length, records.length),
  };
}

export async function runDisputeChart(ctx: ReadContext, req: DisputeChartRequest): Promise<DisputeChartResult | HeldResult> {
  const op = "get_dispute_chart";
  if (ctx.keyClass !== "merchant") return held("wrong_key_class", `${op}: the dispute chart uses the merchant key`);
  const bad = validateWindow(req, MAX_WINDOW_DAYS.disputes);
  if (bad) return bad;
  const prep = prepare(ctx, op);
  if (isHeld(prep)) return prep;
  const env = await getEnvelope(
    prep,
    ctx,
    op,
    "/dispute-chart",
    { "report_date[gte]": isoToSlash(req.fromDate), "report_date[lte]": isoToSlash(req.toDate) },
    "query",
  );
  if (isHeld(env)) return env;
  try {
    const parsed = parseDisputeChart(env);
    return {
      kind: "dispute_chart_aggregate",
      aggregateOnly: true,
      credentialScope: "merchant_credential_account",
      window: { fromDate: req.fromDate, toDate: req.toDate },
      ...parsed,
      monetaryUnits: "provider_unspecified",
      evidence: evidence(prep, op, "merchant", 1, parsed.statusBreakdown.length + parsed.countSeries.length),
    };
  } catch (err) {
    if (err instanceof MalformedPayarcResponse) return held("malformed_response", `${op}: ${err.message}`);
    throw err;
  }
}

