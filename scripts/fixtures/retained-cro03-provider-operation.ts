/** Retained legacy reservation data for current accounting/recovery owners.
 * This fixture never issues a provider context or re-approves a retired caller. */
import {randomUUID} from "node:crypto";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
export async function retainedCro03ProviderOperation(pool:any,input:{provider:string;operationIdempotencyKey:string;targetFingerprint:string;purpose:string;requestedUnits?:number;providerRunId:string;[key:string]:unknown}) {
  await assertDisposableTestInfrastructure({operation:"retained CRO03 accounting reservation fixture"});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`fixture:${input.provider}:${input.operationIdempotencyKey}`]);
    const prior=(await client.query('SELECT id FROM provider_operations WHERE provider=$1 AND idempotency_key=$2',[input.provider,input.operationIdempotencyKey])).rows[0];
    if(prior){await client.query('COMMIT');return {operationId:String(prior.id)};}
    const units=input.requestedUnits??1,id=randomUUID();
    await client.query(`INSERT INTO provider_operations(id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state,requested_units,reserved_units,billing_state,claim_token,lease_expires_at,started_at)
      VALUES($1,$2,'cro03_enrichment',$3,$4,'cro03_worker',$5,'running',$6,$6,'reserved',$7,NOW()+interval '5 minutes',NOW())`,[id,input.provider,input.purpose,input.operationIdempotencyKey,input.targetFingerprint,units,randomUUID()]);
    await client.query(`UPDATE provider_controls SET reserved_units=reserved_units+$2,version=version+1 WHERE provider=$1`,[input.provider,units]);
    const linked=await client.query(`UPDATE cro03_provider_runs SET operation_id=$2,state='reserved',billing_disposition='outstanding',authorization_context_hash=$3 WHERE id=$1 AND state='planned' RETURNING id`,[input.providerRunId,id,'a'.repeat(64)]);
    if(linked.rowCount!==1)throw Error('RETAINED_PROVIDER_FIXTURE_RUN_NOT_PLANNED');
    await client.query(`INSERT INTO cro03_provider_ledger(provider_run_id,provider_operation_id,provider,entry_key,event_type,disposition,units) VALUES($1,$2,$3,$4,'reservation','outstanding',$5)`,[input.providerRunId,id,input.provider,`reserve:${input.providerRunId}`,units]);
    await client.query('COMMIT');return {operationId:id};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
