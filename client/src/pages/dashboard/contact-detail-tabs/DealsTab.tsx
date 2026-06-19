import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Link2, Copy, Mail, ChevronDown, Eye, FileText, CheckCircle2, Send, ExternalLink } from "lucide-react";
import type { Deal, Agent } from "@shared/schema";
import BoardingPanel from "@/components/BoardingPanel";
import { DealAgentAssignment } from "./DealAgentAssignment";
import { formatDate } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/utils";

interface CoBrandedProposal {
  id: number;
  merchantName: string;
  token: string;
  status: string;
  viewCount: number;
  deliveredAt: string | null;
  acceptedAt: string | null;
  viewerUrl: string;
}

interface DealWithPartner extends Deal {
  partnerOrgId: number | null;
}

interface DealsTabProps {
  deals: DealWithPartner[];
  contactId: number;
  isManagerOrAdmin: boolean;
  agentsList: Agent[] | undefined;
  setLocation: (path: string) => void;
}

function CoBrandedProposalsSection({ dealId }: { dealId: number }) {
  const { toast } = useToast();
  const { data: proposals, isLoading } = useQuery<CoBrandedProposal[]>({
    queryKey: ["/api/deals", dealId, "co-branded-proposals"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/co-branded-proposals`);
      if (!res.ok) return [];
      return res.json();
    }
  });

  if (isLoading) return <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading proposals...</div>;
  if (!proposals || proposals.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-blue-600" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Co-Branded Proposals</h4>
      </div>
      <div className="space-y-2">
        {proposals.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 border text-xs">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{p.merchantName}</span>
                {p.acceptedAt ? (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] bg-green-50 text-green-700 border-green-200">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Accepted
                  </Badge>
                ) : p.viewCount > 0 ? (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                    Viewed {p.viewCount}×
                  </Badge>
                ) : p.deliveredAt ? (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] bg-sky-50 text-sky-700 border-sky-200">
                    <Send className="w-2.5 h-2.5 mr-0.5" /> Sent
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">Draft</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                onClick={() => {
                  apiRequest("POST", `/api/co-branded-proposals/${p.id}/send`, {})
                    .then(() => toast({ title: "Proposal sent via GHL!" }))
                    .catch((err) => toast({ title: "Failed to send", description: err.message, variant: "destructive" }));
                }}
                title="Send via GHL"
                data-testid={`button-send-ghl-deal-proposal-${p.id}`}
              >
                <Send className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => { navigator.clipboard.writeText(p.viewerUrl); toast({ title: "Link copied!" }); }}
                title="Copy link"
              >
                <Copy className="w-3 h-3" />
              </Button>
              <a href={p.viewerUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Open">
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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

  const emailShareLinkMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/email-share-link`);
      return res.json();
    },
    onSuccess: (data: { email: string }) => {
      toast({ title: "Email sent!", description: `Savings results link sent to ${data.email}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Email failed", description: err.message, variant: "destructive" });
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => e.stopPropagation()}
                        disabled={
                          (shareLinkMutation.isPending && shareLinkMutation.variables === deal.id) ||
                          (emailShareLinkMutation.isPending && emailShareLinkMutation.variables === deal.id)
                        }
                        data-testid={`button-share-deal-contact-${deal.id}`}
                      >
                        {(shareLinkMutation.isPending && shareLinkMutation.variables === deal.id) ||
                        (emailShareLinkMutation.isPending && emailShareLinkMutation.variables === deal.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Link2 className="w-3 h-3 mr-1" />
                        )}
                        Share Results
                        <ChevronDown className="w-3 h-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          shareLinkMutation.mutate(deal.id);
                        }}
                        data-testid={`menu-copy-link-contact-${deal.id}`}
                      >
                        <Copy className="w-3 h-3 mr-2" />
                        Copy Link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          emailShareLinkMutation.mutate(deal.id);
                        }}
                        data-testid={`menu-email-merchant-contact-${deal.id}`}
                      >
                        <Mail className="w-3 h-3 mr-2" />
                        Email to Merchant
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
            {deal.partnerOrgId && <CoBrandedProposalsSection dealId={deal.id} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
