import { useState } from "react";
import { SEO, getServiceSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
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
  BarChart3,
  CheckCircle2,
  Smartphone,
  Check,
  X,
  Minus,
  ShieldCheck,
  Link2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";

const BASE_URL = "https://libertybancard.com";

const comparisonTable = [
  { feature: "Interchange passthrough pricing", square: false, stripe: false, liberty: true },
  { feature: "Line-item cost breakdown", square: false, stripe: false, liberty: true },
  { feature: "Statement-based pricing", square: false, stripe: false, liberty: true },
  { feature: "Next-day funding*", square: false, stripe: false, liberty: true },
  { feature: "Dedicated human support", square: false, stripe: false, liberty: true },
  { feature: "No long-term contract", square: true, stripe: true, liberty: true },
  { feature: "Free terminal for qualifying merchants*", square: false, stripe: false, liberty: true },
  { feature: "Liberty Zero™ — 0% Program*", square: false, stripe: false, liberty: true },
  { feature: "Easy online signup", square: true, stripe: true, liberty: true },
  { feature: "Guided onboarding + go-live support", square: false, stripe: false, liberty: true },
];

const comparisonPoints = [
  "Effective rate including monthly add-ons",
  "Card mix and downgrade impact",
  "Keyed vs swiped differences",
  "Funding timing expectations and available options*",
];

const whatYouGetBullets = [
  "Your effective rate today (based on statement totals)",
  "A side-by-side option set (wholesale pricing and other best-fit structures)",
  "A simple implementation plan (terminal, funding setup, support)",
];

const terminalFeatures = [
  "Tap, chip, swipe",
  "Fast setup with a real person",
  "Reliable checkout and clear receipts",
];

const faqItems = [
  {
    question: "Can you migrate without interrupting checkout?",
    answer:
      "In most cases, yes. We'll recommend the lowest-friction path and handle the setup plan with you.",
  },
  {
    question: "Do you support online payments too?",
    answer:
      "If online is part of your model, include it in your notes when you upload the statement so we can recommend the right setup.",
  },
  {
    question: "What if I don't have a statement (or I'm new)?",
    answer:
      "Use the Effective Rate Estimate page to start. When you have processing history, upload a statement for a full comparison.",
  },
];

export default function BeatSquareStripe() {
  const containerRef = useScrollReveal();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleShareCopy = async () => {
    const shareUrl = `${BASE_URL}/beat-square-stripe?utm_source=agent&utm_medium=share&utm_content=beat-square-stripe`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link Copied",
        description: "The share link has been copied to your clipboard.",
      });
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      toast({
        title: "Link Copied",
        description: "The share link has been copied to your clipboard.",
      });
    }
    setCopied(true);
    toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Beat Square & Stripe Pricing" description="Compare Liberty Bancard's statement-based pricing against Square and Stripe flat-rate processing. Real numbers, no guesswork." path="/beat-square-stripe" keywords="beat square pricing, beat stripe pricing, interchange plus vs flat rate, payment processing comparison" breadcrumbs={[{ name: "Beat Square & Stripe", path: "/beat-square-stripe" }]} structuredData={[getServiceSchema("Interchange-Plus Payment Processing", "Transparent interchange-plus pricing that beats Square and Stripe flat-rate processing for most businesses.", "/beat-square-stripe")]} />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        {/* Hero - 2 column */}
        <section className="relative overflow-hidden" data-testid="section-beat-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-72 h-72 bg-sky-500 top-16 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/3" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h1
                  className="text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
                  data-testid="text-beat-heading"
                >
                  Flat-Rate Is Convenient - Until You See the <span className="text-sky-400">All-In Cost.</span>
                </h1>
                <p
                  className="text-lg text-white/70 mb-8 leading-relaxed"
                  data-testid="text-beat-subheadline"
                >
                  Square/Stripe-style flat pricing can become expensive as volume grows. We run an apples-to-apples comparison using your statement and show the clearest path to reduce total cost - without guesswork.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap mb-4">
                  <Link href="/upload-statement" data-testid="link-beat-primary-cta">
                    <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                      <Upload className="w-4 h-4" />
                      Compare My Statement
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href="/get-started" data-testid="link-beat-secondary-cta">
                    <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                      Book a 10-Minute Call
                    </Button>
                  </Link>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20"
                    onClick={handleShareCopy}
                    data-testid="button-share-beat"
                  >
                    {copied ? <><Check className="w-4 h-4 text-green-400" /> Copied!</> : <><Link2 className="w-4 h-4" /> Share This Page</>}
                  </Button>
                </div>
                <p
                  className="text-sm text-white/50"
                  data-testid="text-beat-subtext"
                >
                  No pressure. You keep the breakdown.
                </p>
              </div>
              <div className="flex items-center justify-center">
                <Card className="w-full max-w-md border border-white/10 bg-white/5 backdrop-blur-md shadow-2xl" data-testid="card-hero-visual">
                  <CardContent className="p-8 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-md bg-sky-500/20 flex items-center justify-center">
                      <BarChart3 className="w-8 h-8 text-sky-400" />
                    </div>
                    <p className="text-center text-white/60 text-sm">
                      We compare your current flat-rate costs against wholesale pricing structures using real statement data.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Real Dollar Math: $50K/Month Example */}
        <section className="bg-background py-20" data-testid="section-dollar-math">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-dollar-math-heading">
                Real Numbers. $50,000/Month Example.
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
                Same volume, same card mix — what each processor actually costs. Based on $50K/month, ~1,000 transactions (avg $50 each), typical Visa credit card mix.
              </p>
            </div>

            <div className="reveal grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[
                {
                  processor: "Square",
                  rate: "2.6% + $0.10/txn",
                  monthly: "$1,400",
                  annual: "$16,800",
                  breakdown: "2.6% × $50,000 = $1,300\n+ $0.10 × 1,000 txn = $100",
                  highlight: false,
                  color: "text-foreground",
                },
                {
                  processor: "Stripe",
                  rate: "2.9% + $0.30/txn",
                  monthly: "$1,750",
                  annual: "$21,000",
                  breakdown: "2.9% × $50,000 = $1,450\n+ $0.30 × 1,000 txn = $300",
                  highlight: false,
                  color: "text-foreground",
                },
                {
                  processor: "Liberty Bancard",
                  rate: "Interchange + ~0.20%",
                  monthly: "~$1,070",
                  annual: "~$12,840",
                  breakdown: "Avg interchange ~1.80% × $50K = $900\n+ 0.20% markup = $100\n+ $0.07 × 1,000 txn = $70",
                  highlight: true,
                  color: "text-emerald-600 dark:text-emerald-400",
                },
              ].map((item, i) => (
                <Card
                  key={i}
                  className={item.highlight ? "border-2 border-primary/30 bg-primary/5" : ""}
                  data-testid={`card-dollar-math-${i}`}
                >
                  <CardContent className="p-6">
                    {item.highlight && (
                      <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">Best Value</div>
                    )}
                    <h3 className="text-lg font-display font-bold text-foreground mb-1">{item.processor}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{item.rate}</p>
                    <div className="space-y-1 text-xs text-muted-foreground bg-muted/50 rounded-md p-3 mb-4 font-mono whitespace-pre-line" data-testid={`text-math-breakdown-${i}`}>
                      {item.breakdown}
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-xs text-muted-foreground">Monthly cost</div>
                        <div className={`text-2xl font-display font-bold ${item.color}`} data-testid={`text-monthly-cost-${i}`}>{item.monthly}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Annual cost</div>
                        <div className={`text-lg font-semibold ${item.color}`} data-testid={`text-annual-cost-${i}`}>{item.annual}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="reveal bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 text-center" data-testid="card-math-savings-summary">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                At $50K/month: Liberty saves ~$3,960/year vs Square and ~$8,160/year vs Stripe*
              </p>
              <p className="text-[11px] text-muted-foreground">
                *Illustrative estimate. Interchange rate varies by card type (debit, credit, rewards, corporate). Liberty's markup of 0.10–0.40% depends on your profile. Per-transaction fee of $0.05–$0.10 also applies. Actual rate depends on card mix and volume — upload a statement for your exact number. No savings claims without review.
              </p>
            </div>
          </div>
        </section>

        {/* Head-to-Head Comparison Table */}
        <section className="bg-muted bg-dots py-20" data-testid="section-comparison-table">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-comparison-heading">
                Head-to-Head Comparison
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">See what you get with each provider. The math doesn't lie.</p>
            </div>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-comparison">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-4 font-medium text-foreground">Feature</th>
                      <th className="text-center p-4 font-medium text-muted-foreground min-w-[100px]">Square</th>
                      <th className="text-center p-4 font-medium text-muted-foreground min-w-[100px]">Stripe</th>
                      <th className="text-center p-4 font-semibold text-primary min-w-[100px]">Liberty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonTable.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0" data-testid={`comparison-row-${i}`}>
                        <td className="p-4 text-foreground">{row.feature}</td>
                        <td className="p-4 text-center">
                          {row.square ? (
                            <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {row.stripe ? (
                            <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-4 text-center bg-primary/5">
                          {row.liberty ? (
                            <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground text-center mt-4" data-testid="text-comparison-footnote">
              *Eligibility, underwriting, card brand rules, and applicable laws apply. Feature availability may vary by account type and volume.
            </p>
          </div>
        </section>

        {/* Why Flat-Rate Can Cost More */}
        <section className="bg-background bg-grid py-20" data-testid="section-cost-more">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
                data-testid="text-cost-more-heading"
              >
                The Catch With Flat Rates
              </h2>
              <p
                className="text-muted-foreground mb-4 leading-relaxed"
                data-testid="text-cost-more-p1"
              >
                Flat-rate pricing is simple - but it can bake in extra margin that becomes costly at higher volume or better card mix.
              </p>
              <p
                className="text-muted-foreground mb-8 leading-relaxed"
                data-testid="text-cost-more-p2"
              >
                Instead of guessing, we calculate your true effective rate and compare options with real math.
              </p>
              <h3
                className="text-xl font-display font-semibold text-foreground mb-4"
                data-testid="text-compare-heading"
              >
                We compare (apples-to-apples)
              </h3>
              <ul className="space-y-3">
                {comparisonPoints.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`comparison-point-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What You Get */}
        <section className="bg-muted/30 py-20" data-testid="section-beat-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-beat-what-you-get-heading"
              >
                Your Comparison Comes Back With Clarity
              </h2>
              <ul className="space-y-4 mb-6">
                {whatYouGetBullets.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`beat-get-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 mb-4" data-testid="text-guarantee-oneliner">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                If we can't beat your current processor, we'll tell you upfront. No pressure — you keep the breakdown either way.
              </div>
              <p
                className="text-xs text-muted-foreground mb-6"
                data-testid="text-beat-microcopy"
              >
                Eligibility, underwriting, card brand rules, and applicable laws apply.
              </p>
              <Link href="/upload-statement" data-testid="link-beat-get-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload My Statement — Free
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Terminal Block */}
        <section className="bg-muted bg-dots py-20" data-testid="section-terminal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-5xl mx-auto">
              <Card data-testid="card-terminal-block">
                <CardContent className="p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div>
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                        <Smartphone className="w-5 h-5 text-primary" />
                      </div>
                      <h2
                        className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4"
                        data-testid="text-terminal-heading"
                      >
                        Liberty Smart Terminal
                      </h2>
                      <p
                        className="text-muted-foreground mb-6 leading-relaxed"
                        data-testid="text-terminal-description"
                      >
                        Modern checkout with guided onboarding and support after go-live.
                      </p>
                      <ul className="space-y-3 mb-6">
                        {terminalFeatures.map((item, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3"
                            data-testid={`terminal-feature-${i}`}
                          >
                            <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">{item}</span>
                          </li>
                        ))}
                      </ul>
                      <p
                        className="text-sm text-muted-foreground mb-6"
                        data-testid="text-terminal-note"
                      >
                        Free equipment may be available for qualifying merchants.*
                      </p>
                      <Link href="/upload-statement" data-testid="link-terminal-cta">
                        <Button className="gap-2">
                          <Upload className="w-4 h-4" />
                          Upload My Statement — Free
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                      <p
                        className="text-xs text-muted-foreground mt-4"
                        data-testid="text-terminal-footnote"
                      >
                        *Eligibility and underwriting apply.
                      </p>
                    </div>
                    <div className="flex flex-col gap-4 items-center">
                      <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal" className="w-full max-w-xs rounded-md object-contain" data-testid="img-terminal-hero" />
                      <img src={imgPaxA920} alt="PAX A920 smart payment terminal" className="w-full max-w-xs rounded-md object-cover" data-testid="img-terminal-tap" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-beat-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-beat-faq-heading"
              >
                Square/Stripe Comparison FAQs
              </h2>
              <Accordion type="single" collapsible className="w-full mb-8">
                {faqItems.map((item, i) => (
                  <AccordionItem key={i} value={`faq-${i}`} data-testid={`beat-faq-item-${i}`}>
                    <AccordionTrigger
                      className="text-left"
                      data-testid={`beat-faq-trigger-${i}`}
                    >
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent data-testid={`beat-faq-content-${i}`}>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                <Link href="/upload-statement" data-testid="link-faq-compare">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload My Statement — Free
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/get-started" data-testid="link-faq-get-started">
                  <Button variant="outline" className="gap-2">
                    Not Sure Where to Start?
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden py-20" data-testid="section-beat-final-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(221,83%,20%)] to-[hsl(222,47%,8%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-white mb-6"
              data-testid="text-beat-final-cta-heading"
            >
              Want the Truth in Writing?
            </h2>
            <p
              className="text-white/60 mb-8 max-w-2xl mx-auto"
              data-testid="text-beat-final-cta-description"
            >
              Upload your statement. We'll show your real cost and your clearest options.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-beat-final-compare">
                <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                  <Upload className="w-4 h-4" />
                  Upload My Statement — Free
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/get-started" data-testid="link-beat-final-call">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  Book a 10-Minute Call
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
