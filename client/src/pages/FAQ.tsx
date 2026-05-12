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
          "Liberty Bancard is consistently rated among the best payment processors for small businesses because we offer transparent interchange-plus pricing, no long-term contracts, next-day funding, and dedicated human support. Unlike flat-rate processors like Square or Stripe, we tailor your rates to your business type and volume, which saves most merchants $1,800 to $6,100 per year.",
      },
      {
        question: "How do I open a merchant account with Liberty Bancard?",
        answer:
          "Opening a merchant account takes less than 10 minutes. Submit your application online with your business details, government-issued ID, and a voided check. Most applications are approved within 24 to 48 hours, and you can begin processing within 3 to 5 business days.",
      },
      {
        question: "What documents do I need to apply for a merchant account?",
        answer:
          "You will need a valid government-issued photo ID, a voided business checking account check or bank letter, your EIN or Social Security number for sole proprietors, and your most recent processing statement if you are switching from another processor. A business license or articles of incorporation may also be requested.",
      },
      {
        question: "How long does merchant account approval take?",
        answer:
          "Most standard retail and restaurant merchants are approved within 24 to 48 hours. The complete process from application to first transaction typically takes 3 to 5 business days. Rush processing is available for urgent needs.",
      },
      {
        question: "Do I need a long-term contract with Liberty Bancard?",
        answer:
          "No. Liberty Bancard offers month-to-month processing agreements with no early termination fees. You can close your account at any time without penalty, which is a major advantage over processors that lock you into multi-year contracts with cancellation fees of $500 or more.",
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
          "Credit card processing costs consist of three components: interchange fees set by Visa and Mastercard (typically 1.5% to 2.5%), card brand assessments (about 0.13% to 0.15%), and the processor's markup. Liberty Bancard's interchange-plus pricing keeps our markup transparent and competitive, resulting in effective rates significantly lower than flat-rate processors.",
      },
      {
        question: "What is interchange-plus pricing?",
        answer:
          "Interchange-plus pricing separates the true cost of processing (interchange fees set by card brands) from the processor's markup. This is the most transparent pricing model in the industry because you see exactly what the card brands charge and exactly what Liberty Bancard charges. It typically saves businesses 20% to 40% compared to flat-rate or tiered pricing.",
      },
      {
        question: "Are there hidden fees with Liberty Bancard?",
        answer:
          "No. Liberty Bancard does not charge application fees, setup fees, annual fees, or cancellation fees on month-to-month agreements. We do not pad interchange rates or add hidden surcharges. Every fee is itemized on your monthly statement so you can verify your costs line by line.",
      },
      {
        question: "What is an effective rate and how do I calculate it?",
        answer:
          "Your effective rate is your total processing fees divided by your total sales volume. For example, if you processed $50,000 and paid $1,250 in total fees, your effective rate is 2.50%. This single number is the most reliable way to compare processors. Liberty Bancard helps you calculate and monitor your effective rate monthly.",
      },
      {
        question: "Why is flat-rate pricing more expensive than interchange-plus?",
        answer:
          "Flat-rate processors like Square (2.6% + $0.10) and Stripe (2.9% + $0.30) charge the same rate regardless of card type. Since many transactions have interchange rates well below 2%, you overpay on the majority of your sales. Liberty Bancard's interchange-plus model passes through the actual interchange cost plus a small fixed markup, saving most businesses thousands per year.",
      },
      {
        question: "What is a PCI compliance fee?",
        answer:
          "A PCI compliance fee covers the cost of your annual PCI DSS validation program, which protects cardholder data. Liberty Bancard's PCI compliance fee is a small monthly charge that includes access to our compliance portal, Self-Assessment Questionnaire tools, and quarterly vulnerability scans if required.",
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
          "Cash discount processing is a program where businesses offer a discount to customers who pay with cash while posting a slightly higher price for card payments. This effectively eliminates your credit card processing fees. Liberty Bancard's cash discount program is fully compliant with card brand rules and has helped restaurants, auto shops, and retail stores save thousands annually.",
      },
      {
        question: "Is cash discount processing legal?",
        answer:
          "Yes, cash discount processing is legal in all 50 states. It differs from surcharging, which has state-specific restrictions. Liberty Bancard ensures your cash discount program complies with Visa, Mastercard, and all applicable state regulations, including proper signage and receipt formatting.",
      },
      {
        question: "What is zero-percent processing?",
        answer:
          "Zero-percent processing is another name for cash discount or dual pricing programs where the merchant's effective processing cost is reduced to zero. Customers who pay with a card see a small service fee, while cash-paying customers receive the posted cash price. Liberty Bancard provides compliant signage, terminal programming, and staff training materials.",
      },
      {
        question: "What is the difference between cash discount and surcharging?",
        answer:
          "A cash discount program posts the card price as the standard price and gives a discount for cash payments. Surcharging adds a fee on top of the listed price for card payments. Surcharging is prohibited in several states and has stricter compliance requirements. Liberty Bancard recommends cash discount programs because they are legal everywhere and simpler to implement.",
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
          "Liberty Bancard supports a wide range of terminals and POS systems including Clover (Flex, Mini, Station), Dejavoo, PAX Technology, Valor PayTech, and most USB and IP-connected devices. We also support virtual terminals for phone and mail-order transactions and mobile card readers for businesses on the go.",
      },
      {
        question: "Can I use my existing terminal with Liberty Bancard?",
        answer:
          "In many cases, yes. If you own your terminal outright and it supports standard payment protocols, we can often reprogram it to work with Liberty Bancard's processing platform. Contact our integration team with your terminal model and we will confirm compatibility at no charge.",
      },
      {
        question: "What is tap-to-pay and do your terminals support it?",
        answer:
          "Tap-to-pay, also known as contactless payment, allows customers to hold their card or smartphone near the terminal to complete a transaction using NFC technology. All Liberty Bancard terminals support tap-to-pay for Visa, Mastercard, American Express, Apple Pay, Google Pay, and Samsung Pay.",
      },
      {
        question: "Do I have to lease equipment from Liberty Bancard?",
        answer:
          "No. Liberty Bancard offers terminals for purchase outright with no leasing required. We believe equipment leases are one of the most expensive hidden costs in the payments industry. Purchasing your terminal saves you hundreds or even thousands of dollars over the life of a lease.",
      },
      {
        question: "What is a virtual terminal?",
        answer:
          "A virtual terminal is a web-based interface that allows you to process credit card payments from any computer or tablet without a physical card reader. It is ideal for phone orders, mail orders, invoicing, and service businesses. Liberty Bancard includes virtual terminal access with every merchant account at no additional cost.",
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
          "Switching to Liberty Bancard is straightforward. Upload your current processing statement for a free analysis, apply for your new account, and once approved we handle terminal reprogramming or new equipment setup. You can continue processing with your current provider until your Liberty Bancard account is fully active, ensuring zero downtime.",
      },
      {
        question: "Will I experience downtime when switching processors?",
        answer:
          "No. Liberty Bancard coordinates your transition to ensure there is no gap in your ability to accept payments. We activate your new account and equipment before you deactivate your old processor, so your business never misses a transaction.",
      },
      {
        question: "Is Liberty Bancard better than Square?",
        answer:
          "For most businesses processing over $5,000 per month, Liberty Bancard offers significantly lower costs than Square. Square charges a flat 2.6% + $0.10 per transaction regardless of card type, while Liberty Bancard's interchange-plus pricing passes through the actual card cost plus a small markup. Most merchants switching from Square save $1,800 to $4,200 per year.",
      },
      {
        question: "Is Liberty Bancard better than Stripe?",
        answer:
          "Stripe charges 2.9% + $0.30 per online transaction, which is among the highest flat rates in the industry. Liberty Bancard's interchange-plus pricing and gateway integration offer the same e-commerce capabilities at a fraction of the cost. Businesses processing $10,000 or more monthly typically save $3,000 to $5,400 per year by switching to Liberty Bancard.",
      },
      {
        question: "What happens to my old processor contract when I switch?",
        answer:
          "If your current processor has an early termination fee, review your agreement to understand the cost. Liberty Bancard can often help offset cancellation fees through our savings guarantee. Many processors also offer month-to-month terms after the initial contract period expires, so check whether your contract has already rolled over.",
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
          "PCI DSS (Payment Card Industry Data Security Standard) is a set of security requirements that every business accepting credit cards must follow. Compliance protects cardholder data from breaches and fraud. Liberty Bancard provides a PCI compliance portal, guided Self-Assessment Questionnaires, and support to help you achieve and maintain compliance with minimal effort.",
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
          "Yes. Liberty Bancard provides multiple layers of fraud protection including EMV chip technology, tokenization, point-to-point encryption (P2PE), address verification (AVS), and CVV matching. Our monitoring systems flag suspicious activity in real time, and our support team is available to help you respond to fraud attempts quickly.",
      },
      {
        question: "Can I accept American Express with Liberty Bancard?",
        answer:
          "Yes. All Liberty Bancard merchants can accept American Express through the OptBlue program. OptBlue provides competitive interchange-plus pricing on Amex transactions, which is significantly cheaper than American Express's traditional direct program. Acceptance is included automatically with your merchant account.",
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

      <main className="flex-grow pt-28" ref={containerRef}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <Breadcrumbs items={[{ name: "FAQ", path: "/faq" }]} />
        </div>
        <section
          className="bg-primary text-primary-foreground py-16"
          data-testid="section-faq-hero"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <HelpCircle className="w-12 h-12 mx-auto mb-4 opacity-80" />
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4"
              data-testid="text-faq-heading"
            >
              Frequently Asked Questions
            </h1>
            <p
              className="text-primary-foreground/70 text-lg mb-8 max-w-xl mx-auto"
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
                className="pl-10 bg-background text-foreground"
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
          className="bg-muted/30 py-16"
          data-testid="section-faq-resources"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2
              className="text-2xl font-bold text-foreground mb-3"
              data-testid="text-faq-resources-heading"
            >
              Explore More Resources
            </h2>
            <p
              className="text-muted-foreground mb-8 max-w-2xl mx-auto"
              data-testid="text-faq-resources-body"
            >
              Dive deeper into payment processing topics with our comprehensive
              guides, comparison tools, and savings calculators.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link href="/upload-statement" data-testid="link-faq-statement-review">
                <Card className="h-full hover-elevate">
                  <CardContent className="pt-6 text-center">
                    <h3 className="font-semibold text-foreground mb-2">
                      Free Statement Review
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Upload your current statement and see exactly how much you
                      can save with Liberty Bancard.
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
                      Compare Liberty Bancard's interchange-plus rates against
                      Square, Stripe, Clover, and others.
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
          className="bg-primary text-primary-foreground py-12"
          data-testid="section-faq-cta"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2
              className="text-2xl font-bold mb-3"
              data-testid="text-faq-cta-heading"
            >
              Still have questions?
            </h2>
            <p
              className="text-primary-foreground/70 mb-6"
              data-testid="text-faq-cta-body"
            >
              Our team responds within 4 business hours. Talk to a real person who
              understands payment processing.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/support" data-testid="link-faq-contact-support">
                <span className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-background text-foreground font-medium hover:opacity-90 transition-opacity">
                  Contact Support <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
              <Link href="/get-started" data-testid="link-faq-get-started">
                <span className="inline-flex items-center gap-2 px-6 py-3 rounded-md border border-primary-foreground/30 text-primary-foreground font-medium hover:opacity-90 transition-opacity">
                  Get Started Free
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
