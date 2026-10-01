import { storage } from "../../storage";
import { assertProviderActivation } from "../provider-manifest";
import {
  assertCurrentWorkerContext, type Cro03WorkerProviderContext,
} from "../cro03/provider-context";
import {
  assertCro03cAuthorityBeforeIo,
  assertCro03cLiveContext,
  type Cro03cLiveProviderContext,
} from "../cro03/live-execution";
import {
  addExactNonNegativeDecimals, apolloPersonMatchesEmployerScope,
  parseApolloUsageReceipt, type ApolloEmployerScope,
} from "./sfp-provider-contracts";

const APOLLO_API_URL = "https://api.apollo.io";
const APOLLO_ORG_SEARCH_PATH = "/api/v1/mixed_companies/search";
const APOLLO_PEOPLE_SEARCH_PATH = "/api/v1/mixed_people/api_search";
const APOLLO_BULK_PEOPLE_ENRICHMENT_PATH = "/api/v1/people/bulk_match";
const APOLLO_PEOPLE_REVEAL_PATH = "/api/v1/people/match";
const CRO03C_APOLLO_CALLER = "server/services/cro03/live-provider-executors.ts";

export interface ApolloBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  category: string | null;
  rawData: Record<string, any>;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  ownerTitle: string | null;
}

/**
 * Frozen identity values used to resolve an Apollo organization.  These are
 * comparison inputs only: no value returned by Apollo is allowed to replace
 * them unless the caller has separately accepted a successful resolution.
 */
export interface ApolloFrozenOrganizationIdentity {
  domain?: string | null;
  legalName?: string | null;
  dbaName?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
}

export interface ApolloOrganizationAlternative {
  organizationId: string;
  organization: ApolloBusiness;
}

export interface ApolloOrganizationResolutionSuccess {
  outcome: "success";
  organizationId: string;
  organization: ApolloBusiness;
  people: ApolloBusiness[];
  alternatives: ApolloOrganizationAlternative[];
}

export interface ApolloOrganizationResolutionNoResult {
  outcome: "no_result";
  alternatives: ApolloOrganizationAlternative[];
}

export interface ApolloOrganizationResolutionAmbiguous {
  outcome: "ambiguous";
  alternatives: ApolloOrganizationAlternative[];
}

/**
 * A resolver deliberately has no projected fields for non-success outcomes.
 * Consumers must therefore not accidentally treat the first search result as
 * an enrichment candidate.
 */
export type ApolloOrganizationResolution =
  | ApolloOrganizationResolutionSuccess
  | ApolloOrganizationResolutionNoResult
  | ApolloOrganizationResolutionAmbiguous;

export type ApolloFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface ApolloDispatchedRequest {
  response: Response;
  operationId?: string | null;
  operationIds?: readonly string[];
  ambiguousOperationIds?: readonly string[];
}
export type ApolloRequestDispatch = (
  url: string,
  init: RequestInit,
  employerScope?: ApolloEmployerScope,
) => Promise<ApolloDispatchedRequest>;

export interface ApolloSearchInput extends ApolloFrozenOrganizationIdentity {
  /** Maximum integer number of targeted people to return, independent of credits used. */
  resultCap?: number;
}

export type ApolloSearchResult = Cro03cApolloExecution;

export interface ApolloSearchDependencies {
  fetchImpl?: typeof fetch;
  /** Optional generic checkpoint, invoked adjacent to every outbound request. */
  beforeRequest?: () => Promise<void>;
  /** SFP dispatches each actual HTTP request through its own durable operation. */
  dispatchRequest?: ApolloRequestDispatch;
  /** Test seam; production records its provider-health signal by default. */
  recordCreditSignal?: (input: { httpStatus: number; message?: string | null; failure: boolean }) => Promise<void>;
}

export interface ApolloBusinessEmailEnrichmentDependencies {
  fetchImpl?: typeof fetch;
  /** Optional generic checkpoint, invoked adjacent to every outbound request. */
  beforeRequest?: () => Promise<void>;
  /** SFP dispatches each actual HTTP request through its own durable operation. */
  dispatchRequest?: ApolloRequestDispatch;
  /** Test seam; production records its provider-health signal by default. */
  recordCreditSignal?: (input: { httpStatus: number; message?: string | null; failure: boolean }) => Promise<void>;
}

type ApolloRetryError = Error & {
  apolloOperationIds?: readonly string[];
  apolloAmbiguousOperationIds?: readonly string[];
};

function isApolloTimeout(error: any): boolean {
  return error?.name === "AbortError" || error?.message === "APOLLO_TIMEOUT";
}

/**
 * Raw fetch has no SDK retry policy, but a timeout can leave a paid request
 * ambiguous. Permit one explicit retry only through the governed dispatch
 * boundary; every retry receives a new child operation there.
 */
