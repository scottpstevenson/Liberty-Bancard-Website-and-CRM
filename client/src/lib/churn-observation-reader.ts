import {z} from "zod";

export type ChurnRead<T>={rows:T[];read:{source:string;scope:string;asOf:string;completeness:string}};
const readSchema=z.object({
  source:z.enum(["merchant_health_scores","churn_score_weights"]),
  scope:z.enum(["authorized_nonarchived_production_contact_score_records","stored_configuration"]),
  asOf:z.string().datetime({offset:true}),
  completeness:z.literal("unpaged_records_observed_at_response"),
});
export const churnSummarySchema=z.array(z.object({
  tier:z.enum(["Low","Medium","High","Critical"]),count:z.number().int().nonnegative(),
})).superRefine((rows,ctx)=>{
  if(new Set(rows.map(r=>r.tier)).size!==rows.length)ctx.addIssue({code:"custom",message:"Duplicate risk tiers"});
});
export const churnWeightsSchema=z.array(z.object({
  id:z.number().int().positive(),signalKey:z.string().min(1),label:z.string(),
  weight:z.number().finite().min(0).max(5),
}).passthrough()).superRefine((rows,ctx)=>{
  if(new Set(rows.map(r=>r.signalKey)).size!==rows.length)ctx.addIssue({code:"custom",message:"Ambiguous signal configuration"});
});
export const churnScoresSchema=z.array(z.object({
  id:z.number().int().positive(),contactId:z.number().int().positive(),
  churnScore:z.number().finite(),riskTier:z.enum(["Low","Medium","High","Critical"]),
  overrideScore:z.number().finite().nullable(),
  volumeTrendScore:z.number().finite().nullable(),chargebackTrendScore:z.number().finite().nullable(),
  ticketVelocityScore:z.number().finite().nullable(),npsScore:z.number().finite().nullable(),
  portalActivityScore:z.number().finite().nullable(),outreachResponseScore:z.number().finite().nullable(),
  computedAt:z.string().datetime({offset:true}).nullable(),
  contact:z.object({id:z.number().int().positive()}).passthrough().nullable(),
}).passthrough()).superRefine((rows,ctx)=>{
  if(rows.some(r=>r.contact&&r.contact.id!==r.contactId))ctx.addIssue({code:"custom",message:"Mismatched score/contact relationship"});
});

/** Stateless transport/validation only; actor keys, cancellation and cache
 * remain with C1 useCrmQuery. Legacy HTTP array bodies are preserved. */
export async function readChurnObservations<T>(
  url:string,signal:AbortSignal|undefined,schema:z.ZodTypeAny,
):Promise<ChurnRead<T>> {
  const response=await fetch(url,{credentials:"include",signal});
  if(!response.ok)throw new Error(`${response.status}: Churn observations unavailable`);
  const read=readSchema.parse({
    source:response.headers.get("X-CRM-Read-Source"),
    scope:response.headers.get("X-CRM-Read-Scope"),
    asOf:response.headers.get("X-CRM-Read-AsOf"),
    completeness:response.headers.get("X-CRM-Read-Completeness"),
  });
  const rows=schema.parse(await response.json()) as T[];
  return {rows,read};
}
