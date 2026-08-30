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

const APOLLO_API_URL = "https://api.apollo.io/v1";
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

/** A response-safe projection: provider payloads are never durable evidence. */
export type ApolloRedactedBusiness = Omit<ApolloBusiness, "rawData">;

export interface ApolloCreditCertainty {
  certainty: "exact" | "unknown";
  /** Present only where Apollo explicitly reported an unambiguous credit count. */
  creditedUnits?: number;
  providerReference?: string;
}

export type Cro03cApolloExecution =
  | {
    outcome: "success";
    organizationId: string;
    organization: ApolloRedactedBusiness;
    people: ApolloRedactedBusiness[];
    billing: ApolloCreditCertainty & { certainty: "exact"; creditedUnits: number };
  }
  | {
    outcome: "no_result";
    billing: ApolloCreditCertainty & { certainty: "exact"; creditedUnits: number };
  }
  | {
    /** A received response whose credit cost cannot be proven is quarantined. */
    outcome: "ambiguous";
    billing: ApolloCreditCertainty;
  };

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
    if (!response.ok) throw new Error(`APOLLO_HTTP_${response.status}`);
    return await response.json();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("APOLLO_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function redactedApolloBusiness(value: ApolloBusiness): ApolloRedactedBusiness {
  const { rawData: _rawData, ...evidence } = value;
  return evidence;
}

function exactNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Apollo does not publish one universal credit receipt field. Only these
 * explicit receipt fields count; rate-limit headers and inferred result counts
 * deliberately do not. Conflicting receipts are not exact billing evidence.
 */
