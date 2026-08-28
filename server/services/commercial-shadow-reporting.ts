/**
 * CRO-02's reporting boundary.  This service intentionally returns and stores
 * aggregates only; it must never be extended with samples or subject IDs.
 */
import { pool } from "../db";
import { CRO02_POLICY_VERSION, CRO02_SCHEMA_VERSION, type CommercialEffect } from "./commercial-resolution";

const CLASSES = ["production", "test", "demo", "synthetic", "unknown"];
const PROVENANCE = ["verified", "untraceable", "legacy_unknown", "conflicted", "invalid"];
const IDENTITY = ["resolved", "unresolved", "collision", "conflicted", "legacy_unknown"];
const LINKS = ["verified", "missing", "conflicted", "legacy_unknown", "rejected"];
const RELATIONSHIPS = ["decision_maker", "not_decision_maker", "unknown", "conflicted"];
const REASONS = ["SUBJECT_MISSING", "REQUIRED_LINK_MISSING", "DANGLING_LINK", "REDIRECT_UNRESOLVED", "IDENTITY_COLLISION", "ROOT_CLASS_NON_PRODUCTION", "ROOT_CLASS_CONFLICT", "PROVENANCE_UNTRACEABLE", "PROVENANCE_CONFLICT", "BUSINESS_LINK_UNRESOLVED", "RELATIONSHIP_UNKNOWN", "RELATIONSHIP_CONFLICT", "SNAPSHOT_MISSING", "EVIDENCE_INVALID", "STALE_GRAPH"];

export const CRO02_EFFECTS: readonly CommercialEffect[] = [
  "inbound_transactional_acknowledgement", "account_transactional", "internal_notification",
  "marketing_outreach", "commercial_reporting", "financial_payout", "provider_pre_spend", "internal_test",
] as const;

type ReportUser = { role?: string; email?: string | null };
const privileged = (u: ReportUser) => u.role === "admin" || u.role === "manager";
const zero = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<string, number>;
const add = (into: Record<string, number>, rows: any[]) => {
  for (const row of rows) into[String(row.key)] = Number(row.count);
  return into;
};

/**
 * One repeatable-read snapshot supplies the complete root denominator and the
 * latest retained resolution per distinct subject. Passive authorization never
 * writes snapshots, so repeat reads cannot inflate coverage or discrepancies.
 */
