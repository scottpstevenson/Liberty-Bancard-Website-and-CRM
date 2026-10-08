import { apiRequest } from "@/lib/queryClient";
import { useCrmQuery } from "./use-crm-query";

type ToolCapability = { blocked: boolean; reason: string };
type ToolObservations = {
  ai: ToolCapability; followups: ToolCapability; bin: ToolCapability;
  asOf: string; capability: "transport_observation_only";
};

/** Advisory presentation only. Existing server commands retain authority. */
export function useToolCapability(tool: "ai" | "followups" | "bin") {
  const query = useCrmQuery<ToolObservations>({
    queryKey: ["/api/tools/capabilities"],
    queryFn: async ({ signal }) => {
      const data = await (await apiRequest("GET", "/api/tools/capabilities", undefined, undefined, signal)).json();
      if (data?.capability !== "transport_observation_only" || typeof data.asOf !== "string"
        || !["ai", "followups", "bin"].every(key => typeof data[key]?.blocked === "boolean"
          && typeof data[key]?.reason === "string")) throw new Error("Tool capability observation unavailable");
      return data;
    },
    staleTime: 0, refetchInterval: 30000,
  });
  return { ...query, blocked: query.data?.[tool].blocked ?? true,
    reason: query.data?.[tool].reason ?? (query.isLoading
      ? "Checking tool capability; execution is disabled."
      : "Tool capability observation unavailable; execution is disabled.") };
}
