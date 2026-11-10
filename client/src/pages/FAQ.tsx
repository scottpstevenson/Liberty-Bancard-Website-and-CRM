import { useState } from "react";
import { Link } from "wouter";
import { SEO, getFAQSchema, getBreadcrumbSchema } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Rocket,
  DollarSign,
  Repeat,
  Monitor,
  ArrowLeftRight,
  ShieldCheck,
  ArrowRight,
  HelpCircle,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { claimText } from "@shared/public-claims";
import { TIMING_NOTE } from "@shared/public-disclosures";
import { COMPARE_ENTRIES } from "@shared/compare-content";

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQCategory {
  id: string;
  name: string;
  icon: typeof Rocket;
  faqs: FAQItem[];
}

const faqCategories: FAQCategory[] = [
  {
    id: "getting-started",
    name: "Getting Started",
    icon: Rocket,
    faqs: [
      {
        question: "What is the best payment processor for small businesses?",
        answer:
          "The best processor for your business depends on your volume, card mix, ticket size and the equipment and services you need, so we compare costs line by line from your statement before you decide.",
      },
      {
        question: "How do I open a merchant account with Liberty Bancard?",
        answer:
          `Opening a merchant account starts with an online application: your business details, government-issued ID, and a voided check. ${TIMING_NOTE}`,
      },
      {
        question: "What documents do I need to apply for a merchant account?",
        answer:
          "You will need a valid government-issued photo ID, a voided business checking account check or bank letter, your EIN or Social Security number for sole proprietors, and your most recent processing statement if you are switching from another processor. A business license or articles of incorporation may also be requested.",
      },
      {
        question: "How long does merchant account approval take?",
        answer:
          `Approval depends on your application, the underwriting review and the product you apply for. ${TIMING_NOTE}`,
      },
      {
        question: "Do I need a long-term contract with Liberty Bancard?",
        answer:
          `Contract terms are set by your written processing agreement and any equipment arrangement. ${claimText("equipment.agreement.summary")} Review both before you sign, and ask about any early termination fee that applies.`,
      },
    ],
  },
  {
    id: "pricing-fees",
    name: "Pricing & Fees",
    icon: DollarSign,
    faqs: [
      {
        question: "How much does credit card processing cost?",
        answer:
          "Credit card processing costs consist of three components: interchange fees set by Visa and Mastercard (typically 1.5% to 2.5%), card brand assessments (about 0.13% to 0.15%), and the processor's markup. Pricing models differ: with interchange-plus the markup is listed separately from card costs, and your written quote and processing agreement set which model and markup apply to you.",
      },
      {
        question: "What is interchange-plus pricing?",
        answer:
          "Interchange-plus pricing separates the cost set by the card networks (interchange) from the processor's markup, so each appears as its own item. Whether it costs less than flat-rate or tiered pricing depends on your card mix, volume and ticket size, and a statement review shows the comparison for your business.",
      },
      {
        question: "Are there hidden fees with Liberty Bancard?",
        answer:
          "Every fee that applies to your account is stated in your written quote and processing agreement before you decide, and processing charges appear on your monthly statement. Ask for the complete fee schedule, including any setup, annual, monthly, equipment or cancellation fee, and compare it with your current statement.",
      },
      {
        question: "What is an effective rate and how do I calculate it?",
        answer:
          "Your effective rate is your total processing fees divided by your total sales volume. For example, if you processed $50,000 and paid $1,250 in total fees, your effective rate is 2.50%. This single number is the most reliable way to compare processors.",
      },
      {
        question: "Why is flat-rate pricing more expensive than interchange-plus?",
        answer:
          "Flat-rate processors charge one published rate regardless of card type, while interchange-plus passes through each card's network cost plus a stated markup. Which is lower depends on your card mix, volume and ticket size, so a like-for-like comparison needs your own statement. Our rates page lists dated provider rates.",
      },
      {
        question: "What is a PCI compliance fee?",
        answer:
          "A PCI compliance fee, where one is charged, relates to PCI DSS validation. Any PCI-related fee on your account is stated in your written quote, so ask what it includes before you decide.",
      },
    ],
  },
  {
    id: "programs",
    name: "Programs",
    icon: Repeat,
    faqs: [
      {
        question: "What is cash discount processing?",
        answer:
          `Cash discount processing is a program where a business posts a lower cash price and a standard card price. ${claimText("program.overview")}`,
      },
      {
        question: "Is cash discount processing legal?",
        answer:
          `Whether a program is permitted and what it requires depends on the program and your state. ${claimText("program.card-types")} ${claimText("program.requirements")}`,
      },
      {
        question: "What is zero-percent processing?",
        answer:
          `"Zero-percent" is a marketing name for cash discount or dual pricing programs. ${claimText("program.overview")} ${claimText("program.remaining-costs")}`,
      },
      {
        question: "What is the difference between cash discount and surcharging?",
        answer:
          `A cash discount program posts the card price as the standard price and gives a discount for cash payments. Surcharging adds a fee on top of the listed price for card payments. ${claimText("program.card-types")} ${claimText("program.requirements")}`,
      },
      {
        question: "Does Liberty Bancard offer a referral program?",
        answer:
          "Yes. Liberty Bancard's referral program rewards you for referring other businesses. You can earn residual income on every merchant you refer for as long as they process with us. Visit our referral program page for details on commissions, tracking, and payout schedules.",
      },
    ],
  },
  {
    id: "equipment",
    name: "Equipment",
    icon: Monitor,
    faqs: [
      {
        question: "What POS terminals does Liberty Bancard support?",
        answer:
          `Compatibility depends on your terminal or POS platform, product or version, and current setup. ${claimText("compat.inquiry")}`,
      },
      {
        question: "Can I use my existing terminal with Liberty Bancard?",
        answer:
          `That depends on your terminal model and its current agreement. ${claimText("compat.inquiry")}`,
      },
      {
        question: "What is tap-to-pay and do your terminals support it?",
        answer:
          "Tap-to-pay, also known as contactless payment, allows customers to hold their card or smartphone near the terminal to complete a transaction using NFC technology. Whether a given terminal supports contactless, and which cards and wallets it accepts, depends on the model and its configuration.",
      },
      {
        question: "Do I have to lease equipment from Liberty Bancard?",
        answer:
          `${claimText("equipment.options.summary")} ${claimText("equipment.agreement.summary")}`,
      },
      {
        question: "What is a virtual terminal?",
        answer:
          "A virtual terminal is a web-based interface that allows you to process credit card payments from any computer or tablet without a physical card reader. It is ideal for phone orders, mail orders, invoicing, and service businesses. Availability and any related fees are confirmed during review.",
      },
    ],
  },
  {
    id: "switching",
    name: "Switching Processors",
    icon: ArrowLeftRight,
    faqs: [
      {
        question: "How do I switch payment processors?",
        answer:
          `Switching starts with a free statement review, then an application for your new account. Equipment and activation steps are confirmed during review, and you can keep processing with your current provider until your new account is active. ${TIMING_NOTE}`,
      },
      {
        question: "Will I experience downtime when switching processors?",
        answer:
          "We recommend activating your new account and equipment before you deactivate your current processor so there is no gap in accepting payments. Equipment availability and activation are separate steps, so confirm each one before you close the old account.",
      },
      {
        question: "Is Liberty Bancard better than Square?",
        answer:
          `${COMPARE_ENTRIES.square.faqs[0].answer} ${COMPARE_ENTRIES.square.faqs[1].answer}`,
      },
      {
        question: "Is Liberty Bancard better than Stripe?",
        answer:
          `${COMPARE_ENTRIES.stripe.faqs[0].answer} ${COMPARE_ENTRIES.stripe.faqs[1].answer}`,
      },
      {
        question: "What happens to my old processor contract when I switch?",
        answer:
          "If your current processor has an early termination fee, review your agreement to understand the cost before you switch. Check whether your contract's initial term has already ended or renewed.",
      },
    ],
  },
  {
    id: "compliance",
    name: "Compliance & Security",
    icon: ShieldCheck,
    faqs: [
      {
        question: "What is PCI compliance and do I need it?",
        answer:
          "PCI DSS (Payment Card Industry Data Security Standard) is a set of security requirements that every business accepting credit cards must follow. Compliance protects cardholder data from breaches and fraud. Where your account includes a PCI program, a compliance portal may guide you through the Self-Assessment Questionnaire. Ask what the PCI program covers and what PCI fee applies to your account.",
      },
      {
        question: "How do I become PCI compliant?",
        answer:
          "Most small businesses become PCI compliant by completing an annual Self-Assessment Questionnaire through our online portal. The questionnaire takes 15 to 30 minutes and covers your data security practices. If your business processes over 6 million transactions per year, you may need an on-site audit by a Qualified Security Assessor.",
      },
      {
        question: "What happens if I am not PCI compliant?",
        answer:
          "Non-compliant merchants face monthly non-compliance fees (typically $20 to $100 per month) and, more importantly, bear full liability for any data breach. In the event of a breach, non-compliant businesses can face fines of $5,000 to $100,000 per month from card brands plus the cost of forensic investigations and customer notifications.",
      },
      {
        question: "Does Liberty Bancard offer fraud protection?",
        answer:
          "Fraud protection depends on the equipment, gateway and services on your account. Common tools include EMV chip technology, tokenization, point-to-point encryption (P2PE), address verification (AVS), and CVV matching. Which of them apply to your account is confirmed in your written quote and processing agreement.",
      },
      {
        question: "Can I accept American Express with Liberty Bancard?",
        answer:
          "American Express is commonly accepted through the OptBlue program. Whether it is available for your account, and on what terms, is confirmed during review.",
      },
    ],
  },
];

