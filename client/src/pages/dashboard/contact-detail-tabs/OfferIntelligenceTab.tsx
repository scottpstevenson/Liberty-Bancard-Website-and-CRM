import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, GitFork, ChevronDown, ChevronUp } from "lucide-react";
import type { Contact } from "@shared/schema";
import { formatRelativeTime } from "./shared";

const OFFER_ROUTES = [
  "beat_square", "beat_stripe", "beat_clover", "beat_toast", "beat_paypal",
  "free_statement_analysis", "free_smart_terminal",
  "compliant_cash_discount_review", "compliant_surcharge_review", "dual_pricing_review",
  "industry_specific_rate_review", "merchant_application", "partner_referral",
] as const;

const RECOMMENDED_NEXT_ACTIONS = [
  "call_now", "book_appointment", "upload_statement", "request_free_analysis",
  "check_terminal_eligibility", "explore_fee_offset_review", "start_application",
  "send_proposal", "manual_review",
] as const;

function offerRouteBadgeClass(route: string): string {
  if (route.startsWith("beat_")) return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800";
  if (route.startsWith("free_")) return "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800";
  if (route.startsWith("compliant_") || route === "dual_pricing_review") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
  if (route === "industry_specific_rate_review") return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800";
  if (route === "merchant_application") return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
  if (route === "partner_referral") return "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700";
  return "bg-gray-100 text-gray-800 border-gray-200";
}

