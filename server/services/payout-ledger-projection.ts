import {createHash} from "node:crypto";
import {parseCurrencyToMinor,minorToCurrency} from "./money";

/** Projection of the existing authorized ledger read; not payment execution. */
export function projectPayoutLedger<T extends {id:number;periodMonth:string;agentShare:unknown;grossResidual:unknown}>(
  rows:T[],filters:{month:string|null;status:string|null},asOf:string,
){
  function total(records:T[],key:"agentShare"|"grossResidual"){
    if(!records.length)return null;
    let minor=0n;
    for(const record of records){
      const value=record[key];
      if(value==null||String(value).trim()==="")return null;
      if(typeof value!=="string"&&typeof value!=="number")return null;
      try{minor+=parseCurrencyToMinor(value);}catch{return null;}
    }
    return minorToCurrency(minor);
  }
  const periods=[...new Set(rows.map(r=>r.periodMonth))].sort((a,b)=>b.localeCompare(a));
  const groups=periods.map(period=>{
    const records=rows.filter(r=>r.periodMonth===period);
    return {period,rowIds:records.map(r=>r.id),totalAgent:total(records,"agentShare"),totalGross:total(records,"grossResidual")};
  });
  return {rows,groups,read:{
    source:"agent_payouts stored allocation ledger",population:"administrative_global_ledger",
    filters,asOf,consistency:"one_existing_storage_query",completeness:"complete_returned_ledger_rows",
    periodSemantics:"recorded_period_string",periodTimezone:"unknown",currency:"unknown",
    monetaryMeaning:"stored_allocation_not_native_transfer_or_settlement",
    snapshotIdentity:createHash("sha256").update(JSON.stringify({filters,rows,groups})).digest("hex"),
  }};
}
