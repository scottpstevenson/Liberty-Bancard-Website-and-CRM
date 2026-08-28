import { CRO03_ROUTING_POLICY_VERSION, type Cro03Provider } from "./contracts";

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
  return { policyVersion: CRO03_ROUTING_POLICY_VERSION, providers, stopReasons };
}

export const CRO03_CANARY_DEFINITIONS = Object.freeze([
  { name: "dry-run", maxItems: 0, executable: false, approvals: ["operator", "data", "finance", "legal"] },
  { name: "100-item", maxItems: 100, executable: false, approvals: ["operator", "data", "finance", "legal"] },
  { name: "1,000-item", maxItems: 1000, executable: false, approvals: ["operator", "data", "finance", "legal"] },
] as const);