function formatRouteName(route: string): string {
  return route.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? "bg-green-500" : value >= 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Confidence</span>
        <span>{value}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

interface OfferIntelligenceTabProps {
  contact: Contact;
  isManagerOrAdmin: boolean;
}

export function OfferIntelligenceTab({ contact, isManagerOrAdmin }: OfferIntelligenceTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideRoute, setOverrideRoute] = useState<string>("");
  const [overrideAction, setOverrideAction] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState("");
  const [showFullReasoning, setShowFullReasoning] = useState(false);

  const isAgent = user?.role === "agent";

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/contacts/${contact.id}/route-offer`, { updateContact: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      toast({ title: "Offer route refreshed" });
    },
    onError: (err: Error) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: () => {
      if (!overrideRoute) throw new Error("Please select an offer route");
      if (!overrideReason.trim()) throw new Error("Reason is required");
      return apiRequest("PATCH", `/api/contacts/${contact.id}/offer-route`, {
        offerRoute: overrideRoute,
        recommendedNextAction: overrideAction || undefined,
        reason: overrideReason.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      setShowOverrideDialog(false);
      setOverrideRoute("");
      setOverrideAction("");
      setOverrideReason("");
      toast({ title: "Offer route override saved" });
    },
    onError: (err: Error) => toast({ title: "Override failed", description: err.message, variant: "destructive" }),
  });

  const isManualOverride = contact.offerRoutingSource === "manual_override";
  const hasRoute = !!contact.primaryOfferPath;
  const matchedSignals = (contact.offerMatchedSignals as string[] | null) ?? [];
  const reasoning = contact.offerReasoning ?? "";
  const truncatedReasoning = reasoning.length > 200 ? reasoning.slice(0, 200) + "…" : reasoning;

  if (!hasRoute) {
    return (
      <Card data-testid="offer-intelligence-empty">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <GitFork className="h-12 w-12 mx-auto text-muted-foreground opacity-30" />
          <div>
            <p className="font-medium text-muted-foreground">No offer route assigned yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click Refresh Route to analyze this contact.</p>
          </div>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid="button-refresh-offer-route"
          >
            {refreshMutation.isPending ? (
              <span className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Route
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="offer-intelligence-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitFork className="h-4 w-4 text-primary" />
              Offer Intelligence
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                data-testid="button-refresh-offer-route"
              >
                {refreshMutation.isPending ? (
                  <span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full inline-block" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">Refresh</span>
              </Button>
              {isManagerOrAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowOverrideDialog(true)}
                  data-testid="button-override-offer-route"
                >
                  Override
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" data-testid="section-offer-route">
            <span className="text-sm font-medium text-muted-foreground">Offer Route:</span>
            <Badge
              className={`border ${offerRouteBadgeClass(contact.primaryOfferPath!)}`}
              data-testid="badge-offer-route"
            >
              {formatRouteName(contact.primaryOfferPath!)}
            </Badge>
            {contact.recommendedNextAction && (
              <Badge variant="outline" className="text-xs" data-testid="badge-next-action">
                Next: {formatRouteName(contact.recommendedNextAction)}
              </Badge>
            )}
            {isManualOverride && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-manual-override">
                Manual Override
              </Badge>
            )}
          </div>

          {!isManualOverride && contact.offerConfidence != null && (
            <div data-testid="section-confidence-bar">
              <ConfidenceBar value={contact.offerConfidence} />
            </div>
          )}

          {contact.processorDetected && (
            <div className="flex items-center gap-2" data-testid="section-processor-detected">
              <span className="text-xs text-muted-foreground">Detected processor:</span>
              <Badge variant="secondary" className="text-xs" data-testid="badge-processor-detected">
                {contact.processorDetected}
              </Badge>
            </div>
          )}

          {matchedSignals.length > 0 && (
            <div data-testid="section-matched-signals">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Matched Signals</p>
              <div className="flex flex-wrap gap-1.5">
                {matchedSignals.map((signal, i) => (
                  <Badge key={i} variant="outline" className="text-xs font-mono" data-testid={`badge-signal-${i}`}>
                    {signal}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {reasoning && (
            <div data-testid="section-reasoning">
              <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
              <p className="text-sm text-foreground leading-relaxed" data-testid="text-reasoning">
                {showFullReasoning ? reasoning : truncatedReasoning}
              </p>
              {reasoning.length > 200 && (
                <button
                  onClick={() => setShowFullReasoning(!showFullReasoning)}
                  className="text-xs text-primary hover:underline mt-1 flex items-center gap-0.5"
                  data-testid="button-toggle-reasoning"
                >
                  {showFullReasoning ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-3" data-testid="section-routing-meta">
            {contact.offerRoutingSource && (
              <span data-testid="text-routing-source">
                Source: <span className="font-medium text-foreground">{formatRouteName(contact.offerRoutingSource)}</span>
              </span>
            )}
            {contact.offerRoutedAt && (
              <span data-testid="text-routed-at">
                Routed: <span className="font-medium text-foreground">{formatRelativeTime(contact.offerRoutedAt as unknown as string)}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <DialogContent data-testid="dialog-override-offer-route">
          <DialogHeader>
            <DialogTitle>Override Offer Route</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Offer Route *</label>
              <Select value={overrideRoute} onValueChange={setOverrideRoute}>
                <SelectTrigger data-testid="select-override-route">
                  <SelectValue placeholder="Select offer route…" />
                </SelectTrigger>
                <SelectContent>
                  {OFFER_ROUTES.map(r => (
                    <SelectItem key={r} value={r}>{formatRouteName(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Recommended Next Action (optional)</label>
              <Select value={overrideAction} onValueChange={setOverrideAction}>
                <SelectTrigger data-testid="select-override-action">
                  <SelectValue placeholder="Select action…" />
                </SelectTrigger>
                <SelectContent>
                  {RECOMMENDED_NEXT_ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>{formatRouteName(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason *</label>
              <Input
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Briefly explain why you're overriding the route"
                data-testid="input-override-reason"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowOverrideDialog(false)} data-testid="button-cancel-override">
                Cancel
              </Button>
              <Button
                onClick={() => overrideMutation.mutate()}
                disabled={overrideMutation.isPending || !overrideRoute || !overrideReason.trim()}
                data-testid="button-confirm-override"
              >
                {overrideMutation.isPending ? "Saving…" : "Save Override"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
