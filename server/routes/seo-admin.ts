import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../replit_integrations/auth";

interface SeoCoverageRow {
  path: string;
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  hasOgImage: boolean;
  hasJsonLd: boolean;
  inSitemap: boolean;
  noindex: boolean;
  ogTemplate: string;
  internalLinks: number; // count of <a href="/..."> internal links in rendered HTML
  warnings: string[];
}

const PUBLIC_ROUTE_DEFAULTS: Record<
  string,
  { title: string; description: string; noindex?: boolean; ogTemplate?: string; inSitemap?: boolean }
> = {
  "/": { title: "Merchant Payment Processing", description: "Transparent, statement-based credit card processing. Upload your statement for a free, line-by-line analysis from Liberty Bancard.", inSitemap: true },
  "/get-started": { title: "Get Started With Liberty Bancard", description: "Start your merchant account application or get a free processing review. Three quick paths: upload, calculate, or talk to a human.", inSitemap: true },
  "/upload-statement": { title: "Upload Your Processing Statement", description: "Upload your current processing statement and get a free, line-by-line breakdown. Keep the analysis even if you don't switch.", inSitemap: true },
  "/free-analysis": { title: "Free Merchant Statement Analysis", description: "Get a no-cost line-by-line breakdown of your processing statement. See your true effective rate and where money is leaking.", inSitemap: true },
  "/0-percent-processing": { title: "Zero-Percent Processing Programs", description: "Cash discount and dual pricing programs that reduce your effective processing cost to near-zero. Compliant in all 50 states.", inSitemap: true },
  "/beat-square-stripe": { title: "Pay Less Than Square or Stripe", description: "Square and Stripe charge flat rates that overpay on most cards. See how interchange-plus pricing typically saves $1,800–$6,100/yr.", inSitemap: true },
  "/about-contact": { title: "About Liberty Bancard & Contact", description: "Liberty Bancard is a transparent payment processing partner serving 5,000+ merchants. Talk to a real human in South Florida.", inSitemap: true },
  "/estimate": { title: "Quick Processing Cost Estimate", description: "Estimate your true effective rate from your monthly volume and fees. Backed by interchange tables and live benchmarks.", inSitemap: true },
  "/support": { title: "Merchant Support & Help", description: "Real-human merchant support, 24/7 emergency response. Open a ticket or call us — most issues resolved on first contact.", inSitemap: true },
  "/savings-calculator": { title: "Payment Processing Savings Calculator", description: "Plug in your volume and current fees to see annual savings vs interchange-plus pricing. No email required to view results.", inSitemap: true },
  "/compare-rates": { title: "Compare Processing Rates Side-By-Side", description: "See Liberty Bancard's interchange-plus pricing next to Square, Stripe, Clover, Toast, and PayPal. Built from public rate cards.", inSitemap: true },
  "/blog": { title: "Payment Processing Insights", description: "Free guides on processing fees, interchange, PCI, statements, and switching processors — written for business owners.", inSitemap: true },
  "/faq": { title: "Payment Processing FAQ", description: "30+ answers on interchange-plus pricing, cash discount, PCI compliance, switching processors, equipment, and more.", inSitemap: true },
  "/affiliate": { title: "Affiliate Program", description: "Refer businesses to Liberty Bancard and earn ongoing residual commissions. Tiered payouts, transparent reporting, real-time dashboard.", inSitemap: true },
  "/why-liberty-bancard": { title: "Why Liberty Bancard", description: "Statement-based pricing, real human support, no junk fees. The reasons 5,000+ merchants trust Liberty Bancard with their processing.", inSitemap: true },
  "/equipment": { title: "POS Terminals & Equipment", description: "Clover, Dejavoo, PAX, and Valor terminals plus virtual terminal access. Buy outright — no leases, no junk fees.", inSitemap: true },
  "/case-studies": { title: "Customer Case Studies", description: "Real merchants who reduced processing costs and modernized payment acceptance with Liberty Bancard. Numbers and quotes included.", inSitemap: true },
  "/testimonials": { title: "Merchant Testimonials & Reviews", description: "What 5,000+ merchants say about Liberty Bancard's pricing, support, and onboarding. Verified reviews across industries.", inSitemap: true },
  "/testimonials/submit": { title: "Submit a Testimonial", description: "Share your Liberty Bancard experience. Submissions help fellow business owners decide on the right processor.", inSitemap: true },
  "/integrations": { title: "POS & Software Integrations", description: "Liberty Bancard integrates with leading POS systems, gateways, and accounting tools. See the full integration catalog.", inSitemap: true },
  "/compare/square": { title: "Liberty Bancard vs Square", description: "Side-by-side: Square's flat 2.6% + $0.10 vs Liberty Bancard's interchange-plus pricing. Most merchants save $1,800–$4,200/yr.", ogTemplate: "compare", inSitemap: true },
  "/compare/stripe": { title: "Liberty Bancard vs Stripe", description: "Stripe charges 2.9% + $0.30 online. Compare against Liberty Bancard's interchange-plus pricing for typical $3,000–$5,400/yr savings.", ogTemplate: "compare", inSitemap: true },
  "/compare/clover": { title: "Liberty Bancard vs Clover", description: "Liberty Bancard supports Clover hardware while delivering interchange-plus pricing — without locking you into Clover's processor.", ogTemplate: "compare", inSitemap: true },
  "/compare/toast": { title: "Liberty Bancard vs Toast", description: "Toast bundles POS and processing. Compare Liberty Bancard's flexible processing with restaurant-grade reporting and lower fees.", ogTemplate: "compare", inSitemap: true },
  "/compare/paypal": { title: "Liberty Bancard vs PayPal", description: "PayPal's flat-rate model overpays on cards with low interchange. See how interchange-plus pricing wins for most merchants.", ogTemplate: "compare", inSitemap: true },
  "/merchant-application": { title: "Merchant Account Application", description: "Apply for a Liberty Bancard merchant account. Most applications approved within 24-48 hours. E-signature included.", inSitemap: true },
  "/partners": { title: "ISO & Partner Program", description: "Earn residual income referring merchants to Liberty Bancard. Built for ISOs, CPAs, bookkeepers, and trusted advisors.", inSitemap: true },
  "/help": { title: "Help Center & Knowledge Base", description: "Find answers on account setup, billing, terminals, compliance, and more. Searchable knowledge base for Liberty Bancard merchants.", inSitemap: true },
  // Legal/compliance
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
};

