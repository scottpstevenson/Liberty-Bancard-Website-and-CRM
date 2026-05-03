import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Deal, Agent } from "@shared/schema";
import BoardingPanel from "@/components/BoardingPanel";
import { DealAgentAssignment } from "./DealAgentAssignment";
import { formatDate } from "./shared";

interface DealsTabProps {
  deals: Deal[];
  contactId: number;
  isManagerOrAdmin: boolean;
  agentsList: Agent[] | undefined;
  setLocation: (path: string) => void;
}

export function DealsTab({ deals, contactId, isManagerOrAdmin, agentsList, setLocation }: DealsTabProps) {
  const queryClient = useQueryClient();

  if (deals.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No deals yet</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {deals.map(deal => (
        <Card
          key={deal.id}
          className="hover-elevate"
          data-testid={`card-deal-${deal.id}`}
        >
          <CardContent className="py-4 space-y-3">
            <div
              className="flex flex-wrap items-center justify-between gap-2 cursor-pointer"
              onClick={() => setLocation("/dashboard/pipeline")}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" data-testid={`text-deal-pipeline-${deal.id}`}>
                    {deal.pipeline}
                  </span>
                  <Badge variant="outline" data-testid={`badge-deal-stage-${deal.id}`}>
                    {deal.stage}
                  </Badge>
                  {deal.mid && (
                    <Badge variant="outline" className="font-mono text-xs text-green-700 dark:text-green-400 border-green-300" data-testid={`badge-deal-mid-${deal.id}`}>
                      MID: {deal.mid}
                    </Badge>
                  )}
                </div>
                {deal.offerPath && (
                  <p className="text-sm text-muted-foreground" data-testid={`text-deal-offer-${deal.id}`}>
                    Offer: {deal.offerPath}
                  </p>
                )}
              </div>
              <div className="text-sm text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
                Created {formatDate(deal.createdAt)}
              </div>
            </div>
            {isManagerOrAdmin && agentsList && (
              <DealAgentAssignment dealId={deal.id} agents={agentsList} />
            )}
            <BoardingPanel
              dealId={deal.id}
              dealStage={deal.stage || ""}
              dealPipeline={deal.pipeline || ""}
              onStatusChange={() => queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] })}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
