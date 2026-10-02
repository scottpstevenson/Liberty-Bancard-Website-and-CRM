export interface SfpAiVerticalResult {
  outcome: "target" | "non_target" | "review_required";
  confidence: number;
  reasonCodes: string[];
  resolvedVerticalId: string | null;
}

export function sfpAiVerticalResponseSchema(targetIds: string[]) {
  return {
    name: "sfp_vertical_classification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["target", "non_target", "review_required"] },
        confidence: { type: "number" },
        reasonCodes: { type: "array", items: { type: "string" } },
        resolvedVerticalId: { type: ["string", "null"], enum: [...new Set(targetIds), null] },
      },
      required: ["outcome", "confidence", "reasonCodes", "resolvedVerticalId"],
      additionalProperties: false,
    },
  };
}

/** A generic "target" is not a usable vertical classification. */
export function validateSfpAiVerticalResult(value: unknown, targetIds: string[]): SfpAiVerticalResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || !["outcome", "confidence", "reasonCodes", "resolvedVerticalId"].every(k => keys.includes(k))) return null;
  if (!["target", "non_target", "review_required"].includes(String(record.outcome))) return null;
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) return null;
  if (!Array.isArray(record.reasonCodes) || !record.reasonCodes.every(r => typeof r === "string")) return null;
  if (record.outcome === "target") {
    if (typeof record.resolvedVerticalId !== "string" || !targetIds.includes(record.resolvedVerticalId)) return null;
  } else if (record.resolvedVerticalId !== null) return null;
  return {
    outcome: record.outcome as SfpAiVerticalResult["outcome"],
    confidence: Math.max(0, Math.min(1, record.confidence)),
    reasonCodes: record.reasonCodes.slice(0, 20) as string[],
    resolvedVerticalId: record.resolvedVerticalId as string | null,
  };
}