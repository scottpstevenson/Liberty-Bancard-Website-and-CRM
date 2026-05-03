import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Agent, AgentMerchant } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserRound, Loader2 } from "lucide-react";

export function DealAgentAssignment({ dealId, agents }: { dealId: number; agents: Agent[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: assignment } = useQuery<AgentMerchant | null>({
    queryKey: ["/api/agent-merchants/deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-merchants/deal/${dealId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (agentId: number | null) => {
      const res = await apiRequest("PUT", `/api/agent-merchants/deal/${dealId}/assign`, { agentId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-merchants/deal", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      toast({ title: "Agent assignment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update agent assignment", description: err.message, variant: "destructive" });
    },
  });

  const currentValue = assignment ? String(assignment.agentId) : "none";

  return (
    <div className="flex items-center gap-2 pt-1">
      <UserRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <Select
        value={currentValue}
        onValueChange={(val) => assignMutation.mutate(val === "none" ? null : Number(val))}
      >
        <SelectTrigger
          className="h-7 text-xs flex-1 max-w-48"
          data-testid={`select-deal-agent-${dealId}`}
        >
          <SelectValue placeholder="Assign agent..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {agents.filter(a => a.status === "active").map((agent) => (
            <SelectItem key={agent.id} value={String(agent.id)}>
              {agent.firstName} {agent.lastName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {assignMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
