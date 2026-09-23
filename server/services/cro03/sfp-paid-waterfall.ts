/** Bounded, ROI-ordered paid escalation for the South Florida program. */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getPaidProviderControls } from "../paid-provider-control";
import { lookupBusinessIdentity } from "../serper-business-identity";
import { runFreeEnrichmentLane } from "../free-enrichment-lane";
import {
  assertCurrentSfpProviderReservation,
  currentSfpUnitPrice,
  reserveSfpProviderOperation,
  settleSfpProviderOperation,
} from "./sfp-provider-operations";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export async function previewSfpPaidWaterfall(cohortRunId: string) {
  const cohort = rows(await db.execute(sql`
    SELECT r.id,r.cohort_hash,r.cohort_state,r.voided_at,r.superseded_at,p.is_active
      FROM sfp_cohort_runs r JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id=${cohortRunId}::uuid
  `))[0];
  if (!cohort) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (cohort.cohort_state !== "frozen" || cohort.voided_at || cohort.superseded_at) {
    throw new Error(`SFP_COHORT_NOT_USABLE:state=${cohort.cohort_state}`);
  }
  const eligible = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_cohort_members m
     WHERE m.cohort_run_id=${cohortRunId}::uuid
       AND NOT EXISTS (SELECT 1 FROM free_discovery_candidates c
                        WHERE c.business_id=m.business_id AND c.disposition IN ('staged','validation_admitted'))
  `))[0];
  const controls = await getPaidProviderControls();
  const supported = new Set(["serper"]);
  return {
    cohortRunId,
    programActive:Boolean(cohort.is_active),
    businessesNeedingPaidDiscovery:Number(eligible?.count ?? 0),
    providers: await Promise.all(controls.providers.map(async (p: any) => ({
      ...p,
      executableForSfp: supported.has(String(p.provider)),
      unitPriceMicros: supported.has(String(p.provider))
        ? await currentSfpUnitPrice("serper").catch(() => null) : null,
      role: p.provider === "serper" ? "find/corroborate the official domain, then rerun the free first-party crawler"
        : p.provider === "zerobounce" ? "validation stage, not discovery"
        : p.provider === "openai" ? "classification only; never invents contact facts"
        : "not admitted to the independent SFP execution boundary",
    }))),
    waterfall:["serper","free_first_party_recrawl"],
    note:"Apollo/Outscraper/OpenAI remain available through the canonical CRO-03C command pipeline; this endpoint will not bypass that authority by calling their adapters directly.",
  };
}

export async function executeSfpSerperDiscovery(input: {
  cohortRunId:string;
  idempotencyKey:string;
  actorId:string;
  maxBusinesses?:number;
}) {
  const maxBusinesses=Math.max(1,Math.min(25,Number(input.maxBusinesses ?? 10)));
  const existing=rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='paid_waterfall' AND idempotency_key=${input.idempotencyKey} LIMIT 1
  `))[0];
  if(existing?.state==='completed') return {stageRunId:String(existing.id),replayed:true,processed:Number(existing.processed_count),succeeded:Number(existing.succeeded_count),failed:Number(existing.failed_count)};
  const stage=existing ?? rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,started_at,last_heartbeat_at)
    VALUES(${input.cohortRunId}::uuid,'paid_waterfall',${input.idempotencyKey},${input.actorId},'authorized',${maxBusinesses},'["serper"]'::jsonb,NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];
  const targets=rows(await db.execute(sql`
    SELECT b.id,b.canonical_name,b.city,b.state,b.postal_code,b.street_address,b.website_domain,m.roi_score
      FROM sfp_cohort_members m JOIN businesses b ON b.id=m.business_id
     WHERE m.cohort_run_id=${input.cohortRunId}::uuid
       AND NOT EXISTS (SELECT 1 FROM free_discovery_candidates c WHERE c.business_id=b.id AND c.disposition IN ('staged','validation_admitted'))
     ORDER BY m.roi_score DESC,b.id ASC LIMIT ${maxBusinesses}
  `));
  await db.execute(sql`UPDATE sfp_stage_runs SET selected_count=${targets.length},updated_at=NOW() WHERE id=${String(stage.id)}::uuid`);
  let succeeded=0,failed=0,noResult=0,freeRecrawlFailed=0;
  for(const target of targets){
    let reservation:Awaited<ReturnType<typeof reserveSfpProviderOperation>>|null=null;
    try{
      reservation=await reserveSfpProviderOperation({
        stageRunId:String(stage.id),cohortRunId:input.cohortRunId,businessId:Number(target.id),provider:"serper",
        purpose:"sfp_official_domain_discovery",idempotencyKey:`${input.idempotencyKey}:serper:${target.id}`,
        actorId:input.actorId,units:4,
      });
      await assertCurrentSfpProviderReservation(reservation);
      const outcome=await lookupBusinessIdentity({
        businessName:String(target.canonical_name),zip:target.postal_code,city:target.city,state:target.state,address:target.street_address,
      },{caller:"server/services/cro03/sfp-paid-waterfall.ts"});
      if(outcome.kind==='accepted_match' && outcome.accepted){
        let domain:string|null=null;
        if(outcome.accepted.website){
          try{domain=new URL(outcome.accepted.website.startsWith('http')?outcome.accepted.website:`https://${outcome.accepted.website}`).hostname.replace(/^www\./,'').toLowerCase();}catch{domain=null;}
        }
        await db.execute(sql`
          UPDATE businesses SET website_domain=COALESCE(website_domain,${domain}),main_phone=COALESCE(main_phone,${outcome.accepted.phone}),updated_at=NOW()
           WHERE id=${Number(target.id)}
        `);
        await settleSfpProviderOperation({reservation,outcome:'completed',observation:'unknown',businessId:Number(target.id),settledUnits:outcome.requestsUsed});
        if(domain){
          // Domain discovery is a paid-stage success even if the subsequent
          // free crawl fails. The canonical free lane owns its own retry state.
          try { await runFreeEnrichmentLane([Number(target.id)]); }
          catch { freeRecrawlFailed++; }
          succeeded++;
        }else{
          noResult++;
        }
      }else{
        await settleSfpProviderOperation({reservation,outcome:'no_result',observation:'no_result',businessId:Number(target.id),settledUnits:outcome.requestsUsed});
        noResult++;
      }
    }catch(error:any){
      if(reservation) await settleSfpProviderOperation({reservation,outcome:'failed',observation:'transport',businessId:Number(target.id)}).catch(()=>{});
      failed++;
      await db.execute(sql`UPDATE sfp_stage_items SET state='failed',outcome_code=${String(error?.message ?? error).slice(0,180)},completed_at=NOW(),updated_at=NOW() WHERE stage_run_id=${String(stage.id)}::uuid AND business_id=${Number(target.id)} AND provider='serper'`).catch(()=>{});
    }
  }
  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failed?"partial":"completed"},processed_count=${targets.length},succeeded_count=${succeeded},
           failed_count=${failed},skipped_count=${noResult},completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${String(stage.id)}::uuid
  `);
  return {stageRunId:String(stage.id),replayed:false,processed:targets.length,succeeded,failed,noResult,freeRecrawlFailed,zeroOutreachConfirmed:true};
}
