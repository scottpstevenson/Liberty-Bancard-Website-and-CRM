/** A-owned projection of stored observations, not native execution or forecasts.
 * Never infer an amount from a missing field, a roster, or an absent record. */
import { residualPayeeObservationsSchema } from "../../shared/residual-payee-observation";
import { residualPartnerObservationsSchema } from "../../shared/residual-partner-observation";
export function observationNumber(v:unknown):number|null {
  if(v==null || (typeof v!=="number" && typeof v!=="string") || (typeof v==="string"&&!v.trim()))return null;
  if(typeof v==="string"&&!/^[-+]?\d+(\.\d{1,12})?$/.test(v.trim()))return null;
  const n=Number(v);
  return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null;
}
function maskedMid(v:unknown):string {
  const s=typeof v==="string"?v:"";
  return s.length>4 ? `••••${s.slice(-4)}` : "••••";
}
export function projectResidualObservations(raw:Record<string,any>[],filter:{search?:string;period?:string}={}) {
  const allRows=raw.map(r=>({
    id:r.id,registeredMidContactId:r.member_contact_id,observationContactId:r.contact_id,registeredMidId:r.registered_mid_id,
    observationDealId:r.deal_id,registeredMidDealId:r.registered_mid_deal_id,
    reportId:r.report_id,importId:r.import_id,month:r.month,
    merchantName:r.merchant_name ?? r.member_label ?? "Captured merchant label unavailable",
    mid:maskedMid(r.merchant_mid),agentId:r.agent_id,
    agent:r.agent_label || "No captured agent attribution",
    volume:observationNumber(r.volume),volumeChange:observationNumber(r.volume_change),
    revenue:observationNumber(r.revenue),revenueChange:observationNumber(r.revenue_change),
    cost:observationNumber(r.cost),netRevenue:observationNumber(r.net_revenue),
    agentCommission:observationNumber(r.agent_commission),flags:Array.isArray(r.flags)?r.flags:[],
  }));
  const query=filter.search?.trim().toLowerCase()??"";
  const selected=allRows.map((r,i)=>({r,raw:raw[i]})).filter(({r})=>
    (!filter.period || filter.period==="all" || r.month===filter.period) &&
    (!query || [r.merchantName,r.mid,r.agent].some(v=>String(v).toLowerCase().includes(query))));
  const rows=selected.map(v=>v.r),scopeRaw=selected.map(v=>v.raw);
  // This exact complete projected population is shared by the worklist/export.
  // A scalar subtotal is unavailable if any participating amount is unknown.
  function sum(field:"revenue"|"volume"|"cost"|"netRevenue"|"agentCommission"|"partnerCommission",entries=scopeRaw):number|null {
    const column={revenue:"revenue",volume:"volume",cost:"cost",netRevenue:"net_revenue",agentCommission:"agent_commission",partnerCommission:"partner_commission"}[field];
    if(!entries.length || entries.some(r=>observationNumber(r[column])==null))return null;
    const decimals=entries.map(r=>String(r[column]).trim());
    if(decimals.some(s=>!/^[-+]?\d+(\.\d{1,12})?$/.test(s)))return null;
    const scale=decimals.reduce((s,d)=>Math.max(s,(d.split(".")[1]??"").length),0);
    let coefficient=0n;
    for(const decimal of decimals){
      const negative=decimal.startsWith("-");
      const [whole,fraction=""]=decimal.replace(/^[-+]/,"").split(".");
      coefficient+=(negative?-1n:1n)*BigInt(whole+fraction.padEnd(scale,"0"));
    }
    // No binary floating-point addition or silently rounded oversized integer.
    if(coefficient>BigInt(Number.MAX_SAFE_INTEGER)||coefficient<-BigInt(Number.MAX_SAFE_INTEGER))return null;
    return Number(coefficient)/10**scale;
  }
  const periodValues=[...new Set(scopeRaw.map(r=>String(r.month)))].sort();
  const series=periodValues.map(month=>({month,totalRevenue:sum("revenue",scopeRaw.filter(r=>r.month===month))}));
  const revenue=sum("revenue"),registeredMidCount=new Set(scopeRaw.map(r=>r.registered_mid_id)).size;
  const payeeGroups = new Map<number|null,Record<string,any>[]>();
  for (const observation of scopeRaw) {
    const agentId = Number.isSafeInteger(observation.agent_id) && observation.agent_id > 0
      ? observation.agent_id : null;
    const group = payeeGroups.get(agentId) ?? [];
    group.push(observation);
    payeeGroups.set(agentId,group);
  }
  const payees = residualPayeeObservationsSchema.parse([...payeeGroups.entries()]
    .sort(([a],[b]) => a === null ? 1 : b === null ? -1 : a-b)
    .map(([agentId,observations]) => ({
      agentId,
      agentLabel: agentId === null ? "No stored agent identity" :
        observations.find(r => typeof r.agent_label === "string" && r.agent_label.trim())?.agent_label
          ?? "Captured agent label unavailable",
      observationCount: observations.length,
      registeredMidCount: new Set(observations.map(r=>r.registered_mid_id)
        .filter(id=>Number.isSafeInteger(id)&&id>0)).size,
      revenue: sum("revenue",observations),
      agentCommission: sum("agentCommission",observations),
    })));
  const confirmed = scopeRaw.filter(r=>r.confirmed_import_status==="confirmed");
  const partnerGroups = new Map<number,Record<string,any>[]>();
  let unattributedObservationCount=0,unavailableRelationshipCount=0;
  for (const observation of confirmed) {
    if (!Number.isSafeInteger(observation.authorized_observation_deal_id) ||
      observation.authorized_observation_deal_id<=0 ||
      (observation.observation_partner_org_id!=null && observation.partner_org_id==null)) {
      unavailableRelationshipCount++;
      continue;
    }
    if (observation.partner_org_id==null) {
      unattributedObservationCount++;
      continue;
    }
    const group=partnerGroups.get(observation.partner_org_id)??[];
    group.push(observation);
    partnerGroups.set(observation.partner_org_id,group);
  }
  const partners=residualPartnerObservationsSchema.parse({
    rows:[...partnerGroups.entries()].sort(([a],[b])=>a-b).map(([orgId,observations])=>({
      orgId,orgName:observations.find(r=>typeof r.partner_org_name==="string"&&r.partner_org_name.trim())?.partner_org_name
        ??"Captured partner organization label unavailable",
      orgSlug:observations.find(r=>typeof r.partner_org_slug==="string")?.partner_org_slug??"",
      observationCount:observations.length,
      registeredMidCount:new Set(observations.map(r=>r.registered_mid_id)
        .filter(id=>Number.isSafeInteger(id)&&id>0)).size,
      totalGrossResidual:sum("revenue",observations),
      totalNetResidual:sum("netRevenue",observations),
      totalPartnerCommission:sum("partnerCommission",observations),
    })),
    confirmedObservationCount:confirmed.length,
    unconfirmedOrUnlinkedImportCount:scopeRaw.length-confirmed.length,
    unattributedObservationCount,unavailableRelationshipCount,
  });
  return {rows,series,payees,partners,summary:{
    observationCount:rows.length,registeredMidCount,
    revenue,averageRevenuePerRegisteredMid:revenue!=null&&registeredMidCount>0?revenue/registeredMidCount:null,
    averageMethod:"sum stored reported revenue / distinct registered MID IDs, not a monthly forecast",
    volume:sum("volume"),cost:sum("cost"),netRevenue:sum("netRevenue"),
    agentCommission:sum("agentCommission"),
    period:filter.period&&filter.period!=="all"?filter.period:"all_recorded_period_values",
    search:filter.search?.trim()??"",currency:"not_recorded_in_source",displayCurrencyAssumption:"USD",
    nativeExecution:"unverified",source:"merchant_residuals_stored_observations",
  }};
}
