/**
 * Payarc bounded read-only access canary (Task #1777). No database access.
 *
 * Purpose: produce REDACTED evidence of whether a specific credential class can read a specific
 * documented endpoint in ONE explicitly selected environment. It reports access separately from
 * API support:
 *   documentedSupport            the route exists in Payarc's public docs (static fact)
 *   freshAccess                  what THIS run observed (granted / entitlement_required / ...)
 *   populatedContractValidated   a non-empty response parsed through the contract parsers
 *   authorizedUse                always "not_granted" — a canary result never grants anything
 *
 * Hard rules enforced here (and by tests):
 *   - the host is a constant chosen by --environment; no env-var base URL, no cross-host guesses;
 *   - the credential's DECLARED environment (PAYARC_*_KEY_ENVIRONMENT) must equal the selected one;
 *   - one credential class per operation (no cross-key probing);
 *   - only GET requests; no OAuth exchange, token reveal, /residuals, Connect, upload, or webhook writes;
 *   - output never contains response bodies, identifiers, amounts, or credential values.
 */
import {
  PAYARC_KEY_ENV_VARS,
  PAYARC_REPORTING_BASES,
  bindCredentialEnvironment,
  defaultReadTransport,
  rateLimitPause,
  type ReadTransport,
} from "./payarc-read-transport";
import {
  MalformedPayarcResponse,
  isObject,
  parseExactJson,
  type ExactJson,
} from "./payarc-report-parsers";
import {
  held,
  isHeld,
  runBatchReports,
  runDisputeCaseList,
  runDisputeChart,
  runResidualReport,
  validateWindow,
  type ReadContext,
} from "./payarc-reads";
import type { BatchFilterPlacement, PayarcEnvironment, PayarcKeyClass } from "./payarc-report-types";
import type { HeldResult } from "./IProcessorAdapter";

