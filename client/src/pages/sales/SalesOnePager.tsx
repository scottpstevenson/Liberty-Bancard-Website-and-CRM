import { useParams } from "wouter";
import { Link } from "wouter";
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
  Zap,
  CreditCard,
  UtensilsCrossed,
  Store,
  Stethoscope,
  AlertTriangle,
  Smartphone,
  Receipt,
  HeartPulse,
  Users,
  TrendingUp,
  Globe,
  ShoppingCart,
  RefreshCw,
  Lock,
  Truck,
  FileText,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

import verticalRestaurant from "@assets/images/vertical-restaurant.jpg";
import verticalRetail from "@assets/images/vertical-retail.jpg";
import verticalMedical from "@assets/images/vertical-medical.jpg";
import verticalHomeServices from "@assets/images/vertical-home-services.jpg";
import heroAnalytics from "@assets/images/hero-analytics.jpg";
import zeroPercent from "@assets/images/zero-percent.jpg";
import compareRates from "@assets/images/compare-rates.jpg";

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

interface SuccessStory {
  industry: string;
  result: string;
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
  successStories?: SuccessStory[];
  complianceNotes?: string[];
}

export const salesOnePagerData: Record<string, OnePagerData> = {
  restaurant: {
    slug: "restaurant",
    industry: "Restaurant",
    heroTitle: "Payment Processing Built for Restaurants",
    heroSubtitle: "Tableside payments, tip adjustment optimization, kitchen integration, and POS bundles designed to keep your margins healthy — especially for high-tip businesses.",
    heroImage: verticalRestaurant,
    heroIcon: UtensilsCrossed,
    painPoints: [
      {
        icon: DollarSign,
        title: "Tip adjustments inflating your rate",
        description: "Every tip adjustment triggers a separate authorization, silently increasing your interchange costs well beyond your quoted rate.",
      },
      {
        icon: Clock,
        title: "Slow deposits hurting cash flow",
        description: "Waiting 3-5 days for deposits means you're using working capital to cover food costs and payroll instead of growing your business.",
      },
      {
        icon: AlertTriangle,
        title: "POS lock-in with hidden markups",
        description: "Many POS companies bundle processing at inflated rates, making it nearly impossible to see what you're actually paying per transaction.",
      },
      {
        icon: Phone,
        title: "No support during peak hours",
        description: "When your terminal goes down during Friday dinner rush, you need someone who answers immediately — not a call center queue.",
      },
    ],
    solutionPitch: "Liberty Bancard understands the restaurant business. We optimize tip handling, offer next-day funding, and provide POS-agnostic integration so you're never locked in. Cash discount programs can eliminate your processing fees entirely on high-tip transactions.",
    solutions: [
      {
        title: "Tableside Payment Terminals",
        description: "Clover Flex 3 and wireless terminals let servers process payments tableside — faster turns, better tips, and reduced walkouts.",
      },
      {
        title: "Tip Adjustment Optimization",
        description: "We configure your terminal to prompt for tip at the point of sale, reducing interchange costs compared to post-authorization adjustments.",
      },
      {
        title: "Kitchen & POS Integration",
        description: "Work with your preferred POS system without being locked into overpriced bundled processing. We integrate with Toast, Clover, and more.",
      },
      {
        title: "Cash Discount for High-Tip Businesses",
        description: "Compliant cash discount programs let you pass processing costs to card users. Especially effective for restaurants with high average tips.",
      },
    ],
    equipment: [
      {
        name: "Clover Flex 3",
        description: "Handheld, wireless, built-in printer. Perfect for tableside service and line-busting.",
      },
      {
        name: "Clover Station Duo",
        description: "Full POS with dual screens, cash drawer, and complete restaurant management suite.",
      },
      {
        name: "Dejavoo QD4",
        description: "Rugged smart terminal with all-day battery. Great for food trucks and outdoor dining.",
      },
    ],
    pricing: [
      { label: "Interchange Plus", detail: "Actual card cost + small fixed markup. Most transparent option." },
      { label: "Cash Discount / Dual Pricing", detail: "Eliminate up to 100% of processing fees. Card users pay a small service fee." },
      { label: "Next-Day Funding", detail: "Qualified restaurants receive deposits by the next business day." },
      { label: "No Equipment Leases", detail: "Own your terminal outright. No inflated lease costs." },
    ],
    ctaHeadline: "See How Much Your Restaurant Is Overpaying",
    ctaSubline: "Upload your current processing statement for a free, line-by-line analysis. We'll show you exactly where you're losing money.",
  },
  retail: {
    slug: "retail",
    industry: "Retail",
    heroTitle: "Payment Processing Designed for Retail",
    heroSubtitle: "Inventory POS integration, barcode scanning, e-commerce sync, next-day funding, and interchange-plus savings that give you back your margins.",
    heroImage: verticalRetail,
    heroIcon: Store,
    painPoints: [
      {
        icon: DollarSign,
        title: "Flat-rate pricing eating your margins",
        description: "Flat-rate processors charge the same percentage whether a customer uses a debit card or a premium rewards card — you overpay on every debit transaction.",
      },
      {
        icon: AlertTriangle,
        title: "Equipment leases costing thousands",
        description: "Terminal leases can cost 3-5x the purchase price over the lease term, and you don't even own the equipment at the end.",
      },
      {
        icon: Clock,
        title: "No e-commerce sync",
        description: "Running separate systems for in-store and online sales creates inventory mismatches, reconciliation headaches, and double the work.",
      },
      {
        icon: Shield,
        title: "Chargebacks with no guidance",
        description: "When a customer disputes a charge, you need a partner who helps you respond effectively — not one who just deducts from your account.",
      },
    ],
    solutionPitch: "Liberty Bancard gives retail businesses interchange-plus pricing that saves 20-40% over flat-rate processors. We pair that with modern POS terminals that handle barcode scanning, inventory tracking, and e-commerce integration — all without equipment leases.",
    solutions: [
      {
        title: "Inventory POS Integration",
        description: "Clover Station Duo and Mini 3 provide full inventory management, barcode scanning, and real-time stock tracking across locations.",
      },
      {
        title: "Barcode Scanning & Catalog",
        description: "Built-in cameras and scanners on Clover devices let you manage your product catalog, track SKUs, and speed up checkout.",
      },
      {
        title: "E-Commerce Sync",
        description: "Unified reporting across in-store and online sales. One dashboard, one inventory system, one processor.",
      },
      {
        title: "Interchange-Plus Savings",
        description: "Pay the actual card network cost plus a small, transparent markup. Save significantly on debit and standard credit card transactions.",
      },
    ],
    equipment: [
      {
        name: "Clover Station Duo",
        description: "Full register experience with dual screens, cash drawer, receipt printer, and barcode scanner.",
      },
      {
        name: "Clover Mini 3",
        description: "Compact countertop POS with 8-inch touchscreen. Ideal for smaller retail spaces.",
      },
      {
        name: "SwipeSimple",
        description: "Mobile reader for pop-up shops, markets, and mobile retail. Works with any smartphone.",
      },
    ],
    pricing: [
      { label: "Interchange Plus", detail: "Save 20-40% vs flat-rate processors like Square or Stripe." },
      { label: "Next-Day Funding", detail: "Deposits available by the next business day for qualified merchants." },
      { label: "No Equipment Leases", detail: "Purchase your terminal outright. Own it from day one." },
      { label: "Multi-Location Pricing", detail: "Consistent pricing and consolidated reporting across all stores." },
    ],
    ctaHeadline: "Find Out What You're Really Paying",
    ctaSubline: "Upload your current processing statement and we'll show you a side-by-side comparison with interchange-plus pricing.",
  },
  healthcare: {
    slug: "healthcare",
    industry: "Healthcare",
    heroTitle: "Payment Processing for Healthcare Providers",
    heroSubtitle: "HIPAA-aware compliance, patient payment plans, co-pay collection, FSA/HSA acceptance, and secure terminals built for medical and dental practices.",
    heroImage: verticalMedical,
    heroIcon: Stethoscope,
    painPoints: [
      {
        icon: DollarSign,
        title: "High per-transaction costs on large balances",
        description: "Patient payments are often larger amounts. Your processor's per-transaction fees may be costing you significantly more on these higher-dollar charges.",
      },
      {
        icon: Shield,
        title: "Compliance concerns with payment data",
        description: "Healthcare providers must protect patient information. Your payment solution should support — not complicate — your HIPAA compliance obligations.",
      },
      {
        icon: Clock,
        title: "Reconciliation headaches",
        description: "Matching patient payments to accounts is time-consuming when your processor doesn't provide clear, detailed reporting.",
      },
      {
        icon: HeartPulse,
        title: "No FSA/HSA acceptance",
        description: "Patients expect to pay with health savings accounts and flexible spending accounts. Not all processors handle these card types correctly.",
      },
    ],
    solutionPitch: "Liberty Bancard provides PCI-compliant, HIPAA-aware payment processing for medical and dental practices. We support patient payment plans, co-pay collection, and FSA/HSA card acceptance — all with transparent pricing optimized for high-value healthcare transactions.",
    solutions: [
      {
        title: "HIPAA-Aware Compliance",
        description: "PCI DSS compliant terminals with point-to-point encryption. Designed to support your overall compliance posture without complicating PHI handling.",
      },
      {
        title: "Patient Payment Plans",
        description: "Secure card-on-file and recurring billing capabilities let you set up patient payment plans with automatic charges on a defined schedule.",
      },
      {
        title: "Co-Pay Collection",
        description: "Streamlined checkout with terminals that support co-pay amounts, balance payments, and insurance-verified amounts at the front desk.",
      },
      {
        title: "FSA/HSA Card Acceptance",
        description: "Properly configured terminals accept FSA, HSA, and HRA cards with correct merchant category codes for auto-substantiation.",
      },
    ],
    equipment: [
      {
        name: "Clover Mini 3",
        description: "Compact countertop terminal with fingerprint login. Ideal for front-desk co-pay collection.",
      },
      {
        name: "PAX A920",
        description: "Smart Android terminal with all-day battery. Great for bedside or mobile payment collection.",
      },
      {
        name: "Virtual Terminal",
        description: "Accept payments over the phone or via emailed payment links for patient balances and recurring bills.",
      },
    ],
    pricing: [
      { label: "Interchange Plus", detail: "Optimized for high-value healthcare transactions. Bigger savings on larger payments." },
      { label: "Recurring Billing", detail: "Automated patient payment plans with secure card-on-file tokenization." },
      { label: "PCI Compliance Support", detail: "Guidance on maintaining PCI DSS compliance for your practice." },
      { label: "99.9% Uptime SLA", detail: "Reliable processing so patient payments never disrupt your practice." },
    ],
    ctaHeadline: "See What Your Practice Is Really Paying",
    ctaSubline: "Upload your current processing statement for a free analysis. We'll identify savings opportunities specific to healthcare transactions.",
  },
  "home-services": {
    slug: "home-services",
    industry: "Home Services",
    heroTitle: "Get Paid in the Field — No Hassle, No Contracts",
    heroSubtitle: "Plumbers, electricians, HVAC techs, landscapers, and contractors need payments that work where they work. Accept cards on-site, send invoices, and set up recurring billing — all from your phone or a portable terminal.",
    heroImage: verticalHomeServices,
    heroIcon: Truck,
    painPoints: [
      {
        icon: Smartphone,
        title: "No way to accept cards on-site",
        description: "Chasing checks and cash slows down collections. Customers expect to tap or swipe at the door — not mail a check later.",
      },
      {
        icon: Receipt,
        title: "Manual invoicing wastes hours",
        description: "Writing up invoices by hand or through clunky software means delayed payments and accounting headaches every month.",
      },
      {
        icon: RefreshCw,
        title: "No recurring billing for service contracts",
        description: "Maintenance plans and subscription services need automatic billing — not monthly phone calls to collect payment.",
      },
      {
        icon: Lock,
        title: "Locked into long-term equipment leases",
        description: "Many processors trap you in 3-4 year terminal leases with early termination fees that cost more than the equipment itself.",
      },
    ],
    solutionPitch: "Liberty Bancard gives home service businesses the tools to get paid on the spot. Mobile terminals, built-in invoicing, recurring billing, and month-to-month flexibility — no contracts, no leases, no nonsense.",
    solutions: [
      {
        title: "Mobile Payments Anywhere You Work",
        description: "Accept chip, tap, and swipe payments on-site with a portable terminal or your smartphone. Works on Wi-Fi or cellular data.",
      },
      {
        title: "Built-In Invoicing & Estimates",
        description: "Send professional invoices via text or email. Customers pay with a link — no app download required. Track payments in real time.",
      },
      {
        title: "Recurring Billing for Service Plans",
        description: "Set up automatic monthly or quarterly charges for maintenance contracts. Card-on-file securely stored and PCI compliant.",
      },
      {
        title: "No-Contract Flexibility",
        description: "Month-to-month processing with no early termination fees. Keep your equipment if you leave. We earn your business every month.",
      },
    ],
    equipment: [
      {
        name: "SwipeSimple Mobile Reader",
        description: "Bluetooth reader pairs with your phone. Accept chip, tap, and swipe. Send digital receipts instantly.",
      },
      {
        name: "Dejavoo QD4",
        description: "Rugged portable terminal with built-in printer. 4G + Wi-Fi. All-day battery for jobs that run long.",
      },
      {
        name: "PAX A920",
        description: "Sleek smart terminal with 5-inch screen. Fast processing, built-in printer, all-day battery life.",
      },
    ],
    pricing: [
      { label: "Cash Discount Program", detail: "0% processing — customer covers the card fee. Keep 100% of your revenue." },
      { label: "Interchange Plus", detail: "Wholesale rates + small fixed markup. Most transparent option for field businesses." },
      { label: "No Equipment Leases", detail: "Buy or use a free terminal with your program. No 3-year lease traps." },
      { label: "Month-to-Month", detail: "Cancel anytime. No early termination fees. No auto-renewal surprises." },
    ],
    ctaHeadline: "Ready to Get Paid Faster in the Field?",
    ctaSubline: "Upload your current processing statement for a free savings analysis, or book a quick call to discuss your setup.",
  },
  ecommerce: {
    slug: "ecommerce",
    industry: "E-Commerce",
    heroTitle: "Secure Payments for Your Online Store",
    heroSubtitle: "Whether you sell on Shopify, WooCommerce, or a custom platform, your payment gateway should be fast, secure, and affordable. Stop overpaying for online transactions.",
    heroImage: heroAnalytics,
    heroIcon: Globe,
    painPoints: [
      {
        icon: Shield,
        title: "Fraud and chargebacks eating into margins",
        description: "Online transactions carry higher risk. Without proper fraud tools, chargebacks can cost you the sale plus penalty fees on top.",
      },
      {
        icon: ShoppingCart,
        title: "Cart abandonment from clunky checkout",
        description: "A slow or complicated checkout flow kills conversions. Every extra step in the process loses 10-15% of customers.",
      },
      {
        icon: Globe,
        title: "No international payment support",
        description: "Turning away international customers means leaving money on the table. Multi-currency support opens entirely new markets.",
      },
      {
        icon: DollarSign,
        title: "Flat-rate pricing inflating costs at scale",
        description: "Services like Stripe and Square charge the same rate on every transaction. As volume grows, you overpay significantly vs. interchange-plus.",
      },
    ],
    solutionPitch: "Liberty Bancard provides e-commerce businesses with a secure payment gateway, built-in fraud protection, and interchange-plus pricing that saves significantly over flat-rate processors. We integrate with all major platforms and support subscription billing out of the box.",
    solutions: [
      {
        title: "Gateway with Built-In Fraud Protection",
        description: "Advanced fraud screening with AVS, CVV verification, velocity checks, and 3D Secure authentication. Reduce chargebacks before they happen.",
      },
      {
        title: "Seamless Cart Integration",
        description: "Pre-built plugins for Shopify, WooCommerce, Magento, BigCommerce, and custom APIs. One-click checkout support for higher conversions.",
      },
      {
        title: "Subscription & Recurring Billing",
        description: "Built-in tools for membership sites, SaaS products, and subscription boxes. Automatic retry on failed payments with smart dunning management.",
      },
      {
        title: "International Payment Acceptance",
        description: "Accept payments in 130+ currencies. Automatic currency conversion with transparent exchange rates. Expand your market globally.",
      },
    ],
    equipment: [
      {
        name: "Payment Gateway",
        description: "Secure hosted payment page or embedded checkout. PCI Level 1 compliant. Tokenization for returning customers.",
      },
      {
        name: "Virtual Terminal",
        description: "Accept phone and mail orders through a web-based terminal. No hardware needed. Keyed-entry with recurring billing built in.",
      },
      {
        name: "Mobile + Online Bundle",
        description: "Combine your online gateway with a SwipeSimple reader for pop-ups, events, or hybrid omnichannel retail.",
      },
    ],
    pricing: [
      { label: "Online Transactions", detail: "Interchange + fixed markup per transaction. Saves 20-40% vs flat-rate at scale." },
      { label: "Gateway Fee", detail: "Competitive monthly rate with no per-transaction gateway surcharges." },
      { label: "PCI Compliance", detail: "Included at no additional cost. No annual PCI compliance fees." },
      { label: "Setup Fee", detail: "$0 — free integration support and onboarding assistance." },
    ],
    ctaHeadline: "Selling Online? Let Us Cut Your Processing Costs.",
    ctaSubline: "Upload your current gateway statement for a free comparison, or schedule a call to discuss integration with your platform.",
  },
  "cash-discount": {
    slug: "cash-discount",
    industry: "Cash Discount",
    heroTitle: "Pay 0% in Processing Fees — Legally and Compliantly",
    heroSubtitle: "Cash discount (also called dual pricing) lets you pass the cost of card acceptance to the cardholder while offering a discount for cash payments. It's legal in all 50 states when implemented correctly.",
    heroImage: zeroPercent,
    heroIcon: DollarSign,
    painPoints: [
      {
        icon: DollarSign,
        title: "Processing fees consuming 2-4% of revenue",
        description: "On $500K in annual card sales, you're paying $10,000-$20,000 in processing fees. That's profit you could keep entirely.",
      },
      {
        icon: AlertTriangle,
        title: "Confusion about surcharging vs. cash discount",
        description: "Surcharging and cash discounting are different programs with different rules. Getting it wrong can mean fines or account termination.",
      },
      {
        icon: Users,
        title: "Worry about customer pushback",
        description: "Merchants fear losing customers. In practice, 95%+ of customers pay with a card anyway — the service fee is minimal and well-received when presented properly.",
      },
      {
        icon: FileText,
        title: "Non-compliant signage and implementation",
        description: "Proper signage at the entrance, point of sale, and on receipts is required. Many processors skip this, putting you at risk.",
      },
    ],
    solutionPitch: "Liberty Bancard sets up fully compliant cash discount programs that eliminate your processing fees. We handle the signage, program your terminal, and ensure every receipt line item meets card brand requirements. You pay $0 in processing — guaranteed.",
    solutions: [
      {
        title: "How Cash Discount Works",
        description: "Your listed prices include a small service fee (typically 3.99%). Customers paying cash receive a discount equal to that fee. Card-paying customers pay the listed price. You pay $0 in processing.",
      },
      {
        title: "Full Compliance Setup",
        description: "We provide compliant signage for your entrance and register, program your terminal to automatically apply and display the fee, and ensure receipts show correct line items.",
      },
      {
        title: "The Savings Math",
        description: "A business processing $30,000/month in cards at 3% effective rate pays $900/month ($10,800/year). With cash discount: $0. That's $10,800 back in your pocket annually.",
      },
      {
        title: "Seamless Customer Experience",
        description: "Modern terminals display the cash price and card price clearly. Customers see the fee before they tap. No surprises, no complaints, no friction.",
      },
    ],
    equipment: [
      {
        name: "Clover Flex 3",
        description: "Handheld POS with cash discount built into the software. Shows dual pricing on screen. Built-in printer for compliant receipts.",
      },
      {
        name: "Dejavoo QD4",
        description: "Cash discount-ready out of the box. Rugged design for field use. Automatic fee calculation and receipt formatting.",
      },
      {
        name: "PAX A920",
        description: "Smart terminal with cash discount program pre-loaded. Dual pricing display. Fast processing with all-day battery.",
      },
    ],
    pricing: [
      { label: "Your Processing Cost", detail: "0% — zero processing fees. You keep every dollar of every sale." },
      { label: "Service Fee to Cardholder", detail: "Typically 3.99% (adjustable). Clearly displayed before payment." },
      { label: "Equipment", detail: "Free terminal placement with qualifying cash discount program." },
      { label: "Signage Kit", detail: "Included — entrance sign, register sign, and compliant receipt formatting." },
    ],
    ctaHeadline: "Ready to Eliminate Your Processing Fees?",
    ctaSubline: "Upload your current statement and we'll show you exactly how much you'll save with a compliant cash discount program.",
    successStories: [
      { industry: "Pizza Restaurant", result: "Saved $14,400/year on $40K monthly volume" },
      { industry: "Auto Repair Shop", result: "Saved $9,600/year — zero customer complaints" },
      { industry: "Hair Salon", result: "Saved $6,000/year with dual pricing on Clover" },
      { industry: "Convenience Store", result: "Saved $18,000/year on $50K monthly card sales" },
    ],
    complianceNotes: [
      "Cash discount is legal in all 50 states under federal law",
      "Proper signage must be displayed at entrance and point of sale",
      "Receipts must clearly show the service fee as a separate line item",
      "The program must offer a genuine discount for cash — not a surcharge for cards",
      "Terminal must be programmed to automatically calculate and display the fee",
      "We handle all compliance setup and provide ongoing support",
    ],
  },
  switch: {
    slug: "switch",
    industry: "Switching Processors",
    heroTitle: "Switching Processors Is Easier Than You Think",
    heroSubtitle: "Most merchants stay with overpriced processors because switching feels hard. It's not. We handle everything — and guarantee zero downtime during the transition.",
    heroImage: compareRates,
    heroIcon: ArrowLeftRight,
    painPoints: [
      {
        icon: DollarSign,
        title: "You're overpaying and you know it",
        description: "If you haven't had your statement reviewed in 12+ months, you're almost certainly paying more than you should. Rate creep, hidden fees, and bundled pricing add up fast.",
      },
      {
        icon: Lock,
        title: "Locked into a contract you didn't read",
        description: "Many processors bury early termination fees, equipment lease obligations, and auto-renewal clauses in the fine print. We'll review your contract and find your exit.",
      },
      {
        icon: Clock,
        title: "Support that doesn't support",
        description: "Hold times, overseas call centers, and ticket systems that never resolve. When your terminal goes down, you need a real person who picks up the phone.",
      },
      {
        icon: AlertTriangle,
        title: "Fear of downtime during the switch",
        description: "The #1 reason merchants don't switch: they're afraid of missing sales. Our parallel deployment ensures you're never without the ability to accept cards.",
      },
    ],
    solutionPitch: "Liberty Bancard makes switching painless. We analyze your current statement, handle the cancellation, deploy your new terminal in parallel, and guarantee zero downtime. Most merchants are live within 48 hours.",
    solutions: [
      {
        title: "Free Statement Analysis",
        description: "Upload your current statement and we'll break it down line by line. We show you exactly where you're overpaying and what fair pricing looks like for your volume and industry.",
      },
      {
        title: "We Handle the Cancellation",
        description: "We'll review your current contract, identify any termination fees, and in many cases negotiate or cover the cost of switching. You don't have to make uncomfortable calls.",
      },
      {
        title: "Parallel Deployment — Zero Downtime",
        description: "We set up and test your new terminal while your current one is still active. Once everything is verified working, we make the switch. You never miss a single transaction.",
      },
      {
        title: "Onboarding in 48 Hours or Less",
        description: "From signed application to live terminal, most merchants are up and running within 48 hours. We pre-program your equipment and ship it ready to plug in and process.",
      },
    ],
    equipment: [
      {
        name: "Your Current Terminal",
        description: "In many cases, we can reprogram your existing terminal to work with our processing. No new hardware needed.",
      },
      {
        name: "Free Terminal Placement",
        description: "Qualifying merchants receive a brand-new terminal at no cost. Pre-programmed and ready to process out of the box.",
      },
      {
        name: "Full POS Migration",
        description: "Switching from a bundled POS? We help migrate your menu, inventory, and settings to a new system with better processing rates.",
      },
    ],
    pricing: [
      { label: "Statement Review", detail: "Free — no obligation. We analyze your current rates and show you what's possible." },
      { label: "Setup Fee", detail: "$0. No activation fees, no application fees, no hidden charges." },
      { label: "Early Termination Coverage", detail: "Up to $500 for qualifying merchants to cover your existing processor's cancellation fee." },
      { label: "Contract", detail: "Month-to-month — we earn your business every month. No auto-renewal traps." },
    ],
    ctaHeadline: "See What You're Really Paying — in 60 Seconds",
    ctaSubline: "Upload your latest processing statement and get a side-by-side comparison within 24 hours. No commitment, no pressure.",
    successStories: [
      { industry: "Medical Practice", result: "Switched from Square — saved 38% on monthly processing" },
      { industry: "Restaurant Group (3 locations)", result: "Left bundled POS processor — saved $2,400/month" },
      { industry: "Auto Dealership", result: "Moved from tiered pricing — cut effective rate from 3.2% to 1.9%" },
      { industry: "Retail Boutique", result: "Switched to cash discount — now pays $0 in processing" },
    ],
    complianceNotes: [
      "We never charge hidden fees or surprise rate increases",
      "All pricing is disclosed upfront before you sign anything",
      "Month-to-month agreements with no auto-renewal traps",
      "Your merchant ID and transaction history transfer seamlessly",
      "PCI compliance assistance included at no additional cost",
    ],
  },
};

