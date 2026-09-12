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
export const CRO03C_CURRENT_MIGRATION_HEAD = "0260_mi07_dedup_unique_indexes" as const;

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
  "lead_discovery_result", "master_lead", "business",
] as const;
export type Cro03SourceSubjectType = typeof CRO03_SOURCE_SUBJECT_TYPES[number];

export const CRO03_CANDIDATE_DISPOSITIONS = [
  "staged", "accepted", "rejected", "duplicate", "quarantined", "excluded", "superseded",
] as const;
export type Cro03CandidateDisposition = typeof CRO03_CANDIDATE_DISPOSITIONS[number];

// MI-06: Email discovery status enum (matches DB CHECK constraint in migration 0255).
export const EMAIL_DISCOVERY_STATUSES = [
  "absent", "discovered", "syntax_invalid", "placeholder", "no_mx", "dns_indeterminate",
  "disposable", "no_valid_candidate", "provider_valid", "provider_invalid", "provider_catch_all",
  "provider_unknown", "provider_spamtrap", "stale", "bounced", "suppressed",
] as const;
export type EmailDiscoveryStatus = typeof EMAIL_DISCOVERY_STATUSES[number];

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

// ── Shared pricing-artifact → price-schedule shape logic ────────────────────
//
// This is the ONE place that turns a set of mi09_pricing_artifacts rows into
// the composite price schedule shape CRO-03C activation and the CRO-03D
// ceremony both consume. Both the ceremony script (which reads artifact rows
// over HTTP as plain JSON) and the server-side MI-09 pricing/snapshot service
// (which reads the same rows straight from Postgres) call this so the two
// paths can never independently drift on "latest artifact per provider" or
// on field-shape. Kept dependency-free (no db import) so it can be imported
// from either side.

/** The row shape returned by both `getPricingArtifacts()` (raw SQL) and the
 * `GET /api/lead-ops/pilot/pricing-artifacts` JSON response — the two are
 * required to stay identical since one is a direct passthrough of the other. */
export interface Cro03PricingArtifactRow {
  readonly id: string;
  readonly provider_key: string;
  readonly unit_type: string;
  readonly currency?: string | null;
  readonly amount_micros: number | string;
  readonly billing_semantics: string;
  readonly artifact_version?: number | string | null;
  readonly captured_at: string | Date;
}

export interface Cro03PriceScheduleEntry {
  readonly version: number;
  readonly unitType: string;
  readonly currency: string;
  readonly amountMicros: number;
  readonly billingSemantics: string;
}

/** Latest artifact per provider_key, by captured_at. */
export function selectLatestCro03PricingArtifacts(
  artifacts: readonly Cro03PricingArtifactRow[],
): Record<string, Cro03PricingArtifactRow> {
  const byProvider: Record<string, Cro03PricingArtifactRow> = {};
  for (const artifact of artifacts) {
    const key = String(artifact.provider_key);
    const existing = byProvider[key];
    if (!existing || new Date(artifact.captured_at).getTime() > new Date(existing.captured_at).getTime()) {
      byProvider[key] = artifact;
    }
  }
  return byProvider;
}

/**
 * Builds the exact composite price-schedule shape the CRO-03C activation
 * policy and the CRO-03D ceremony script expect: one entry per
 * CRO03C_PROVIDER_KEYS, each `{version, unitType, currency, amountMicros,
 * billingSemantics}`, taken from the latest artifact per provider. Throws if
 * any provider is missing an artifact — this is the single source of truth
 * for "is pricing fully seeded".
 */
export function buildCro03PriceScheduleFromArtifacts(
  artifacts: readonly Cro03PricingArtifactRow[],
): { schedule: Record<string, Cro03PriceScheduleEntry>; latestByProvider: Record<string, Cro03PricingArtifactRow> } {
  const allLatestByProvider = selectLatestCro03PricingArtifacts(artifacts);
  const missing = (CRO03C_PROVIDER_KEYS as readonly string[]).filter((provider) => !allLatestByProvider[provider]);
  if (missing.length > 0) {
    throw new Error(`CRO03_PRICING_ARTIFACTS_MISSING:${missing.join(",")}`);
  }
  // Restrict to EXACTLY the 9 canonical CRO03C_PROVIDER_KEYS. selectLatestCro03PricingArtifacts()
  // returns the latest artifact for every provider_key present in the raw rows — including any
  // non-canonical key an admin write path might have stored — so this filter is required to keep
  // both the schedule and the returned artifact-ID set to exactly the canonical 9 providers.
  const schedule: Record<string, Cro03PriceScheduleEntry> = {};
  const latestByProvider: Record<string, Cro03PricingArtifactRow> = {};
  for (const provider of CRO03C_PROVIDER_KEYS as readonly string[]) {
    const artifact = allLatestByProvider[provider];
    latestByProvider[provider] = artifact;
    schedule[provider] = {
      version: Number(artifact.artifact_version ?? 1),
      unitType: String(artifact.unit_type),
      currency: String(artifact.currency ?? "USD"),
      amountMicros: Number(artifact.amount_micros),
      billingSemantics: String(artifact.billing_semantics),
    };
  }
  return { schedule, latestByProvider };
}
