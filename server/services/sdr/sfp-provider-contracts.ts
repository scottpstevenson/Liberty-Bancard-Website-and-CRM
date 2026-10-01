/**
 * Pure normalizers for provider response contracts used by the routine SFP
 * adapters. Kept free of server/database imports so the contract tests can
 * run with all egress denied.
 */

export interface ProviderUsageReceipt {
  certainty: "exact" | "unknown";
  quantity?: string;
  providerReference?: string;
  providerReferences?: readonly string[];
}

const DECIMAL_USAGE = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;

function exactNonNegativeDecimal(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const raw = String(value).trim();
  if (!DECIMAL_USAGE.test(raw)) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isSafeInteger(Math.trunc(numeric))) return null;
  const [whole, fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

/**
 * Apollo's current receipt is `credits_consumed` and may be fractional.
 * Older explicit receipts remain recognized, but inferred request/result
 * counts and rate-limit headers are never treated as billing evidence.
 */
export function parseApolloUsageReceipt(
  headers: Headers,
  body: Record<string, unknown>,
): ProviderUsageReceipt {
  const values: string[] = [];
  for (const header of ["x-apollo-credits-used", "x-credits-used", "x-credit-cost"]) {
    const value = headers.get(header);
    if (value !== null) {
      const parsed = exactNonNegativeDecimal(value);
      if (parsed === null) return { certainty: "unknown", providerReference: apolloReference(headers, body) };
      values.push(parsed);
    }
  }
  for (const key of ["credits_consumed", "credits_used", "creditsUsed", "credit_cost", "creditCost"]) {
    if (body[key] !== undefined) {
      const parsed = exactNonNegativeDecimal(body[key]);
      if (parsed === null) return { certainty: "unknown", providerReference: apolloReference(headers, body) };
      values.push(parsed);
    }
  }
  const providerReference = apolloReference(headers, body);
  if (!values.length || values.some((value) => value !== values[0])) {
    return { certainty: "unknown", providerReference };
  }
  return { certainty: "exact", quantity: values[0], providerReference };
}

/**
 * Current Apollo reference pricing is endpoint-specific:
 * docs.apollo.io/reference/organization-search = 1 credit/page;
 * docs.apollo.io/reference/people-api-search = 0 credits.
 */
export function documentedApolloSearchCredits(endpointPath: string): "0" | "1" | null {
  if (endpointPath.endsWith("/mixed_companies/search")) return "1";
  if (endpointPath.endsWith("/mixed_people/api_search")) return "0";
  return null;
}

export interface ApolloEmployerScope {
  organizationId: string;
  names: readonly string[];
  domains: readonly string[];
}

function normalizedEmployerName(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedEmployerDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch { return null; }
}

/** Verify explicit employer identity, or retain a validated server-filter scope when IDs are omitted. */
export function apolloPersonMatchesEmployerScope(
  person: Record<string, unknown>,
  requestedOrganizationIds: ReadonlySet<string>,
  scope?: ApolloEmployerScope,
): boolean {
  const organization = person.organization && typeof person.organization === "object" &&
    !Array.isArray(person.organization)
    ? person.organization as Record<string, unknown>
    : {};
  const explicitIds = [
    organization.id, organization.organization_id, person.organization_id, person.organizationId,
  ].filter((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())
    .map(String);
  if (explicitIds.length && !explicitIds.every((id) => requestedOrganizationIds.has(id))) return false;
  if (scope && !requestedOrganizationIds.has(scope.organizationId)) return false;
  const rawNames = [organization.name, organization.organization_name, person.organization_name]
    .map(normalizedEmployerName).filter((value): value is string => Boolean(value));
  const rawDomains = [
    organization.primary_domain, organization.domain, organization.website_url,
    person.organization_domain, person.organization_website_url,
  ].map(normalizedEmployerDomain).filter((value): value is string => Boolean(value));
  if (scope) {
    const names = scope.names.map(normalizedEmployerName);
    const domains = scope.domains.map(normalizedEmployerDomain);
    if (rawNames.some((value) => !names.includes(value))) return false;
    if (rawDomains.some((value) => !domains.includes(value))) return false;
    if (explicitIds.length) return true;

    // Current docs.apollo.io/reference/people-api-search shows people[].organization
    // with name/has_* fields but no organization ID. Accept only within the
    // single validated organization_ids server-filter request, and only when
    // that employer matches known org-search identity; never synthesize an ID.
    if (requestedOrganizationIds.size !== 1) return false;
    return rawNames.some((value) => names.includes(value)) ||
      rawDomains.some((value) => domains.includes(value));
  }
  return explicitIds.length > 0;
}

export function calculateApolloRequestWork(input: {
  endpointPath: string;
  requestBody: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  requestSucceeded: boolean;
  employerScope?: ApolloEmployerScope;
}): {
  workUnit: "request" | "person";
  reservedUnits: number;
  completedUnits: number;
} {
  const organizationSearch = input.endpointPath.endsWith("/mixed_companies/search");
  const peopleSearch = input.endpointPath.endsWith("/mixed_people/api_search");
  const bulkEnrichment = input.endpointPath.endsWith("/people/bulk_match");
  if (organizationSearch) {
    return { workUnit: "request", reservedUnits: 1, completedUnits: input.requestSucceeded ? 1 : 0 };
  }
  const detailIds = Array.isArray(input.requestBody.details)
    ? input.requestBody.details.map((detail: any) => String(detail?.id ?? "")).filter(Boolean)
    : [];
  const requestedOrganizationIds = new Set((Array.isArray(input.requestBody.organization_ids)
    ? input.requestBody.organization_ids : []).map(String));
  const reservedUnits = bulkEnrichment
    ? Math.min(10, Math.max(1, detailIds.length))
    : Math.min(10, Math.max(1, Number(input.requestBody.per_page ?? 10)));
  if (!input.requestSucceeded) return { workUnit: "person", reservedUnits, completedUnits: 0 };

  const body = input.responseBody ?? {};
  const rawRows = bulkEnrichment
    ? Array.isArray(body.matches) ? body.matches
      : Array.isArray(body.people) ? body.people
        : body.person && typeof body.person === "object" ? [body.person] : []
    : peopleSearch && Array.isArray(body.people) ? body.people : [];
  const requestedPersonIds = new Set(detailIds);
  const completedIds = new Set(rawRows.flatMap((value: any) => {
    if (!value || typeof value !== "object") return [];
    const id = value.id ?? value.person_id;
    if (typeof id !== "string" || !id) return [];
    if (bulkEnrichment) {
      // Current docs.apollo.io/reference/bulk-people-enrichment returns both
      // the person id and employer organization_id; require requested person
      // plus employer evidence before crediting work/candidates.
      return requestedPersonIds.has(id) &&
        apolloPersonMatchesEmployerScope(value, new Set([input.employerScope?.organizationId ?? ""]), input.employerScope)
        ? [id] : [];
    }
    if (peopleSearch) {
      return apolloPersonMatchesEmployerScope(value, requestedOrganizationIds, input.employerScope) ? [id] : [];
    }
    return [];
  }));
  return { workUnit: "person", reservedUnits, completedUnits: completedIds.size };
}

/** Exact, integer-only addition for usage receipts reported by several calls. */
export function addExactNonNegativeDecimals(values: readonly string[]): string | null {
  if (values.length === 0) return "0";
  const parsed = values.map((value) => {
    if (!DECIMAL_USAGE.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return { whole: BigInt(whole), fraction };
  });
  if (parsed.some((value) => value === null)) return null;
  const fractions = parsed as Array<{ whole: bigint; fraction: string }>;
  const scaleDigits = Math.max(...fractions.map((value) => value.fraction.length));
  const scale = 10n ** BigInt(scaleDigits);
  const total = fractions.reduce((sum, value) =>
    sum + value.whole * scale + BigInt(value.fraction.padEnd(scaleDigits, "0") || "0"), 0n);
  const whole = total / scale;
  if (!Number.isSafeInteger(Math.trunc(Number(whole)))) return null;
  const fraction = String(total % scale).padStart(scaleDigits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function apolloReference(headers: Headers, body: Record<string, unknown>): string | undefined {
  const value = headers.get("x-request-id")
    ?? headers.get("x-apollo-request-id")
    ?? (typeof body.request_id === "string" ? body.request_id : undefined)
    ?? (typeof body.requestId === "string" ? body.requestId : undefined);
  return value?.trim() || undefined;
}

export interface OutscraperContact {
  name: string | null;
  title: string | null;
  emails: readonly string[];
  raw: Record<string, unknown>;
}

function emailValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["email", "email_address", "value", "address"]) {
    if (typeof record[key] === "string" && (record[key] as string).trim()) {
      return (record[key] as string).trim();
    }
  }
  return null;
}

function emailList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(emailValue).filter((email): email is string => Boolean(email)))];
}

