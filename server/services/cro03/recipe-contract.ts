import {
  CRO03_CRAWL_POLICY_VERSION, CRO03_RECIPE_CONTRACT_VERSION, type Cro03CandidateField,
  type Cro03Provider,
} from "./contracts";

export type Cro03RecipeStage =
  | Cro03Provider | "internal_source" | "public_web" | "rdap" | "jsonld" | "openai"
  | "arbitration" | "canonical_projection" | "finalization";
export type Cro03ExecutionOwner =
  | "scheduler" | "provider_adapter" | "safe_egress" | "serper_gateway"
  | "ai_audit_authority" | "arbitration_authority" | "contact_writer"
  | "validation_intent_authority";
export type Cro03ConflictOutcome = "quarantine" | "retain_existing" | "manual_review";

export interface Cro03RecipeStep {
  readonly id: string;
  readonly provider: Cro03RecipeStage;
  readonly operation: string;
  readonly inputFields: readonly Cro03CandidateField[];
  readonly outputFields: readonly Cro03CandidateField[];
  readonly executionOwner: Cro03ExecutionOwner;
  readonly accountingOwner: "provider_ledger" | "serper_gateway" | "ai_token_authority" | "validation_worker" | "none";
  readonly eligibility: readonly string[];
  readonly maxAttempts: number;
  readonly evidenceTtlSeconds: number;
  readonly stopConditions: readonly string[];
  readonly conflictOutcome: Cro03ConflictOutcome;
  readonly transitions: Readonly<Record<"success" | "no_result" | "retryable_failure" | "conflict", string>>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The only public-web traversal permitted by CRO-03. */
export const CRO03_BOUNDED_CRAWL_POLICY = deepFreeze({
  version: CRO03_CRAWL_POLICY_VERSION,
  entrypoint: "homepage",
  sameRegistrableDomain: true,
  allowedPathKinds: ["homepage", "contact", "about", "team", "location"] as const,
  maxPages: 5,
  maxRedirects: 3,
  maxBytesPerPage: 512 * 1024,
  allowedContentTypes: ["text/html", "application/json", "text/plain"] as const,
  deniedResourceKinds: ["pdf", "image", "social", "arbitrary_traversal"] as const,
  // Registry data may corroborate domain/entity linkage only. It is never an
  // owner or email source, and crawl output may not invent either field.
  rdap: { corroborationOnly: true, outputFields: ["domain_registrant", "registry_id", "entity_status"] as const },
  crawlOutputFields: ["website", "phone", "address", "city", "state", "postal_code"] as const,
});

const transition = (next: string) => ({
  success: next, no_result: next, retryable_failure: "retry_or_stop", conflict: "manual_review",
} as const);

/** Frozen end-to-end recipe. Each stage has exactly one execution/accounting owner. */
export const CRO03B_UNIFIED_RECIPE = createCro03RecipeContract([
  createCro03RecipeStep({
    id: "internal-source", provider: "internal_source", operation: "consume_frozen_handoff",
    inputFields: ["business_name"], outputFields: ["business_name", "website", "phone", "address", "city", "state", "postal_code", "registry_id", "entity_status"],
    executionOwner: "scheduler", accountingOwner: "none", eligibility: ["admitted_handoff"],
    maxAttempts: 1, evidenceTtlSeconds: 90 * 86400, stopConditions: ["handoff_revoked", "identity_conflict"],
    conflictOutcome: "manual_review", transitions: transition("public-web"),
  }),
  createCro03RecipeStep({
    id: "public-web", provider: "public_web", operation: "bounded_first_party_crawl",
    inputFields: ["website"], outputFields: [...CRO03_BOUNDED_CRAWL_POLICY.crawlOutputFields],
    executionOwner: "safe_egress", accountingOwner: "none", eligibility: ["verified_https_domain", "robots_allowed"],
    maxAttempts: 2, evidenceTtlSeconds: 30 * 86400, stopConditions: ["five_pages", "same_site_only", "identity_conflict"],
    conflictOutcome: "manual_review", transitions: transition("rdap"),
  }),
  createCro03RecipeStep({
    id: "rdap", provider: "rdap", operation: "domain_corroboration",
    inputFields: ["website"], outputFields: [...CRO03_BOUNDED_CRAWL_POLICY.rdap.outputFields],
    executionOwner: "safe_egress", accountingOwner: "none", eligibility: ["verified_domain"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["domain_mismatch"],
    conflictOutcome: "manual_review", transitions: transition("jsonld"),
  }),
  createCro03RecipeStep({
    id: "jsonld", provider: "jsonld", operation: "extract_authorized_page_child_evidence",
    inputFields: ["website"], outputFields: ["business_name", "phone", "address", "city", "state", "postal_code"],
    executionOwner: "safe_egress", accountingOwner: "none", eligibility: ["parent_page_operation_completed"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["parent_operation_missing"],
    conflictOutcome: "manual_review", transitions: transition("serper"),
  }),
  createCro03RecipeStep({
    id: "serper", provider: "serper", operation: "justified_gap_search",
    inputFields: ["business_name", "city", "state"], outputFields: ["website", "phone", "address"],
    executionOwner: "serper_gateway", accountingOwner: "serper_gateway", eligibility: ["unresolved_gap"],
    maxAttempts: 1, evidenceTtlSeconds: 14 * 86400, stopConditions: ["budget_or_circuit_blocked"],
    conflictOutcome: "manual_review", transitions: transition("outscraper"),
  }),
  createCro03RecipeStep({
    id: "outscraper", provider: "outscraper", operation: "business_search",
    inputFields: ["business_name", "city", "state"], outputFields: ["business_name", "website", "phone", "address", "city", "state", "postal_code"],
    executionOwner: "provider_adapter", accountingOwner: "provider_ledger", eligibility: ["strong_anchor_required"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["weak_anchor", "ambiguous_billing"],
    conflictOutcome: "manual_review", transitions: transition("openai"),
  }),
  createCro03RecipeStep({
    id: "openai", provider: "openai", operation: "evidence_synthesis",
    inputFields: ["business_name", "website", "address"], outputFields: ["classification", "summary"],
    executionOwner: "ai_audit_authority", accountingOwner: "ai_token_authority", eligibility: ["bounded_evidence_bundle"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["token_cap", "evidence_conflict"],
    conflictOutcome: "manual_review", transitions: transition("apollo"),
  }),
  createCro03RecipeStep({
    id: "apollo", provider: "apollo", operation: "organization_people_search",
    inputFields: ["business_name", "website", "city", "state"], outputFields: ["owner_name", "owner_title", "email", "phone"],
    executionOwner: "provider_adapter", accountingOwner: "provider_ledger", eligibility: ["frozen_organization_binding", "versioned_title_policy"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["ambiguous_person", "wrong_organization", "ambiguous_billing"],
    conflictOutcome: "manual_review", transitions: transition("arbitration"),
  }),
  createCro03RecipeStep({
    id: "arbitration", provider: "arbitration", operation: "deterministic_field_arbitration",
    inputFields: [], outputFields: [],
    executionOwner: "arbitration_authority", accountingOwner: "none", eligibility: ["candidate_set_frozen"],
    maxAttempts: 1, evidenceTtlSeconds: 86400, stopConditions: ["tie", "minimum_margin", "protected_conflict"],
    conflictOutcome: "manual_review", transitions: transition("canonical-projection"),
  }),
  createCro03RecipeStep({
    id: "canonical-projection", provider: "canonical_projection", operation: "local_only_authority_projection",
    inputFields: [], outputFields: [],
    executionOwner: "contact_writer", accountingOwner: "none", eligibility: ["arbitration_terminal"],
    maxAttempts: 3, evidenceTtlSeconds: 86400, stopConditions: ["cas_conflict", "ambiguous_link"],
    conflictOutcome: "manual_review", transitions: transition("finalization"),
  }),
  createCro03RecipeStep({
    id: "finalization", provider: "finalization", operation: "winning_email_validation_intent",
    inputFields: ["email"], outputFields: [],
    executionOwner: "validation_intent_authority", accountingOwner: "validation_worker", eligibility: ["projection_and_link_terminal"],
    maxAttempts: 1, evidenceTtlSeconds: 30 * 86400, stopConditions: ["current_generation_validation_pending"],
    conflictOutcome: "retain_existing", transitions: transition("complete"),
  }),
]);

/** Conservative URL gate for a crawl scheduler; it never discovers arbitrary links. */
export function isCro03BoundedCrawlTarget(homepage: string, target: string): boolean {
  let home: URL;
  let candidate: URL;
  try {
    home = new URL(homepage);
    candidate = new URL(target, home);
  } catch {
    return false;
  }
  if (home.protocol !== "https:" || candidate.protocol !== "https:") return false;
  if (registrableDomain(home.hostname) !== registrableDomain(candidate.hostname)) return false;
  const path = candidate.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return path === "/" || /\/(contact|about|team|location)(?:[-_/].*)?$/.test(path);
}

/** Kept local and conservative: unknown public suffixes are never widened. */
function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return hostname.toLowerCase();
  const twoPartSuffixes = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "com.br"]);
  const suffix = labels.slice(-2).join(".");
  return twoPartSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join(".") : suffix;
}

function freezeStep(step: Cro03RecipeStep): Cro03RecipeStep {
  return Object.freeze({
    ...step,
    inputFields: Object.freeze([...step.inputFields]),
    outputFields: Object.freeze([...step.outputFields]),
    eligibility: Object.freeze([...step.eligibility]),
    stopConditions: Object.freeze([...step.stopConditions]),
    transitions: Object.freeze({ ...step.transitions }),
  });
}

export function createCro03RecipeStep(input: Omit<Cro03RecipeStep, "id"> & { id?: string }): Cro03RecipeStep {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("CRO03_RECIPE_MAX_ATTEMPTS_INVALID");
  if (!Number.isInteger(input.evidenceTtlSeconds) || input.evidenceTtlSeconds < 1) throw new Error("CRO03_RECIPE_EVIDENCE_TTL_INVALID");
  return freezeStep({
    ...input,
    id: input.id ?? `${input.provider}:${input.operation}`,
  });
}

export interface Cro03RecipeContract {
  readonly version: number;
  readonly steps: readonly Cro03RecipeStep[];
  readonly crawlPolicy: typeof CRO03_BOUNDED_CRAWL_POLICY;
}

export function createCro03RecipeContract(steps: readonly Cro03RecipeStep[]): Cro03RecipeContract {
  return deepFreeze({
    version: CRO03_RECIPE_CONTRACT_VERSION,
    steps: Object.freeze([...steps]),
    crawlPolicy: CRO03_BOUNDED_CRAWL_POLICY,
  });
}