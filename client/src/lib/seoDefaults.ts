/**
 * Per-route SEO defaults used by the audit/health surface and as a
 * fallback for pages that don't override metadata explicitly.
 *
 * Keep titles 50-60 chars and descriptions 140-160 chars.
 */

export interface SEODefault {
  title: string;
  description: string;
  keywords?: string;
  ogTemplate?: "default" | "article" | "industry" | "compare" | "location" | "service";
  noindex?: boolean;
}

export const SEO_DEFAULTS: Record<string, SEODefault> = {
  "/": {
    title: "Merchant Payment Processing",
    description:
      "Transparent, statement-based credit card processing. Upload your statement for a free, line-by-line analysis from Liberty Bancard.",
    keywords:
      "payment processing, merchant services, credit card processing, interchange-plus pricing",
    ogTemplate: "default",
  },
  "/get-started": {
    title: "Get Started With Liberty Bancard",
    description:
      "Start your merchant account application or get a free processing review. Three quick paths: upload, calculate, or talk to a human.",
    ogTemplate: "default",
  },
  "/upload-statement": {
    title: "Upload Your Processing Statement",
    description:
      "Upload your current processing statement and get a free, line-by-line breakdown. Keep the analysis even if you don't switch.",
    ogTemplate: "service",
  },
  "/free-analysis": {
    title: "Free Merchant Statement Analysis",
    description:
      "Get a no-cost line-by-line breakdown of your processing statement. See your true effective rate and where money is leaking.",
    ogTemplate: "service",
  },
  "/0-percent-processing": {
    title: "Zero-Percent Processing Programs",
    description:
      "Cash discount and dual pricing programs that reduce your effective processing cost to near-zero. Compliant in all 50 states.",
    ogTemplate: "service",
  },
  "/beat-square-stripe": {
    title: "Pay Less Than Square or Stripe",
    description:
      "Square and Stripe charge flat rates that overpay on most cards. See how interchange-plus pricing typically saves $1,800–$6,100/yr.",
    ogTemplate: "compare",
  },
  "/about-contact": {
    title: "About Liberty Bancard & Contact",
    description:
      "Liberty Bancard is a transparent payment processing partner serving 5,000+ merchants. Talk to a real human in South Florida.",
    ogTemplate: "default",
  },
  "/estimate": {
    title: "Quick Processing Cost Estimate",
    description:
      "Estimate your true effective rate from your monthly volume and fees. Backed by interchange tables and live benchmarks.",
    ogTemplate: "service",
  },
  "/support": {
    title: "Merchant Support & Help",
    description:
      "Real-human merchant support, 24/7 emergency response. Open a ticket or call us — most issues resolved on first contact.",
    ogTemplate: "default",
  },
  "/savings-calculator": {
    title: "Payment Processing Savings Calculator",
    description:
      "Plug in your volume and current fees to see annual savings vs interchange-plus pricing. No email required to view results.",
    ogTemplate: "service",
  },
  "/compare-rates": {
    title: "Compare Processing Rates Side-By-Side",
    description:
      "See Liberty Bancard's interchange-plus pricing next to Square, Stripe, Clover, Toast, and PayPal. Built from public rate cards.",
    ogTemplate: "compare",
  },
  "/blog": {
    title: "Payment Processing Insights",
    description:
      "Free guides on processing fees, interchange, PCI, statements, and switching processors — written for business owners.",
    ogTemplate: "default",
  },
  "/faq": {
    title: "Payment Processing FAQ",
    description:
      "30+ answers on interchange-plus pricing, cash discount, PCI compliance, switching processors, equipment, and more.",
    ogTemplate: "default",
  },
  "/affiliate": {
    title: "Affiliate Program",
    description:
      "Refer businesses to Liberty Bancard and earn ongoing residual commissions. Tiered payouts, transparent reporting, real-time dashboard.",
    ogTemplate: "default",
  },
  "/why-liberty-bancard": {
    title: "Why Liberty Bancard",
    description:
      "Statement-based pricing, real human support, no junk fees. The reasons 5,000+ merchants trust Liberty Bancard with their processing.",
    ogTemplate: "default",
  },
  "/equipment": {
    title: "POS Terminals & Equipment",
    description:
      "Clover, Dejavoo, PAX, and Valor terminals plus virtual terminal access. Buy outright — no leases, no junk fees.",
    ogTemplate: "default",
  },
  "/case-studies": {
    title: "Customer Case Studies",
    description:
      "Real merchants who reduced processing costs and modernized payment acceptance with Liberty Bancard. Numbers and quotes included.",
    ogTemplate: "default",
  },
  "/testimonials": {
    title: "Merchant Testimonials & Reviews",
    description:
      "What 5,000+ merchants say about Liberty Bancard's pricing, support, and onboarding. Verified reviews across industries.",
    ogTemplate: "default",
  },
  "/testimonials/submit": {
    title: "Submit a Testimonial",
    description:
      "Share your Liberty Bancard experience. Submissions help fellow business owners decide on the right processor.",
    ogTemplate: "default",
  },
  "/integrations": {
    title: "POS & Software Integrations",
    description:
      "Liberty Bancard integrates with leading POS systems, gateways, and accounting tools. See the full integration catalog.",
    ogTemplate: "default",
  },
  "/compare/square": {
    title: "Liberty Bancard vs Square",
    description:
      "Side-by-side: Square's flat 2.6% + $0.10 vs Liberty Bancard's interchange-plus pricing. Most merchants save $1,800–$4,200/yr.",
    ogTemplate: "compare",
  },
  "/compare/stripe": {
    title: "Liberty Bancard vs Stripe",
    description:
      "Stripe charges 2.9% + $0.30 online. Compare against Liberty Bancard's interchange-plus pricing for typical $3,000–$5,400/yr savings.",
    ogTemplate: "compare",
  },
  "/compare/clover": {
    title: "Liberty Bancard vs Clover",
    description:
      "Liberty Bancard supports Clover hardware while delivering interchange-plus pricing — without locking you into Clover's processor.",
    ogTemplate: "compare",
  },
  "/compare/toast": {
    title: "Liberty Bancard vs Toast",
    description:
      "Toast bundles POS and processing. Compare Liberty Bancard's flexible processing with restaurant-grade reporting and lower fees.",
    ogTemplate: "compare",
  },
  "/compare/paypal": {
    title: "Liberty Bancard vs PayPal",
    description:
      "PayPal's flat-rate model overpays on cards with low interchange. See how interchange-plus pricing wins for most merchants.",
    ogTemplate: "compare",
  },
  "/merchant-application": {
    title: "Merchant Account Application",
    description:
      "Apply for a Liberty Bancard merchant account. Most applications approved within 24-48 hours. E-signature included.",
    ogTemplate: "service",
  },
  "/partners": {
    title: "ISO & Partner Program",
    description:
      "Earn residual income referring merchants to Liberty Bancard. Built for ISOs, CPAs, bookkeepers, and trusted advisors.",
    ogTemplate: "default",
  },
  "/help": {
    title: "Help Center & Knowledge Base",
    description:
      "Find answers on account setup, billing, terminals, compliance, and more. Searchable knowledge base for Liberty Bancard merchants.",
    ogTemplate: "default",
  },
  "/sales-tools": {
    title: "Sales Tools Hub",
    description: "Internal sales tools and collateral hub.",
    noindex: true,
  },
  // Auth pages — noindex
  "/login": { title: "Sign In", description: "Sign in to your Liberty Bancard dashboard.", noindex: true },
  "/signup": { title: "Create Account", description: "Create a Liberty Bancard account.", noindex: true },
  "/forgot-password": { title: "Reset Your Password", description: "Reset your Liberty Bancard password.", noindex: true },
  "/reset-password": { title: "Set a New Password", description: "Set a new password for your Liberty Bancard account.", noindex: true },
  "/verify-email": { title: "Verify Your Email", description: "Verify your Liberty Bancard email address.", noindex: true },
  // Thank-you pages — noindex
  "/thanks-statement": { title: "Statement Received", description: "We received your statement and will follow up shortly.", noindex: true },
  "/thanks-estimate": { title: "Estimate Received", description: "We received your estimate request and will follow up shortly.", noindex: true },
  "/thanks-call": { title: "Call Request Received", description: "We received your callback request and will reach out shortly.", noindex: true },
  "/thanks-support": { title: "Support Request Received", description: "We received your support request and will respond shortly.", noindex: true },
  "/thanks/application": { title: "Application Received", description: "We received your merchant application. Next steps inside.", noindex: true },
  // Compliance / legal
  "/privacy-policy": { title: "Privacy Policy", description: "How Liberty Bancard collects, uses, and protects merchant and visitor data." },
  "/terms": { title: "Terms of Service", description: "Terms governing use of Liberty Bancard's website, apps, and processing services." },
  "/cookie-policy": { title: "Cookie Policy", description: "What cookies and similar technologies we use, and how to manage them." },
  "/advertising-disclosure": { title: "Advertising Disclosure", description: "How Liberty Bancard discloses advertising relationships and affiliate compensation." },
  "/accessibility": { title: "Accessibility Statement", description: "Liberty Bancard's commitment to digital accessibility and how to request accommodations." },
  "/sms-terms": { title: "SMS Messaging Terms", description: "Terms governing SMS notifications from Liberty Bancard, including opt-out instructions." },
  "/esign-consent": { title: "E-Signature Consent", description: "Your consent to receive and sign documents electronically with Liberty Bancard." },
  "/surcharging-disclosure": { title: "Surcharging Disclosure", description: "How Liberty Bancard's surcharging programs comply with card brand and state rules." },
  "/merchant-policies": { title: "Merchant Policies", description: "Liberty Bancard merchant operating policies, prohibited businesses, and risk guidelines." },
  "/regulatory-notices": { title: "Regulatory Notices", description: "Required regulatory disclosures for Liberty Bancard merchants and visitors." },
  "/security-compliance": { title: "Security & Compliance", description: "PCI DSS compliance, encryption, tokenization, and security practices at Liberty Bancard." },
  "/do-not-sell": { title: "Do Not Sell My Information", description: "Opt out of the sale or sharing of your personal information under California privacy laws." },
  "/data-processing-agreement": { title: "Data Processing Agreement", description: "Liberty Bancard's data processing agreement for merchants and partners." },
  "/responsible-ai": { title: "Responsible AI Commitments", description: "How Liberty Bancard uses AI responsibly across sales, support, and compliance workflows." },
  "/testimonials-disclosure": { title: "Testimonials Disclosure", description: "How Liberty Bancard collects and presents merchant testimonials and reviews." },
  "/law-enforcement": { title: "Law Enforcement Guidelines", description: "Process for law enforcement requests for Liberty Bancard merchant or user records." },
  "/dispute-resolution": { title: "Dispute Resolution", description: "How disputes between Liberty Bancard and merchants or users are resolved." },
  "/data-retention": { title: "Data Retention Policy", description: "How long Liberty Bancard retains merchant, visitor, and processing data." },
  "/tcpa-consent": { title: "TCPA Consent Notice", description: "TCPA consent terms governing automated calls and texts from Liberty Bancard." },
  "/refund-policy": { title: "Refund Policy", description: "Refund eligibility for Liberty Bancard subscription, equipment, and services." },
  "/california-privacy": { title: "California Privacy Rights", description: "Liberty Bancard's CCPA/CPRA disclosures for California consumers." },
  "/ada-compliance": { title: "ADA & WCAG Compliance", description: "Liberty Bancard's ADA compliance commitment and accommodation request process." },
};

export const PUBLIC_ROUTES = Object.keys(SEO_DEFAULTS);