const allFaqs = faqCategories.flatMap((cat) =>
  cat.faqs.map((faq) => ({
    ...faq,
    categoryId: cat.id,
    categoryName: cat.name,
  }))
);

export default function FAQ() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const containerRef = useScrollReveal();

  const filteredCategories = faqCategories
    .map((cat) => {
      if (activeCategory && cat.id !== activeCategory) return null;
      const filtered = cat.faqs.filter((faq) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          faq.question.toLowerCase().includes(q) ||
          faq.answer.toLowerCase().includes(q)
        );
      });
      if (filtered.length === 0) return null;
      return { ...cat, faqs: filtered };
    })
    .filter(Boolean) as FAQCategory[];

  const schemaFaqs = allFaqs.map((faq) => ({
    question: faq.question,
    answer: faq.answer,
  }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Frequently Asked Questions - Payment Processing FAQ"
        description="Answers to 30+ questions about credit card processing, interchange-plus pricing, cash discount programs, PCI compliance, and switching payment processors."
        path="/faq"
        keywords="payment processing FAQ, credit card processing questions, interchange plus pricing, cash discount processing, PCI compliance, switch payment processors, best payment processor small business, Liberty Bancard FAQ"
        breadcrumbs={[{ name: "FAQ", path: "/faq" }]}
        structuredData={[
          getFAQSchema(schemaFaqs),
          getBreadcrumbSchema([{ name: "FAQ", path: "/faq" }]),
        ]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset" ref={containerRef}>
        <div className="public-container pt-4">
          <Breadcrumbs items={[{ name: "FAQ", path: "/faq" }]} />
        </div>
        <section
          className="relative overflow-hidden bg-background border-b border-border py-10"
          data-testid="section-faq-hero"
        >
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <HelpCircle className="w-12 h-12 mx-auto mb-4 text-accent" />
            <h1
              className="public-h1 public-h1--page font-bold mb-4 text-foreground"
              data-testid="text-faq-heading"
            >
              Frequently Asked Questions
            </h1>
            <p
              className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto"
              data-testid="text-faq-subheading"
            >
              Find answers to the most common questions about payment processing,
              pricing, equipment, and switching to Liberty Bancard.
            </p>

            <div className="relative max-w-lg mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search questions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-card"
                data-testid="input-faq-search"
              />
            </div>
          </div>
        </section>

        <section className="py-8" data-testid="section-faq-categories">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant={activeCategory === null ? "default" : "outline"}
                onClick={() => setActiveCategory(null)}
                data-testid="button-faq-category-all"
              >
                All
              </Button>
              {faqCategories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <Button
                    key={cat.id}
                    variant={activeCategory === cat.id ? "default" : "outline"}
                    onClick={() =>
                      setActiveCategory(
                        activeCategory === cat.id ? null : cat.id
                      )
                    }
                    data-testid={`button-faq-category-${cat.id}`}
                  >
                    <Icon className="w-4 h-4 mr-1.5" />
                    {cat.name}
                  </Button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="pb-16" data-testid="section-faq-content">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {filteredCategories.length === 0 && (
              <div className="text-center py-12" data-testid="text-faq-no-results">
                <p className="text-muted-foreground text-lg">
                  No questions match your search. Try a different term or{" "}
                  <button
                    className="text-primary underline"
                    onClick={() => {
                      setSearchQuery("");
                      setActiveCategory(null);
                    }}
                    data-testid="button-faq-clear-search"
                  >
                    clear filters
                  </button>
                  .
                </p>
              </div>
            )}

            {filteredCategories.map((cat, catIndex) => (
              <div
                key={cat.id}
                className={`${catIndex > 0 ? "mt-10" : "mt-4"} reveal`}
                data-testid={`section-faq-group-${cat.id}`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <cat.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h2
                    className="text-xl font-bold text-foreground"
                    data-testid={`text-faq-category-${cat.id}`}
                  >
                    {cat.name}
                  </h2>
                  <Badge variant="secondary">{cat.faqs.length}</Badge>
                </div>

                <Card>
                  <CardContent className="p-0">
                    <Accordion type="multiple" className="w-full">
                      {cat.faqs.map((faq, i) => (
                        <AccordionItem
                          key={i}
                          value={`${cat.id}-${i}`}
                          className="px-6"
                          data-testid={`accordion-faq-${cat.id}-${i}`}
                        >
                          <AccordionTrigger
                            className="text-left text-foreground"
                            data-testid={`button-faq-toggle-${cat.id}-${i}`}
                          >
                            {faq.question}
                          </AccordionTrigger>
                          <AccordionContent
                            className="text-muted-foreground leading-relaxed"
                            data-testid={`text-faq-answer-${cat.id}-${i}`}
                          >
                            {faq.answer}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </section>

        <section
          className="bg-muted/30 py-10"
          data-testid="section-faq-resources"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2
              className="public-h2 font-bold text-foreground mb-3"
              data-testid="text-faq-resources-heading"
            >
              Explore More Resources
            </h2>
            <p
              className="text-muted-foreground mb-8 max-w-2xl mx-auto"
              data-testid="text-faq-resources-body"
            >
              Dive deeper into payment processing topics with our comprehensive
              guides, comparison tools, and cost calculators.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link href="/upload-statement" data-testid="link-faq-statement-review">
                <Card className="h-full hover-elevate">
                  <CardContent className="pt-6 text-center">
                    <h3 className="font-semibold text-foreground mb-2">
                      Get My Free Analysis
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Upload your current statement and see what you pay, fee by
                      fee, with no obligation to switch.
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm text-primary mt-3 font-medium">
                      Upload Now <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
              <Link href="/rate-comparison" data-testid="link-faq-rate-comparison">
                <Card className="h-full hover-elevate">
                  <CardContent className="pt-6 text-center">
                    <h3 className="font-semibold text-foreground mb-2">
                      Rate Comparison Tool
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      See the processing rates Square, Stripe, Clover and others
                      publish, dated and sourced.
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm text-primary mt-3 font-medium">
                      Compare Rates <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
              <Link href="/help" data-testid="link-faq-help-center">
                <Card className="h-full hover-elevate">
                  <CardContent className="pt-6 text-center">
                    <h3 className="font-semibold text-foreground mb-2">
                      Help Center
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Browse our complete knowledge base with step-by-step guides
                      on every aspect of payment processing.
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm text-primary mt-3 font-medium">
                      Browse Articles <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </div>
        </section>

        <section
          className="relative overflow-hidden bg-primary text-primary-foreground py-10"
          data-testid="section-faq-cta"
        >
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2
              className="public-h2 font-bold mb-3"
              data-testid="text-faq-cta-heading"
            >
              Still have questions?
            </h2>
            <p
              className="text-primary-foreground/70 mb-6"
              data-testid="text-faq-cta-body"
            >
              Send us a request and a person on our team will follow up. Talk to
              someone who understands payment processing.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/support" data-testid="link-faq-contact-support">
                <span className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-background text-foreground font-medium hover:opacity-90 transition-opacity">
                  Contact Support <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
              <Link href="/free-analysis" data-testid="link-faq-get-started">
                <span className="inline-flex items-center gap-2 px-6 py-3 rounded-md border border-primary-foreground/30 text-primary-foreground font-medium hover:opacity-90 transition-opacity">
                  Get My Free Analysis
                </span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
