/**
 * Provider/source policy manifest (#1669).
 *
 * This is intentionally declarative: adding a client, key, or provider URL is
 * not authorization to invoke a paid source. Callers must obtain an explicit
 * activation decision through assertProviderActivation before dispatching it.
 */

export type ProviderSourceId =
  | "zerobounce"
  | "serper"
  | "outscraper"
  | "apify"
  | "apollo"
  | "proxycurl"
  | "sunbiz_registry"
  | "first_party_web"
  | "osm"
  | "directories"
  | "rdap"
  | "jsonld"
  | "openai_classification"
  | "content_sources"
  | "advisor_sources"
  | "social_only_sources";

export type SourceCapability =
  | "email_validation"
  | "business_discovery"
  | "contact_enrichment"
  | "registry_lookup"
  | "website_parsing"
  | "directory_lookup"
  | "domain_registration_lookup"
  | "structured_data_parsing"
  | "classification"
  | "content"
  | "advisor";

export type BillingModel = "free" | "paid_per_call" | "paid_per_result" | "paid_subscription" | "excluded";
export type ParserKind = "api" | "html_parser" | "json_parser" | "rdap" | "llm" | "none";
export type DurableOperation = "none" | "request" | "batch" | "actor_run" | "queue_job";
export type ActivationPolicy = "free" | "explicit_operator_enablement" | "excluded";
export type NormalizedOutcome =
  | "success"
  | "no_match"
  | "invalid_input"
  | "not_configured"
  | "disabled"
  | "budget_exhausted"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "parse_error"
  | "circuit_open"
  | "cancelled"
  | "superseded"
  | "ambiguous_billing"
  | "conflict"
  | "excluded";
export type CandidateField =
  | "business_name"
  | "website"
  | "email"
  | "phone"
  | "address"
  | "city"
  | "state"
  | "postal_code"
  | "category"
  | "owner_name"
  | "owner_title"
  | "registry_id"
  | "entity_status"
  | "domain_registrant"
  | "classification"
  | "summary";

export interface RetryPolicy {
  maxAttempts: number;
  retryableOutcomes: readonly Extract<NormalizedOutcome, "rate_limited" | "timeout" | "provider_error">[];
  backoffMs: number;
}

export interface RedactionPolicy {
  /** Never persist raw credentials, authorization headers, or full provider payloads. */
  redactSecrets: true;
  redactRawResponse: boolean;
  sensitiveCandidateFields: readonly CandidateField[];
}

export interface TestTransportMetadata {
  /** Production adapters must accept this injectable transport instead of using live I/O in tests. */
  injection: "fetchOverride" | "transportOverride" | "not_applicable";
  fixtureOnly: true;
  liveCallsAllowedInTests: false;
}

export interface ProviderSourceManifestRow {
  id: ProviderSourceId;
  capability: readonly SourceCapability[];
  billing: BillingModel;
  parser: ParserKind;
  activationPolicy: ActivationPolicy;
  approvedAdapters: readonly string[];
  approvedCallers: readonly string[];
  secretNames: readonly string[];
  durableOperation: DurableOperation;
  budget: {
    required: boolean;
    accounting: "none" | "control_row" | "usage_setting" | "ai_audit";
    unit: "request" | "result" | "token" | "run" | "none";
  };
  timeoutMs: number | null;
  retry: RetryPolicy;
  normalizedOutcomes: readonly NormalizedOutcome[];
  candidateFields: readonly CandidateField[];
  redaction: RedactionPolicy;
  testTransport: TestTransportMetadata;
  notes: string;
}

const STANDARD_OUTCOMES = [
  "success", "no_match", "invalid_input", "not_configured", "disabled",
  "budget_exhausted", "rate_limited", "timeout", "provider_error", "parse_error",
  "circuit_open", "cancelled", "superseded", "ambiguous_billing", "conflict",
] as const satisfies readonly NormalizedOutcome[];

const NO_RETRY: RetryPolicy = { maxAttempts: 1, retryableOutcomes: [], backoffMs: 0 };
const TRANSIENT_RETRY: RetryPolicy = {
  maxAttempts: 3, retryableOutcomes: ["rate_limited", "timeout", "provider_error"], backoffMs: 1_000,
};
const STANDARD_REDACTION: RedactionPolicy = {
  redactSecrets: true, redactRawResponse: true,
  sensitiveCandidateFields: ["email", "phone", "owner_name", "domain_registrant"],
};
const FETCH_TRANSPORT: TestTransportMetadata = {
  injection: "fetchOverride", fixtureOnly: true, liveCallsAllowedInTests: false,
};
const NO_TRANSPORT: TestTransportMetadata = {
  injection: "not_applicable", fixtureOnly: true, liveCallsAllowedInTests: false,
};