function apolloCreditReceipt(response: Response, body: Record<string, any>): ApolloCreditCertainty {
  const values: number[] = [];
  for (const header of ["x-apollo-credits-used", "x-credits-used", "x-credit-cost"]) {
    const value = response.headers.get(header);
    if (value !== null) {
      const parsed = exactNonNegativeInteger(value);
      if (parsed === null) return { certainty: "unknown" };
      values.push(parsed);
    }
  }
  for (const key of ["credits_used", "creditsUsed", "credit_cost", "creditCost"]) {
    if (body[key] !== undefined) {
      const parsed = exactNonNegativeInteger(body[key]);
      if (parsed === null) return { certainty: "unknown" };
      values.push(parsed);
    }
  }
  const providerReference = response.headers.get("x-request-id")
    ?? response.headers.get("x-apollo-request-id")
    ?? (typeof body.request_id === "string" ? body.request_id : undefined);
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    return { certainty: "unknown", providerReference };
  }
  return { certainty: "exact", creditedUnits: values[0], providerReference };
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
    return { body: responseBody, billing: apolloCreditReceipt(response, responseBody), ok: response.ok };
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("APOLLO_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeout);
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

  const identity = normalizedFrozenIdentity(frozenIdentity);
  if (!identity.domain && !identity.legalName && !identity.dbaName) {
    return { outcome: "no_result", billing: { certainty: "exact", creditedUnits: 0 } };
  }

  await acquireToken();
  const queries: Record<string, unknown>[] = [];
  if (identity.domain) queries.push({ q_organization_domains: [identity.domain] });
  if (identity.legalName) queries.push({ q_organization_name: identity.legalName });
  if (identity.dbaName && identity.dbaName !== identity.legalName) queries.push({ q_organization_name: identity.dbaName });
  const organizations = new Map<string, Record<string, any>>();
  let creditedUnits = 0;
  let providerReference: string | undefined;
  for (const query of queries) {
    // Apollo can bill returned results. Bound each individual request to the
    // operation's *remaining* worst-case units before it leaves the process;
    // do not issue a full-size second/third lookup and discover the aggregate
    // cap only from its receipt afterwards.
    const remainingUnits = resultCap - creditedUnits;
    if (remainingUnits < 1) break;
    const response = await postApolloForCro03c(context, "/organizations/search", {
      ...query,
      ...(frozenIdentity.city || frozenIdentity.state
        ? { organization_locations: [`${frozenIdentity.city?.trim() ?? ""}${frozenIdentity.city && frozenIdentity.state ? ", " : ""}${frozenIdentity.state?.trim() ?? ""}`] }
        : {}),
      page: 1, per_page: Math.min(resultCap, remainingUnits),
    }, fetchOverride);
    const responseCredits = response.billing.creditedUnits;
    if (!response.ok || response.billing.certainty !== "exact" || responseCredits === undefined) {
      return { outcome: "ambiguous", billing: response.billing };
    }
    creditedUnits += responseCredits;
    providerReference ??= response.billing.providerReference;
    for (const raw of Array.isArray(response.body.organizations) ? response.body.organizations : []) {
      const id = raw && typeof raw === "object" ? organizationId(raw) : null;
      if (id) organizations.set(id, raw);
    }
  }
  const alternatives = [...organizations.values()].filter((raw) => isExactFrozenOrganizationMatch(raw, identity));
  if (alternatives.length === 0) {
    return { outcome: "no_result", billing: { certainty: "exact", creditedUnits, providerReference } };
  }
  if (alternatives.length !== 1) {
    return { outcome: "ambiguous", billing: { certainty: "exact", creditedUnits, providerReference } };
  }
  const selected = alternatives[0];
  const selectedId = organizationId(selected)!;
  const remainingUnits = resultCap - creditedUnits;
  // Organization resolution is still a successful, bounded operation when
  // its reservation is exhausted. A people request would be new paid I/O and
  // is therefore prohibited rather than sent optimistically.
  if (remainingUnits < 1) {
    return {
      outcome: "success", organizationId: selectedId, organization: redactedApolloBusiness(parseApolloOrg(selected)),
      people: [], billing: { certainty: "exact", creditedUnits, providerReference },
    };
  }
  const peopleResponse = await postApolloForCro03c(context, "/mixed_people/search", {
    organization_ids: [selectedId], page: 1, per_page: Math.min(resultCap, remainingUnits),
  }, fetchOverride);
  const peopleCredits = peopleResponse.billing.creditedUnits;
  if (!peopleResponse.ok || peopleResponse.billing.certainty !== "exact" || peopleCredits === undefined) {
    return {
      outcome: "ambiguous",
      billing: peopleResponse.billing.certainty === "exact"
        ? peopleResponse.billing
        : { certainty: "unknown", providerReference: peopleResponse.billing.providerReference ?? providerReference },
    };
  }
  creditedUnits += peopleCredits;
  providerReference ??= peopleResponse.billing.providerReference;
  const people = (Array.isArray(peopleResponse.body.people) ? peopleResponse.body.people : [])
    .filter((person: Record<string, any>) => organizationId(person.organization || person) === selectedId)
    .slice(0, resultCap)
    .map((person: Record<string, any>) => redactedApolloBusiness(parseApolloPerson(person)));
  return {
    outcome: "success", organizationId: selectedId, organization: redactedApolloBusiness(parseApolloOrg(selected)),
    people, billing: { certainty: "exact", creditedUnits, providerReference },
  };
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
    const data = await postApollo("/organizations/search", {
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
  const peopleData = await postApollo("/mixed_people/search", {
    organization_ids: [selected.organizationId],
    page: 1,
    per_page: 100,
  }, fetchOverride);
  const people = (peopleData.people || [])
    .filter((person: Record<string, any>) => organizationId(person.organization || person) === selected.organizationId)
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

function parseApolloPerson(raw: Record<string, any>): ApolloBusiness {
  const org = raw.organization || {};
  const orgPhone = normalizePhone(org.phone);
  const personPhone = extractFirstPhone(raw.phone_numbers || []);

  return {
    name: org.name || "",
    phone: orgPhone || personPhone,
    email: raw.email || null,
    website: extractDomain(org.primary_domain || org.website_url),
    address: org.street_address || null,
    city: org.city || null,
    state: org.state || null,
    zip: org.postal_code || null,
    category: Array.isArray(org.keywords) ? org.keywords[0] : null,
    rawData: raw,
    ownerFirstName: raw.first_name || null,
    ownerLastName: raw.last_name || null,
    ownerEmail: raw.email || null,
    ownerPhone: personPhone,
    ownerTitle: raw.title || null,
  };
}

function parseApolloOrg(raw: Record<string, any>): ApolloBusiness {
  return {
    name: raw.name || "",
    phone: normalizePhone(raw.phone),
    email: raw.email || null,
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
    response = await fetch(`${APOLLO_API_URL}/mixed_people/search`, {
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

    const response = await (fetchOverride ?? fetch)(`${APOLLO_API_URL}/mixed_people/search`, {
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

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        console.error(`[Apollo] Authentication failed (${response.status}). Check APOLLO_API_KEY and ensure your plan supports API access (Professional or higher required).`);
      } else if (response.status === 422) {
        console.error(`[Apollo] Invalid request parameters: ${errorText}`);
      } else {
        console.error(`[Apollo] API error ${response.status}: ${errorText}`);
      }
      throw new Error(`APOLLO_HTTP_${response.status}`);
    }

    const data = await response.json() as any;
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
