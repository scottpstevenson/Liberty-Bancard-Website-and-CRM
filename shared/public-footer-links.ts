/**
 * Public footer link groups, shared by the React footer and the server-rendered footer so both
 * surfaces expose the same destinations. Four groups (Services, Industries, Company & Resources,
 * Legal); contact details and the do-not-sell notice are rendered separately by each footer.
 *
 * The three staff-only dashboard shortcuts that used to sit in the public footer (pipeline, tickets,
 * AI advisors) are intentionally gone: the footer carries a single "Staff Login" entry.
 */
export interface PublicFooterLink {
  label: string;
  href: string;
}

export interface PublicFooterGroup {
  id: "services" | "industries" | "company" | "legal";
  label: string;
  links: PublicFooterLink[];
}

export const PUBLIC_FOOTER_GROUPS: PublicFooterGroup[] = [
  {
    id: "services",
    label: "Services",
    links: [
      { label: "Cash Discount & Surcharging", href: "/0-percent-processing" },
      { label: "Compare Rates", href: "/compare-rates" },
      { label: "Beat Square & Stripe", href: "/beat-square-stripe" },
      { label: "vs Square", href: "/compare/square" },
      { label: "vs Stripe", href: "/compare/stripe" },
      { label: "vs Clover", href: "/compare/clover" },
      { label: "vs Toast", href: "/compare/toast" },
      { label: "vs PayPal", href: "/compare/paypal" },
      { label: "Terminal Shop", href: "/shop" },
      { label: "Get My Free Analysis", href: "/free-analysis" },
      { label: "Upload Statement", href: "/upload-statement" },
      { label: "Quick Estimate", href: "/estimate" },
      { label: "Savings Calculator", href: "/savings-calculator" },
      { label: "Processing Cost Quiz", href: "/quiz/processing-cost" },
      { label: "Get Started", href: "/get-started" },
      { label: "Merchant Application", href: "/merchant-application" },
    ],
  },
  {
    id: "industries",
    label: "Industries",
    links: [
      { label: "Restaurant", href: "/industries/restaurant-payment-processing" },
      { label: "Retail", href: "/industries/retail-payment-processing" },
      { label: "Healthcare", href: "/industries/healthcare-payment-processing" },
      { label: "Salon & Spa", href: "/industries/salon-spa-payment-processing" },
      { label: "Auto Repair", href: "/industries/auto-repair-payment-processing" },
      { label: "Professional Services", href: "/industries/professional-services-payment-processing" },
      { label: "E-Commerce", href: "/industries/ecommerce-payment-processing" },
      { label: "Construction", href: "/industries/construction-payment-processing" },
    ],
  },
  {
    id: "company",
    label: "Company & Resources",
    links: [
      { label: "Home", href: "/" },
      { label: "About & Contact", href: "/about-contact" },
      { label: "Why Liberty Bancard", href: "/why-liberty-bancard" },
      { label: "Case Studies", href: "/case-studies" },
      { label: "Areas We Serve", href: "/areas-served" },
      { label: "Support", href: "/support" },
      { label: "Help Center", href: "/help" },
      { label: "FAQ", href: "/faq" },
      { label: "All Articles", href: "/blog" },
      { label: "Hidden Fees Guide", href: "/blog/hidden-fees-payment-processing-guide" },
      { label: "PCI Compliance Checklist", href: "/blog/pci-compliance-checklist-small-business" },
      { label: "Interchange Plus vs Flat Rate", href: "/blog/interchange-plus-vs-flat-rate" },
      { label: "ISO & Partner Program", href: "/partners" },
      { label: "Become a Partner", href: "/partners#apply" },
      { label: "Residual Income Calculator", href: "/partners#calculator" },
      { label: "Partner Portal Login", href: "/partner-portal" },
      { label: "Affiliate Program", href: "/affiliate" },
      { label: "Staff Login", href: "/dashboard" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookie Policy", href: "/cookie-policy" },
      { label: "Advertising Disclosure", href: "/advertising-disclosure" },
      { label: "Accessibility", href: "/accessibility" },
      { label: "SMS Terms", href: "/sms-terms" },
      { label: "E-Sign Consent", href: "/esign-consent" },
      { label: "Surcharging Disclosure", href: "/surcharging-disclosure" },
      { label: "Merchant Policies", href: "/merchant-policies" },
      { label: "Security & Compliance", href: "/security-compliance" },
      { label: "Regulatory Notices", href: "/regulatory-notices" },
      { label: "Data Processing Agreement", href: "/data-processing-agreement" },
      { label: "Responsible AI", href: "/responsible-ai" },
      { label: "Testimonials Disclosure", href: "/testimonials-disclosure" },
      { label: "Law Enforcement Guidelines", href: "/law-enforcement" },
      { label: "Dispute Resolution", href: "/dispute-resolution" },
      { label: "Data Retention", href: "/data-retention" },
      { label: "TCPA Consent", href: "/tcpa-consent" },
      { label: "Refund Policy", href: "/refund-policy" },
      { label: "California Privacy (CCPA)", href: "/california-privacy" },
      { label: "ADA Compliance", href: "/ada-compliance" },
    ],
  },
];
