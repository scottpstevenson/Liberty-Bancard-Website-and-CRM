import {sql} from "drizzle-orm";

export type CanonicalImportRecoveryClaim={itemId:string;claimToken:string};
export const CANONICAL_IMPORT_FULFILLMENT_QUALIFICATION_VERSION="mailbox_business_link_v1";
/** An original staging infrastructure failure is not an identity/safety denial.
 * Retry only this evidenced failure class, preserving its immutable receipt.
 * Other originally failed imports do not become recoverable by default. */
export function canonicalRecoverableImportAccountingSql() {
  return sql`(accounting.disposition='deferred' OR (
    accounting.disposition='failed' AND accounting.reason_code='RECOVERY_PROVIDER_STAGING_FAILED'))`;
}
export async function hasCanonicalImportRecoveryClaim(tx:any,input:{
  executionId:string;sourceRowNumber:number;rowFingerprint:string;
  recoveryClaim:CanonicalImportRecoveryClaim;
  renew?:boolean;
}):Promise<boolean> {
  // Lock first, evaluate expiry AFTER any lock wait. A heartbeat may only
  // extend its own LIVE claim, never revive an expired or replaced token.
  const pinned=sql`SELECT item.id,item.claim_token,item.lease_expires_at,item.state
    FROM cro03_enrichment_items item
    JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id
    JOIN cro03_batch_memberships member ON member.id=item.membership_id
    JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
    JOIN import_executions execution ON execution.id=${input.executionId}::uuid
      AND execution.status='completed'
    JOIN import_row_dispositions accounting ON accounting.execution_id=execution.id
      AND accounting.source_row_number=${input.sourceRowNumber}
      AND accounting.row_fingerprint=${input.rowFingerprint} AND ${canonicalRecoverableImportAccountingSql()}
    WHERE item.id=${input.recoveryClaim.itemId}::uuid
      AND item.claim_token=${input.recoveryClaim.claimToken}::uuid
      AND item.state='running'
      AND item.current_provider='canonical_local_import'
      AND batch.purpose='staging_review'
      AND batch.idempotency_key=${`csv-source:${input.executionId}:${input.sourceRowNumber}`}
      AND observation.payload->>'rowFingerprint'=${input.rowFingerprint}
    FOR UPDATE OF item`;
  const result=await tx.execute(input.renew
    ? sql`WITH pinned AS MATERIALIZED (${pinned})
      UPDATE cro03_enrichment_items item SET
        lease_expires_at=clock_timestamp()+INTERVAL '2 minutes'
      FROM pinned WHERE item.id=pinned.id
        AND pinned.lease_expires_at>clock_timestamp()
        AND item.claim_token=${input.recoveryClaim.claimToken}::uuid AND item.state='running'
      RETURNING item.id`
    : sql`WITH pinned AS MATERIALIZED (${pinned})
      SELECT id FROM pinned WHERE lease_expires_at>clock_timestamp()`);
  return (result?.rows ?? result ?? []).length===1;
}