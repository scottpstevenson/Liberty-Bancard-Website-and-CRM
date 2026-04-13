import fs from "fs";
import path from "path";

const BASE_URL = "https://libertybancard.com";

let LOGO_WHITE_B64 = "";
let LOGO_BLUE_B64 = "";

let CLIENT_ASSET_TAGS = "";

function resolveClientAssetTags(): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    try {
      const builtIndex = path.resolve(__dirname, "public", "index.html");
      if (fs.existsSync(builtIndex)) {
        const html = fs.readFileSync(builtIndex, "utf-8");
        const scriptMatches = html.match(/<script[^>]+src="\/assets\/[^"]+\.js"[^>]*><\/script>/g) || [];
        const linkMatches = html.match(/<link[^>]+href="\/assets\/[^"]+\.css"[^>]*>/g) || [];
        return [...linkMatches, ...scriptMatches].join("\n  ");
      }
    } catch {
      // fallback below
    }
    return `<script type="module" src="/assets/index.js"></script>`;
  }
  return `<script type="module" src="/@vite/client"></script>
  <script type="module">
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="/src/main.tsx"></script>`;
}

try {
  CLIENT_ASSET_TAGS = resolveClientAssetTags();
} catch {
  CLIENT_ASSET_TAGS = `<script type="module" src="/src/main.tsx"></script>`;
}

try {
  const logoWhitePath = path.resolve("./attached_assets/logo-white.png");
  if (fs.existsSync(logoWhitePath)) {
    LOGO_WHITE_B64 = fs.readFileSync(logoWhitePath).toString("base64");
  }
} catch {
  // logo not critical
}

try {
  const logoBluePath = path.resolve("./attached_assets/logo-blue.png");
  if (fs.existsSync(logoBluePath)) {
    LOGO_BLUE_B64 = fs.readFileSync(logoBluePath).toString("base64");
  }
} catch {
  // logo not critical
}

export { LOGO_WHITE_B64, LOGO_BLUE_B64 };

