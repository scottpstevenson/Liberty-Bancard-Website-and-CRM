import { useCrmQuery } from "./use-crm-query";
import { apiRequest } from "@/lib/queryClient";

type PauseObservation={
  state:"paused"|"activating"|"unpaused";
  reason:string;source:"database"|"safe_default";canSend:false;
  capability:"pause_observation_only";availability:"available"|"unavailable";asOf:string;
};

/** Presentation of the existing pause authority, never a send authorization. */
export function useOutboundPauseObservation(){
  const query=useCrmQuery<PauseObservation>({
    queryKey:["/api/inbox/send-state"],
    queryFn:async({signal})=>{
      const response=await apiRequest("GET","/api/inbox/send-state",undefined,undefined,signal);
      const data=await response.json();
      if(!data || !["paused","activating","unpaused"].includes(data.state) ||
        typeof data.reason!=="string" || data.canSend!==false ||
        data.capability!=="pause_observation_only" || !["database","safe_default"].includes(data.source))
        throw new Error("Invalid outbound pause observation");
      return data;
    },
    staleTime:0,refetchInterval:30000,
  });
  return {...query,blocked:true as const,reason:query.data?.reason ??
    (query.isLoading ? "Checking outbound pause authority; outbound actions remain disabled."
      : "Outbound pause observation unavailable; outbound actions remain disabled.")};
}
