import {sql} from "drizzle-orm";
import {canonicalRecoverableImportAccountingSql,CANONICAL_IMPORT_FULFILLMENT_QUALIFICATION_VERSION} from "../../server/services/canonical-import-recovery-contract";

/** Frozen regression oracle copied from the execution baseline
 * 94a4742d5d1953ea8102071aee2b9b5553ad1d06. Test-only: never a recovery entrypoint.
 * Execute this actual locking/payload query, not a grep or simplified count,
 * against the SAME preserved fixture before exercising the corrected selector. */
export function legacyRetainedSelectorSql() {
  return sql`WITH selected_import AS MATERIALIZED (
    SELECT item.id,execution.id execution_id,accounting.source_row_number,
      observation.payload->>'sourceFormat' source_format,raw_observation.id raw_observation_id
    FROM cro03_enrichment_items item
    JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id AND batch.purpose='staging_review'
    JOIN cro03_batch_memberships member ON member.id=item.membership_id
    JOIN LATERAL (
      SELECT original.payload FROM cro03_source_observations original
      WHERE original.id=member.source_observation_id OFFSET 0
    ) observation ON TRUE
    JOIN import_row_dispositions accounting ON
      batch.idempotency_key='csv-source:'||accounting.execution_id::text||':'||accounting.source_row_number::text
      AND ${canonicalRecoverableImportAccountingSql()}
      AND observation.payload->>'rowFingerprint'=accounting.row_fingerprint
    JOIN import_executions execution ON execution.id=accounting.execution_id AND execution.status='completed'
    LEFT JOIN cro03_enrichment_batches raw_batch ON
      raw_batch.idempotency_key='csv-source-raw-v2:'||execution.id::text||':'||accounting.source_row_number::text
    LEFT JOIN cro03_batch_memberships raw_member ON raw_member.batch_id=raw_batch.id
    LEFT JOIN cro03_source_observations raw_observation ON raw_observation.id=raw_member.source_observation_id
    WHERE observation.payload->>'sourceFormat' IN ('google_maps_outscraper','apollo_lead_list')
      AND (item.terminal_code IS DISTINCT FROM 'CANONICAL_IMPORT_ORIGINAL_RAW_UNAVAILABLE'
        OR jsonb_typeof(raw_observation.payload->'rawSourceRow')='object'
        OR jsonb_typeof(execution.source_payload->(accounting.source_row_number-1))='object')
      AND ((item.state='blocked' AND (
        item.terminal_code='STAGING_RECIPE_DISABLED' OR item.terminal_code LIKE 'CANONICAL_IMPORT_%'))
        OR (item.state='running' AND item.current_provider='canonical_local_import'
          AND item.lease_expires_at<=clock_timestamp())
        OR (item.state='completed' AND item.terminal_code='CANONICAL_LOCAL_IMPORT_FULFILLED'
          AND NOT EXISTS (SELECT 1 FROM audit_logs fulfillment
            WHERE fulfillment.entity_type='cro03_enrichment_item' AND fulfillment.entity_key=item.id::text
              AND fulfillment.action='canonical_import_row_fulfilled'
              AND fulfillment.details->>'qualificationVersion'=${CANONICAL_IMPORT_FULFILLMENT_QUALIFICATION_VERSION})))
      AND item.next_attempt_at<=clock_timestamp()
    ORDER BY item.next_attempt_at,item.id LIMIT 1 FOR UPDATE OF item SKIP LOCKED
  )
  SELECT selected_import.id,selected_import.execution_id,selected_import.source_row_number,
    selected_import.source_format,
    COALESCE(CASE WHEN jsonb_typeof(raw_observation.payload->'rawSourceRow')='object'
      THEN raw_observation.payload->'rawSourceRow' END,
      CASE WHEN jsonb_typeof(execution.source_payload->(selected_import.source_row_number-1))='object'
      THEN execution.source_payload->(selected_import.source_row_number-1) END) raw_row,
    execution.metadata
  FROM selected_import JOIN import_executions execution ON execution.id=selected_import.execution_id
  LEFT JOIN cro03_source_observations raw_observation ON raw_observation.id=selected_import.raw_observation_id`;
}
