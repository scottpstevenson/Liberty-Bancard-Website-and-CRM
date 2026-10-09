import { CrmDataState } from "./CrmPresentation";
import { useCrmQuery } from "@/hooks/use-crm-query";

const labels:Record<string,string>={
  pending:"Accepted / queued — not transmitted",processing:"Processing — final receipt unavailable",
  retryable:"Retry pending — no final success receipt",terminal_failed:"Failed",
  reconcile_required:"Reconciliation required — do not resend",succeeded:"Command ledger reports success; final card-brand receipt is not established here",
};
export function ChargebackCommandStatus({id}:{id:number}) {
  const query=useCrmQuery<{data:Array<{id:string;state:string}>}>({
    queryKey:[`/api/chargebacks/${id}/submission-commands`],
  });
  if (query.isError) return <CrmDataState state="unavailable" message="Submission status unavailable. Do not assume transmission or start another intent." onRetry={()=>void query.refetch()}/>;
  if (query.isLoading) return <CrmDataState state="loading" message="Reading durable submission status…"/>;
  if (!Array.isArray(query.data?.data)) return <CrmDataState state="unavailable" message="Submission status response is invalid."/>;
  return <div className="text-sm space-y-2" role="status">
    <p>Native execution is separate from evidence acceptance. Queued commands do not prove an available worker or transmission.</p>
    {query.data.data.map(command=><p key={command.id}>{labels[command.state]??"Unknown command state — readback required"}</p>)}
    <button className="min-h-11 rounded border px-3" onClick={()=>void query.refetch()}>Refresh submission status</button>
  </div>;
}
