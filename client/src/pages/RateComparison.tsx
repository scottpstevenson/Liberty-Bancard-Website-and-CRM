import { useState } from "react";
import { SEO, getReviewSchema } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { serializeJsonLd } from "../../../shared/json-ld";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  ArrowRight,
  CheckCircle2,
  X,
  Minus,
  BarChart3,
  ShieldCheck,
  Headphones,
  DollarSign,
  Calculator,
  BadgeCheck,
  Users,
  Zap,
  Link2,
  Check,
} from "lucide-react";

const processors = [
  {
    name: "Liberty Bancard",
    highlight: true,
    pricing: "Interchange + 0.15-0.40%",
    monthlyFee: "$0 - $9.95",
    contractTerms: "No long-term contract",
    earlyTermination: "None",
    pciCompliance: "Included",
    nextDayFunding: true,
    dedicatedSupport: true,
    statementReview: true,
    freeTerminal: true,
    cashDiscount: true,
    transparentPricing: true,
    customReporting: true,
    onboardingSupport: true,
    bestFor: "Businesses processing $5K+/month wanting transparent pricing",
  },
  {
    name: "Square",
    highlight: false,
    pricing: "2.6% + $0.10 flat",
    monthlyFee: "$0",
    contractTerms: "No contract",
    earlyTermination: "None",
    pciCompliance: "Included",
    nextDayFunding: false,
    dedicatedSupport: false,
    statementReview: false,
    freeTerminal: false,
    cashDiscount: false,
    transparentPricing: false,
    customReporting: false,
    onboardingSupport: false,
    bestFor: "Very small businesses, occasional sellers, mobile vendors",
  },
  {
    name: "Stripe",
    highlight: false,
    pricing: "2.9% + $0.30 online",
    monthlyFee: "$0",
    contractTerms: "No contract",
    earlyTermination: "None",
    pciCompliance: "Self-managed",
    nextDayFunding: false,
    dedicatedSupport: false,
    statementReview: false,
    freeTerminal: false,
    cashDiscount: false,
    transparentPricing: false,
    customReporting: false,
    onboardingSupport: false,
    bestFor: "Developers, SaaS companies, online-only businesses",
  },
  {
    name: "Clover",
    highlight: false,
    pricing: "2.3-3.5% + $0.10",
    monthlyFee: "$14.95+",
    contractTerms: "36-month typical",
    earlyTermination: "$250-500",
    pciCompliance: "Extra fee",
    nextDayFunding: false,
    dedicatedSupport: false,
    statementReview: false,
    freeTerminal: false,
    cashDiscount: false,
    transparentPricing: false,
    customReporting: true,
    onboardingSupport: false,
    bestFor: "Retail businesses wanting POS features built in",
  },
  {
    name: "Toast",
    highlight: false,
    pricing: "2.49-3.69% + $0.15",
    monthlyFee: "$0-$69+",
    contractTerms: "24-36 month",
    earlyTermination: "Up to $10K+",
    pciCompliance: "Included",
    nextDayFunding: false,
    dedicatedSupport: false,
    statementReview: false,
    freeTerminal: false,
    cashDiscount: false,
    transparentPricing: false,
    customReporting: true,
    onboardingSupport: true,
    bestFor: "Restaurants wanting all-in-one POS and processing",
  },
];

const featureRows: { label: string; key: keyof typeof processors[0]; tooltip?: string }[] = [
  { label: "Pricing Model", key: "pricing" },
  { label: "Monthly Fee", key: "monthlyFee" },
  { label: "Contract Terms", key: "contractTerms" },
  { label: "Early Termination Fee", key: "earlyTermination" },
  { label: "PCI Compliance", key: "pciCompliance" },
  { label: "Next-Day Funding*", key: "nextDayFunding" },
  { label: "Dedicated Human Support", key: "dedicatedSupport" },
  { label: "Free Statement Review", key: "statementReview" },
  { label: "Free Terminal*", key: "freeTerminal" },
  { label: "Cash Discount / Surcharging*", key: "cashDiscount" },
  { label: "Interchange Passthrough", key: "transparentPricing" },
  { label: "Guided Onboarding", key: "onboardingSupport" },
];

