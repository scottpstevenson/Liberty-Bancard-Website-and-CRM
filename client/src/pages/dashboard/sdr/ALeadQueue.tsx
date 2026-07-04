import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, ListChecks, CheckSquare, ThumbsDown, Ban, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ScoreBreakdown {
  fitScore?: number;
  revenueScore?: number;
  reachabilityScore?: number;
  processorScore?: number;
  growthScore?: number;
  [key: string]: number | undefined;
}

interface ProcessorEvidence {
  vendor: string | null;
  confidence: number | null;
  source: "processorSignals" | "enrichmentData" | "none";
  detectedAt: string | null;
}

interface ALeadItem {
  id: number;
  stage: string;
  priorityBucket: string | null;
  priorityScore: number | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  vertical: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  fitScore: number | null;
  revenueScore: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  processorEvidence: ProcessorEvidence | null;
  createdAt: string | null;
  updatedAt: string | null;
  merchant: {
    businessName: string;
    website: string | null;
    domain: string | null;
    mainPhone: string | null;
    mainEmail: string | null;
    ownerFirstName: string | null;
    ownerLastName: string | null;
    source: string | null;
    vertical: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

const BUCKET_CLASS: Record<string, string> = {
  A: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  B: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
};

const ACTION_LABEL: Record<string, string> = {
  promote: "Promote to CRM",
  discard: "Discard",
  suppress: "Internal Suppress",
};

function ScoreBreakdownTooltip({ breakdown }: { breakdown: ScoreBreakdown | null }) {
  if (!breakdown) return null;
  const entries = Object.entries(breakdown).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="ml-1 text-muted-foreground hover:text-foreground" data-testid="button-score-breakdown-info">
            <Info className="w-3 h-3 inline" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-[200px]">
          <div className="space-y-1">
            {entries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                <span className="font-mono font-medium">{v}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ALeadQueue() {
  const { toast } = useToast();
  const [confirmLead, setConfirmLead] = useState<ALeadItem | null>(null);
  const [confirmAction, setConfirmAction] = useState<"promote" | "discard" | "suppress" | null>(null);
  const [reason, setReason] = useState("");
  const [noEmailWarning, setNoEmailWarning] = useState(false);
  const [pendingPromoteLead, setPendingPromoteLead] = useState<ALeadItem | null>(null);

  const { data: leads, isLoading, isError, refetch } = useQuery<ALeadItem[]>({
    queryKey: ["/api/sdr/a-lead-queue"],
    queryFn: async () => {
      const res = await fetch("/api/sdr/a-lead-queue", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch A-lead queue");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/sdr/a-lead-queue/${id}/${action}`, { reason });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      const labels: Record<string, string> = {
        promote: "Promoted to CRM",
        discard: "Discarded",
        suppress: "Internally Suppressed",
      };
      toast({ title: labels[vars.action] || "Done", description: `Lead has been actioned and removed from the queue.` });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/a-lead-queue"] });
      closeConfirm();
    },
    onError: (err: any) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  function closeConfirm() {
    setConfirmLead(null);
    setConfirmAction(null);
    setReason("");
  }

  function openConfirm(lead: ALeadItem, action: "promote" | "discard" | "suppress") {
    setConfirmLead(lead);
    setConfirmAction(action);
    setReason("");
  }

  function handlePromoteClick(lead: ALeadItem) {
    const hasEmail = !!(lead.ownerEmail || lead.email || lead.merchant?.mainEmail);
    if (!hasEmail) {
      setPendingPromoteLead(lead);
      setNoEmailWarning(true);
    } else {
      openConfirm(lead, "promote");
    }
  }

  function confirmNoEmailAndProceed() {
    if (pendingPromoteLead) openConfirm(pendingPromoteLead, "promote");
    setNoEmailWarning(false);
    setPendingPromoteLead(null);
  }

  function executeAction() {
    if (!confirmLead || !confirmAction) return;
    actionMutation.mutate({ id: confirmLead.id, action: confirmAction, reason: reason.trim() || undefined });
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">A-Lead Review Queue</h2>
          <p className="text-sm text-muted-foreground">
            A/B-priority discovered merchants awaiting human review. No outreach has been sent to any of these leads.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-lead-queue">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading leads…</span>
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-10 text-center text-destructive text-sm">
            Failed to load leads. Check that you have admin or manager access.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (!leads || leads.length === 0) && (
        <Card>
          <CardContent className="py-16 text-center">
            <ListChecks className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-muted-foreground">No A/B priority leads pending review</p>
            <p className="text-xs text-muted-foreground mt-1">
              New leads appear here once they are scored into the A or B priority bucket.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && leads && leads.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {leads.length} lead{leads.length !== 1 ? "s" : ""} pending review
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Priority</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Business</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">City / State</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Vertical</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Source</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Score</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Processor</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Owner</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Discovered</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const bucket = lead.priorityBucket ?? "B";
                    const businessName = lead.companyName ?? lead.merchant?.businessName ?? "—";
                    const website = lead.website ?? lead.merchant?.website ?? lead.merchant?.domain ?? null;
                    const location = [
                      lead.city ?? lead.merchant?.city,
                      lead.state ?? lead.merchant?.state,
                    ].filter(Boolean).join(", ") || "—";
                    const vertical = lead.vertical ?? lead.merchant?.vertical ?? "—";
                    const source = lead.merchant?.source ?? "—";
                    const ownerEmail = lead.ownerEmail ?? lead.email ?? lead.merchant?.mainEmail;
                    const ownerPhone = lead.ownerPhone ?? lead.phone ?? lead.merchant?.mainPhone;
                    const ownerName = lead.ownerName ??
                      [lead.merchant?.ownerFirstName, lead.merchant?.ownerLastName].filter(Boolean).join(" ") || null;

                    return (
                      <tr
                        key={lead.id}
                        className="border-b hover:bg-muted/20 transition-colors align-top"
                        data-testid={`row-alead-${lead.id}`}
                      >
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            className={cn("font-bold text-xs", BUCKET_CLASS[bucket] ?? "bg-muted text-muted-foreground")}
                            data-testid={`badge-bucket-${lead.id}`}
                          >
                            {bucket}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 max-w-[160px]">
                          <div className="font-medium truncate" data-testid={`text-business-${lead.id}`}>{businessName}</div>
                          {website && (
                            <a
                              href={website.startsWith("http") ? website : `https://${website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline truncate block"
                              data-testid={`link-website-${lead.id}`}
                            >
                              {website}
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs" data-testid={`text-location-${lead.id}`}>
                          {location}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs capitalize" data-testid={`text-vertical-${lead.id}`}>
                          {vertical}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs" data-testid={`text-source-${lead.id}`}>
                          {source}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-0.5">
                            <span className="font-mono text-xs font-medium" data-testid={`text-score-${lead.id}`}>
                              {lead.priorityScore ?? 0}
                            </span>
                            <ScoreBreakdownTooltip breakdown={lead.scoreBreakdown} />
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {lead.processorEvidence?.vendor ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="text-xs whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                                    data-testid={`badge-processor-${lead.id}`}
                                  >
                                    {lead.processorEvidence.vendor}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs max-w-[200px]">
                                  <div className="space-y-1">
                                    {lead.processorEvidence.confidence != null && (
                                      <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">Confidence</span>
                                        <span className="font-mono font-medium">{Math.round(lead.processorEvidence.confidence * 100)}%</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Source</span>
                                      <span className="font-mono font-medium">{lead.processorEvidence.source}</span>
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <Badge variant="secondary" className="text-xs whitespace-nowrap" data-testid={`badge-processor-${lead.id}`}>
                              Unknown / not yet detected
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[150px]">
                          {ownerName && (
                            <div className="font-medium text-xs truncate" data-testid={`text-owner-${lead.id}`}>{ownerName}</div>
                          )}
                          {ownerEmail ? (
                            <div className="text-xs text-muted-foreground truncate" data-testid={`text-email-${lead.id}`}>{ownerEmail}</div>
                          ) : (
                            <div className="text-xs text-amber-600 font-medium" data-testid={`text-noemail-${lead.id}`}>No email on file</div>
                          )}
                          {ownerPhone && (
                            <div className="text-xs text-muted-foreground" data-testid={`text-phone-${lead.id}`}>{ownerPhone}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-discovered-${lead.id}`}>
                          {formatDate(lead.createdAt)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-2 text-xs whitespace-nowrap"
                              onClick={() => handlePromoteClick(lead)}
                              disabled={actionMutation.isPending}
                              data-testid={`button-promote-${lead.id}`}
                            >
                              <CheckSquare className="w-3 h-3 mr-1" />
                              Promote to CRM
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => openConfirm(lead, "discard")}
                              disabled={actionMutation.isPending}
                              data-testid={`button-discard-${lead.id}`}
                            >
                              <ThumbsDown className="w-3 h-3 mr-1" />
                              Discard
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => openConfirm(lead, "suppress")}
                              disabled={actionMutation.isPending}
                              data-testid={`button-suppress-${lead.id}`}
                            >
                              <Ban className="w-3 h-3 mr-1" />
                              Internal Suppress
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No-Email Warning Dialog */}
      <Dialog
        open={noEmailWarning}
        onOpenChange={(open) => { if (!open) { setNoEmailWarning(false); setPendingPromoteLead(null); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Email Available for Deduplication</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            No email address was found for this merchant's owner or business record. If this merchant already
            exists in the CRM under a different record, this promotion may create a duplicate contact. Proceed anyway?
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => { setNoEmailWarning(false); setPendingPromoteLead(null); }}
              data-testid="button-noemail-cancel"
            >
              Cancel
            </Button>
            <Button onClick={confirmNoEmailAndProceed} data-testid="button-noemail-confirm">
              Proceed Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Action Confirmation Dialog */}
      <Dialog open={!!confirmLead && !!confirmAction} onOpenChange={(open) => { if (!open) closeConfirm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction ? ACTION_LABEL[confirmAction] : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {confirmAction === "promote" && (
                <>Promote <strong>{confirmLead?.companyName ?? confirmLead?.merchant?.businessName ?? "this lead"}</strong> to CRM?
                The system will check for an existing contact by email first. If none is found, a new contact will be created (GHL-first). No outreach will be sent.</>
              )}
              {confirmAction === "discard" && (
                <>Discard <strong>{confirmLead?.companyName ?? confirmLead?.merchant?.businessName ?? "this lead"}</strong>?
                The merchant record is preserved but removed from the review queue. No outreach will be sent.</>
              )}
              {confirmAction === "suppress" && (
                <>Internally suppress <strong>{confirmLead?.companyName ?? confirmLead?.merchant?.businessName ?? "this lead"}</strong>?
                This is an internal not-a-fit decision and is NOT a merchant-requested DNC or opt-out. No legal DNC flag will be set.</>
              )}
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reason (optional)</label>
              <Textarea
                placeholder={
                  confirmAction === "promote"
                    ? "e.g. High-value prospect, owner confirmed interest"
                    : "e.g. Wrong vertical, existing customer, out of area"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-sm"
                rows={2}
                data-testid="input-action-reason"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={closeConfirm} data-testid="button-confirm-cancel">
              Cancel
            </Button>
            <Button
              variant={confirmAction === "promote" ? "default" : "destructive"}
              onClick={executeAction}
              disabled={actionMutation.isPending}
              data-testid="button-confirm-execute"
            >
              {actionMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              {confirmAction ? ACTION_LABEL[confirmAction] : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
