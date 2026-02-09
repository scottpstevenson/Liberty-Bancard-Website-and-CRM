import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Upload,
  Calendar,
  CheckCircle2,
  FileText,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  CreditCard,
  Monitor,
  Stethoscope,
  Car,
  UtensilsCrossed,
  Wrench,
  Store,
  ClipboardList,
  BarChart3,
  BookOpen,
  FolderOpen,
} from "lucide-react";
import terminalHero from "@assets/images/liberty-terminal-hero.png";
import terminalTap from "@assets/images/liberty-terminal-tap.png";
import terminalAngle from "@assets/images/liberty-terminal-angle.png";

interface ContentPage {
  title: string;
  subtitle: string;
  description: string;
  bullets: string[];
  type: "standard" | "case-study" | "packet" | "index";
  images?: { src: string; alt: string; caption?: string }[];
  caseStudy?: {
    snapshot: string;
    before: string;
    changed: string;
    after: string;
  };
  links?: { href: string; label: string; description: string }[];
  categories?: {
    name: string;
    items: { href: string; label: string }[];
  }[];
}

const contentMap: Record<string, ContentPage> = {
  "/assets": {
    title: "Asset Library",
    subtitle: "Sales Enablement Resources for Liberty Bancard",
    description: "Access one-pagers, comparison guides, terminal resources, vertical-specific collateral, and case studies. Everything you need to educate prospects and close deals.",
    bullets: [],
    type: "index",
    categories: [
      {
        name: "Start Here",
        items: [
          { href: "/assets/one-pagers/why-liberty", label: "Why Liberty Bancard" },
          { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works" },
          { href: "/assets/one-pagers/funding-deposits-clarity", label: "Funding & Deposits Clarity" },
          { href: "/assets/one-pagers/hidden-fees-checklist", label: "Hidden Fees Checklist" },
          { href: "/assets/security/statement-upload-safety", label: "Statement Upload Safety" },
        ],
      },
      {
        name: "Programs + Competitive",
        items: [
          { href: "/assets/0-percent/overview", label: "0% Processing Overview" },
          { href: "/assets/0-percent/compliance-checklist", label: "0% Compliance Checklist" },
          { href: "/assets/compare/beat-square-stripe", label: "Beat Square & Stripe" },
        ],
      },
      {
        name: "Terminal",
        items: [
          { href: "/assets/terminal/qd4", label: "Liberty Smart Terminal" },
          { href: "/assets/terminal/go-live-checklist", label: "Go-Live Checklist" },
        ],
      },
      {
        name: "Verticals",
        items: [
          { href: "/assets/verticals/medical", label: "Medical / Dental / Medspa" },
          { href: "/assets/verticals/auto", label: "Automotive" },
          { href: "/assets/verticals/restaurant", label: "Restaurant" },
          { href: "/assets/verticals/home-services", label: "Home Services" },
          { href: "/assets/verticals/retail", label: "Retail" },
        ],
      },
      {
        name: "Case Studies",
        items: [
          { href: "/assets/case-studies/medical-front-desk", label: "Medical Front Desk" },
          { href: "/assets/case-studies/auto-high-ticket", label: "Automotive High-Ticket" },
          { href: "/assets/case-studies/restaurant-tips-speed", label: "Restaurant Tips & Speed" },
          { href: "/assets/case-studies/home-services-mobile", label: "Home Services Mobile" },
          { href: "/assets/case-studies/retail-fast-checkout", label: "Retail Fast Checkout" },
        ],
      },
    ],
  },

  "/assets/one-pagers/why-liberty": {
    title: "We Don't Quote Rates. We Diagnose Statements.",
    subtitle: "Why Liberty Bancard Is Different",
    description: "Most processors lead with a rate. We lead with a line-item statement review that shows you exactly what you're paying and why. No guessing, no bait-and-switch\u2014just transparent cost analysis before any proposal.",
    bullets: [
      "Free statement review with line-item cost breakdown",
      "Wholesale interchange-plus pricing with no hidden markups",
      "No long-term contracts or early termination fees",
      "Dedicated support from real humans, not call centers",
      "Compliance-first approach to every program we offer",
    ],
    type: "standard",
  },

  "/assets/one-pagers/how-statement-review-works": {
    title: "What Happens After You Upload a Statement",
    subtitle: "Our Statement Review Process, Step by Step",
    description: "When you upload your merchant statement, our team performs a detailed cost analysis. We break down every fee, identify overcharges, and show you exactly where savings exist\u2014before you make any decisions.",
    bullets: [
      "Upload your most recent processing statement securely",
      "We identify interchange markups, junk fees, and hidden costs",
      "You receive a side-by-side comparison of current vs. optimized pricing",
      "No obligation to switch\u2014the review is free and confidential",
      "Average review turnaround is one business day",
    ],
    type: "standard",
  },

  "/assets/one-pagers/funding-deposits-clarity": {
    title: "Funding & Deposits: What to Expect",
    subtitle: "How and When You Get Paid",
    description: "Understanding your funding schedule eliminates surprises. We provide clear timelines on batch settlement, deposit timing, and reserve requirements so you always know when funds hit your account.",
    bullets: [
      "Next-day funding available for qualified merchants",
      "Clear batch cutoff times and settlement schedules",
      "Transparent reserve policies when applicable",
      "No hidden holds or unexplained delays",
    ],
    type: "standard",
  },

  "/assets/one-pagers/hidden-fees-checklist": {
    title: "Common Hidden Fees We Find on Merchant Statements",
    subtitle: "Know What to Look For",
    description: "Many merchants pay fees they don't even know exist. This checklist highlights the most common junk fees, markups, and padding we uncover during statement reviews\u2014so you can spot them on your own statement.",
    bullets: [
      "PCI non-compliance fees charged without notification",
      "Batch processing fees and statement fees stacked together",
      "Inflated interchange markups disguised as flat rates",
      "Monthly minimum fees and annual fees buried in fine print",
      "Equipment lease costs far exceeding terminal value",
    ],
    type: "standard",
  },

  "/assets/security/statement-upload-safety": {
    title: "Statement Upload: Secure, Minimal, and Optional Redactions",
    subtitle: "Your Data Privacy Is Our Priority",
    description: "We only need the fee summary and transaction totals from your statement. You can redact account numbers, merchant IDs, and any other sensitive data before uploading. Our upload process uses bank-grade encryption.",
    bullets: [
      "TLS encryption on all uploads",
      "You may redact any personally identifiable information",
      "We only analyze fee lines and volume totals",
      "Statements are deleted after review unless you request otherwise",
      "No data is shared with third parties",
    ],
    type: "standard",
  },

  "/assets/0-percent/overview": {
    title: "'0% Processing' Has Rules. We Do It the Right Way.",
    subtitle: "Compliant Cash Discount and Surcharge Programs",
    description: "Zero-cost processing is real, but only when done within card brand rules and state law. We build compliant programs that protect your business from fines and chargebacks while passing processing costs to cardholders the right way.",
    bullets: [
      "Compliant with Visa, Mastercard, and state-level regulations",
      "Proper signage, receipt language, and disclosure requirements",
      "Cash discount and dual-pricing options available",
      "Regular compliance audits to keep your program current",
      "We handle setup, training, and ongoing support",
    ],
    type: "standard",
  },

  "/assets/0-percent/compliance-checklist": {
    title: "0% Processing Compliance Checklist",
    subtitle: "Requirements for a Compliant Zero-Cost Program",
    description: "Before launching a 0% processing program, you need to meet specific card brand and legal requirements. This checklist covers signage, receipt formatting, state eligibility, and disclosure rules.",
    bullets: [
      "Verify state-level legality for surcharging or cash discount",
      "Register surcharge program with card brands (if applicable)",
      "Install compliant signage at point of entry and point of sale",
      "Ensure receipts show surcharge as a separate line item",
      "Train staff on how to explain the program to customers",
    ],
    type: "standard",
  },

  "/assets/compare/beat-square-stripe": {
    title: "Flat-Rate Is Convenient \u2014 Until You See the All-In Cost",
    subtitle: "Square & Stripe vs. Interchange-Plus Pricing",
    description: "Flat-rate processors like Square and Stripe charge the same rate regardless of card type. That means you overpay on debit and standard credit cards. Our interchange-plus model passes through actual card costs with a transparent margin.",
    bullets: [
      "Square/Stripe charge 2.6%+ on every transaction regardless of card type",
      "Debit cards cost as low as 0.05% at interchange\u2014flat-rate ignores this",
      "Interchange-plus pricing shows exactly what you pay per transaction",
      "Merchants processing $10K+/month typically save significantly",
      "No proprietary hardware lock-in with Liberty Bancard",
    ],
    type: "standard",
  },

  "/assets/terminal/qd4": {
    title: "Liberty Smart Terminal",
    subtitle: "Modern, Reliable, and Ready for Any Payment Type",
    description: "The Liberty Smart Terminal is a full-featured countertop payment device that accepts tap, dip, swipe, and QR payments. It supports dual-pricing, tip adjustment, and integrates with most POS systems out of the box. Built for businesses that need reliability and compliance from day one.",
    bullets: [
      "Accepts EMV chip, contactless/NFC, magstripe, and QR codes",
      "Built-in support for cash discount and surcharge programs",
      "Wi-Fi and Ethernet connectivity",
      "Tip adjust, batch close, and reporting from the terminal",
      "Compact countertop form factor with touchscreen display",
      "Liberty Bancard branding and dedicated support",
    ],
    type: "standard",
    images: [
      { src: terminalHero, alt: "Liberty Smart Terminal - product view", caption: "Liberty Smart Terminal - countertop payment device" },
      { src: terminalTap, alt: "Liberty Smart Terminal - contactless tap payment in use", caption: "Contactless tap payment - fast and secure" },
      { src: terminalAngle, alt: "Liberty Smart Terminal - 3/4 angle view", caption: "Compact design with full payment acceptance" },
    ],
  },

  "/assets/terminal/go-live-checklist": {
    title: "Terminal Go-Live Checklist",
    subtitle: "Everything You Need Before Your First Transaction",
    description: "Use this checklist to ensure your terminal is properly configured, tested, and ready for live transactions. Covers connectivity, batch testing, signage (for 0% programs), and staff training.",
    bullets: [
      "Confirm internet connectivity (Wi-Fi or Ethernet)",
      "Run a test transaction and verify batch settlement",
      "Install compliant signage if running a 0% program",
      "Train staff on void, refund, and tip-adjust functions",
      "Save Liberty Bancard support number in a visible location",
    ],
    type: "standard",
  },

  "/assets/verticals/medical": {
    title: "Medical/Dental/Medspa Processing",
    subtitle: "Payment Solutions for Healthcare Practices",
    description: "Healthcare practices handle high-ticket transactions, recurring billing, and patient financing. We provide HIPAA-aware payment solutions with compliant 0% programs, next-day funding, and terminal configurations designed for front-desk workflows.",
    bullets: [
      "High-ticket transaction optimization reduces per-visit costs",
      "Compliant 0% programs for elective and cosmetic procedures",
      "Next-day funding for improved cash flow",
      "Terminal configurations for front desk and multi-location setups",
      "Recurring billing support for payment plans",
    ],
    type: "standard",
  },

  "/assets/verticals/auto": {
    title: "Automotive Processing",
    subtitle: "Payment Solutions for Auto Shops and Dealers",
    description: "Automotive businesses process large repair orders and parts purchases. Our interchange-plus pricing eliminates the flat-rate penalty on high-ticket transactions, and our terminals support tip adjust and invoice-based payments.",
    bullets: [
      "Interchange-plus pricing saves on high-ticket repair orders",
      "Terminal support for invoice and keyed-entry transactions",
      "Compliant 0% programs to offset processing costs",
      "Next-day funding keeps parts inventory moving",
      "Multi-bay and multi-location terminal deployment",
    ],
    type: "standard",
  },

  "/assets/verticals/restaurant": {
    title: "Restaurant Processing",
    subtitle: "Payment Solutions for Restaurants and Quick-Service",
    description: "Restaurants need fast authorization, reliable tip adjust, and equipment that handles high-volume rushes. We provide optimized terminal configurations, competitive interchange-plus rates, and compliant 0% programs for dine-in and counter-service environments.",
    bullets: [
      "Fast authorization speeds for high-volume service",
      "Tip adjust and pre-auth support built into terminals",
      "Compliant 0% programs for dine-in and counter service",
      "Interchange-plus pricing reduces cost on debit-heavy ticket mixes",
      "Integration options for POS systems",
    ],
    type: "standard",
  },

  "/assets/verticals/home-services": {
    title: "Home Services Processing",
    subtitle: "Payment Solutions for Field Service Businesses",
    description: "Home service providers need mobile payment acceptance, fast funding, and the ability to process payments on-site. We offer mobile terminal options, virtual terminal access, and compliant programs for contractors, HVAC, plumbing, and more.",
    bullets: [
      "Mobile terminal options for on-site payment collection",
      "Virtual terminal for phone and invoice payments",
      "Next-day funding to cover materials and payroll",
      "Compliant 0% programs for high-ticket service calls",
      "Simple setup with no long-term contracts",
    ],
    type: "standard",
  },

  "/assets/verticals/retail": {
    title: "Retail Processing",
    subtitle: "Payment Solutions for Retail Stores",
    description: "Retail merchants process a high volume of card-present transactions across multiple card types. Interchange-plus pricing ensures you pay actual interchange on debit cards instead of inflated flat rates, and our terminals handle tap, dip, and swipe seamlessly.",
    bullets: [
      "Interchange-plus pricing maximizes savings on debit and credit mix",
      "Contactless and EMV chip acceptance standard",
      "Compliant 0% programs available for qualifying stores",
      "Fast batch settlement and next-day funding options",
      "Countertop and mobile terminal configurations",
    ],
    type: "standard",
  },

  "/assets/case-studies/medical-front-desk": {
    title: "Case Study: Medical Front Desk",
    subtitle: "How a Healthcare Practice Reduced Processing Costs",
    description: "A multi-provider medical practice was overpaying on flat-rate processing for high-ticket elective procedures. After a statement review, Liberty Bancard identified interchange markups and deployed a compliant 0% program.",
    bullets: [],
    type: "case-study",
    caseStudy: {
      snapshot: "[To be completed with verified merchant data] \u2014 Multi-provider medical practice, average ticket $350+, processing $80K+/month in card volume.",
      before: "[To be completed with verified merchant data] \u2014 Flat-rate processing at 2.6% + $0.10, no cost optimization, paying interchange markups on all card types.",
      changed: "[To be completed with verified merchant data] \u2014 Migrated to interchange-plus pricing, deployed compliant cash discount program for elective services, installed Liberty Smart Terminals at front desk.",
      after: "[To be completed with verified merchant data] \u2014 Significant monthly savings on processing fees, faster funding, and full compliance with card brand rules.",
    },
  },

  "/assets/case-studies/auto-high-ticket": {
    title: "Case Study: Automotive High-Ticket",
    subtitle: "How an Auto Shop Cut Costs on Large Repair Orders",
    description: "An independent auto repair shop was losing margin on high-ticket repair orders processed through a flat-rate provider. Liberty Bancard's interchange-plus pricing and 0% program recovered significant monthly savings.",
    bullets: [],
    type: "case-study",
    caseStudy: {
      snapshot: "[To be completed with verified merchant data] \u2014 Independent auto repair shop, average ticket $600+, processing $50K+/month.",
      before: "[To be completed with verified merchant data] \u2014 Flat-rate processing with high per-transaction costs on large invoices, no debit optimization.",
      changed: "[To be completed with verified merchant data] \u2014 Switched to interchange-plus pricing, implemented compliant surcharge program, deployed terminal with invoice and keyed-entry support.",
      after: "[To be completed with verified merchant data] \u2014 Reduced effective rate significantly, improved cash flow with next-day funding.",
    },
  },

  "/assets/case-studies/restaurant-tips-speed": {
    title: "Case Study: Restaurant Tips & Speed",
    subtitle: "How a Restaurant Improved Authorization Speed and Tip Flow",
    description: "A busy restaurant was experiencing slow authorizations during peak hours and inconsistent tip settlement. Liberty Bancard optimized their terminal configuration and provided interchange-plus pricing tailored to their debit-heavy card mix.",
    bullets: [],
    type: "case-study",
    caseStudy: {
      snapshot: "[To be completed with verified merchant data] \u2014 Full-service restaurant, 200+ transactions/day, average ticket $35, heavy debit card usage.",
      before: "[To be completed with verified merchant data] \u2014 Flat-rate processing, slow batch settlement, tip adjust issues causing reconciliation delays.",
      changed: "[To be completed with verified merchant data] \u2014 Deployed Liberty Smart Terminals with optimized tip-adjust workflow, switched to interchange-plus to capture debit savings.",
      after: "[To be completed with verified merchant data] \u2014 Faster authorizations, reliable tip settlement, and measurable monthly savings.",
    },
  },

  "/assets/case-studies/home-services-mobile": {
    title: "Case Study: Home Services Mobile",
    subtitle: "How a Home Services Company Went Mobile with Payments",
    description: "A plumbing and HVAC company needed to accept payments in the field without relying on paper invoices and delayed checks. Liberty Bancard provided mobile terminals and next-day funding to streamline their cash flow.",
    bullets: [],
    type: "case-study",
    caseStudy: {
      snapshot: "[To be completed with verified merchant data] \u2014 Plumbing and HVAC company, 5 service trucks, average ticket $450, processing $40K+/month.",
      before: "[To be completed with verified merchant data] \u2014 Primarily invoice-based with check payments, 7-10 day collection cycle, limited card acceptance.",
      changed: "[To be completed with verified merchant data] \u2014 Deployed mobile terminals to each truck, set up virtual terminal for office invoicing, implemented compliant 0% program.",
      after: "[To be completed with verified merchant data] \u2014 Reduced collection cycle to next-day, increased card acceptance rate, offset processing costs with 0% program.",
    },
  },

  "/assets/case-studies/retail-fast-checkout": {
    title: "Case Study: Retail Fast Checkout",
    subtitle: "How a Retail Store Streamlined Checkout and Cut Fees",
    description: "A specialty retail store was paying inflated flat rates on a high volume of small transactions. Liberty Bancard's interchange-plus pricing captured debit savings and contactless acceptance sped up checkout lines.",
    bullets: [],
    type: "case-study",
    caseStudy: {
      snapshot: "[To be completed with verified merchant data] \u2014 Specialty retail store, 300+ transactions/day, average ticket $28, 60% debit card usage.",
      before: "[To be completed with verified merchant data] \u2014 Flat-rate processing at 2.6% + $0.10, no debit optimization, slow chip-read times on older terminal.",
      changed: "[To be completed with verified merchant data] \u2014 Switched to interchange-plus, deployed Liberty Smart Terminal with contactless support, enabled compliant cash discount program.",
      after: "[To be completed with verified merchant data] \u2014 Faster checkout with tap-to-pay, significant savings on debit transactions, improved customer experience.",
    },
  },

  "/packet/statement-review": {
    title: "Statement Review Packet",
    subtitle: "Everything a Prospect Needs to Understand Our Review Process",
    description: "This packet contains the key resources for educating prospects on why Liberty Bancard is different, how our statement review works, and what hidden fees we commonly find. Share these before or after a statement upload.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/one-pagers/why-liberty", label: "Why Liberty Bancard", description: "Our approach: diagnose first, quote second." },
      { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works", description: "Step-by-step breakdown of our review process." },
      { href: "/assets/one-pagers/hidden-fees-checklist", label: "Hidden Fees Checklist", description: "Common junk fees and markups we identify." },
    ],
  },

  "/packet/estimate": {
    title: "Estimate Packet",
    subtitle: "Resources for Prospects Requesting a Cost Estimate",
    description: "Share these resources with merchants who want to understand pricing and funding before committing. Covers the review process and what to expect from deposits and settlement.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works", description: "Step-by-step review process overview." },
      { href: "/assets/one-pagers/funding-deposits-clarity", label: "Funding & Deposits Clarity", description: "Settlement timelines and funding details." },
    ],
  },

  "/packet/0-percent": {
    title: "0% Processing Packet",
    subtitle: "Resources for Merchants Interested in Zero-Cost Processing",
    description: "This packet explains how compliant 0% processing works, including the legal and card brand requirements. Share with merchants evaluating cash discount or surcharge programs.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "How we build compliant zero-cost programs." },
      { href: "/assets/0-percent/compliance-checklist", label: "Compliance Checklist", description: "Requirements for signage, receipts, and state eligibility." },
    ],
  },

  "/packet/terminal": {
    title: "Terminal Packet",
    subtitle: "Resources for Terminal Deployment and Setup",
    description: "Everything a merchant needs for a smooth terminal rollout. Covers the Liberty Smart Terminal features and a pre-launch checklist to ensure day-one readiness.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/terminal/qd4", label: "Liberty Smart Terminal", description: "Terminal specs, features, and payment types supported." },
      { href: "/assets/terminal/go-live-checklist", label: "Go-Live Checklist", description: "Pre-launch steps for connectivity, testing, and training." },
    ],
  },

  "/packet/beat-square-stripe": {
    title: "Beat Square & Stripe Packet",
    subtitle: "Competitive Comparison Resources",
    description: "Use this packet when speaking with merchants currently on Square or Stripe. The comparison guide shows how interchange-plus pricing eliminates the flat-rate penalty on debit and standard credit cards.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/compare/beat-square-stripe", label: "Flat-Rate vs. Interchange-Plus", description: "Side-by-side cost comparison showing where flat-rate overpays." },
    ],
  },

  "/packet/medical": {
    title: "Medical Vertical Packet",
    subtitle: "Payment Processing Resources for Healthcare Practices",
    description: "Tailored resources for medical, dental, and medspa practices. Covers high-ticket optimization, compliant 0% programs, and a case study from a similar practice.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/medical", label: "Medical Processing Overview", description: "Solutions for healthcare payment workflows." },
      { href: "/assets/case-studies/medical-front-desk", label: "Case Study: Medical Front Desk", description: "Real-world results from a multi-provider practice." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Compliant programs for elective procedures." },
    ],
  },

  "/packet/auto": {
    title: "Automotive Vertical Packet",
    subtitle: "Payment Processing Resources for Auto Shops and Dealers",
    description: "Resources for automotive businesses processing high-ticket repair orders and parts sales. Covers interchange-plus savings, terminal options, and a case study from a similar shop.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/auto", label: "Automotive Processing Overview", description: "Solutions for auto shops and dealers." },
      { href: "/assets/case-studies/auto-high-ticket", label: "Case Study: Auto High-Ticket", description: "How an auto shop cut costs on large orders." },
      { href: "/assets/terminal/qd4", label: "Liberty Smart Terminal", description: "Terminal with invoice and keyed-entry support." },
    ],
  },

  "/packet/restaurant": {
    title: "Restaurant Vertical Packet",
    subtitle: "Payment Processing Resources for Restaurants",
    description: "Resources for restaurants and quick-service environments. Covers tip-adjust optimization, fast authorization, and a case study from a busy restaurant.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/restaurant", label: "Restaurant Processing Overview", description: "Solutions for dine-in and counter service." },
      { href: "/assets/case-studies/restaurant-tips-speed", label: "Case Study: Tips & Speed", description: "Faster authorizations and reliable tip settlement." },
      { href: "/assets/terminal/qd4", label: "Liberty Smart Terminal", description: "Terminal configured for high-volume restaurant use." },
    ],
  },

  "/packet/home-services": {
    title: "Home Services Vertical Packet",
    subtitle: "Payment Processing Resources for Field Service Businesses",
    description: "Resources for contractors, HVAC, plumbing, and other field service businesses. Covers mobile payment options, next-day funding, and a case study from a home services company.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/home-services", label: "Home Services Processing Overview", description: "Solutions for mobile and field-based businesses." },
      { href: "/assets/case-studies/home-services-mobile", label: "Case Study: Home Services Mobile", description: "How a service company went mobile with payments." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Offset costs on high-ticket service calls." },
    ],
  },

  "/packet/retail": {
    title: "Retail Vertical Packet",
    subtitle: "Payment Processing Resources for Retail Stores",
    description: "Resources for retail merchants processing high volumes of card-present transactions. Covers debit optimization, fast checkout, and a case study from a specialty retailer.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/retail", label: "Retail Processing Overview", description: "Solutions for high-volume retail environments." },
      { href: "/assets/case-studies/retail-fast-checkout", label: "Case Study: Fast Checkout", description: "Faster checkout and debit savings for a retail store." },
      { href: "/assets/terminal/qd4", label: "Liberty Smart Terminal", description: "Contactless-ready terminal for fast retail checkout." },
    ],
  },
};

