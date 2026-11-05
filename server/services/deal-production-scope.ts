/**
 * One definition of "a production deal" for Stage 5 reads (readiness, underwriting queue, MID registry).
 * Archived, lost and test/demo/synthetic deals are never operational work. The predicate is SQL text so
 * every reader applies the same rule; `alias` must be a trusted literal.
 */
export const NON_PRODUCTION_RECORD_CLASSES = ["test", "demo", "synthetic"] as const;
export const CLOSED_LOST_STAGES = ["Closed Lost", "Disqualified"] as const;

export function productionDealSql(alias = "d"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("invalid alias");
  const classes = NON_PRODUCTION_RECORD_CLASSES.map((c) => `'${c}'`).join(",");
  return `${alias}.archived_at IS NULL AND COALESCE(${alias}.record_class,'unknown') NOT IN (${classes})`;
}

export function operationalDealSql(alias = "d"): string {
  const stages = CLOSED_LOST_STAGES.map((c) => `'${c}'`).join(",");
  return `${productionDealSql(alias)} AND ${alias}.stage NOT IN (${stages})`;
}

/** Pure form for already-loaded rows. */
export function dealExclusionReason(d: {
  archived_at?: unknown; archivedAt?: unknown; record_class?: string | null; recordClass?: string | null; stage?: string | null;
}): "archived" | "non_production" | "closed_lost" | null {
  if (d.archived_at ?? d.archivedAt) return "archived";
  const rc = (d.record_class ?? d.recordClass ?? "unknown") as string;
  if ((NON_PRODUCTION_RECORD_CLASSES as readonly string[]).includes(rc)) return "non_production";
  if ((CLOSED_LOST_STAGES as readonly string[]).includes(String(d.stage ?? ""))) return "closed_lost";
  return null;
}
