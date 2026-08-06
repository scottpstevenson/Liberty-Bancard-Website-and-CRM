import React from "react";
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
import { Loader2, Link2, Copy, Mail, ChevronDown, Eye, FileText, CheckCircle2, Send, ExternalLink, ClipboardList, BarChart2, AlertCircle, Clock, RefreshCw } from "lucide-react";
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

interface AnalysisProposal {
  id: number;
  status: string;
  effectiveRate: string | null;
  savingsEstimate: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface AnalysisData {
  analysisStatus: string;
  proposal: AnalysisProposal | null;
  hasStatementDoc?: boolean;
}

function StatementAnalysisSection({ dealId, analysisStatus }: { dealId: number; analysisStatus: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reanalyzeCooledDown, setReanalyzeCooledDown] = React.useState(false);

  const { data, isLoading } = useQuery<AnalysisData>({
    queryKey: ["/api/deals", dealId, "analysis"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/analysis`);
      if (!res.ok) return { analysisStatus: "none", proposal: null };
      return res.json();
    },
    enabled: !!dealId,
    refetchInterval: analysisStatus === "pending" || analysisStatus === "processing" ? 8000 : false,
  });

  const hasStatementDoc = data?.hasStatementDoc ?? false;

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/reanalyze-statement`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to queue re-analysis");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Re-analysis queued", description: "Results will appear shortly." });
      setReanalyzeCooledDown(true);
      // Refresh analysis status after queuing
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "analysis"] });
      // Re-enable button after 5 minutes
      setTimeout(() => setReanalyzeCooledDown(false), 5 * 60 * 1000);
    },
    onError: (err: Error) => {
      toast({ title: "Re-analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const proposal = data?.proposal;
  const currentStatus = data?.analysisStatus ?? analysisStatus ?? "none";

  // Don't show spinner unless there's likely something to show (pending deal status)
  if (isLoading && currentStatus === "none") return null;

  if (currentStatus === "none" && !proposal && !hasStatementDoc) return null;

  const statusBadge = () => {
    if (currentStatus === "pending" || currentStatus === "processing") {
      return (
        <Badge variant="outline" className="h-4 px-1 text-[10px] bg-yellow-50 text-yellow-700 border-yellow-200" data-testid={`badge-analysis-status-${dealId}`}>
          <Clock className="w-2.5 h-2.5 mr-0.5" /> {currentStatus === "pending" ? "Queued" : "Analyzing..."}
        </Badge>
      );
    }
    if (currentStatus === "failed") {
      return (
        <Badge variant="outline" className="h-4 px-1 text-[10px] bg-red-50 text-red-700 border-red-200" data-testid={`badge-analysis-status-${dealId}`}>
          <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> Analysis Failed
        </Badge>
      );
    }
    if (proposal?.status === "analyzed") {
      return (
        <Badge variant="outline" className="h-4 px-1 text-[10px] bg-green-50 text-green-700 border-green-200" data-testid={`badge-analysis-status-${dealId}`}>
          <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Analyzed
        </Badge>
      );
    }
    if (proposal?.status === "failed") {
      return (
        <Badge variant="outline" className="h-4 px-1 text-[10px] bg-red-50 text-red-700 border-red-200" data-testid={`badge-analysis-status-${dealId}`}>
          <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> Analysis Failed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="h-4 px-1 text-[10px]" data-testid={`badge-analysis-status-${dealId}`}>
        Draft
      </Badge>
    );
  };

  let parsedExtraction: any = null;
  if (proposal?.notes) {
    try { parsedExtraction = JSON.parse(proposal.notes); } catch { /* ignore */ }
  }

  return (
    <div className="mt-4 pt-4 border-t space-y-2" data-testid={`section-statement-analysis-${dealId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-indigo-600" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statement Analysis</h4>
          {statusBadge()}
        </div>
        {hasStatementDoc && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
            disabled={reanalyzeMutation.isPending || reanalyzeCooledDown}
            onClick={() => reanalyzeMutation.mutate()}
            data-testid={`button-reanalyze-statement-${dealId}`}
          >
            {reanalyzeMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Re-analyze
          </Button>
        )}
      </div>

      {(currentStatus === "pending" || currentStatus === "processing") && (
        <p className="text-xs text-muted-foreground italic">
          AI is analyzing the statement. This page will refresh automatically.
        </p>
      )}

      {proposal?.status === "analyzed" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {proposal.effectiveRate && (
              <div className="p-2 rounded-md bg-muted/30 border text-xs" data-testid={`text-effective-rate-${dealId}`}>
                <div className="text-muted-foreground mb-0.5">Effective Rate (Estimated)</div>
                <div className="font-semibold">{proposal.effectiveRate}</div>
              </div>
            )}
            {proposal.savingsEstimate && (
              <div className="p-2 rounded-md bg-muted/30 border text-xs" data-testid={`text-savings-estimate-${dealId}`}>
                <div className="text-muted-foreground mb-0.5">Est. Savings (Draft)</div>
                <div className="font-semibold text-green-700 dark:text-green-400">
                  {proposal.savingsEstimate.includes("No clear") || proposal.savingsEstimate.includes("No estimate")
                    ? proposal.savingsEstimate
                    : proposal.savingsEstimate}
                </div>
              </div>
            )}
          </div>

          {parsedExtraction?.extraction && (
            <div className="p-2 rounded-md bg-muted/30 border text-xs space-y-1">
              {parsedExtraction.extraction.processorName && parsedExtraction.extraction.processorName !== "Unknown" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Processor</span>
                  <span className="font-medium">{parsedExtraction.extraction.processorName}</span>
                </div>
              )}
              {parsedExtraction.extraction.monthlyVolume > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly Volume</span>
                  <span className="font-medium">${parsedExtraction.extraction.monthlyVolume.toLocaleString()}</span>
                </div>
              )}
              {parsedExtraction.extraction.totalFees > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Fees</span>
                  <span className="font-medium">${parsedExtraction.extraction.totalFees.toLocaleString()}</span>
                </div>
              )}
              {parsedExtraction.extraction.topCostDrivers?.length > 0 && (
                <div>
                  <span className="text-muted-foreground block mb-0.5">Top Cost Drivers</span>
                  <ul className="space-y-0.5">
                    {parsedExtraction.extraction.topCostDrivers.map((driver: string, i: number) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-muted-foreground shrink-0">•</span>
                        <span>{driver}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground italic">
            All figures are estimated and for internal rep review only. Rep verification required before sharing with merchant.
          </p>
        </div>
      )}

      {(proposal?.status === "failed") && (
        <p className="text-xs text-muted-foreground">
          Analysis could not be completed automatically. Rep review required.
          {parsedExtraction ? "" : proposal.notes ? ` Reason: ${proposal.notes.slice(0, 100)}` : ""}
        </p>
      )}
    </div>
  );
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

  const appLinkMutation = useMutation({
    mutationFn: async ({ dealId }: { dealId: number }) => {
      const res = await apiRequest("POST", "/api/merchant-applications/prefill-token", {
        contactId,
        dealId,
      });
      return res.json() as Promise<{ token: string; url: string }>;
    },
    onSuccess: async (data: { token: string; url: string }) => {
      try {
        await navigator.clipboard.writeText(data.url);
        toast({ title: "Application link copied!", description: "Send this link to the merchant to pre-fill their application." });
      } catch {
        toast({ title: "Application link ready", description: data.url });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate link", description: err.message, variant: "destructive" });
    },
  });

  if (deals.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No deals yet</CardContent></Card>;
  }

  // Eligible deals for application link: not onboarding pipeline, not closed
  const eligibleDeals = deals.filter(
    d => d.pipeline !== "onboarding" && d.stage !== "Closed Won" && d.stage !== "Closed Lost",
  );

  return (
    <div className="space-y-3">
      {/* Application CTA — explicit 0/1/many selector */}
      {eligibleDeals.length === 0 && deals.length > 0 && (
        <p className="text-sm text-muted-foreground text-right" data-testid="text-no-eligible-deals">
          No open deals eligible for application link
        </p>
      )}
      {eligibleDeals.length === 1 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => appLinkMutation.mutate({ dealId: eligibleDeals[0].id })}
            disabled={appLinkMutation.isPending}
            data-testid="button-share-app-link-single"
          >
            {appLinkMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <ClipboardList className="w-3 h-3 mr-1" />
            )}
            Share Application Link
          </Button>
        </div>
      )}
      {eligibleDeals.length > 1 && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={appLinkMutation.isPending}
                data-testid="button-share-app-link-multi"
              >
                {appLinkMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <ClipboardList className="w-3 h-3 mr-1" />
                )}
                Share Application Link
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {eligibleDeals.map(d => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={() => appLinkMutation.mutate({ dealId: d.id })}
                  data-testid={`menu-app-link-deal-${d.id}`}
                >
                  <ClipboardList className="w-3 h-3 mr-2" />
                  Deal #{d.id} — {d.stage}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
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
            <StatementAnalysisSection dealId={deal.id} analysisStatus={(deal as any).analysisStatus ?? null} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
