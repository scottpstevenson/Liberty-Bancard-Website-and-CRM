import { useState } from "react";
import { SEO } from "@/components/SEO";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import {
  Upload,
  Calendar,
  CheckCircle2,
  FileText,
  AlertCircle,
  ArrowRight,
  CreditCard,
  Monitor,
  Store,
  BarChart3,
  BookOpen,
  FolderOpen,
  Search,
} from "lucide-react";
import { CALENDAR_URL } from "@/lib/constants";
import { claimText } from "@shared/public-claims";
import imgCloverFlex3 from "@/assets/images/terminal-clover-flex-3.png";
import imgCloverMini3 from "@/assets/images/terminal-clover-mini-3.png";
import imgCloverStationDuo from "@/assets/images/terminal-clover-station-duo.png";
import imgPaxA920 from "@/assets/images/terminal-pax-a920.png";
import verticalMedical from "@/assets/images/vertical-medical.jpg";
import verticalAuto from "@/assets/images/vertical-auto.jpg";
import verticalRestaurant from "@/assets/images/vertical-restaurant.jpg";
import verticalHomeServices from "@/assets/images/vertical-home-services.jpg";
import verticalRetail from "@/assets/images/vertical-retail.jpg";
import statementReview from "@/assets/images/statement-review.jpg";
import securityUpload from "@/assets/images/security-upload.jpg";
import merchantOwner from "@/assets/images/merchant-owner.jpg";
import fundingDeposits from "@/assets/images/funding-deposits.jpg";
import hiddenFees from "@/assets/images/hidden-fees.jpg";
import zeroPercent from "@/assets/images/zero-percent.jpg";
import complianceChecklist from "@/assets/images/compliance-checklist.jpg";
import compareRates from "@/assets/images/compare-rates.jpg";
import goLiveChecklist from "@/assets/images/go-live-checklist.jpg";

