import { evaluateSouthFloridaGeography, type GeographyResult } from "./geography";
import { resolveCro03aVertical } from "./vertical";

export const CRO03A_FIT_POLICY_VERSION = "fit-v1";
export const CRO03A_FIT_COMPONENT_WEIGHTS = Object.freeze({
  targetCanonicalVertical: 25, eligibleGeography: 25, activeEntityEvidence: 15,
  operatingFootprintPlausibility: 10, merchantSizeComplexity: 10, sourceFreshness: 10, evidenceCoverage: 5,
});
export type Cro03aDisposition = "selected" | "review_required" | "duplicate" | "existing_relationship" | "outside_geography" | "suppressed" | "inactive_entity" | "insufficient_evidence" | "excluded";

export type Cro03aEvaluation = {
  disposition: Cro03aDisposition; score: number; geography: GeographyResult;
  vertical: ReturnType<typeof resolveCro03aVertical>;
  activeStateEvidence: Record<string, unknown>;
  identityRelationshipEvidence: Record<string, unknown>;
  fitComponents: Record<string, number>;
  reasonCodes: string[]; missingFieldClasses: string[];
};

const value = (payload: Record<string, unknown>, ...keys: string[]) =>
  keys.map((key) => payload[key]).find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
const truth = (payload: Record<string, unknown>, ...keys: string[]) => keys.some((key) => payload[key] === true);

