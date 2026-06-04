import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Link2, Eye } from "lucide-react";
import type { Deal, Agent } from "@shared/schema";
import BoardingPanel from "@/components/BoardingPanel";
import { DealAgentAssignment } from "./DealAgentAssignment";
import { formatDate } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/utils";

interface DealsTabProps {
  deals: Deal[];
  contactId: number;
  isManagerOrAdmin: boolean;
  agentsList: Agent[] | undefined;
  setLocation: (path: string) => void;
}

export function DealsTab({ deals, contactId, isManagerOrAdmin, agentsList, setLocation }: DealsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const shareLinkMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/generate-share-link`);
      return res.json();
    },
    onSuccess: async (data: { shareUrl: string }) => {
      try {
        await navigator.clipboard.writeText(data.shareUrl);
        toast({ title: "Share link copied!", description: "Send it to the merchant." });
      } catch {
        toast({ title: "Share link generated", description: data.shareUrl });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate link", description: err.message, variant: "destructive" });
    },
  });

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
                {deal.shareToken && (
                  <div className="flex items-center gap-1 text-xs" data-testid={`text-share-views-${deal.id}`}>
                    <Eye className="w-3 h-3 text-muted-foreground" />
                    {(deal.shareViewCount ?? 0) > 0 ? (
                      <span className="text-blue-600 dark:text-blue-400 font-medium">
                        Viewed {deal.shareViewCount} {deal.shareViewCount === 1 ? "time" : "times"}
                        {deal.shareLastViewedAt ? `, last seen ${formatTimeAgo(deal.shareLastViewedAt)}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not yet viewed</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
                  Created {formatDate(deal.createdAt)}
                </div>
                {deal.savingsProposal && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      shareLinkMutation.mutate(deal.id);
                    }}
                    disabled={shareLinkMutation.isPending && shareLinkMutation.variables === deal.id}
                    data-testid={`button-share-deal-contact-${deal.id}`}
                    title="Generate shareable savings results page"
                  >
                    {shareLinkMutation.isPending && shareLinkMutation.variables === deal.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Link2 className="w-3 h-3 mr-1" />
                    )}
                    Share Results
                  </Button>
                )}
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
