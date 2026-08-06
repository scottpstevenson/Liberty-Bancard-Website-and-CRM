import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useState } from "react";
import { trackPhoneCallClick } from "@/lib/analytics";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, AlertTriangle, Phone, Mail, CheckCircle2, XCircle,
  TrendingDown, Zap, Target, Shield, DollarSign, Star, ArrowRight,
  Download, Printer,
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

interface CoBrandedProposalData {
  merchantName: string;
  merchantMonthlyVolume: string | null;
  merchantEffectiveRate: string | null;
  pricingPlan: string | null;
  customMessage: string | null;
  status: string;
  proposalData: {
    plans?: PlanData[];
    recommendedPlan?: string;
    recommendedReason?: string;
    recommendedTerminal?: string;
    urgencyCtas?: string[];
    complianceDisclaimer?: string;
    currentState?: {
      monthlyVolume: number;
      effectiveRate: string;
      monthlyFees: number;
      annualFees: number;
      topIssues: string[];
    };
    feeBreakdown?: {
      hiddenFees: string[];
    };
  } | null;
  partner: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    tagline: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
}

function formatCurrency(val: number | string): string {
  const num = typeof val === "string" ? parseFloat(val.replace(/[^0-9.]/g, "")) : val;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(num);
}

function hexContrast(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#1a1a2e" : "#ffffff";
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

export default function CoBrandedProposalViewer() {
  const { token } = useParams<{ token: string }>();
  const [accepted, setAccepted] = useState(false);

  const { data: proposal, isLoading, error } = useQuery<CoBrandedProposalData>({
    queryKey: ["/api/public/co-branded-proposal", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/co-branded-proposal/${token}`);
      if (!res.ok) throw new Error("Proposal not found");
      return res.json();
    },
    enabled: !!token,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/public/co-branded-proposal/${token}/accept`, { method: "POST" });
    },
    onSuccess: () => setAccepted(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="co-branded-proposal-loading">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500 mx-auto mb-4" />
          <p className="text-slate-600">Loading your proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="co-branded-proposal-not-found">
        <div className="text-center max-w-md px-6">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Proposal Not Found</h1>
          <p className="text-slate-600 mb-6">
            This proposal link may have expired or is invalid. Please contact your advisor for a new one.
          </p>
        </div>
      </div>
    );
  }

  const partner = proposal.partner;
  const primaryColor = partner.primaryColor || "#2563eb";
  const contrastColor = hexContrast(primaryColor);
  const plans = proposal.proposalData?.plans || [];
  const recommendedPlanKey = proposal.proposalData?.recommendedPlan || proposal.pricingPlan;
  const currentState = proposal.proposalData?.currentState;
  const urgencyCtas = proposal.proposalData?.urgencyCtas || [];
  const complianceDisclaimer = proposal.proposalData?.complianceDisclaimer ||
    "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates are based on information provided and actual results may vary.";

  const volume = parseFloat((proposal.merchantMonthlyVolume || "0").replace(/[^0-9.]/g, "")) || 0;
  const effectiveRate = parseFloat((proposal.merchantEffectiveRate || "3").replace(/[^0-9.]/g, "")) || 3;
  const monthlyFees = currentState?.monthlyFees ?? (volume > 0 ? volume * effectiveRate / 100 : 0);
  const annualFees = currentState?.annualFees ?? monthlyFees * 12;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="page-co-branded-proposal">
      {/* Print stylesheet — hides interactive chrome, keeps proposal content */}
      <style>{`
        @media print {
          /* Hide navigation, overlays, and action buttons */
          nav, header nav, [data-testid="navbar"],
          [data-testid="section-download-actions"],
          [data-testid="card-cta"] .flex,
          .print\\:hidden { display: none !important; }
          /* Only show the CTA card's heading/body text, not buttons */
          [data-testid="card-cta"] .flex { display: none !important; }
          /* Full-width clean layout */
          body { background: #fff !important; }
          .min-h-screen { min-height: unset !important; }
          main { padding-top: 0 !important; }
          /* Keep cards readable on paper */
          .shadow, .shadow-lg, .shadow-sm { box-shadow: none !important; }
          /* Page breaks */
          [data-testid="card-current-costs"],
          [data-testid="section-plans"] { page-break-inside: avoid; }
        }
      `}</style>

      <SEO
        title={`Savings Proposal — ${partner.name}`}
        description={`Custom savings proposal for ${proposal.merchantName} from ${partner.name}`}
        path={`/co-branded-proposal/${token || ""}`}
        noindex
      />

      {/* Partner Header */}
      <header
        style={{ backgroundColor: primaryColor, color: contrastColor }}
        data-testid="co-branded-proposal-header"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-4">
              {partner.logoUrl ? (
                <img
                  src={partner.logoUrl}
                  alt={`${partner.name} logo`}
                  className="h-12 w-auto object-contain rounded-lg"
                  style={{ background: "rgba(255,255,255,0.15)", padding: "4px" }}
                  data-testid="img-partner-logo"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold"
                  style={{ background: "rgba(255,255,255,0.2)" }}
                >
                  {partner.name.charAt(0)}
                </div>
              )}
              <div>
                <h2 className="text-xl font-bold" data-testid="text-partner-name">{partner.name}</h2>
                {partner.tagline && (
                  <p className="text-sm opacity-80 mt-0.5" data-testid="text-partner-tagline">{partner.tagline}</p>
                )}
              </div>
            </div>
            <div className="text-right text-sm opacity-85">
              {partner.contactName && <div className="font-semibold" data-testid="text-partner-contact">{partner.contactName}</div>}
              {partner.phone && <div data-testid="text-partner-phone">{partner.phone}</div>}
              {partner.email && <div data-testid="text-partner-email">{partner.email}</div>}
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: "20px" }}>
            <p className="text-xs uppercase tracking-widest opacity-70 mb-2">Custom Savings Proposal</p>
            <h1 className="text-2xl sm:text-3xl font-bold mb-1" data-testid="text-proposal-merchant">
              Prepared for {proposal.merchantName}
            </h1>
            <p className="text-sm opacity-70">
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Custom Message */}
        {proposal.customMessage && (
          <Card
            className="border-l-4"
            style={{ borderLeftColor: primaryColor }}
            data-testid="card-custom-message"
          >
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">A Note From Your Advisor</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{proposal.customMessage}</p>
            </CardContent>
          </Card>
        )}

        {/* Current Costs */}
        {(volume > 0 || currentState) && (
          <Card data-testid="card-current-costs">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                What You're Currently Paying
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {volume > 0 && (
                  <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs text-slate-500 mb-1">Monthly Volume</div>
                    <div className="text-xl font-bold text-slate-900" data-testid="text-volume">{formatCurrency(volume)}</div>
                  </div>
                )}
                {effectiveRate > 0 && (
                  <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs text-slate-500 mb-1">Effective Rate</div>
                    <div className="text-xl font-bold text-red-600" data-testid="text-rate">{effectiveRate}%</div>
                  </div>
                )}
                {monthlyFees > 0 && (
                  <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs text-slate-500 mb-1">Monthly Fees</div>
                    <div className="text-xl font-bold text-red-600" data-testid="text-monthly-fees">{formatCurrency(monthlyFees)}</div>
                  </div>
                )}
                {annualFees > 0 && (
                  <div className="text-center p-4 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs text-slate-500 mb-1">Annual Fees</div>
                    <div className="text-xl font-bold text-red-600" data-testid="text-annual-fees">{formatCurrency(annualFees)}</div>
                  </div>
                )}
              </div>

              {currentState?.topIssues && currentState.topIssues.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Problems Found in Your Statement</h3>
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

              {(proposal.proposalData?.feeBreakdown?.hiddenFees?.length ?? 0) > 0 && (
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Hidden Fees You're Paying</h3>
                  <div className="flex flex-wrap gap-2">
                    {proposal.proposalData?.feeBreakdown?.hiddenFees?.map((fee, i) => (
                      <Badge key={i} variant="outline" className="text-red-600 border-red-200 bg-red-50">{fee}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pricing Plans */}
        {plans.length > 0 && (
          <div data-testid="section-plans">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-5 h-5" style={{ color: primaryColor }} />
              <h2 className="text-xl font-bold text-slate-900">Your Pricing Options</h2>
            </div>
            {proposal.proposalData?.recommendedReason && (
              <p className="text-sm text-slate-600 mb-4">
                <span className="font-medium">Our recommendation:</span> {proposal.proposalData.recommendedReason}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {plans.map((plan) => {
                const isRec = plan.shortName === recommendedPlanKey;
                const PlanIcon = planIcons[plan.shortName] || DollarSign;
                const colorClass = planColors[plan.shortName] || "text-slate-900";
                const bgClass = planBgColors[plan.shortName] || "bg-slate-50";

                return (
                  <Card
                    key={plan.shortName}
                    className={`relative overflow-hidden ${isRec ? "shadow-lg" : "shadow"}`}
                    style={isRec ? { outline: `2px solid ${primaryColor}` } : {}}
                    data-testid={`card-plan-${plan.shortName}`}
                  >
                    {isRec && (
                      <div
                        className="text-center py-1.5 text-xs font-semibold tracking-wide uppercase"
                        style={{ backgroundColor: primaryColor, color: contrastColor }}
                      >
                        Recommended For You
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <PlanIcon className={`w-5 h-5 ${colorClass}`} />
                        {plan.name}
                      </CardTitle>
                      {plan.headline && <p className="text-sm text-slate-500 italic">"{plan.headline}"</p>}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className={`text-center p-5 rounded-lg ${bgClass}`}>
                        <div className="text-xs text-slate-500 mb-1">Your New Rate</div>
                        <div className={`text-4xl font-bold ${colorClass}`}>{plan.effectiveRate}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="text-center p-3 rounded-lg border bg-emerald-50 border-emerald-100">
                          <div className="text-xs text-slate-500">Monthly Savings</div>
                          <div className="text-lg font-bold text-emerald-600">{formatCurrency(plan.monthlySavings)}</div>
                        </div>
                        <div className="text-center p-3 rounded-lg border bg-emerald-50 border-emerald-100">
                          <div className="text-xs text-slate-500">Annual Savings</div>
                          <div className="text-lg font-bold text-emerald-600">{formatCurrency(plan.annualSavings)}</div>
                        </div>
                      </div>
                      <div className="text-center">
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                          <TrendingDown className="w-3 h-3" />
                          {plan.savingsPercent}% Lower Fees
                        </Badge>
                      </div>
                      {plan.howItWorks && <p className="text-sm text-slate-600">{plan.howItWorks}</p>}
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
                      {plan.bestFor && (
                        <div className="border-t pt-3">
                          <div className="text-xs text-slate-500">Best For</div>
                          <div className="text-sm font-medium text-slate-900">{plan.bestFor}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* No plans fallback */}
        {plans.length === 0 && (
          <Card data-testid="card-no-plans">
            <CardContent className="p-6 text-center">
              <p className="text-slate-600 text-sm">
                Your advisor is preparing a detailed pricing comparison. Contact them to discuss your custom rates.
              </p>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <Card
          className="border-0"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}dd)`, color: contrastColor }}
          data-testid="card-cta"
        >
          <CardContent className="p-6 sm:p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Ready to Start Saving?</h2>
            <p className="text-sm opacity-90 mb-6 max-w-lg mx-auto">
              Schedule a quick call with your {partner.name} advisor. We'll walk you through your options and answer any questions.
            </p>

            {urgencyCtas.length > 0 && (
              <div className="space-y-2 mb-6 max-w-md mx-auto">
                {urgencyCtas.map((cta, i) => (
                  <div key={i} className="text-sm flex items-center gap-2 justify-center opacity-90">
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    {cta}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
              {partner.phone && (
                <a href={`tel:${partner.phone.replace(/[^0-9+]/g, "")}`} data-testid="link-call-partner"
                  onClick={() => trackPhoneCallClick({ sourcePage: "/proposal" })}>
                  <Button
                    size="lg"
                    className="gap-2 w-full sm:w-auto"
                    style={{ background: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.4)", color: contrastColor }}
                    variant="outline"
                  >
                    <Phone className="w-4 h-4" />
                    Call {partner.phone}
                  </Button>
                </a>
              )}
              {partner.email && (
                <a href={`mailto:${partner.email}`} data-testid="link-email-partner">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 w-full sm:w-auto"
                    style={{ background: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.4)", color: contrastColor }}
                  >
                    <Mail className="w-4 h-4" />
                    Email Us
                  </Button>
                </a>
              )}
              {!accepted ? (
                <Button
                  size="lg"
                  className="gap-2 w-full sm:w-auto font-bold"
                  style={{ background: "rgba(255,255,255,0.95)", color: primaryColor }}
                  onClick={() => acceptMutation.mutate()}
                  disabled={acceptMutation.isPending}
                  data-testid="button-accept-proposal"
                >
                  {acceptMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Accept This Proposal
                </Button>
              ) : (
                <div
                  className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm"
                  style={{ background: "rgba(255,255,255,0.95)", color: "#059669" }}
                  data-testid="text-proposal-accepted"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Proposal Accepted! Your advisor will be in touch.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Print / Download */}
        <div className="flex justify-center gap-3 flex-wrap print:hidden" data-testid="section-download-actions">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => window.print()}
            data-testid="button-download-pdf"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => window.print()}
            data-testid="button-print-proposal"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
        </div>

        {/* Compliance disclaimer */}
        <p className="text-xs text-slate-400 text-center px-4 pb-4" data-testid="text-compliance">
          {complianceDisclaimer}
        </p>

        {/* Powered by Liberty Bancard footer */}
        <footer className="text-center pb-8 border-t pt-6" data-testid="footer-powered-by">
          <p className="text-xs text-slate-400">
            Powered by <strong>Liberty Bancard</strong> · © {new Date().getFullYear()} Liberty Bancard. All rights reserved.
          </p>
        </footer>
      </main>
    </div>
  );
}