async function dispatchApolloRequestWithTimeoutRetry(input: {
  url: string;
  init: RequestInit;
  dependencies: {
    fetchImpl?: typeof fetch;
    beforeRequest?: () => Promise<void>;
    dispatchRequest?: ApolloRequestDispatch;
  };
  employerScope?: ApolloEmployerScope;
}): Promise<ApolloDispatchedRequest> {
  const attemptOperationIds: string[] = [];
  const ambiguousOperationIds: string[] = [];
  const addOperationIds = (values: readonly string[] | undefined) => {
    for (const id of values ?? []) if (id && !attemptOperationIds.includes(id)) attemptOperationIds.push(id);
  };
  const dispatchAttempts = input.dependencies.dispatchRequest ? 2 : 1;
  for (let attempt = 0; attempt < dispatchAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      await acquireToken();
      await input.dependencies.beforeRequest?.();
      const init = { ...input.init, signal: controller.signal };
      const dispatched = input.dependencies.dispatchRequest
        ? await input.dependencies.dispatchRequest(input.url, init, input.employerScope)
        : {
          response: await (input.dependencies.fetchImpl ?? fetch)(input.url, init),
          operationId: null,
        };
      addOperationIds(dispatched.operationIds);
      if (dispatched.operationId) addOperationIds([dispatched.operationId]);
      for (const id of dispatched.ambiguousOperationIds ?? []) {
        if (id && !ambiguousOperationIds.includes(id)) ambiguousOperationIds.push(id);
      }
      return {
        ...dispatched,
        operationIds: [...attemptOperationIds],
        ambiguousOperationIds: [...ambiguousOperationIds],
      };
    } catch (error: any) {
      addOperationIds(error?.apolloOperationIds);
      for (const id of error?.apolloAmbiguousOperationIds ?? []) {
        if (id && !ambiguousOperationIds.includes(id)) ambiguousOperationIds.push(id);
      }
      const retryError = (error instanceof Error ? error : new Error(String(error))) as ApolloRetryError;
      retryError.apolloOperationIds = [...attemptOperationIds];
      retryError.apolloAmbiguousOperationIds = [...ambiguousOperationIds];
      if (attempt === 0 && input.dependencies.dispatchRequest && isApolloTimeout(error)) continue;
      throw retryError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("APOLLO_TRANSPORT_ATTEMPTS_EXHAUSTED");
}

/** A response-safe projection: provider payloads are never durable evidence. */
export type ApolloRedactedBusiness = Omit<ApolloBusiness, "rawData">;

export interface ApolloCreditCertainty {
  certainty: "exact" | "unknown";
  /** Apollo-reported exact decimal quantity; never rounded to integer credits. */
  billedCredits?: string;
  /** Compatibility projection; may be fractional and is not a work count. */
  creditedUnits?: number;
  providerReference?: string;
  providerReferences?: readonly string[];
}

export type Cro03cApolloExecution =
  | {
    outcome: "success";
    organizationId: string;
    organization: ApolloRedactedBusiness;
    people: Array<ApolloRedactedBusiness & {
      personOperationId?: string | null;
      emailEnrichmentOperationId?: string | null;
    }>;
    /** Apollo person IDs, parallel-indexed to people, for business-only enrichment. */
    personIds: string[];
    organizationOperationId?: string | null;
    personOperationIds?: readonly (string | null)[];
    emailEnrichmentOperationId?: string | null;
    requestOperationIds?: readonly string[];
    billing: ApolloCreditCertainty;
  }
  | {
    outcome: "no_result";
    requestOperationIds?: readonly string[];
    billing: ApolloCreditCertainty;
  }
  | {
    /** Identity ambiguity or an incomplete provider exchange; billing is separate. */
    outcome: "ambiguous";
    requestOperationIds?: readonly string[];
    billing: ApolloCreditCertainty;
  };

export interface ApolloBusinessEmailEnrichmentResult {
  outcome: "success" | "no_result" | "ambiguous";
  people: Array<{ personId: string; email: string | null }>;
  requestOperationId?: string | null;
  requestOperationIds?: readonly string[];
  billing: ApolloCreditCertainty;
}

interface ApolloUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  contactsFound: number;
  lastCallAt: string | null;
  estimatedCost: number;
}

const rateLimitState = {
  lastCallAt: 0,
  minIntervalMs: 1100,
};

function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const elapsed = now - rateLimitState.lastCallAt;
      if (elapsed >= rateLimitState.minIntervalMs) {
        rateLimitState.lastCallAt = now;
        resolve();
      } else {
        setTimeout(tryAcquire, rateLimitState.minIntervalMs - elapsed);
      }
    };
    tryAcquire();
  });
}

export function isApolloConfigured(): boolean {
  return !!process.env.APOLLO_API_KEY;
}

async function trackApolloCall(success: boolean, contactsFound: number = 0) {
  try {
    const existing = await storage.getSystemSetting("apollo_usage") as ApolloUsageStats | null;
    const stats: ApolloUsageStats = existing || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      contactsFound: 0,
      lastCallAt: null,
      estimatedCost: 0,
    };
    stats.totalCalls++;
    if (success) {
      stats.successfulCalls++;
      stats.contactsFound += contactsFound;
      stats.estimatedCost += contactsFound * 0.10;
    } else {
      stats.failedCalls++;
    }
    stats.lastCallAt = new Date().toISOString();
    await storage.setSystemSetting("apollo_usage", stats);
  } catch (err) {
    console.error("[Apollo] Usage tracking error:", err);
  }
}