export async function readCommercialShadowReport(user: ReportUser, purpose: CommercialEffect) {
  if (!privileged(user)) throw new Error("COMMERCIAL_SHADOW_REPORT_FORBIDDEN");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const values: unknown[] = [purpose, CRO02_POLICY_VERSION, CRO02_SCHEMA_VERSION];
    const scope = privileged(user) ? "all" : "owned_or_unassigned";
    const result = await client.query(`
      WITH meta AS (
        SELECT CURRENT_TIMESTAMP AS as_of,
          txid_snapshot_xmax(txid_current_snapshot())::bigint AS coverage_high_water,
          c.schema_version, c.mode
        FROM commercial_shadow_controls c WHERE c.control_key='commercial'
      ), universe AS (
        SELECT 'contact'::text AS subject_type, id::bigint AS subject_id FROM contacts
        UNION ALL SELECT 'deal', id::bigint FROM deals
        UNION ALL SELECT 'prospect', id::bigint FROM prospects
        UNION ALL SELECT 'company', id::bigint FROM companies
        UNION ALL SELECT 'business', id::bigint FROM businesses
      ), latest AS (
        SELECT DISTINCT ON (s.requested_subject_type, s.requested_subject_id)
          s.requested_subject_type, s.requested_subject_id, s.record_class,
          s.provenance_resolution, s.identity_resolution,
          s.organization_link_resolution, s.relationship_resolution,
          s.reason_codes, s.resolution,
          CASE
            WHEN $1 IN ('inbound_transactional_acknowledgement','account_transactional')
              THEN s.record_class IN ('production','unknown')
            WHEN $1 = 'internal_test' THEN false
            ELSE s.record_class = 'production'
          END AS legacy_allowed
        FROM commercial_resolution_snapshots s
        JOIN universe u
          ON u.subject_type=s.requested_subject_type
         AND u.subject_id=s.requested_subject_id
        WHERE s.purpose=$1 AND s.policy_version=$2 AND s.schema_version=$3
        ORDER BY s.requested_subject_type, s.requested_subject_id, s.created_at DESC, s.id DESC
      ), bucket_rows AS (
        SELECT 'class'::text AS kind, record_class::text AS key FROM latest
        UNION ALL SELECT 'provenance', provenance_resolution::text FROM latest
        UNION ALL SELECT 'identity', identity_resolution::text FROM latest
        UNION ALL SELECT 'organizationLink', organization_link_resolution::text FROM latest
        UNION ALL SELECT 'relationship', relationship_resolution::text FROM latest
        UNION ALL SELECT 'legacy', CASE WHEN legacy_allowed THEN 'allowed' ELSE 'denied' END FROM latest
        UNION ALL SELECT 'shadow', CASE WHEN resolution='allowed' THEN 'allowed' ELSE 'quarantined' END FROM latest
        UNION ALL SELECT 'discrepancy',
          CASE
            WHEN legacy_allowed = (resolution='allowed') THEN 'MATCH'
            WHEN legacy_allowed THEN 'LEGACY_ALLOWED_CRO02_QUARANTINED'
            ELSE 'LEGACY_DENIED_CRO02_ALLOWED'
          END
        FROM latest
        UNION ALL SELECT 'reason', jsonb_array_elements_text(reason_codes) FROM latest
      ), buckets AS (
        SELECT kind, key, COUNT(*)::int AS count FROM bucket_rows GROUP BY kind,key
      )
      SELECT (SELECT COUNT(*)::int FROM universe) AS denominator,
        (SELECT COUNT(*)::int FROM latest) AS evaluated,
        (SELECT jsonb_agg(buckets) FROM buckets) AS buckets,
        (SELECT as_of FROM meta) AS as_of, (SELECT coverage_high_water FROM meta) AS high_water,
        (SELECT schema_version FROM meta) AS schema_version, (SELECT mode FROM meta) AS mode
    `, values);
    await client.query("COMMIT");
    const row = result.rows[0] ?? {};
    const buckets = row.buckets ?? [];
    const from = (kind: string, seed: string[]) => add(zero(seed), buckets.filter((b: any) => b.kind === kind));
    const discrepancy = from("discrepancy", ["MATCH", "LEGACY_ALLOWED_CRO02_QUARANTINED", "LEGACY_DENIED_CRO02_ALLOWED"]);
    const legacy = from("legacy", ["allowed", "denied"]);
    const shadow = from("shadow", ["allowed", "quarantined"]);
    return {
      purpose, mode: "shadow", scope, policyVersion: CRO02_POLICY_VERSION,
      schemaVersion: Number(row.schema_version ?? CRO02_SCHEMA_VERSION),
      asOf: new Date(row.as_of).toISOString(), frozenHighWater: Number(row.high_water ?? 0),
      denominator: Number(row.denominator ?? 0), evaluated: Number(row.evaluated ?? 0),
       coverage: { class: from("class", CLASSES), provenance: from("provenance", PROVENANCE), identity: from("identity", IDENTITY), organizationLink: from("organizationLink", LINKS), relationship: from("relationship", RELATIONSHIPS), reason: from("reason", REASONS), legacy, shadow },
      discrepancies: discrepancy,
      reconciliation: {
         equation: "denominator = evaluated + snapshotMissing; evaluated = legacy.allowed + legacy.denied = shadow.allowed + shadow.quarantined = sum(discrepancy)",
        snapshotMissing: Math.max(0, Number(row.denominator ?? 0) - Number(row.evaluated ?? 0)),
        discrepancyTotal: Object.values(discrepancy).reduce((a, b) => a + b, 0),
        diagnosticBuckets: "Axis and reason buckets overlap and must not be summed.",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