interface ContentPage {
  title: string;
  subtitle: string;
  description: string;
  bullets: string[];
  type: "standard" | "packet" | "index";
  images?: { src: string; alt: string; caption?: string }[];
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
    description: "Access one-pagers, comparison guides, equipment resources and vertical-specific collateral to educate prospects before a statement review.",
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
          { href: "/assets/compare/beat-square-stripe", label: "Flat-Rate vs. Interchange-Plus" },
        ],
      },
      {
        name: "Terminal",
        items: [
          { href: "/assets/terminal/smart-terminal", label: "Terminal Options" },
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
          { href: "/assets/verticals/salon", label: "Salon / Beauty" },
          { href: "/assets/verticals/gym", label: "Gym / Fitness" },
          { href: "/assets/verticals/hotel", label: "Hotel / Hospitality" },
          { href: "/assets/verticals/legal", label: "Legal / Professional Services" },
          { href: "/assets/verticals/general", label: "General / Local Business" },
        ],
      },
    ],
  },

  "/assets/one-pagers/why-liberty": {
    title: "We Start With Your Statement.",
    subtitle: "Why Liberty Bancard Starts With a Statement Review",
    description: `${claimText("review.process.summary")} ${claimText("review.cost.free")}`,
    bullets: [
      claimText("review.cost.free"),
      "A line-by-line look at the fees on your statement",
      claimText("equipment.agreement.summary"),
      "Card brand rules and state law shape any cash discount or surcharge program",
    ],
    type: "standard",
    images: [{ src: merchantOwner, alt: "Business owner at their point of sale", caption: "A business owner at the point of sale." }],
  },

  "/assets/one-pagers/how-statement-review-works": {
    title: "What Happens After You Upload a Statement",
    subtitle: "Our Statement Review Process, Step by Step",
    description: claimText("review.process.summary"),
    bullets: [
      "Upload your most recent processing statement through the secure form",
      "We list the fees on your statement and explain what each one is",
      "We walk you through what we found, including costs outside the processing rate",
      claimText("review.cost.free"),
    ],
    type: "standard",
    images: [{ src: statementReview, alt: "Processing statement analysis on desk", caption: "A processing statement, reviewed line by line." }],
  },

  "/assets/one-pagers/funding-deposits-clarity": {
    title: "Funding & Deposits: What to Expect",
    subtitle: "How and When You Get Paid",
    description: "Funding timing depends on the account, its agreement and your bank. Ask for the schedule that applies to your account in writing before you decide.",
    bullets: [
      claimText("funding.availability"),
      "Ask for batch cutoff times and the settlement schedule that apply to the account",
      "Ask whether reserve policies apply and how they work",
      "Ask what the agreement says about holds and delayed deposits",
    ],
    type: "standard",
    images: [{ src: fundingDeposits, alt: "Business funding and cash flow management", caption: "Funding timing depends on the account and its terms." }],
  },

  "/assets/one-pagers/hidden-fees-checklist": {
    title: "Common Hidden Fees We Find on Merchant Statements",
    subtitle: "Know What to Look For",
    description: "Statements list many fees. This checklist covers fee types worth identifying on your own statement and asking about.",
    bullets: [
      "PCI-related fees: ask what they cover and whether they bill monthly or annually",
      "Batch, statement and gateway fees listed as separate lines",
      "Markup above interchange, shown as a rate, a per-transaction fee, or both",
      "Monthly minimum and annual fees listed in the agreement",
      "Equipment lease or rental charges, listed apart from processing fees",
    ],
    type: "standard",
    images: [{ src: hiddenFees, alt: "Analyzing merchant statement for hidden fees", caption: "A statement, checked line by line." }],
  },

  "/assets/security/statement-upload-safety": {
    title: "Statement Upload: Secure, Minimal, and Optional Redactions",
    subtitle: "Your Data Privacy Is Our Priority",
    description: "A review needs the fee summary and transaction totals from your statement. You can redact account numbers, merchant IDs and other sensitive details before uploading.",
    bullets: [
      "You may redact personally identifiable information before uploading",
      "A review needs the fee lines and volume totals",
      "Uploads use the secure form on the statement upload page",
      "Read the Privacy Policy for how information is used and kept",
    ],
    type: "standard",
    images: [{ src: securityUpload, alt: "Secure data protection and encryption", caption: "Redact sensitive details before you upload." }],
  },

  "/assets/0-percent/overview": {
    title: "'0% Processing' Has Rules.",
    subtitle: "Compliant Cash Discount and Surcharge Programs",
    description: "Cash discount and surcharge programs are subject to card brand rules and state law. Whether either fits a business depends on its location, card mix and agreement.",
    bullets: [
      "Card brand rules and state law set the requirements",
      "Signage, receipt language and disclosure requirements apply",
      "Cash discount and surcharge are different programs with different rules",
      "Eligibility depends on the location and the account; a statement review is where to start",
    ],
    type: "standard",
    images: [{ src: zeroPercent, alt: "Payment terminal", caption: "Rules for cash discount and surcharge programs." }],
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
    images: [{ src: complianceChecklist, alt: "Compliance checklist and requirements", caption: "Items to confirm before launching a program." }],
  },

  "/assets/compare/beat-square-stripe": {
    title: "Flat-Rate Is Convenient \u2014 Until You See the All-In Cost",
    subtitle: "Square & Stripe vs. Interchange-Plus Pricing",
    description: "Flat-rate processors publish one rate by plan and channel. Whether that costs more or less than another pricing model depends on your card mix, average ticket and fees outside the rate. A comparison on the same statement basis shows it.",
    bullets: [
      "Flat-rate: one published rate by plan and channel, regardless of card type",
      "Interchange-plus: card network costs are shown separately from the processor's markup",
      "Which costs less depends on card mix, average ticket and monthly fees",
      "Compare the all-in cost: rate, per-transaction fees, monthly fees and equipment",
      "Check each provider's current published pricing before comparing",
    ],
    type: "standard",
    images: [{ src: compareRates, alt: "Comparing flat-rate vs interchange-plus pricing", caption: "Compare pricing models on the same basis." }],
  },

  "/assets/terminal/smart-terminal": {
    title: "Terminal Options",
    subtitle: "What to Ask About Equipment",
    description: claimText("equipment.options.summary"),
    bullets: [
      "Payment types vary by model: chip, contactless, magstripe and QR support differ",
      "Connectivity varies by model, such as Wi-Fi, Ethernet or cellular",
      "Confirm point-of-sale and gateway compatibility before choosing a terminal",
      claimText("equipment.agreement.summary"),
    ],
    type: "standard",
    images: [
      { src: imgCloverFlex3, alt: "Clover Flex 3 handheld POS terminal", caption: "Clover Flex 3" },
      { src: imgCloverStationDuo, alt: "Clover Station Duo full register system", caption: "Clover Station Duo" },
      { src: imgCloverMini3, alt: "Clover Mini 3 compact countertop POS", caption: "Clover Mini 3" },
      { src: imgPaxA920, alt: "PAX A920 smart payment terminal", caption: "PAX A920" },
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
    images: [{ src: goLiveChecklist, alt: "Terminal setup preparation checklist", caption: "Items to check before the first transaction." }],
  },

  "/assets/verticals/medical": {
    title: "Medical/Dental/Medspa Processing",
    subtitle: "Payment Solutions for Healthcare Practices",
    description: "Healthcare practices handle higher-ticket payments, recurring billing and patient payment plans. A statement review looks at how those are priced and billed.",
    bullets: [
      "Ask how higher-ticket payments are priced on the statement",
      "Cash discount and surcharge programs have rules; eligibility varies by state and account",
      "Ask about funding timing in the agreement",
      "Terminal needs differ for front-desk and multi-location setups",
      "Ask how recurring billing and payment plans are charged",
    ],
    type: "standard",
    images: [{ src: verticalMedical, alt: "Medical office reception and payment area", caption: "A front desk where payments are taken." }],
  },

  "/assets/verticals/auto": {
    title: "Automotive Processing",
    subtitle: "Payment Solutions for Auto Shops and Dealers",
    description: "Automotive businesses process large repair orders and parts purchases. A statement review looks at how high-ticket payments are priced and whether invoice-based and keyed-entry payments cost more.",
    bullets: [
      "Ask how high-ticket repair orders are priced on the statement",
      "Ask about terminal support for invoice and keyed-entry transactions",
      "Cash discount and surcharge programs have rules; eligibility varies by state and account",
      "Ask about funding timing in the agreement",
      "Multi-bay and multi-location setups may need more than one terminal",
    ],
    type: "standard",
    images: [{ src: verticalAuto, alt: "Auto repair shop service bay", caption: "An auto repair service bay." }],
  },

  "/assets/verticals/restaurant": {
    title: "Restaurant Processing",
    subtitle: "Payment Solutions for Restaurants and Quick-Service",
    description: "Restaurants need fast authorization, reliable tip adjust and equipment that handles busy periods. A statement review looks at how tips, debit-heavy tickets and equipment are billed.",
    bullets: [
      "Ask how tip adjustment and pre-authorization are handled",
      "Ask what share of tickets are debit and how they are priced",
      "Cash discount and surcharge programs have rules; eligibility varies by state and account",
      "Confirm point-of-sale compatibility before choosing equipment",
    ],
    type: "standard",
    images: [{ src: verticalRestaurant, alt: "Restaurant dining area and service", caption: "A restaurant dining area." }],
  },

  "/assets/verticals/home-services": {
    title: "Home Services Processing",
    subtitle: "Payment Solutions for Field Service Businesses",
    description: "Home service providers need to take payments on-site and by phone. A statement review looks at how mobile, keyed-entry and invoice payments are billed.",
    bullets: [
      "Ask about mobile terminal options for on-site payment collection",
      "Ask about virtual terminal or invoice options for phone payments",
      "Ask about funding timing in the agreement",
      "Cash discount and surcharge programs have rules; eligibility varies by state and account",
      claimText("equipment.agreement.summary"),
    ],
    type: "standard",
    images: [{ src: verticalHomeServices, alt: "Home services technician on the job", caption: "A home services technician on the job." }],
  },

  "/assets/verticals/retail": {
    title: "Retail Processing",
    subtitle: "Payment Solutions for Retail Stores",
    description: "Retail merchants process many card-present transactions across card types. A statement review looks at how debit and credit are priced and what equipment costs.",
    bullets: [
      "Ask how debit and credit are priced separately on the statement",
      "Confirm contactless and chip acceptance on the equipment",
      "Cash discount and surcharge programs have rules; eligibility varies by state and account",
      "Ask about funding timing in the agreement",
      "Countertop and mobile terminal configurations are available options to ask about",
    ],
    type: "standard",
    images: [{ src: verticalRetail, alt: "Retail store checkout experience", caption: "A retail checkout counter." }],
  },

  "/assets/verticals/salon": {
    title: "Salon & Beauty Processing",
    subtitle: "Payment Solutions for Salons, Spas, and Beauty Studios",
    description: "Salons and beauty studios run a high volume of low-to-mid ticket transactions, often combined with deposits, memberships, or card-on-file booking. A statement review typically focuses on whether debit transactions are billed at a flat rate instead of true interchange, and whether recurring/booking fees are itemized clearly.",
    bullets: [
      "Ask what percentage of tickets are debit cards — flat-rate pricing can cost more on debit-heavy mixes depending on the plan",
      "Confirm how deposits, cancellation fees, and memberships are currently processed",
      "Tip-adjust accuracy matters for stylist and technician payroll reconciliation",
      "Compliant 0% / dual-pricing programs may apply for service-based tickets — verify eligibility before quoting",
      "Statement review angle: look for a PCI non-compliance fee and separately billed gateway/booking-platform fees",
    ],
    type: "standard",
  },

  "/assets/verticals/gym": {
    title: "Gym & Fitness Processing",
    subtitle: "Payment Solutions for Gyms, Studios, and Fitness Centers",
    description: "Gyms and fitness studios depend on reliable recurring membership billing, so decline/retry handling and chargeback support for cancelled memberships matter as much as per-transaction rate. A statement review should separate recurring-billing/ACH fees from card-present terminal fees, since they're often billed differently.",
    bullets: [
      "Ask which recurring billing platform is used and whether it's billed separately from card-present processing",
      "Confirm current decline/retry logic for expired or replaced membership cards",
      "Chargeback volume from cancelled memberships is common — ask about current dispute support",
      "Compliant 0% / dual-pricing programs may apply for walk-in or day-pass transactions — verify eligibility before quoting",
      "Statement review angle: check for a monthly minimum fee on lower-volume locations",
    ],
    type: "standard",
  },

  "/assets/verticals/hotel": {
    title: "Hotel & Hospitality Processing",
    subtitle: "Payment Solutions for Hotels, Inns, and Short-Term Lodging",
    description: "Hospitality merchants deal with pre-authorizations, incidental holds, higher-than-average tickets, and a heavier mix of corporate/rewards cards, which typically carry higher interchange. A statement review should confirm whether the current provider is billing those cards at a padded non-qualified rate instead of passing through actual interchange.",
    bullets: [
      "Ask about current pre-auth and no-show/incidental hold handling",
      "Corporate and rewards cards carry higher interchange — confirm whether the current statement shows a 'non-qualified' surcharge on them",
      "Property management system (PMS) or booking engine integration needs should be scoped before recommending a terminal or gateway",
      "Seasonal volume swings may affect which pricing structure makes sense — ask about peak vs. off-season volume",
      "Statement review angle: check for stacked gateway, PCI, and batch fees common on legacy hospitality processors",
    ],
    type: "standard",
  },

  "/assets/verticals/legal": {
    title: "Legal & Professional Services Processing",
    subtitle: "Payment Solutions for Law Firms, CPAs, and Consultants",
    description: "Legal and professional-services firms tend to have lower transaction volume but higher average tickets, invoice-based billing, and in some cases trust or IOLTA accounts. A statement review should flag monthly minimum fees on low-volume accounts, and any trust-account processing question should be routed to the firm's own compliance/bar guidance before recommending a setup.",
    bullets: [
      "Ask whether the firm operates a trust or IOLTA account — fees should never be deducted directly from trust balances; confirm the firm's own compliance requirements before proposing a structure",
      "Invoice-based and virtual terminal billing is common — confirm how retainers and one-time invoices are currently collected",
      "Lower transaction volume can mean a flat monthly minimum fee may be raising the effective rate — check for one on the statement",
      "Ask about current keyed-entry vs. card-present mix, since keyed rates are usually higher",
      "Statement review angle: confirm whether recurring retainer billing is itemized separately from one-time invoice payments",
    ],
    type: "standard",
  },

  "/assets/verticals/general": {
    title: "General & Local Business Processing",
    subtitle: "Payment Solutions for Any Local Business",
    description: "For verticals not covered by a dedicated packet, the fundamentals of a good statement review still apply: identify the actual interchange-plus cost versus what's being billed, flag junk and non-compliance fees, and confirm whether a compliant 0% or terminal upgrade makes sense for this specific business. Use this packet as a starting point and pull in vertical-specific materials once the business type is confirmed.",
    bullets: [
      "Request the merchant's most recent processing statement before quoting anything",
      "Look for common junk fees: PCI non-compliance, statement fee, batch fee, or an unexplained gateway fee",
      "Confirm current debit vs. credit mix — flat-rate pricing can cost more on debit-heavy businesses depending on the plan",
      "Ask whether a compliant 0% / dual-pricing program or a terminal upgrade fits this business's transaction style",
      "If a more specific vertical becomes clear (restaurant, medical, retail, etc.), switch to that packet for more targeted talking points",
    ],
    type: "standard",
  },


  "/packet/statement-review": {
    title: "Statement Review Packet",
    subtitle: "Everything a Prospect Needs to Understand Our Review Process",
    description: "This packet contains key resources on how the statement review works and which fee types to look for. Share these before or after a statement upload.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/one-pagers/why-liberty", label: "Why Liberty Bancard", description: "Why the review starts with your statement." },
      { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works", description: "How the statement review works." },
      { href: "/assets/one-pagers/hidden-fees-checklist", label: "Hidden Fees Checklist", description: "Fee types worth identifying on a statement." },
    ],
  },

  "/packet/estimate": {
    title: "Estimate Packet",
    subtitle: "Resources for Prospects Requesting a Cost Estimate",
    description: "Share these resources with merchants who want to understand pricing and funding before committing. Covers the review process and what to expect from deposits and settlement.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works", description: "How the statement review works." },
      { href: "/assets/one-pagers/funding-deposits-clarity", label: "Funding & Deposits Clarity", description: "What to ask about funding and deposit timing." },
    ],
  },

  "/packet/0-percent": {
    title: "0% Processing Packet",
    subtitle: "Resources for Merchants Considering Cash Discount or Surcharge Programs",
    description: "This packet explains the rules around cash discount and surcharge programs, including legal and card brand requirements. Share with merchants evaluating cash discount or surcharge programs.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "The rules that apply to cash discount and surcharge programs." },
      { href: "/assets/0-percent/compliance-checklist", label: "Compliance Checklist", description: "Requirements for signage, receipts, and state eligibility." },
    ],
  },

  "/packet/terminal": {
    title: "Terminal Packet",
    subtitle: "Resources for Terminal Deployment and Setup",
    description: "Equipment questions to ask and a pre-launch checklist for connectivity, testing and training.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/terminal/smart-terminal", label: "Terminal Options", description: "What to ask about equipment, payment types and agreement terms." },
      { href: "/assets/terminal/go-live-checklist", label: "Go-Live Checklist", description: "Pre-launch steps for connectivity, testing and training." },
    ],
  },

  "/packet/beat-square-stripe": {
    title: "Beat Square & Stripe Packet",
    subtitle: "Competitive Comparison Resources",
    description: "Use this packet when speaking with merchants currently on Square or Stripe. The comparison guide explains flat-rate and interchange-plus pricing so the all-in cost can be compared on the same basis.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/compare/beat-square-stripe", label: "Flat-Rate vs. Interchange-Plus", description: "How to compare flat-rate and interchange-plus pricing." },
    ],
  },

  "/packet/medical": {
    title: "Medical Vertical Packet",
    subtitle: "Payment Processing Resources for Healthcare Practices",
    description: "Tailored resources for medical, dental, and medspa practices. Covers how higher-ticket payments are billed and the rules around cash discount and surcharge programs.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/medical", label: "Medical Processing Overview", description: "Statement review questions for healthcare payment workflows." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Rules for cash discount and surcharge programs." },
    ],
  },

  "/packet/auto": {
    title: "Automotive Vertical Packet",
    subtitle: "Payment Processing Resources for Auto Shops and Dealers",
    description: "Resources for automotive businesses processing high-ticket repair orders and parts sales. Covers how high-ticket payments are billed and equipment options.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/auto", label: "Automotive Processing Overview", description: "Statement review questions for auto shops and dealers." },
      { href: "/assets/terminal/smart-terminal", label: "Terminal Options", description: "Equipment options and what to ask about them." },
    ],
  },

  "/packet/restaurant": {
    title: "Restaurant Vertical Packet",
    subtitle: "Payment Processing Resources for Restaurants",
    description: "Resources for restaurants and quick-service environments. Covers tip adjustment, authorization and how debit-heavy tickets are billed.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/restaurant", label: "Restaurant Processing Overview", description: "Statement review questions for dine-in and counter service." },
      { href: "/assets/terminal/smart-terminal", label: "Terminal Options", description: "Equipment options and what to ask about them." },
    ],
  },

  "/packet/home-services": {
    title: "Home Services Vertical Packet",
    subtitle: "Payment Processing Resources for Field Service Businesses",
    description: "Resources for contractors, HVAC, plumbing, and other field service businesses. Covers mobile payment options and how field payments are billed.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/home-services", label: "Home Services Processing Overview", description: "Statement review questions for mobile and field-based businesses." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Rules for cash discount and surcharge programs." },
    ],
  },

  "/packet/retail": {
    title: "Retail Vertical Packet",
    subtitle: "Payment Processing Resources for Retail Stores",
    description: "Resources for retail merchants processing high volumes of card-present transactions. Covers how debit and credit are billed and equipment options.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/retail", label: "Retail Processing Overview", description: "Statement review questions for high-volume retail." },
      { href: "/assets/terminal/smart-terminal", label: "Terminal Options", description: "Equipment options and what to ask about them." },
    ],
  },

  "/packet/salon": {
    title: "Salon / Beauty Vertical Packet",
    subtitle: "Payment Processing Resources for Salons and Beauty Studios",
    description: "Resources for salons, spas, and beauty studios processing a high volume of low-to-mid ticket transactions with deposits and memberships.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/salon", label: "Salon Processing Overview", description: "Talking points for debit-heavy, deposit-driven ticket mixes." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Rules for cash discount and surcharge programs, where eligible." },
    ],
  },

  "/packet/gym": {
    title: "Gym / Fitness Vertical Packet",
    subtitle: "Payment Processing Resources for Gyms and Fitness Studios",
    description: "Resources for gyms and fitness studios that depend on recurring membership billing and card-on-file reliability.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/gym", label: "Gym & Fitness Processing Overview", description: "Talking points for recurring billing and chargeback support." },
      { href: "/assets/0-percent/overview", label: "0% Processing Overview", description: "Rules for cash discount and surcharge programs, where eligible." },
    ],
  },

  "/packet/hotel": {
    title: "Hotel / Hospitality Vertical Packet",
    subtitle: "Payment Processing Resources for Hotels and Lodging",
    description: "Resources for hotels, inns, and short-term lodging businesses managing pre-auths, incidental holds, and higher-ticket corporate/rewards card mixes.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/hotel", label: "Hotel & Hospitality Processing Overview", description: "Talking points for pre-auths, corporate cards, and PMS integration." },
      { href: "/assets/terminal/smart-terminal", label: "Terminal Options", description: "Equipment options and what to ask about them." },
    ],
  },

  "/packet/legal": {
    title: "Legal / Professional Services Vertical Packet",
    subtitle: "Payment Processing Resources for Law Firms and Professional Services",
    description: "Resources for law firms, CPAs, and consultants with invoice-based billing and lower transaction volume.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/legal", label: "Legal & Professional Services Processing Overview", description: "Talking points for trust accounts, invoicing, and monthly minimums." },
      { href: "/assets/one-pagers/how-statement-review-works", label: "How Statement Review Works", description: "How the statement review works." },
    ],
  },

  "/packet/general": {
    title: "General / Local Business Packet",
    subtitle: "Payment Processing Resources for Any Local Business",
    description: "Default packet for verticals without a dedicated collateral set. Covers the fundamentals of a statement review and program fit, applicable to any local business.",
    bullets: [],
    type: "packet",
    links: [
      { href: "/assets/verticals/general", label: "General & Local Business Processing Overview", description: "Universal statement-review talking points." },
      { href: "/assets/one-pagers/why-liberty", label: "Why Liberty Bancard", description: "Why the review starts with your statement." },
      { href: "/assets/one-pagers/hidden-fees-checklist", label: "Hidden Fees Checklist", description: "Fee types worth identifying on a statement." },
    ],
  },
};

