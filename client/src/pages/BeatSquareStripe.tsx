import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { SEO, getServiceSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
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
  ShieldCheck,
  Link2,
} from "lucide-react";

import { CALENDAR_URL, PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import imgCloverFlex3 from "@/assets/images/terminal-clover-flex-3.png";
import imgPaxA920 from "@/assets/images/terminal-pax-a920.png";
import { claimText } from "@shared/public-claims";
import { BEAT_SQUARE_STRIPE, COMPARE_METHOD_NOTE, COMPARE_NEEDS, COMPARE_TABLE_FOOTNOTE, beatSquareStripeRecords } from "@shared/compare-content";
import { formatCheckedDate, formatMonthly, formatRate } from "@shared/competitor-pricing";

const BASE_URL = "https://libertybancard.com";

const publishedRecords = beatSquareStripeRecords();

const comparisonPoints = [
  "Effective rate including monthly add-ons",
  "Card mix and downgrade impact",
  "Keyed vs swiped differences",
  "Recurring charges such as monthly, gateway and PCI fees",
];

const whatYouGetBullets = [
  "Your effective rate today (based on statement totals)",
  "A side-by-side option set (wholesale pricing and other best-fit structures)",
  "A simple implementation plan (terminal, funding setup, support)",
];

const terminalFeatures = [
  "Tap, chip, swipe",
  "Guided setup with our team",
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
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title={BEAT_SQUARE_STRIPE.title} description={BEAT_SQUARE_STRIPE.description} path={BEAT_SQUARE_STRIPE.path} keywords={BEAT_SQUARE_STRIPE.keywords} breadcrumbs={[{ name: "Switching from Square or Stripe", path: BEAT_SQUARE_STRIPE.path }]} structuredData={[getServiceSchema("Interchange-Plus Payment Processing", BEAT_SQUARE_STRIPE.serviceDescription, BEAT_SQUARE_STRIPE.path)]} />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
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
                  Can Liberty Bancard Beat Your Square or Stripe Rate?{" "}
                  <span className="text-sky-400">Let's Do the Math.</span>
                </h1>
                <p
                  className="text-lg text-white/70 mb-8 leading-relaxed"
                  data-testid="text-beat-subheadline"
                >
                  One flat rate can mean very different all-in costs depending on your card mix, monthly fees and volume. We run an apples-to-apples comparison on your actual statement — so you see the all-in number, not just the rate you were quoted.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap mb-3">
                  <Button size="lg" className="gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
                    <Link href="/upload-statement?offer=beat-square" data-testid="link-beat-square-cta" onClick={() => trackStatementUploadCtaClick({ ctaLabel: "See If We Can Beat Square", offer: "beat-square", page: "/beat-square-stripe" })}>
                      <Upload className="w-4 h-4" />
                      See If We Can Beat Square
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                    <Link href="/upload-statement?offer=beat-stripe" data-testid="link-beat-stripe-cta" onClick={() => trackStatementUploadCtaClick({ ctaLabel: "See If We Can Beat Stripe", offer: "beat-stripe", page: "/beat-square-stripe" })}>
                      <Upload className="w-4 h-4" />
                      See If We Can Beat Stripe
                    </Link>
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-4">
                  <Button size="lg" variant="ghost" className="gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20" asChild>
                    <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackBookingCtaClick({ page: "/beat-square-stripe", ctaLabel: "Book a review call", ctaLocation: "hero" })} data-testid="link-beat-book-cta">
                      Book a review call
                    </a>
                  </Button>
                  <Button size="lg" variant="ghost" className="gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20" asChild>
                    <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} onClick={() => trackPhoneCallClick({ sourcePage: "/beat-square-stripe" })} data-testid="link-beat-phone-cta">
                      {PHONE_NUMBER}
                    </a>
                  </Button>
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
                  className="text-xs text-white/70 mt-2 max-w-lg"
                  data-testid="text-beat-subtext"
                >
                  No pressure. You keep the breakdown. Your cost depends on your card mix, volume, and underwriting — confirmed via statement review.
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

        {/* Published rates (dated, sourced) and the comparison method */}
        <section className="bg-background py-20" data-testid="section-dollar-math">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-dollar-math-heading">
                What Square and Stripe Publish
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
                Rates copied from each provider's official pricing page, with the date checked. They are list rates, not a quote for your business.
              </p>
            </div>

            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-6 mb-8" data-testid="table-comparison">
              {publishedRecords.map((record) => (
                <Card key={record.id} data-testid={`card-published-rate-${record.id}`}>
                  <CardContent className="p-6">
                    <h3 className="text-lg font-display font-bold text-foreground mb-1">{record.product}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{record.plan} ({record.channel})</p>
                    <div className="text-2xl font-display font-bold text-foreground mb-1" data-testid={`text-published-rate-${record.id}`}>{formatRate(record)}</div>
                    {record.monthlyFeeCents !== null && (
                      <p className="text-xs text-muted-foreground mb-1">{formatMonthly(record.monthlyFeeCents)}</p>
                    )}
                    {record.qualifier && <p className="text-xs text-muted-foreground mb-2">{record.qualifier}</p>}
                    <p className="text-xs text-muted-foreground">
                      <a href={record.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">Official pricing page</a>
                      , checked {formatCheckedDate(record.checkedOn)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="reveal bg-muted/40 border border-border rounded-lg p-5" data-testid="card-math-savings-summary">
              <p className="text-sm font-semibold text-foreground mb-2">{COMPARE_NEEDS.heading}</p>
              <p className="text-sm text-muted-foreground mb-3">{COMPARE_NEEDS.intro}</p>
              <ul className="space-y-2 mb-3">
                {COMPARE_NEEDS.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground" data-testid="text-comparison-footnote">
                {COMPARE_METHOD_NOTE} {COMPARE_TABLE_FOOTNOTE}
              </p>
            </div>
          </div>
        </section>

        {/* Why Flat-Rate Can Cost More */}
        <section className="bg-background py-20" data-testid="section-cost-more">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
                data-testid="text-cost-more-heading"
              >
                How Flat Rates Compare
              </h2>
              <p
                className="text-muted-foreground mb-4 leading-relaxed"
                data-testid="text-cost-more-p1"
              >
                Flat-rate pricing is simple. Whether it costs more or less than interchange-plus depends on your volume, card mix and ticket size.
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
                If the review shows no better option, we'll tell you. No pressure — you keep the breakdown either way.
              </div>
              <p
                className="text-xs text-muted-foreground mb-6"
                data-testid="text-beat-microcopy"
              >
                Eligibility, underwriting, card brand rules, and applicable laws apply.
              </p>
              <Button className="gap-2" asChild>
                <Link href="/upload-statement" data-testid="link-beat-get-upload">
                  <Upload className="w-4 h-4" />
                  Upload My Statement — Free
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Terminal Block */}
        <section className="bg-muted py-20" data-testid="section-terminal">
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
                        {claimText("equipment.options.summary")}
                      </p>
                      <Button className="gap-2" asChild>
                        <Link href="/upload-statement" data-testid="link-terminal-cta">
                          <Upload className="w-4 h-4" />
                          Upload My Statement — Free
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </Button>
                      <p
                        className="text-xs text-muted-foreground mt-4"
                        data-testid="text-terminal-footnote"
                      >
                        Eligibility and underwriting apply.
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
                <Button className="gap-2" asChild>
                  <Link href="/upload-statement" data-testid="link-faq-compare">
                    <Upload className="w-4 h-4" />
                    Upload My Statement — Free
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button variant="outline" className="gap-2" asChild>
                  <Link href="/get-started" data-testid="link-faq-get-started">
                    Not Sure Where to Start?
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
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
              <Button size="lg" className="gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
                <Link href="/upload-statement" data-testid="link-beat-final-compare">
                  <Upload className="w-4 h-4" />
                  Upload My Statement — Free
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackBookingCtaClick({ page: "/beat-square-stripe", ctaLabel: "Get My Free Analysis", ctaLocation: "final_cta" })} data-testid="link-beat-final-call">
                  Get My Free Analysis
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* Compare page crawlable links */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-border" data-testid="section-beat-compare-links">
          <p className="text-sm text-muted-foreground mb-3 font-medium">Detailed comparisons:</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/compare/square" className="text-primary hover:underline" data-testid="link-beat-compare-square">Liberty vs Square — Full Comparison</Link>
            <Link href="/compare/stripe" className="text-primary hover:underline" data-testid="link-beat-compare-stripe">Liberty vs Stripe — Full Comparison</Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
