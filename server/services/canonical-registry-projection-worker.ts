import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "../db";
import {resolveOrganization} from "./organization-resolver";
import {normalizePhoneE164} from "./sdr/dedupe";
import {assertSystemLinkDatabaseGuard} from "./commercial-link-authority";
import {claimSfpRuntimeDeploymentOwner,lockCurrentSfpRuntimeOwner} from "./cro03/sfp-provider-operations";

const rows=(value:any):any[]=>value?.rows ?? value ?? [];
const text=(value:unknown)=>typeof value==="string" && value.trim() ? value.trim() : null;

/** Fulfill genuine retained registry work through its existing source item.
 * Qualification remains separate. Public registry evidence creates businesses,
 * never fictional people, hygiene receipts, cohorts or provider operations. */
export async function processCanonicalRegistryProjectionTick(limit=10) {
  if (!Number.isInteger(limit) || limit<1 || limit>25) throw new Error("CANONICAL_REGISTRY_LIMIT_INVALID");
  const owner=await claimSfpRuntimeDeploymentOwner();
  const ownerCheck=async(tx:any)=>{
    const live=await lockCurrentSfpRuntimeOwner(tx);
    if (live.ownerEpoch!==owner.ownerEpoch || live.ownerToken!==owner.ownerToken)
      throw new Error("CANONICAL_REGISTRY_RUNTIME_OWNER_CHANGED");
    await assertSystemLinkDatabaseGuard(tx);
  };
  let fulfilled=0,held=0,failed=0;
  for(let index=0;index<limit;index++) {
    const token=randomUUID();
    const candidate=await db.transaction(async tx=>{
      await ownerCheck(tx);
      const selected=rows(await tx.execute(sql`
        SELECT item.id,member.source_subject_id,member.source_observation_id,
          observation.payload,observation.payload_hash,subject.subject_key,subject.source_system,
          source_run.id source_import_run_id
        FROM cro03_enrichment_items item
        JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id AND batch.purpose='staging_review'
        JOIN cro03_batch_memberships member ON member.id=item.membership_id
        JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
        JOIN cro03_source_subjects subject ON subject.id=member.source_subject_id
        JOIN source_import_runs source_run ON
          batch.idempotency_key LIKE 'source-registry:'||source_run.adapter_key||':'||source_run.id::text||':offset-%'
        WHERE source_run.status='completed' AND subject.tombstoned_at IS NULL
          AND batch.idempotency_key LIKE 'source-registry:%'
          AND subject.subject_type='provider_csv_row'
          AND ((item.state='blocked' AND (item.terminal_code='STAGING_RECIPE_DISABLED'
            OR item.terminal_code LIKE 'CANONICAL_REGISTRY_%'))
            OR (item.state='running' AND item.current_provider='canonical_local_registry'
              AND item.lease_expires_at<=clock_timestamp()))
          AND item.next_attempt_at<=clock_timestamp()
        ORDER BY item.next_attempt_at,item.id LIMIT 1 FOR UPDATE OF item SKIP LOCKED
      `))[0];
      if (!selected) return null;
      await tx.execute(sql`UPDATE cro03_enrichment_items
        SET state='running',current_provider='canonical_local_registry',claim_token=${token}::uuid,
          lease_expires_at=clock_timestamp()+INTERVAL '2 minutes',execution_fence=execution_fence+1,
          attempt_count=attempt_count+1,next_attempt_at=clock_timestamp()+INTERVAL '5 minutes',
          completed_at=NULL,updated_at=clock_timestamp()
        WHERE id=${String(selected.id)}::uuid`);
      return selected;
    });
    if (!candidate) break;
    const claimCheck=async(tx:any)=>{
      await ownerCheck(tx);
      return rows(await tx.execute(sql`
        SELECT item.id FROM cro03_enrichment_items item
        JOIN cro03_batch_memberships member ON member.id=item.membership_id
        JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
        JOIN cro03_source_subjects subject ON subject.id=member.source_subject_id
        JOIN source_import_runs source_run ON source_run.id=${String(candidate.source_import_run_id)}::uuid
        WHERE item.id=${String(candidate.id)}::uuid AND item.state='running'
          AND item.current_provider='canonical_local_registry' AND item.claim_token=${token}::uuid
          AND item.lease_expires_at>clock_timestamp() AND subject.tombstoned_at IS NULL
          AND source_run.status='completed'
          AND observation.id=${String(candidate.source_observation_id)}::uuid
          AND observation.payload_hash=${String(candidate.payload_hash)}
        FOR UPDATE OF item
      `)).length===1;
    };
    try {
      const payload=candidate.payload;
      const name=text(payload?.businessName);
      await db.transaction(async tx=>{
        if (!await claimCheck(tx)) throw new Error("CANONICAL_REGISTRY_CLAIM_LOST");
        const resolution=name ? await resolveOrganization({
          canonicalName:name,mainPhone:normalizePhoneE164(text(payload.phone)),
          city:text(payload.city),state:text(payload.state),authorityCheck:claimCheck,transaction:tx,
          sourceIdentity:{sourceSystem:String(candidate.source_system),sourceType:"public_registry",
            stableKey:String(candidate.subject_key)},
           create:{recordClass:"canonical",streetAddress:text(payload.address),postalCode:text(payload.postalCode) ?? text(payload.zip),
            vertical:text(payload.vertical),lastSourceType:String(candidate.source_system)},
        }) : {kind:"deferred" as const,reasonCode:"BUSINESS_IDENTITY_MISSING",candidateIds:[]};
        // Recheck after resolution. Business/source binding and fulfillment
        // commit together or roll back together if authority expires.
        if (!await claimCheck(tx)) throw new Error("CANONICAL_REGISTRY_CLAIM_LOST");
        let businessId:number|null=null;
        let reason:string|null=null;
        if (resolution.kind==="deferred") reason=`CANONICAL_REGISTRY_${resolution.reasonCode}`;
        else {
          businessId=Number(resolution.business.id);
          await tx.execute(sql`INSERT INTO canonical_source_links
            (business_id,source_system,source_type,stable_key,registry_id,raw_evidence)
            VALUES(${businessId},${String(candidate.source_system)},'public_registry',
              ${String(candidate.subject_key)},${String(candidate.source_system)},
              ${JSON.stringify({sourceSubjectId:candidate.source_subject_id,
                sourceObservationId:candidate.source_observation_id,payloadHash:candidate.payload_hash,
                sourceImportRunId:candidate.source_import_run_id,authority:"retained_public_registry"})}::jsonb)
            ON CONFLICT(source_system,source_type,stable_key) DO NOTHING`);
          const link=rows(await tx.execute(sql`SELECT id,business_id FROM canonical_source_links
            WHERE source_system=${String(candidate.source_system)} AND source_type='public_registry'
              AND stable_key=${String(candidate.subject_key)} FOR UPDATE`))[0];
           if (!link || Number(link.business_id)!==businessId) throw new Error("CANONICAL_REGISTRY_STABLE_SOURCE_CONFLICT");
          else await tx.execute(sql`UPDATE canonical_source_links
            SET last_confirmed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${String(link.id)}::uuid`);
        }
        await tx.execute(sql`UPDATE cro03_enrichment_items
          SET state=${reason ? "blocked" : "completed"},
            terminal_code=${reason ?? "CANONICAL_REGISTRY_ENTITY_FULFILLED"},
            claim_token=NULL,lease_expires_at=NULL,current_provider=NULL,
            completed_at=CASE WHEN ${reason}::text IS NULL THEN clock_timestamp() ELSE NULL END,
            updated_at=clock_timestamp()
          WHERE id=${String(candidate.id)}::uuid AND claim_token=${token}::uuid`);
        await tx.execute(sql`INSERT INTO audit_logs(action,entity_type,entity_key,details,actor_type,actor_id)
          VALUES(${reason ? "canonical_registry_projection_held" : "canonical_registry_entity_fulfilled"},
            'cro03_enrichment_item',${String(candidate.id)},
            ${JSON.stringify({sourceImportRunId:candidate.source_import_run_id,
              sourceObservationId:candidate.source_observation_id,businessId,reason,
              candidateIds:resolution.kind==="deferred" ? resolution.candidateIds : [],
              providerCalls:0,contactsCreated:0})}::jsonb,'system','system:canonical-registry-projection')`);
        if (reason) held++; else fulfilled++;
      });
    } catch (error) {
      // Preserve the genuine item and its original observations. Another item
      // can still progress if this one's organization resolution fails.
       const conflict=error instanceof Error && error.message==="CANONICAL_REGISTRY_STABLE_SOURCE_CONFLICT";
       await db.transaction(async tx=>{
        await ownerCheck(tx);
        await tx.execute(sql`UPDATE cro03_enrichment_items SET state='blocked',
           terminal_code=${conflict ? "CANONICAL_REGISTRY_STABLE_SOURCE_CONFLICT" : "CANONICAL_REGISTRY_RETRY_REQUIRED"},claim_token=NULL,lease_expires_at=NULL,
          current_provider=NULL,updated_at=clock_timestamp()
          WHERE id=${String(candidate.id)}::uuid AND claim_token=${token}::uuid AND state='running'`);
      });
      console.error("[CanonicalRegistryProjection] retry required",{itemId:candidate.id,
        code:error instanceof Error ? error.message.split(":")[0] : "UNKNOWN"});
       if(conflict) held++; else failed++;
    }
  }
  return {ran:fulfilled+held+failed>0,fulfilled,held,failed};
}