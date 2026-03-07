import { SEO, getFAQSchema, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  TrendingDown,
  DollarSign,
  UtensilsCrossed,
  Store,
  Stethoscope,
  Car,
  Wrench,
  ShoppingCart,
  Quote,
  CheckCircle2,
  BarChart3,
  Users,
  CreditCard,
} from "lucide-react";

import caseRestaurant from "@assets/images/case-restaurant.jpg";
import caseRetail from "@assets/images/case-retail.jpg";
import caseMedical from "@assets/images/case-medical.jpg";
import caseAuto from "@assets/images/case-auto.jpg";
import caseHomeServices from "@assets/images/case-home-services.jpg";

interface CaseStudy {
  id: string;
  businessType: string;
  industry: string;
  icon: typeof UtensilsCrossed;
  image: string | null;
  oldProcessor: string;
  monthlyVolume: string;
  oldRate: string;
  newRate: string;
  annualSavings: string;
  monthlySavings: string;
  equipment: string;
  program: string;
  testimonialQuote: string;
  testimonialName: string;
  testimonialTitle: string;
  challenge: string;
  solution: string;
  results: string[];
}

const caseStudies: CaseStudy[] = [
  {
    id: "restaurant-square",
    businessType: "Full-Service Restaurant",
    industry: "Restaurant",
    icon: UtensilsCrossed,
    image: caseRestaurant,
    oldProcessor: "Square",
    monthlyVolume: "$45,000",
    oldRate: "2.6% + $0.10 flat rate",
    newRate: "0% effective rate (cash discount program)",
    annualSavings: "$4,200",
    monthlySavings: "$350",
    equipment: "Dejavoo QD4 countertop terminal with tip adjust",
    program: "Cash Discount",
    testimonialQuote: "We were paying Square over $1,100 a month in processing fees. After switching to Liberty Bancard's cash discount program, our processing cost dropped to nearly zero. That freed up cash we put right back into our kitchen.",
    testimonialName: "Maria R.",
    testimonialTitle: "Owner, Full-Service Restaurant — South Florida",
    challenge: "This full-service restaurant was processing $45,000/month through Square at a flat 2.6% + $0.10 per transaction. With high transaction volumes from dine-in, takeout, and delivery, monthly processing fees exceeded $1,170. The owner had no visibility into interchange costs and was paying the same rate on debit cards as premium rewards cards.",
    solution: "After a free statement review, Liberty Bancard identified that a compliant cash discount program would eliminate the majority of processing costs. The restaurant was equipped with a Dejavoo QD4 terminal configured for tip adjustment at the point of sale, reducing unnecessary authorization costs. Proper signage and receipt disclosures were provided to ensure full compliance with card brand rules and state law.",
    results: [
      "Processing cost reduced from $1,170/month to under $70/month",
      "Annual savings of $4,200 redirected to food costs and staff",
      "Tip adjustment optimization reduced interchange downgrades",
      "Next-day funding improved cash flow for daily food purchasing",
      "Full compliance with Visa/Mastercard cash discount rules",
    ],
  },
  {
    id: "retail-stripe",
    businessType: "Multi-Location Retail Store",
    industry: "Retail",
    icon: Store,
    image: caseRetail,
    oldProcessor: "Stripe",
    monthlyVolume: "$62,000",
    oldRate: "2.9% + $0.30 per transaction",
    newRate: "Interchange + 0.15% + $0.08",
    annualSavings: "$3,800",
    monthlySavings: "$317",
    equipment: "PAX A920 smart terminal (2 locations)",
    program: "Interchange Plus",
    testimonialQuote: "Stripe was easy to set up, but we had no idea how much we were overpaying. Liberty Bancard showed us our actual interchange costs and the markup we were paying on top. The savings were immediate.",
    testimonialName: "David K.",
    testimonialTitle: "Owner, Retail Chain — 2 Locations",
    challenge: "This two-location retail business was processing $62,000/month through Stripe at 2.9% + $0.30 per transaction. The flat-rate model meant they were significantly overpaying on debit card transactions (which have interchange rates as low as 0.05% + $0.21) and regulated debit. With an average ticket of $35, the per-transaction fee of $0.30 was disproportionately high.",
    solution: "Liberty Bancard moved both locations to interchange-plus pricing at interchange + 0.15% + $0.08 per transaction. Each location received a PAX A920 smart terminal supporting EMV, NFC, and contactless payments. Consolidated reporting allowed the owner to view both locations from a single dashboard.",
    results: [
      "Monthly processing cost reduced from $2,098 to $1,781",
      "Annual savings of $3,800 across both locations",
      "Debit card transactions now processed at actual interchange (as low as 0.05%)",
      "Consolidated reporting across both store locations",
      "EMV and contactless payment acceptance improved checkout speed",
    ],
  },
  {
    id: "healthcare-bank",
    businessType: "Multi-Provider Medical Practice",
    industry: "Healthcare",
    icon: Stethoscope,
    image: caseMedical,
    oldProcessor: "Regional Bank Processor",
    monthlyVolume: "$128,000",
    oldRate: "Tiered pricing: 1.69% qual / 2.99% mid / 3.49% non-qual",
    newRate: "Interchange + 0.10% + $0.07 with Level 2 data",
    annualSavings: "$6,100",
    monthlySavings: "$508",
    equipment: "Ingenico Desk/5000 with P2PE encryption",
    program: "Interchange Plus with Level 2 Processing",
    testimonialQuote: "Our bank had us on tiered pricing for years. We didn't even know what non-qualified meant until Liberty Bancard broke down our statement. The Level 2 processing alone saved us a significant amount on our commercial insurance card payments.",
    testimonialName: "Dr. Sarah L.",
    testimonialTitle: "Managing Partner, Medical Practice — Tampa, FL",
    challenge: "This multi-provider medical practice was processing $128,000/month through a regional bank's tiered pricing model. Most transactions were categorized as mid-qualified or non-qualified due to card-not-present payments and commercial insurance cards, resulting in an effective rate of 3.1%. The practice had no visibility into actual interchange costs, and the bank's customer service was unresponsive to billing questions.",
    solution: "Liberty Bancard transitioned the practice to interchange-plus pricing with Level 2 data processing, which qualifies commercial and purchasing cards for lower interchange rates. The Ingenico Desk/5000 terminal with point-to-point encryption was installed to enhance payment data security. Detailed monthly reporting was configured for easy reconciliation with patient accounting systems.",
    results: [
      "Effective rate reduced from 3.1% to approximately 2.1%",
      "Annual savings of $6,100 identified and implemented",
      "Level 2 processing reduced interchange on commercial/insurance cards",
      "Point-to-point encryption enhanced PCI compliance posture",
      "Dedicated account manager for billing and technical questions",
    ],
  },
  {
    id: "auto-repair-tiered",
    businessType: "Independent Auto Repair Shop",
    industry: "Auto Repair",
    icon: Car,
    image: caseAuto,
    oldProcessor: "First Data (Fiserv) via Local Agent",
    monthlyVolume: "$38,000",
    oldRate: "Tiered: 2.29% qual / 3.49% non-qual + $7.95 statement fee + PCI fee",
    newRate: "Interchange + 0.20% + $0.10",
    annualSavings: "$2,900",
    monthlySavings: "$242",
    equipment: "Dejavoo QD2 countertop terminal",
    program: "Interchange Plus",
    testimonialQuote: "I was on tiered pricing and didn't even realize half my transactions were being charged at the non-qualified rate. My statement had fees I never agreed to. Liberty Bancard cleaned everything up and I'm saving almost $250 a month.",
    testimonialName: "Tony M.",
    testimonialTitle: "Owner, Auto Repair Shop — Broward County, FL",
    challenge: "This independent auto repair shop was processing $38,000/month through a local agent's First Data account on tiered pricing. With an average ticket of $480, most credit card transactions were downgraded to non-qualified at 3.49% due to rewards cards and keyed-in transactions. The merchant was also paying $7.95/month in statement fees, $99/year in PCI compliance fees, and a $4.95 monthly regulatory fee — none of which were clearly disclosed.",
    solution: "After a line-by-line statement review, Liberty Bancard eliminated the hidden fees and moved the shop to interchange-plus pricing at interchange + 0.20% + $0.10. The new Dejavoo QD2 terminal was configured to prompt for card-present transactions whenever possible, reducing keyed-entry downgrades. The shop's high average ticket made interchange-plus pricing particularly beneficial.",
    results: [
      "Monthly processing cost reduced from $1,090 to $848",
      "Annual savings of $2,900 after eliminating hidden fees and downgrades",
      "No more statement fees, PCI non-compliance fees, or regulatory fees",
      "Keyed-entry transactions reduced by configuring card-present prompts",
      "Transparent monthly statements with clear interchange breakdowns",
    ],
  },
  {
    id: "home-services-mobile",
    businessType: "Mobile HVAC Contractor",
    industry: "Home Services",
    icon: Wrench,
    image: caseHomeServices,
    oldProcessor: "PayPal / Venmo Business",
    monthlyVolume: "$22,000",
    oldRate: "2.29% + $0.09 (PayPal) / 1.9% + $0.10 (Venmo)",
    newRate: "0% effective rate (cash discount program)",
    annualSavings: "$1,800",
    monthlySavings: "$150",
    equipment: "SwipeSimple mobile reader + app",
    program: "Cash Discount with Mobile Processing",
    testimonialQuote: "I was splitting payments between PayPal and Venmo just to save a few bucks. Liberty Bancard set me up with a mobile reader and cash discount program. Now I process everything through one system and my processing cost is basically zero.",
    testimonialName: "James W.",
    testimonialTitle: "Owner, HVAC Contractor — Palm Beach County, FL",
    challenge: "This mobile HVAC contractor was processing $22,000/month split between PayPal and Venmo Business accounts. The split created reconciliation headaches, inconsistent fee structures, and no consolidated reporting. PayPal's 2.29% rate and Venmo's 1.9% rate meant monthly fees of approximately $470. As a mobile business, the contractor needed a solution that worked reliably in the field.",
    solution: "Liberty Bancard consolidated all processing onto a single SwipeSimple mobile reader connected via Bluetooth to the contractor's smartphone. A compliant cash discount program was implemented with proper disclosure signage for the service vehicle. The contractor now accepts chip, tap, and swipe payments at job sites with real-time transaction notifications and next-day funding.",
    results: [
      "Processing cost reduced from $470/month to under $20/month",
      "Annual savings of $1,800 with consolidated single-platform processing",
      "All transactions on one system with unified daily reporting",
      "Mobile reader works reliably at job sites via Bluetooth",
      "Next-day funding for improved cash flow between jobs",
    ],
  },
  {
    id: "ecommerce-flat-rate",
    businessType: "Online Specialty Retailer",
    industry: "E-Commerce",
    icon: ShoppingCart,
    image: null,
    oldProcessor: "Shopify Payments (Stripe-powered)",
    monthlyVolume: "$95,000",
    oldRate: "2.9% + $0.30 online / 2.6% + $0.10 in-person",
    newRate: "Interchange + 0.18% + $0.10 (gateway integrated)",
    annualSavings: "$5,400",
    monthlySavings: "$450",
    equipment: "Authorize.net gateway integration",
    program: "Interchange Plus with Gateway",
    testimonialQuote: "We thought Shopify Payments was our only option. Liberty Bancard integrated a separate gateway and our costs dropped by over $5,000 a year. The integration was seamless and we didn't have to change our website at all.",
    testimonialName: "Rachel T.",
    testimonialTitle: "Founder, Online Specialty Retailer",
    challenge: "This online specialty retailer was processing $95,000/month through Shopify Payments at 2.9% + $0.30 per transaction. With an average order of $120, monthly processing fees exceeded $3,030. The flat-rate model was particularly costly because a significant portion of transactions were debit cards and standard credit cards with lower interchange rates than the flat rate being charged.",
    solution: "Liberty Bancard set up an Authorize.net gateway integration that works alongside the existing Shopify storefront. The merchant was moved to interchange-plus pricing at interchange + 0.18% + $0.10, allowing them to benefit from lower interchange rates on debit and standard credit card transactions. Recurring billing capabilities were also configured for subscription customers.",
    results: [
      "Monthly processing cost reduced from $3,030 to $2,580",
      "Annual savings of $5,400 with interchange-plus gateway pricing",
      "Debit card transactions now processed at actual interchange rates",
      "No changes required to existing Shopify storefront",
      "Recurring billing configured for subscription revenue",
    ],
  },
];