export const REQUIRED_PROVIDER_SOURCE_IDS: readonly ProviderSourceId[] = [
  "zerobounce", "serper", "outscraper", "apify", "apollo", "proxycurl",
  "sunbiz_registry", "first_party_web", "osm", "directories", "rdap", "jsonld",
  "openai_classification", "content_sources", "advisor_sources", "social_only_sources",
] as const;

export const PROVIDER_SOURCE_MANIFEST = [
  {
    id: "zerobounce", capability: ["email_validation"], billing: "paid_per_call", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/sdr/zerobounce.ts"],
    approvedCallers: ["server/services/zerobounce-campaign-worker.ts", "server/services/cro03/live-provider-executors.ts"], secretNames: ["ZEROBOUNCE_API_KEY"],
    durableOperation: "batch", budget: { required: true, accounting: "control_row", unit: "request" },
    timeoutMs: 10_000, retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["email"], redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT,
    notes: "Validation only; a missing key is not_configured and must not cause a live fallback.",
  },
  {
    id: "serper", capability: ["business_discovery", "directory_lookup"], billing: "paid_per_call", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/serper-gateway.ts"],
    approvedCallers: ["server/services/sdr/serper-enrichment.ts", "server/services/sdr/lead-finder.ts", "server/services/cro03/live-provider-executors.ts", "server/services/serper-business-identity.ts"],
    secretNames: ["SERPER_API_KEY"], durableOperation: "request",
    budget: { required: true, accounting: "control_row", unit: "request" }, timeoutMs: 15_000,
    retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["business_name", "website", "phone", "address", "category"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT,
    notes: "All calls flow through SerperGateway and its durable control row.",
  },
  {
    id: "outscraper", capability: ["business_discovery"], billing: "paid_per_result", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/sdr/outscraper.ts"],
    approvedCallers: ["server/services/cro03/live-provider-executors.ts"], secretNames: ["OUTSCRAPER_API_KEY"],
    durableOperation: "request", budget: { required: true, accounting: "control_row", unit: "result" },
    timeoutMs: 60_000, retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["business_name", "website", "email", "phone", "address", "city", "state", "postal_code", "category"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Paid map results require an explicit budget gate.",
  },
  {
    id: "apify", capability: ["business_discovery"], billing: "paid_per_result", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/sdr/apify.ts"],
    approvedCallers: ["server/services/sdr/lead-finder.ts"], secretNames: ["APIFY_API_TOKEN"],
    durableOperation: "actor_run", budget: { required: true, accounting: "usage_setting", unit: "run" },
    timeoutMs: 120_000, retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["business_name", "website", "email", "phone", "address", "city", "state", "postal_code", "category"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT,
    notes: "Only approved non-social actors may be activated; social actors remain excluded below.",
  },
  {
    id: "apollo", capability: ["business_discovery", "contact_enrichment"], billing: "paid_subscription", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/sdr/apollo.ts"],
    approvedCallers: ["server/services/cro03/live-provider-executors.ts"], secretNames: ["APOLLO_API_KEY"],
    durableOperation: "request", budget: { required: true, accounting: "control_row", unit: "result" },
    timeoutMs: 30_000, retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["business_name", "website", "email", "phone", "address", "city", "state", "postal_code", "category", "owner_name", "owner_title"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Contact data is sensitive and response payloads are redacted.",
  },
  {
    id: "proxycurl", capability: ["contact_enrichment"], billing: "paid_per_call", parser: "api",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/linkedin-enrichment.ts"],
    approvedCallers: ["server/routes/contacts.ts"], secretNames: ["PROXYCURL_API_KEY"],
    durableOperation: "request", budget: { required: true, accounting: "usage_setting", unit: "request" },
    timeoutMs: 15_000, retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES,
    candidateFields: ["owner_name", "owner_title", "city", "state"], redaction: STANDARD_REDACTION,
    testTransport: FETCH_TRANSPORT, notes: "LinkedIn-derived enrichment is opt-in only and is not a discovery source.",
  },
  {
    id: "sunbiz_registry", capability: ["registry_lookup"], billing: "free", parser: "html_parser",
    activationPolicy: "free", approvedAdapters: ["server/services/sunbiz-scraper.ts", "server/services/sunbiz-enrichment.ts"],
    approvedCallers: ["server/services/sdr/registry-importer.ts"], secretNames: [], durableOperation: "queue_job",
    budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: 8_000, retry: TRANSIENT_RETRY,
    normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["business_name", "address", "owner_name", "registry_id", "entity_status"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Public registry data; honor source terms and bounded parsing.",
  },
  {
    id: "first_party_web", capability: ["website_parsing"], billing: "free", parser: "html_parser",
    activationPolicy: "free", approvedAdapters: ["server/services/sdr/contactpage-enrichment.ts", "server/services/sunbiz-enrichment.ts"],
    approvedCallers: ["server/services/sdr/lead-finder.ts", "server/services/cro03/live-provider-executors.ts", "server/services/cro03/live-safe-egress.ts"], secretNames: [], durableOperation: "request",
    budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: 6_000, retry: TRANSIENT_RETRY,
    normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["website", "email", "phone", "address"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Only the business's own public site; cap body size and redirects.",
  },
  {
    id: "osm", capability: ["business_discovery", "directory_lookup"], billing: "free", parser: "json_parser",
    activationPolicy: "free", approvedAdapters: ["server/services/sdr/osm-discovery.ts"], approvedCallers: ["server/services/sdr/lead-finder.ts"],
    secretNames: [], durableOperation: "request", budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: 15_000,
    retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["business_name", "website", "phone", "address", "category"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Respect Overpass/OSM usage policy and rate limits.",
  },
  {
    id: "directories", capability: ["directory_lookup"], billing: "free", parser: "html_parser", activationPolicy: "free",
    approvedAdapters: ["server/services/sdr/bbb-discovery.ts", "server/services/sdr/yellowpages-discovery.ts"],
    approvedCallers: ["server/services/sdr/lead-finder.ts"], secretNames: [], durableOperation: "request",
    budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: 10_000, retry: TRANSIENT_RETRY,
    normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["business_name", "website", "phone", "address", "category"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Public directories are corroboration, never sole contact proof.",
  },
  {
    id: "rdap", capability: ["domain_registration_lookup"], billing: "free", parser: "rdap", activationPolicy: "free",
    approvedAdapters: ["server/services/sdr/rdap-enrichment.ts"], approvedCallers: ["server/services/sdr/contactpage-enrichment.ts", "server/services/cro03/live-execution.ts"],
    secretNames: [], durableOperation: "request", budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: 10_000,
    retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["website", "domain_registrant"],
    redaction: STANDARD_REDACTION, testTransport: FETCH_TRANSPORT, notes: "Registrant data is sensitive and must not be used as a contact fallback.",
  },
  {
    id: "jsonld", capability: ["structured_data_parsing"], billing: "free", parser: "json_parser", activationPolicy: "free",
    approvedAdapters: ["server/services/sdr/jsonld-enrichment.ts"], approvedCallers: ["server/services/sdr/contactpage-enrichment.ts", "server/services/cro03/live-execution.ts"],
    secretNames: [], durableOperation: "none", budget: { required: false, accounting: "none", unit: "none" }, timeoutMs: null,
    retry: NO_RETRY, normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["business_name", "website", "email", "phone", "address", "category"],
    redaction: STANDARD_REDACTION, testTransport: NO_TRANSPORT, notes: "Parser only; it operates on an already-authorized first-party page body.",
  },
  {
    id: "openai_classification", capability: ["classification"], billing: "paid_per_call", parser: "llm",
    activationPolicy: "explicit_operator_enablement", approvedAdapters: ["server/services/sunbiz-enrichment.ts"],
    approvedCallers: ["server/services/sunbiz-enrichment.ts", "server/services/cro03/live-provider-executors.ts"], secretNames: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
    durableOperation: "queue_job", budget: { required: true, accounting: "ai_audit", unit: "token" }, timeoutMs: 30_000,
    retry: TRANSIENT_RETRY, normalizedOutcomes: STANDARD_OUTCOMES, candidateFields: ["classification", "summary", "owner_name"],
    redaction: STANDARD_REDACTION,
    testTransport: { injection: "transportOverride", fixtureOnly: true, liveCallsAllowedInTests: false },
    notes: "Classification is bounded to approved, redacted source evidence.",
  },
  {
    id: "content_sources", capability: ["content"], billing: "excluded", parser: "none", activationPolicy: "excluded",
    approvedAdapters: [], approvedCallers: [], secretNames: [], durableOperation: "none", budget: { required: false, accounting: "none", unit: "none" },
    timeoutMs: null, retry: NO_RETRY, normalizedOutcomes: ["excluded"], candidateFields: [], redaction: STANDARD_REDACTION, testTransport: NO_TRANSPORT,
    notes: "Excluded: editorial/blog/content feeds are not candidate or contact sources.",
  },
  {
    id: "advisor_sources", capability: ["advisor"], billing: "excluded", parser: "none", activationPolicy: "excluded",
    approvedAdapters: [], approvedCallers: [], secretNames: [], durableOperation: "none", budget: { required: false, accounting: "none", unit: "none" },
    timeoutMs: null, retry: NO_RETRY, normalizedOutcomes: ["excluded"], candidateFields: [], redaction: STANDARD_REDACTION, testTransport: NO_TRANSPORT,
    notes: "Excluded: advisor/consultant recommendations are not automated evidence.",
  },
  {
    id: "social_only_sources", capability: ["content"], billing: "excluded", parser: "none", activationPolicy: "excluded",
    approvedAdapters: [], approvedCallers: [], secretNames: [], durableOperation: "none", budget: { required: false, accounting: "none", unit: "none" },
    timeoutMs: null, retry: NO_RETRY, normalizedOutcomes: ["excluded"], candidateFields: [], redaction: STANDARD_REDACTION, testTransport: NO_TRANSPORT,
    notes: "Excluded: social-only pages (including Facebook/LinkedIn/Yelp actors) cannot generate candidates.",
  },
] as const satisfies readonly ProviderSourceManifestRow[];

export interface ProviderManifestValidationResult {
  ok: boolean;
  missingRows: ProviderSourceId[];
  errors: string[];
}

/** Validates completeness and makes unsafe paid defaults a startup/test failure. */
export function validateProviderManifest(
  rows: readonly ProviderSourceManifestRow[] = PROVIDER_SOURCE_MANIFEST,
): ProviderManifestValidationResult {
  const errors: string[] = [];
  const ids = new Set(rows.map((row) => row.id));
  const missingRows = REQUIRED_PROVIDER_SOURCE_IDS.filter((id) => !ids.has(id));
  for (const id of missingRows) errors.push(`Provider manifest row missing: ${id}`);
  for (const row of rows) {
    if (rows.filter((candidate) => candidate.id === row.id).length > 1) errors.push(`Duplicate provider manifest row: ${row.id}`);
    if (row.billing === "free" && row.activationPolicy !== "free") errors.push(`${row.id}: free source must use free activation policy`);
    if (row.billing === "excluded" && row.activationPolicy !== "excluded") errors.push(`${row.id}: excluded source must be excluded`);
    if (row.billing.startsWith("paid") && (row.activationPolicy !== "explicit_operator_enablement" || !row.budget.required || row.secretNames.length === 0)) {
      errors.push(`${row.id}: paid source would permit silent activation`);
    }
    if (row.activationPolicy === "excluded" && (row.approvedAdapters.length || row.approvedCallers.length || row.secretNames.length)) {
      errors.push(`${row.id}: excluded source cannot have adapters, callers, or secrets`);
    }
  }
  return { ok: errors.length === 0, missingRows, errors };
}

export function assertValidProviderManifest(rows?: readonly ProviderSourceManifestRow[]): void {
  const result = validateProviderManifest(rows);
  if (!result.ok) throw new Error(`Invalid provider manifest: ${result.errors.join("; ")}`);
}

export interface ProviderActivationRequest {
  sourceId: ProviderSourceId;
  caller: string;
  /** Required for every paid provider; absence is deliberately a denial. */
  explicitPaidApproval?: boolean;
}

/** Rejects excluded/unknown callers and any paid invocation lacking an explicit approval. */
export function assertProviderActivation(request: ProviderActivationRequest): ProviderSourceManifestRow {
  const row = PROVIDER_SOURCE_MANIFEST.find((candidate) => candidate.id === request.sourceId);
  if (!row) throw new Error(`Unknown provider source: ${request.sourceId}`);
  if (row.activationPolicy === "excluded") throw new Error(`Provider source is excluded: ${request.sourceId}`);
  const approvedCallers = row.approvedCallers as readonly string[];
  if (!approvedCallers.includes(request.caller)) throw new Error(`Unapproved provider caller: ${request.caller} -> ${request.sourceId}`);
  if (row.billing.startsWith("paid") && request.explicitPaidApproval !== true) {
    throw new Error(`Paid provider requires explicit approval: ${request.sourceId}`);
  }
  return row;
}