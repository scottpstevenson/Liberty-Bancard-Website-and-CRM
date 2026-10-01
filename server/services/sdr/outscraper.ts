import { storage } from "../../storage";
import { createHash } from "node:crypto";
import { assertProviderActivation } from "../provider-manifest";
import type { Cro03WorkerProviderContext } from "../cro03/provider-context";
import {
  assertCro03cAuthorityBeforeIo, assertCro03cLiveContext, type Cro03cLiveProviderContext,
} from "../cro03/live-execution";
import {
  parseOutscraperContacts, parseOutscraperEmails, parseOutscraperTaskReference,
  type OutscraperContact,
} from "./sfp-provider-contracts";

const OUTSCRAPER_API_URL = "https://api.outscraper.com";
const OUTSCRAPER_MAPS_SEARCH_PATH = "/maps/search";
const OUTSCRAPER_REQUEST_RESULTS_PATH = "/requests";
const OUTSCRAPER_LEADS_CONTACTS_PATH = "/leads-and-contacts";

export interface OutscraperBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  category: string | null;
  query: string | null;
  contacts: readonly OutscraperContact[];
  rawData: Record<string, any>;
}

/**
 * CRO03C's request is deliberately much narrower than the historical batch
 * search input.  A result-priced provider may not be given an open-ended
 * query, and the durable stage reservation must cover its entire result cap.
 */
export interface Cro03cFrozenOutscraperQuery {
  readonly provider: "outscraper";
  readonly query: string;
  readonly region: "US";
  readonly consideredResultLimit: number;
  readonly justification: Readonly<Record<string, unknown>>;
  readonly amountMicros: number;
  readonly reservedUnits: number;
}

export interface Cro03cOutscraperExecutionResult {
  readonly outcome: "success" | "no_result" | "ambiguous";
  readonly settledUnits: number;
  readonly settledAmountMicros: number;
  readonly billingCertainty: "certain" | "ambiguous";
  /** A receipt-safe representation; it never contains the query or contacts. */
  readonly evidence: Readonly<Record<string, unknown>>;
  /**
   * MI-05: Business-level email addresses extracted from parsed results.
   * Already filtered through the candidate selector (role-based accepted,
   * synthetic/disposable rejected). NOT placed in evidence/receipts.
   * Passed to the executor for candidate evidence write + projection.
   */
  readonly businessEmails: readonly string[];
}

export interface Cro03cOutscraperExecutionOptions {
  /** Test-only injected transport. Production always uses global fetch. */
  readonly fetchOverride?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface OutscraperSearchInput {
  businessName?: string;
  domain?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  /** Existing CRO03C callers supply their already-frozen query. */
  query?: string;
  region?: string;
  resultLimit?: number;
  /** The SFP async task lifecycle uses true; legacy/CRO03C stays synchronous. */
  async?: boolean;
}

export interface OutscraperProviderTask {
  requestId: string;
  state: "submitted" | "pending" | "completed" | "failed";
  resultsLocation?: string | null;
}

export interface OutscraperUsageReceipt {
  certainty: "exact" | "unknown";
  quantity?: string;
  unit: "credit" | "result" | "contact" | "request";
  providerReference?: string;
}

export interface OutscraperSearchResult {
  readonly status: number;
  readonly ok: boolean;
  readonly consideredResultCount: number;
  readonly results: readonly OutscraperBusiness[];
  /** Present until asynchronous provider results have been fetched and parsed. */
  readonly task?: OutscraperProviderTask | null;
  readonly billing?: OutscraperUsageReceipt;
}

export interface OutscraperSearchDependencies {
  fetchImpl?: typeof fetch;
  /** Optional generic checkpoint, invoked adjacent to the outbound request. */
  beforeRequest?: () => Promise<void>;
  /** Test seam; production records its provider-health signal by default. */
  recordCreditSignal?: (input: { httpStatus: number; message?: string | null; failure: boolean }) => Promise<void>;
  /** Persist async task attribution before control returns to the provider worker. */
  onTaskSubmitted?: (task: OutscraperProviderTask) => Promise<void>;
}

export interface OutscraperLeadsContactsResult {
  readonly status: number;
  readonly ok: boolean;
  readonly records: readonly OutscraperBusiness[];
  readonly consideredContactCount: number;
  readonly task?: OutscraperProviderTask | null;
  readonly billing: OutscraperUsageReceipt;
}

interface OutscraperUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  businessesFound: number;
  lastCallAt: string | null;
  estimatedCost: number;
}

