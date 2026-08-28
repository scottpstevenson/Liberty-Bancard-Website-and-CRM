import { createHash } from "crypto";

export const CRO03_SCHEMA_VERSION = 1;
export const CRO03_SELECTION_POLICY_VERSION = 1;
export const CRO03_ROUTING_POLICY_VERSION = 1;

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

export function normalizeCandidateValue(field: Cro03CandidateField, value: string): string {
  const trimmed = value.trim();
  if (field === "email") return trimmed.toLowerCase();
  if (field === "phone") return trimmed.replace(/[^\d+]/g, "");
  if (field === "website") return trimmed.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  return trimmed.replace(/\s+/g, " ").toLowerCase();
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
