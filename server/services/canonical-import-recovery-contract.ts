import {sql} from "drizzle-orm";

export type CanonicalImportRecoveryClaim={itemId:string;claimToken:string};
export async function hasCanonicalImportRecoveryClaim(tx:any,input:{
  executionId:string;sourceRowNumber:number;rowFingerprint:string;
  recoveryClaim:CanonicalImportRecoveryClaim;
}):Promise<boolean> {
  const result=await tx.execute(sql`SELECT item.id
    FROM cro03_enrichment_items item
    JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id
    JOIN cro03_batch_memberships member ON member.id=item.membership_id
    JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
    JOIN import_executions execution ON execution.id=${input.executionId}::uuid
      AND execution.status='completed'
    JOIN import_row_dispositions accounting ON accounting.execution_id=execution.id
      AND accounting.source_row_number=${input.sourceRowNumber}
      AND accounting.row_fingerprint=${input.rowFingerprint} AND accounting.disposition='deferred'
    WHERE item.id=${input.recoveryClaim.itemId}::uuid
      AND item.claim_token=${input.recoveryClaim.claimToken}::uuid
      AND item.state='running' AND item.lease_expires_at>clock_timestamp()
      AND item.current_provider='canonical_local_import'
      AND batch.purpose='staging_review'
      AND batch.idempotency_key=${`csv-source:${input.executionId}:${input.sourceRowNumber}`}
      AND observation.payload->>'rowFingerprint'=${input.rowFingerprint}
    FOR UPDATE OF item`);
  return (result?.rows ?? result ?? []).length===1;
}