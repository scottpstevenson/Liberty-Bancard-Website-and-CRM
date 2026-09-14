/**
 * Canonical DBPR-family predicate — single source of truth for excluding
 * DBPR-derived lineage from paid enrichment, promotion, and outreach paths.
 *
 * Load-bearing policy (see task #1956): DBPR ingestion, storage, source
 * lineage linkage, and canonical business materialization are explicitly
 * ALLOWED and must keep working. This module exists only for the specific
 * downstream exclusion boundaries:
 *   - free-enrichment selection
 *   - MI-09 paid-provider cohort selection
 *   - provider-command creation
 *   - provider execution (defense in depth)
 *   - outreach-purpose ZeroBounce validation
 *   - master-lead promotion / readiness
 *   - sequence / campaign / GHL eligibility
 *   - final outreach execution
 *   - CRO-08A recurring enumeration
 *
 * Matching is a case-insensitive substring test for "dbpr", which is
 * delimiter- and casing-agnostic BY CONSTRUCTION — dbpr_hr, dbpr-abt,
 * DBPR_COS, Dbpr-Bar, etc. all match the same way in both TS and SQL forms.
 * Parity between the two forms is asserted in
 * scripts/test-dbpr-predicate-parity.ts.
 */

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** Postgres regex fragment used by every SQL-side DBPR check in this codebase. */
export const DBPR_SQL_REGEX = "dbpr";

/** TypeScript-side canonical predicate. Case/delimiter-agnostic substring match. */
export function isDbprSourceSystem(sourceSystem: string | null | undefined): boolean {
  if (!sourceSystem) return false;
  return /dbpr/i.test(sourceSystem);
}

/**
 * SQL fragment: true when the given text column/expression is DBPR-derived.
 * Use for a same-row `source_system`-shaped column.
 */
export function dbprSourceSystemSql(column: SQLWrapper | SQL): SQL {
  return sql`(${column} ~* ${DBPR_SQL_REGEX})`;
}

/**
 * SQL fragment: true when the given text column/expression is NOT DBPR-derived
 * (or is null). Use for a same-row `source_system`-shaped column.
 */
export function notDbprSourceSystemSql(column: SQLWrapper | SQL): SQL {
  return sql`(${column} IS NULL OR ${column} !~* ${DBPR_SQL_REGEX})`;
}

/**
 * SQL fragment: true when `businessIdExpr` (a business id column/expression)
 * has ANY linked canonical_source_links row whose source_system resolves to
 * DBPR lineage — the "full-family" exclusion used by cohort/promotion
 * boundaries. A business with a DBPR link AND a non-DBPR link is still
 * excluded (any DBPR lineage taints the record for these boundaries).
 */
export function businessHasDbprLineageSql(businessIdExpr: SQLWrapper | SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM canonical_source_links csl
    WHERE csl.business_id = ${businessIdExpr}
      AND csl.source_system ~* ${DBPR_SQL_REGEX}
  )`;
}

/**
 * SQL fragment: true when `businessIdExpr` has NO linked canonical_source_links
 * row resolving to DBPR lineage. Convenience negation of businessHasDbprLineageSql.
 */
export function businessLacksDbprLineageSql(businessIdExpr: SQLWrapper | SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM canonical_source_links csl
    WHERE csl.business_id = ${businessIdExpr}
      AND csl.source_system ~* ${DBPR_SQL_REGEX}
  )`;
}