const volumeExamples = [
  { volume: "$10,000/mo", square: "$270", stripe: "$320", clover: "$280", toast: "$264", liberty: "$210*" },
  { volume: "$25,000/mo", square: "$675", stripe: "$800", clover: "$625", toast: "$637", liberty: "$475*" },
  { volume: "$50,000/mo", square: "$1,350", stripe: "$1,600", clover: "$1,200", toast: "$1,260", liberty: "$875*" },
  { volume: "$100,000/mo", square: "$2,700", stripe: "$3,200", clover: "$2,400", toast: "$2,535", liberty: "$1,650*" },
];

const faqItems = [
  {
    question: "Why is Liberty Bancard's rate so much lower?",
    answer: "Liberty Bancard uses interchange-plus pricing, which passes through the actual card network cost and adds a small, transparent markup. Flat-rate processors like Square charge the same rate on all transactions, which means you overpay significantly on debit cards and other lower-cost card types.",
  },
  {
    question: "Are there hidden fees with Liberty Bancard?",
    answer: "No. Our pricing is transparent and statement-based. Before you sign up, we review your current statement and show you exactly what you'd pay. There are no PCI non-compliance fees, no annual fees, and no junk charges.",
  },
  {
    question: "Is Square or Stripe ever the better choice?",
    answer: "For very low-volume sellers (under $3,000/month) or businesses that only sell occasionally, flat-rate processors can be simpler. But for any business processing more than $5,000/month, interchange-plus pricing almost always saves money.",
  },
  {
    question: "What about Clover and Toast's POS features?",
    answer: "Clover and Toast bundle POS software with processing, which can be convenient but locks you into their processing rates (often with long-term contracts). Liberty Bancard partners with compatible POS systems so you get the features you need without overpaying on processing.",
  },
  {
    question: "How do I know my actual savings?",
    answer: "Upload your current processing statement and we'll provide a line-by-line breakdown showing your actual effective rate and what you'd pay with Liberty Bancard. It's free, takes 30 seconds, and you keep the analysis regardless.",
  },
];

function FeatureCell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
    ) : (
      <X className="w-4 h-4 text-muted-foreground/40 mx-auto" />
    );
  }
  return <span className="text-xs text-foreground">{value}</span>;
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Payment Processor Comparison - Liberty Bancard vs Square vs Stripe vs Clover vs Toast",
  "url": "https://libertybancard.com/compare-rates",
  "description": "Compare payment processing fees, features, and contract terms. See how Liberty Bancard's interchange-plus pricing compares to Square, Stripe, Clover, and Toast.",
  "mainEntity": {
    "@type": "Table",
    "about": "Payment Processor Comparison"
  }
};

