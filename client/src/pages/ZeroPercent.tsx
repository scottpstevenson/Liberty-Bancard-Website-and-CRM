import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  CheckCircle2,
  ShieldCheck,
  Scale,
  FileCheck,
  Phone,
  Calendar,
  ArrowRight,
} from "lucide-react";
import terminalHero from "@assets/images/liberty-terminal-hero.png";
import terminalTap from "@assets/images/liberty-terminal-tap.png";

const approaches = [
  {
    title: "Cash Discount",
    description: "Discount for cash-paying customers; clear and transparent.",
    icon: Scale,
  },
  {
    title: "Compliant Surcharging",
    description:
      "Disclosed fee on eligible credit transactions where permitted.",
    icon: ShieldCheck,
  },
];

const fitItems = [
  "Your customers are not extremely price-sensitive",
  "Your average ticket is high enough that a disclosure fee isn't disruptive",
  "Your debit share is understood and handled correctly",
  "Your staff can consistently follow a simple script at checkout",
];

const checkoutBullets = [
  "Clear disclosure before payment",
  "Receipts that match signage",
  "Debit handled correctly",
  "One-sentence staff script (provided)",
];

const complianceItems = [
  "Signage and checkout messaging",
  "Receipt formatting",
  "Debit program rules",
  "Card brand requirements (including registration where required)",
  "Ongoing support as requirements evolve",
];

const implementationSteps = [
  "We confirm your business model and state rules (where applicable)",
  "We recommend cash discount vs compliant surcharging (or recommend wholesale pricing if it's a better fit)",
  "We configure signage/receipt formatting and provide a staff script",
  "We support you after go-live as requirements evolve",
];

const faqItems = [
  {
    question: 'Is this the same as "surcharging"?',
    answer:
      'Sometimes. "0%" is a general marketing term. The two compliant structures are cash discount and (where permitted) compliant surcharging on eligible credit transactions.',
  },
  {
    question: "Does it apply to debit cards?",
    answer:
      "Debit must be handled correctly under program rules. We'll configure the correct treatment based on your setup.",
  },
  {
    question: "Will customers get upset?",
    answer:
      "Clear disclosure and staff consistency make the difference. We provide signage language, receipt formatting, and a one-sentence script.",
  },
  {
    question: "Is it allowed in my state?",
    answer:
      "Rules vary. We'll verify the right approach for your location and business model before recommending anything.",
  },
];

