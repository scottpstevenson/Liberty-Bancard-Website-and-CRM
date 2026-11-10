import { useParams } from "wouter";
import { Link } from "wouter";
import { CALENDAR_URL } from "@/lib/constants";
import { claimText } from "@shared/public-claims";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Check,
  Upload,
  Phone,
  ArrowRight,
  DollarSign,
  Shield,
  Clock,
  CreditCard,
  UtensilsCrossed,
  Store,
  Stethoscope,
  AlertTriangle,
  Smartphone,
  Receipt,
  HeartPulse,
  Users,
  Globe,
  ShoppingCart,
  RefreshCw,
  Lock,
  Truck,
  FileText,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

import verticalRestaurant from "@/assets/images/vertical-restaurant.jpg";
import verticalRetail from "@/assets/images/vertical-retail.jpg";
import verticalMedical from "@/assets/images/vertical-medical.jpg";
import verticalHomeServices from "@/assets/images/vertical-home-services.jpg";
import heroAnalytics from "@/assets/images/hero-analytics.jpg";
import zeroPercent from "@/assets/images/zero-percent.jpg";
import compareRates from "@/assets/images/compare-rates.jpg";

interface PainPoint {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface SolutionItem {
  title: string;
  description: string;
}

interface EquipmentRec {
  name: string;
  description: string;
}

interface PricingItem {
  label: string;
  detail: string;
}

interface OnePagerData {
  slug: string;
  industry: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  heroIcon: LucideIcon;
  painPoints: PainPoint[];
  solutionPitch: string;
  solutions: SolutionItem[];
  equipment: EquipmentRec[];
  pricing: PricingItem[];
  ctaHeadline: string;
  ctaSubline: string;
  complianceNotes?: string[];
}

/** Pricing and agreement rows shared by every one-pager. Each states a rule or a source-backed claim, never a rate or saving. */
function commonPricing(extra?: PricingItem): PricingItem[] {
  const rows: PricingItem[] = [
    { label: "Pricing models", detail: "Interchange-plus, flat-rate and cash discount programs are priced differently. A statement review compares them using your own numbers." },
    { label: "Funding", detail: claimText("funding.availability") },
    { label: "Equipment", detail: claimText("equipment.options.summary") },
    { label: "Agreement", detail: claimText("equipment.agreement.summary") },
  ];
  return extra ? [extra, ...rows.slice(0, 3)] : rows;
}

export const salesOnePagerData: Record<string, OnePagerData> = {
  restaurant: {
    slug: "restaurant",
    industry: "Restaurant",
    heroTitle: "Payment Processing Questions for Restaurants",
    heroSubtitle: "Tableside payments, tip adjustment, POS compatibility and equipment questions for restaurants, plus a statement review that shows what you pay today.",
    heroImage: verticalRestaurant,
    heroIcon: UtensilsCrossed,
    painPoints: [
      { icon: DollarSign, title: "Tip adjustments and authorizations", description: "Ask how tip adjustments are processed and whether they change the fees on your statement." },
      { icon: Clock, title: "Deposit timing", description: "Funding timing depends on the account and its agreement. Ask what applies to yours." },
      { icon: AlertTriangle, title: "POS bundles and processing", description: "Some POS providers bundle processing. Ask for each fee to be itemized so you can see what you pay per transaction." },
      { icon: Phone, title: "Support during service", description: "Ask what support your current agreement includes and how to reach it during peak hours." },
    ],
    solutionPitch: claimText("review.process.summary"),
    solutions: [
      { title: "Tableside payment terminals", description: "Handheld and wireless terminals allow payment at the table. Availability and agreement terms depend on the account." },
      { title: "Tip adjustment", description: "Ask how the terminal prompts for tips and how adjustments are settled." },
      { title: "POS compatibility", description: "Confirm compatibility with your preferred POS before choosing equipment." },
      { title: "Cash discount and surcharge programs", description: "Card brand rules and state law apply, and eligibility varies. A statement review is the place to start." },
    ],
    equipment: [
      { name: "Clover Flex 3", description: "Handheld terminal for tableside service." },
      { name: "Clover Station Duo", description: "Countertop POS with two screens." },
      { name: "Dejavoo QD4", description: "Portable smart terminal." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "See what your restaurant pays today",
    ctaSubline: "Upload your current processing statement for a free review. We walk you through the fees on it.",
  },
  retail: {
    slug: "retail",
    industry: "Retail",
    heroTitle: "Payment Processing Questions for Retail",
    heroSubtitle: "POS and inventory compatibility, e-commerce sync and a statement review that shows how debit and credit are billed.",
    heroImage: verticalRetail,
    heroIcon: Store,
    painPoints: [
      { icon: DollarSign, title: "Flat-rate and card mix", description: "Flat-rate plans charge one published rate by plan and channel. Whether that costs more or less than another model depends on your card mix and fees outside the rate." },
      { icon: AlertTriangle, title: "Equipment charges", description: "Ask whether equipment is leased, rented or purchased, and what the agreement says if you leave." },
      { icon: Clock, title: "In-store and online sales", description: "Running separate systems for in-store and online sales can mean separate reports. Ask how each is reconciled." },
      { icon: Shield, title: "Chargebacks", description: "Ask what support your current agreement includes when a customer disputes a charge." },
    ],
    solutionPitch: claimText("review.process.summary"),
    solutions: [
      { title: "POS and inventory compatibility", description: "Confirm that your POS and inventory tools work with the terminal and gateway before choosing equipment." },
      { title: "Catalog and checkout", description: "Ask which devices support barcode scanning and catalog management." },
      { title: "In-store and online reporting", description: "Ask whether in-store and online sales can be reported together." },
      { title: "Pricing models", description: "A statement review shows how debit and credit transactions are billed today and what other models would change." },
    ],
    equipment: [
      { name: "Clover Station Duo", description: "Countertop register with two screens." },
      { name: "Clover Mini 3", description: "Compact countertop POS." },
      { name: "SwipeSimple", description: "Mobile reader for pop-up shops and markets." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "Find out what you pay today",
    ctaSubline: "Upload your current processing statement for a free review of the fees on it.",
  },
  healthcare: {
    slug: "healthcare",
    industry: "Healthcare",
    heroTitle: "Payment Processing Questions for Healthcare Providers",
    heroSubtitle: "Patient payments, payment plans and front-desk terminals for medical and dental practices, plus a statement review of how they are billed.",
    heroImage: verticalMedical,
    heroIcon: Stethoscope,
    painPoints: [
      { icon: DollarSign, title: "Larger balances", description: "Patient payments are often larger amounts. Ask how higher-ticket payments are priced on your statement." },
      { icon: Shield, title: "Payment data and privacy", description: "Practices have their own privacy and compliance obligations. Ask your processor and your compliance advisor what applies to payment data." },
      { icon: Clock, title: "Reconciliation", description: "Matching patient payments to accounts is easier when reporting is clear. Ask what reports your current provider supplies." },
      { icon: HeartPulse, title: "FSA and HSA cards", description: "Ask how your current setup handles FSA and HSA cards." },
    ],
    solutionPitch: claimText("review.process.summary"),
    solutions: [
      { title: "Statement review", description: "We list the fees on your statement and explain what each one is." },
      { title: "Patient payment plans", description: "Ask how recurring billing and card-on-file payments are charged and stored." },
      { title: "Front-desk checkout", description: "Ask which terminals suit co-pay and balance collection at the front desk." },
      { title: "Cash discount and surcharge programs", description: "Card brand rules and state law apply, and eligibility varies by account." },
    ],
    equipment: [
      { name: "Clover Mini 3", description: "Compact countertop terminal for the front desk." },
      { name: "PAX A920", description: "Portable smart terminal." },
      { name: "Virtual Terminal", description: "Accept payments by phone or payment link." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "See what your practice pays today",
    ctaSubline: "Upload your current processing statement for a free review of the fees on it.",
  },
  "home-services": {
    slug: "home-services",
    industry: "Home Services",
    heroTitle: "Payment Processing Questions for Field Service Businesses",
    heroSubtitle: "On-site payments, invoicing and recurring billing for contractors, plus a statement review of how field and keyed payments are billed.",
    heroImage: verticalHomeServices,
    heroIcon: Truck,
    painPoints: [
      { icon: Smartphone, title: "Taking cards on-site", description: "Ask what mobile terminal or reader options are available and how mobile payments are billed." },
      { icon: Receipt, title: "Invoicing", description: "Ask how invoices and payment links are charged compared with card-present payments." },
      { icon: RefreshCw, title: "Recurring billing", description: "Maintenance plans need automatic billing. Ask how recurring charges are priced." },
      { icon: Lock, title: "Equipment terms", description: "Ask whether equipment is leased, rented or purchased, and what the agreement says about leaving." },
    ],
    solutionPitch: claimText("review.process.summary"),
    solutions: [
      { title: "Mobile payments", description: "Portable terminals and readers allow payment on-site. Connectivity options vary by model." },
      { title: "Invoices and payment links", description: "Ask which invoicing tools are included and how those payments are billed." },
      { title: "Recurring billing", description: "Ask how card-on-file billing is set up and charged." },
      { title: "Agreement terms", description: claimText("equipment.agreement.summary") },
    ],
    equipment: [
      { name: "SwipeSimple Mobile Reader", description: "Reader that pairs with a phone." },
      { name: "Dejavoo QD4", description: "Portable terminal with a built-in printer." },
      { name: "PAX A920", description: "Portable smart terminal." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "See what your business pays today",
    ctaSubline: "Upload your current processing statement for a free review, or book a call to discuss your setup.",
  },
  ecommerce: {
    slug: "ecommerce",
    industry: "E-Commerce",
    heroTitle: "Payment Processing Questions for Online Stores",
    heroSubtitle: "Gateway, platform and recurring-billing questions for online sellers, plus a statement review of what online transactions cost today.",
    heroImage: heroAnalytics,
    heroIcon: Globe,
    painPoints: [
      { icon: Shield, title: "Fraud and chargebacks", description: "Online transactions carry more dispute risk. Ask what fraud tools and dispute support your current setup includes." },
      { icon: ShoppingCart, title: "Checkout and platform", description: "Confirm which platforms and checkout options your gateway supports." },
      { icon: Globe, title: "International payments", description: "Ask whether your current setup accepts international cards and what it charges." },
      { icon: DollarSign, title: "Pricing models at scale", description: "Flat-rate and interchange-plus pricing compare differently as volume and average ticket change. A statement review shows it on your numbers." },
    ],
    solutionPitch: claimText("review.process.summary"),
    solutions: [
      { title: "Gateway and platform fit", description: "Confirm that the gateway works with your shopping platform before choosing it." },
      { title: "Subscription billing", description: "Ask how recurring charges, failed payments and retries are handled." },
      { title: "Dispute support", description: "Ask what tools and support are available when a customer disputes a charge." },
      { title: "Pricing review", description: "We list the fees on your gateway or processing statement and explain what each one is." },
    ],
    equipment: [
      { name: "Payment Gateway", description: "Hosted payment page or embedded checkout." },
      { name: "Virtual Terminal", description: "Web-based terminal for phone and mail orders." },
      { name: "Mobile + Online", description: "Combine an online gateway with a mobile reader for events or pop-ups." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "Selling online? See what you pay today",
    ctaSubline: "Upload your current gateway or processing statement for a free review, or schedule a call to discuss your platform.",
  },
  "cash-discount": {
    slug: "cash-discount",
    industry: "Cash Discount",
    heroTitle: "Cash Discount and Surcharge Programs Have Rules",
    heroSubtitle: "Cash discount (also called dual pricing) and surcharging are different programs. Both are governed by card brand rules and state law, and eligibility varies.",
    heroImage: zeroPercent,
    heroIcon: DollarSign,
    painPoints: [
      { icon: DollarSign, title: "Processing costs", description: "Processing fees are a cost on every card sale. A statement review shows what they are for your business today." },
      { icon: AlertTriangle, title: "Surcharge versus cash discount", description: "Surcharging and cash discounting are different programs with different rules. Getting it wrong can mean fines or account termination." },
      { icon: Users, title: "Customer reaction", description: "Merchants worry about customer pushback. Clear signage and receipts matter, and results vary by business." },
      { icon: FileText, title: "Signage and receipts", description: "Signage at the entrance and point of sale and receipt line items are part of a compliant implementation." },
    ],
    solutionPitch: "Whether a cash discount or surcharge program fits depends on the state, the card mix and the account. A statement review is where to start, and eligibility, underwriting, card brand rules and applicable laws apply.",
    solutions: [
      { title: "How cash discount works", description: "Listed prices reflect the card price and cash customers receive a discount. The program must offer a genuine discount for cash." },
      { title: "Compliance setup", description: "Signage, terminal configuration and receipt line items all need to meet card brand and state requirements." },
      { title: "Costs that remain", description: claimText("program.remaining-costs") },
      { title: "Customer experience", description: "Terminals can display the cash price and card price before the customer pays." },
    ],
    equipment: [
      { name: "Clover Flex 3", description: "Handheld terminal." },
      { name: "Dejavoo QD4", description: "Portable terminal." },
      { name: "PAX A920", description: "Portable smart terminal." },
    ],
    pricing: commonPricing(),
    ctaHeadline: "See whether a program fits your business",
    ctaSubline: "Upload your current statement for a free review of the fees on it and what a program would and would not change.",
    complianceNotes: [
      "Rules differ for cash discount and surcharge programs",
      "Signage must be displayed at the entrance and point of sale",
      "Receipts must show any service fee as a separate line item",
      "The program must offer a genuine discount for cash, not a hidden card penalty",
      "State law may restrict or prohibit surcharging",
      "Confirm eligibility for your state and account before launching",
    ],
  },
  switch: {
    slug: "switch",
    industry: "Switching Processors",
    heroTitle: "Questions to Ask Before Switching Processors",
    heroSubtitle: "A free statement review shows what you pay today. Switching is your decision, and there is no obligation to switch.",
    heroImage: compareRates,
    heroIcon: ArrowLeftRight,
    painPoints: [
      { icon: DollarSign, title: "Not sure what you pay", description: "If your statement has not been reviewed recently, a review shows each fee and what it is." },
      { icon: Lock, title: "Your current agreement", description: "Agreements may include early termination fees, equipment obligations and renewal terms. Read yours before you decide." },
      { icon: Clock, title: "Support", description: "Ask what support your current agreement includes and how to reach it when a terminal goes down." },
      { icon: AlertTriangle, title: "Continuity during a switch", description: "Ask how the change would be staged so you can keep accepting cards. Account approval, equipment and activation are separate steps." },
    ],
    solutionPitch: claimText("timing.staged-process"),
    solutions: [
      { title: "Free statement review", description: "Upload your current statement and we walk you through the fees on it." },
      { title: "Read your agreement", description: "Check your current agreement for termination fees, equipment terms and renewal clauses before deciding." },
      { title: "Staged changeover", description: "Approval, equipment and activation are separate steps, so timing depends on the account." },
      { title: "Your decision", description: "There is no obligation to switch after the review." },
    ],
    equipment: [
      { name: "Your current terminal", description: "Ask whether your existing terminal can work with a different provider." },
      { name: "New equipment", description: claimText("equipment.options.summary") },
      { name: "POS migration", description: "If you use a bundled POS, ask what moving menus, inventory and settings would involve." },
    ],
    pricing: [
      { label: "Statement review", detail: claimText("review.cost.free") },
      { label: "Funding", detail: claimText("funding.availability") },
      { label: "Equipment", detail: claimText("equipment.options.summary") },
      { label: "Agreement", detail: claimText("equipment.agreement.summary") },
    ],
    ctaHeadline: "See what you pay today",
    ctaSubline: "Upload your latest processing statement for a free review. No commitment.",
    complianceNotes: [
      "Eligibility, underwriting, card brand rules and applicable laws apply",
      "Account approval, equipment availability and activation are separate steps",
      "Review the terms of any agreement before signing",
    ],
  },
};

const industryIndex = [
  { slug: "restaurant", label: "Restaurant & Food Service", description: "Tip adjustment, POS compatibility and equipment questions." },
  { slug: "retail", label: "Retail & Brick & Mortar", description: "POS, inventory and card-mix questions." },
  { slug: "healthcare", label: "Healthcare & Medical", description: "Patient payments, payment plans and front-desk terminals." },
  { slug: "home-services", label: "Home Services & Contractors", description: "On-site payments, invoicing and recurring billing." },
  { slug: "ecommerce", label: "E-Commerce & Online", description: "Gateway, platform and dispute-support questions." },
  { slug: "cash-discount", label: "Cash Discount Programs", description: "Rules for cash discount and surcharge programs." },
  { slug: "switch", label: "Switching Processors", description: "Questions to ask before switching, and a free statement review." },
];

export default function SalesOnePager() {
  const { slug } = useParams<{ slug: string }>();
  const data = slug ? salesOnePagerData[slug] : undefined;

  if (!data && slug === "one-pager") {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO
          title="Industry One-Pagers — Liberty Bancard"
          description="Payment processing questions by industry. Choose an industry for a one-pager."
          noindex={true}
        />
        <Navbar />
        <main className="flex-grow public-main-offset">
          <section className="relative overflow-hidden" data-testid="section-onepager-index-hero">
            <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
            <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-18">
              <Badge className="mb-4 bg-white/10 text-white border-white/20" data-testid="badge-sales-internal">Conversation guide</Badge>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-3" data-testid="text-onepager-index-heading">
                Industry One-Pagers
              </h1>
              <p className="text-white/70 max-w-xl">
                Choose an industry to open a one-pager of questions for that merchant segment.
              </p>
            </div>
          </section>
          <section className="bg-background py-12" data-testid="section-onepager-index-grid">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {industryIndex.map((item) => (
                  <Link key={item.slug} href={`/sales/${item.slug}`} data-testid={`link-onepager-${item.slug}`}>
                    <Card className="h-full cursor-pointer hover-elevate transition-all duration-200">
                      <CardContent className="p-5 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground mb-1">{item.label}</p>
                          <p className="text-sm text-muted-foreground leading-snug">{item.description}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-1" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO
          title="Page Not Found"
          description="The requested sales page was not found."
          noindex={true}
        />
        <Navbar />
        <main className="flex-grow public-main-offset flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-not-found-heading">
              Page Not Found
            </h1>
            <p className="text-muted-foreground mb-6" data-testid="text-not-found-message">
              The industry one-pager you're looking for doesn't exist.
            </p>
            <Button data-testid="button-go-home" asChild>
              <Link href="/sales/one-pager">View All One-Pagers</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const HeroIcon = data.heroIcon;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title={`${data.industry} Payment Processing — Sales One-Pager`}
        description={data.heroSubtitle}
        path={`/sales/${data.slug}`}
        noindex={true}
      />
      <Navbar />

      <main className="flex-grow public-main-offset">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0">
            <img
              src={data.heroImage}
              alt={`${data.industry} payment processing solutions`}
              className="w-full h-full object-cover"
              width="1408"
              height="792"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/70 to-black/50" />
          </div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
            <div className="max-w-2xl">
              <Badge variant="secondary" className="mb-4" data-testid="badge-sales-internal">
                Conversation guide
              </Badge>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <HeroIcon className="w-5 h-5 text-white" />
                </div>
                <span className="text-white/70 text-sm font-medium uppercase tracking-wider">
                  {data.industry} Industry
                </span>
              </div>
              <h1
                className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-4"
                data-testid="text-onepager-heading"
              >
                {data.heroTitle}
              </h1>
              <p
                className="text-lg text-white/80 leading-relaxed"
                data-testid="text-onepager-subheading"
              >
                {data.heroSubtitle}
              </p>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-painpoints-heading">
              What to check
            </h2>
            <p className="text-muted-foreground mb-8">
              Questions {data.industry.toLowerCase()} businesses can ask about payment processing.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.painPoints.map((point, i) => {
                const PainIcon = point.icon;
                return (
                  <Card key={i} data-testid={`card-painpoint-${i}`}>
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                          <PainIcon className="w-5 h-5 text-destructive" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-foreground mb-1">{point.title}</h3>
                          <p className="text-sm text-muted-foreground leading-relaxed">{point.description}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-solution-heading">
              How a statement review helps
            </h2>
            <p className="text-muted-foreground mb-8 max-w-3xl leading-relaxed">
              {data.solutionPitch}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.solutions.map((sol, i) => (
                <div key={i} className="flex items-start gap-4" data-testid={`item-solution-${i}`}>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">{sol.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{sol.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-equipment-heading">
              Equipment to ask about
            </h2>
            <p className="text-muted-foreground mb-8">
              Devices commonly used by {data.industry.toLowerCase()} businesses. Availability and terms depend on the account.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {data.equipment.map((eq, i) => (
                <Card key={i} data-testid={`card-equipment-${i}`}>
                  <CardContent className="p-6">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                      <CreditCard className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">{eq.name}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{eq.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-pricing-heading">
              Pricing and agreement questions
            </h2>
            <p className="text-muted-foreground mb-8">
              What to ask about pricing, funding, equipment and the agreement.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.pricing.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 p-4 bg-muted/30 rounded-md"
                  data-testid={`item-pricing-${i}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-sm mb-0.5">{item.label}</h3>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {data.complianceNotes && data.complianceNotes.length > 0 && (
          <section className="py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-compliance-heading">
                Compliance Notes
              </h2>
              <p className="text-muted-foreground mb-8">
                Points to confirm before you decide.
              </p>
              <Card>
                <CardContent className="p-6">
                  <ul className="space-y-3">
                    {data.complianceNotes.map((note, i) => (
                      <li key={i} className="flex items-start gap-3" data-testid={`compliance-${i}`}>
                        <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground">{note}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        <section className="py-20 bg-primary">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-2xl md:text-3xl font-display font-bold text-primary-foreground mb-3"
              data-testid="text-cta-heading"
            >
              {data.ctaHeadline}
            </h2>
            <p className="text-primary-foreground/80 mb-8 leading-relaxed" data-testid="text-cta-subline">
              {data.ctaSubline}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button variant="secondary" className="gap-2" data-testid="button-cta-upload" asChild>
                <Link href="/upload-statement">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Link>
              </Button>
              <Button variant="outline" className="gap-2 bg-white/10 border-white/20 text-white backdrop-blur-sm" asChild>
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="button-cta-call">
                  <Phone className="w-4 h-4" />
                  Book a call
                </a>
              </Button>
            </div>
            <p className="text-primary-foreground/70 text-xs mt-6" data-testid="text-cta-disclaimer">
              No savings are promised without a statement review. Eligibility, underwriting, card brand rules and applicable laws apply.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