interface SsrShellOptions {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  ogType?: string;
  keywords?: string;
  schemaJsons?: object[];
  body: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function ssrHtmlShell({
  title,
  description,
  canonical,
  ogImage,
  ogType = "website",
  keywords,
  schemaJsons,
  body,
}: SsrShellOptions): string {
  const fullCanonical = `${BASE_URL}${canonical}`;
  const ogImageUrl = ogImage || `${BASE_URL}/favicon.png`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  const schemaBlocks = (schemaJsons || [])
    .map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
  <meta name="theme-color" content="#1e3a5f" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  ${keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}" />` : ""}
  <link rel="canonical" href="${fullCanonical}" />
  <link rel="icon" type="image/png" href="/favicon.png" />

  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${fullCanonical}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:site_name" content="Liberty Bancard" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${ogImageUrl}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&display=swap" rel="stylesheet" />

  ${schemaBlocks}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    body { font-family: 'DM Sans', system-ui, sans-serif; background: #ffffff; color: #0f172a; line-height: 1.6; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; height: auto; }
    .font-display { font-family: 'Outfit', system-ui, sans-serif; }

    /* Layout */
    .container { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .container { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .container { padding: 0 2rem; } }

    /* Navbar */
    .ssr-navbar { position: relative; z-index: 50; }
    .ssr-mainbar { background: #fff; border-bottom: 1px solid #e2e8f0; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-mainbar-inner { max-width: 1280px; margin: 0 auto; padding: 0 1rem; display: flex; justify-content: space-between; align-items: center; height: 4rem; }
    @media (min-width: 640px) { .ssr-mainbar-inner { padding: 0 1.5rem; } }
    .ssr-logo { display: flex; align-items: center; }
    .ssr-logo img { height: 2.25rem; width: auto; }
    .ssr-nav-links { display: none; }
    @media (min-width: 768px) { .ssr-nav-links { display: flex; align-items: center; gap: 1.5rem; font-size: 0.875rem; font-weight: 500; color: #334155; } }
    .ssr-nav-links a:hover { color: #1e3a5f; }
    .ssr-nav-phone { display: none; font-size: 0.875rem; color: #64748b; }
    @media (min-width: 768px) { .ssr-nav-phone { display: flex; align-items: center; gap: 0.375rem; } }
    .ssr-nav-phone:hover { color: #1e3a5f; }
    .ssr-cta-btn { display: inline-flex; align-items: center; gap: 0.5rem; background: #1e3a5f; color: #fff; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; white-space: nowrap; }
    .ssr-cta-btn:hover { background: #1a3254; }

    /* Footer */
    .ssr-footer { background: #1e3a5f; color: #fff; padding-top: 4rem; padding-bottom: 2rem; }
    .ssr-footer-grid { max-width: 1280px; margin: 0 auto; padding: 0 1rem; display: grid; grid-template-columns: 1fr; gap: 3rem; margin-bottom: 3rem; }
    @media (min-width: 640px) { .ssr-footer-grid { padding: 0 1.5rem; } }
    @media (min-width: 768px) { .ssr-footer-grid { grid-template-columns: 1fr 1fr; } }
    @media (min-width: 1024px) { .ssr-footer-grid { grid-template-columns: 1fr 1fr 1fr 1fr; padding: 0 2rem; } }
    .ssr-footer-logo { height: 2.5rem; width: auto; margin-bottom: 1rem; }
    .ssr-footer h4 { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.75rem; color: #fff; }
    .ssr-footer ul { list-style: none; }
    .ssr-footer li { margin-bottom: 0.5rem; }
    .ssr-footer a { font-size: 0.875rem; color: rgba(255,255,255,0.6); }
    .ssr-footer a:hover { color: #fff; }
    .ssr-footer-bottom { max-width: 1280px; margin: 0 auto; padding: 1.5rem 1rem 0; border-top: 1px solid rgba(255,255,255,0.1); }
    @media (min-width: 640px) { .ssr-footer-bottom { padding: 1.5rem 1.5rem 0; } }
    @media (min-width: 1024px) { .ssr-footer-bottom { padding: 1.5rem 2rem 0; } }
    .ssr-footer-disclaimer { font-size: 0.6875rem; color: rgba(255,255,255,0.35); line-height: 1.5; margin-bottom: 0.75rem; }
    .ssr-footer-copy { font-size: 0.875rem; color: rgba(255,255,255,0.5); }
    .ssr-footer-trust { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1.5rem; padding-bottom: 1.5rem; }
    .ssr-footer-trust-badge { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: rgba(255,255,255,0.5); }

    /* Hero */
    .ssr-hero { position: relative; overflow: hidden; background: linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 40%, #1e3a8a 100%); color: #fff; padding: 5rem 0; }
    .ssr-hero-inner { position: relative; z-index: 1; max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .ssr-hero-inner { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-hero-inner { padding: 0 2rem; } }
    .ssr-hero h1 { font-family: 'Outfit', system-ui, sans-serif; font-size: 2rem; font-weight: 800; line-height: 1.2; margin-bottom: 1.25rem; max-width: 48rem; }
    @media (min-width: 768px) { .ssr-hero h1 { font-size: 2.75rem; } }
    @media (min-width: 1024px) { .ssr-hero h1 { font-size: 3.25rem; } }
    .ssr-hero-subtitle { font-size: 1.125rem; color: rgba(255,255,255,0.75); max-width: 40rem; margin-bottom: 2rem; line-height: 1.7; }
    .ssr-hero-badge { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.85); font-size: 0.875rem; font-weight: 500; padding: 0.375rem 0.75rem; border-radius: 0.375rem; margin-bottom: 1.25rem; border: 1px solid rgba(255,255,255,0.1); }
    .ssr-hero-buttons { display: flex; flex-wrap: wrap; gap: 1rem; }
    .ssr-btn-primary { display: inline-flex; align-items: center; gap: 0.5rem; background: #0ea5e9; color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; }
    .ssr-btn-primary:hover { background: #0284c7; }
    .ssr-btn-outline { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.05); color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.2); }
    .ssr-btn-outline:hover { background: rgba(255,255,255,0.1); }
    .ssr-btn-dark { display: inline-flex; align-items: center; gap: 0.5rem; background: #1e3a5f; color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; }
    .ssr-btn-dark:hover { background: #1a3254; }

    /* Sections */
    .ssr-section { padding: 4rem 0; }
    .ssr-section-muted { background: #f8fafc; }
    .ssr-section-dark { background: linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 40%, #1e3a8a 100%); color: #fff; }
    .ssr-section-inner { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .ssr-section-inner { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-section-inner { padding: 0 2rem; } }
    .ssr-section-heading { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; text-align: center; }
    @media (min-width: 768px) { .ssr-section-heading { font-size: 2rem; } }
    .ssr-section-subheading { color: #64748b; text-align: center; max-width: 40rem; margin: 0 auto 2.5rem; }
    .ssr-section-dark .ssr-section-subheading { color: rgba(255,255,255,0.7); }

    /* Cards */
    .ssr-grid-3 { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 768px) { .ssr-grid-3 { grid-template-columns: repeat(3, 1fr); } }
    .ssr-grid-2 { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 768px) { .ssr-grid-2 { grid-template-columns: repeat(2, 1fr); } }
    .ssr-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.5rem; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-stat-value { font-family: 'Outfit', system-ui, sans-serif; font-size: 2rem; font-weight: 700; color: #1e3a5f; margin-bottom: 0.25rem; }
    .ssr-stat-label { font-size: 0.875rem; color: #64748b; }
    .ssr-card-title { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; color: #0f172a; }
    .ssr-card-text { font-size: 0.875rem; color: #64748b; line-height: 1.6; }

    /* Pain/Solution items */
    .ssr-pain-item { display: flex; gap: 1rem; }
    .ssr-pain-icon { width: 2.5rem; height: 2.5rem; border-radius: 0.5rem; background: #fef3c7; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #d97706; font-size: 1rem; }
    .ssr-solution-icon { width: 2.5rem; height: 2.5rem; border-radius: 0.5rem; background: #d1fae5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #059669; font-size: 1rem; }
    .ssr-item-title { font-weight: 600; margin-bottom: 0.25rem; color: #0f172a; font-size: 0.9375rem; }
    .ssr-item-text { font-size: 0.875rem; color: #64748b; line-height: 1.6; }

    /* FAQ Accordion */
    .ssr-faq-item { border: 1px solid #e2e8f0; border-radius: 0.5rem; margin-bottom: 0.5rem; padding: 1.25rem 1.5rem; }
    .ssr-faq-q { font-weight: 600; font-size: 0.9375rem; color: #0f172a; margin-bottom: 0.625rem; }
    .ssr-faq-a { font-size: 0.875rem; color: #475569; line-height: 1.7; }
    .ssr-faq-wrapper { max-width: 48rem; margin: 0 auto; }

    /* Table */
    .ssr-table-wrapper { overflow-x: auto; }
    .ssr-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .ssr-table th { background: #f1f5f9; text-align: left; padding: 0.75rem 1rem; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
    .ssr-table td { padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; color: #334155; vertical-align: middle; }
    .ssr-table tr:hover td { background: #f8fafc; }
    .ssr-check-green { color: #10b981; margin-right: 0.375rem; }
    .ssr-check-amber { color: #f59e0b; margin-right: 0.375rem; }

    /* Check list */
    .ssr-check-list { list-style: none; }
    .ssr-check-list li { display: flex; align-items: flex-start; gap: 0.625rem; margin-bottom: 0.625rem; font-size: 0.9375rem; color: #334155; }
    .ssr-check-list .check-icon { color: #10b981; flex-shrink: 0; margin-top: 0.125rem; }
    .ssr-x-list li { display: flex; align-items: flex-start; gap: 0.625rem; margin-bottom: 0.625rem; font-size: 0.9375rem; color: #334155; }
    .ssr-x-list .x-icon { color: #ef4444; flex-shrink: 0; margin-top: 0.125rem; }

    /* Breadcrumb */
    .ssr-breadcrumb { font-size: 0.8125rem; color: rgba(255,255,255,0.6); margin-bottom: 0.75rem; }
    .ssr-breadcrumb a { color: rgba(255,255,255,0.6); }
    .ssr-breadcrumb a:hover { color: #fff; }
    .ssr-breadcrumb span { margin: 0 0.375rem; }

    /* CTA section */
    .ssr-cta-section { text-align: center; }
    .ssr-cta-section h2 { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.75rem; font-weight: 700; color: #fff; margin-bottom: 1rem; }
    .ssr-cta-section p { color: rgba(255,255,255,0.7); max-width: 36rem; margin: 0 auto 2rem; }
    .ssr-cta-buttons { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }

    /* Crosslinks */
    .ssr-crosslinks { display: flex; flex-wrap: wrap; gap: 0.625rem; justify-content: center; }
    .ssr-crosslink-btn { display: inline-flex; align-items: center; gap: 0.375rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.5rem 1rem; font-size: 0.875rem; color: #334155; background: #fff; }
    .ssr-crosslink-btn:hover { background: #f8fafc; border-color: #cbd5e1; }

    /* Savings comparison */
    .ssr-savings-grid { display: grid; grid-template-columns: 1fr; gap: 1rem; max-width: 48rem; margin: 0 auto; }
    @media (min-width: 640px) { .ssr-savings-grid { grid-template-columns: repeat(3, 1fr); } }
    .ssr-savings-card { background: #fff; border: 2px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem; text-align: center; }
    .ssr-savings-card.liberty { border-color: #1e3a5f; }
    .ssr-savings-card.winner { border-color: #10b981; background: #f0fdf4; }
    .ssr-savings-label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 0.5rem; }
    .ssr-savings-label.liberty { color: #1e3a5f; }
    .ssr-savings-label.winner { color: #059669; }
    .ssr-savings-value { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.625rem; font-weight: 700; color: #0f172a; }
    .ssr-savings-value.liberty { color: #1e3a5f; }
    .ssr-savings-value.winner { font-size: 2rem; color: #059669; }
    .ssr-savings-sub { font-size: 0.75rem; color: #94a3b8; margin-top: 0.375rem; }
  </style>
</head>
<body>
  <div id="root">
    ${ssrNavbar()}
    <main>
      ${body}
    </main>
    ${ssrFooter()}
  </div>
  ${CLIENT_ASSET_TAGS}
</body>
</html>`;
}

export function ssrNavbar(): string {
  const logoSrc = LOGO_BLUE_B64
    ? `data:image/png;base64,${LOGO_BLUE_B64}`
    : "/favicon.png";
  return `<header class="ssr-navbar">
  <div class="ssr-mainbar">
    <div class="ssr-mainbar-inner">
      <a href="/" class="ssr-logo">
        <img src="${logoSrc}" alt="Liberty Bancard" />
      </a>
      <nav class="ssr-nav-links">
        <a href="/">Home</a>
        <a href="/upload-statement">Solutions</a>
        <a href="/industries/restaurant-payment-processing">Industries</a>
        <a href="/blog">Resources</a>
        <a href="/about-contact">About</a>
      </nav>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <a href="tel:9542668214" class="ssr-nav-phone">📞 954-266-8214</a>
        <a href="/upload-statement" class="ssr-cta-btn">
          Upload Statement
        </a>
      </div>
    </div>
  </div>
</header>`;
}

export function ssrFooter(): string {
  const logoSrc = LOGO_WHITE_B64
    ? `data:image/png;base64,${LOGO_WHITE_B64}`
    : "/favicon.png";
  const year = new Date().getFullYear();
  return `<footer class="ssr-footer">
  <div class="ssr-footer-grid">
    <div>
      <a href="/"><img src="${logoSrc}" alt="Liberty Bancard" class="ssr-footer-logo" /></a>
      <p style="font-size:0.875rem;color:rgba(255,255,255,0.6);margin-bottom:1.25rem;line-height:1.6;">We don't sell a rate. We prove your real cost and fix it.</p>
      <h4>Contact</h4>
      <ul>
        <li><a href="tel:9542668214">📞 Call/Text 954-266-8214</a></li>
        <li><a href="mailto:support@libertybancard.com">✉ support@libertybancard.com</a></li>
        <li><a href="/get-started">📅 Book 10-Minute Call</a></li>
      </ul>
    </div>
    <div>
      <h4>Quick Links</h4>
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/get-started">Get Started</a></li>
        <li><a href="/upload-statement">Upload Statement</a></li>
        <li><a href="/about-contact">About &amp; Contact</a></li>
        <li><a href="/support">Support</a></li>
        <li><a href="/help">Help Center</a></li>
        <li><a href="/merchant-application">Merchant Application</a></li>
        <li><a href="/affiliate">Affiliate Program</a></li>
      </ul>
    </div>
    <div>
      <h4>Industries</h4>
      <ul>
        <li><a href="/industries/restaurant-payment-processing">Restaurant</a></li>
        <li><a href="/industries/retail-payment-processing">Retail</a></li>
        <li><a href="/industries/healthcare-payment-processing">Healthcare</a></li>
        <li><a href="/industries/salon-spa-payment-processing">Salon &amp; Spa</a></li>
        <li><a href="/industries/auto-repair-payment-processing">Auto Repair</a></li>
        <li><a href="/industries/professional-services-payment-processing">Professional Services</a></li>
        <li><a href="/industries/ecommerce-payment-processing">E-Commerce</a></li>
        <li><a href="/industries/construction-payment-processing">Construction</a></li>
      </ul>
    </div>
    <div>
      <h4>Compare &amp; Solutions</h4>
      <ul>
        <li><a href="/0-percent-processing">0% Processing Programs</a></li>
        <li><a href="/beat-square-stripe">Beat Square &amp; Stripe</a></li>
        <li><a href="/compare-rates">Compare Rates</a></li>
        <li><a href="/compare/square">vs Square</a></li>
        <li><a href="/compare/stripe">vs Stripe</a></li>
        <li><a href="/compare/clover">vs Clover</a></li>
        <li><a href="/compare/toast">vs Toast</a></li>
        <li><a href="/compare/paypal">vs PayPal</a></li>
        <li><a href="/savings-calculator">Savings Calculator</a></li>
        <li><a href="/free-analysis">Free Analysis</a></li>
      </ul>
      <h4 style="margin-top:1.5rem;">Legal</h4>
      <ul>
        <li><a href="/privacy-policy">Privacy Policy</a></li>
        <li><a href="/terms">Terms of Service</a></li>
        <li><a href="/advertising-disclosure">Advertising Disclosure</a></li>
        <li><a href="/do-not-sell">Do Not Sell My Info</a></li>
      </ul>
    </div>
  </div>
  <div class="ssr-footer-bottom">
    <div class="ssr-footer-trust">
      <div class="ssr-footer-trust-badge">✅ PCI DSS Compliant</div>
      <div class="ssr-footer-trust-badge">🏅 Registered ISO/MSP</div>
      <div class="ssr-footer-trust-badge">Visa | Mastercard | Discover | Amex</div>
    </div>
    <p class="ssr-footer-disclaimer">Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. Liberty Bancard is not a bank. All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor.</p>
    <p class="ssr-footer-disclaimer">Disclosures: Pricing, program eligibility, funding speed, and equipment offers vary by merchant profile and are subject to underwriting approval. "Next-day funding" options may be available for qualified merchants and depend on cutoff times, bank schedules, and risk review. "0% processing" refers to compliant cash discount or surcharging programs where permitted; applicability depends on state law, card brand rules, and your business model. "Free terminal" placement requires an approved and active processing account, is subject to minimum processing requirements and contract term, and equipment remains the property of Liberty Bancard. Early termination fees may apply.</p>
    <p class="ssr-footer-disclaimer">Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review. Contract terms, early termination fees, and equipment return requirements are specified in the Merchant Processing Agreement.</p>
    <p class="ssr-footer-copy">&copy; ${year} Liberty Bancard. All rights reserved. &nbsp;<a href="/do-not-sell" style="color:rgba(255,255,255,0.5);text-decoration:underline;">Do Not Sell or Share My Personal Information</a></p>
  </div>
</footer>`;
}