export default function SalesOnePager() {
  const { slug } = useParams<{ slug: string }>();
  const data = slug ? salesOnePagerData[slug] : undefined;

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO
          title="Page Not Found"
          description="The requested sales page was not found."
          noindex={true}
        />
        <Navbar />
        <main className="flex-grow pt-20 flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-not-found-heading">
              Page Not Found
            </h1>
            <p className="text-muted-foreground mb-6" data-testid="text-not-found-message">
              The industry one-pager you're looking for doesn't exist.
            </p>
            <Link href="/">
              <Button data-testid="button-go-home">Back to Home</Button>
            </Link>
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

      <main className="flex-grow pt-20">
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
                Sales Team Resource — Not Public
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
              Pain Points We Solve
            </h2>
            <p className="text-muted-foreground mb-8">
              Common challenges {data.industry.toLowerCase()} businesses face with payment processing.
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
              Our Solution for {data.industry}
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
              Recommended Equipment
            </h2>
            <p className="text-muted-foreground mb-8">
              Terminals and devices best suited for {data.industry.toLowerCase()} businesses.
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
              Pricing Overview
            </h2>
            <p className="text-muted-foreground mb-8">
              Transparent pricing options for {data.industry.toLowerCase()} businesses.
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

        {data.successStories && data.successStories.length > 0 && (
          <section className="py-16 bg-muted/30">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-success-heading">
                Success Stories
              </h2>
              <p className="text-muted-foreground mb-8">
                Real results from real merchants.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {data.successStories.map((story, i) => (
                  <Card key={i} data-testid={`card-success-${i}`}>
                    <CardContent className="p-4">
                      <p className="text-sm font-semibold text-foreground mb-1">{story.industry}</p>
                      <p className="text-sm text-muted-foreground">{story.result}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>
        )}

        {data.complianceNotes && data.complianceNotes.length > 0 && (
          <section className="py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-compliance-heading">
                Compliance Notes
              </h2>
              <p className="text-muted-foreground mb-8">
                Important details for a compliant implementation.
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
              <Link href="/upload-statement">
                <Button variant="secondary" className="gap-2" data-testid="button-cta-upload">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
              <Link href="/get-started">
                <Button variant="outline" className="gap-2 bg-white/10 border-white/20 text-white backdrop-blur-sm" data-testid="button-cta-call">
                  <Phone className="w-4 h-4" />
                  Book a 10-Minute Call
                </Button>
              </Link>
            </div>
            <p className="text-primary-foreground/50 text-xs mt-6" data-testid="text-cta-disclaimer">
              All savings estimates require a statement review. Eligibility, underwriting, and card brand rules apply.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