export default function ZeroPercent() {
  const containerRef = useScrollReveal();
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="0% Processing Program" description="Learn about compliant cash discount and surcharge programs. Eligibility depends on state law, card brand rules, and business model." path="/0-percent-processing" />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        {/* Hero */}
        <section className="relative overflow-hidden" data-testid="section-zero-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="max-w-3xl">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
                data-testid="text-zero-heading"
              >
                "0% Processing" Has Rules. We Do It the <span className="text-sky-400">Right Way.</span>
              </h1>
              <p
                className="text-lg text-white/70 mb-8 leading-relaxed"
                data-testid="text-zero-subheadline"
              >
                Eliminating fees requires the correct structure, disclosures, and
                configuration - and it isn't right for every business. We review
                your statement and recommend the most compliant, lowest-friction
                approach.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                <Link href="/upload-statement" data-testid="link-zero-primary-cta">
                  <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                    <Upload className="w-4 h-4" />
                    Check Eligibility (Free Review)
                  </Button>
                </Link>
                <a href="#" data-testid="link-zero-secondary-cta">
                  <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                    <Phone className="w-4 h-4" />
                    Talk to a Specialist
                  </Button>
                </a>
              </div>
              <p
                className="text-xs text-white/40 mt-4"
                data-testid="text-zero-microcopy"
              >
                Where permitted; rules vary by state and card brand.
              </p>
              <p
                className="text-xs text-white/40 mt-2"
                data-testid="text-zero-footnote"
              >
                Eligibility, underwriting, card brand rules, and applicable laws
                apply.
              </p>
            </div>
          </div>
        </section>

        {/* Two Legit Approaches */}
        <section className="bg-muted bg-dots py-20" data-testid="section-approaches">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="reveal text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-approaches-heading"
            >
              Two Legit Approaches (We'll Recommend the Right Fit)
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-6">
              {approaches.map((item, i) => (
                <Card key={i} data-testid={`card-approach-${i}`}>
                  <CardHeader>
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-xl">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p
              className="text-sm text-muted-foreground text-center mt-8 max-w-2xl mx-auto"
              data-testid="text-approaches-expert-note"
            >
              Your ticket size, debit share, and card mix determine whether this
              is smart. Your statement reveals this fast.
            </p>
          </div>
        </section>

        {/* Is It a Fit? */}
        <section className="bg-background bg-grid py-20" data-testid="section-fit">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4"
                data-testid="text-fit-heading"
              >
                Is a Fee-Offset Program Right for Your Business?
              </h2>
              <p
                className="text-muted-foreground mb-8"
                data-testid="text-fit-intro"
              >
                In general, these programs tend to work best when:
              </p>
              <ul className="space-y-4 mb-8">
                {fitItems.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`fit-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <p
                className="text-muted-foreground mb-6"
                data-testid="text-fit-not-sure"
              >
                Not sure? Upload your statement and we'll recommend the
                lowest-friction path.
              </p>
              <Link href="/upload-statement" data-testid="link-fit-cta">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Customer-Friendly Checkout */}
        <section className="bg-muted py-20" data-testid="section-checkout">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-checkout-heading"
              >
                Customer-Friendly Checkout (No Surprise Fees)
              </h2>
              <ul className="space-y-4 mb-8">
                {checkoutBullets.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`checkout-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Card data-testid="card-checkout-callout">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    We prioritize clarity and compliance so you avoid chargebacks
                    and complaints.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Terminal Equipment */}
        <section className="bg-background bg-dots py-20" data-testid="section-terminal-equipment">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-5xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                <div className="flex flex-col gap-4 items-center order-2 md:order-1">
                  <img src={terminalHero} alt="Liberty Smart Terminal" className="w-full max-w-xs rounded-md object-contain" data-testid="img-zero-terminal-hero" />
                  <img src={terminalTap} alt="Contactless tap payment on Liberty Smart Terminal" className="w-full max-w-xs rounded-md object-cover" data-testid="img-zero-terminal-tap" />
                </div>
                <div className="order-1 md:order-2">
                  <h2
                    className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4"
                    data-testid="text-terminal-heading"
                  >
                    Built for the Liberty Smart Terminal
                  </h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed" data-testid="text-terminal-description">
                    Every 0% program we deploy is configured directly on the Liberty Smart Terminal. Dual-pricing, compliant receipts, and proper disclosures are handled automatically at checkout.
                  </p>
                  <ul className="space-y-3 mb-6">
                    <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" /><span className="text-muted-foreground">Automatic dual-price display at checkout</span></li>
                    <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" /><span className="text-muted-foreground">Compliant receipts with required disclosures</span></li>
                    <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" /><span className="text-muted-foreground">Tap, dip, swipe, and manual key entry</span></li>
                    <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" /><span className="text-muted-foreground">Free for qualifying merchants*</span></li>
                  </ul>
                  <Link href="/upload-statement?terminal=yes" data-testid="link-zero-terminal-cta">
                    <Button className="gap-2">
                      Check Terminal Eligibility
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <p className="text-xs text-muted-foreground mt-4">*Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Compliance Checklist */}
        <section className="bg-background py-20" data-testid="section-compliance">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-compliance-heading"
              >
                The Compliance Pieces Most Providers Skip
              </h2>
              <ul className="space-y-4">
                {complianceItems.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`compliance-item-${i}`}
                  >
                    <FileCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What Happens After You Upload Your Statement */}
        <section className="bg-muted bg-grid py-20" data-testid="section-process">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="reveal text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-process-heading"
            >
              What Happens After You Upload Your Statement
            </h2>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {implementationSteps.map((step, i) => (
                <Card key={i} data-testid={`card-process-${i}`}>
                  <CardContent className="pt-6">
                    <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center mb-4">
                      <span className="text-primary-foreground font-bold text-lg">
                        {i + 1}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{step}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p
              className="text-xs text-muted-foreground text-center mt-8"
              data-testid="text-process-microcopy"
            >
              Eligibility, underwriting, card brand rules, and applicable laws
              apply.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8 flex-wrap">
              <Link href="/upload-statement" data-testid="link-process-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
              <a href="#" data-testid="link-process-call">
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Book a 10-Minute Call
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-zero-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-zero-faq-heading"
              >
                0% Program FAQs
              </h2>
              <Accordion type="single" collapsible className="w-full">
                {faqItems.map((item, i) => (
                  <AccordionItem
                    key={i}
                    value={`faq-${i}`}
                    data-testid={`faq-item-${i}`}
                  >
                    <AccordionTrigger
                      className="text-left"
                      data-testid={`faq-trigger-${i}`}
                    >
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent data-testid={`faq-content-${i}`}>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <div className="mt-8">
                <Link href="/upload-statement" data-testid="link-faq-cta">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Check Eligibility (Free Review)
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden py-20" data-testid="section-zero-final-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(221,83%,20%)] to-[hsl(222,47%,8%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-white mb-6"
              data-testid="text-zero-final-cta-heading"
            >
              Want the Cleanest, Most Compliant Setup?
            </h2>
            <p
              className="text-white/60 mb-8 max-w-2xl mx-auto"
              data-testid="text-zero-final-cta-body"
            >
              Upload your statement and we'll recommend the best-fit program (or
              tell you if it isn't worth it).
            </p>
            <Link href="/upload-statement" data-testid="link-zero-final-cta">
              <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                <Upload className="w-4 h-4" />
                Upload Statement
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
