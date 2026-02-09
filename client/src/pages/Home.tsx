import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FileText,
  ShieldCheck,
  Headphones,
  Scale,
  ArrowRight,
  CheckCircle2,
  Upload,
  Calculator,
  Stethoscope,
  Car,
  UtensilsCrossed,
  Wrench,
  Store,
  Star,
  Quote,
} from "lucide-react";

export default function Home() {
  const [monthlyVolume, setMonthlyVolume] = useState("");
  const [totalFees, setTotalFees] = useState("");

  const volume = parseFloat(monthlyVolume.replace(/,/g, "")) || 0;
  const fees = parseFloat(totalFees.replace(/,/g, "")) || 0;
  const effectiveRate = volume > 0 ? ((fees / volume) * 100).toFixed(2) : null;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-16">
        {/* 1. Top Proof Bar */}
        <section className="bg-primary text-primary-foreground" data-testid="section-proof-bar">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <p className="text-center text-sm font-medium leading-relaxed" data-testid="text-proof-bar">
              Statement-Based Rate Review | Line-Item Breakdown | Wholesale Pricing Options | Compliance-First 0% Programs | Next-Day Funding Options | Liberty Smart Terminal | Real Human Support
            </p>
            <p className="text-center text-xs text-primary-foreground/60 mt-1" data-testid="text-proof-bar-footnote">
              *Eligibility, underwriting, card brand rules, and laws apply.
            </p>
          </div>
        </section>

        {/* 2. Hero */}
        <section className="bg-background py-20 lg:py-28" data-testid="section-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground leading-tight mb-6" data-testid="text-hero-heading">
                  Stop Guessing What You Pay to Accept Cards.
                </h1>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed" data-testid="text-hero-subheadline">
                  Your "rate" isn't your cost. We audit your processing statement line-by-line, calculate your true effective rate, and deliver a clear plan to reduce total processing cost - with options that fit your business (wholesale pricing or compliant "0%" where appropriate), plus next-day funding options* and modern terminal setup.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <Link href="/upload-statement" data-testid="link-hero-upload">
                    <Button size="lg" className="gap-2">
                      <Upload className="w-4 h-4" />
                      Upload Statement (30 seconds)
                    </Button>
                  </Link>
                  <a href="#" data-testid="link-hero-book-call">
                    <Button size="lg" variant="outline" className="gap-2">
                      Book a 10-Minute Call
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-muted-foreground mt-4 max-w-md" data-testid="text-hero-microcopy">
                  PDF or photo is fine. Redact account numbers if you want - we only need totals + fee lines.
                </p>
              </div>

              <div className="relative">
                <Card className="p-8">
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground font-bold text-xl">L</span>
                      </div>
                      <div>
                        <div className="font-display font-bold text-foreground">Liberty Bancard</div>
                        <div className="text-xs text-muted-foreground">Statement Review</div>
                      </div>
                    </div>
                    <div className="bg-muted rounded-md p-4">
                      <div className="text-sm text-muted-foreground mb-1">Your Effective Rate</div>
                      <div className="text-3xl font-display font-bold text-foreground">3.42%</div>
                      <div className="text-sm text-muted-foreground mt-1">Industry avg: 2.9% - 3.5%</div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Monthly Volume</span>
                        <span className="font-medium text-foreground">$47,200</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Total Fees</span>
                        <span className="font-medium text-foreground">$1,614.24</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Potential Savings</span>
                        <span className="font-medium text-green-600">$312/mo</span>
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground">
                      Sample illustration only. Your results depend on your actual statement.
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Trust Row */}
        <section className="bg-muted py-12" data-testid="section-trust-row">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: FileText, label: "Written breakdown you keep" },
                { icon: ShieldCheck, label: "Proof-first, no pressure" },
                { icon: Headphones, label: "Operator-grade support" },
                { icon: Scale, label: "Compliance-first programs" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3" data-testid={`trust-item-${i}`}>
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. What You Get */}
        <section className="bg-background py-20" data-testid="section-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-what-you-get-heading">
                What You Get From a Liberty Statement Review
              </h2>
              <ul className="space-y-4 mb-8">
                {[
                  "Your true effective rate (not the \"rate\" you were quoted)",
                  "A list of specific cost drivers in your current setup",
                  "2-3 clear options to reduce total processing cost",
                  "Funding timing analysis and next-day funding eligibility",
                  "A step-by-step implementation plan if you decide to move forward",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`what-you-get-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row items-start gap-4 flex-wrap">
                <Link href="/upload-statement" data-testid="link-what-you-get-upload">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload My Statement
                  </Button>
                </Link>
              </div>
              <div className="mt-6 bg-muted rounded-md p-4" data-testid="text-what-you-get-callout">
                <p className="text-sm text-muted-foreground font-medium">
                  You keep the breakdown even if you don't switch.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Big Differentiator */}
        <section className="bg-muted py-20" data-testid="section-differentiator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6" data-testid="text-differentiator-heading">
                We Don't "Quote Rates." We Diagnose Statements.
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6" data-testid="text-differentiator-body">
                Most processors pitch a "low rate" without explaining what you're actually paying. We take a different approach: we read your statement line by line and show you exactly where your money goes. Here's what we look for:
              </p>
              <ul className="space-y-3">
                {[
                  "Add-on fees that don't belong on your statement",
                  "Downgrades caused by batching issues, missing data, or card-not-present transactions",
                  "Keyed vs. swiped/dipped/tapped ratios and their cost impact",
                  "Debit routing optimization (PIN debit vs. signature debit)",
                  "Non-compliance and PCI fees that can be eliminated",
                  "Funding timing gaps - how long your money sits before it reaches your account",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`differentiator-bullet-${i}`}>
                    <ArrowRight className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 6. 60-Second Reality Check Calculator */}
        <section className="bg-background py-20" data-testid="section-calculator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-xl mx-auto text-center">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Calculator className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-calculator-heading">
                60-Second Reality Check (Effective Rate)
              </h2>
              <p className="text-muted-foreground mb-8">
                Enter your numbers below to see your estimated effective rate.
              </p>
              <div className="space-y-4 text-left">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="monthly-volume">
                    Monthly Volume ($)
                  </label>
                  <Input
                    id="monthly-volume"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 50000"
                    value={monthlyVolume}
                    onChange={(e) => setMonthlyVolume(e.target.value)}
                    data-testid="input-monthly-volume"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="total-fees">
                    Total Processing Fees ($)
                  </label>
                  <Input
                    id="total-fees"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 1500"
                    value={totalFees}
                    onChange={(e) => setTotalFees(e.target.value)}
                    data-testid="input-total-fees"
                  />
                </div>
                {effectiveRate !== null && (
                  <div className="bg-muted rounded-md p-6 text-center" data-testid="display-effective-rate">
                    <div className="text-sm text-muted-foreground mb-1">Estimated Effective Rate</div>
                    <div className="text-4xl font-display font-bold text-foreground">{effectiveRate}%</div>
                  </div>
                )}
                <div className="pt-2">
                  <Link href="/upload-statement" data-testid="link-calculator-upload">
                    <Button className="w-full gap-2">
                      Get My Line-Item Breakdown
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. Choose Your Path */}
        <section className="bg-muted py-20" data-testid="section-choose-path">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-12" data-testid="text-choose-path-heading">
              Choose the Best-Fit Strategy
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-wholesale">
                <CardHeader>
                  <CardDescription>Most Merchants</CardDescription>
                  <CardTitle className="text-xl">Wholesale Pricing Options</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Interchange-plus and cost-plus pricing models that pass through actual card brand costs with a transparent markup. See exactly what you pay and why.
                  </p>
                </CardContent>
                <CardFooter>
                  <Link href="/upload-statement" data-testid="link-wholesale-cta">
                    <Button className="gap-2">
                      Run My Review
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card data-testid="card-zero-percent">
                <CardHeader>
                  <CardDescription>Where Permitted</CardDescription>
                  <CardTitle className="text-xl">Compliance-First "0%" Programs*</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Compliant cash discount or surcharge programs that can eliminate your processing costs where state law and card brand rules allow. We handle the compliance details.
                  </p>
                </CardContent>
                <CardFooter>
                  <Link href="/0-percent-processing" data-testid="link-zero-percent-cta">
                    <Button className="gap-2">
                      Check 0% Fit
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card data-testid="card-terminal">
                <CardHeader>
                  <CardDescription>Hardware</CardDescription>
                  <CardTitle className="text-xl">Liberty Smart Terminal (Dejavoo QD4)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Modern, fast, and reliable terminal hardware with built-in support for dual pricing, NFC, EMV chip, and next-day funding. Pre-configured for your setup.
                  </p>
                </CardContent>
                <CardFooter>
                  <Link href="/upload-statement" data-testid="link-terminal-cta">
                    <Button className="gap-2">
                      Check Terminal Eligibility
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-6" data-testid="text-choose-path-footnote">
              *Eligibility, underwriting, card brand rules, and laws apply.
            </p>
          </div>
        </section>

        {/* 8. Vertical Credibility */}
        <section className="bg-background py-20" data-testid="section-verticals">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-12" data-testid="text-verticals-heading">
              Built for Real Operators in South Florida (and Across the U.S.)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: Stethoscope,
                  title: "Medical / Dental / Medspa",
                  desc: "High-ticket transactions, recurring billing, and HIPAA-adjacent payment workflows. We optimize for your volume and ticket size.",
                },
                {
                  icon: Car,
                  title: "Automotive",
                  desc: "Large repair tickets, parts orders, and fleet billing. We help reduce downgrades on keyed-in and card-not-present transactions.",
                },
                {
                  icon: UtensilsCrossed,
                  title: "Restaurants",
                  desc: "High volume, low margin. We focus on tip adjustment optimization, batch timing, and dual pricing compliance.",
                },
                {
                  icon: Wrench,
                  title: "Home Services",
                  desc: "Field payments, invoicing, and mobile processing. We help you get paid faster with next-day funding and mobile terminal options.",
                },
                {
                  icon: Store,
                  title: "Retail",
                  desc: "In-store, e-commerce, or omnichannel. We analyze your channel mix and recommend the best pricing model for each.",
                },
              ].map((v, i) => (
                <Card key={i} className="p-6" data-testid={`vertical-card-${i}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <v.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-foreground mb-1">{v.title}</h3>
                      <p className="text-sm text-muted-foreground">{v.desc}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <div className="text-center mt-10">
              <Link href="/upload-statement" data-testid="link-verticals-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement (Tailored Plan)
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* 9. Proof Section */}
        <section className="bg-muted py-20" data-testid="section-proof">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-proof-heading">
                What Merchants Typically Discover (No Hype - Just Reality)
              </h2>
              <ul className="space-y-4 mb-6">
                {[
                  "Fee stacking: multiple small charges that add up to hundreds per month",
                  "Downgrades from batching late, missing Level II data, or card-not-present defaults",
                  "Deposit timing gaps: money sitting for 2-3 extra days before reaching your account",
                  "A clear choice between wholesale pricing and compliant 0% programs based on their business model",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`proof-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground font-medium bg-background rounded-md p-4" data-testid="text-proof-microcopy">
                You keep the breakdown even if you don't switch.
              </p>
            </div>
          </div>
        </section>

        {/* 10. Reviews */}
        <section className="bg-background py-20" data-testid="section-reviews">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-12" data-testid="text-reviews-heading">
              Merchants Don't Want a "Processor." They Want a Partner.
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  quote: "They showed me exactly where I was losing money. No pressure, no gimmicks. I switched because the proof was right there.",
                  name: "Dr. R., Dental Practice",
                },
                {
                  quote: "I didn't even know I was paying over 4%. Liberty broke it down line by line. Now I'm under 3% with next-day deposits.",
                  name: "Mike T., Auto Repair Shop",
                },
                {
                  quote: "The 0% program was set up correctly from day one. Compliant signage, compliant receipts, and real support when I had questions.",
                  name: "Sandra L., Boutique Retail",
                },
              ].map((review, i) => (
                <Card key={i} className="p-6" data-testid={`review-card-${i}`}>
                  <Quote className="w-6 h-6 text-primary/30 mb-3" />
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed italic">
                    "{review.quote}"
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, j) => (
                        <Star key={j} className="w-3.5 h-3.5 fill-primary text-primary" />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">{review.name}</span>
                  </div>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-6" data-testid="text-reviews-note">
              Representative examples. Replace with verified reviews as we collect them.
            </p>
          </div>
        </section>

        {/* 11. Risk Reversal */}
        <section className="bg-muted py-20" data-testid="section-risk-reversal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <ShieldCheck className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6" data-testid="text-risk-reversal-heading">
                Proof-First. No Pressure.
              </h2>
              <p className="text-muted-foreground leading-relaxed" data-testid="text-risk-reversal-body">
                We will never pressure you to switch. Upload your statement, get a written breakdown of your true costs, and decide on your own terms. If we can't show you a meaningful improvement, we'll tell you. If your current setup is already competitive, we'll tell you that too. The breakdown is yours to keep either way.
              </p>
            </div>
          </div>
        </section>

        {/* 12. FAQ */}
        <section className="bg-background py-20" data-testid="section-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-faq-heading">
                Common Questions
              </h2>
              <Accordion type="single" collapsible className="w-full" data-testid="accordion-faq">
                <AccordionItem value="faq-1" data-testid="faq-item-0">
                  <AccordionTrigger data-testid="faq-trigger-0">
                    What do you need from my statement?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-0">
                    A PDF or photo of your most recent merchant processing statement. You can redact account numbers if you'd like - we only need the totals and fee lines to calculate your effective rate and identify cost drivers.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="faq-2" data-testid="faq-item-1">
                  <AccordionTrigger data-testid="faq-trigger-1">
                    Is there a cost for the statement review?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-1">
                    No. The statement review and written breakdown are free. You keep the analysis whether you switch or not.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="faq-3" data-testid="faq-item-2">
                  <AccordionTrigger data-testid="faq-trigger-2">
                    What's the difference between wholesale pricing and a 0% program?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-2">
                    Wholesale (interchange-plus) pricing passes through the actual card brand cost with a transparent markup - you see every line item. A compliant 0% program (cash discount or surcharge) shifts the processing cost to the cardholder where state law and card brand rules allow. We'll help you determine which fits your business.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="faq-4" data-testid="faq-item-3">
                  <AccordionTrigger data-testid="faq-trigger-3">
                    How long does switching take?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-3">
                    Most merchants are fully set up within 3-5 business days. We handle the application, terminal configuration, and boarding. You'll know the timeline before you commit.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="faq-5" data-testid="faq-item-4">
                  <AccordionTrigger data-testid="faq-trigger-4">
                    Do you lock merchants into long-term contracts?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-4">
                    No. We don't believe in trapping merchants. Our agreements are straightforward with no early termination fees on standard accounts.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="faq-6" data-testid="faq-item-5">
                  <AccordionTrigger data-testid="faq-trigger-5">
                    What if my current rates are already good?
                  </AccordionTrigger>
                  <AccordionContent data-testid="faq-content-5">
                    We'll tell you. If your current setup is competitive, we'll confirm it in writing. You'll still get the breakdown so you know exactly what you're paying and why.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>

        {/* 13. Final CTA */}
        <section className="bg-primary py-20" data-testid="section-final-cta">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-primary-foreground mb-8" data-testid="text-final-cta-heading">
              Want the Fastest Answer? Upload the Statement.
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-final-upload">
                <Button size="lg" className="gap-2 bg-white text-primary border-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
              <a href="#" data-testid="link-final-book-call">
                <Button size="lg" variant="outline" className="gap-2 text-primary-foreground border-primary-foreground/30 bg-white/10 backdrop-blur-sm">
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
