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
import logoBlue from "@assets/logo-blue.png";

export default function Home() {
  const [monthlyVolume, setMonthlyVolume] = useState("");
  const [totalFees, setTotalFees] = useState("");

  const volume = parseFloat(monthlyVolume.replace(/,/g, "")) || 0;
  const fees = parseFloat(totalFees.replace(/,/g, "")) || 0;
  const effectiveRate = volume > 0 ? ((fees / volume) * 100).toFixed(2) : null;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-28">

        {/* SECTION 1: Top Proof Bar */}
        <section className="bg-primary text-primary-foreground" data-testid="section-proof-bar">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <p className="text-center text-sm font-medium leading-relaxed" data-testid="text-proof-bar">
              Statement-Based Rate Review &bull; Line-Item Breakdown &bull; Wholesale Pricing Options &bull; Compliance-First 0% Programs &bull; Next-Day Funding Options &bull; Liberty Smart Terminal (QD4) &bull; Real Human Support
            </p>
            <p className="text-center text-xs text-primary-foreground/60 mt-1" data-testid="text-proof-bar-footnote">
              *Eligibility, underwriting, card brand rules, and laws apply.
            </p>
          </div>
        </section>

        {/* SECTION 2: Hero (2-column) */}
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

              <div className="relative flex items-center justify-center">
                <img src={logoBlue} alt="Liberty Bancard" className="max-w-xs w-full h-auto" data-testid="img-hero-logo" />
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: Trust Row */}
        <section className="bg-muted/30 py-12" data-testid="section-trust-row">
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

        {/* SECTION 4: What You Get */}
        <section className="bg-background py-20" data-testid="section-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-what-you-get-heading">
                What You Get From a Liberty Statement Review
              </h2>
              <ul className="space-y-4 mb-8">
                {[
                  "Your true effective rate (total fees divided by total volume)",
                  "A list of cost drivers (card mix, downgrades, add-ons, monthly fees)",
                  "2-3 clear options with apples-to-apples math (not vague promises)",
                  "Funding timing expectations and available options*",
                  "Implementation plan (terminal + onboarding + support)",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`what-you-get-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mb-6 bg-muted rounded-md p-4" data-testid="text-what-you-get-callout">
                <p className="text-sm text-muted-foreground font-medium">
                  You keep the breakdown even if you don't switch.
                </p>
              </div>
              <Link href="/upload-statement" data-testid="link-what-you-get-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload My Statement
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* SECTION 5: Big Differentiator */}
        <section className="bg-muted/30 py-20" data-testid="section-differentiator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6" data-testid="text-differentiator-heading">
                We Don't "Quote Rates." We Diagnose Statements.
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-2" data-testid="text-differentiator-body-1">
                Most processors lead with a number. Operators need the truth:
              </p>
              <p className="text-muted-foreground leading-relaxed mb-2 font-medium" data-testid="text-differentiator-body-2">
                What did you actually pay last month - and why?
              </p>
              <p className="text-muted-foreground leading-relaxed mb-8" data-testid="text-differentiator-body-3">
                We show you exactly where your costs come from and what you can change.
              </p>
              <h3 className="text-xl font-display font-semibold text-foreground mb-4" data-testid="text-differentiator-subheading">
                What we look for (and what most "quotes" ignore)
              </h3>
              <ul className="space-y-3">
                {[
                  "Monthly/annual add-ons and hidden fees",
                  "Downgrades (why \"qualified\" doesn't apply)",
                  "Keyed vs swiped cost differences",
                  "Debit acceptance and routing considerations (where applicable)",
                  "Non-compliance fees and avoidable penalties",
                  "Funding timing, cutoffs, and deposit clarity",
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

        {/* SECTION 6: 60-Second Reality Check Calculator */}
        <section className="bg-background py-20" data-testid="section-calculator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-xl mx-auto text-center">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Calculator className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-calculator-heading">
                60-Second Reality Check (Effective Rate)
              </h2>
              <p className="text-muted-foreground mb-8" data-testid="text-calculator-microcopy">
                This is the fastest way to stop guessing. Upload your statement for the exact line-item breakdown.
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

        {/* SECTION 7: Choose Your Path */}
        <section className="bg-muted/30 py-20" data-testid="section-choose-path">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-12" data-testid="text-choose-path-heading">
              Choose the Best-Fit Strategy
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-wholesale">
                <CardHeader>
                  <CardTitle className="text-lg">Wholesale Pricing Options (Most Merchants)</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Optimize pricing based on your real profile - proven by statement math.
                  </CardDescription>
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
                  <CardTitle className="text-lg">Compliance-First "0%" Programs*</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Cash discount or compliant surcharging where permitted and appropriate - with disclosures, receipt format, and staff script.
                  </CardDescription>
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
                  <CardTitle className="text-lg">Liberty Smart Terminal (Dejavoo QD4)</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Modern checkout with guided onboarding. Free equipment for qualifying merchants.*
                  </CardDescription>
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
            <p className="text-center text-xs text-muted-foreground mt-6" data-testid="text-choose-path-footnote">
              *Eligibility, underwriting, card brand rules, and laws apply.
            </p>
          </div>
        </section>

        {/* SECTION 8: Vertical Credibility */}
        <section className="bg-background py-20" data-testid="section-verticals">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-verticals-heading">
                Built for Real Operators in South Florida (and Across the U.S.)
              </h2>
              <ul className="space-y-5 mb-8">
                {[
                  { icon: Stethoscope, text: "Medical/Dental/Medspa: front desk speed, deposit clarity, fewer billing headaches" },
                  { icon: Car, text: "Automotive: high tickets, fewer payment issues, predictable funding" },
                  { icon: UtensilsCrossed, text: "Restaurants: tips, quick checkout, reliable terminals" },
                  { icon: Wrench, text: "Home Services: mobile acceptance and cashflow focus" },
                  { icon: Store, text: "Retail: fast lines, modern tap payments, support that answers" },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`vertical-item-${i}`}>
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-muted-foreground">{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/upload-statement" data-testid="link-verticals-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement (Tailored Plan)
                </Button>
              </Link>
              <p className="text-sm text-muted-foreground mt-4" data-testid="text-verticals-subtext">
                If you're not on this list, upload anyway - the math is the math.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 9: Proof Section */}
        <section className="bg-muted/30 py-20" data-testid="section-proof">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-proof-heading">
                What Merchants Typically Discover (No Hype - Just Reality)
              </h2>
              <ul className="space-y-4 mb-6">
                {[
                  "Fees inflated by \"small\" monthly add-ons that stack up",
                  "Cost spikes driven by downgrades and keyed transactions",
                  "Better deposit clarity and funding expectations*",
                  "A clear choice between: keep checkout unchanged vs fee-offset programs",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`proof-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground font-medium" data-testid="text-proof-microcopy">
                You keep the breakdown even if you don't switch.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 10: Reviews */}
        <section className="bg-background py-20" data-testid="section-reviews">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-12" data-testid="text-reviews-heading">
              Merchants Don't Want a "Processor." They Want a Partner.
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { quote: "We finally saw our real effective rate. The breakdown was clear, and the switch was smooth.", author: "Retail Owner" },
                { quote: "Support actually answered when we needed it - no ticket loop.", author: "Automotive Operator" },
                { quote: "They gave us options instead of pressure. We chose the lowest-friction route.", author: "Medical Office Manager" },
              ].map((review, i) => (
                <Card key={i} data-testid={`card-review-${i}`}>
                  <CardContent className="pt-6">
                    <Quote className="w-8 h-8 text-primary/20 mb-3" />
                    <p className="text-muted-foreground mb-4 leading-relaxed">"{review.quote}"</p>
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">- {review.author}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground mt-6" data-testid="text-reviews-note">
              Representative examples. Replace with verified reviews as we collect them.
            </p>
          </div>
        </section>

        {/* SECTION 11: Risk Reversal */}
        <section className="bg-muted/30 py-20" data-testid="section-risk-reversal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <ShieldCheck className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6" data-testid="text-risk-reversal-heading">
                Proof-First. No Pressure.
              </h2>
              <p className="text-muted-foreground leading-relaxed" data-testid="text-risk-reversal-body">
                If we can't identify a meaningful improvement from your statement and goals, we'll tell you - and you'll still get the line-item breakdown so you can make a smarter decision.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 12: FAQ */}
        <section className="bg-background py-20" data-testid="section-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-faq-heading">
                Common Questions
              </h2>
              <Accordion type="single" collapsible className="w-full" data-testid="accordion-faq">
                <AccordionItem value="q1" data-testid="faq-item-0">
                  <AccordionTrigger data-testid="faq-trigger-0">Do I have to switch processors to get the breakdown?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-0">
                    No. The statement review is how we prove your real cost. You keep the breakdown either way.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q2" data-testid="faq-item-1">
                  <AccordionTrigger data-testid="faq-trigger-1">Is my statement secure?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-1">
                    Yes. Upload a PDF or photo. Redact account numbers if you want - totals and fee lines are all we need.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q3" data-testid="faq-item-2">
                  <AccordionTrigger data-testid="faq-trigger-2">How fast is the review?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-2">
                    Fast turnaround during business hours. If you need a priority review, book a 10-minute call and tell us your deadline.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q4" data-testid="faq-item-3">
                  <AccordionTrigger data-testid="faq-trigger-3">What if I don't have a statement handy?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-3">
                    Use the Effective Rate Estimate page to get a quick estimate. For a definitive comparison, upload a statement anytime.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q5" data-testid="faq-item-4">
                  <AccordionTrigger data-testid="faq-trigger-4">Can you help if I'm on Square or Stripe?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-4">
                    Yes. We'll compare apples-to-apples using your numbers and show you the clearest path forward.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q6" data-testid="faq-item-5">
                  <AccordionTrigger data-testid="faq-trigger-5">Is "0% processing" legal?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-5">
                    "0%" programs have rules. We only recommend compliant cash discount or surcharging programs where permitted and appropriate for your business model.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>

        {/* SECTION 13: Final CTA */}
        <section className="bg-primary text-primary-foreground py-20" data-testid="section-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-8" data-testid="text-final-cta-heading">
              Want the Fastest Answer? Upload the Statement.
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-final-upload">
                <Button size="lg" variant="secondary" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
              <a href="#" data-testid="link-final-book-call">
                <Button size="lg" variant="outline" className="gap-2 bg-transparent border-primary-foreground/30 text-primary-foreground">
                  Book a 10-Minute Call
                </Button>
              </a>
            </div>
            <p className="text-sm text-primary-foreground/70 mt-4" data-testid="text-final-cta-microcopy">
              PDF or photo is fine.
            </p>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}