const faqs = [
  {
    question: "Are these real savings numbers?",
    answer: "These case studies represent real-scenario savings based on actual statement reviews we've conducted for businesses in these industries. Specific details have been generalized to protect merchant privacy. Your actual savings depend on your monthly volume, transaction mix, current pricing structure, and card types accepted. We provide exact savings projections only after reviewing your specific processing statement.",
  },
  {
    question: "How do you calculate the savings?",
    answer: "We perform a line-by-line analysis of your current processing statement, identifying your effective rate (total fees divided by total volume), interchange costs, processor markup, and any hidden fees. We then model your transaction data against our pricing to calculate projected savings. This analysis is free and comes with no obligation.",
  },
  {
    question: "What is a cash discount program?",
    answer: "A cash discount program offers customers a discount for paying with cash or debit while posting the card-brand-compliant price for credit card payments. When properly implemented with correct signage and receipt disclosures, this program can reduce or eliminate your credit card processing costs. Compliance with state laws and card brand rules is required.",
  },
  {
    question: "What is interchange-plus pricing?",
    answer: "Interchange-plus pricing separates the actual card network cost (interchange) from your processor's markup. You pay the true interchange rate set by Visa/Mastercard plus a small, fixed markup. This is generally the most transparent and cost-effective pricing model for businesses processing over $10,000/month.",
  },
  {
    question: "How long does it take to switch processors?",
    answer: "Most merchants can be approved and processing within 24-48 hours of submitting a completed application. The statement review itself typically takes less than 24 hours. There is no downtime during the switch — your new account is activated before the old one is closed.",
  },
  {
    question: "Will I have to change my POS system or website?",
    answer: "In most cases, no. We integrate with major POS systems, e-commerce platforms, and payment gateways. During your statement review, we'll confirm compatibility with your existing setup and outline any integration steps if needed.",
  },
  {
    question: "Is there a contract or early termination fee?",
    answer: "Contract terms and any applicable fees are clearly outlined before you sign anything. We believe in transparency — you'll know exactly what you're agreeing to, including term length and any early termination provisions, before making a decision.",
  },
  {
    question: "What if my business processes less than $10,000 per month?",
    answer: "We work with businesses of all sizes. Even lower-volume merchants can benefit from cash discount programs or right-sized interchange-plus pricing. The free statement review will show you exactly what you're paying now and what your options are.",
  },
];

