import { storage } from "../../storage";
import { createHash } from "node:crypto";
import { assertProviderActivation } from "../provider-manifest";
import type { Cro03WorkerProviderContext } from "../cro03/provider-context";
import {
  assertCro03cAuthorityBeforeIo, assertCro03cLiveContext, type Cro03cLiveProviderContext,
} from "../cro03/live-execution";

const OUTSCRAPER_API_URL = "https://api.app.outscraper.com";

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
}

export interface Cro03cOutscraperExecutionOptions {
  /** Test-only injected transport. Production always uses global fetch. */
  readonly fetchOverride?: (url: string, init: RequestInit) => Promise<Response>;
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
  return {
    name: raw.name || raw.title || "",
    phone: normalizePhone(raw.phone || raw.phone_number),
    email: raw.email || raw.emails?.[0] || null,
    website: extractDomain(raw.site || raw.website),
    address: raw.full_address || raw.address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.postal_code || raw.zip || null,
    rating: raw.rating ? parseFloat(raw.rating) : null,
    reviewCount: raw.reviews ? parseInt(raw.reviews) : null,
    placeId: raw.place_id || raw.google_id || null,
    category: raw.category || raw.type || null,
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
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("CRO03C_PROVIDER_NOT_CONFIGURED");

  await acquireToken();
  const params = new URLSearchParams({
    query: input.query, limit: String(input.consideredResultLimit), region: input.region,
    language: "en", async: "false",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  let authorityGranted = false;
  try {
    // This must remain adjacent to the transport call: a queued/rate-limited
    // operation may have been cancelled while waiting for its token.
    await assertCro03cAuthorityBeforeIo(context);
    authorityGranted = true;
    response = await (options.fetchOverride ?? fetch)(`${OUTSCRAPER_API_URL}/maps/search-v3?${params}`, {
      method: "GET",
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (!authorityGranted) throw error;
    return ambiguousCro03cEvidence(null);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) return ambiguousCro03cEvidence(response.status);
  try {
    const data = await response.json();
    const items: unknown[] = Array.isArray(data)
      ? data.flat()
      : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
        ? (data as { data: unknown[] }).data.flat()
        : [];
    // More than the frozen requested window has an unknown billable count.
    if (items.length > input.consideredResultLimit) return ambiguousCro03cEvidence(response.status);
    const results = items
      .filter((item): item is Record<string, any> => Boolean(item && typeof item === "object" && (item as any).name))
      .map(parseOutscraperResult);
    // Outscraper prices returned results. Preserve that exact, bounded provider
    // count even when its payload contains a record our parser cannot use.
    const settledUnits = items.length;
    const settledAmountMicros = settledUnits * input.amountMicros;
    if (settledUnits > input.reservedUnits || !Number.isSafeInteger(settledAmountMicros)) {
      return ambiguousCro03cEvidence(response.status);
    }
    return {
      outcome: settledUnits ? "success" : "no_result",
      settledUnits,
      settledAmountMicros,
      billingCertainty: "certain",
      evidence: redactedCro03cEvidence(results, settledUnits, response.status),
    };
  } catch {
    return ambiguousCro03cEvidence(response.status);
  }
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