export async function getApolloUsage(): Promise<ApolloUsageStats> {
  const stats = await storage.getSystemSetting("apollo_usage") as ApolloUsageStats | null;
  return stats || {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    contactsFound: 0,
    lastCallAt: null,
    estimatedCost: 0,
  };
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

function extractFirstPhone(phoneNumbers: any[]): string | null {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;
  const primary = phoneNumbers.find(p => p.type === "work" || p.type === "direct_phone") || phoneNumbers[0];
  return normalizePhone(primary?.sanitized_number || primary?.raw_number);
}

function normalizeIdentityValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

function organizationId(raw: Record<string, any>): string | null {
  const id = raw.id ?? raw.organization_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function organizationNames(raw: Record<string, any>): string[] {
  const names = [
    raw.name, raw.legal_name, raw.legalName, raw.dba_name, raw.dbaName,
    ...(Array.isArray(raw.alternate_names) ? raw.alternate_names : []),
    ...(Array.isArray(raw.aliases) ? raw.aliases : []),
  ];
  return names
    .map((name) => typeof name === "string" ? normalizeIdentityValue(name) : null)
    .filter((name): name is string => Boolean(name));
}

function isExactFrozenOrganizationMatch(
  raw: Record<string, any>,
  identity: Required<Pick<ApolloFrozenOrganizationIdentity, "domain" | "legalName" | "dbaName" | "city" | "state" | "address">>,
): boolean {
  const candidateDomain = extractDomain(raw.primary_domain || raw.website_url);
  const hasDomainMatch = Boolean(identity.domain && candidateDomain === identity.domain);
  const names = organizationNames(raw);
  const hasNameMatch = Boolean(
    (identity.legalName && names.includes(identity.legalName))
    || (identity.dbaName && names.includes(identity.dbaName)),
  );

  // A location is an additional exact constraint, not a fuzzy score.
  if (!hasDomainMatch && !hasNameMatch) return false;
  if (identity.city && normalizeIdentityValue(raw.city) !== identity.city) return false;
  if (identity.state && normalizeIdentityValue(raw.state) !== identity.state) return false;
  if (identity.address && normalizeIdentityValue(raw.street_address ?? raw.address) !== identity.address) return false;
  return true;
}

function normalizedFrozenIdentity(identity: ApolloFrozenOrganizationIdentity) {
  return {
    domain: extractDomain(identity.domain),
    legalName: normalizeIdentityValue(identity.legalName),
    dbaName: normalizeIdentityValue(identity.dbaName),
    city: normalizeIdentityValue(identity.city),
    state: normalizeIdentityValue(identity.state),
    address: normalizeIdentityValue(identity.address),
  };
}

function apolloHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "X-Api-Key": process.env.APOLLO_API_KEY || "",
  };
}

