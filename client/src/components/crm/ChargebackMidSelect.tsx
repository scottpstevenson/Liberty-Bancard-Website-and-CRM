import { useCrmQuery } from "@/hooks/use-crm-query";
import { CrmDataState } from "./CrmPresentation";
import { apiRequest } from "@/lib/queryClient";

export function ChargebackMidSelect({id,value,onChange,disabled=false}:{id:number;value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  const query=useCrmQuery<{data:Array<{id:number;midMasked:string;status:string}>}>({
    queryKey:[`/api/chargebacks/${id}/submission-mids`],
    queryFn:async({signal})=>{
      const data=await (await apiRequest("GET",`/api/chargebacks/${id}/submission-mids`,undefined,undefined,signal)).json();
      if(!Array.isArray(data?.data) || !data.data.every((row:any)=>Number.isSafeInteger(row.id)&&typeof row.midMasked==="string"))
        throw new Error("Invalid MID relationship response");
      return data;
    },
  });
  if(query.isError) return <CrmDataState state="unavailable" message="Authorized MID relationship unavailable. No submission can be accepted." onRetry={()=>void query.refetch()}/>;
  return <label className="text-sm">Authorized merchant MID
    <select aria-label="Authorized merchant MID" className="min-h-11 block w-full rounded border bg-background px-3"
      value={value} onChange={event=>onChange(event.target.value)} disabled={disabled || query.isLoading}>
      <option value="">{query.isLoading ? "Reading MID relationship…" : "Select MID"}</option>
      {query.data?.data.map(row=><option key={row.id} value={row.id} disabled={["closed","suspended"].includes(row.status)}>{row.midMasked} · {row.status}</option>)}
    </select>
    {!query.isLoading && query.data?.data.length===0 && <p>No registered MID is available for this case.</p>}
  </label>;
}