function contactName(raw: Record<string, unknown>): string | null {
  const fullName = raw.name ?? raw.full_name ?? raw.contact_name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  const parts = [raw.first_name, raw.last_name].filter((part): part is string =>
    typeof part === "string" && part.trim().length > 0);
  return parts.length ? parts.join(" ").trim() : null;
}

export function parseOutscraperContacts(raw: Record<string, unknown>): OutscraperContact[] {
  const contacts: OutscraperContact[] = [];
  const nested = Array.isArray(raw.contacts) ? raw.contacts : [];
  for (const value of nested) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const contact = value as Record<string, unknown>;
    const emails = [
      ...emailList(contact.emails),
      ...emailList(contact.email),
      ...emailList(contact.email_address),
    ];
    contacts.push({
      name: contactName(contact),
      title: typeof (contact.title ?? contact.job_title ?? contact.position) === "string"
        ? String(contact.title ?? contact.job_title ?? contact.position).trim() || null
        : null,
      emails: [...new Set(emails)],
      raw: contact,
    });
  }
  return contacts;
}

export function parseOutscraperEmails(raw: Record<string, unknown>): string[] {
  return [...new Set([
    ...emailList(raw.emails),
    ...emailList(raw.email),
    ...emailList(raw.email_address),
  ])];
}