async function postApollo(
  path: string,
  body: Record<string, unknown>,
  fetchOverride: ApolloFetch,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetchOverride(`${APOLLO_API_URL}${path}`, {
      method: "POST",
      headers: apolloHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
    if (!response.ok) {
      await recordPaidProviderCreditSignal("apollo", { httpStatus: response.status, failure: true });
      throw new Error(`APOLLO_HTTP_${response.status}`);
    }
    const parsed = await response.json();
    const bodyError = apolloBodyErrorMessage(parsed);
    await recordPaidProviderCreditSignal("apollo", {
      httpStatus: response.status, message: bodyError, failure: Boolean(bodyError),
    });
    return parsed;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("APOLLO_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Apollo returns HTTP 200 for some auth/billing failures (e.g. an expired
 * plan or exhausted credits surfaced as a body-level error rather than a
 * non-2xx status). Surface that so it isn't mistaken for a successful call.
 */
function apolloBodyErrorMessage(body: Record<string, any> | null | undefined): string | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body.error ?? body.error_message ?? body.message;
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  return candidate.trim();
}

function redactedApolloBusiness(value: ApolloBusiness): ApolloRedactedBusiness {
  const { rawData: _rawData, ...evidence } = value;
  return evidence;
}

/**
 * Apollo does not publish one universal credit receipt field. Only these
 * explicit receipt fields count; rate-limit headers and inferred result counts
 * deliberately do not. Decimal `credits_consumed` values remain exact.
 */
function apolloCreditReceipt(response: Response, body: Record<string, any>): ApolloCreditCertainty {
  const receipt = parseApolloUsageReceipt(response.headers, body);
  if (receipt.certainty !== "exact" || receipt.quantity === undefined) {
    return { certainty: "unknown", providerReference: receipt.providerReference };
  }
  const creditedUnits = Number(receipt.quantity);
  if (!Number.isFinite(creditedUnits) || creditedUnits < 0 || !Number.isSafeInteger(Math.trunc(creditedUnits))) {
    return { certainty: "unknown", providerReference: receipt.providerReference };
  }
  return {
    certainty: "exact",
    billedCredits: receipt.quantity,
    creditedUnits,
    providerReference: receipt.providerReference,
  };
}

async function postApolloForCro03c(
  context: Cro03cLiveProviderContext,
  path: string,
  body: Record<string, unknown>,
  fetchOverride: ApolloFetch,
): Promise<{ body: Record<string, any>; billing: ApolloCreditCertainty; ok: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    // Keep this adjacent to fetch: authority is checked for each individual
    // request, including each frozen-identity query and the people lookup.
    await assertCro03cAuthorityBeforeIo(context);
    const response = await fetchOverride(`${APOLLO_API_URL}${path}`, {
      method: "POST", headers: apolloHeaders(), body: JSON.stringify(body), signal: controller.signal,
    });
    let responseBody: Record<string, any>;
    try {
      const parsed = await response.json();
      responseBody = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      responseBody = {};
    }
    const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
    const bodyError = apolloBodyErrorMessage(responseBody);
    await recordPaidProviderCreditSignal("apollo", {
      httpStatus: response.status, message: bodyError, failure: !response.ok || Boolean(bodyError),
    });
    return { body: responseBody, billing: apolloCreditReceipt(response, responseBody), ok: response.ok };
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("APOLLO_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Apollo organization + people search transport and parser. It deliberately
 * has no CRO03C authority or persistence dependency; the optional checkpoint
 * lets an owning execution boundary revalidate authority before each request.
 */
export async function performApolloSearch(
  input: ApolloSearchInput,
  deps: ApolloSearchDependencies = {},
): Promise<ApolloSearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resultCap = input.resultCap ?? 100;
  if (!Number.isInteger(resultCap) || resultCap < 0 || resultCap > 100) {
    throw new Error("CRO03C_RESULT_CAP_INVALID");
  }
  if (resultCap === 0 || !process.env.APOLLO_API_KEY) {
    return { outcome: "no_result", billing: { certainty: "exact", billedCredits: "0", creditedUnits: 0 } };
  }
  const identityInput: ApolloFrozenOrganizationIdentity = {
    domain: input.domain, legalName: input.legalName, dbaName: input.dbaName,
    city: input.city, state: input.state, address: input.address,
  };
  const identity = normalizedFrozenIdentity(identityInput);
  if (!identity.domain && !identity.legalName && !identity.dbaName) {
    return { outcome: "no_result", billing: { certainty: "exact", billedCredits: "0", creditedUnits: 0 } };
  }
  const queries: Record<string, unknown>[] = [];
  if (identity.domain) queries.push({ q_organization_domains: [identity.domain] });
  if (identity.legalName) queries.push({ q_organization_name: identity.legalName });
  if (identity.dbaName && identity.dbaName !== identity.legalName) queries.push({ q_organization_name: identity.dbaName });
  const organizations = new Map<string, Record<string, any>>();
  const organizationOperationIds = new Map<string, string>();
  const personOperationIds = new Map<string, string>();
  const requestOperationIds: string[] = [];
  let reportedCredits = "0";
  let billingKnown = true;
  const providerReferences: string[] = [];
  const observeBilling = (billing: ApolloCreditCertainty) => {
    if (billing.certainty !== "exact" || billing.billedCredits === undefined) {
      billingKnown = false;
    } else {
      const total = addExactNonNegativeDecimals([reportedCredits, billing.billedCredits]);
      if (total === null) billingKnown = false;
      else reportedCredits = total;
    }
    if (billing.providerReference && !providerReferences.includes(billing.providerReference)) {
      providerReferences.push(billing.providerReference);
    }
  };
  const billing = (): ApolloCreditCertainty => billingKnown
    ? {
      certainty: "exact", billedCredits: String(reportedCredits),
      creditedUnits: Number(reportedCredits), providerReference: providerReferences.at(-1),
      providerReferences,
    }
    : {
      certainty: "unknown", providerReference: providerReferences.at(-1), providerReferences,
    };
  const reportSignal = async (signal: { httpStatus: number; message?: string | null; failure: boolean }) => {
    if (deps.recordCreditSignal) return deps.recordCreditSignal(signal);
    const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
    await recordPaidProviderCreditSignal("apollo", signal);
  };
  const postSearch = async (
    path: string,
    body: Record<string, unknown>,
    employerScope?: ApolloEmployerScope,
  ) => {
    try {
      const url = `${APOLLO_API_URL}${path}`;
      const init = { method: "POST", headers: apolloHeaders(), body: JSON.stringify(body) } satisfies RequestInit;
      const dispatched = await dispatchApolloRequestWithTimeoutRetry({
        url, init, dependencies: { ...deps, fetchImpl }, employerScope,
      });
      const response = dispatched.response;
      let responseBody: Record<string, any>;
      try {
        const parsed = await response.json();
        responseBody = parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        responseBody = {};
      }
      const bodyError = apolloBodyErrorMessage(responseBody);
      const parsedReceipt = apolloCreditReceipt(response, responseBody);
      const receipt: ApolloCreditCertainty = dispatched.ambiguousOperationIds?.length
        ? { certainty: "unknown", providerReference: parsedReceipt.providerReference }
        : parsedReceipt;
      await reportSignal({
        httpStatus: response.status, message: bodyError, failure: !response.ok || Boolean(bodyError),
      });
      for (const id of dispatched.operationIds ?? (dispatched.operationId ? [dispatched.operationId] : [])) {
        if (id && !requestOperationIds.includes(id)) requestOperationIds.push(id);
      }
      const operationId = dispatched.operationId ?? null;
      return { body: responseBody, billing: receipt, ok: response.ok && !bodyError, operationId };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const timeoutError = new Error("APOLLO_TIMEOUT") as ApolloRetryError;
        timeoutError.apolloOperationIds = err.apolloOperationIds;
        throw timeoutError;
      }
      throw err;
    }
  };

  const perPage = Math.min(25, resultCap);
  const maxPages = Math.ceil(resultCap / perPage);
  for (const query of queries) {
    for (let page = 1; page <= maxPages; page++) {
      const response = await postSearch(APOLLO_ORG_SEARCH_PATH, {
        ...query,
        ...(input.city || input.state
          ? { organization_locations: [`${input.city?.trim() ?? ""}${input.city && input.state ? ", " : ""}${input.state?.trim() ?? ""}`] }
          : {}),
        page, per_page: perPage,
      });
      observeBilling(response.billing);
      if (!response.ok) return { outcome: "ambiguous", billing: billing(), requestOperationIds };
      const pageOrganizations = Array.isArray(response.body.organizations) ? response.body.organizations : [];
      for (const raw of pageOrganizations) {
        const id = raw && typeof raw === "object" ? organizationId(raw) : null;
        if (id) {
          organizations.set(id, raw);
          if (response.operationId) organizationOperationIds.set(id, response.operationId);
        }
      }
      const reportedPages = exactPositiveInteger(response.body.pagination?.total_pages);
      if (organizations.size >= resultCap || pageOrganizations.length < perPage ||
          (reportedPages !== null && page >= reportedPages)) break;
    }
    if (organizations.size >= resultCap) break;
  }
  const alternatives = [...organizations.values()].filter((raw) => isExactFrozenOrganizationMatch(raw, identity));
  if (alternatives.length === 0) {
    return { outcome: "no_result", billing: billing(), requestOperationIds };
  }
  if (alternatives.length !== 1) {
    return { outcome: "ambiguous", billing: billing(), requestOperationIds };
  }
  const selected = alternatives[0];
  const selectedId = organizationId(selected)!;
  const employerScope: ApolloEmployerScope = {
    organizationId: selectedId,
    names: organizationNames(selected),
    domains: [extractDomain(selected.primary_domain || selected.website_url)]
      .filter((domain): domain is string => Boolean(domain)),
  };
  const requestedOrganizationIds = new Set([selectedId]);
  const peopleById = new Map<string, Record<string, any>>();
  const seniorities = ["owner", "founder", "c_suite", "partner"];
  const personTitles = [
    "owner", "founder", "co-founder", "chief executive officer", "ceo", "president",
    "managing partner", "partner", "principal", "practice owner", "practice manager",
    "medical director", "general manager",
  ];
  for (let page = 1; page <= maxPages && peopleById.size < resultCap; page++) {
    const peopleResponse = await postSearch(APOLLO_PEOPLE_SEARCH_PATH, {
      organization_ids: [selectedId],
      person_titles: personTitles,
      person_seniorities: seniorities,
      page,
      per_page: perPage,
    }, employerScope);
    observeBilling(peopleResponse.billing);
    if (!peopleResponse.ok) return { outcome: "ambiguous", billing: billing(), requestOperationIds };
    const pagePeople = Array.isArray(peopleResponse.body.people) ? peopleResponse.body.people : [];
    for (const person of pagePeople) {
      const id = person && (typeof person.id === "string" || typeof person.person_id === "string")
        ? String(person.id ?? person.person_id)
        : null;
      if (id && apolloPersonMatchesEmployerScope(person, requestedOrganizationIds, employerScope)) {
        peopleById.set(id, person);
        if (peopleResponse.operationId) personOperationIds.set(id, peopleResponse.operationId);
      }
    }
    const reportedPages = exactPositiveInteger(peopleResponse.body.pagination?.total_pages);
    if (pagePeople.length < perPage || (reportedPages !== null && page >= reportedPages)) break;
  }
  const rawPeople = [...peopleById.entries()].slice(0, resultCap);
  const people = rawPeople.map(([, person]) => redactedApolloBusiness(parseApolloPerson(person, false)));
  const personIds = rawPeople.map(([id]) => id);
  return {
    outcome: "success", organizationId: selectedId, organization: redactedApolloBusiness(parseApolloOrg(selected)),
    people, personIds, billing: billing(),
    organizationOperationId: organizationOperationIds.get(selectedId) ?? null,
    personOperationIds: personIds.map((personId) => personOperationIds.get(personId) ?? null),
    requestOperationIds,
  };
}

function exactPositiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Apollo's documented Bulk People Enrichment endpoint accepts at most ten
 * details per call. Search results contain no emails; this adapter deliberately
 * leaves personal email/phone reveal and webhook-backed waterfall disabled.
 */
export async function performApolloBusinessEmailEnrichment(
  personIds: readonly string[],
  deps: ApolloBusinessEmailEnrichmentDependencies = {},
  employerScope?: ApolloEmployerScope,
): Promise<ApolloBusinessEmailEnrichmentResult> {
  if (!Array.isArray(personIds) || personIds.length > 10 ||
      personIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(personIds).size !== personIds.length) {
    throw new Error("APOLLO_BULK_ENRICHMENT_INPUT_INVALID");
  }
  if (personIds.length === 0 || !process.env.APOLLO_API_KEY) {
    return {
      outcome: "no_result", people: [],
      billing: { certainty: "exact", billedCredits: "0", creditedUnits: 0 },
    };
  }
  try {
    const url = `${APOLLO_API_URL}${APOLLO_BULK_PEOPLE_ENRICHMENT_PATH}`;
    const init = {
      method: "POST",
      headers: apolloHeaders(),
      // No reveal_personal_emails, reveal_phone_number, run_waterfall_email,
      // or run_waterfall_phone: only Apollo's business-email default applies.
      body: JSON.stringify({ details: personIds.map((id) => ({ id })) }),
    } satisfies RequestInit;
    const dispatched = await dispatchApolloRequestWithTimeoutRetry({
      url, init, dependencies: deps, employerScope,
    });
    const response = dispatched.response;
    let body: Record<string, any>;
    try {
      const parsed = await response.json();
      body = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      body = {};
    }
    const bodyError = apolloBodyErrorMessage(body);
    const parsedReceipt = apolloCreditReceipt(response, body);
    const receipt: ApolloCreditCertainty = dispatched.ambiguousOperationIds?.length
      ? { certainty: "unknown", providerReference: parsedReceipt.providerReference }
      : parsedReceipt;
    if (deps.recordCreditSignal) {
      await deps.recordCreditSignal({
        httpStatus: response.status, message: bodyError, failure: !response.ok || Boolean(bodyError),
      });
    } else {
      const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
      await recordPaidProviderCreditSignal("apollo", {
        httpStatus: response.status, message: bodyError, failure: !response.ok || Boolean(bodyError),
      });
    }
    if (!response.ok || bodyError) {
      return {
        outcome: "ambiguous", people: [], requestOperationId: dispatched.operationId ?? null,
        requestOperationIds: dispatched.operationIds ?? [],
        billing: receipt,
      };
    }
    const matches = Array.isArray(body.matches) ? body.matches
      : Array.isArray(body.people) ? body.people
        : body.person && typeof body.person === "object" ? [body.person] : [];
    const requested = new Set(personIds);
    const requestedOrganizationIds = new Set([employerScope?.organizationId ?? ""]);
    const enriched = new Map<string, string | null>();
    for (const value of matches) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const person = value as Record<string, any>;
      const id = person.id ?? person.person_id;
      if (typeof id !== "string" || !requested.has(id)) continue;
      if (!apolloPersonMatchesEmployerScope(person, requestedOrganizationIds, employerScope)) continue;
      // Bulk enrichment returns business email by default. Never use personal
      // email fields as a fallback, even if a fixture/provider includes them.
      enriched.set(id, typeof person.email === "string" && person.email.trim() ? person.email.trim() : null);
    }
    return {
      outcome: enriched.size ? "success" : "no_result",
      requestOperationId: dispatched.operationId ?? null,
      requestOperationIds: dispatched.operationIds ?? [],
      people: personIds.filter((id) => enriched.has(id)).map((personId) => ({
        personId, email: enriched.get(personId) ?? null,
      })),
      billing: receipt,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("APOLLO_TIMEOUT") as ApolloRetryError;
      timeoutError.apolloOperationIds = error.apolloOperationIds;
      throw timeoutError;
    }
    throw error;
  }
}

/**
 * Canonical CRO03C Apollo entrypoint. It intentionally does not accept the
 * legacy worker context. The only caller may provide an injected transport for
 * deterministic tests; production supplies the global fetch explicitly.
 */
export async function executeApolloForCro03c(
  context: Cro03cLiveProviderContext,
  frozenIdentity: Readonly<ApolloFrozenOrganizationIdentity>,
  resultCap: number,
  fetchOverride: ApolloFetch,
): Promise<Cro03cApolloExecution> {
  if (!context || context.kind !== "cro03c_live" || context.provider !== "apollo") {
    throw new Error("CRO03C_PROVIDER_CONTEXT_REQUIRED");
  }
  assertCro03cLiveContext(context);
  // The CRO03C authority check below is the paid approval; retain the manifest
  // caller gate rather than creating a parallel Apollo activation path.
  assertProviderActivation({
    sourceId: "apollo", caller: context.caller, explicitPaidApproval: true,
  });
  if (context.caller !== CRO03C_APOLLO_CALLER) throw new Error("CRO03C_PROVIDER_CONTEXT_DENIED");
  if (!Object.isFrozen(frozenIdentity)) throw new Error("CRO03C_INPUT_NOT_FROZEN");
  if (!Number.isInteger(resultCap) || resultCap < 0 || resultCap > 100) {
    throw new Error("CRO03C_RESULT_CAP_INVALID");
  }
  if (!fetchOverride) throw new Error("APOLLO_FETCH_OVERRIDE_REQUIRED");
  if (resultCap === 0 || !process.env.APOLLO_API_KEY) {
    return { outcome: "no_result", billing: { certainty: "exact", creditedUnits: 0 } };
  }

  return performApolloSearch(
    { ...frozenIdentity, resultCap },
    { fetchImpl: fetchOverride as typeof fetch, beforeRequest: () => assertCro03cAuthorityBeforeIo(context) },
  );
}

/**
 * Resolves a frozen organization identity before looking up people.  Transport
 * injection is mandatory so this low-level deterministic API cannot silently
 * make a live paid request; approved callers may explicitly supply transport.
 */
export async function resolveApolloOrganizationForFrozenIdentity(
  frozenIdentity: ApolloFrozenOrganizationIdentity,
  fetchOverride: ApolloFetch,
): Promise<ApolloOrganizationResolution> {
  if (!fetchOverride) throw new Error("APOLLO_FETCH_OVERRIDE_REQUIRED");
  const identity = normalizedFrozenIdentity(frozenIdentity);
  if (!identity.domain && !identity.legalName && !identity.dbaName) {
    return { outcome: "no_result", alternatives: [] };
  }
  if (!process.env.APOLLO_API_KEY) {
    return { outcome: "no_result", alternatives: [] };
  }

  await acquireToken();
  const requestCity = frozenIdentity.city?.trim();
  const requestState = frozenIdentity.state?.trim();
  const queries: Record<string, unknown>[] = [];
  if (identity.domain) queries.push({ q_organization_domains: [identity.domain] });
  if (identity.legalName) queries.push({ q_organization_name: identity.legalName });
  if (identity.dbaName && identity.dbaName !== identity.legalName) {
    queries.push({ q_organization_name: identity.dbaName });
  }

  const organizations = new Map<string, Record<string, any>>();
  for (const query of queries) {
    const data = await postApollo(APOLLO_ORG_SEARCH_PATH, {
      ...query,
      ...(requestCity || requestState
        ? { organization_locations: [`${requestCity ?? ""}${requestCity && requestState ? ", " : ""}${requestState ?? ""}`] }
        : {}),
      page: 1,
      per_page: 100,
    }, fetchOverride);
    for (const raw of data.organizations || []) {
      const id = organizationId(raw);
      if (id) organizations.set(id, raw);
    }
  }

  const alternatives = [...organizations.values()]
    .filter((raw) => isExactFrozenOrganizationMatch(raw, identity))
    .map((raw) => ({ organizationId: organizationId(raw)!, organization: parseApolloOrg(raw) }))
    .sort((a, b) => a.organizationId.localeCompare(b.organizationId));

  if (alternatives.length === 0) return { outcome: "no_result", alternatives };
  if (alternatives.length !== 1) return { outcome: "ambiguous", alternatives };

  const selected = alternatives[0];
  const employerScope: ApolloEmployerScope = {
    organizationId: selected.organizationId,
    names: [selected.organization.name].filter(Boolean),
    domains: selected.organization.website ? [selected.organization.website] : [],
  };
  const peopleData = await postApollo(APOLLO_PEOPLE_SEARCH_PATH, {
    organization_ids: [selected.organizationId],
    page: 1,
    per_page: 100,
  }, fetchOverride);
  const people = (peopleData.people || [])
    .filter((person: Record<string, any>) =>
      apolloPersonMatchesEmployerScope(person, new Set([selected.organizationId]), employerScope))
    .map((person: Record<string, any>) => parseApolloPerson(person));

  return { outcome: "success", ...selected, people, alternatives };
}

/** Short alias for callers that do not need the policy-oriented name. */
export const resolveApolloOrganization = resolveApolloOrganizationForFrozenIdentity;

/**
 * The sole production transport wrapper for deterministic organization
 * resolution.  It intentionally accepts only the durable CRO03 context; the
 * injectable resolver above remains the test-facing primitive.
 */
export async function resolveApolloOrganizationForCro03Worker(
  frozenIdentity: ApolloFrozenOrganizationIdentity,
  authorization: Cro03WorkerProviderContext,
): Promise<ApolloOrganizationResolution> {
  assertProviderActivation({
    sourceId: "apollo",
    caller: authorization?.caller ?? "unapproved",
    explicitPaidApproval: authorization?.explicitPaidApproval ?? false,
  });
  if (!authorization || authorization.kind !== "cro03_worker" || authorization.provider !== "apollo") {
    throw new Error("CRO03_PROVIDER_CONTEXT_REQUIRED");
  }
  await assertCurrentWorkerContext(authorization);
  // postApollo owns the abort controller, so the production path retains the
  // same bounded 30-second transport timeout as injected transport.
  return resolveApolloOrganizationForFrozenIdentity(
    frozenIdentity,
    (url, init) => fetch(url, init),
  );
}

function parseApolloPerson(raw: Record<string, any>, includeEnrichedBusinessEmail = false): ApolloBusiness {
  const org = raw.organization || {};
  const orgPhone = normalizePhone(org.phone);
  const personPhone = extractFirstPhone(raw.phone_numbers || []);
  const businessEmail = includeEnrichedBusinessEmail && typeof raw.email === "string" ? raw.email : null;

  return {
    name: org.name || "",
    phone: orgPhone || personPhone,
    email: businessEmail,
    website: extractDomain(org.primary_domain || org.website_url),
    address: org.street_address || null,
    city: org.city || null,
    state: org.state || null,
    zip: org.postal_code || null,
    category: Array.isArray(org.keywords) ? org.keywords[0] : null,
    rawData: raw,
    ownerFirstName: raw.first_name || null,
    ownerLastName: raw.last_name || null,
    ownerEmail: businessEmail,
    ownerPhone: personPhone,
    ownerTitle: raw.title || null,
  };
}

function parseApolloOrg(raw: Record<string, any>): ApolloBusiness {
  return {
    name: raw.name || "",
    phone: normalizePhone(raw.phone),
    // Organization/People Search results are identity evidence only. Email is
    // populated by the dedicated enrichment endpoint, never search response.
    email: null,
    website: extractDomain(raw.primary_domain || raw.website_url),
    address: raw.street_address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.postal_code || null,
    category: Array.isArray(raw.keywords) ? raw.keywords[0] : null,
    rawData: raw,
    ownerFirstName: null,
    ownerLastName: null,
    ownerEmail: null,
    ownerPhone: null,
    ownerTitle: null,
  };
}

export async function testApolloConnection(): Promise<{ success: true; count: number; message: string }> {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error("Apollo API key not configured. Set APOLLO_API_KEY environment variable.");
  }

  await acquireToken();

  const body = {
    q_organization_keyword_tags: ["restaurant"],
    person_titles: ["owner", "ceo"],
    organization_locations: ["Miami, FL"],
    page: 1,
    per_page: 1,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(`${APOLLO_API_URL}${APOLLO_PEOPLE_SEARCH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === "AbortError") {
      throw new Error("Apollo API request timed out.");
    }
    throw new Error(`Apollo API network error: ${err.message}`);
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Apollo authentication failed (HTTP ${response.status}). Check your APOLLO_API_KEY and ensure your plan supports API access (Professional or higher required).`);
    }
    if (response.status === 422) {
      throw new Error(`Apollo rejected the request (HTTP 422): ${errorText}`);
    }
    throw new Error(`Apollo API error (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const people: any[] = data.people || [];
  const organizations: any[] = data.organizations || [];
  const count = people.length + organizations.length;

  return {
    success: true,
    count,
    message: `Apollo connection successful. Found ${count} result(s) in test search.`,
  };
}

export async function searchApolloForDiscovery(
  vertical: string,
  metro: string,
  state: string = "FL",
  limit: number = 100,
  authorization?: Cro03WorkerProviderContext,
  fetchOverride?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<ApolloBusiness[]> {
  // Credentials alone never authorize paid discovery. The durable command
  // worker must pass its approved caller and explicit reservation approval.
  assertProviderActivation({
    sourceId: "apollo",
    caller: authorization?.caller ?? "unapproved",
    explicitPaidApproval: authorization?.explicitPaidApproval ?? false,
  });
  if (!authorization || authorization.kind !== "cro03_worker" || authorization.provider !== "apollo") {
    throw new Error("CRO03_PROVIDER_CONTEXT_REQUIRED");
  }
  if (!process.env.APOLLO_API_KEY) {
    console.warn("[Apollo] No API key configured. Set APOLLO_API_KEY env variable. Apollo Professional plan or higher required for API access.");
    return [];
  }

  await acquireToken();
  await assertCurrentWorkerContext(authorization);

  const perPage = Math.min(limit, 100);
  const ownerTitles = ["owner", "president", "ceo", "founder", "co-founder", "partner", "managing partner", "principal", "gm", "general manager", "director"];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const body = {
      q_organization_keyword_tags: [vertical],
      person_titles: ownerTitles,
      organization_locations: [`${metro}, ${state}`],
      page: 1,
      per_page: perPage,
    };

    const response = await (fetchOverride ?? fetch)(`${APOLLO_API_URL}${APOLLO_PEOPLE_SEARCH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        console.error(`[Apollo] Authentication failed (${response.status}). Check APOLLO_API_KEY and ensure your plan supports API access (Professional or higher required).`);
      } else if (response.status === 422) {
        console.error(`[Apollo] Invalid request parameters: ${errorText}`);
      } else {
        console.error(`[Apollo] API error ${response.status}: ${errorText}`);
      }
      await recordPaidProviderCreditSignal("apollo", { httpStatus: response.status, message: errorText, failure: true });
      throw new Error(`APOLLO_HTTP_${response.status}`);
    }

    const data = await response.json() as any;
    const bodyError = apolloBodyErrorMessage(data);
    await recordPaidProviderCreditSignal("apollo", {
      httpStatus: response.status, message: bodyError, failure: Boolean(bodyError),
    });
    const people: Record<string, any>[] = data.people || [];
    const organizations: Record<string, any>[] = data.organizations || [];

    const results: ApolloBusiness[] = [];
    const seenOrgs = new Set<string>();
    let peopleCount = 0;

    for (const person of people) {
      const orgName = person.organization?.name;
      if (!orgName) continue;
      const parsed = parseApolloPerson(person);
      if (parsed.name) {
        results.push(parsed);
        seenOrgs.add(orgName.toLowerCase());
        peopleCount++;
      }
    }

    for (const org of organizations) {
      if (!org.name) continue;
      if (seenOrgs.has(org.name.toLowerCase())) continue;
      results.push(parseApolloOrg(org));
    }

    return results;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("APOLLO_TIMEOUT");
    throw err;
  }
}