function getIconForCategory(name: string) {
  switch (name) {
    case "Start Here": return <BookOpen className="w-5 h-5 text-primary" />;
    case "Programs + Competitive": return <BarChart3 className="w-5 h-5 text-primary" />;
    case "Terminal": return <Monitor className="w-5 h-5 text-primary" />;
    case "Verticals": return <Store className="w-5 h-5 text-primary" />;
    case "Case Studies": return <ClipboardList className="w-5 h-5 text-primary" />;
    default: return <FolderOpen className="w-5 h-5 text-primary" />;
  }
}

function CtaSection() {
  return (
    <section className="mt-12 border-t border-border pt-10">
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <Link href="/upload-statement" data-testid="link-cta-upload">
          <Button className="gap-2">
            <Upload className="w-4 h-4" />
            Upload Statement
          </Button>
        </Link>
        <a href="#" data-testid="link-cta-book-call">
          <Button variant="outline" className="gap-2">
            <Calendar className="w-4 h-4" />
            Book 10-Min Call
          </Button>
        </a>
      </div>
    </section>
  );
}

function ComplianceMicroline() {
  return (
    <p
      className="text-[10px] text-muted-foreground mt-8 leading-tight"
      data-testid="text-asset-compliance"
    >
      Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
    </p>
  );
}

