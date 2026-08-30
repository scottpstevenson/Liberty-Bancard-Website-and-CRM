import {
  resolveCanonicalVertical,
  SUBVERTICAL_MAP_VERSION,
  type VerticalResolutionResult,
} from "../sdr/canonical-vertical-resolver";

export const CRO03A_VERTICAL_POLICY_VERSION = "canonical-resolver-v1";

export function resolveCro03aVertical(input: {
  vertical?: string | null; subvertical?: string | null;
  verticalSource?: string | null; verticalConfidence?: number | null;
  manualOverride?: boolean | null; sourceSystem?: string | null;
  targetVerticals?: readonly string[];
}): VerticalResolutionResult & { subverticalMapVersion: string; targetVertical: boolean } {
  const source = input.verticalSource
    ?? (input.sourceSystem === "lead_discovery_results" ? "discovery_enrichment" : "import_classification");
  const result = resolveCanonicalVertical({
    merchantVertical: input.vertical, merchantSubvertical: input.subvertical,
    merchantVerticalSource: source, merchantVerticalConfidence: input.verticalConfidence,
    merchantSubverticalSource: source, merchantSubverticalConfidence: input.verticalConfidence,
    merchantManualOverride: input.manualOverride,
  });
  return {
    ...result,
    subverticalMapVersion: SUBVERTICAL_MAP_VERSION,
    targetVertical: (input.targetVerticals ?? ["Auto", "Healthcare", "Salon/Spa"]).includes(result.vertical ?? ""),
  };
}