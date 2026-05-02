import { useParams } from "wouter";
import { SEO, getFAQSchema, getBreadcrumbSchema } from "@/components/SEO";
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
  CheckCircle2,
  X,
  BarChart3,
  ShieldCheck,
  Headphones,
  DollarSign,
  Calculator,
  Users,
  Clock,
  Zap,
  Globe,
  CreditCard,
  BadgeCheck,
} from "lucide-react";

const BASE_URL = "https://libertybancard.com";

interface CompetitorData {
  slug: string;
  name: string;
  fullName: string;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroDescription: string;
  comparison: {
    feature: string;
    competitor: string;
    liberty: string;
    advantage: "liberty" | "competitor" | "tie";
  }[];
  competitorPros: string[];
  competitorCons: string[];
  libertyPros: string[];
  whoShouldUseCompetitor: string;
  whoShouldUseLiberty: string;
  savingsExample: {
    monthlyVolume: string;
    competitorCost: string;
    libertyCost: string;
    annualSavings: string;
    mathNote: string;
  };
  faqs: { question: string; answer: string }[];
}

const competitors: Record<string, CompetitorData> = {
  square: {
    slug: "square",
    name: "Square",
    fullName: "Square (Block, Inc.)",
    tagline: "Flat-Rate Simplicity vs. Wholesale Savings",
    metaTitle: "Liberty Bancard vs Square - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Square side by side. See how interchange-plus pricing saves businesses $2,000-$6,000/year over Square's flat-rate processing fees.",
    metaKeywords: "square alternative, square vs liberty bancard, better than square, square payment processing fees, square competitor",
    heroDescription: "Square's 2.6% + $0.10 flat rate is simple but expensive for growing businesses. Liberty Bancard's interchange-plus pricing passes through actual card costs with a small markup, saving most merchants thousands per year.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.6% + $0.10 flat rate", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Early Termination Fee", competitor: "None", liberty: "None", advantage: "tie" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Free Terminal", competitor: "No (hardware purchase)", liberty: "For qualifying merchants*", advantage: "liberty" },
      { feature: "PCI Compliance", competitor: "Included", liberty: "Included", advantage: "tie" },
      { feature: "Chargeback Protection", competitor: "Basic", liberty: "Full support + guidance", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Self-service", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Easy self-service signup process",
      "No monthly fee on basic plan",
      "Built-in POS software and hardware ecosystem",
      "Good for very small or occasional sellers",
      "Simple, predictable flat-rate pricing",
    ],
    competitorCons: [
      "2.6% + $0.10 is expensive at higher volumes",
      "No interchange passthrough means you overpay on debit cards",
      "No dedicated account representative",
      "Account stability issues reported by merchants",
      "Limited support for high-volume businesses",
      "Hardware must be purchased upfront",
    ],
    libertyPros: [
      "Interchange-plus pricing saves money at $5K+/month volume",
      "Dedicated human support who knows your business",
      "Free statement review shows exact savings before switching",
      "No long-term contracts or early termination fees",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "Guided onboarding with go-live support",
    ],
    whoShouldUseCompetitor: "Square is a reasonable choice for micro-businesses processing under $3,000/month, occasional sellers at farmers markets or pop-up events, and businesses that want an all-in-one POS without separate processing. If simplicity matters more than cost optimization, Square works.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for businesses processing $5,000+/month who want to stop overpaying on flat-rate fees. If you want transparent pricing, real human support, and a statement-based analysis showing your exact savings, Liberty Bancard delivers.",
    savingsExample: {
      monthlyVolume: "$25,000/month",
      competitorCost: "$675/month",
      libertyCost: "$475/month*",
      annualSavings: "$2,400*",
      mathNote: "Square: 2.6% × $25,000 = $650 + $0.10 × ~250 txn = $25 → $675/mo\nLiberty: avg interchange ~1.70% + 0.20% markup × $25,000 + $0.07 × ~250 txn → ~$475/mo*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Square?", answer: "For businesses processing over $5,000/month, Liberty Bancard's interchange-plus pricing typically saves $2,000-$6,000 per year compared to Square's flat 2.6% + $0.10 rate. Square's flat rate overcharges on debit cards and lower-cost card types. Liberty Bancard passes through actual interchange costs with a small, transparent markup." },
      { question: "Can I switch from Square to Liberty Bancard easily?", answer: "Yes. Liberty Bancard handles the transition with guided onboarding. In most cases, you can be processing within 48 hours. Upload your Square statement and we'll show you a side-by-side cost comparison before you make any decisions." },
      { question: "Does Liberty Bancard have a POS system like Square?", answer: "Liberty Bancard partners with compatible POS systems so you get the features you need without being locked into expensive processing rates. We help you find the right POS match for your business type." },
      { question: "Why is Square more expensive than Liberty Bancard?", answer: "Square uses flat-rate pricing that charges the same percentage on every transaction. This means you overpay significantly on debit cards (which have much lower interchange costs) and other lower-cost card types. Liberty Bancard passes through the actual card network cost and adds a small markup, which saves money on the majority of transactions." },
      { question: "Does Liberty Bancard charge monthly fees?", answer: "Liberty Bancard's monthly fees range from $0 to $9.95 depending on your plan. Even with a monthly fee, the savings from interchange-plus pricing far exceed the cost for most businesses processing over $5,000/month. Square has no monthly fee but its higher per-transaction rate costs more overall." },
    ],
  },
  stripe: {
    slug: "stripe",
    name: "Stripe",
    fullName: "Stripe, Inc.",
    tagline: "Developer-First vs. Business-First Processing",
    metaTitle: "Liberty Bancard vs Stripe - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Stripe side by side. See how businesses save $3,000-$8,000/year switching from Stripe's 2.9% + $0.30 to interchange-plus pricing.",
    metaKeywords: "stripe alternative, stripe vs liberty bancard, better than stripe, stripe processing fees, stripe competitor",
    heroDescription: "Stripe's 2.9% + $0.30 online rate is one of the most expensive flat-rate options available. Liberty Bancard's interchange-plus pricing delivers significant savings for businesses processing meaningful volume.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.9% + $0.30 flat rate", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Early Termination Fee", competitor: "None", liberty: "None", advantage: "tie" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No (email support)", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "In-Person Payments", competitor: "Limited (Stripe Terminal)", liberty: "Full terminal support", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Developer API", competitor: "Extensive", liberty: "Gateway integrations", advantage: "competitor" },
      { feature: "Chargeback Protection", competitor: "Radar (extra cost)", liberty: "Full support included", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Self-service docs", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Excellent developer documentation and APIs",
      "No monthly fee",
      "Strong for SaaS and marketplace platforms",
      "Global payment support in 40+ countries",
      "Advanced fraud detection (Stripe Radar)",
    ],
    competitorCons: [
      "2.9% + $0.30 is very expensive for in-person and card-present transactions",
      "No interchange passthrough pricing available by default",
      "No dedicated account representative for most merchants",
      "Limited in-person payment capabilities",
      "Support is primarily email-based",
      "Not designed for traditional retail or restaurant businesses",
    ],
    libertyPros: [
      "Interchange-plus pricing dramatically reduces costs",
      "Dedicated human support who answers the phone",
      "Free statement review shows exact savings",
      "Purpose-built for in-person and card-present businesses",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "No long-term contracts",
    ],
    whoShouldUseCompetitor: "Stripe is a strong choice for SaaS companies, marketplaces, and developer-heavy teams building custom payment flows. If you need global payments, subscription billing APIs, or complex platform monetization, Stripe's developer tools are hard to beat.",
    whoShouldUseLiberty: "Liberty Bancard is ideal for brick-and-mortar businesses, service providers, and any company processing in-person payments. If you want transparent pricing, real human support, and cost savings that show up on your bottom line, Liberty Bancard is the clear choice.",
    savingsExample: {
      monthlyVolume: "$30,000/month",
      competitorCost: "$960/month",
      libertyCost: "$540/month*",
      annualSavings: "$5,040*",
      mathNote: "Stripe: 2.9% × $30,000 = $870 + $0.30 × ~300 txn = $90 → $960/mo\nLiberty: avg interchange ~1.60% + 0.20% markup × $30,000 + $0.07 × ~300 txn → ~$540/mo*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Stripe?", answer: "For in-person businesses processing over $5,000/month, Liberty Bancard typically saves $3,000-$8,000 per year compared to Stripe's 2.9% + $0.30. Stripe excels at online-only and developer-centric use cases, but its pricing is expensive for card-present transactions." },
      { question: "Can I switch from Stripe to Liberty Bancard?", answer: "Yes. If you process in-person payments, Liberty Bancard can get you set up quickly with guided onboarding. Upload your Stripe processing statement and we'll show you a detailed cost comparison before you commit to anything." },
      { question: "Does Liberty Bancard support online payments?", answer: "Liberty Bancard partners with payment gateways that support online transactions. If e-commerce is part of your business, include it in your statement review request and we'll recommend the best-fit setup for both in-person and online payments." },
      { question: "Why is Stripe so expensive for in-person payments?", answer: "Stripe was built primarily for online transactions. Its 2.9% + $0.30 rate doesn't distinguish between expensive card types and cheap debit cards. For in-person transactions where interchange costs are lower, you're overpaying significantly. Liberty Bancard passes through actual interchange costs, which are much lower for card-present transactions." },
      { question: "Does Liberty Bancard have an API like Stripe?", answer: "Liberty Bancard focuses on payment processing excellence rather than developer tools. We integrate with popular POS systems and payment gateways. If you need custom API integrations for a software platform, Stripe may be a better fit. For businesses focused on accepting payments efficiently, Liberty Bancard delivers better value." },
    ],
  },
  clover: {
    slug: "clover",
    name: "Clover",
    fullName: "Clover Network (Fiserv)",
    tagline: "Bundled POS vs. Best-in-Class Processing",
    metaTitle: "Liberty Bancard vs Clover - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Clover POS. Avoid long-term contracts and high processing fees. See how interchange-plus pricing saves $2,500-$5,000/year.",
    metaKeywords: "clover alternative, clover vs liberty bancard, better than clover, clover processing fees, clover competitor, clover contract",
    heroDescription: "Clover bundles POS hardware with processing, but that convenience comes with long-term contracts, higher rates, and equipment you may not own. Liberty Bancard gives you transparent pricing without the lock-in.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.3-3.5% + $0.10 (varies)", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$14.95+", liberty: "$0 - $9.95", advantage: "liberty" },
      { feature: "Contract Length", competitor: "36-month typical", liberty: "No long-term contract", advantage: "liberty" },
      { feature: "Early Termination Fee", competitor: "$250-$500", liberty: "None", advantage: "liberty" },
      { feature: "Equipment Ownership", competitor: "Often leased, not owned", liberty: "Free terminal for qualifying*", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "Varies by reseller", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Built-in POS Software", competitor: "Yes (bundled)", liberty: "POS partnerships", advantage: "competitor" },
      { feature: "Cash Discount Program", competitor: "Limited", liberty: "Available*", advantage: "liberty" },
      { feature: "PCI Compliance", competitor: "Extra fee common", liberty: "Included", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Varies", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "All-in-one POS hardware and software",
      "App marketplace for add-on features",
      "Familiar brand with wide retail presence",
      "Built-in inventory and employee management",
      "Multiple hardware form factors available",
    ],
    competitorCons: [
      "Long-term contracts (36 months) are standard",
      "Early termination fees of $250-$500",
      "Equipment is often leased, not owned",
      "Processing rates vary widely by reseller",
      "PCI compliance fees commonly added",
      "Monthly software fees start at $14.95 and increase",
      "Rate increases after promotional periods",
    ],
    libertyPros: [
      "No long-term contracts or termination fees",
      "Interchange-plus pricing is transparent and lower",
      "Free terminal for qualifying merchants*",
      "PCI compliance included at no extra charge",
      "Dedicated support rep who knows your business",
      "Free statement review before switching",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "You own your equipment and your data",
    ],
    whoShouldUseCompetitor: "Clover can work for businesses that want a fully integrated POS ecosystem and don't mind being locked into a multi-year contract. If having one vendor for hardware, software, and processing is your top priority and you're comfortable with the contract terms, Clover is an option.",
    whoShouldUseLiberty: "Liberty Bancard is the right choice if you want freedom from long-term contracts, transparent pricing, and equipment you actually own. If you've been locked into a Clover contract and are tired of rate increases and add-on fees, switching to Liberty Bancard can save thousands.",
    savingsExample: {
      monthlyVolume: "$20,000/month",
      competitorCost: "$560/month",
      libertyCost: "$360/month*",
      annualSavings: "$2,400*",
      mathNote: "Clover: ~2.6% × $20,000 = $520 + $14.95 software fee + misc = ~$560/mo\nLiberty: avg interchange ~1.60% + 0.20% markup × $20,000 + $0.07 × ~400 txn → ~$360/mo*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Clover?", answer: "For most businesses, yes. Liberty Bancard offers lower interchange-plus pricing without the long-term contracts, equipment leases, and add-on fees that Clover is known for. Businesses typically save $2,500-$5,000 per year by switching from Clover to Liberty Bancard." },
      { question: "Can I get out of my Clover contract?", answer: "If your Clover contract is ending soon, Liberty Bancard can help you transition smoothly. We'll review your current statement, show you exact savings, and handle the onboarding so the switch is seamless. If you're mid-contract, we can help you understand the termination costs and whether switching still saves money." },
      { question: "Do I need to buy new equipment to switch from Clover?", answer: "Liberty Bancard provides free terminals for qualifying merchants. We'll help you find equipment that matches your business needs without the leasing costs that Clover typically requires." },
      { question: "Why does Clover charge PCI compliance fees?", answer: "Many Clover resellers add PCI compliance fees as an additional revenue stream, typically $79-$129/year. Liberty Bancard includes PCI compliance at no additional charge because we believe it's a basic requirement of payment processing, not an upsell opportunity." },
      { question: "Can Liberty Bancard match Clover's POS features?", answer: "Liberty Bancard partners with compatible POS systems that offer similar features to Clover including inventory management, employee tools, and reporting. The difference is you get those features with transparent interchange-plus pricing instead of inflated bundled rates." },
    ],
  },
  toast: {
    slug: "toast",
    name: "Toast",
    fullName: "Toast, Inc.",
    tagline: "Restaurant POS vs. Flexible Payment Processing",
    metaTitle: "Liberty Bancard vs Toast - Restaurant Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Toast for restaurant payment processing. See how restaurants save $3,000-$7,000/year by switching from Toast's bundled pricing.",
    metaKeywords: "toast alternative, toast vs liberty bancard, better than toast, toast processing fees, toast competitor, restaurant payment processing",
    heroDescription: "Toast combines restaurant POS with payment processing, but their 2.49-3.69% rates and long-term contracts cost restaurants thousands more than necessary. Liberty Bancard offers restaurant-friendly pricing without the lock-in.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.49-3.69% + $0.15", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0-$69+ (tiered plans)", liberty: "$0 - $9.95", advantage: "liberty" },
      { feature: "Contract Length", competitor: "24-36 months", liberty: "No long-term contract", advantage: "liberty" },
      { feature: "Early Termination Fee", competitor: "Up to $10,000+", liberty: "None", advantage: "liberty" },
      { feature: "Equipment Ownership", competitor: "Financed, not always owned", liberty: "Free terminal for qualifying*", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "Limited", liberty: "Yes", advantage: "liberty" },
      { feature: "Restaurant POS Features", competitor: "Full restaurant POS", liberty: "POS partnerships", advantage: "competitor" },
      { feature: "Online Ordering", competitor: "Built-in (with fees)", liberty: "Integration partners", advantage: "competitor" },
      { feature: "Cash Discount Program", competitor: "Limited", liberty: "Available*", advantage: "liberty" },
      { feature: "Processing Lock-in", competitor: "Must use Toast processing", liberty: "No lock-in", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
    ],
    competitorPros: [
      "Purpose-built restaurant POS system",
      "Online ordering and delivery integration",
      "Kitchen display system integration",
      "Restaurant-specific reporting and analytics",
      "Payroll and team management features",
    ],
    competitorCons: [
      "Processing rates of 2.49-3.69% are significantly above interchange",
      "Long-term contracts (24-36 months) with heavy penalties",
      "Early termination fees can exceed $10,000",
      "Equipment financing locks you in further",
      "Must use Toast processing (no flexibility)",
      "Monthly software fees increase as you add features",
      "Rate increases after promotional period",
    ],
    libertyPros: [
      "Interchange-plus pricing saves restaurants thousands",
      "No long-term contracts or termination penalties",
      "Dedicated support rep who understands restaurant operations",
      "Liberty Zero™ program popular with restaurant owners (pay $0 to process)*",
      "Free terminal for qualifying merchants*",
      "Free statement review before committing",
      "Next-day funding keeps cash flow healthy*",
      "Freedom to choose your own POS system",
    ],
    whoShouldUseCompetitor: "Toast makes sense for new restaurants that want a complete, integrated system and are comfortable with long-term contracts and higher processing rates. If you need online ordering, kitchen displays, and payroll in one platform and cost isn't the primary concern, Toast is an option.",
    whoShouldUseLiberty: "Liberty Bancard is ideal for restaurants that want to keep more of their revenue. If you're processing $10,000+/month and tired of Toast's high rates and contract lock-in, switching to interchange-plus pricing can save your restaurant $3,000-$7,000 per year.",
    savingsExample: {
      monthlyVolume: "$35,000/month",
      competitorCost: "$1,085/month",
      libertyCost: "$630/month*",
      annualSavings: "$5,460*",
      mathNote: "Toast: ~2.99% × $35,000 = $1,047 + $0.15 × ~250 txn = $38 → ~$1,085/mo\nLiberty: avg interchange ~1.60% + 0.20% markup × $35,000 + $0.07 × ~250 txn → ~$630/mo*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Toast for restaurants?", answer: "For payment processing costs, yes. Liberty Bancard's interchange-plus pricing saves most restaurants $3,000-$7,000 per year compared to Toast's 2.49-3.69% rates. Toast offers a full restaurant POS, but you pay a premium for processing that's locked to their platform." },
      { question: "Can I keep my POS system if I switch from Toast?", answer: "Toast requires you to use their processing, so switching processors means transitioning your POS as well. Liberty Bancard partners with restaurant-compatible POS systems and handles the migration with guided onboarding to minimize disruption." },
      { question: "How much does Toast's early termination fee cost?", answer: "Toast's early termination fees can exceed $10,000 depending on your contract terms and remaining equipment financing. We recommend reviewing your contract before switching and can help you calculate whether the savings from Liberty Bancard's lower rates offset the termination cost." },
      { question: "Does Liberty Bancard support restaurants specifically?", answer: "Yes. Liberty Bancard serves many restaurant merchants with features like cash discount programs, next-day funding for cash flow management, and dedicated support reps who understand restaurant operations. We partner with restaurant POS systems for a complete solution." },
      { question: "What POS systems work with Liberty Bancard?", answer: "Liberty Bancard integrates with a variety of POS systems suitable for restaurants including those that support table management, menu customization, and kitchen printing. During your statement review, we'll recommend POS options that fit your restaurant's needs." },
    ],
  },
  paypal: {
    slug: "paypal",
    name: "PayPal",
    fullName: "PayPal Holdings, Inc.",
    tagline: "Consumer Brand vs. Merchant-First Processing",
    metaTitle: "Liberty Bancard vs PayPal - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs PayPal for business payment processing. See how merchants save $2,000-$5,000/year switching from PayPal's flat-rate fees.",
    metaKeywords: "paypal alternative, paypal vs liberty bancard, better than paypal, paypal processing fees, paypal business competitor",
    heroDescription: "PayPal is great for consumers, but its 2.99% + $0.49 in-person rate and account hold policies make it expensive and risky for growing businesses. Liberty Bancard offers merchant-focused pricing and support.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.99% + $0.49 in-person", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Online Rate", competitor: "3.49% + $0.49", liberty: "Interchange + markup", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0 (or $5-$30 for Zettle)", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Account Stability", competitor: "Holds and freezes common", liberty: "Stable merchant account", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Chargeback Support", competitor: "Basic (Seller Protection)", liberty: "Full support + guidance", advantage: "liberty" },
      { feature: "Consumer Brand Recognition", competitor: "Very high", liberty: "Merchant-focused", advantage: "competitor" },
      { feature: "Onboarding Support", competitor: "Self-service", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Strong consumer brand recognition",
      "Easy self-service setup",
      "PayPal checkout increases conversion for some online stores",
      "Buy Now Pay Later options for customers",
      "International payment support",
    ],
    competitorCons: [
      "2.99% + $0.49 in-person rate is one of the highest",
      "Account holds and fund freezes are common complaints",
      "No dedicated support for merchant accounts",
      "No interchange passthrough pricing",
      "Per-transaction fixed fee ($0.49) is very high",
      "Limited in-person payment hardware options",
      "Not designed for high-volume brick-and-mortar businesses",
    ],
    libertyPros: [
      "Interchange-plus pricing saves significantly on every transaction",
      "Stable merchant account without surprise holds",
      "Dedicated human support who knows your business",
      "Free statement review shows exact savings",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "Purpose-built for businesses, not consumers",
    ],
    whoShouldUseCompetitor: "PayPal is reasonable for very small online sellers, eBay merchants, and businesses where PayPal checkout is expected by customers. If brand recognition at checkout matters more than processing costs, PayPal has value as a supplementary payment method.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for any business processing $5,000+/month, especially in-person. If you're tired of PayPal's high fees, account holds, and lack of support, switching to a dedicated merchant account with transparent pricing is a significant upgrade.",
    savingsExample: {
      monthlyVolume: "$20,000/month",
      competitorCost: "$696/month",
      libertyCost: "$380/month*",
      annualSavings: "$3,792*",
      mathNote: "PayPal: 2.99% × $20,000 = $598 + $0.49 × ~200 txn = $98 → ~$696/mo\nLiberty: avg interchange ~1.65% + 0.20% markup × $20,000 + $0.07 × ~200 txn → ~$380/mo*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than PayPal for businesses?", answer: "For in-person businesses processing over $5,000/month, Liberty Bancard is significantly better. PayPal's 2.99% + $0.49 in-person rate is one of the highest in the industry, and their account hold policies create cash flow risk. Liberty Bancard offers interchange-plus pricing, stable accounts, and dedicated support." },
      { question: "Why do PayPal accounts get frozen?", answer: "PayPal uses automated risk algorithms that can freeze funds for 21+ days without warning. Because PayPal serves both consumers and businesses on the same platform, merchant accounts don't get the same stability as a dedicated merchant services provider like Liberty Bancard." },
      { question: "Can I still accept PayPal if I switch to Liberty Bancard?", answer: "Yes. You can use Liberty Bancard as your primary payment processor for card transactions while still offering PayPal as an alternative checkout option for customers who prefer it. Many businesses use both." },
      { question: "How much can I save switching from PayPal?", answer: "Most businesses processing $20,000+/month save $2,000-$5,000 per year by switching from PayPal to Liberty Bancard's interchange-plus pricing. Upload your PayPal statement and we'll show you a detailed breakdown of your exact savings." },
      { question: "Does Liberty Bancard work for online businesses?", answer: "Liberty Bancard supports both in-person and online payment processing through gateway partnerships. If you process online transactions, include that information when you submit your statement for review and we'll recommend the right setup." },
    ],
  },
};

