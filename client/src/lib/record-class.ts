/**
 * Record-class vocabulary for daily views. The class is the authoritative value stored on the record; a view never
 * infers it from a name. Production is the default scope for every KPI, queue, board and drilldown, and a record
 * that is not production is always labelled where it appears.
 */
export type RecordClassValue = "production" | "test" | "demo" | "synthetic" | "unknown" | "canonical";

export const RECORD_CLASS_LABELS: Record<string, string> = {
  production: "Production",
  test: "Test record",
  demo: "Demo record",
  synthetic: "Synthetic record",
  unknown: "Class not reviewed",
  canonical: "Canonical business",
};

const RECORD_CLASS_EXPLANATIONS: Record<string, string> = {
  test: "A test record. It is excluded from production counts, boards and queues.",
  demo: "A demo record. It is excluded from production counts, boards and queues.",
  synthetic: "A system-generated record. It is excluded from production counts, boards and queues.",
  unknown: "The class has not been reviewed. Unreviewed records are never counted as production.",
};

export const isProductionClass = (value: unknown) => value === "production";

/** Null when the record is production or the class is not known; otherwise the label shown on the record. */
export function recordClassBadge(value: unknown): { label: string; title: string; tone: "warn" | "muted" } | null {
  if (typeof value !== "string" || !value || value === "production" || value === "canonical") return null;
  return {
    label: RECORD_CLASS_LABELS[value] ?? `Class: ${value}`,
    title: RECORD_CLASS_EXPLANATIONS[value] ?? "This record is not in the production class.",
    tone: value === "unknown" ? "muted" : "warn",
  };
}

export const PRODUCTION_SCOPE_COPY = "Production records only. Test, demo, synthetic, unreviewed and archived records are not counted here.";
export const PRODUCTION_SCOPE_REVIEW_COPY = "Review them on People with the Record class filter.";
