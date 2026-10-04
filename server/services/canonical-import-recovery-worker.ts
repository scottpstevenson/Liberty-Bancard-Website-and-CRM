import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "../db";
import {materializeCanonicalProviderImportRow} from "./canonical-provider-import";
import {assertSystemLinkDatabaseGuard} from "./commercial-link-authority";
import {claimSfpRuntimeDeploymentOwner,lockCurrentSfpRuntimeOwner} from "./cro03/sfp-provider-operations";
const rows=(value:any):any[]=>value?.rows ?? value ?? [];

/** Local fulfillment of retained, completed imports through their ORIGINAL
 * source work items. No fabricated import, cohort, approval or provider run. */
export async function processCanonicalImportRecoveryTick() {
  const owner=await claimSfpRuntimeDeploymentOwner();
  const ownerAuthorityCheck=async(tx:any)=>{
    const live=await lockCurrentSfpRuntimeOwner(tx);
    if (live.ownerEpoch!==owner.ownerEpoch || live.ownerToken!==owner.ownerToken)
      throw new Error("CANONICAL_IMPORT_RECOVERY_RUNTIME_OWNER_CHANGED");
    await assertSystemLinkDatabaseGuard(tx);
  };
  let fulfilled=0,held=0;
  // Legacy mapped observations are not original raw rows. Account for missing
  // originals on the genuine source item, without inventing a replacement
  // payload, changing the old row disposition, or silently excluding the row.
  const unavailable=await db.transaction(async tx=>{
    await ownerAuthorityCheck(tx);
    return rows(await tx.execute(sql`UPDATE cro03_enrichment_items item
      SET terminal_code='CANONICAL_IMPORT_ORIGINAL_RAW_UNAVAILABLE',updated_at=clock_timestamp()
      FROM cro03_enrichment_batches batch,cro03_batch_memberships member,
        cro03_source_observations observation,import_row_dispositions accounting,import_executions execution
      WHERE item.batch_id=batch.id AND item.membership_id=member.id
        AND observation.id=member.source_observation_id AND batch.purpose='staging_review'
        AND batch.idempotency_key='csv-source:'||accounting.execution_id::text||':'||accounting.source_row_number::text
        AND observation.payload->>'rowFingerprint'=accounting.row_fingerprint
        AND accounting.execution_id=execution.id AND accounting.disposition='deferred'
        AND execution.status='completed'
        AND observation.payload->>'sourceFormat' IN ('google_maps_outscraper','apollo_lead_list')
        AND item.state='blocked' AND (item.terminal_code='STAGING_RECIPE_DISABLED'
          OR item.terminal_code LIKE 'CANONICAL_IMPORT_%')
        AND item.terminal_code IS DISTINCT FROM 'CANONICAL_IMPORT_ORIGINAL_RAW_UNAVAILABLE'
        AND jsonb_typeof(execution.source_payload->(accounting.source_row_number-1)) IS DISTINCT FROM 'object'
        AND NOT EXISTS(SELECT 1 FROM cro03_enrichment_batches rb
          JOIN cro03_batch_memberships rm ON rm.batch_id=rb.id
          JOIN cro03_source_observations ro ON ro.id=rm.source_observation_id
          WHERE rb.idempotency_key='csv-source-raw-v2:'||execution.id::text||':'||accounting.source_row_number::text
            AND jsonb_typeof(ro.payload->'rawSourceRow')='object')
      RETURNING item.id`));
  });
  held+=unavailable.length;
  for (let index=0;index<5;index++) {
    const token=randomUUID();
    const candidate=await db.transaction(async tx=>{
      await ownerAuthorityCheck(tx);
      const selected=rows(await tx.execute(sql`SELECT item.id,execution.id execution_id,
        accounting.source_row_number,observation.payload->>'sourceFormat' source_format,
        COALESCE(CASE WHEN jsonb_typeof(raw_observation.payload->'rawSourceRow')='object'
          THEN raw_observation.payload->'rawSourceRow' END,
          CASE WHEN jsonb_typeof(execution.source_payload->(accounting.source_row_number-1))='object'
          THEN execution.source_payload->(accounting.source_row_number-1) END) raw_row,execution.metadata
        FROM cro03_enrichment_items item
        JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id AND batch.purpose='staging_review'
        JOIN cro03_batch_memberships member ON member.id=item.membership_id
        JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
        JOIN import_row_dispositions accounting ON
          batch.idempotency_key='csv-source:'||accounting.execution_id::text||':'||accounting.source_row_number::text
          AND accounting.disposition='deferred'
          AND observation.payload->>'rowFingerprint'=accounting.row_fingerprint
        JOIN import_executions execution ON execution.id=accounting.execution_id AND execution.status='completed'
        LEFT JOIN cro03_enrichment_batches raw_batch ON
          raw_batch.idempotency_key='csv-source-raw-v2:'||execution.id::text||':'||accounting.source_row_number::text
        LEFT JOIN cro03_batch_memberships raw_member ON raw_member.batch_id=raw_batch.id
        LEFT JOIN cro03_source_observations raw_observation ON raw_observation.id=raw_member.source_observation_id
        WHERE observation.payload->>'sourceFormat' IN ('google_maps_outscraper','apollo_lead_list')
          AND (jsonb_typeof(raw_observation.payload->'rawSourceRow')='object'
            OR jsonb_typeof(execution.source_payload->(accounting.source_row_number-1))='object')
          AND ((item.state='blocked' AND (
            item.terminal_code='STAGING_RECIPE_DISABLED' OR item.terminal_code LIKE 'CANONICAL_IMPORT_%'))
            OR (item.state='running' AND item.current_provider='canonical_local_import'
              AND item.lease_expires_at<=clock_timestamp()))
          AND item.next_attempt_at<=clock_timestamp()
        ORDER BY item.next_attempt_at,item.id LIMIT 1 FOR UPDATE OF item SKIP LOCKED`))[0];
      if (!selected) return null;
      await tx.execute(sql`UPDATE cro03_enrichment_items SET state='running',
        current_provider='canonical_local_import',claim_token=${token}::uuid,
        lease_expires_at=clock_timestamp()+INTERVAL '2 minutes',execution_fence=execution_fence+1,
        attempt_count=attempt_count+1,next_attempt_at=clock_timestamp()+INTERVAL '5 minutes',
        updated_at=clock_timestamp() WHERE id=${String(selected.id)}::uuid`);
      return selected;
    });
    if (!candidate) break;
    try {
      const result=await materializeCanonicalProviderImportRow({
        executionId:String(candidate.execution_id),sourceRowNumber:Number(candidate.source_row_number),
        sourceFormat:String(candidate.source_format),rawRow:candidate.raw_row,
        actorId:"system:canonical-import-recovery",
        recoveryClaim:{itemId:String(candidate.id),claimToken:token},ownerAuthorityCheck,
        sourceCoordinate:candidate.metadata?.sourceCoordinates?.[Number(candidate.source_row_number)-1],
        fileName:candidate.metadata?.fileName,
      });
      if ("fulfillmentState" in result && result.fulfillmentState==="held") {held++;continue;}
      await db.transaction(async tx=>{
        await ownerAuthorityCheck(tx);
        const receipt=rows(await tx.execute(sql`UPDATE cro03_enrichment_items
          SET state='completed',terminal_code='CANONICAL_LOCAL_IMPORT_FULFILLED',
            claim_token=NULL,lease_expires_at=NULL,current_provider=NULL,completed_at=clock_timestamp(),
            updated_at=clock_timestamp()
          WHERE id=${String(candidate.id)}::uuid AND state='running'
            AND claim_token=${token}::uuid AND lease_expires_at>clock_timestamp() RETURNING id`));
        if (!receipt.length) throw new Error("CANONICAL_IMPORT_RECOVERY_FINALIZATION_LEASE_LOST");
        await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,details,actor_type,actor_id)
          VALUES('canonical_import_row_fulfilled','cro03_enrichment_item',${String(candidate.id)},
            ${JSON.stringify({executionId:candidate.execution_id,sourceRowNumber:candidate.source_row_number,
              originalDisposition:result.disposition,businessId:result.businessId,contactIds:result.contactIds,
              paidProviderCalls:0,outboundChanges:0})}::jsonb,'system','system:canonical-import-recovery')`);
      });
      fulfilled++;
    } catch (error) {
      await db.transaction(async tx=>{
        await ownerAuthorityCheck(tx);
        await tx.execute(sql`UPDATE cro03_enrichment_items SET state='blocked',
          terminal_code='CANONICAL_IMPORT_RECOVERY_RETRY_REQUIRED',claim_token=NULL,lease_expires_at=NULL,
          current_provider=NULL,updated_at=clock_timestamp()
          WHERE id=${String(candidate.id)}::uuid AND state='running' AND claim_token=${token}::uuid`);
      });
      throw error;
    }
  }
  return {ran:fulfilled+held>0,fulfilled,held};
}