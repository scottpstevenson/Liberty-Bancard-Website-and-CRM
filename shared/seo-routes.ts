/**
 * Single source of truth for per-route SEO defaults.
 *
 * Imported by both the SPA (client/src/lib/seoDefaults.ts re-exports
 * SEO_DEFAULTS) and the server (/api/admin/seo-coverage and the
 * scripts/seo-audit.ts CI script). Keeping one map prevents drift
 * between what the admin dashboard reports and what pages actually
 * render.
 *
 * Title length target: 30-70 chars. Description target: 100-165 chars.
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
  "/": { title: "Merchant Payment Processing | Liberty Bancard", description: "Liberty Bancard offers transparent interchange-plus payment processing. Free statement review, 0% processing programs, and dedicated merchant support.", keywords: "payment processing, merchant services, credit card processing, interchange-plus pricing", ogTemplate: "default", inSitemap: true },
  "/get-started": { title: "Get Started With Liberty Bancard", description: "Start your merchant account application or get a free processing review. Three quick paths: upload, calculate, or talk to a human.", ogTemplate: "default", inSitemap: true },
  "/upload-statement": { title: "Free Merchant Statement Review | Liberty Bancard", description: "Upload your merchant processing statement for a free, no-obligation analysis. See exactly what you're paying in fees and how much you could save.", ogTemplate: "service", inSitemap: true },
  "/free-analysis": { title: "Free Payment Processing Analysis | Liberty Bancard", description: "Get a free payment processing analysis from Liberty Bancard. Identify hidden fees, compare programs, and get a personalized savings forecast. No obligation.", ogTemplate: "service", inSitemap: true },
  "/free-analysis-guaranteed": { title: "Free Merchant Statement Analysis — Guaranteed Savings or We Pay You | Liberty Bancard", description: "Upload your statement and we'll find your hidden fees, benchmark you against 3,200+ statements, and show you what you should be paying. If we can't find savings, we'll send you a $50 gift card.", keywords: "free merchant statement analysis, guaranteed savings, payment processing review, hidden fees, merchant services benchmark", ogTemplate: "service", inSitemap: true },
  "/0-percent-processing": { title: "0% Credit Card Processing | Liberty Bancard", description: "Eliminate credit card processing fees with compliant 0% programs. Cash discount and surcharging options reviewed and configured by Liberty Bancard experts.", ogTemplate: "service", inSitemap: true },
  "/beat-square-stripe": { title: "Beat Square & Stripe Pricing | Liberty Bancard", description: "Compare Liberty Bancard statement-based pricing against Square and Stripe flat-rate processing. Real numbers, no guesswork.", ogTemplate: "compare", inSitemap: true },
  "/about-contact": { title: "About Us & Contact | Liberty Bancard", description: "Learn about Liberty Bancard approach to merchant payment processing. Direct support, transparent pricing, no long-term contracts.", ogTemplate: "default", inSitemap: true },
  "/estimate": { title: "Free Effective Rate Estimate | Liberty Bancard", description: "Get a quick processing cost estimate. Provide your monthly volume and current fees for a preliminary analysis and next steps.", ogTemplate: "service", inSitemap: true },
  "/support": { title: "Contact Support | Liberty Bancard", description: "Submit a support request to Liberty Bancard. We respond within 4 hours during business hours. Emergency support available 24/7.", ogTemplate: "default", inSitemap: true },
  "/savings-calculator": { title: "Payment Processing Savings Calculator", description: "Calculate your credit card processing savings. Enter monthly volume and current rate to see estimated savings with Liberty Bancard's interchange-plus pricing.", ogTemplate: "service", inSitemap: true },
  "/compare-rates": { title: "Compare Payment Processor Rates | Liberty Bancard", description: "Compare payment processing fees and features. See how Liberty Bancard interchange-plus pricing stacks up against Square, Stripe, Clover, and Toast.", ogTemplate: "compare", inSitemap: true },
  "/blog": { title: "Payment Processing Insights | Liberty Bancard", description: "Free guides on processing fees, interchange, PCI, statements, and switching processors — written for business owners.", ogTemplate: "default", inSitemap: true },
  "/faq": { title: "Payment Processing FAQ | Liberty Bancard", description: "30+ answers on interchange-plus pricing, cash discount, PCI compliance, switching processors, equipment, and more.", ogTemplate: "default", inSitemap: true },
  "/affiliate": { title: "Affiliate Program | Liberty Bancard", description: "Refer businesses to Liberty Bancard and earn ongoing residual commissions. Tiered payouts, transparent reporting, real-time dashboard.", ogTemplate: "default", inSitemap: true },
  "/why-liberty-bancard": { title: "Why Liberty Bancard — About Us & Mission | Liberty Bancard", description: "5,000+ merchants trust Liberty Bancard. PCI Level 1 certified, registered ISO, 10+ years in payments. Transparent pricing, real support, free statement review.", ogTemplate: "default", inSitemap: true },
  "/shop": { title: "POS Terminals & Equipment | Liberty Bancard", description: "Clover, Dejavoo, PAX, and Valor terminals plus virtual terminal access. Buy outright — no leases, no junk fees, no long-term contracts.", ogTemplate: "default", inSitemap: true },
  "/case-studies": { title: "Payment Processing Case Studies | Liberty Bancard", description: "See how restaurants, retail stores, and healthcare practices saved thousands by switching to Liberty Bancard. Real numbers from real statement reviews.", ogTemplate: "default", inSitemap: true },
  "/testimonials": { title: "Merchant Video Testimonials | Real Results | Liberty Bancard", description: "Watch testimonials from restaurant owners, retailers, healthcare practices, and more who saved thousands per year switching to Liberty Bancard. Filter by industry.", ogTemplate: "default", inSitemap: true },
  "/testimonials/submit": { title: "Submit Your Merchant Testimonial | Liberty Bancard", description: "Share your Liberty Bancard success story. Tell us your savings and we will feature your testimonial to help merchants learn about transparent payment processing.", ogTemplate: "default", inSitemap: true },
  "/integrations": { title: "Software Integrations & Compatibility | Liberty Bancard", description: "Liberty Bancard works with Clover, Toast, QuickBooks, Shopify, Mindbody, Acuity, and 20+ more platforms. Keep your software, lower your processing costs.", ogTemplate: "default", inSitemap: true },
  "/compare/square": { title: "Liberty Bancard vs Square - Payment Processing Comparison", description: "Compare Liberty Bancard vs Square side by side. See how interchange-plus pricing saves businesses $2,000-$6,000/year over Square flat-rate processing fees.", ogTemplate: "compare", inSitemap: true },
  "/compare/stripe": { title: "Liberty Bancard vs Stripe - Payment Processing Comparison", description: "Compare Liberty Bancard vs Stripe side by side. See how businesses save $3,000-$8,000/year switching from Stripe 2.9% + $0.30 to interchange-plus pricing.", ogTemplate: "compare", inSitemap: true },
  "/compare/clover": { title: "Liberty Bancard vs Clover - Payment Processing Comparison", description: "Compare Liberty Bancard vs Clover POS. Avoid long-term contracts and high processing fees. See how interchange-plus pricing saves $2,500-$5,000/year.", ogTemplate: "compare", inSitemap: true },
  "/compare/toast": { title: "Liberty Bancard vs Toast - Restaurant Payment Processing Comparison", description: "Compare Liberty Bancard vs Toast for restaurant payment processing. See how restaurants save $3,000-$7,000/year by switching from Toast bundled pricing.", ogTemplate: "compare", inSitemap: true },
  "/compare/paypal": { title: "Liberty Bancard vs PayPal - Payment Processing Comparison", description: "Compare Liberty Bancard vs PayPal for business payment processing. See how merchants save $2,000-$5,000/year switching from PayPal flat-rate fees.", ogTemplate: "compare", inSitemap: true },
  "/merchant-application": { title: "Merchant Account Application | Liberty Bancard", description: "Apply for a Liberty Bancard merchant account. Most applications approved within 24-48 hours. E-signature included, no paper forms.", ogTemplate: "service", inSitemap: true },
  "/partners": { title: "ISO & Partner Program — Earn Residuals | Liberty Bancard", description: "Join the Liberty Bancard ISO and referral partner program. Earn residual income for every merchant you refer. For ISOs, CPAs, bookkeepers, and consultants.", ogTemplate: "default", inSitemap: true },
  "/help": { title: "Help Center — Payment Processing | Liberty Bancard", description: "Find answers to your payment processing questions. Browse articles on account setup, billing, terminals, compliance, and more.", ogTemplate: "default", inSitemap: true },
  "/sales-tools": { title: "Sales Tools Hub | Liberty Bancard", description: "Internal sales tools and collateral hub.", noindex: true },
  // Auth — noindex
  "/partner-login": { title: "Partner Sign In", description: "Sign in to your Liberty Bancard partner portal.", noindex: true },
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
  "/privacy-policy": { title: "Privacy Policy | Liberty Bancard", description: "How Liberty Bancard collects, uses, and protects merchant and visitor data under GDPR, CCPA, and applicable data protection laws.", inSitemap: true },
  "/terms": { title: "Terms of Service | Liberty Bancard", description: "Terms governing use of Liberty Bancard's website, apps, and payment processing services. Covers your rights, responsibilities, and acceptable use.", inSitemap: true },
  "/cookie-policy": { title: "Cookie Policy | Liberty Bancard", description: "Cookies and tracking technologies Liberty Bancard uses on our website. Learn what we collect, why, and how to manage your cookie preferences.", inSitemap: true },
  "/advertising-disclosure": { title: "Advertising & Earnings Disclosure | Liberty Bancard", description: "How Liberty Bancard discloses advertising relationships, affiliate compensation, and earnings claims. FTC-compliant disclosures on our site.", inSitemap: true },
  "/accessibility": { title: "Accessibility Statement | Liberty Bancard", description: "Liberty Bancard's commitment to digital accessibility. We follow ADA and WCAG 2.1 standards and offer accommodations for users with disabilities.", inSitemap: true },
  "/sms-terms": { title: "SMS Messaging Terms & Conditions | Liberty Bancard", description: "Terms governing SMS notifications from Liberty Bancard. Includes message frequency, opt-out instructions, and carrier data rate disclosures.", inSitemap: true },
  "/esign-consent": { title: "E-Signature Consent | Liberty Bancard", description: "Your consent to receive and electronically sign documents with Liberty Bancard under the federal E-Sign Act and applicable state laws.", inSitemap: true },
  "/surcharging-disclosure": { title: "Surcharging & Cash Discount Disclosures | Liberty", description: "How Liberty Bancard's surcharging and cash discount programs comply with card brand rules and state-by-state surcharging regulations.", inSitemap: true },
  "/merchant-policies": { title: "Merchant Policies | Liberty Bancard", description: "Liberty Bancard merchant policies including prohibited business types, acceptable use, chargeback procedures, and account risk guidelines.", inSitemap: true },
  "/regulatory-notices": { title: "Regulatory Notices | Liberty Bancard", description: "Required regulatory disclosures for Liberty Bancard merchants and website visitors, including Do Not Call and DMCA notices.", inSitemap: true },
  "/security-compliance": { title: "Security & Compliance | Liberty Bancard", description: "PCI DSS compliance, encryption, tokenization, and security practices at Liberty Bancard. AML/KYC procedures for merchant onboarding.", inSitemap: true },
  "/do-not-sell": { title: "Do Not Sell My Personal Information", description: "Opt out of the sale or sharing of your personal information under California privacy laws (CCPA/CPRA). Submit your request here.", inSitemap: true },
  "/data-processing-agreement": { title: "Data Processing Agreement (DPA) | Liberty Bancard", description: "Liberty Bancard's data processing agreement for GDPR and international data protection compliance. Covers merchant and partner data handling.", inSitemap: true },
  "/responsible-ai": { title: "Responsible AI Commitments | Liberty Bancard", description: "How Liberty Bancard uses AI responsibly across sales, support, and compliance workflows. Transparency, oversight, and fairness commitments.", inSitemap: true },
  "/testimonials-disclosure": { title: "Testimonials & Reviews Disclosure | Liberty Bancard", description: "How Liberty Bancard collects and presents merchant testimonials and reviews. FTC-compliant disclosure on endorsements and results.", inSitemap: true },
  "/law-enforcement": { title: "Law Enforcement & Subpoena Guidelines | Liberty", description: "Process for law enforcement requests for Liberty Bancard merchant or user records. Includes legal process requirements and contact procedures.", inSitemap: true },
  "/dispute-resolution": { title: "Dispute Resolution | Liberty Bancard", description: "How disputes between Liberty Bancard and merchants or users are resolved. Covers complaint procedures, timelines, and arbitration details.", inSitemap: true },
  "/data-retention": { title: "Data Retention & Deletion Policy | Liberty Bancard", description: "How long Liberty Bancard retains merchant, visitor, and processing data. Request deletion, access, correction, or portability of your data.", inSitemap: true },
  "/tcpa-consent": { title: "TCPA Consent Policy | Liberty Bancard", description: "TCPA consent terms governing automated calls and texts from Liberty Bancard. Understand your rights and how to opt out of communications.", inSitemap: true },
  "/refund-policy": { title: "Refund & Cancellation Policy | Liberty Bancard", description: "Refund eligibility for Liberty Bancard subscription, equipment, and services. Account cancellation procedures and early termination details.", inSitemap: true },
  "/california-privacy": { title: "California Privacy Rights (CCPA/CPRA) | Liberty", description: "Liberty Bancard's CCPA/CPRA disclosures for California consumers. Exercise your rights to access, delete, or opt out of data sharing.", inSitemap: true },
  "/ada-compliance": { title: "ADA & WCAG Compliance Notice | Liberty Bancard", description: "Liberty Bancard's ADA compliance commitment and accommodation request process. We follow WCAG 2.1 guidelines for digital accessibility.", inSitemap: true },
};

export const PUBLIC_ROUTE_PATHS = Object.keys(SEO_ROUTE_DEFAULTS);
