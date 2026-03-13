import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  FileText,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Shield,
  Zap,
  Target,
  Clock,
  Star,
  Send,
  Calendar,
  XCircle,
} from "lucide-react";
import type { Deal, Contact } from "@shared/schema";

interface PlanData {
  name: string;
  shortName: string;
  headline: string;
  effectiveRate: string;
  monthlyFees: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  howItWorks: string;
  pros: string[];
  cons: string[];
  bestFor: string;
  libertyMarginBps: number;
  libertyMonthlyRevenue: number;
}

interface Proposal {
  merchantName: string;
  generatedAt: string;
  dealId: number;
  currentState: {
    monthlyVolume: number;
    effectiveRate: string;
    monthlyFees: number;
    annualFees: number;
    avgTicket: number;
    topIssues: string[];
  };
  plans: PlanData[];
  recommendedPlan: string;
  recommendedReason: string;
  urgencyCtas: string[];
  complianceDisclaimer: string;
  feeBreakdown: {
    currentInterchange: string;
    currentMarkup: string;
    currentMonthlyFees: string;
    currentPciFees: string;
    hiddenFees: string[];
  };
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatCurrencyExact(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

const planIcons: Record<string, typeof DollarSign> = {
  cashDiscount: Zap,
  interchangePlus: Target,
  tieredReduction: TrendingDown,
};

const planColors: Record<string, string> = {
  cashDiscount: "text-emerald-600 dark:text-emerald-400",
  interchangePlus: "text-blue-600 dark:text-blue-400",
  tieredReduction: "text-amber-600 dark:text-amber-400",
};

export default function StatementReview() {
  const { toast } = useToast();
  const [selectedDealId, setSelectedDealId] = useState<string>("");
  const [manualVolume, setManualVolume] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [manualTicket, setManualTicket] = useState("");
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const dealsWithStatements = deals.filter(
    (d) => d.statementReceived || d.stage === "Statement Received" || d.effectiveRate
  );

  const sendProposalMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/send-proposal`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Proposal Sent", description: "Proposal emailed to the merchant" });
    },
    onError: (err: Error) => {
      toast({ title: "Send Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSendProposal = (dealId: number) => {
    sendProposalMutation.mutate(dealId);
  };

  const generateMutation = useMutation({
    mutationFn: async (params: { dealId: number; statementData?: any }) => {
      const res = await apiRequest("POST", "/api/ai/generate-proposal", params);
      return res.json();
    },
    onSuccess: (data) => {
      setActiveProposal(data);
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Proposal Generated", description: `Savings proposal ready for ${data.merchantName}` });
    },
    onError: (err: Error) => {
      toast({ title: "Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleGenerate = () => {
    if (!selectedDealId) {
      toast({ title: "Select a Deal", description: "Please select a deal to generate a proposal for", variant: "destructive" });
      return;
    }
    generateMutation.mutate({
      dealId: Number(selectedDealId),
      statementData: manualVolume ? {
        monthlyVolume: manualVolume,
        effectiveRate: manualRate || undefined,
        avgTicket: manualTicket || undefined,
      } : undefined,
    });
  };

  const handleViewExisting = (deal: Deal) => {
    if (deal.savingsProposal) {
      setActiveProposal(deal.savingsProposal as any);
    } else {
      setSelectedDealId(String(deal.id));
      toast({ title: "No Proposal Yet", description: "Generate a new savings proposal for this deal" });
    }
  };

  const getContactName = (contactId: number | null) => {
    if (!contactId) return "Unknown";
    const c = contacts.find((ct) => ct.id === contactId);
    return c ? `${c.firstName} ${c.lastName}`.trim() || c.companyName || "Unknown" : "Unknown";
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-statement-review">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-statement-review-title">
          Statement Review & Savings Proposals
        </h1>
        <p className="text-muted-foreground">
          Analyze merchant statements and generate competitive pricing proposals with real savings breakdowns.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card data-testid="card-generate-proposal">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Generate Proposal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Deal</Label>
              <Select value={selectedDealId} onValueChange={setSelectedDealId}>
                <SelectTrigger data-testid="select-deal">
                  <SelectValue placeholder="Choose a deal..." />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)} data-testid={`select-deal-${d.id}`}>
                      {getContactName(d.contactId)} - {d.stage}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Monthly Volume ($)</Label>
              <Input
                placeholder="e.g. 50000"
                value={manualVolume}
                onChange={(e) => setManualVolume(e.target.value)}
                data-testid="input-proposal-volume"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Effective Rate (%)</Label>
                <Input
                  placeholder="e.g. 3.2"
                  value={manualRate}
                  onChange={(e) => setManualRate(e.target.value)}
                  data-testid="input-proposal-rate"
                />
              </div>
              <div className="space-y-2">
                <Label>Avg Ticket ($)</Label>
                <Input
                  placeholder="e.g. 45"
                  value={manualTicket}
                  onChange={(e) => setManualTicket(e.target.value)}
                  data-testid="input-proposal-ticket"
                />
              </div>
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleGenerate}
              disabled={generateMutation.isPending || !selectedDealId}
              data-testid="button-generate-proposal"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Proposal...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Savings Proposal
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Card data-testid="card-recent-reviews">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Deals with Statements
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dealsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : dealsWithStatements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No deals with statement data yet.</p>
              ) : (
                <div className="space-y-2">
                  {dealsWithStatements.slice(0, 10).map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-md border"
                      data-testid={`deal-row-${deal.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {getContactName(deal.contactId)}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                          <span>{deal.stage}</span>
                          {deal.effectiveRate && <span>Rate: {deal.effectiveRate}</span>}
                          {deal.totalVolume && <span>Vol: {deal.totalVolume}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {deal.savingsProposal ? (
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            {deal.proposalStatus === "sent" ? "Sent" : "Proposal Ready"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Needs Review
                          </Badge>
                        )}
                        {!!deal.savingsProposal && deal.proposalStatus !== "sent" && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleSendProposal(deal.id)}
                            disabled={sendProposalMutation.isPending}
                            data-testid={`button-send-deal-${deal.id}`}
                          >
                            {sendProposalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                            Send
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={deal.savingsProposal ? "outline" : "default"}
                          onClick={() => handleViewExisting(deal)}
                          data-testid={`button-view-deal-${deal.id}`}
                        >
                          {deal.savingsProposal ? "View" : "Generate"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {activeProposal && (
        <ProposalReport
          proposal={activeProposal}
          dealId={selectedDealId ? Number(selectedDealId) : activeProposal.dealId}
          onProposalUpdated={(updated) => setActiveProposal(updated)}
        />
      )}
    </div>
  );
}

function ProposalReport({ proposal, dealId, onProposalUpdated }: { proposal: Proposal; dealId?: number; onProposalUpdated?: (p: Proposal) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editPlans, setEditPlans] = useState<PlanData[]>(proposal.plans);
  const [editRecommendedReason, setEditRecommendedReason] = useState(proposal.recommendedReason || "");

  const { currentState, plans, feeBreakdown, urgencyCtas, complianceDisclaimer } = proposal;
  const recommended = plans.find((p) => p.shortName === proposal.recommendedPlan) || plans[0];

  const editMutation = useMutation({
    mutationFn: async (data: { plans: PlanData[]; recommendedReason: string }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}/edit-proposal`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      if (data.proposal && onProposalUpdated) {
        onProposalUpdated(data.proposal);
      }
      setEditing(false);
      toast({ title: "Proposal Updated", description: "Changes saved. You can now send the proposal." });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleEditPlanField = (planIndex: number, field: string, value: string | number) => {
    const updated = editPlans.map((plan, i) => {
      if (i !== planIndex) return plan;
      return { ...plan, [field]: value };
    });
    setEditPlans(updated);
  };

  const handleSaveEdits = () => {
    editMutation.mutate({ plans: editPlans, recommendedReason: editRecommendedReason });
  };

  return (
    <div className="space-y-6" data-testid="proposal-report">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold" data-testid="text-proposal-merchant">
            Savings Proposal: {proposal.merchantName}
          </h2>
          <p className="text-sm text-muted-foreground">
            Generated {new Date(proposal.generatedAt).toLocaleDateString()} at {new Date(proposal.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Star className="w-3 h-3" />
            Recommended: {recommended?.name}
          </Badge>
          {dealId && !editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditPlans([...proposal.plans]);
                setEditRecommendedReason(proposal.recommendedReason || "");
                setEditing(true);
              }}
              data-testid="button-edit-proposal"
            >
              Edit Before Sending
            </Button>
          )}
          {editing && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={handleSaveEdits}
                disabled={editMutation.isPending}
                data-testid="button-save-proposal-edits"
              >
                {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Save Changes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="button-cancel-edit">
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" data-testid="card-edit-mode">
          <CardContent className="p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Editing mode — modify plan details below, then save before sending to the merchant.
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <Label className="text-xs">Recommendation Reason</Label>
                <Input
                  value={editRecommendedReason}
                  onChange={(e) => setEditRecommendedReason(e.target.value)}
                  data-testid="input-edit-recommendation-reason"
                />
              </div>
              {editPlans.map((plan, idx) => (
                <div key={plan.shortName} className="border rounded-md p-3 space-y-2 bg-background">
                  <div className="font-medium text-sm">{plan.name}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Effective Rate</Label>
                      <Input
                        value={plan.effectiveRate}
                        onChange={(e) => handleEditPlanField(idx, "effectiveRate", e.target.value)}
                        data-testid={`input-edit-rate-${plan.shortName}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Monthly Savings ($)</Label>
                      <Input
                        type="number"
                        value={plan.monthlySavings}
                        onChange={(e) => handleEditPlanField(idx, "monthlySavings", Number(e.target.value))}
                        data-testid={`input-edit-monthly-savings-${plan.shortName}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Annual Savings ($)</Label>
                      <Input
                        type="number"
                        value={plan.annualSavings}
                        onChange={(e) => handleEditPlanField(idx, "annualSavings", Number(e.target.value))}
                        data-testid={`input-edit-annual-savings-${plan.shortName}`}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Headline</Label>
                    <Input
                      value={plan.headline}
                      onChange={(e) => handleEditPlanField(idx, "headline", e.target.value)}
                      data-testid={`input-edit-headline-${plan.shortName}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-current-state">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Current Processing Costs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <div className="text-xs text-muted-foreground">Monthly Volume</div>
              <div className="text-lg font-bold" data-testid="text-current-volume">
                {formatCurrency(currentState.monthlyVolume)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Effective Rate</div>
              <div className="text-lg font-bold text-destructive" data-testid="text-current-rate">
                {currentState.effectiveRate}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Monthly Fees</div>
              <div className="text-lg font-bold text-destructive" data-testid="text-current-monthly">
                {formatCurrencyExact(currentState.monthlyFees)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Annual Fees</div>
              <div className="text-lg font-bold text-destructive" data-testid="text-current-annual">
                {formatCurrency(currentState.annualFees)}
              </div>
            </div>
          </div>

          {currentState.topIssues && currentState.topIssues.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-sm font-medium mb-2">Fee Problems Identified</div>
              <ul className="space-y-1">
                {currentState.topIssues.map((issue, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feeBreakdown && feeBreakdown.hiddenFees && feeBreakdown.hiddenFees.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <div className="text-sm font-medium mb-2">Hidden Fees You're Paying</div>
              <div className="flex flex-wrap gap-2">
                {feeBreakdown.hiddenFees.map((fee, i) => (
                  <Badge key={i} variant="outline" className="text-destructive border-destructive/30">
                    {fee}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isRecommended = plan.shortName === proposal.recommendedPlan;
          const PlanIcon = planIcons[plan.shortName] || DollarSign;
          const colorClass = planColors[plan.shortName] || "text-foreground";

          return (
            <Card
              key={plan.shortName}
              className={isRecommended ? "ring-2 ring-primary" : ""}
              data-testid={`card-plan-${plan.shortName}`}
            >
              <CardHeader className="pb-3">
                {isRecommended && (
                  <Badge className="w-fit mb-2 gap-1">
                    <Star className="w-3 h-3" />
                    Recommended
                  </Badge>
                )}
                <CardTitle className="text-base flex items-center gap-2">
                  <PlanIcon className={`w-4 h-4 ${colorClass}`} />
                  {plan.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground italic">
                  "{plan.headline}"
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center p-4 rounded-md bg-muted/50">
                  <div className="text-xs text-muted-foreground mb-1">Your New Rate</div>
                  <div className={`text-3xl font-bold ${colorClass}`} data-testid={`text-rate-${plan.shortName}`}>
                    {plan.effectiveRate}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-2 rounded-md border">
                    <div className="text-xs text-muted-foreground">Monthly Savings</div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid={`text-monthly-savings-${plan.shortName}`}>
                      {formatCurrency(plan.monthlySavings)}
                    </div>
                  </div>
                  <div className="text-center p-2 rounded-md border">
                    <div className="text-xs text-muted-foreground">Annual Savings</div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid={`text-annual-savings-${plan.shortName}`}>
                      {formatCurrency(plan.annualSavings)}
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <Badge variant="secondary" className="text-sm gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {plan.savingsPercent}% Lower Fees
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground">
                  {plan.howItWorks}
                </div>

                {plan.pros && plan.pros.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1.5">Advantages</div>
                    <ul className="space-y-1">
                      {plan.pros.map((pro, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {plan.cons && plan.cons.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1.5">Considerations</div>
                    <ul className="space-y-1">
                      {plan.cons.map((con, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                          {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="border-t pt-3">
                  <div className="text-xs text-muted-foreground">Best For</div>
                  <div className="text-sm font-medium">{plan.bestFor}</div>
                </div>

                <Button
                  className="w-full gap-2"
                  variant={isRecommended ? "default" : "outline"}
                  data-testid={`button-select-plan-${plan.shortName}`}
                >
                  <Send className="w-4 h-4" />
                  {isRecommended ? "Send This Proposal" : "Select This Plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {proposal.recommendedReason && (
        <Card data-testid="card-recommendation">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium mb-1">Why We Recommend {recommended?.name}</div>
                <p className="text-sm text-muted-foreground">{proposal.recommendedReason}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {urgencyCtas && urgencyCtas.length > 0 && (
        <Card data-testid="card-ctas">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Close This Deal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {urgencyCtas.map((cta, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-md border"
                data-testid={`cta-${i}`}
              >
                <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium">{cta}</span>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button className="gap-2" data-testid="button-send-proposal">
                <Send className="w-4 h-4" />
                Send Proposal to Merchant
              </Button>
              <Button variant="outline" className="gap-2" data-testid="button-book-call">
                <Calendar className="w-4 h-4" />
                Book Follow-Up Call
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/30 border" data-testid="compliance-disclaimer">
        <Shield className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          {complianceDisclaimer || "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."}
        </p>
      </div>

      <Card data-testid="card-liberty-margin">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Liberty Bancard Revenue (Internal)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div key={plan.shortName} className="p-3 rounded-md border text-center">
                <div className="text-xs text-muted-foreground mb-1">{plan.name}</div>
                <div className="text-lg font-bold">{formatCurrencyExact(plan.libertyMonthlyRevenue)}/mo</div>
                <div className="text-xs text-muted-foreground">{plan.libertyMarginBps} bps margin</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