export function evaluateCro03aCandidate(input: {
  payload: Record<string, unknown>; sourceSystem: string; observedAt: string;
  now?: string; geography?: Partial<Parameters<typeof evaluateSouthFloridaGeography>[0]>;
  identity?: { exactMatches?: string[]; conflictingExactMatches?: string[]; weakMatches?: string[] };
  relationship?: { existingCustomer?: boolean; openOpportunity?: boolean; dnc?: boolean; suppressed?: boolean };
  policy?: { freshnessDays?: number; selectedMinimum?: number; reviewMinimum?: number };
}): Cro03aEvaluation {
  const payload = input.payload;
  const geography = evaluateSouthFloridaGeography({
    state: input.geography?.state ?? value(payload, "state", "principalState"),
    county: input.geography?.county ?? value(payload, "county", "principalCounty"),
    countyFips: input.geography?.countyFips ?? value(payload, "countyFips", "county_fips"),
    zip: input.geography?.zip ?? value(payload, "zip", "postalCode", "principalZip"),
    city: input.geography?.city ?? value(payload, "city", "principalCity"),
  });
  const source = input.sourceSystem === "lead_discovery_results" ? "discovery_enrichment" : (value(payload, "verticalSource") ?? "import_classification");
  const vertical = resolveCro03aVertical({
    vertical: value(payload, "vertical", "industry"), subvertical: value(payload, "subvertical"),
    verticalSource: source, verticalConfidence: typeof payload.verticalConfidence === "number" ? payload.verticalConfidence : null,
    manualOverride: payload.manualVerticalOverride === true, sourceSystem: input.sourceSystem,
    targetVerticals: (input.policy as any)?.targetVerticals,
  });
  const activeRaw = value(payload, "entityStatus", "status", "enrichmentStatus", "lifecycle", "state");
  const active = !activeRaw || !["inactive", "inactive entity", "dissolved", "revoked", "archived", "suppressed"].includes(activeRaw.toLowerCase());
  const synthetic = truth(payload, "synthetic", "isSynthetic", "test", "isTest");
  const relationship = input.relationship ?? {
    existingCustomer: truth(payload, "existingCustomerFlag", "existingCustomer"),
    openOpportunity: truth(payload, "openOpportunity"),
    dnc: truth(payload, "doNotContactFlag", "doNotContact"),
    suppressed: truth(payload, "suppressed"),
  };
  const exact = input.identity?.exactMatches ?? [];
  const conflict = input.identity?.conflictingExactMatches ?? [];
  const weak = input.identity?.weakMatches ?? [];
  const observed = Date.parse(input.observedAt);
  const now = Date.parse(input.now ?? new Date().toISOString());
  const freshnessDays = input.policy?.freshnessDays ?? 90;
  const fresh = Number.isFinite(observed) && Number.isFinite(now) && now >= observed && now - observed <= freshnessDays * 86400000;
  const hasBusiness = !!value(payload, "businessName", "company", "entityName", "name");
  const hasLocation = !!(value(payload, "state", "principalState") || value(payload, "zip", "postalCode", "principalZip") || value(payload, "city", "principalCity"));
  const hasSource = !!input.sourceSystem;
  const components = {
    targetCanonicalVertical: vertical.targetVertical && !vertical.needsReview ? 25 : 0,
    eligibleGeography: geography.eligible && ["verified", "zip_inferred", "city_inferred"].includes(geography.evidenceClass) ? 25 : 0,
    activeEntityEvidence: active && !synthetic ? 15 : 0,
    operatingFootprintPlausibility: hasBusiness && (!!value(payload, "website", "address", "phone") || hasLocation) ? 10 : 0,
    merchantSizeComplexity: Number(payload.locationCount) > 1 || !!value(payload, "estimatedVolume", "monthlyVolume", "employeeCount") ? 10 : 0,
    sourceFreshness: fresh ? 10 : 0,
    evidenceCoverage: hasBusiness && hasLocation && hasSource ? 5 : 0,
  };
  const score = Object.values(components).reduce((sum, part) => sum + part, 0);
  const reasonCodes: string[] = [...geography.reasonCodes];
  const missing: string[] = [];
  if (!hasBusiness) missing.push("business_identity");
  if (!hasLocation) missing.push("geography");
  if (!vertical.vertical) missing.push("vertical");
  if (!fresh) reasonCodes.push("SOURCE_STALE_OR_TIMESTAMP_UNAVAILABLE");
  if (vertical.needsReview) reasonCodes.push("VERTICAL_REVIEW_REQUIRED");
  if (weak.length) reasonCodes.push("WEAK_IDENTITY_REQUIRES_REVIEW");
  let disposition: Cro03aDisposition;
  if (synthetic) { disposition = "excluded"; reasonCodes.push("SYNTHETIC_OR_TEST_SOURCE"); }
  else if (relationship.dnc || relationship.suppressed) { disposition = "suppressed"; reasonCodes.push("SUPPRESSION_OR_DNC"); }
  else if (relationship.existingCustomer || relationship.openOpportunity) { disposition = "existing_relationship"; reasonCodes.push(relationship.existingCustomer ? "EXISTING_CUSTOMER" : "OPEN_OPPORTUNITY"); }
  else if (conflict.length) { disposition = "review_required"; reasonCodes.push("CONFLICTING_STRONG_IDENTIFIERS"); }
  else if (exact.length) { disposition = "existing_relationship"; reasonCodes.push("EXACT_STRONG_IDENTITY_MATCH"); }
  else if (!active) { disposition = "inactive_entity"; reasonCodes.push("INACTIVE_ENTITY"); }
  else if (!geography.eligible && geography.evidenceClass === "verified") { disposition = "outside_geography"; }
  else if (!geography.eligible || geography.evidenceClass === "conflicting" || geography.evidenceClass === "unknown" || vertical.needsReview || weak.length) { disposition = "review_required"; }
  else if (score >= (input.policy?.selectedMinimum ?? 70)) disposition = "selected";
  else if (score >= (input.policy?.reviewMinimum ?? 50)) disposition = "review_required";
  else disposition = "insufficient_evidence";
  return {
    disposition, score, geography, vertical,
    activeStateEvidence: { rawStatus: activeRaw ?? null, active, synthetic },
    identityRelationshipEvidence: { exactMatches: exact, conflictingExactMatches: conflict, weakMatches: weak, ...relationship },
    fitComponents: components, reasonCodes: [...new Set(reasonCodes)], missingFieldClasses: missing,
  };
}