const rateLimitState = {
  tokens: 2,
  maxTokens: 2,
  lastRefill: Date.now(),
};

function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const elapsed = now - rateLimitState.lastRefill;
      if (elapsed >= 2000) {
        rateLimitState.tokens = rateLimitState.maxTokens;
        rateLimitState.lastRefill = now;
      }
      if (rateLimitState.tokens > 0) {
        rateLimitState.tokens--;
        resolve();
      } else {
        setTimeout(tryAcquire, 500);
      }
    };
    tryAcquire();
  });
}

export function isOutscraperConfigured(): boolean {
  return !!process.env.OUTSCRAPER_API_KEY;
}

/**
 * Returns true only when Outscraper has BOTH:
 *  1. An API key configured in environment.
 *  2. An explicit paid-provider approval recorded in provider_controls
 *     (enabled=true, circuit_state != 'open').
 *
 * This satisfies the kill line: "STOP if a paid provider can run without
 * explicit approval and atomic durable budget reservation."
 */
export async function isOutscraperExplicitlyApproved(): Promise<boolean> {
  if (!isOutscraperConfigured()) return false;
  try {
    const { pool } = await import("../../db");
    const row = await pool.query(
      `SELECT enabled, circuit_state FROM provider_controls
       WHERE provider = 'outscraper' AND capability = 'search'
       LIMIT 1`
    );
    if (row.rows.length === 0) return false;
    const { enabled, circuit_state } = row.rows[0];
    return enabled === true && circuit_state !== "open";
  } catch {
    // Fail closed: if we cannot verify approval, deny.
    return false;
  }
}

async function trackOutscraperCall(success: boolean, businessesFound: number = 0) {
  try {
    const existing = await storage.getSystemSetting("outscraper_usage") as OutscraperUsageStats | null;
    const stats: OutscraperUsageStats = existing || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      businessesFound: 0,
      lastCallAt: null,
      estimatedCost: 0,
    };
    stats.totalCalls++;
    if (success) {
      stats.successfulCalls++;
      stats.businessesFound += businessesFound;
      stats.estimatedCost += businessesFound * 0.002;
    } else {
      stats.failedCalls++;
    }
    stats.lastCallAt = new Date().toISOString();
    await storage.setSystemSetting("outscraper_usage", stats);
  } catch (err) {
    console.error("[Outscraper] Usage tracking error:", err);
  }
}

export async function getOutscraperUsage(): Promise<OutscraperUsageStats> {
  const stats = await storage.getSystemSetting("outscraper_usage") as OutscraperUsageStats | null;
  return stats || {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    businessesFound: 0,
    lastCallAt: null,
    estimatedCost: 0,
  };
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 11) return digits.slice(-10);
  return digits.length >= 10 ? digits : null;
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseOutscraperResult(raw: Record<string, any>): OutscraperBusiness {
  const emails = parseOutscraperEmails(raw);
  return {
    name: raw.name || raw.title || "",
    phone: normalizePhone(raw.phone || raw.phone_number),
    email: emails[0] ?? null,
    website: extractDomain(raw.site || raw.website),
    address: raw.full_address || raw.address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.postal_code || raw.zip || null,
    rating: raw.rating ? parseFloat(raw.rating) : null,
    reviewCount: raw.reviews ? parseInt(raw.reviews) : null,
    placeId: raw.place_id || raw.google_id || null,
    category: raw.category || raw.type || null,
    query: typeof raw.query === "string" ? raw.query : null,
    contacts: parseOutscraperContacts(raw),
    rawData: raw,
  };
}

function isFrozenTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).every((child) => isFrozenTree(child, seen));
}

function assertCro03cOutscraperQuery(input: Cro03cFrozenOutscraperQuery): void {
  if (!isFrozenTree(input) || input.provider !== "outscraper" ||
      typeof input.query !== "string" || !input.query.trim() || input.query.length > 500 ||
      input.region !== "US" || !input.justification || Object.keys(input.justification).length === 0 ||
      !Number.isInteger(input.consideredResultLimit) || input.consideredResultLimit < 1 ||
      input.consideredResultLimit > 5) {
    throw new Error("CRO03C_OUTSCRAPER_INPUT_INVALID");
  }
  // A reservation smaller than the requested result window would make an
  // otherwise valid provider response impossible to settle exactly.
  if (!Number.isInteger(input.amountMicros) || input.amountMicros < 0 ||
      !Number.isInteger(input.reservedUnits) || input.reservedUnits < input.consideredResultLimit) {
    throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  }
  if (!Number.isSafeInteger(input.amountMicros * input.consideredResultLimit)) {
    throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  }
}

function redactedCro03cEvidence(
  results: readonly OutscraperBusiness[],
  consideredResultCount: number,
  status: number,
): Record<string, unknown> {
  // Email, phone, names, addresses, the original query, raw API payload, and
  // API errors must not cross the operational receipt boundary. A one-way
  // fingerprint permits duplicate/audit correlation without retaining PII.
  return {
    responseReceived: true,
    status,
    // Settlement follows the provider's bounded result count, not parser
    // yield. A malformed record cannot silently turn a billed result free.
    consideredResultCount,
    normalizedResultCount: results.length,
    resultHashes: results.map((business) => createHash("sha256").update(JSON.stringify({
      name: business.name, website: business.website, address: business.address,
      city: business.city, state: business.state, zip: business.zip, category: business.category,
      placeId: business.placeId,
    })).digest("hex")),
  };
}

function ambiguousCro03cEvidence(status: number | null): Cro03cOutscraperExecutionResult {
  return {
    outcome: "ambiguous", settledUnits: 0, settledAmountMicros: 0, billingCertainty: "ambiguous",
    evidence: { responseReceived: status !== null, status, billing: "unverifiable" },
    businessEmails: [],
  };
}

/**
 * Canonical CRO03C Outscraper adapter. It intentionally has no path through
 * Cro03WorkerProviderContext, provider_operations, or the legacy batch ledger.
 * A non-successful post-dispatch exchange is not guessed to be free: callers
 * receive an ambiguous terminal result for durable quarantine/settlement.
 */
export async function executeCro03cOutscraper(
  context: Cro03cLiveProviderContext,
  input: Cro03cFrozenOutscraperQuery,
  options: Cro03cOutscraperExecutionOptions = {},
): Promise<Cro03cOutscraperExecutionResult> {
  assertCro03cLiveContext(context);
  if (context.provider !== "outscraper" ||
      context.caller !== "server/services/cro03/live-provider-executors.ts") {
    throw new Error("CRO03C_PROVIDER_CONTEXT_DENIED");
  }
  assertCro03cOutscraperQuery(input);
  assertProviderActivation({
    sourceId: "outscraper",
    caller: "server/services/cro03/live-provider-executors.ts",
    explicitPaidApproval: true,
  });
  let authorityGranted = false;
  try {
    const response = await performOutscraperSearch({
      query: input.query, region: input.region, resultLimit: input.consideredResultLimit,
    }, {
      fetchImpl: (options.fetchOverride ?? fetch) as typeof fetch,
      // Must be checked after rate-limit wait and immediately before I/O.
      beforeRequest: async () => {
        await assertCro03cAuthorityBeforeIo(context);
        authorityGranted = true;
      },
    });
    if (!response.ok) return ambiguousCro03cEvidence(response.status);
    const items = response.consideredResultCount;
    // More than the frozen requested window has an unknown billable count.
    if (items > input.consideredResultLimit) return ambiguousCro03cEvidence(response.status);
    const results = response.results;
    // Outscraper prices returned results. Preserve that exact, bounded provider
    // count even when its payload contains a record our parser cannot use.
    const settledUnits = items;
    const settledAmountMicros = settledUnits * input.amountMicros;
    if (settledUnits > input.reservedUnits || !Number.isSafeInteger(settledAmountMicros)) {
      return ambiguousCro03cEvidence(response.status);
    }
    // MI-05: extract business emails before redaction. Selector filtering
    // happens in the executor; here we pass all non-null emails found.
    const businessEmails: string[] = results
      .map((r) => r.email ?? null)
      .filter((e): e is string => typeof e === "string" && e.length > 0);
    return {
      outcome: settledUnits ? "success" : "no_result",
      settledUnits,
      settledAmountMicros,
      billingCertainty: "certain",
      evidence: redactedCro03cEvidence(results, settledUnits, response.status),
      businessEmails,
    };
  } catch (error) {
    if (!authorityGranted) throw error;
    return ambiguousCro03cEvidence(null);
  }
}