function evaluateRow(
  path: string,
  def: { title: string; description: string; noindex?: boolean; ogTemplate?: string; inSitemap?: boolean }
): SeoCoverageRow {
  const warnings: string[] = [];
  const titleLength = def.title.length;
  const descriptionLength = def.description.length;

  if (titleLength < 30) warnings.push(`title too short (${titleLength}<30)`);
  if (titleLength > 65) warnings.push(`title too long (${titleLength}>65)`);
  if (descriptionLength < 100) warnings.push(`description too short (${descriptionLength}<100)`);
  if (descriptionLength > 165) warnings.push(`description too long (${descriptionLength}>165)`);

  return {
    path,
    title: def.title,
    titleLength,
    description: def.description,
    descriptionLength,
    hasOgImage: false,
    hasJsonLd: false,
    inSitemap: !!def.inSitemap,
    noindex: !!def.noindex,
    ogTemplate: def.ogTemplate || "default",
    internalLinks: 0,
    warnings,
  };
}

function requireAdminOrManager(req: Request, res: Response, next: NextFunction) {
  const role = (req.user as any)?.role;
  if (role !== "admin" && role !== "manager") {
    return res.status(403).json({ error: "Admin or manager role required" });
  }
  next();
}

const ROUTE_HTML_CHECKS_MAX = 25; // cap on real-fetch checks per request

