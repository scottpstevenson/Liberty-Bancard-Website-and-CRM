import {createHash,randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '../db';

export const OUTSCRAPER_MONTHLY_MAX_MICROS=50_000_000;
export type OutscraperBudgetReference={providerOperationId:string}|{generationId:string;stageKey:string};
export type OutscraperPurchase={service:'maps'|'leads';quantity:number;fingerprint:string;reference?:OutscraperBudgetReference};
export type OutscraperBudgetTicket={id:string;markDispatched:()=>Promise<void>;releaseNotDispatched:()=>Promise<void>};
export type CertificationOutscraperBudget=(purchase:OutscraperPurchase)=>Promise<OutscraperBudgetTicket>;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
const rows=(r:any):any[]=>r.rows??r;
const one=async(tx:Tx,q:any)=>rows(await tx.execute(q))[0];
const safe=(n:unknown)=>{const value=Number(n);if(!Number.isSafeInteger(value)||value<0)throw Error('OUTSCRAPER_MONTHLY_BUDGET_ACCOUNTING_UNSAFE');return value;};
export const outscraperRequestFingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function lockPolicy(tx:Tx){
 await tx.execute(sql`INSERT INTO outscraper_budget_policy(id) VALUES(true) ON CONFLICT DO NOTHING`);
 return one(tx,sql`SELECT *,clock_timestamp() AS observed_at,to_char(clock_timestamp() AT TIME ZONE 'America/New_York','YYYY-MM') AS period FROM outscraper_budget_policy WHERE id FOR UPDATE`);
}
function quote(p:any,service:'maps'|'leads'){
 const amount=safe(p[`${service}_price_micros`]);
 const unit=service==='maps'?'result':p.leads_price_unit;
 if(!p[`${service}_price_micros`]||amount<3000||!['result','domain','contact'].includes(unit)
   ||!p[`${service}_quote_evidence`]||!p[`${service}_quote_expires_at`]
   ||+new Date(p[`${service}_quote_expires_at`])<=+new Date(p.observed_at))throw Error('OUTSCRAPER_MONTHLY_BUDGET_PRICING_UNVERIFIED');
 return {amount,unit};
}
/** Legacy ledgers remain authoritative. Exclude operations already attributed
 * to this boundary, and CRO03C's provider-operation mirror to avoid duplication.
 * A pending/ambiguous older operation is included even outside this month.
 * Result retrieval adds request work units, not another purchase of Maps data.
 */
async function refreshWindow(tx:Tx,p:any,persist=true){
 if(persist)await tx.execute(sql`INSERT INTO outscraper_budget_windows(period) VALUES(${p.period}) ON CONFLICT DO NOTHING`);
 const legacy=await one(tx,sql`WITH eligible AS (
  SELECT o.* FROM provider_operations o
  WHERE o.provider='outscraper' AND o.purpose NOT IN ('scheduled_discovery_poll','sfp_outscraper_task_poll')
   AND NOT EXISTS(SELECT 1 FROM outscraper_budget_requests r WHERE r.provider_operation_id=o.id)
   AND NOT EXISTS(SELECT 1 FROM cro03c_stage_operations c WHERE c.provider_operation_id=o.id AND c.provider='outscraper')
   AND (o.billing_state='ambiguous' OR EXISTS(SELECT 1 FROM provider_attempts a WHERE a.operation_id=o.id AND a.dispatch_marked_at IS NOT NULL)
        OR o.sfp_dispatch_receipt IS NOT NULL OR o.billing_state='committed')
   AND (to_char(o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York','YYYY-MM')=${p.period} OR o.billing_state IN ('reserved','ambiguous'))
 ), amounts AS (
  SELECT CASE WHEN reserved_units<0 OR unit_price_micros<0 OR settled_cost_micros<0 THEN NULL
   WHEN billing_state='released' THEN COALESCE(settled_cost_micros,0)
   WHEN billing_state='committed' AND settled_cost_micros IS NOT NULL THEN greatest(settled_cost_micros,CASE WHEN unit_price_unit=COALESCE(sfp_result_data->>'reservedWorkUnit',provider_usage_unit,'result') THEN COALESCE(unit_price_micros,0)*reserved_units ELSE 0 END)
   WHEN unit_price_micros IS NOT NULL AND unit_price_micros>=0
    AND unit_price_unit=COALESCE(sfp_result_data->>'reservedWorkUnit',provider_usage_unit,'result')
   THEN greatest(COALESCE(settled_cost_micros,0),reserved_units*unit_price_micros)
   ELSE NULL END amount FROM eligible
  UNION ALL
  SELECT CASE WHEN c.currency<>'USD' OR c.max_reserved_amount_micros<0 OR c.settled_amount_micros<0 THEN NULL
    WHEN c.terminal_disposition='released' THEN c.settled_amount_micros
    ELSE greatest(c.max_reserved_amount_micros,c.settled_amount_micros) END
  FROM cro03c_stage_operations c WHERE c.provider='outscraper'
   AND NOT EXISTS(SELECT 1 FROM outscraper_budget_requests r WHERE r.cro03c_operation_id=c.id)
   AND (c.dispatched_at IS NOT NULL OR c.dispatch_state IN ('dispatched','ambiguous','reconciled') OR c.settled_amount_micros>0)
   AND (to_char(c.created_at AT TIME ZONE 'America/New_York','YYYY-MM')=${p.period}
        OR c.billing_certainty IN ('ambiguous','unknown') AND c.terminal_disposition IS DISTINCT FROM 'released')
 ) SELECT COALESCE(sum(amount),0) amount,count(*) FILTER(WHERE amount IS NULL)::integer unknown FROM amounts`);
 const observed=await one(tx,sql`SELECT * FROM outscraper_budget_windows WHERE period=${p.period}`);
 const window={legacy_micros:Math.max(safe(observed?.legacy_micros??0),safe(legacy.amount)),unknown_operations:safe(legacy.unknown)};
 if(persist)await tx.execute(sql`UPDATE outscraper_budget_windows SET legacy_micros=${window.legacy_micros},
  unknown_operations=${window.unknown_operations},updated_at=now() WHERE period=${p.period}`);
 const requests=await one(tx,sql`SELECT COALESCE(sum(maximum_micros),0) amount FROM outscraper_budget_requests WHERE period=${p.period} AND state<>'not_dispatched'`);
 return {period:String(p.period),legacyMicros:safe(window.legacy_micros),unknownOperations:safe(window.unknown_operations),reservedMicros:safe(requests.amount)};
}
export async function readOutscraperMonthlyBudget(){
 return db.transaction(async tx=>{
  const clock=await one(tx,sql`SELECT clock_timestamp() AS observed_at,to_char(clock_timestamp() AT TIME ZONE 'America/New_York','YYYY-MM') AS period`);
  const stored=await one(tx,sql`SELECT * FROM outscraper_budget_policy WHERE id FOR SHARE`);
  const p={limit_micros:50000000,maps_price_micros:3000,maps_quote_expires_at:'2026-12-18T00:00:00Z',maps_quote_evidence:'Published Maps price reviewed 2026-11-18',...stored,...clock};
  const w=await refreshWindow(tx,p,false);const limit=safe(p.limit_micros);
  let pricingReady=true;try{quote(p,'maps');}catch{pricingReady=false;}
  let enrichmentPricingReady=true;try{quote(p,'leads');}catch{enrichmentPricingReady=false;}
  return {...w,limitMicros:limit,committedMicros:w.legacyMicros+w.reservedMicros,
   remainingMicros:w.unknownOperations?null:Math.max(0,limit-w.legacyMicros-w.reservedMicros),pricingReady,enrichmentPricingReady,
   mapsUnitPriceMicros:pricingReady?Number(p.maps_price_micros):null,canPurchaseMaps:pricingReady&&w.unknownOperations===0&&limit-w.legacyMicros-w.reservedMicros>=Number(p.maps_price_micros),
   pricingReason:!pricingReady?'OUTSCRAPER_MONTHLY_BUDGET_PRICING_UNVERIFIED':w.unknownOperations?'OUTSCRAPER_MONTHLY_BUDGET_LEGACY_UNRECONCILED':null,
   timezone:'America/New_York',scope:'All CRM Outscraper purchases, including recurring searches, previews and existing enrichment. Maximum liability, not an invoice total. Direct vendor-account purchases are outside this CRM guard.'};
 });
}
export async function updateOutscraperMonthlyBudget(actor:string,input:{monthlyBudgetUsd?:number;mapsQuote?:{unitPriceMicros:number;expiresAt:string;evidence:string};leadsQuote?:{unitPriceMicros:number;unit:'domain'|'contact';expiresAt:string;evidence:string}}){
 return db.transaction(async tx=>{
  const p=await lockPolicy(tx);
  const limit=input.monthlyBudgetUsd==null?safe(p.limit_micros):Math.round(input.monthlyBudgetUsd*1_000_000);
  if(!Number.isFinite(input.monthlyBudgetUsd??0)||!Number.isSafeInteger(limit)||limit<0||limit>OUTSCRAPER_MONTHLY_MAX_MICROS)throw Error('OUTSCRAPER_MONTHLY_BUDGET_LIMIT_INVALID');
  for(const q of [input.mapsQuote,input.leadsQuote])if(q){
   const expiry=+new Date(q.expiresAt),now=+new Date(p.observed_at);
   if(!Number.isSafeInteger(q.unitPriceMicros)||q.unitPriceMicros<3000||q.unitPriceMicros>OUTSCRAPER_MONTHLY_MAX_MICROS
    ||!Number.isFinite(expiry)||expiry<=now||expiry>now+30*86400000||q.evidence.trim().length<20||q.evidence.length>1000)throw Error('OUTSCRAPER_MONTHLY_BUDGET_QUOTE_INVALID');
  }
  if(input.leadsQuote&&!['domain','contact'].includes(input.leadsQuote.unit))throw Error('OUTSCRAPER_MONTHLY_BUDGET_QUOTE_INVALID');
  await tx.execute(sql`UPDATE outscraper_budget_policy SET limit_micros=${limit},revision=revision+1,updated_by=${actor},updated_at=now(),
   maps_price_micros=${input.mapsQuote?.unitPriceMicros??p.maps_price_micros},maps_quote_expires_at=${input.mapsQuote?.expiresAt??new Date(p.maps_quote_expires_at).toISOString()}::timestamptz,maps_quote_evidence=${input.mapsQuote?.evidence??p.maps_quote_evidence},
   leads_price_micros=${input.leadsQuote?.unitPriceMicros??p.leads_price_micros},leads_price_unit=${input.leadsQuote?.unit??p.leads_price_unit},
   leads_quote_expires_at=${input.leadsQuote?.expiresAt??p.leads_quote_expires_at}::timestamptz,leads_quote_evidence=${input.leadsQuote?.evidence??p.leads_quote_evidence} WHERE id`);
 });
}
export async function reserveOutscraperMonthlyBudget(request:OutscraperPurchase):Promise<OutscraperBudgetTicket>{
 if(!Number.isSafeInteger(request.quantity)||request.quantity<1||request.quantity>100||!['maps','leads'].includes(request.service)
  ||!(/^[0-9a-f]{64}$/.test(request.fingerprint)))throw Error('OUTSCRAPER_MONTHLY_BUDGET_REQUEST_INVALID');
 const id=randomUUID();
 await db.transaction(async tx=>{
  const p=await lockPolicy(tx);let nativePrice:unknown=null,nativeUnit:unknown=null;
  let providerId:string|null=null,croId:string|null=null;
  if(request.reference){
   if('providerOperationId' in request.reference){
    const r=await one(tx,sql`SELECT id,unit_price_micros,unit_price_unit FROM provider_operations WHERE id=${request.reference.providerOperationId}::uuid AND provider='outscraper'`);
    if(!r)throw Error('OUTSCRAPER_MONTHLY_BUDGET_OWNER_INVALID');providerId=r.id;nativePrice=r.unit_price_micros;nativeUnit=r.unit_price_unit;
   }else{
    const r=rows(await tx.execute(sql`SELECT id,unit_type,max_reserved_amount_micros,max_reserved_units FROM cro03c_stage_operations WHERE generation_id=${request.reference.generationId}::uuid AND stage_key=${request.reference.stageKey} AND provider='outscraper' LIMIT 2`));
    if(r.length!==1)throw Error('OUTSCRAPER_MONTHLY_BUDGET_OWNER_INVALID');croId=r[0].id;nativeUnit=r[0].unit_type;nativePrice=Number(r[0].max_reserved_units)>0?Number(r[0].max_reserved_amount_micros)/Number(r[0].max_reserved_units):null;
   }
  }
  const rate=quote(p,request.service);
  if(nativeUnit===rate.unit&&nativePrice!=null)rate.amount=Math.max(rate.amount,safe(nativePrice));
  const quantity=request.service==='leads'&&rate.unit==='contact'?request.quantity*3:request.quantity;
  const maximum=rate.amount*quantity;
  if(!Number.isSafeInteger(maximum)||maximum>OUTSCRAPER_MONTHLY_MAX_MICROS)throw Error('OUTSCRAPER_MONTHLY_BUDGET_REACHED');
  const w=await refreshWindow(tx,p);
  if(w.unknownOperations)throw Error('OUTSCRAPER_MONTHLY_BUDGET_LEGACY_UNRECONCILED');
  if(w.legacyMicros+w.reservedMicros+maximum>safe(p.limit_micros))throw Error('OUTSCRAPER_MONTHLY_BUDGET_REACHED');
  await tx.execute(sql`INSERT INTO outscraper_budget_requests(id,period,service,maximum_micros,quantity,price_micros,price_unit,policy_revision,request_fingerprint,provider_operation_id,cro03c_operation_id)
   VALUES(${id}::uuid,${p.period},${request.service},${maximum},${quantity},${rate.amount},${rate.unit},${p.revision},${request.fingerprint},${providerId}::uuid,${croId}::uuid)`);
 });
 return {id,markDispatched:async()=>{
  await db.transaction(async tx=>{
   const p=await lockPolicy(tx);
   const r=await one(tx,sql`SELECT * FROM outscraper_budget_requests WHERE id=${id}::uuid FOR UPDATE`);
   if(!r||r.state!=='reserved')throw Error('OUTSCRAPER_MONTHLY_BUDGET_RESERVATION_LOST');
   if(r.period!==p.period)throw Error('OUTSCRAPER_MONTHLY_BUDGET_PERIOD_CHANGED');
   if(r.policy_revision!==p.revision)throw Error('OUTSCRAPER_MONTHLY_BUDGET_POLICY_CHANGED');
   quote(p,r.service);
   if(r.provider_operation_id){
    const marker=await one(tx,sql`SELECT 1 FROM provider_attempts WHERE operation_id=${r.provider_operation_id}::uuid AND dispatch_marked_at IS NOT NULL LIMIT 1`);
    if(!marker)throw Error('OUTSCRAPER_MONTHLY_BUDGET_NATIVE_MARKER_REQUIRED');
   }
   if(r.cro03c_operation_id){
    const marker=await one(tx,sql`SELECT 1 FROM cro03c_stage_operations WHERE id=${r.cro03c_operation_id}::uuid AND dispatched_at IS NOT NULL AND dispatch_state='dispatched'`);
    if(!marker)throw Error('OUTSCRAPER_MONTHLY_BUDGET_NATIVE_MARKER_REQUIRED');
   }
   const w=await refreshWindow(tx,p);
   if(w.unknownOperations)throw Error('OUTSCRAPER_MONTHLY_BUDGET_LEGACY_UNRECONCILED');
   if(w.legacyMicros+w.reservedMicros>safe(p.limit_micros))throw Error('OUTSCRAPER_MONTHLY_BUDGET_REACHED');
   await tx.execute(sql`UPDATE outscraper_budget_requests SET state='dispatched',dispatched_at=clock_timestamp() WHERE id=${id}::uuid`);
  });
 },releaseNotDispatched:async()=>{
  await db.transaction(async tx=>{await lockPolicy(tx);await tx.execute(sql`UPDATE outscraper_budget_requests SET state='not_dispatched' WHERE id=${id}::uuid AND state='reserved'`);});
 }};
}
/** Financial authority completes before HTTP I/O. Injecting fetch alone never bypasses it. */
export async function withOutscraperMonthlyBudget<T>(request:OutscraperPurchase,deps:{fetchImpl?:typeof fetch;beforeRequest?:()=>Promise<void>;certificationBudget?:CertificationOutscraperBudget},fetchCall:()=>Promise<T>):Promise<T>{
 if(deps.certificationBudget&&(process.env.NODE_ENV!=='test'||process.env.VG_PROVIDER_DENY_MODE!=='1'||!deps.fetchImpl
   ||(globalThis.fetch as any)[Symbol.for('liberty.certification.fatal-egress-denied')]!==true))throw Error('OUTSCRAPER_MONTHLY_BUDGET_TEST_OVERRIDE_DENIED');
 if(!request.reference&&!(process.env.NODE_ENV==='test'&&deps.fetchImpl&&(globalThis.fetch as any)[Symbol.for('liberty.certification.fatal-egress-denied')]===true))throw Error('OUTSCRAPER_MONTHLY_BUDGET_OWNER_REQUIRED');
 const ticket=await (deps.certificationBudget??reserveOutscraperMonthlyBudget)(request);
 try{await deps.beforeRequest?.();await ticket.markDispatched();}
 catch(e){await ticket.releaseNotDispatched();throw e;}
 // From here onward a request may have reached the provider. Never refund on timeout/error.
 return fetchCall();
}