/**
 * Outscraper transport and parsing with no SFP/CRO03C authority or persistence
 * dependency. The request may be expressed as a direct query or assembled from
 * a plain business identity and locality.
 */
export async function performOutscraperSearch(
  input: OutscraperSearchInput,
  deps: OutscraperSearchDependencies = {},
): Promise<OutscraperSearchResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("CRO03C_PROVIDER_NOT_CONFIGURED");
  const query = input.query?.trim() || [
    input.businessName, input.domain, input.city, input.county, input.state,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" ");
  const limit = input.resultLimit ?? 5;
  if (!query || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("OUTSCRAPER_INPUT_INVALID");
  }
  await acquireToken();
  const params = new URLSearchParams({
    query, limit: String(limit), region: input.region ?? "US", language: "en",
    async: input.async === true ? "true" : "false",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    await deps.beforeRequest?.();
    const response = await (deps.fetchImpl ?? fetch)(`${OUTSCRAPER_API_URL}${OUTSCRAPER_MAPS_SEARCH_PATH}?${params}`, {
      method: "GET",
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    const providerReference = providerRequestReference(response, data);
    const bodyError = outscraperBodyError(data);
    if (!response.ok || bodyError) {
      await reportOutscraperSignal(deps, { httpStatus: response.status, message: bodyError, failure: true });
      return {
        status: response.status, ok: false, consideredResultCount: 0, results: [],
        task: null, billing: { certainty: "unknown", unit: "result", providerReference },
      };
    }
    await reportOutscraperSignal(deps, { httpStatus: response.status, failure: false });
    const taskInfo = parseOutscraperTaskReference(isRecord(data) ? data : {});
    const resultsLocation = isRecord(data) && typeof data.results_location === "string"
      ? data.results_location : null;
    if (input.async === true && taskInfo.requestId) {
      if (taskInfo.state === "unknown") throw new Error("OUTSCRAPER_ASYNC_TASK_STATE_UNKNOWN");
      const task: OutscraperProviderTask = {
        requestId: taskInfo.requestId,
        state: taskInfo.state,
        resultsLocation,
      };
      await deps.onTaskSubmitted?.(task);
      return {
        status: response.status,
        ok: true,
        consideredResultCount: 0,
        results: [],
        task,
        billing: { certainty: "unknown", unit: "result", providerReference },
      };
    }
    const items = outscraperItems(data);
    const results = items
      .filter((item): item is Record<string, any> => isRecord(item) && Boolean(item.name || item.title || item.site || item.website))
      .map(parseOutscraperResult);
    return {
      status: response.status,
      ok: true,
      consideredResultCount: items.length,
      results,
      task: null,
      billing: {
        certainty: "exact",
        quantity: String(items.length),
        unit: "result",
        providerReference: taskInfo.requestId ?? providerReference,
      },
    };
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("OUTSCRAPER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Polls only Outscraper's documented request-results endpoint. The opaque ID
 * is never treated as a completed discovery result; the caller must durably
 * retain it and attribute terminal data to the original business/stage task.
 */
export async function performOutscraperTaskResults(
  requestId: string,
  deps: OutscraperSearchDependencies = {},
): Promise<OutscraperSearchResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("CRO03C_PROVIDER_NOT_CONFIGURED");
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(requestId)) throw new Error("OUTSCRAPER_TASK_REFERENCE_INVALID");
  await acquireToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    await deps.beforeRequest?.();
    const response = await (deps.fetchImpl ?? fetch)(
      `${OUTSCRAPER_API_URL}${OUTSCRAPER_REQUEST_RESULTS_PATH}/${encodeURIComponent(requestId)}`,
      { method: "GET", headers: { "X-API-KEY": apiKey, Accept: "application/json" }, signal: controller.signal },
    );
    let body: any = null;
    try { body = await response.json(); } catch { body = null; }
    const providerReference = providerRequestReference(response, body);
    const bodyError = outscraperBodyError(body);
    if (!response.ok || bodyError) {
      await reportOutscraperSignal(deps, { httpStatus: response.status, message: bodyError, failure: true });
      return {
        status: response.status, ok: false, consideredResultCount: 0, results: [],
        task: { requestId, state: "failed" },
        billing: { certainty: "unknown", unit: "result", providerReference },
      };
    }
    const terminalReported = parseOutscraperTaskReference(isRecord(body) ? body : {});
    await reportOutscraperSignal(deps, {
      httpStatus: response.status,
      message: terminalReported.state === "failed" ? "OUTSCRAPER_TASK_FAILED" : null,
      failure: terminalReported.state === "failed",
    });
    const reported = terminalReported;
    const items = outscraperItems(body);
    const terminalFailure = reported.state === "failed";
    const pending = reported.state === "pending" || reported.state === "submitted" ||
      (reported.state === "unknown" && items.length === 0);
    if (terminalFailure || pending) {
      return {
        status: response.status,
        ok: !terminalFailure,
        consideredResultCount: 0,
        results: [],
        task: {
          requestId,
          state: terminalFailure ? "failed" : "pending",
        },
        billing: { certainty: "unknown", unit: "result", providerReference },
      };
    }
    const results = items
      .filter((item): item is Record<string, any> => isRecord(item) && Boolean(item.name || item.title || item.site || item.website))
      .map(parseOutscraperResult);
    return {
      status: response.status,
      ok: true,
      consideredResultCount: items.length,
      results,
      task: { requestId, state: "completed" },
      billing: {
        certainty: "exact",
        quantity: String(items.length),
        unit: "result",
        providerReference: reported.requestId ?? providerReference ?? requestId,
      },
    };
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("OUTSCRAPER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Outscraper's documented Leads & Contacts endpoint accepts domain batches.
 * This adapter caps each request at ten domains, requests synchronous results,
 * and retains nested people/email/title attribution. It does not silently
 * claim a known price when the response has no explicit usage receipt.
 */
export async function performOutscraperLeadsAndContacts(
  domains: readonly string[],
  deps: OutscraperSearchDependencies = {},
): Promise<OutscraperLeadsContactsResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("CRO03C_PROVIDER_NOT_CONFIGURED");
  if (!Array.isArray(domains) || domains.length > 10 ||
      domains.some((domain) => typeof domain !== "string" || !extractDomain(domain)) ||
      new Set(domains.map((domain) => extractDomain(domain))).size !== domains.length) {
    throw new Error("OUTSCRAPER_DOMAIN_BATCH_INVALID");
  }
  if (domains.length === 0) {
    return {
      status: 200, ok: true, records: [], consideredContactCount: 0,
      billing: { certainty: "exact", quantity: "0", unit: "contact" },
    };
  }
  await acquireToken();
  const params = new URLSearchParams();
  for (const domain of domains) params.append("query", extractDomain(domain)!);
  params.set("contactsPerCompany", "3");
  params.set("emailsPerContact", "1");
  params.set("async", "false");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    await deps.beforeRequest?.();
    const response = await (deps.fetchImpl ?? fetch)(
      `${OUTSCRAPER_API_URL}${OUTSCRAPER_LEADS_CONTACTS_PATH}?${params}`,
      { method: "GET", headers: { "X-API-KEY": apiKey, Accept: "application/json" }, signal: controller.signal },
    );
    let body: any = null;
    try { body = await response.json(); } catch { body = null; }
    const providerReference = providerRequestReference(response, body);
    const bodyError = outscraperBodyError(body);
    if (!response.ok || bodyError) {
      await reportOutscraperSignal(deps, { httpStatus: response.status, message: bodyError, failure: true });
      return {
        status: response.status, ok: false, records: [], consideredContactCount: 0,
        billing: { certainty: "unknown", unit: "contact", providerReference },
      };
    }
    await reportOutscraperSignal(deps, { httpStatus: response.status, failure: false });
    const records = outscraperItems(body)
      .filter((item): item is Record<string, any> => isRecord(item))
      .map(parseOutscraperResult);
    const consideredContactCount = records.reduce((count, record) => count + record.contacts.length, 0);
    const explicitUsage = isRecord(body)
      ? body.credits_consumed ?? body.credits_used
      : undefined;
    const explicitNumber = typeof explicitUsage === "number" && Number.isFinite(explicitUsage) && explicitUsage >= 0
      ? String(explicitUsage)
      : typeof explicitUsage === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(explicitUsage)
        ? explicitUsage
        : null;
    return {
      status: response.status,
      ok: true,
      records,
      consideredContactCount,
      billing: {
        certainty: explicitNumber === null ? "unknown" : "exact",
        ...(explicitNumber === null ? {} : { quantity: explicitNumber }),
        unit: explicitNumber === null ? "contact" : "credit",
        providerReference,
      },
    };
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("OUTSCRAPER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function outscraperBodyError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["error", "error_message"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const status = String(value.status ?? "").trim().toLowerCase();
  return ["failed", "failure", "error", "unauthorized", "invalid_request"].includes(status)
    ? `OUTSCRAPER_${status.toUpperCase()}`
    : null;
}

function outscraperItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap((entry) => Array.isArray(entry) ? entry : [entry]);
  if (!isRecord(value)) return [];
  for (const key of ["data", "results", "result"]) {
    if (Array.isArray(value[key])) return outscraperItems(value[key]);
  }
  return [];
}

function providerRequestReference(response: Response, body: unknown): string | undefined {
  if (isRecord(body)) {
    const task = parseOutscraperTaskReference(body);
    if (task.requestId) return task.requestId;
  }
  return response.headers.get("x-request-id") ?? response.headers.get("x-outs-request-id") ?? undefined;
}

async function reportOutscraperSignal(
  deps: OutscraperSearchDependencies,
  signal: { httpStatus: number; message?: string | null; failure: boolean },
): Promise<void> {
  if (deps.recordCreditSignal) return deps.recordCreditSignal(signal);
  const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
  await recordPaidProviderCreditSignal("outscraper", signal);
}

export async function searchOutscraper(
  query: string,
  limit: number = 200,
  region: string = "US",
  authorization?: Cro03WorkerProviderContext,
  fetchOverride?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<OutscraperBusiness[]> {
  // CRO03's legacy batch factory is permanently denied. New paid execution
  // must enter through executeCro03cOutscraper with CRO03C authority.
  throw new Error("CRO03_OUTSCRAPER_LEGACY_CONTEXT_DENIED");
}

export async function searchOutscraperByVerticalMetro(
  vertical: string,
  metro: string,
  state: string = "FL",
  limit: number = 200,
  authorization?: Cro03WorkerProviderContext,
  fetchOverride?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<OutscraperBusiness[]> {
  const query = `${vertical} ${metro} ${state}`;
  return searchOutscraper(query, limit, "US", authorization, fetchOverride);
}
