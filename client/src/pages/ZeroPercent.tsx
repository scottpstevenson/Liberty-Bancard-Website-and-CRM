import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
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
  ArrowRight,
  ShieldCheck,
  DollarSign,
  FileText,
  Users,
  CreditCard,
  ClipboardCheck,
  Headphones,
  Phone,
} from "lucide-react";

const approaches = [
  {
    title: "Cash Discount",
    description:
      "A posted cash price with a clearly disclosed service fee for card payments. The discount is applied at the register and reflected on the receipt. This model is widely accepted and straightforward to implement when done correctly.",
    icon: DollarSign,
  },
  {
    title: "Compliant Surcharging",
    description:
      "A percentage-based surcharge added to credit card transactions only, with proper registration, signage, and receipt disclosure. Debit cards are never surcharged. This model requires card brand registration and state-level compliance checks.",
    icon: ShieldCheck,
  },
];

const fitItems = [
  "Your average ticket is high enough that the fee offset is meaningful",
  "Your customer base is accustomed to cash/card price differences",
  "You operate in a state where surcharging or cash discount is permitted",
  "You want to eliminate or significantly reduce your monthly processing cost",
];

const checkoutBullets = [
  "Clear signage at the point of entry and point of sale",
  "Receipts that show the base price and any fee or discount separately",
  "Debit transactions are always excluded from surcharges",
  "Staff trained with a simple, professional script for customer questions",
];

const complianceItems = [
  { label: "Signage", detail: "Posted at entry and register per card brand requirements" },
  { label: "Receipt line items", detail: "Base price and fee shown separately on every receipt" },
  { label: "Debit exclusion", detail: "PIN and signature debit are never surcharged" },
  { label: "Card brand registration", detail: "Surcharge programs registered with Visa/Mastercard as required" },
  { label: "Ongoing support", detail: "We monitor rule changes and update your configuration" },
];

const processSteps = [
  { step: "1", title: "Upload", detail: "Send us your current processing statement (PDF or photo)" },
  { step: "2", title: "Review", detail: "We calculate your effective rate and identify cost drivers" },
  { step: "3", title: "Recommend", detail: "You receive a written breakdown with compliant options" },
  { step: "4", title: "Deploy", detail: "We configure your terminal, signage, and receipts correctly" },
];

const faqItems = [
  {
    question: "Is surcharging legal in my state?",
    answer:
      "Surcharging is legal in most U.S. states, but some states have restrictions or prohibitions. We check your specific state's rules before recommending a surcharge program and will only deploy it where it is fully compliant.",
  },
  {
    question: "Can I surcharge debit cards?",
    answer:
      "No. Card brand rules and federal regulations prohibit surcharging on debit card transactions, whether PIN or signature debit. Our system automatically excludes debit cards from any surcharge.",
  },
  {
    question: "Will customers complain about the fee?",
    answer:
      "Transparency is key. When signage is clear, receipts are itemized, and staff are trained with a professional script, most customers understand and accept the fee. Many businesses report minimal pushback after the first week.",
  },
  {
    question: "What if card brand rules change?",
    answer:
      "We monitor Visa, Mastercard, and other network rule updates continuously. If anything changes that affects your program, we update your configuration and notify you proactively.",
  },
];

export default function ZeroPercent() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-16">
        {/* Hero */}
        <section className="bg-background py-20 lg:py-28" data-testid="section-zero-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6"
                data-testid="text-zero-heading"
              >
                "0% Processing" Has Rules. We Do It the Right Way.
              </h1>
              <p
                className="text-lg text-muted-foreground mb-8 leading-relaxed"
                data-testid="text-zero-subheadline"
              >
                Eliminating fees requires the correct structure, disclosures, and configuration
                - and it isn't right for every business. We review your statement and recommend
                the most compliant, lowest-friction approach.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                <Link href="/upload-statement" data-testid="link-zero-primary-cta">
                  <Button size="lg" className="gap-2">
                    <Upload className="w-4 h-4" />
                    Check Eligibility (Free Review)
                  </Button>
                </Link>
                <a href="#" data-testid="link-zero-secondary-cta">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Phone className="w-4 h-4" />
                    Talk to a Specialist
                  </Button>
                </a>
              </div>
              <p
                className="text-xs text-muted-foreground mt-4"
                data-testid="text-zero-microcopy"
              >
                Where permitted; rules vary by state and card brand.
              </p>
            </div>
          </div>
        </section>

        {/* Two Legit Approaches */}
        <section className="bg-muted py-20" data-testid="section-approaches">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-approaches-heading"
            >
              Two Legit Approaches
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
          </div>
        </section>

        {/* Is It a Fit? */}
        <section className="bg-background py-20" data-testid="section-fit">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-fit-heading"
              >
                Is It a Fit?
              </h2>
              <ul className="space-y-4">
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
            </div>
          </div>
        </section>

        {/* Customer-Friendly Checkout */}
        <section className="bg-muted py-20" data-testid="section-checkout">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-checkout-heading"
              >
                Customer-Friendly Checkout
              </h2>
              <ul className="space-y-4">
                {checkoutBullets.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`checkout-bullet-${i}`}
                  >
                    <Users className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Compliance Checklist */}
        <section className="bg-background py-20" data-testid="section-compliance">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-compliance-heading"
              >
                Compliance Checklist
              </h2>
              <ul className="space-y-5">
                {complianceItems.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`compliance-item-${i}`}
                  >
                    <ClipboardCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{item.label}</span>
                      <span className="text-muted-foreground"> - {item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What Happens After Upload */}
        <section className="bg-muted py-20" data-testid="section-process">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-process-heading"
            >
              What Happens After Upload
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {processSteps.map((item, i) => (
                <Card key={i} data-testid={`card-process-${i}`}>
                  <CardContent className="pt-6">
                    <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center mb-4">
                      <span className="text-primary-foreground font-bold text-lg">
                        {item.step}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-foreground text-lg mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-zero-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-zero-faq-heading"
              >
                Frequently Asked Questions
              </h2>
              <Accordion type="single" collapsible className="w-full">
                {faqItems.map((item, i) => (
                  <AccordionItem key={i} value={`faq-${i}`} data-testid={`faq-item-${i}`}>
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
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-muted py-20" data-testid="section-zero-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
              data-testid="text-zero-final-cta-heading"
            >
              Want the Cleanest, Most Compliant Setup?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Upload your statement and we will show you whether a 0% program is the right fit
              - and exactly how to implement it.
            </p>
            <Link href="/upload-statement" data-testid="link-zero-final-cta">
              <Button size="lg" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload My Statement
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