async function probeRouteHead(baseUrl: string, path: string): Promise<{
  statusCode: number;
  hasOgImage: boolean;
  hasJsonLd: boolean;
  noindex: boolean;
  internalLinks: number;
} | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: "follow",
      headers: { "User-Agent": "LibertyBancardSeoCoverage/1.0" },
    });
    const html = await res.text();
    const robotsHeader = res.headers.get("x-robots-tag") || "";

    // Count internal links: <a href="/path"> or <a href="https://libertybancard.com/path">
    const linkMatches = html.match(/<a\s+[^>]*href=["'](?:\/[^"'#?][^"']*|https?:\/\/(?:www\.)?libertybancard\.com[^"']*)["']/gi);
    const internalLinks = linkMatches ? linkMatches.length : 0;

    return {
      statusCode: res.status,
      hasOgImage: /<meta\s+property=["']og:image["']/i.test(html),
      hasJsonLd: /<script[^>]*type=["']application\/ld\+json["']/i.test(html),
      noindex:
        /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html) ||
        /noindex/i.test(robotsHeader),
      internalLinks,
    };
  } catch {
    return null;
  }
}

export function registerSeoAdminRoutes(app: Express) {
  app.get("/api/admin/seo-coverage", isAuthenticated, requireAdminOrManager, async (req, res) => {
    try {
      const rows: SeoCoverageRow[] = Object.entries(PUBLIC_ROUTE_DEFAULTS).map(([path, def]) =>
        evaluateRow(path, def)
      );

      // Add dynamic blog posts
      try {
        const dbPosts = await storage.getGeneratedBlogPosts("published");
        for (const post of dbPosts) {
          const path = `/blog/${(post as any).slug}`;
          rows.push(
            evaluateRow(path, {
              title: ((post as any).title || "").slice(0, 60),
              description: ((post as any).excerpt || "").slice(0, 160),
              ogTemplate: "article",
              inSitemap: true,
            })
          );
        }
      } catch {
        // best effort
      }

      // Real-fetch verification on the first N rows so the dashboard reflects
      // actual rendered HTML rather than declared defaults. Bounded to avoid
      // amplifying load on the dev server.
      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
      const host = req.get("host") || `localhost:${process.env.PORT || 5000}`;
      const baseUrl = `${proto}://${host}`;
      const sampled = rows.slice(0, ROUTE_HTML_CHECKS_MAX);
      const probes = await Promise.all(
        sampled.map((r) => probeRouteHead(baseUrl, r.path))
      );
      probes.forEach((probe, i) => {
        if (!probe) return;
        const r = sampled[i];
        // Trust real signals over declared defaults.
        r.hasOgImage = probe.hasOgImage;
        r.hasJsonLd = probe.hasJsonLd;
        r.internalLinks = probe.internalLinks;
        // For declared-noindex routes, escalate if server response doesn't honor it.
        if (r.noindex && !probe.noindex) {
          r.warnings.push("declared noindex but server response lacks noindex signal");
        }
        if (probe.statusCode >= 400) {
          r.warnings.push(`HTTP ${probe.statusCode}`);
        }
        // Internal-link health: indexable pages should have >= 5 internal links
        // for crawl reachability and page-rank flow. SPA shells may report 0.
        if (!r.noindex && probe.internalLinks > 0 && probe.internalLinks < 5) {
          r.warnings.push(`only ${probe.internalLinks} internal link(s) — consider adding more`);
        }
      });

      const indexable = rows.filter((r) => !r.noindex);
      const totals = {
        total: rows.length,
        indexable: indexable.length,
        noindex: rows.length - indexable.length,
        withWarnings: rows.filter((r) => r.warnings.length > 0).length,
        inSitemap: rows.filter((r) => r.inSitemap).length,
      };

      res.json({
        env: {
          gscVerificationConfigured: !!process.env.GSC_VERIFICATION,
          bingVerificationConfigured: !!process.env.BING_VERIFICATION,
        },
        totals,
        rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to compute SEO coverage" });
    }
  });
}