// ── MI-05: Apollo People Reveal (credit-bearing per-person call) ──────────────

export type ApolloMatchConfidence = "high" | "medium" | "low" | "none";

export interface ApolloRevealResult {
  outcome: "accepted" | "quarantine" | "no_result";
  /** Present for 'accepted' and 'quarantine' (medium confidence). Encrypted by caller before storage. */
  email?: string;
  /** Present for 'accepted' and 'quarantine'. */
  matchConfidence?: ApolloMatchConfidence;
  billing: ApolloCreditCertainty;
}

/**
 * People Match (reveal) endpoint.  Separate credit-bearing call per person.
 * - 'high' match_confidence → accepted.
 * - 'medium' → quarantine for operator review.
 * - 'low' | 'none' → no_result, no candidate written.
 * Phone reveal is explicitly excluded (reveal_phone_number: false).
 * MI-05 hard limit: max 3 reveals per business/generation (enforced by callers).
 */
export async function revealApolloPerson(
  context: Cro03cLiveProviderContext,
  personId: string,
  fetchOverride: ApolloFetch,
): Promise<ApolloRevealResult> {
  if (!context || context.kind !== "cro03c_live" || context.provider !== "apollo") {
    throw new Error("CRO03C_PROVIDER_CONTEXT_REQUIRED");
  }
  assertCro03cLiveContext(context);
  if (!fetchOverride) throw new Error("APOLLO_FETCH_OVERRIDE_REQUIRED");
  if (!personId) throw new Error("APOLLO_PERSON_ID_REQUIRED");
  if (!process.env.APOLLO_API_KEY) {
    return { outcome: "no_result", billing: { certainty: "exact", creditedUnits: 0 } };
  }

  const response = await postApolloForCro03c(
    context,
    APOLLO_PEOPLE_REVEAL_PATH,
    {
      id: personId,
      reveal_personal_emails: true,
      reveal_phone_number: false, // Phone reveal requires async webhook; excluded from MI-05.
    },
    fetchOverride,
  );

  if (!response.ok || response.billing.certainty !== "exact" || response.billing.creditedUnits === undefined) {
    return { outcome: "quarantine", billing: response.billing };
  }

  const person = response.body?.person ?? response.body?.people?.[0] ?? null;
  if (!person) {
    return { outcome: "no_result", billing: { certainty: "exact", creditedUnits: response.billing.creditedUnits } };
  }

  const rawConfidence = person.match_confidence as string | undefined;
  const matchConfidence: ApolloMatchConfidence =
    rawConfidence === "high" ? "high"
    : rawConfidence === "medium" ? "medium"
    : rawConfidence === "low" ? "low"
    : "none";

  const email: string | null = person.email ?? person.personal_email ?? null;
  const billing: ApolloCreditCertainty = { certainty: "exact", creditedUnits: response.billing.creditedUnits };

  if (matchConfidence === "low" || matchConfidence === "none") {
    return { outcome: "no_result", matchConfidence, billing };
  }
  if (matchConfidence === "medium") {
    // Include the email so the caller can persist it with quarantined disposition
    // for operator review. Do NOT write it to receipts or logs.
    return { outcome: "quarantine", matchConfidence, billing, ...(email ? { email } : {}) };
  }
  // high: accepted only if email present.
  if (!email) {
    return { outcome: "no_result", matchConfidence, billing };
  }
  return { outcome: "accepted", email, matchConfidence, billing };
}