function getAdvantageIcon(advantage: "liberty" | "competitor" | "tie") {
  if (advantage === "liberty") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (advantage === "competitor") return <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0" />;
  return <span className="w-4 h-4 shrink-0 text-center text-muted-foreground">=</span>;
}

function getAdvantageLabel(advantage: "liberty" | "competitor" | "tie", competitorName: string) {
  if (advantage === "liberty") return "Liberty Bancard";
  if (advantage === "competitor") return competitorName;
  return "Tie";
}

export default function CompareVs() {
  const params = useParams<{ competitor: string }>();
  const containerRef = useScrollReveal();
  const data = competitors[params.competitor || ""];

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-28 flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-not-found">Comparison Not Found</h1>
            <p className="text-muted-foreground mb-6">We don't have a comparison page for that processor yet.</p>
            <Link href="/compare-rates" data-testid="link-back-compare">
              <Button>View All Comparisons</Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const faqSchema = getFAQSchema(data.faqs);
  const breadcrumbSchema = getBreadcrumbSchema([
    { name: "Compare", path: "/compare-rates" },
    { name: `vs ${data.name}`, path: `/compare/${data.slug}` },
  ]);

  const libertyWins = data.comparison.filter(c => c.advantage === "liberty").length;
  const competitorWins = data.comparison.filter(c => c.advantage === "competitor").length;
  const ties = data.comparison.filter(c => c.advantage === "tie").length;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title={data.metaTitle}
        description={data.metaDescription}
        path={`/compare/${data.slug}`}
        keywords={data.metaKeywords}
        breadcrumbs={[
          { name: "Compare", path: "/compare-rates" },
          { name: `vs ${data.name}`, path: `/compare/${data.slug}` },
        ]}
        structuredData={[faqSchema, breadcrumbSchema]}
      />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-vs-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/90 text-sm font-medium px-3 py-1.5 rounded-md mb-6 border border-white/10" data-testid="text-vs-badge">
                <BarChart3 className="w-4 h-4" />
                Head-to-Head Comparison
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-4" data-testid="text-vs-heading">
                Liberty Bancard vs {data.name}
              </h1>
              <p className="text-base text-white/70 mb-2" data-testid="text-vs-tagline">
                {data.tagline}
              </p>
              <p className="text-sm text-white/60 mb-6 max-w-2xl mx-auto" data-testid="text-vs-description">
                {data.heroDescription}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
                <Link href="/upload-statement" data-testid="link-vs-hero-upload">
                  <Button size="lg" className="gap-2 bg-white text-primary border-white">
                    <Upload className="w-4 h-4" />
                    Upload Statement - Free Review
                  </Button>
                </Link>
                <Link href="/savings-calculator" data-testid="link-vs-hero-calc">
                  <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                    <Calculator className="w-4 h-4" />
                    Try Savings Calculator
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> PCI DSS Level 1 Certified</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> Registered ISO/MSP</span>
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> 5,000+ Merchants Served</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> $2B+ Annual Volume</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> 10+ Years in Payments</span>
            </div>
          </div>
        </div>

        <section className="bg-background py-16" data-testid="section-vs-comparison-table">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-vs-table-heading">
              Feature-by-Feature Comparison
            </h2>
            <p className="text-center text-muted-foreground mb-8 text-sm">
              Liberty Bancard leads in {libertyWins} of {data.comparison.length} categories.
              {competitorWins > 0 && ` ${data.name} leads in ${competitorWins}.`}
              {ties > 0 && ` ${ties} tied.`}
            </p>
            <div className="reveal overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[600px] border-collapse" data-testid="table-vs-comparison">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border w-44">Feature</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">{data.name}</th>
                    <th className="text-center text-xs font-semibold text-primary uppercase tracking-wider p-3 border-b border-border bg-primary/5">Liberty Bancard</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border w-32">Advantage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.comparison.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : ""} data-testid={`row-vs-${i}`}>
                      <td className="text-sm font-medium text-foreground p-3 border-b border-border/50">{row.feature}</td>
                      <td className="text-center text-xs text-foreground p-3 border-b border-border/50">{row.competitor}</td>
                      <td className="text-center text-xs text-foreground p-3 border-b border-border/50 bg-primary/5 font-medium">{row.liberty}</td>
                      <td className="text-center p-3 border-b border-border/50">
                        <div className="flex items-center justify-center gap-1.5">
                          {getAdvantageIcon(row.advantage)}
                          <span className="text-xs text-muted-foreground">{getAdvantageLabel(row.advantage, data.name)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-4">
              *Eligibility, underwriting, card brand rules, and applicable laws apply. Rates and features based on publicly available information and may vary.
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-vs-savings">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-savings-heading">
              Estimated Savings: {data.name} vs Liberty Bancard
            </h2>
            <Card className="reveal" data-testid="card-savings-example">
              <CardContent className="p-6 md:p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-center mb-6">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Monthly Volume</p>
                    <p className="text-xl font-display font-bold text-foreground" data-testid="text-savings-volume">{data.savingsExample.monthlyVolume}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{data.name} Cost</p>
                    <p className="text-xl font-display font-bold text-foreground" data-testid="text-savings-competitor">{data.savingsExample.competitorCost}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Liberty Bancard Cost</p>
                    <p className="text-xl font-display font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-savings-liberty">{data.savingsExample.libertyCost}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Est. Annual Savings</p>
                    <p className="text-xl font-display font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-savings-annual">{data.savingsExample.annualSavings}</p>
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">How we calculate this</p>
                  <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed bg-muted/40 rounded px-3 py-2" data-testid="text-savings-math">{data.savingsExample.mathNote}</pre>
                </div>
              </CardContent>
            </Card>
            <p className="text-[10px] text-muted-foreground text-center mt-4">
              *Illustrative estimate based on typical card mix and interchange-plus pricing. Actual rate depends on card mix, transaction types, and volume — upload a statement for your exact number. No savings claims without a statement review.
            </p>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-vs-pros-cons">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-pros-cons-heading">
              Pros & Cons
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card data-testid="card-competitor-pros-cons">
                <CardContent className="p-6">
                  <h3 className="font-display font-bold text-foreground text-lg mb-4">{data.name}</h3>
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2">Pros</p>
                    <ul className="space-y-2">
                      {data.competitorPros.map((pro, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-competitor-pro-${i}`}>
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-500 dark:text-red-400 mb-2">Cons</p>
                    <ul className="space-y-2">
                      {data.competitorCons.map((con, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-competitor-con-${i}`}>
                          <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                          {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-liberty-pros">
                <CardContent className="p-6">
                  <h3 className="font-display font-bold text-foreground text-lg mb-4">Liberty Bancard</h3>
                  <div>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2">Advantages</p>
                    <ul className="space-y-2">
                      {data.libertyPros.map((pro, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-liberty-pro-${i}`}>
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-vs-who-should-use">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-who-heading">
              Who Should Use Which?
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card data-testid="card-who-competitor">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                      <Globe className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <h3 className="font-display font-bold text-foreground">Use {data.name} If...</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-who-competitor">{data.whoShouldUseCompetitor}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-who-liberty">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-display font-bold text-foreground">Use Liberty Bancard If...</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-who-liberty">{data.whoShouldUseLiberty}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-vs-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-faq-heading">
              {data.name} vs Liberty Bancard FAQ
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-vs-faq">
              {data.faqs.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`vs-faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`vs-faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-16" data-testid="section-vs-final-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-vs-cta-heading">
              Ready to See How Much You'd Save vs {data.name}?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Upload your {data.name} processing statement for a free, line-by-line comparison. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-vs-cta-upload">
                <Button size="lg" className="gap-2 bg-white text-primary border-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Button>
              </Link>
              <Link href="/compare-rates" data-testid="link-vs-cta-all">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  <BarChart3 className="w-4 h-4" />
                  View All Comparisons
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export { competitors };