const BASE_URL = "https://libertybancard.com";

function getArticleSchema(cs: CaseStudy) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${cs.businessType} Saves ${cs.annualSavings}/Year by Switching from ${cs.oldProcessor}`,
    description: cs.challenge.substring(0, 200),
    author: {
      "@type": "Organization",
      name: "Liberty Bancard",
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "Liberty Bancard",
      url: BASE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/favicon.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${BASE_URL}/case-studies#${cs.id}`,
    },
    datePublished: "2025-01-15",
    dateModified: "2025-06-01",
    about: {
      "@type": "Thing",
      name: `${cs.industry} Payment Processing Savings`,
    },
  };
}

export default function CaseStudies() {
  const totalSavings = caseStudies.reduce((sum, cs) => {
    return sum + parseInt(cs.annualSavings.replace(/[^0-9]/g, ""));
  }, 0);

  const articleSchemas = caseStudies.map(getArticleSchema);

  return (
    <>
      <SEO
        title="Payment Processing Case Studies — Real Savings for Real Businesses"
        description="See how restaurants, retail stores, healthcare practices, and more saved thousands per year by switching to Liberty Bancard. Real numbers from real statement reviews."
        path="/case-studies"
        keywords="payment processing case studies, credit card processing savings, merchant services savings, switch payment processor, reduce processing fees, cash discount savings, interchange plus savings"
        ogType="website"
        breadcrumbs={[{ name: "Case Studies", path: "/case-studies" }]}
        structuredData={[
          ...articleSchemas,
          getFAQSchema(faqs),
        ] as any}
      />

      <Navbar />

      <main className="pt-32 pb-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <Badge variant="secondary" className="mb-4" data-testid="badge-case-studies">
              Real Results
            </Badge>
            <h1
              className="text-4xl sm:text-5xl font-bold tracking-tight mb-6"
              data-testid="text-case-studies-title"
            >
              Payment Processing Savings —{" "}
              <span className="text-primary">Exposed by Statement Review</span>
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8"
              data-testid="text-case-studies-subtitle"
            >
              Every business below was overpaying for credit card processing. A free
              statement review revealed hidden fees, inflated markups, and pricing
              structures that didn't match their transaction patterns. Here's what
              happened when they switched.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <div className="text-center" data-testid="stat-total-savings">
                <p className="text-3xl font-bold text-primary">
                  ${totalSavings.toLocaleString()}+
                </p>
                <p className="text-sm text-muted-foreground">Combined Annual Savings</p>
              </div>
              <div className="w-px h-12 bg-border hidden sm:block" />
              <div className="text-center" data-testid="stat-case-count">
                <p className="text-3xl font-bold text-primary">{caseStudies.length}</p>
                <p className="text-sm text-muted-foreground">Industries Represented</p>
              </div>
              <div className="w-px h-12 bg-border hidden sm:block" />
              <div className="text-center" data-testid="stat-avg-savings">
                <p className="text-3xl font-bold text-primary">
                  ${Math.round(totalSavings / caseStudies.length).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">Avg. Annual Savings</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-12">
            {caseStudies.map((cs, index) => {
              const IconComponent = cs.icon;
              return (
                <Card
                  key={cs.id}
                  className="overflow-visible"
                  data-testid={`card-case-study-${cs.id}`}
                >
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
                      {cs.image ? (
                        <div className="lg:col-span-2 relative">
                          <img
                            src={cs.image}
                            alt={`${cs.businessType} payment processing case study`}
                            className="w-full h-64 lg:h-full object-cover rounded-t-md lg:rounded-l-md lg:rounded-tr-none"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent rounded-t-md lg:rounded-l-md lg:rounded-tr-none" />
                          <div className="absolute bottom-4 left-4 right-4">
                            <Badge variant="default" className="mb-2">
                              {cs.program}
                            </Badge>
                            <p className="text-white text-2xl font-bold">
                              {cs.annualSavings}
                              <span className="text-white/80 text-base font-normal">
                                /year saved
                              </span>
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="lg:col-span-2 bg-muted/30 flex flex-col items-center justify-center p-8 rounded-t-md lg:rounded-l-md lg:rounded-tr-none">
                          <IconComponent className="w-16 h-16 text-primary/40 mb-4" />
                          <Badge variant="default" className="mb-2">
                            {cs.program}
                          </Badge>
                          <p className="text-foreground text-2xl font-bold">
                            {cs.annualSavings}
                            <span className="text-muted-foreground text-base font-normal">
                              /year saved
                            </span>
                          </p>
                        </div>
                      )}

                      <div className="lg:col-span-3 p-6 lg:p-8">
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                          <div className="flex items-center gap-2">
                            <IconComponent className="w-5 h-5 text-primary" />
                            <h2
                              className="text-xl font-bold"
                              data-testid={`text-case-study-title-${cs.id}`}
                            >
                              {cs.businessType}
                            </h2>
                          </div>
                          <Badge variant="outline">
                            Switched from {cs.oldProcessor}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                          <div data-testid={`stat-volume-${cs.id}`}>
                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                              Monthly Volume
                            </p>
                            <p className="text-sm font-semibold">{cs.monthlyVolume}</p>
                          </div>
                          <div data-testid={`stat-old-rate-${cs.id}`}>
                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                              Old Rate
                            </p>
                            <p className="text-sm font-semibold text-destructive">
                              {cs.oldRate}
                            </p>
                          </div>
                          <div data-testid={`stat-new-rate-${cs.id}`}>
                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                              New Rate
                            </p>
                            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                              {cs.newRate}
                            </p>
                          </div>
                          <div data-testid={`stat-equipment-${cs.id}`}>
                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                              Equipment
                            </p>
                            <p className="text-sm font-semibold">{cs.equipment}</p>
                          </div>
                        </div>

                        <Accordion type="single" collapsible className="mb-6">
                          <AccordionItem value="challenge" className="border-b-0">
                            <AccordionTrigger
                              className="text-sm font-medium py-2"
                              data-testid={`button-challenge-${cs.id}`}
                            >
                              The Challenge
                            </AccordionTrigger>
                            <AccordionContent>
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {cs.challenge}
                              </p>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="solution" className="border-b-0">
                            <AccordionTrigger
                              className="text-sm font-medium py-2"
                              data-testid={`button-solution-${cs.id}`}
                            >
                              Our Solution
                            </AccordionTrigger>
                            <AccordionContent>
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {cs.solution}
                              </p>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="results" className="border-b-0">
                            <AccordionTrigger
                              className="text-sm font-medium py-2"
                              data-testid={`button-results-${cs.id}`}
                            >
                              Results
                            </AccordionTrigger>
                            <AccordionContent>
                              <ul className="space-y-2">
                                {cs.results.map((result, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                  >
                                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                                    <span>{result}</span>
                                  </li>
                                ))}
                              </ul>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>

                        <div className="bg-muted/30 rounded-md p-4">
                          <div className="flex items-start gap-3">
                            <Quote className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                            <div>
                              <p
                                className="text-sm italic text-muted-foreground leading-relaxed mb-2"
                                data-testid={`text-testimonial-${cs.id}`}
                              >
                                "{cs.testimonialQuote}"
                              </p>
                              <p className="text-xs font-medium">
                                — {cs.testimonialName},{" "}
                                <span className="text-muted-foreground">
                                  {cs.testimonialTitle}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="bg-muted/30 py-16 mb-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl font-bold mb-4"
              data-testid="text-cta-title"
            >
              What Are You Overpaying?
            </h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-2xl mx-auto">
              Every business above started with a free statement review. Upload your
              most recent processing statement and we'll show you exactly where your
              money is going — and how much you could save.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/upload-statement" data-testid="link-cta-upload">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Your Statement
                </Button>
              </Link>
              <Link href="/savings-calculator" data-testid="link-cta-calculator">
                <Button size="lg" variant="outline" className="gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Estimate Your Savings
                </Button>
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Free analysis. No obligation. Results within 24 hours.
            </p>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
          <h2
            className="text-3xl font-bold text-center mb-2"
            data-testid="text-faq-title"
          >
            Frequently Asked Questions
          </h2>
          <p className="text-muted-foreground text-center mb-8">
            Common questions about our case studies and switching processors.
          </p>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`faq-${index}`}
              >
                <AccordionTrigger
                  className="text-left"
                  data-testid={`button-faq-${index}`}
                >
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="p-8 text-center">
              <CreditCard className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2
                className="text-2xl font-bold mb-3"
                data-testid="text-bottom-cta-title"
              >
                Ready to See Your Real Processing Costs?
              </h2>
              <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                Join hundreds of businesses that discovered exactly what they were
                overpaying. Your free statement review takes less than 60 seconds to
                start.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Link href="/upload-statement" data-testid="link-bottom-upload">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Statement Now
                  </Button>
                </Link>
                <Link href="/get-started" data-testid="link-bottom-get-started">
                  <Button variant="outline" className="gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Get Started
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <Footer />
    </>
  );
}
