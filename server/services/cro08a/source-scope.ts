/**
 * CRO-08A non-DBPR source-scope contract (enrichment master-prompt §5).
 *
 * CRO-08A's continuous factory (scheduler + processor) may only ever touch
 * the canonical enrichment source systems below. DBPR source families
 * (dbpr-hr, dbpr-abt, dbpr-cos, dbpr-bar) and any other DBPR-derived lineage
 * must be rejected — not silently skipped — at every layer that selects,
 * freezes, or enumerates a source scope for CRO-08A.
 *
 * This module is deliberately pure (no DB import) so it can be shared by the
 * scheduler worker, the processor worker, and the schedule-authority
 * creation-time validator without creating an import cycle or a hidden DB
 * dependency in a purely-computational check.
 */

/**
 * The only source systems CRO-08A's continuous factory is authorized to
 * enumerate. Must match the real `source_system` values ever written to
 * `cro03a_census_cursors` — verified against the live table, not assumed
 * from table names. Canonical `businesses`/`contacts` are NOT yet census
 * sources (a separate, still-open gap — see master-prompt §3); do not add
 * them here until CRO03A actually emits cursors for them.
 */
export const CRO08A_ALLOWED_SOURCE_SYSTEMS = [
  "lead_discovery_results",
  "master_leads",
  "prospects",
  "sdr_merchants",
  "sunbiz_entities",
] as const;

export type Cro08aAllowedSourceSystem = typeof CRO08A_ALLOWED_SOURCE_SYSTEMS[number];

const ALLOWED_SET = new Set<string>(CRO08A_ALLOWED_SOURCE_SYSTEMS);

/** True if `sourceSystem` resolves to DBPR lineage by name (direct or aliased). */
export function isDbprSourceSystem(sourceSystem: string): boolean {
  return /dbpr/i.test(sourceSystem);
}

/**
 * Reject (throw), not silently skip, any source system outside the allowlist
 * or matching DBPR lineage. Call this at every layer that selects a source
 * scope for CRO-08A: schedule-definition creation, scheduler cursor
 * selection/snapshot freezing, occurrence creation, and processor
 * enumeration.
 */
export function assertCro08aSourceScope(sourceSystems: readonly string[]): void {
  for (const sourceSystem of sourceSystems) {
    if (isDbprSourceSystem(sourceSystem)) {
      throw new Error(
        `CRO08A_SOURCE_SCOPE_DBPR_REJECTED: source system "${sourceSystem}" resolves to DBPR lineage ` +
        `and is permanently excluded from the CRO-08A continuous enrichment factory.`,
      );
    }
    if (!ALLOWED_SET.has(sourceSystem)) {
      throw new Error(
        `CRO08A_SOURCE_SCOPE_NOT_ALLOWLISTED: source system "${sourceSystem}" is not in ` +
        `CRO08A_ALLOWED_SOURCE_SYSTEMS. Add it explicitly (and confirm it is not DBPR-derived) ` +
        `before CRO-08A may enumerate it.`,
      );
    }
  }
}

/** Filter a set of source systems down to the allowed, non-DBPR scope. */
export function filterToCro08aSourceScope(sourceSystems: readonly string[]): string[] {
  return sourceSystems.filter((s) => !isDbprSourceSystem(s) && ALLOWED_SET.has(s));
}