/** A safe projection of provider-reported task identity and terminal state. */
export function parseOutscraperTaskReference(body: Record<string, unknown>): {
  requestId: string | null;
  state: "submitted" | "pending" | "completed" | "failed" | "unknown";
} {
  const value = body.requestId ?? body.request_id ?? body.task_id ?? body.id;
  let requestId = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!requestId && typeof body.results_location === "string") {
    try {
      const location = new URL(body.results_location);
      const match = location.pathname.match(/\/requests\/([A-Za-z0-9_-]{1,160})\/?$/);
      if (["api.outscraper.com", "api.outscraper.cloud"].includes(location.hostname) && match) {
        requestId = match[1];
      }
    } catch {
      // The original response remains safely unreferenced if its URL is not
      // the documented provider result location.
    }
  }
  const rawState = String(body.status ?? body.state ?? "").trim().toLowerCase();
  const state = ["completed", "finished", "success", "done"].includes(rawState) ? "completed"
    : ["failed", "error", "cancelled", "canceled"].includes(rawState) ? "failed"
      : ["pending", "running", "in_progress", "processing", "queued"].includes(rawState) ? "pending"
        : requestId ? "submitted" : "unknown";
  return { requestId, state };
}

/**
 * Outscraper docs.outscraper.com/endpoints/maps-search/ says results are
 * available for 4 hours after completion. The GET docs and sample at
 * docs.outscraper.com/endpoints/requests-requestid/ contain status/data but no
 * completion timestamp; they also say expired responses return status
 * "Pending". Bound retrieval conservatively using only a request-start or
 * confirmed-pending lower bound, and never refresh that bound after its cutoff.
 */
export function deriveOutscraperResultRetentionBound(input: {
  state: "pending" | "completed";
  submittedAt: string;
  lastPendingObservedAt?: string | null;
  observedAt: string;
  existingResultsExpiresAt?: string | null;
}): {
  expired: boolean;
  completionTimeLowerBoundAt: string;
  completionTimeBoundKind: "submission_started" | "last_pending_observed";
  resultsExpiresAt: string;
} {
  const toMillis = (value: string, label: string) => {
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis)) throw new Error(`OUTSCRAPER_${label}_TIMESTAMP_INVALID`);
    return millis;
  };
  const submittedAt = new Date(toMillis(input.submittedAt, "SUBMISSION"));
  const observedMillis = toMillis(input.observedAt, "OBSERVATION");
  const existingExpiryMillis = input.existingResultsExpiresAt
    ? toMillis(input.existingResultsExpiresAt, "RESULTS_EXPIRY")
    : null;
  const existingLowerBound = input.lastPendingObservedAt
    ? new Date(toMillis(input.lastPendingObservedAt, "PENDING_OBSERVATION"))
    : submittedAt;
  if (existingExpiryMillis !== null && observedMillis >= existingExpiryMillis) {
    return {
      expired: true,
      completionTimeLowerBoundAt: existingLowerBound.toISOString(),
      completionTimeBoundKind: input.lastPendingObservedAt ? "last_pending_observed" : "submission_started",
      resultsExpiresAt: new Date(existingExpiryMillis).toISOString(),
    };
  }
  const completionTimeLowerBoundAt = input.state === "pending"
    ? new Date(observedMillis)
    : existingLowerBound;
  const completionTimeBoundKind = input.state === "pending" || input.lastPendingObservedAt
    ? "last_pending_observed" as const
    : "submission_started" as const;
  return {
    expired: false,
    completionTimeLowerBoundAt: completionTimeLowerBoundAt.toISOString(),
    completionTimeBoundKind,
    resultsExpiresAt: new Date(completionTimeLowerBoundAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
  };
}