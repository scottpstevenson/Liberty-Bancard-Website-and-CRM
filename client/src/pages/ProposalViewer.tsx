import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  Star,
  Zap,
  Target,
  Shield,
  Phone,
  Mail,
  Calendar,
  XCircle,
  ArrowRight,
} from "lucide-react";

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
}

interface ProposalData {
  merchantName: string;
  contactFirstName: string;
  vertical: string;
  generatedAt: string;
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
  recommendedTerminal: string;
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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function formatCurrencyExact(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
}

const planIcons: Record<string, typeof DollarSign> = {
  cashDiscount: Zap,
  interchangePlus: Target,
  flatRate: Shield,
  tieredReduction: TrendingDown,
};

const planColors: Record<string, string> = {
  cashDiscount: "text-emerald-600",
  interchangePlus: "text-blue-600",
  flatRate: "text-violet-600",
  tieredReduction: "text-amber-600",
};

const planBgColors: Record<string, string> = {
  cashDiscount: "bg-emerald-50",
  interchangePlus: "bg-blue-50",
  flatRate: "bg-violet-50",
  tieredReduction: "bg-amber-50",
};

export default function ProposalViewer() {
  const { token } = useParams<{ token: string }>();

  const { data: proposal, isLoading, error } = useQuery<ProposalData>({
    queryKey: ["/api/public/proposal", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/proposal/${token}`);
      if (!res.ok) throw new Error("Proposal not found");
      return res.json();
    },
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="proposal-loading">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500 mx-auto mb-4" />
          <p className="text-slate-600">Loading your savings proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="proposal-not-found">
        <div className="text-center max-w-md px-6">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Proposal Not Found</h1>
          <p className="text-slate-600 mb-6">
            This proposal link may have expired or is invalid. Please contact us for a new proposal.
          </p>
          <a href="tel:9542668214">
            <Button className="gap-2" data-testid="button-call-us">
              <Phone className="w-4 h-4" />
              Call 954-266-8214
            </Button>
          </a>
        </div>
      </div>
    );
  }

  const { currentState, plans, feeBreakdown, urgencyCtas, complianceDisclaimer } = proposal;
  const recommended = plans.find((p) => p.shortName === proposal.recommendedPlan) || plans[0];

  return (
    <div className="min-h-screen bg-slate-50" data-testid="page-proposal-viewer">
      <SEO title="Your Liberty Bancard Proposal" description="Review your custom Liberty Bancard processing proposal — pricing, projected savings, equipment, and next steps." path={`/proposal/${token || ""}`} noindex />
      <header className="bg-slate-900 text-white" data-testid="proposal-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-sky-400" />
            <span className="text-sky-400 font-semibold text-sm tracking-wide uppercase">Liberty Bancard</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2" data-testid="text-proposal-heading">
            Your Savings Proposal
          </h1>
          <p className="text-slate-400 text-lg" data-testid="text-proposal-merchant-name">
            Prepared for {proposal.merchantName}
          </p>
          {proposal.generatedAt && (
            <p className="text-slate-500 text-sm mt-1">
              Generated {new Date(proposal.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <Card data-testid="card-current-costs">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              What You're Currently Paying
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                <div className="text-xs text-slate-500 mb-1">Monthly Volume</div>
                <div className="text-xl font-bold text-slate-900" data-testid="text-pub-current-volume">
                  {formatCurrency(currentState.monthlyVolume)}
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                <div className="text-xs text-slate-500 mb-1">Effective Rate</div>
                <div className="text-xl font-bold text-red-600" data-testid="text-pub-current-rate">
                  {currentState.effectiveRate}
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                <div className="text-xs text-slate-500 mb-1">Monthly Fees</div>
                <div className="text-xl font-bold text-red-600" data-testid="text-pub-current-monthly">
                  {formatCurrencyExact(currentState.monthlyFees)}
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                <div className="text-xs text-slate-500 mb-1">Annual Fees</div>
                <div className="text-xl font-bold text-red-600" data-testid="text-pub-current-annual">
                  {formatCurrency(currentState.annualFees)}
                </div>
              </div>
            </div>

            {currentState.topIssues && currentState.topIssues.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Problems We Found in Your Statement</h3>
                <ul className="space-y-2">
                  {currentState.topIssues.map((issue, i) => (
                    <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                      <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feeBreakdown?.hiddenFees && feeBreakdown.hiddenFees.length > 0 && (
              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Hidden Fees You're Paying</h3>
                <div className="flex flex-wrap gap-2">
                  {feeBreakdown.hiddenFees.map((fee, i) => (
                    <Badge key={i} variant="outline" className="text-red-600 border-red-200 bg-red-50">
                      {fee}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-5 h-5 text-sky-500" />
            <h2 className="text-xl font-bold text-slate-900">Your Pricing Options</h2>
          </div>
          {proposal.recommendedReason && (
            <p className="text-sm text-slate-600 mb-4">
              <span className="font-medium">Our recommendation:</span> {proposal.recommendedReason}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((plan) => {
              const isRecommended = plan.shortName === proposal.recommendedPlan;
              const PlanIcon = planIcons[plan.shortName] || DollarSign;
              const colorClass = planColors[plan.shortName] || "text-slate-900";
              const bgClass = planBgColors[plan.shortName] || "bg-slate-50";

              return (
                <Card
                  key={plan.shortName}
                  className={`relative overflow-hidden ${isRecommended ? "ring-2 ring-sky-500 shadow-lg" : "shadow"}`}
                  data-testid={`card-pub-plan-${plan.shortName}`}
                >
                  {isRecommended && (
                    <div className="bg-sky-500 text-white text-center py-1.5 text-xs font-semibold tracking-wide uppercase">
                      Recommended For You
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <PlanIcon className={`w-5 h-5 ${colorClass}`} />
                      {plan.name}
                    </CardTitle>
                    <p className="text-sm text-slate-500 italic">"{plan.headline}"</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className={`text-center p-5 rounded-lg ${bgClass}`}>
                      <div className="text-xs text-slate-500 mb-1">Your New Rate</div>
                      <div className={`text-4xl font-bold ${colorClass}`} data-testid={`text-pub-rate-${plan.shortName}`}>
                        {plan.effectiveRate}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-3 rounded-lg border bg-emerald-50 border-emerald-100">
                        <div className="text-xs text-slate-500">Monthly Savings</div>
                        <div className="text-lg font-bold text-emerald-600" data-testid={`text-pub-monthly-savings-${plan.shortName}`}>
                          {formatCurrency(plan.monthlySavings)}
                        </div>
                      </div>
                      <div className="text-center p-3 rounded-lg border bg-emerald-50 border-emerald-100">
                        <div className="text-xs text-slate-500">Annual Savings</div>
                        <div className="text-lg font-bold text-emerald-600" data-testid={`text-pub-annual-savings-${plan.shortName}`}>
                          {formatCurrency(plan.annualSavings)}
                        </div>
                      </div>
                    </div>

                    <div className="text-center">
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                        <TrendingDown className="w-3 h-3" />
                        {plan.savingsPercent}% Lower Fees
                      </Badge>
                    </div>

                    <p className="text-sm text-slate-600">{plan.howItWorks}</p>

                    {plan.pros && plan.pros.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-1.5">Advantages</div>
                        <ul className="space-y-1">
                          {plan.pros.map((pro, i) => (
                            <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                              {pro}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {plan.cons && plan.cons.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-1.5">Considerations</div>
                        <ul className="space-y-1">
                          {plan.cons.map((con, i) => (
                            <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                              {con}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="border-t pt-3">
                      <div className="text-xs text-slate-500">Best For</div>
                      <div className="text-sm font-medium text-slate-900">{plan.bestFor}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {proposal.recommendedTerminal && (
          <Card data-testid="card-terminal-recommendation">
            <CardContent className="p-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4 text-sky-500" />
                Recommended Terminal
              </h3>
              <p className="text-sm text-slate-600">{proposal.recommendedTerminal}</p>
            </CardContent>
          </Card>
        )}

        <Card className="border-sky-200 bg-sky-50" data-testid="card-cta">
          <CardContent className="p-6 sm:p-8 text-center">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">
              Ready to Start Saving?
            </h2>
            <p className="text-slate-600 mb-6 max-w-lg mx-auto">
              Schedule a quick 10-minute call with our team. We'll walk you through your options and answer any questions.
            </p>

            {urgencyCtas && urgencyCtas.length > 0 && (
              <div className="space-y-2 mb-6 max-w-md mx-auto">
                {urgencyCtas.map((cta, i) => (
                  <div key={i} className="text-sm text-sky-700 flex items-center gap-2 justify-center">
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    {cta}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href="tel:9542668214" data-testid="link-proposal-call">
                <Button size="lg" className="gap-2 bg-sky-600 hover:bg-sky-700 w-full sm:w-auto">
                  <Phone className="w-4 h-4" />
                  Call 954-266-8214
                </Button>
              </a>
              <a href="mailto:sales@libertybancard.com" data-testid="link-proposal-email">
                <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                  <Mail className="w-4 h-4" />
                  Email Us
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        {complianceDisclaimer && (
          <p className="text-xs text-slate-400 text-center px-4 pb-8" data-testid="text-compliance-disclaimer">
            {complianceDisclaimer}
          </p>
        )}

        <footer className="text-center pb-8">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} Liberty Bancard. All rights reserved.
          </p>
        </footer>
      </main>
    </div>
  );
}