function getIconForCategory(name: string) {
  switch (name) {
    case "Start Here": return <BookOpen className="w-5 h-5 text-primary" />;
    case "Programs + Competitive": return <BarChart3 className="w-5 h-5 text-primary" />;
    case "Terminal": return <Monitor className="w-5 h-5 text-primary" />;
    case "Verticals": return <Store className="w-5 h-5 text-primary" />;
    default: return <FolderOpen className="w-5 h-5 text-primary" />;
  }
}

function CtaSection() {
  return (
    <section className="mt-12 border-t border-border pt-10">
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <Button className="gap-2" asChild>
          <Link href="/upload-statement" data-testid="link-cta-upload">
            <Upload className="w-4 h-4" />
            Upload Statement
          </Link>
        </Button>
        <Button variant="outline" className="gap-2" asChild>
          <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-cta-book-call">
            <Calendar className="w-4 h-4" />
            Book a review call
          </a>
        </Button>
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
  const [query, setQuery] = useState("");

  const filteredCategories = content.categories!.map((category) => ({
    ...category,
    items: category.items.filter((item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      category.name.toLowerCase().includes(query.toLowerCase())
    ),
  })).filter((category) => category.items.length > 0);

  const totalItems = content.categories!.reduce((sum, c) => sum + c.items.length, 0);

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

      <div className="mt-8 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={`Search ${totalItems} resources…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 max-w-md"
          data-testid="input-asset-search"
        />
      </div>

      <div className="mt-8 space-y-8">
        {filteredCategories.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center" data-testid="text-no-results">
            No resources matched "<span className="font-medium">{query}</span>". Try a different search term.
          </p>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.name}>
              <div className="flex items-center gap-2 mb-3">
                {getIconForCategory(category.name)}
                <h2 className="text-xl font-semibold text-foreground">{category.name}</h2>
                <span className="text-xs text-muted-foreground ml-1">({category.items.length})</span>
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
          ))
        )}
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
        <Button variant="outline" className="gap-2" asChild>
          <Link href="/assets" data-testid="link-back-to-assets">
            <FolderOpen className="w-4 h-4" />
            Browse Asset Library
          </Link>
        </Button>
        <Button className="gap-2" asChild>
          <Link href="/" data-testid="link-back-to-home">
            Go Home
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function AssetPage() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isEmployee = user?.role === "admin" || user?.role === "manager" || user?.role === "agent";

  const path = location.replace(/\/$/, "") || "/assets";
  const content = contentMap[path];

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Sales Asset" description="Liberty Bancard sales enablement asset for prospect education and proposal walkthroughs." path="/assets" noindex />
      <Navbar />
      <main className="flex-grow public-main-offset pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {isEmployee && (
            <p className="mb-4 text-sm text-muted-foreground" data-testid="link-assets-return-to-crm">
              This is the public sales library. <Link href="/dashboard/knowledge-base" className="underline underline-offset-2">Back to Resources</Link>
            </p>
          )}
          {!content && <NotFoundAsset />}
          {content?.type === "standard" && <StandardPage content={content} />}
          {content?.type === "packet" && <PacketPage content={content} />}
          {content?.type === "index" && <IndexPage content={content} />}
        </div>
      </main>
      <Footer />
    </div>
  );
}
