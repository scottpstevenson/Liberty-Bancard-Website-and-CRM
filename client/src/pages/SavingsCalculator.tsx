import { useState, useEffect, useMemo } from "react";
import { SEO, getServiceSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useSearch } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  Calculator,
  ArrowRight,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const INDUSTRIES = [
  { value: "restaurant", label: "Restaurant / Food Service", avgRate: 3.2 },
  { value: "retail", label: "Retail / Brick & Mortar", avgRate: 2.9 },
  { value: "healthcare", label: "Healthcare / Medical", avgRate: 3.1 },
  { value: "salon", label: "Salon / Spa / Beauty", avgRate: 3.3 },
  { value: "auto", label: "Auto Repair / Automotive", avgRate: 3.4 },
  { value: "professional", label: "Professional Services", avgRate: 3.5 },
  { value: "ecommerce", label: "E-Commerce / Online", avgRate: 3.6 },
  { value: "construction", label: "Construction / Trades", avgRate: 3.4 },
  { value: "other", label: "Other", avgRate: 3.2 },
];

const LIBERTY_TARGET_RATE = 1.95;

const faqItems = [
  {
    question: "How accurate is this calculator?",
    answer: "This calculator provides an estimate based on industry averages and common pricing structures. For an exact analysis, upload your processing statement and we'll break down your actual costs line by line.",
  },
  {
    question: "What is an effective rate?",
    answer: "Your effective rate is the total amount you pay in processing fees divided by your total card volume. It includes interchange, processor markup, monthly fees, and all other charges. Most merchants are surprised to learn their effective rate is much higher than the rate they were quoted.",
  },
  {
    question: "How does Liberty Bancard offer lower rates?",
    answer: "We use interchange-plus pricing, which passes through the actual card network costs and adds a transparent, low markup. Unlike flat-rate processors, you don't overpay on debit cards and lower-cost card types.",
  },
  {
    question: "What if I don't know my current rate?",
    answer: "Upload your most recent processing statement and we'll calculate your effective rate for you. It takes 30 seconds to upload and you'll get a detailed breakdown within one business day.",
  },
  {
    question: "Is there a contract or cancellation fee?",
    answer: "Liberty Bancard does not require long-term contracts for most merchants. We believe our pricing and service should earn your business every month. Specific terms are provided during onboarding.",
  },
];

function parseParam(val: string | null): string {
  if (!val) return "";
  const num = parseFloat(val);
  return isNaN(num) ? "" : String(num);
}