export const CANARY_OPERATIONS = {
  identity: { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/accounts/me" },
  "merchant-identity": { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/accounts/me" },
  "batch-reports": { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/agent/batch/reports" },
  "batch-placement-compare": { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/agent/batch/reports (query vs body, one day)" },
  "residual-summary": { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/agent_residual/summary" },
  "residual-table-summaries": { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/residual_table_summaries" },
  "residual-details": { keyClass: "partner" as PayarcKeyClass, doc: "GET /v1/residual-details" },
  "dispute-cases": { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/cases" },
  "dispute-chart": { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/dispute-chart (aggregate)" },
  charges: { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/charges" },
  statements: { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/merchant_statements" },
  "webhooks-list": { keyClass: "merchant" as PayarcKeyClass, doc: "GET /v1/webhooks (read-only listing)" },
} as const;

export type CanaryOperation = keyof typeof CANARY_OPERATIONS;

export interface CanaryInput {
  environment: PayarcEnvironment;
  operation: CanaryOperation;
  fromDate?: string;
  toDate?: string;
  bank?: string;
  batchPlacement?: BatchFilterPlacement;
  /** Required before any production-host read. */
  allowProductionRead?: boolean;
}

export interface CanaryDeps {
  env: NodeJS.ProcessEnv;
  transport?: ReadTransport;
  sleep?: (ms: number) => Promise<void>;
}

export type FreshAccess = "granted" | "entitlement_required" | "inconclusive" | "not_attempted";

export interface CanaryReceipt {
  operation: CanaryOperation;
  keyClass: PayarcKeyClass;
  environment: PayarcEnvironment;
  host: string;
  documentedRoute: string;
  documentedSupport: true;
  freshAccess: FreshAccess;
  /** Hold/refusal code when freshAccess is not "granted". */
  code: string | null;
  detail: string | null;
  recordCount: number | null;
  topLevelKeys: string[];
  /** Field NAMES of the first record only (never values). */
  recordFieldNames: string[];
  populatedContractValidated: boolean;
  /** Extra redacted facts, e.g. batch placement outcomes. */
  notes: string[];
  authorizedUse: "not_granted";
}

function base(input: CanaryInput): CanaryReceipt {
  const spec = CANARY_OPERATIONS[input.operation];
  return {
    operation: input.operation,
    keyClass: spec.keyClass,
    environment: input.environment,
    host: new URL(PAYARC_REPORTING_BASES[input.environment]).hostname,
    documentedRoute: spec.doc,
    documentedSupport: true,
    freshAccess: "not_attempted",
    code: null,
    detail: null,
    recordCount: null,
    topLevelKeys: [],
    recordFieldNames: [],
    populatedContractValidated: false,
    notes: [],
    authorizedUse: "not_granted",
  };
}

function refuse(r: CanaryReceipt, code: string, detail: string): CanaryReceipt {
  return { ...r, freshAccess: "not_attempted", code, detail };
}

function fromHeld(r: CanaryReceipt, h: HeldResult): CanaryReceipt {
  return {
    ...r,
    freshAccess: h.code === "entitlement_required" ? "entitlement_required" : "inconclusive",
    code: h.code ?? "held",
    detail: h.reason,
  };
}

function needWindow(input: CanaryInput, maxDays: number): HeldResult | null {
  return validateWindow({ fromDate: input.fromDate ?? "", toDate: input.toDate ?? "" }, maxDays);
}

/** Plain GET used only for the few documented reads that have no typed parser (identity, charges, statements, webhooks). */
async function rawProbe(
  ctx: ReadContext,
  baseUrl: string,
  route: string,
  params: Record<string, string>,
): Promise<{ status: number; json: ExactJson | null; malformed: boolean } | { transportError: string }> {
  const transport = ctx.transport ?? defaultReadTransport;
  const qs = Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "";
  try {
    const resp = await transport({
      url: `${baseUrl}${route}${qs}`,
      headers: { Accept: "application/json", Authorization: `Bearer ${ctx.apiKey}`, "X-Source": "LibertyBancard-CRM-canary" },
      timeoutMs: 20_000,
      maxBytes: 2 * 1024 * 1024,
    });
    await rateLimitPause(resp.headers, ctx.env ?? process.env, ctx.sleep);
    let json: ExactJson | null = null;
    let malformed = false;
    if (resp.status >= 200 && resp.status < 300) {
      try {
        json = parseExactJson(resp.text);
      } catch (e) {
        if (e instanceof MalformedPayarcResponse) malformed = true;
        else throw e;
      }
    }
    return { status: resp.status, json, malformed };
  } catch (err: any) {
    return { transportError: err?.name === "AbortError" || err?.code === "ETIMEDOUT" ? "timeout" : err?.code ?? "network_error" };
  }
}

function describeJson(r: CanaryReceipt, json: ExactJson | null): CanaryReceipt {
  if (!isObject(json)) return { ...r, notes: [...r.notes, "response is not a JSON object"] };
  const data = Array.isArray(json.data) ? json.data : null;
  const first = data && isObject(data[0]) ? data[0] : isObject(json.data) ? json.data : null;
  return {
    ...r,
    topLevelKeys: Object.keys(json).sort(),
    recordCount: data ? data.length : null,
    recordFieldNames: first ? Object.keys(first).sort() : [],
  };
}

export async function runCanary(input: CanaryInput, deps: CanaryDeps): Promise<CanaryReceipt> {
  const spec = CANARY_OPERATIONS[input.operation];
  const receipt = base(input);
  if (!spec) return refuse(receipt, "unknown_operation", "operation is not one of the documented canary operations");
  if (deps.env.PAYARC_SANDBOX_LIVE !== "1") {
    return refuse(receipt, "live_not_enabled", "set PAYARC_SANDBOX_LIVE=1 to opt in to live provider reads");
  }
  if (input.environment === "production" && !input.allowProductionRead) {
    return refuse(receipt, "production_read_not_confirmed", "production reads require the explicit allowProductionRead confirmation");
  }

  const names = PAYARC_KEY_ENV_VARS[spec.keyClass];
  const apiKey = deps.env[names.key] || undefined;
  if (!apiKey) return refuse(receipt, "credential_missing", `${names.key} is not configured`);

  const binding = bindCredentialEnvironment(spec.keyClass, input.environment, deps.env);
  if (binding.status === "undeclared" || binding.status === "invalid_declaration") {
    return refuse(receipt, "environment_not_declared", `${names.environment} must be set to 'sandbox' or 'production' for a live canary`);
  }
  if (binding.status === "mismatch") {
    return refuse(
      receipt,
      "environment_mismatch",
      `${spec.keyClass} key is declared ${binding.declared} but --environment is ${binding.host}; refusing to send it`,
    );
  }

  const baseUrl = PAYARC_REPORTING_BASES[input.environment];
  const ctx: ReadContext = { keyClass: spec.keyClass, apiKey, baseUrl, env: deps.env, transport: deps.transport, sleep: deps.sleep };

  const finishTyped = (result: { evidence: { recordCount: number } } | HeldResult, extra?: Partial<CanaryReceipt>): CanaryReceipt => {
    if (isHeld(result)) return fromHeld(receipt, result);
    return {
      ...receipt,
      freshAccess: "granted",
      recordCount: result.evidence.recordCount,
      populatedContractValidated: result.evidence.recordCount > 0,
      notes: result.evidence.recordCount === 0 ? ["HTTP 200 with zero records: access shown, field mapping and reconciliation are not"] : [],
      ...extra,
    };
  };

  switch (input.operation) {
    case "batch-reports": {
      if (!input.batchPlacement) return refuse(receipt, "filter_placement_required", "choose --batch-placement query|body");
      const bad = needWindow(input, 31);
      if (bad) return fromHeld(receipt, bad);
      const res = await runBatchReports(ctx, { fromDate: input.fromDate!, toDate: input.toDate!, filterPlacement: input.batchPlacement });
      return finishTyped(res, { notes: [`filterPlacement=${input.batchPlacement}`] });
    }
    case "batch-placement-compare": {
      const bad =
        input.toDate && input.toDate !== input.fromDate
          ? held("invalid_request", "placement comparison uses one day: omit toDate or make it equal fromDate")
          : validateWindow({ fromDate: input.fromDate ?? "", toDate: input.fromDate ?? "" }, 1);
      if (bad) return fromHeld(receipt, bad);
      const notes: string[] = [];
      let anyGranted = false;
      let anyEntitlement = false;
      let anyRecords = false;
      for (const placement of ["query", "body"] as const) {
        const res = await runBatchReports(ctx, { fromDate: input.fromDate!, toDate: input.fromDate!, filterPlacement: placement });
        if (isHeld(res)) {
          notes.push(`${placement}: held (${res.code ?? "held"})`);
          if (res.code === "entitlement_required") anyEntitlement = true;
        } else {
          anyGranted = true;
          if (res.records.length > 0) anyRecords = true;
          notes.push(`${placement}: ok, ${res.records.length} batch row(s), window honored`);
        }
      }
      if (anyGranted && !anyRecords) {
        notes.push("placement NOT resolved: an empty response cannot distinguish honored filters from ignored ones");
      }
      return {
        ...receipt,
        freshAccess: anyGranted ? "granted" : anyEntitlement ? "entitlement_required" : "inconclusive",
        code: anyGranted ? null : anyEntitlement ? "entitlement_required" : "no_placement_accepted",
        populatedContractValidated: anyRecords,
        notes,
      };
    }
    case "residual-summary":
    case "residual-table-summaries":
    case "residual-details": {
      const bad = needWindow(input, 93);
      if (bad) return fromHeld(receipt, bad);
      const source =
        input.operation === "residual-summary"
          ? "agent_residual_summary"
          : input.operation === "residual-table-summaries"
            ? "residual_table_summaries"
            : "residual_details";
      const res = await runResidualReport(ctx, {
        source,
        fromDate: input.fromDate!,
        toDate: input.toDate!,
        bank: input.bank,
        limit: source === "residual_details" ? 25 : undefined,
        maxPages: 2,
      });
      if (!isHeld(res) && res.kind === "residual_summary") {
        return finishTyped(res, { notes: [`footerReconciliation=${res.footerReconciliation}`], recordCount: res.rows.length });
      }
      return finishTyped(res);
    }
    case "dispute-cases": {
      const bad = needWindow(input, 93);
      if (bad) return fromHeld(receipt, bad);
      return finishTyped(await runDisputeCaseList(ctx, { fromDate: input.fromDate!, toDate: input.toDate!, maxPages: 2 }), {
        notes: ["merchant-credential scope only; not portfolio coverage"],
      });
    }
    case "dispute-chart": {
      const bad = needWindow(input, 93);
      if (bad) return fromHeld(receipt, bad);
      return finishTyped(await runDisputeChart(ctx, { fromDate: input.fromDate!, toDate: input.toDate! }), {
        notes: ["aggregate chart metrics only; not individual cases"],
      });
    }
    default: {
      // identity, merchant-identity, charges, statements, webhooks-list
      let route = "/accounts/me";
      let params: Record<string, string> = {};
      if (input.operation === "charges") {
        route = "/charges";
        params = { limit: "1" };
      } else if (input.operation === "statements") {
        const bad = needWindow(input, 93);
        if (bad) return fromHeld(receipt, bad);
        route = "/merchant_statements";
        params = { from_date: input.fromDate!, to_date: input.toDate! };
      } else if (input.operation === "webhooks-list") {
        route = "/webhooks";
      }
      const r = await rawProbe(ctx, baseUrl, route, params);
      if ("transportError" in r) return { ...receipt, freshAccess: "inconclusive", code: "transport_error", detail: r.transportError };
      if (r.status === 401 || r.status === 403) {
        return { ...receipt, freshAccess: "entitlement_required", code: "entitlement_required", detail: `HTTP ${r.status}` };
      }
      if (r.status < 200 || r.status >= 300) {
        return { ...receipt, freshAccess: "inconclusive", code: "provider_error", detail: `HTTP ${r.status}` };
      }
      if (r.malformed) return { ...receipt, freshAccess: "inconclusive", code: "malformed_response", detail: "body is not JSON" };
      const described = describeJson({ ...receipt, freshAccess: "granted" }, r.json);
      const note =
        input.operation === "webhooks-list"
          ? "subscription listing only (counts); no create/patch/delete; subscriptions do not prove authenticity or delivery"
          : "identity/listing access only; no field mapping implied";
      return { ...described, notes: [...described.notes, note], populatedContractValidated: false };
    }
  }
}

