import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {decodeWorkerRuntime,workerObservationLabel,type WorkerRuntime} from "@shared/worker-runtime-state";
export function WorkerRuntimeSummary(){
 const [expanded,setExpanded]=useState(false);
 const query=useQuery<WorkerRuntime>({queryKey:['/api/admin/worker-heartbeats'],refetchInterval:30000});
 if(query.isPending)return <p role="status">Loading worker observations…</p>;
 const data=decodeWorkerRuntime(query.data);
 if(query.isError||!data)return <div role="status"><p>Worker observations unavailable.</p><button className="underline focus-visible:outline" onClick={()=>query.refetch()}>Retry worker observations</button></div>;
 return <div className="space-y-2 text-xs" data-testid="worker-runtime-summary">
  <p>Profile: <strong>{data.backgroundProfile??'Unknown'}</strong> · Outbound: <strong>{data.pauseReason?.state??'Unknown'}</strong></p>
  <p>{data.heartbeats.filter(w=>w.expectedSelected).length} selected queues · Observed {new Date(data.asOf).toLocaleString()}</p>
  <p>Worker selection and heartbeat are separate from completed work and permission to send.</p>
  <button className="underline focus-visible:outline" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide':'Show'} queue observations</button>
  {expanded&&<ul className="max-h-60 overflow-y-auto space-y-2" aria-label="Queue observations">{data.heartbeats.map(w=><li key={w.queueName} className="break-words"><strong>{w.queueName}</strong>: {workerObservationLabel(w)}{w.lastSeenAt?` · ${new Date(w.lastSeenAt).toLocaleString()}`:''}</li>)}</ul>}
 </div>;
}