export default function SavingsCalculator() {
  const containerRef = useScrollReveal();
  const { toast } = useToast();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);

  const [monthlyVolume, setMonthlyVolume] = useState(() => parseParam(params.get("volume")));
  const [avgTicket, setAvgTicket] = useState(() => parseParam(params.get("ticket")));
  const [currentRate, setCurrentRate] = useState(() => parseParam(params.get("rate")));
  const [industry, setIndustry] = useState(() => params.get("industry") || "restaurant");
  const [copied, setCopied] = useState(false);

  const volume = parseFloat(monthlyVolume) || 0;
  const ticket = parseFloat(avgTicket) || 0;
  const rate = parseFloat(currentRate) || 0;

  const industryData = INDUSTRIES.find(i => i.value === industry) || INDUSTRIES[0];

  const effectiveCurrentRate = rate > 0 ? rate : industryData.avgRate;

  const hasInput = volume > 0 && effectiveCurrentRate > LIBERTY_TARGET_RATE;

  const savings = useMemo(() => {
    if (!hasInput) return null;
    const currentMonthlyFees = volume * (effectiveCurrentRate / 100);
    const libertyMonthlyFees = volume * (LIBERTY_TARGET_RATE / 100);
    const monthlySavings = currentMonthlyFees - libertyMonthlyFees;
    const annualSavings = monthlySavings * 12;
    const transactionsPerMonth = ticket > 0 ? Math.round(volume / ticket) : null;

    return {
      currentMonthlyFees: Math.round(currentMonthlyFees),
      libertyMonthlyFees: Math.round(libertyMonthlyFees),
      monthlySavings: Math.round(monthlySavings),
      annualSavings: Math.round(annualSavings),
      transactionsPerMonth,
      effectiveRate: effectiveCurrentRate,
    };
  }, [volume, effectiveCurrentRate, ticket, hasInput]);

  const shareUrl = useMemo(() => {
    if (!hasInput) return "";
    const params = new URLSearchParams();
    if (volume > 0) params.set("volume", String(volume));
    if (ticket > 0) params.set("ticket", String(ticket));
    if (rate > 0) params.set("rate", String(rate));
    params.set("industry", industry);
    return `${window.location.origin}/savings-calculator?${params.toString()}`;
  }, [volume, ticket, rate, industry, hasInput]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      toast({ title: "Link copied", description: "Share this link to show your savings estimate." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Credit Card Processing Savings Calculator",
    "url": "https://libertybancard.com/savings-calculator",
    "description": "Calculate how much you could save on credit card processing fees. Compare your current rate to Liberty Bancard's interchange-plus pricing.",
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Web",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "provider": {
      "@type": "Organization",
      "name": "Liberty Bancard"
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Credit Card Processing Savings Calculator"
        description="Calculate how much you could save on credit card processing fees. Enter your monthly volume and current rate to see estimated savings with Liberty Bancard's interchange-plus pricing."
        path="/savings-calculator"
        keywords="credit card processing savings calculator, payment processing cost calculator, merchant fee calculator"
        breadcrumbs={[{ name: "Savings Calculator", path: "/savings-calculator" }]}
        structuredData={[getServiceSchema("Payment Processing Savings Calculator", "Free interactive tool to calculate potential savings on credit card processing fees.", "/savings-calculator")]}
      />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

        <section className="relative overflow-hidden" data-testid="section-calc-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/90 text-sm font-medium px-3 py-1.5 rounded-md mb-6 border border-white/10" data-testid="text-calc-badge">
                <Calculator className="w-4 h-4" />
                Free Savings Estimate
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-4" data-testid="text-calc-heading">
                Credit Card Processing Savings Calculator
              </h1>
              <p className="text-lg text-white/80 mb-2" data-testid="text-calc-subheading">
                See how much you could save with transparent, interchange-plus pricing. Enter your numbers below for an instant estimate.
              </p>
              <p className="text-xs text-white/50" data-testid="text-calc-disclaimer">
                *Estimates are illustrative. Actual savings depend on card mix, transaction types, and statement review. No savings claims without review.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-calculator">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card data-testid="card-calculator-input">
                <CardContent className="p-6 space-y-5">
                  <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-calc-input-heading">
                    Enter Your Processing Details
                  </h2>

                  <div className="space-y-2">
                    <Label htmlFor="monthly-volume">Monthly Card Volume ($)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="monthly-volume"
                        type="number"
                        placeholder="e.g. 25000"
                        value={monthlyVolume}
                        onChange={(e) => setMonthlyVolume(e.target.value)}
                        className="pl-9"
                        data-testid="input-monthly-volume"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Total credit/debit card sales per month</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="avg-ticket">Average Ticket Size ($)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="avg-ticket"
                        type="number"
                        placeholder="e.g. 45"
                        value={avgTicket}
                        onChange={(e) => setAvgTicket(e.target.value)}
                        className="pl-9"
                        data-testid="input-avg-ticket"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Average transaction amount (optional)</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="current-rate">Current Effective Rate (%)</Label>
                    <Input
                      id="current-rate"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 3.2"
                      value={currentRate}
                      onChange={(e) => setCurrentRate(e.target.value)}
                      data-testid="input-current-rate"
                    />
                    <p className="text-xs text-muted-foreground">
                      Total fees / total volume. Leave blank to use industry average ({industryData.avgRate}%).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger data-testid="select-industry">
                        <SelectValue placeholder="Select your industry" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((ind) => (
                          <SelectItem key={ind.value} value={ind.value} data-testid={`option-industry-${ind.value}`}>
                            {ind.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {!rate && (
                    <div className="bg-muted/50 border border-border rounded-md p-3">
                      <p className="text-xs text-muted-foreground">
                        Don't know your effective rate? Upload your statement and we'll calculate it for you.
                      </p>
                      <Link href="/upload-statement">
                        <Button variant="outline" size="sm" className="mt-2 gap-1.5">
                          <Upload className="w-3.5 h-3.5" />
                          Upload Statement
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                {savings ? (
                  <>
                    <Card className="border-2 border-primary/30" data-testid="card-results">
                      <CardContent className="p-6 space-y-5">
                        <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-results-heading">
                          Your Estimated Savings
                        </h2>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-muted/50 rounded-md p-4" data-testid="result-current-fees">
                            <p className="text-xs text-muted-foreground mb-1">Current Monthly Fees</p>
                            <p className="text-2xl font-display font-bold text-foreground">${savings.currentMonthlyFees.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">at {savings.effectiveRate}%</p>
                          </div>
                          <div className="bg-muted/50 rounded-md p-4" data-testid="result-liberty-fees">
                            <p className="text-xs text-muted-foreground mb-1">With Liberty Bancard*</p>
                            <p className="text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400">${savings.libertyMonthlyFees.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">at ~{LIBERTY_TARGET_RATE}%</p>
                          </div>
                        </div>

                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-4 text-center" data-testid="result-savings-summary">
                          <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium mb-1">Estimated Monthly Savings</p>
                          <p className="text-3xl font-display font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-monthly-savings">
                            ${savings.monthlySavings.toLocaleString()}
                          </p>
                          <p className="text-lg font-display font-semibold text-emerald-600/80 dark:text-emerald-400/80 mt-1" data-testid="text-annual-savings">
                            ${savings.annualSavings.toLocaleString()} per year
                          </p>
                          {savings.transactionsPerMonth && (
                            <p className="text-xs text-muted-foreground mt-2">
                              ~{savings.transactionsPerMonth.toLocaleString()} transactions/month
                            </p>
                          )}
                        </div>

                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          *Illustrative estimate based on inputs provided. Actual rates depend on card mix, transaction types, risk profile, and underwriting. A statement review provides exact numbers. No savings claims without review. Eligibility, underwriting, card brand rules, and applicable laws apply.
                        </p>
                      </CardContent>
                    </Card>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Link href="/upload-statement" className="flex-1" data-testid="link-calc-upload">
                        <Button className="w-full gap-2">
                          <Upload className="w-4 h-4" />
                          Get Exact Analysis
                        </Button>
                      </Link>
                      <Button variant="outline" className="gap-2" onClick={handleCopyLink} data-testid="button-share-results">
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copied ? "Copied" : "Share Results"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Card data-testid="card-empty-state">
                    <CardContent className="p-8 text-center">
                      <Calculator className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-display font-bold text-foreground mb-2" data-testid="text-empty-heading">
                        Enter Your Details
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Fill in your monthly card volume and current rate to see how much you could save with Liberty Bancard.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Not sure about your rate? Leave it blank and we'll use the industry average for {industryData.label}.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-why-rates-vary">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-why-heading">
              Why Your Rate Might Be Higher Than You Think
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              Most merchants are quoted one rate but pay a much higher effective rate when all fees are included.
            </p>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { title: "Hidden Monthly Fees", desc: "PCI fees, statement fees, batch fees, and other charges that inflate your cost beyond the quoted rate." },
                { title: "Interchange Downgrades", desc: "Non-qualified transactions cost more. If your terminal isn't set up right, you pay the highest tier." },
                { title: "Flat-Rate Markup", desc: "Flat-rate processors charge 2.6-2.9% on every transaction, even debit cards that cost under 1%." },
                { title: "Rate Creep", desc: "Processors quietly raise rates over time. If you haven't reviewed your statement recently, you're likely paying more." },
                { title: "Tiered Pricing Traps", desc: "Qualified, mid-qualified, and non-qualified tiers sound simple but hide the actual interchange cost." },
                { title: "Equipment Leases", desc: "Terminal leases can cost $50-100/month for equipment worth a fraction of the total lease payment." },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-why-${i}`}>
                  <CardContent className="p-5">
                    <h3 className="font-display font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-how-liberty-saves">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-10" data-testid="text-how-saves-heading">
              How Liberty Bancard Reduces Your Costs
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                {[
                  { title: "Interchange-Plus Pricing", desc: "You pay the actual interchange cost plus a small, transparent markup. No bundled rates hiding the real cost." },
                  { title: "Statement-Based Analysis", desc: "We review your actual statement before making any recommendations, so you see real numbers, not estimates." },
                  { title: "No Hidden Fees", desc: "Our pricing is transparent. No PCI non-compliance fees, no annual fees, no junk charges." },
                  { title: "Free Equipment for Qualifying Merchants", desc: "No terminal lease required. Qualifying merchants receive equipment at no additional cost.*" },
                  { title: "Dedicated Support", desc: "A real person answers when you call. No call centers, no ticket queues, no runaround." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3" data-testid={`benefit-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{item.title}</span>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Card className="border-2 border-primary/20">
                <CardContent className="p-6 text-center">
                  <TrendingDown className="w-10 h-10 text-primary mx-auto mb-4" />
                  <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-exact-cta-heading">
                    Want Exact Numbers?
                  </h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    This calculator gives you an estimate. Upload your statement for a line-by-line breakdown of exactly what you're paying and exactly what you'd pay with us.
                  </p>
                  <Link href="/upload-statement" data-testid="link-exact-upload">
                    <Button className="w-full gap-2">
                      <Upload className="w-4 h-4" />
                      Upload Statement for Exact Analysis
                    </Button>
                  </Link>
                  <p className="text-xs text-muted-foreground mt-3">
                    *Eligibility, underwriting, card brand rules, and applicable laws apply.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-calc-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-faq-heading">
              Frequently Asked Questions
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-faq">
              {faqItems.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-16" data-testid="section-calc-final-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-final-cta-heading">
              Stop Overpaying for Payment Processing
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Upload your statement for a free, no-obligation analysis. Keep the breakdown even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-final-upload">
                <Button size="lg" className="gap-2 bg-white text-primary border-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Button>
              </Link>
              <Link href="/compare-rates" data-testid="link-final-compare">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  Compare Processors
                  <ArrowRight className="w-4 h-4" />
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
