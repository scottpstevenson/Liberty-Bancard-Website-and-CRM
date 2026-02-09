import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
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
} from "lucide-react";

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
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-28">
        {/* Hero - 2 column */}
        <section className="bg-background py-20 lg:py-28" data-testid="section-beat-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h1
                  className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6"
                  data-testid="text-beat-heading"
                >
                  Flat-Rate Is Convenient - Until You See the All-In Cost.
                </h1>
                <p
                  className="text-lg text-muted-foreground mb-8 leading-relaxed"
                  data-testid="text-beat-subheadline"
                >
                  Square/Stripe-style flat pricing can become expensive as volume grows. We run an apples-to-apples comparison using your statement and show the clearest path to reduce total cost - without guesswork.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap mb-4">
                  <Link href="/upload-statement" data-testid="link-beat-primary-cta">
                    <Button size="lg" className="gap-2">
                      <Upload className="w-4 h-4" />
                      Compare My Statement
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <a href="#" data-testid="link-beat-secondary-cta">
                    <Button size="lg" variant="outline" className="gap-2">
                      Book a 10-Minute Call
                    </Button>
                  </a>
                </div>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-beat-subtext"
                >
                  No pressure. You keep the breakdown.
                </p>
              </div>
              <div className="flex items-center justify-center">
                <Card className="w-full max-w-md" data-testid="card-hero-visual">
                  <CardContent className="p-8 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center">
                      <BarChart3 className="w-8 h-8 text-primary" />
                    </div>
                    <p className="text-center text-muted-foreground text-sm">
                      We compare your current flat-rate costs against wholesale pricing structures using real statement data.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Why Flat-Rate Can Cost More */}
        <section className="bg-muted py-20" data-testid="section-cost-more">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
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
        <section className="bg-background py-20" data-testid="section-beat-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
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
              <p
                className="text-xs text-muted-foreground mb-6"
                data-testid="text-beat-microcopy"
              >
                Eligibility, underwriting, card brand rules, and applicable laws apply.
              </p>
              <Link href="/upload-statement" data-testid="link-beat-get-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Terminal Block */}
        <section className="bg-muted py-20" data-testid="section-terminal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <Card data-testid="card-terminal-block">
                <CardContent className="p-8">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                    <Smartphone className="w-5 h-5 text-primary" />
                  </div>
                  <h2
                    className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4"
                    data-testid="text-terminal-heading"
                  >
                    Liberty Smart Terminal (Dejavoo QD4)
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
                      Check Terminal Eligibility
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <p
                    className="text-xs text-muted-foreground mt-4"
                    data-testid="text-terminal-footnote"
                  >
                    *Eligibility and underwriting apply.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-beat-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
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
                    Compare My Statement
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/estimate" data-testid="link-faq-estimate">
                  <Button variant="outline" className="gap-2">
                    Get an Estimate
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-muted py-20" data-testid="section-beat-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
              data-testid="text-beat-final-cta-heading"
            >
              Want the Truth in Writing?
            </h2>
            <p
              className="text-muted-foreground mb-8 max-w-2xl mx-auto"
              data-testid="text-beat-final-cta-description"
            >
              Upload your statement. We'll show your real cost and your clearest options.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-beat-final-compare">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Compare My Statement
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <a href="#" data-testid="link-beat-final-call">
                <Button size="lg" variant="outline" className="gap-2">
                  Book a 10-Minute Call
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
