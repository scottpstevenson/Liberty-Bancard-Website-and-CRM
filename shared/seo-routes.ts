/**
 * Single source of truth for per-route SEO defaults.
 *
 * Imported by both the SPA (client/src/lib/seoDefaults.ts re-exports
 * SEO_DEFAULTS) and the server (/api/admin/seo-coverage and the
 * scripts/seo-audit.ts CI script). Keeping one map prevents drift
 * between what the admin dashboard reports and what pages actually
 * render.
 *
 * Title length target: 50-60 chars. Description target: 140-160 chars.
 */

export interface SeoRouteDefault {
  title: string;
  description: string;
  keywords?: string;
  ogTemplate?: "default" | "article" | "industry" | "compare" | "location" | "service";
  noindex?: boolean;
  inSitemap?: boolean;
}

export const SEO_ROUTE_DEFAULTS: Record<string, SeoRouteDefault> = {
  "/": { title: "Merchant Payment Processing", description: "Transparent, statement-based credit card processing. Upload your statement for a free, line-by-line analysis from Liberty Bancard.", keywords: "payment processing, merchant services, credit card processing, interchange-plus pricing", ogTemplate: "default", inSitemap: true },
  "/get-started": { title: "Get Started With Liberty Bancard", description: "Start your merchant account application or get a free processing review. Three quick paths: upload, calculate, or talk to a human.", ogTemplate: "default", inSitemap: true },
  "/upload-statement": { title: "Upload Your Processing Statement", description: "Upload your current processing statement and get a free, line-by-line breakdown. Keep the analysis even if you don't switch.", ogTemplate: "service", inSitemap: true },
  "/free-analysis": { title: "Free Merchant Statement Analysis", description: "Get a no-cost line-by-line breakdown of your processing statement. See your true effective rate and where money is leaking.", ogTemplate: "service", inSitemap: true },
  "/0-percent-processing": { title: "Zero-Percent Processing Programs", description: "Cash discount and dual pricing programs that reduce your effective processing cost to near-zero. Compliant in all 50 states.", ogTemplate: "service", inSitemap: true },
  "/beat-square-stripe": { title: "Pay Less Than Square or Stripe", description: "Square and Stripe charge flat rates that overpay on most cards. See how interchange-plus pricing typically saves $1,800–$6,100/yr.", ogTemplate: "compare", inSitemap: true },
  "/about-contact": { title: "About Liberty Bancard & Contact", description: "Liberty Bancard is a transparent payment processing partner serving 5,000+ merchants. Talk to a real human in South Florida.", ogTemplate: "default", inSitemap: true },
  "/estimate": { title: "Quick Processing Cost Estimate", description: "Estimate your true effective rate from your monthly volume and fees. Backed by interchange tables and live benchmarks.", ogTemplate: "service", inSitemap: true },
  "/support": { title: "Merchant Support & Help", description: "Real-human merchant support, 24/7 emergency response. Open a ticket or call us — most issues resolved on first contact.", ogTemplate: "default", inSitemap: true },
  "/savings-calculator": { title: "Payment Processing Savings Calculator", description: "Plug in your volume and current fees to see annual savings vs interchange-plus pricing. No email required to view results.", ogTemplate: "service", inSitemap: true },
  "/compare-rates": { title: "Compare Processing Rates Side-By-Side", description: "See Liberty Bancard's interchange-plus pricing next to Square, Stripe, Clover, Toast, and PayPal. Built from public rate cards.", ogTemplate: "compare", inSitemap: true },
  "/blog": { title: "Payment Processing Insights", description: "Free guides on processing fees, interchange, PCI, statements, and switching processors — written for business owners.", ogTemplate: "default", inSitemap: true },
  "/faq": { title: "Payment Processing FAQ", description: "30+ answers on interchange-plus pricing, cash discount, PCI compliance, switching processors, equipment, and more.", ogTemplate: "default", inSitemap: true },
  "/affiliate": { title: "Affiliate Program", description: "Refer businesses to Liberty Bancard and earn ongoing residual commissions. Tiered payouts, transparent reporting, real-time dashboard.", ogTemplate: "default", inSitemap: true },
  "/why-liberty-bancard": { title: "Why Liberty Bancard", description: "Statement-based pricing, real human support, no junk fees. The reasons 5,000+ merchants trust Liberty Bancard with their processing.", ogTemplate: "default", inSitemap: true },
  "/shop": { title: "POS Terminals & Equipment", description: "Clover, Dejavoo, PAX, and Valor terminals plus virtual terminal access. Buy outright — no leases, no junk fees.", ogTemplate: "default", inSitemap: true },
  "/case-studies": { title: "Customer Case Studies", description: "Real merchants who reduced processing costs and modernized payment acceptance with Liberty Bancard. Numbers and quotes included.", ogTemplate: "default", inSitemap: true },
  "/testimonials": { title: "Merchant Testimonials & Reviews", description: "What 5,000+ merchants say about Liberty Bancard's pricing, support, and onboarding. Verified reviews across industries.", ogTemplate: "default", inSitemap: true },
  "/testimonials/submit": { title: "Submit a Testimonial", description: "Share your Liberty Bancard experience. Submissions help fellow business owners decide on the right processor.", ogTemplate: "default", inSitemap: true },
  "/integrations": { title: "POS & Software Integrations", description: "Liberty Bancard integrates with leading POS systems, gateways, and accounting tools. See the full integration catalog.", ogTemplate: "default", inSitemap: true },
  "/compare/square": { title: "Liberty Bancard vs Square", description: "Side-by-side: Square's flat 2.6% + $0.10 vs Liberty Bancard's interchange-plus pricing. Most merchants save $1,800–$4,200/yr.", ogTemplate: "compare", inSitemap: true },
  "/compare/stripe": { title: "Liberty Bancard vs Stripe", description: "Stripe charges 2.9% + $0.30 online. Compare against Liberty Bancard's interchange-plus pricing for typical $3,000–$5,400/yr savings.", ogTemplate: "compare", inSitemap: true },
  "/compare/clover": { title: "Liberty Bancard vs Clover", description: "Liberty Bancard supports Clover hardware while delivering interchange-plus pricing — without locking you into Clover's processor.", ogTemplate: "compare", inSitemap: true },
  "/compare/toast": { title: "Liberty Bancard vs Toast", description: "Toast bundles POS and processing. Compare Liberty Bancard's flexible processing with restaurant-grade reporting and lower fees.", ogTemplate: "compare", inSitemap: true },
  "/compare/paypal": { title: "Liberty Bancard vs PayPal", description: "PayPal's flat-rate model overpays on cards with low interchange. See how interchange-plus pricing wins for most merchants.", ogTemplate: "compare", inSitemap: true },
  "/merchant-application": { title: "Merchant Account Application", description: "Apply for a Liberty Bancard merchant account. Most applications approved within 24-48 hours. E-signature included.", ogTemplate: "service", inSitemap: true },
  "/partners": { title: "ISO & Partner Program", description: "Earn residual income referring merchants to Liberty Bancard. Built for ISOs, CPAs, bookkeepers, and trusted advisors.", ogTemplate: "default", inSitemap: true },
  "/help": { title: "Help Center & Knowledge Base", description: "Find answers on account setup, billing, terminals, compliance, and more. Searchable knowledge base for Liberty Bancard merchants.", ogTemplate: "default", inSitemap: true },
  "/sales-tools": { title: "Sales Tools Hub", description: "Internal sales tools and collateral hub.", noindex: true },
  // Auth — noindex
  "/login": { title: "Sign In", description: "Sign in to your Liberty Bancard dashboard.", noindex: true },
  "/signup": { title: "Create Account", description: "Create a Liberty Bancard account.", noindex: true },
  "/forgot-password": { title: "Reset Your Password", description: "Reset your Liberty Bancard password.", noindex: true },
  "/reset-password": { title: "Set a New Password", description: "Set a new password for your Liberty Bancard account.", noindex: true },
  "/verify-email": { title: "Verify Your Email", description: "Verify your Liberty Bancard email address.", noindex: true },
  // Thank-you — noindex
  "/thanks-statement": { title: "Statement Received", description: "We received your statement and will follow up shortly.", noindex: true },
  "/thanks-estimate": { title: "Estimate Received", description: "We received your estimate request and will follow up shortly.", noindex: true },
  "/thanks-call": { title: "Call Request Received", description: "We received your callback request and will reach out shortly.", noindex: true },
  "/thanks-support": { title: "Support Request Received", description: "We received your support request and will respond shortly.", noindex: true },
  "/thanks/application": { title: "Application Received", description: "We received your merchant application. Next steps inside.", noindex: true },
  // Compliance / legal
  "/privacy-policy": { title: "Privacy Policy", description: "How Liberty Bancard collects, uses, and protects merchant and visitor data.", inSitemap: true },
  "/terms": { title: "Terms of Service", description: "Terms governing use of Liberty Bancard's website, apps, and processing services.", inSitemap: true },
  "/cookie-policy": { title: "Cookie Policy", description: "What cookies and similar technologies we use, and how to manage them.", inSitemap: true },
  "/advertising-disclosure": { title: "Advertising Disclosure", description: "How Liberty Bancard discloses advertising relationships and affiliate compensation.", inSitemap: true },
  "/accessibility": { title: "Accessibility Statement", description: "Liberty Bancard's commitment to digital accessibility and how to request accommodations.", inSitemap: true },
  "/sms-terms": { title: "SMS Messaging Terms", description: "Terms governing SMS notifications from Liberty Bancard, including opt-out instructions.", inSitemap: true },
  "/esign-consent": { title: "E-Signature Consent", description: "Your consent to receive and sign documents electronically with Liberty Bancard.", inSitemap: true },
  "/surcharging-disclosure": { title: "Surcharging Disclosure", description: "How Liberty Bancard's surcharging programs comply with card brand and state rules.", inSitemap: true },
  "/merchant-policies": { title: "Merchant Policies", description: "Liberty Bancard merchant operating policies, prohibited businesses, and risk guidelines.", inSitemap: true },
  "/regulatory-notices": { title: "Regulatory Notices", description: "Required regulatory disclosures for Liberty Bancard merchants and visitors.", inSitemap: true },
  "/security-compliance": { title: "Security & Compliance", description: "PCI DSS compliance, encryption, tokenization, and security practices at Liberty Bancard.", inSitemap: true },
  "/do-not-sell": { title: "Do Not Sell My Information", description: "Opt out of the sale or sharing of your personal information under California privacy laws.", inSitemap: true },
  "/data-processing-agreement": { title: "Data Processing Agreement", description: "Liberty Bancard's data processing agreement for merchants and partners.", inSitemap: true },
  "/responsible-ai": { title: "Responsible AI Commitments", description: "How Liberty Bancard uses AI responsibly across sales, support, and compliance workflows.", inSitemap: true },
  "/testimonials-disclosure": { title: "Testimonials Disclosure", description: "How Liberty Bancard collects and presents merchant testimonials and reviews.", inSitemap: true },
  "/law-enforcement": { title: "Law Enforcement Guidelines", description: "Process for law enforcement requests for Liberty Bancard merchant or user records.", inSitemap: true },
  "/dispute-resolution": { title: "Dispute Resolution", description: "How disputes between Liberty Bancard and merchants or users are resolved.", inSitemap: true },
  "/data-retention": { title: "Data Retention Policy", description: "How long Liberty Bancard retains merchant, visitor, and processing data.", inSitemap: true },
  "/tcpa-consent": { title: "TCPA Consent Notice", description: "TCPA consent terms governing automated calls and texts from Liberty Bancard.", inSitemap: true },
  "/refund-policy": { title: "Refund Policy", description: "Refund eligibility for Liberty Bancard subscription, equipment, and services.", inSitemap: true },
  "/california-privacy": { title: "California Privacy Rights", description: "Liberty Bancard's CCPA/CPRA disclosures for California consumers.", inSitemap: true },
  "/ada-compliance": { title: "ADA & WCAG Compliance", description: "Liberty Bancard's ADA compliance commitment and accommodation request process.", inSitemap: true },
};

export const PUBLIC_ROUTE_PATHS = Object.keys(SEO_ROUTE_DEFAULTS);