function StandardPage({ content }: { content: ContentPage }) {
  return (
    <>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight" data-testid="text-asset-title">
        {content.title}
      </h1>
      <p className="mt-2 text-lg text-muted-foreground" data-testid="text-asset-subtitle">
        {content.subtitle}
      </p>

      {content.images && content.images.length > 0 && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="asset-image-gallery">
          {content.images.map((img, i) => (
            <div key={i} className={`${i === 0 && content.images!.length > 2 ? "md:col-span-2" : ""}`}>
              <img
                src={img.src}
                alt={img.alt}
                className="w-full rounded-md object-cover"
                data-testid={`img-asset-${i}`}
              />
              {img.caption && (
                <p className="text-xs text-muted-foreground mt-2 text-center">{img.caption}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-foreground/80 leading-relaxed max-w-3xl" data-testid="text-asset-description">
        {content.description}
      </p>
      {content.bullets.length > 0 && (
        <Card className="mt-8">
          <CardContent className="pt-6">
            <ul className="space-y-3">
              {content.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-foreground/80">{bullet}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <CtaSection />
      <ComplianceMicroline />
    </>
  );
}

function CaseStudyPage({ content }: { content: ContentPage }) {
  const cs = content.caseStudy!;
  const sections = [
    { label: "Snapshot", value: cs.snapshot, icon: <FileText className="w-5 h-5 text-primary" /> },
    { label: "Before", value: cs.before, icon: <AlertCircle className="w-5 h-5 text-destructive" /> },
    { label: "What We Changed", value: cs.changed, icon: <ShieldCheck className="w-5 h-5 text-primary" /> },
    { label: "After", value: cs.after, icon: <CheckCircle2 className="w-5 h-5 text-primary" /> },
  ];

  return (
    <>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight" data-testid="text-asset-title">
        {content.title}
      </h1>
      <p className="mt-2 text-lg text-muted-foreground" data-testid="text-asset-subtitle">
        {content.subtitle}
      </p>
      <p className="mt-6 text-foreground/80 leading-relaxed max-w-3xl" data-testid="text-asset-description">
        {content.description}
      </p>
      <div className="mt-8 space-y-4">
        {sections.map((section) => (
          <Card key={section.label}>
            <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
              {section.icon}
              <CardTitle className="text-lg">{section.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground/70 text-sm leading-relaxed">{section.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <CtaSection />
      <ComplianceMicroline />
    </>
  );
}

function PacketPage({ content }: { content: ContentPage }) {
  return (
    <>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight" data-testid="text-asset-title">
        {content.title}
      </h1>
      <p className="mt-2 text-lg text-muted-foreground" data-testid="text-asset-subtitle">
        {content.subtitle}
      </p>
      <p className="mt-6 text-foreground/80 leading-relaxed max-w-3xl" data-testid="text-asset-description">
        {content.description}
      </p>
      <div className="mt-8 space-y-3">
        {content.links!.map((link) => (
          <Link key={link.href} href={link.href} data-testid={`link-packet-resource-${link.href.split("/").pop()}`}>
            <Card className="hover-elevate cursor-pointer">
              <CardContent className="flex items-center gap-4 py-4">
                <CreditCard className="w-5 h-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{link.label}</p>
                  <p className="text-sm text-muted-foreground">{link.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 ml-auto" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <CtaSection />
      <ComplianceMicroline />
    </>
  );
}

function IndexPage({ content }: { content: ContentPage }) {
  return (
    <>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight" data-testid="text-asset-title">
        {content.title}
      </h1>
      <p className="mt-2 text-lg text-muted-foreground" data-testid="text-asset-subtitle">
        {content.subtitle}
      </p>
      <p className="mt-6 text-foreground/80 leading-relaxed max-w-3xl" data-testid="text-asset-description">
        {content.description}
      </p>
      <div className="mt-10 space-y-8">
        {content.categories!.map((category) => (
          <div key={category.name}>
            <div className="flex items-center gap-2 mb-3">
              {getIconForCategory(category.name)}
              <h2 className="text-xl font-semibold text-foreground">{category.name}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {category.items.map((item) => (
                <Link key={item.href} href={item.href} data-testid={`link-index-${item.href.split("/").pop()}`}>
                  <Card className="hover-elevate cursor-pointer">
                    <CardContent className="flex items-center gap-3 py-3">
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <CtaSection />
      <ComplianceMicroline />
    </>
  );
}

function NotFoundAsset() {
  return (
    <div className="text-center py-20">
      <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-foreground mb-2" data-testid="text-asset-not-found">Asset Not Found</h1>
      <p className="text-muted-foreground mb-6">The page you are looking for does not exist in the asset library.</p>
      <div className="flex items-center justify-center gap-4">
        <Link href="/assets" data-testid="link-back-to-assets">
          <Button variant="outline" className="gap-2">
            <FolderOpen className="w-4 h-4" />
            Browse Asset Library
          </Button>
        </Link>
        <Link href="/" data-testid="link-back-to-home">
          <Button className="gap-2">
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function AssetPage() {
  const [location] = useLocation();

  const path = location.replace(/\/$/, "") || "/assets";
  const content = contentMap[path];

  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-28 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {!content && <NotFoundAsset />}
          {content?.type === "standard" && <StandardPage content={content} />}
          {content?.type === "case-study" && <CaseStudyPage content={content} />}
          {content?.type === "packet" && <PacketPage content={content} />}
          {content?.type === "index" && <IndexPage content={content} />}
        </div>
      </main>
      <Footer />
    </div>
  );
}