export default function RateComparison() {
  const containerRef = useScrollReveal();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleShareCopy = async () => {
    const shareUrl = "https://libertybancard.com/compare-rates?utm_source=agent&utm_medium=share&utm_content=rate-comparison";
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title="Compare Payment Processor Rates"
        description="Compare payment processing fees and features. See how Liberty Bancard interchange-plus pricing stacks up against Square, Stripe, Clover, and Toast."
        path="/compare-rates"
        keywords="payment processor comparison, square vs stripe vs clover, credit card processing rates comparison"
        breadcrumbs={[{ name: "Compare Rates", path: "/compare-rates" }]}
        structuredData={[
          (() => {
            const reviews = [
              { author: "Maria G.", rating: 5, body: "Switched from Square and cut our processing costs by $400/month. The interchange-plus pricing is completely transparent.", date: "2024-11-15" },
              { author: "James R.", rating: 5, body: "Best decision we made for our auto shop. Saved $290 a month versus what we were paying Clover.", date: "2024-10-08" },
              { author: "Sandra M.", rating: 5, body: "They reviewed our statement and showed us exactly where we were overpaying. No pressure, just facts.", date: "2024-09-22" },
            ];
            const ratingValue = parseFloat(
              (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
            );
            return getReviewSchema({
              itemName: "Liberty Bancard Payment Processing",
              itemPath: "/compare-rates",
              ratingValue,
              reviewCount: reviews.length,
              reviews,
            });
          })(),
        ]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow pt-28" ref={containerRef}>
        <script type="application/ld+json">{serializeJsonLd(structuredData)}</script>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-1">
          <Breadcrumbs items={[{ name: "Compare Rates", path: "/compare-rates" }]} />
        </div>

        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-compare-hero">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
            <div className="accent-rule pt-5 text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 border border-border bg-card text-muted-foreground shadow-sm text-sm font-medium px-3 py-1.5 rounded-md mb-6" data-testid="text-compare-badge">
                <BarChart3 className="w-4 h-4" />
                Side-by-Side Comparison
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground mb-4" data-testid="text-compare-heading">
                Payment Processor Comparison
              </h1>
              <p className="text-lg text-muted-foreground mb-2" data-testid="text-compare-subheading">
                Compare Liberty Bancard vs Square vs Stripe vs Clover vs Toast. See fees, features, and contract terms side by side.
              </p>
              <p className="text-xs text-muted-foreground/80 mb-6" data-testid="text-compare-disclaimer">
                *Rate estimates based on publicly available pricing and common merchant scenarios. Actual rates vary. No savings claims without statement review.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={handleShareCopy}
                data-testid="button-share-compare-rates"
              >
                {copied ? <><Check className="w-4 h-4 text-emerald-600" /> Copied!</> : <><Link2 className="w-4 h-4" /> Share This Comparison</>}
              </Button>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> PCI DSS Level 1 Certified</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> Registered ISO/MSP</span>
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> 5,000+ Merchants Served</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> $2B+ Annual Volume</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> 10+ Years in Payments</span>
            </div>
          </div>
        </div>

        <section className="bg-background py-16" data-testid="section-comparison-table">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-features-heading">
              Features & Pricing Comparison
            </h2>
            <div className="reveal hidden sm:block overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[700px] border-collapse" data-testid="table-comparison">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border w-48">
                      Feature
                    </th>
                    {processors.map((p) => (
                      <th
                        key={p.name}
                        className={`text-center text-xs font-semibold uppercase tracking-wider p-3 border-b border-border ${
                          p.highlight ? "text-primary bg-primary/5" : "text-muted-foreground"
                        }`}
                        data-testid={`th-${p.name.toLowerCase().replace(/\s/g, "-")}`}
                      >
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {featureRows.map((row, i) => (
                    <tr key={row.key} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                      <td className="text-sm font-medium text-foreground p-3 border-b border-border/50" data-testid={`label-${row.key}`}>
                        {row.label}
                      </td>
                      {processors.map((p) => (
                        <td
                          key={p.name}
                          className={`text-center p-3 border-b border-border/50 ${
                            p.highlight ? "bg-primary/5" : ""
                          }`}
                          data-testid={`cell-${row.key}-${p.name.toLowerCase().replace(/\s/g, "-")}`}
                        >
                          <FeatureCell value={p[row.key] as string | boolean} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="text-sm font-medium text-foreground p-3 border-b border-border/50">Best For</td>
                    {processors.map((p) => (
                      <td
                        key={p.name}
                        className={`text-center p-3 border-b border-border/50 ${p.highlight ? "bg-primary/5" : ""}`}
                      >
                        <span className="text-xs text-muted-foreground">{p.bestFor}</span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Mobile Card View for Features */}
            <div className="reveal sm:hidden space-y-3" data-testid="table-comparison-mobile">
              {processors.map((p) => (
                <Card key={p.name} className={p.highlight ? "border-primary/40 shadow-sm" : ""} data-testid={`card-processor-${p.name.toLowerCase().replace(/\s/g, "-")}`}>
                  <CardContent className="p-4">
                    <p className={`font-semibold text-sm mb-3 ${p.highlight ? "text-primary" : "text-foreground"}`}>{p.name}</p>
                    <div className="space-y-2">
                      {featureRows.map((row) => (
                        <div key={row.key} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{row.label}</span>
                          <FeatureCell value={p[row.key] as string | boolean} />
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">Best For</span>
                        <span className="text-xs text-muted-foreground text-right max-w-[60%]">{p.bestFor}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-cost-examples">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-cost-heading">
              Monthly Cost Comparison by Volume
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm">
              Estimated monthly processing fees based on typical card mix. Actual costs vary.
            </p>
            <div className="reveal hidden sm:block overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[600px] border-collapse" data-testid="table-volume">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Volume</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Square</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Stripe</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Clover</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Toast</th>
                    <th className="text-center text-xs font-semibold text-primary uppercase tracking-wider p-3 border-b border-border bg-primary/5">Liberty Bancard</th>
                  </tr>
                </thead>
                <tbody>
                  {volumeExamples.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : ""} data-testid={`row-volume-${i}`}>
                      <td className="text-sm font-medium text-foreground p-3 border-b border-border/50">{row.volume}</td>
                      <td className="text-center text-sm text-foreground p-3 border-b border-border/50">{row.square}</td>
                      <td className="text-center text-sm text-foreground p-3 border-b border-border/50">{row.stripe}</td>
                      <td className="text-center text-sm text-foreground p-3 border-b border-border/50">{row.clover}</td>
                      <td className="text-center text-sm text-foreground p-3 border-b border-border/50">{row.toast}</td>
                      <td className="text-center text-sm font-semibold text-emerald-600 dark:text-emerald-400 p-3 border-b border-border/50 bg-primary/5">{row.liberty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile Card View for Volume Cost */}
            <div className="reveal sm:hidden space-y-3" data-testid="table-volume-mobile">
              {volumeExamples.map((row, i) => (
                <Card key={i} data-testid={`card-volume-${i}`}>
                  <CardContent className="p-4">
                    <p className="font-semibold text-sm text-foreground mb-3">{row.volume}</p>
                    <div className="space-y-2">
                      {[
                        { label: "Square", value: row.square },
                        { label: "Stripe", value: row.stripe },
                        { label: "Clover", value: row.clover },
                        { label: "Toast", value: row.toast },
                      ].map((item) => (
                        <div key={item.label} className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                          <span className="text-sm text-foreground">{item.value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center pt-2 border-t border-border/50">
                        <span className="text-xs font-semibold text-primary">Liberty Bancard</span>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{row.liberty}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-4">
              *Illustrative estimates. Liberty Bancard rates based on interchange-plus pricing for qualifying merchants. Actual costs depend on card mix, transaction types, and underwriting. Eligibility, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>

        {/* Merchant Profile Rate Card */}
        <section className="bg-background py-16" data-testid="section-merchant-profiles">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-profiles-heading">
              Typical Rate by Merchant Profile
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm">
              What merchants in each category typically pay on interchange-plus pricing — based on their card mix, average ticket, and volume.
            </p>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
              {[
                {
                  type: "Restaurant",
                  volume: "$20K–$60K/month",
                  effectiveRate: "1.80–2.20%",
                  flatRateEst: "2.6%+ (Square/Toast)",
                  profile: "High debit card usage, card-present, fast average ticket ($25–$50), high transaction count",
                  savings: "~$180–$600/month vs flat rate",
                  icon: "🍽️",
                },
                {
                  type: "Retail",
                  volume: "$15K–$50K/month",
                  effectiveRate: "1.75–2.15%",
                  flatRateEst: "2.6%+ (Square/Clover)",
                  profile: "Mixed debit + credit, card-present, moderate ticket ($30–$80), consistent volume",
                  savings: "~$125–$450/month vs flat rate",
                  icon: "🏪",
                },
                {
                  type: "Medical / Dental",
                  volume: "$20K–$80K/month",
                  effectiveRate: "2.00–2.40%",
                  flatRateEst: "2.9%+ (Stripe typical)",
                  profile: "Higher rewards and HSA cards, mix of card-present and keyed, larger average ticket ($150–$500)",
                  savings: "~$200–$700/month vs flat rate",
                  icon: "🏥",
                },
                {
                  type: "B2B Services",
                  volume: "$10K–$40K/month",
                  effectiveRate: "2.10–2.60%",
                  flatRateEst: "2.9%+ (Stripe/PayPal)",
                  profile: "Corporate and purchasing cards, often keyed or invoiced, higher interchange but transparent markup",
                  savings: "~$100–$400/month vs flat rate",
                  icon: "💼",
                },
              ].map((profile, i) => (
                <Card key={i} data-testid={`card-profile-${i}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="text-2xl">{profile.icon}</div>
                      <div>
                        <h3 className="font-display font-bold text-foreground" data-testid={`text-profile-type-${i}`}>{profile.type}</h3>
                        <p className="text-xs text-muted-foreground">{profile.volume}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-muted/50 rounded px-3 py-2">
                        <span className="text-xs text-muted-foreground">Interchange-plus effective rate</span>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400" data-testid={`text-profile-rate-${i}`}>{profile.effectiveRate}</span>
                      </div>
                      <div className="flex items-center justify-between bg-muted/30 rounded px-3 py-2">
                        <span className="text-xs text-muted-foreground">Flat-rate comparison</span>
                        <span className="text-sm font-medium text-muted-foreground">{profile.flatRateEst}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{profile.profile}</p>
                    <div className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400" data-testid={`text-profile-savings-${i}`}>
                      Typical savings: {profile.savings}*
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              *Illustrative ranges. Actual effective rate depends on your card mix, transaction types, average ticket, and underwriting. Actual rate depends on card mix and volume — upload a statement for your exact number. No savings claims without a statement review.
            </p>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-why-liberty">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-10" data-testid="text-why-liberty-heading">
              Why Merchants Switch to Liberty Bancard
            </h2>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { icon: DollarSign, title: "Interchange-Plus Pricing", desc: "Pay the actual card cost plus a small markup. No bundled rates, no tiered pricing tricks." },
                { icon: ShieldCheck, title: "No Long-Term Contracts", desc: "Earn your business every month. No early termination fees for most merchants." },
                { icon: Headphones, title: "Real Human Support", desc: "Call and talk to a real person who knows your account. No call centers, no ticket queues." },
                { icon: BarChart3, title: "Statement-Based Analysis", desc: "We review your actual statement before recommending anything. Real numbers, not guesses." },
                { icon: Calculator, title: "Liberty Zero™ Program*", desc: "Cash discount and compliant surcharging — pay $0 to accept cards. Eligibility confirmed via statement review." },
                { icon: CheckCircle2, title: "Fast Onboarding", desc: "From upload to live processing in as little as 48 hours. We handle the heavy lifting." },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-why-liberty-${i}`}>
                  <CardContent className="p-5">
                    <item.icon className="w-8 h-8 text-primary mb-3" />
                    <h3 className="font-display font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-compare-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-compare-faq-heading">
              Frequently Asked Questions
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-compare-faq">
              {faqItems.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`compare-faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`compare-faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="relative overflow-hidden bg-primary text-primary-foreground py-16" data-testid="section-compare-final-cta">
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-compare-cta-heading">
              Ready to See Your Actual Savings?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Upload your processing statement for a free, line-by-line comparison. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-compare-cta-upload">
                <Button size="lg" className="gap-2 bg-accent hover:bg-accent border-accent text-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Button>
              </Link>
              <Link href="/savings-calculator" data-testid="link-compare-cta-calc">
                <Button size="lg" variant="outline" className="gap-2 bg-transparent border-white/30 text-white hover:bg-white/10">
                  <Calculator className="w-4 h-4" />
                  Try Savings Calculator
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
