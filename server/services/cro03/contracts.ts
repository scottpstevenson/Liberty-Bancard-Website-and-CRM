import { createHash } from "crypto";

export const CRO03_SCHEMA_VERSION = 1;
export const CRO03_SELECTION_POLICY_VERSION = 1;
export const CRO03_ROUTING_POLICY_VERSION = 1;
export const CRO03_SOURCE_STAGING_RECIPE_VERSION = 1;
/** Version of the immutable, per-step execution recipe. */
export const CRO03_RECIPE_CONTRACT_VERSION = 1;
export const CRO03_CRAWL_POLICY_VERSION = 1;
export const CRO03_HASH_ALGORITHM_VERSION = "sha256-v1" as const;
/** Single release/migration binding shared by CRO03C authorities and workers.
 * Kept here rather than live-execution so provider-readiness-control can verify
 * it without importing an executor that itself calls readiness control. */
export const CRO03C_CURRENT_MIGRATION_HEAD = "0202_cro03c_transport_invocation_checkpoint" as const;

/** The one-time initial-rollout singleton key. Kept here (not live-execution)
 * so dependency-free callers — e.g. an operator discovery tool that must not
 * pull in server/db — can reference the exact key without importing an
 * executor that itself imports the database. */
export const CRO03C_INITIAL_ROLLOUT_KEY = "cro03c_initial_v1" as const;

/** Canonical list of CRO-03C provider keys (mirrors the keys of
 * CRO03C_PROVIDER_CONTRACTS in live-execution.ts). Kept here, dependency-free,
 * for the same reason as CRO03C_INITIAL_ROLLOUT_KEY above. live-execution.ts
 * asserts its contract-object keys equal this list, so the two cannot drift
 * silently. */
export const CRO03C_PROVIDER_KEYS = [
  "internal_source", "first_party_web", "rdap", "jsonld", "serper", "outscraper", "openai", "apollo", "zerobounce",
] as const;

export const CRO03_SOURCE_SUBJECT_TYPES = [
  "contact", "prospect", "sunbiz_entity", "sdr_merchant", "provider_csv_row", "public_web",
  "lead_discovery_result", "master_lead",
] as const;
export type Cro03SourceSubjectType = typeof CRO03_SOURCE_SUBJECT_TYPES[number];

export const CRO03_CANDIDATE_DISPOSITIONS = [
  "staged", "accepted", "rejected", "duplicate", "quarantined", "excluded", "superseded",
] as const;
export type Cro03CandidateDisposition = typeof CRO03_CANDIDATE_DISPOSITIONS[number];

export const CRO03_PROVIDERS = ["zerobounce", "serper", "outscraper", "apollo"] as const;
export type Cro03Provider = typeof CRO03_PROVIDERS[number];

export const CRO03_ITEM_STATES = [
  "queued", "running", "waiting", "completed", "failed", "cancelled", "superseded", "blocked",
] as const;
export type Cro03ItemState = typeof CRO03_ITEM_STATES[number];

export const CRO03_PROVIDER_OUTCOMES = [
  "success", "no_result", "invalid_input", "not_configured", "disabled", "budget_exhausted",
  "rate_limited", "timeout", "provider_error", "parse_error", "circuit_open", "cancelled",
  "superseded", "ambiguous_billing", "conflict", "excluded",
] as const;
export type Cro03ProviderOutcome = typeof CRO03_PROVIDER_OUTCOMES[number];

export const CRO03_BILLING_DISPOSITIONS = [
  "none", "outstanding", "consumed", "released", "refunded", "ambiguous",
] as const;
export type Cro03BillingDisposition = typeof CRO03_BILLING_DISPOSITIONS[number];

export const CRO03_CANDIDATE_FIELDS = [
  "business_name", "website", "email", "phone", "address", "city", "state",
  "postal_code", "category", "owner_name", "owner_title", "registry_id",
  "entity_status", "domain_registrant", "classification", "summary",
] as const;
export type Cro03CandidateField = typeof CRO03_CANDIDATE_FIELDS[number];

export type Cro03ItemDisposition = "executable" | "blocked" | "staging" | "superseded" | "deleted";

/** Comparison keys are deliberately lossy; never use them as display values. */
export function normalizeCandidateValue(field: Cro03CandidateField, value: string): string {
  const trimmed = value.trim();
  if (field === "email") return trimmed.toLowerCase();
  if (field === "phone") return trimmed.replace(/[^\d+]/g, "");
  if (field === "website") return trimmed.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

/** The value that may be projected after authority/arbitration succeeds. */
export function canonicalCandidateDisplay(_field: Cro03CandidateField, value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function candidateHash(field: Cro03CandidateField, value: string): string {
  return createHash("sha256").update(`${field}\0${normalizeCandidateValue(field, value)}`).digest("hex");
}

export function maskCandidate(field: Cro03CandidateField, value: string): string {
  const normalized = normalizeCandidateValue(field, value);
  if (field === "email") {
    const [local, domain = ""] = normalized.split("@");
    return `${(local || "").slice(0, 1)}***@${domain.slice(0, 2)}***`;
  }
  if (field === "phone") return `***${normalized.slice(-4)}`;
  if (normalized.length <= 4) return "***";
  return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
}

export function stableSelectionHash(subjectIds: readonly number[]): string {
  return createHash("sha256").update([...subjectIds].sort((a, b) => a - b).join(",")).digest("hex");
}

/** CRO-03A hashes the complete source identity, never an array ordinal. */
export function stableCro03aSelectionHash(occurrenceIds: readonly string[]): string {
  return createHash("sha256").update([...occurrenceIds].sort().join("\0")).digest("hex");
}

export function stableCro03CommandFingerprint(input: {
  subjectIds: readonly number[];
  purpose: string;
  selectionPolicyVersion: number;
  routingPolicyVersion: number;
}): string {
  return createHash("sha256").update(JSON.stringify({
    purpose: input.purpose,
    routingPolicyVersion: input.routingPolicyVersion,
    selectionPolicyVersion: input.selectionPolicyVersion,
    subjectIds: [...input.subjectIds].sort((a, b) => a - b),
  })).digest("hex");
}

/** Canonical JSON used when evidence must be hashed independently of key order. */
export function stableCro03Json(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCro03Json).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableCro03Json(record[key])}`).join(",")}}`;
}

export function stableCro03RecipeHash(recipe: unknown): string {
  return createHash("sha256").update(stableCro03Json(recipe)).digest("hex");
}

export function normalizeProviderOutcome(value: unknown): Cro03ProviderOutcome {
  if (typeof value !== "string") return "provider_error";
  if ((CRO03_PROVIDER_OUTCOMES as readonly string[]).includes(value)) return value as Cro03ProviderOutcome;
  if (value === "completed" || value === "valid") return "success";
  if (value === "unknown" || value === "empty" || value === "no_match") return "no_result";
  if (value === "unavailable") return "provider_error";
  return "provider_error";
}

export function assertCro03Provider(provider: string): asserts provider is Cro03Provider {
  if (!(CRO03_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`CRO03_PROVIDER_NOT_ALLOWED:${provider}`);
  }
}
