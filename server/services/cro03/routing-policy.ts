import { CRO03_ROUTING_POLICY_VERSION, stableCro03RecipeHash, type Cro03Provider } from "./contracts";
import {
  createCro03RecipeContract, createCro03RecipeStep, type Cro03RecipeContract, type Cro03RecipeStep,
} from "./recipe-contract";

export interface Cro03RoutingInput {
  hasWebsite: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  needsBusinessDiscovery: boolean;
  needsContactEnrichment: boolean;
  needsEmailValidation: boolean;
}

export interface Cro03RoutePlan {
  policyVersion: number;
  providers: Cro03Provider[];
  stopReasons: string[];
  /** Legacy coarse route retained as a seed; execution must use recipeContract. */
  recipes: ReadonlyArray<{ provider: Cro03Provider; operation: string; requiresPaidEligibility: boolean }>;
  /**
   * Present on all newly selected routes. Optional only so legacy persisted
   * coarse-route sentinels remain readable while they are replaced by recipes.
   */
  recipeContract?: Cro03RecipeContract;
  recipeHash?: string;
}

/**
 * Deterministic, selective routing.  ZeroBounce is always last and only
 * eligible for the final email value; no route fans out to every provider.
 */
export function selectCro03Route(input: Cro03RoutingInput): Cro03RoutePlan {
  const providers: Cro03Provider[] = [];
  const stopReasons: string[] = [];
  if (input.needsBusinessDiscovery && !input.hasWebsite && !input.hasPhone) {
    providers.push("outscraper");
    stopReasons.push("business_discovery_first");
  } else if (input.needsContactEnrichment) {
    providers.push("apollo");
    stopReasons.push("organization_person_enrichment");
  } else if (!input.hasWebsite || !input.hasPhone) {
    providers.push("serper");
    stopReasons.push("justified_search_gap");
  } else {
    stopReasons.push("existing_evidence_sufficient");
  }
  if (input.needsEmailValidation && input.hasEmail) providers.push("zerobounce");
  const recipes = providers.map((provider) => ({
    provider,
    operation: provider === "zerobounce" ? "email_validation_backlink" :
      provider === "outscraper" ? "business_discovery" :
        provider === "apollo" ? "contact_enrichment" : "search_enrichment",
    // Outscraper is the narrow discovery-stage exception: it may gather
    // candidate evidence for an unresolved business, but it may not authorize
    // any later paid-enrichment step. Apollo remains link/fence gated.
    requiresPaidEligibility: provider === "apollo",
  }));
  const steps: Cro03RecipeStep[] = recipes.map((recipe) => createCro03RecipeStep({
    provider: recipe.provider,
    operation: recipe.operation,
    inputFields: recipe.provider === "zerobounce" ? ["email"] :
      recipe.provider === "apollo" ? ["business_name", "website", "city", "state"] :
        ["business_name", "website", "phone", "city", "state"],
    outputFields: recipe.provider === "zerobounce" ? ["email"] :
      recipe.provider === "apollo" ? ["email", "phone", "owner_name", "owner_title"] :
        ["business_name", "website", "phone", "address", "city", "state", "postal_code"],
    executionOwner: "provider_adapter",
    accountingOwner: "provider_ledger",
    eligibility: recipe.requiresPaidEligibility ? ["commercial_fence", "provider_enabled", "budget_reserved"] :
      ["provider_enabled", "budget_reserved"],
    maxAttempts: recipe.provider === "zerobounce" ? 2 : 3,
    evidenceTtlSeconds: 30 * 24 * 60 * 60,
    stopConditions: ["subject_superseded", "batch_cancelled", "authoritative_evidence_sufficient"],
    conflictOutcome: "quarantine",
    transitions: {
      success: "next_step_or_completed",
      no_result: "next_step_or_completed",
      retryable_failure: "retry_within_max_attempts",
      conflict: "blocked",
    },
  }));
  const recipeContract = createCro03RecipeContract(steps);
  return {
    policyVersion: CRO03_ROUTING_POLICY_VERSION, providers, stopReasons, recipes, recipeContract,
    recipeHash: stableCro03RecipeHash(recipeContract),
  };
}

export const CRO03_CANARY_DEFINITIONS = Object.freeze([
  { name: "dry-run", maxItems: 0, executable: false, approvals: ["operator", "data", "finance", "legal"] },
  { name: "100-item", maxItems: 100, executable: false, approvals: ["operator", "data", "finance", "legal"] },
  { name: "1,000-item", maxItems: 1000, executable: false, approvals: ["operator", "data", "finance", "legal"] },
] as const);
