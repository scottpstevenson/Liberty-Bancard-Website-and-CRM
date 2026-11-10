import fs from "fs";
import path from "path";
import { serializeJsonLd } from "../shared/json-ld";
import { PUBLIC_FOOTER_GROUPS, PUBLIC_FOOTER_ISO_DISCLOSURE, PUBLIC_FOOTER_TAGLINE } from "../shared/public-footer-links";
import { PUBLIC_CONTACT_CHANNELS } from "../shared/public-contact-content";
import { PUBLIC_NAV_CTA, PUBLIC_NAV_GROUPS, PUBLIC_NAV_UTILITIES } from "../shared/public-navigation";
import { FOOTER_COMPLIANCE, FOOTER_DISCLAIMER } from "../shared/public-disclosures";

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
  // SECURITY: DEVELOPMENT_ONLY_INLINE_SCRIPT — this is the React Refresh
  // preamble emitted only by the development SSR shell. Production resolves
  // hashed external assets and never emits this block.
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

/**
 * Font faces for static pages that never hydrate (the glossary). The same self-hosted, same-origin files the app
 * stylesheet declares (index.css and styles/crm-theme.css) are declared here so a page without the client bundle
 * paints its display headings and body copy in the public faces instead of a system fallback. No script, no
 * external host, no CSP change; hydrating pages keep getting their faces from the app stylesheet only.
 */
const STATIC_PAGE_FONT_FACES = `
    @font-face { font-family: 'Source Serif 4'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/fonts/source-serif-4-latin-wght.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/ibm-plex-sans-400.ttf') format('truetype'); }
    @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/ibm-plex-sans-500.ttf') format('truetype'); }
    @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/ibm-plex-sans-600.ttf') format('truetype'); }
    @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/ibm-plex-sans-700.ttf') format('truetype'); }`;

try {
  const logoWhitePath = path.resolve("./client/src/assets/logo-white-420.png");
  if (fs.existsSync(logoWhitePath)) {
    LOGO_WHITE_B64 = fs.readFileSync(logoWhitePath).toString("base64");
  }
} catch {
  // logo not critical
}

try {
  const logoBluePath = path.resolve("./client/src/assets/logo-blue-420.png");
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
  /**
   * Whether the React app loads over this document and replaces it. Default true. Static documents with
   * no matching client route (the glossary) pass false so the shared header, footer and stylesheet stay
   * on screen instead of being replaced by the app's not-found page.
   */
  hydrate?: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Navigation bar and footer rules shared by every server-rendered public document: the standard shell
 * below and the standalone comparison documents in ssr/competitor-ssr.ts. Both emit ssrNavbar() and
 * ssrFooter(), so both must carry these rules; without them the logo renders at its intrinsic size.
 */
export const SSR_CHROME_CSS = `
    /* Navbar: 56px on phones (logo + menu), 64px from 768px. Groups come from shared/public-navigation.ts. */
    .ssr-navbar { position: relative; z-index: 50; }
    .ssr-mainbar { background: #fff; border-bottom: 1px solid #e2e8f0; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-mainbar-inner { max-width: 1280px; margin: 0 auto; padding: 0 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; height: 3.5rem; }
    @media (min-width: 640px) { .ssr-mainbar-inner { padding: 0 1.5rem; } }
    @media (min-width: 768px) { .ssr-mainbar-inner { height: 4rem; } }
    .ssr-logo { display: flex; align-items: center; min-height: 2.75rem; flex-shrink: 0; }
    .ssr-logo img { height: 1.75rem; width: auto; max-width: 200px; }
    @media (min-width: 768px) { .ssr-logo img { height: 2.25rem; max-width: none; } }
    .ssr-nav-links { display: none; }
    @media (min-width: 1280px) { .ssr-nav-links { display: flex; align-items: center; gap: 1.5rem; font-size: 0.875rem; font-weight: 500; color: #334155; } }
    .ssr-nav-links a { display: inline-flex; align-items: center; min-height: 2.75rem; }
    .ssr-nav-links a:hover, .ssr-nav-utilities a:hover { color: #071D57; }
    .ssr-nav-actions { display: flex; align-items: center; gap: 0.5rem; }
    @media (min-width: 640px) { .ssr-nav-actions { gap: 1rem; } }
    .ssr-nav-utilities { display: none; align-items: center; gap: 1rem; }
    .ssr-nav-utilities a { display: inline-flex; align-items: center; min-height: 2.75rem; font-size: 0.8125rem; font-weight: 500; color: #334155; white-space: nowrap; }
    @media (min-width: 1280px) { .ssr-nav-utilities { display: flex; } }
    .ssr-cta-btn { display: none; align-items: center; gap: 0.5rem; background: #071D57; color: #fff; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; white-space: nowrap; min-height: 2.5rem; }
    @media (min-width: 400px) { .ssr-cta-btn { display: inline-flex; } }
    .ssr-cta-btn:hover { background: #0c2a7a; }
    .ssr-menu { display: block; }
    @media (min-width: 1280px) { .ssr-menu { display: none; } }
    .ssr-menu > summary { display: flex; align-items: center; justify-content: center; min-width: 3rem; padding: 0 0.75rem; height: 2.75rem; border-radius: 0.5rem; cursor: pointer; list-style: none; color: #071D57; font-size: 0.8125rem; font-weight: 600; }
    .ssr-menu > summary::-webkit-details-marker { display: none; }
    .ssr-menu[open] > summary { background: #f4f6fa; }
    .ssr-menu-panel { position: absolute; left: 0; right: 0; top: 100%; background: #fff; border-bottom: 1px solid #e2e8f0; box-shadow: 0 12px 24px -12px rgba(7,29,87,0.25); max-height: calc(100vh - 3.5rem); overflow-y: auto; padding: 0.5rem 1rem 1rem; }
    .ssr-menu-group { margin: 0.5rem 0 0; padding: 0.5rem 0.75rem 0; font-size: 0.8125rem; font-weight: 700; color: #071D57; text-transform: uppercase; letter-spacing: 0.06em; }
    .ssr-menu-panel ul { list-style: none; margin: 0; padding: 0; }
    .ssr-menu-panel li a { display: flex; align-items: center; min-height: 2.75rem; padding: 0.5rem 0.75rem; font-size: 0.9375rem; color: #334155; }
    .ssr-menu-panel li a:hover { color: #071D57; background: #f4f6fa; }
    .ssr-menu-panel .ssr-menu-offer a { border: 1px solid #e2e8f0; background: #f4f6fa; border-radius: 0.5rem; margin: 0.25rem 0.75rem 0; font-weight: 600; }
    .ssr-menu-panel .ssr-menu-cta { display: flex; justify-content: center; margin-top: 1rem; min-height: 3rem; font-size: 1rem; }

    /* Footer: brand + five link groups, then a Legal row. Groups are <details open> (everything visible and crawlable without
       JavaScript); a small same-origin script (/ssr-shell.js) collapses them below 1024px. */
    .ssr-footer { background: #071D57; border-top: 3px solid #C8102E; color: #fff; padding-top: 2.5rem; padding-bottom: 2rem; }
    .ssr-footer-grid, .ssr-footer-legal { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    .ssr-footer-grid { display: grid; grid-template-columns: 1fr; gap: 0; margin-bottom: 0; }
    .ssr-footer-legal { margin-bottom: 2rem; }
    @media (min-width: 640px) { .ssr-footer-grid, .ssr-footer-legal { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-footer-grid { grid-template-columns: 1.2fr repeat(5, minmax(0, 1fr)); padding: 0 2rem; gap: 2rem; margin-bottom: 2rem; } .ssr-footer-legal { padding: 1.5rem 2rem 0; margin-bottom: 3rem; border-top: 1px solid rgba(255,255,255,0.12); } .ssr-footer { padding-top: 4rem; } }
    .ssr-footer-brand { padding-bottom: 1.5rem; }
    @media (min-width: 1024px) { .ssr-footer-brand { padding-bottom: 0; } }
    .ssr-footer-logo { height: 2.5rem; width: auto; margin-bottom: 1rem; }
    .ssr-footer-tagline { font-size: 0.875rem; color: rgba(255,255,255,0.8); margin-bottom: 1.25rem; line-height: 1.6; }
    .ssr-footer h4 { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
    .ssr-footer ul { list-style: none; }
    .ssr-footer li { margin-bottom: 0; }
    .ssr-footer a { display: inline-flex; align-items: center; min-height: 2.75rem; font-size: 0.875rem; color: rgba(255,255,255,0.8); }
    .ssr-footer a:hover { color: #fff; }
    .ssr-footer-group { border-top: 1px solid rgba(255,255,255,0.12); }
    .ssr-footer-group summary { display: flex; align-items: center; justify-content: space-between; min-height: 3rem; font-size: 1rem; font-weight: 600; color: #fff; cursor: pointer; list-style: none; }
    .ssr-footer-group summary::-webkit-details-marker { display: none; }
    .ssr-footer-group summary::after { content: "+"; font-size: 1.25rem; line-height: 1; }
    .ssr-footer-group[open] summary::after { content: "\\2212"; }
    .ssr-footer-group ul { padding-bottom: 0.75rem; }
    .ssr-footer-group .ssr-footer-viewall a { font-weight: 600; color: #fff; text-decoration: underline; text-underline-offset: 3px; }
    @media (min-width: 1024px) {
      .ssr-footer-legal .ssr-footer-group ul { columns: 4; column-gap: 2rem; }
      .ssr-footer-legal .ssr-footer-group li { break-inside: avoid; }
      .ssr-footer-group { border-top: 0; }
      .ssr-footer-group summary { min-height: 0; margin-bottom: 1rem; font-size: 1.125rem; pointer-events: none; cursor: default; }
      .ssr-footer-group summary::after { content: none; }
      .ssr-footer-group ul { padding-bottom: 0; }
      .ssr-footer a { min-height: 0; padding: 0.25rem 0; }
    }
    .ssr-footer-bottom { max-width: 1280px; margin: 0 auto; padding: 1.5rem 1rem 0; border-top: 1px solid rgba(255,255,255,0.1); }
    @media (min-width: 640px) { .ssr-footer-bottom { padding: 1.5rem 1.5rem 0; } }
    @media (min-width: 1024px) { .ssr-footer-bottom { padding: 1.5rem 2rem 0; } }
    .ssr-footer-disclaimer { font-size: 0.75rem; color: rgba(255,255,255,0.72); line-height: 1.5; margin-bottom: 0.75rem; }
    .ssr-footer-copy { font-size: 0.875rem; color: rgba(255,255,255,0.72); }
    .ssr-footer-trust { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1.5rem; padding-bottom: 1.5rem; }
    .ssr-footer-trust-badge { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: rgba(255,255,255,0.72); }
`;

export function ssrHtmlShell({
  title,
  description,
  canonical,
  ogImage,
  ogType = "website",
  keywords,
  schemaJsons,
  body,
  hydrate = true,
}: SsrShellOptions): string {
  const fullCanonical = `${BASE_URL}${canonical}`;
  // Derive a per-page OG image: callers pass an explicit URL, or we generate
  // a programmatic card from the /og/:template/:slug.png route.  Falling back
  // to favicon would produce a low-quality social preview, so we always emit
  // a real card URL.
  const slugFromCanonical = canonical.replace(/^\//, "").replace(/\//g, "-") || "home";
  const ogImageUrl = ogImage || `${BASE_URL}/og/default/${encodeURIComponent(slugFromCanonical)}.png`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  const schemaBlocks = (schemaJsons || [])
    .map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`)
    .join("\n    ");

  const gscVerify = process.env.GSC_VERIFICATION || "";
  const bingVerify = process.env.BING_VERIFICATION || "";
  const verificationMeta = [
    gscVerify ? `<meta name="google-site-verification" content="${escapeHtml(gscVerify)}" />` : "",
    bingVerify ? `<meta name="msvalidate.01" content="${escapeHtml(bingVerify)}" />` : "",
  ]
    .filter(Boolean)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#071D57" />
  <meta name="robots" content="index, follow" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  ${keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}" />` : ""}
  <link rel="canonical" href="${fullCanonical}" />
  <link rel="alternate" hreflang="en-US" href="${fullCanonical}" />
  <link rel="alternate" hreflang="x-default" href="${fullCanonical}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  ${verificationMeta}

  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${fullCanonical}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Liberty Bancard" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${ogImageUrl}" />

  <!-- Public font recipe (shared with the hydrated app): IBM Plex Sans body faces and the Source Serif 4
       display face are self-hosted; their @font-face rules ship in the app stylesheet. Only the display
       face is preloaded because it is the above-the-fold heading face. -->
  <link rel="preload" href="/fonts/source-serif-4-latin-wght.woff2" as="font" type="font/woff2" crossorigin="" />
  <!-- GHL Chat Widget (Trust Center / SMS opt-in compliance) -->
  <script src="https://widgets.leadconnectorhq.com/loader.js" data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js" data-widget-id="6a652f1fc4dda61f3fbae5f8" data-source="WEB_USER"></script>

  ${schemaBlocks}
   <style data-ssr-fallback-styles>
     /* Fallback CSS remains in the document after React replaces #root.
        Keep it below the app's layers: unlayered resets override Tailwind v4
        utilities regardless of selector specificity or stylesheet order. */
     @layer ssr-fallback, theme, base, components, utilities;
     @layer ssr-fallback {
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    body { font-family: 'IBM Plex Sans', system-ui, sans-serif; background: #ffffff; color: #0f172a; line-height: 1.6; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; height: auto; }
    .font-display { font-family: 'IBM Plex Sans', system-ui, sans-serif; }

    /* Layout */
    .container { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .container { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .container { padding: 0 2rem; } }

    ${SSR_CHROME_CSS}

    /* Hero */
    .ssr-hero { position: relative; overflow: hidden; background: linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 40%, #1e3a8a 100%); color: #fff; padding: 5rem 0; }
    .ssr-hero-inner { position: relative; z-index: 1; max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .ssr-hero-inner { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-hero-inner { padding: 0 2rem; } }
    .ssr-hero h1 { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 2rem; font-weight: 700; line-height: 1.2; margin-bottom: 1.25rem; max-width: 48rem; }
    @media (min-width: 768px) { .ssr-hero h1 { font-size: 2.75rem; } }
    @media (min-width: 1024px) { .ssr-hero h1 { font-size: 3.25rem; } }
    .ssr-hero-subtitle { font-size: 1.125rem; color: rgba(255,255,255,0.75); max-width: 40rem; margin-bottom: 2rem; line-height: 1.7; }
    .ssr-hero-badge { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.85); font-size: 0.875rem; font-weight: 500; padding: 0.375rem 0.75rem; border-radius: 0.375rem; margin-bottom: 1.25rem; border: 1px solid rgba(255,255,255,0.1); }
    .ssr-hero-buttons { display: flex; flex-wrap: wrap; gap: 1rem; }
    .ssr-btn-primary { display: inline-flex; align-items: center; gap: 0.5rem; background: #0ea5e9; color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; }
    .ssr-btn-primary:hover { background: #0284c7; }
    .ssr-btn-outline { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.05); color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.2); }
    .ssr-btn-outline:hover { background: rgba(255,255,255,0.1); }
    .ssr-btn-dark { display: inline-flex; align-items: center; gap: 0.5rem; background: #071D57; color: #fff; padding: 0.75rem 1.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; }
    .ssr-btn-dark:hover { background: #1a3254; }

    /* Light hero (Home and overview pages): matches the hydrated hero, which sits on the page background */
    .ssr-hero--light { background: #fff; color: #0f172a; padding: 2.5rem 0 3rem; border-bottom: 1px solid #e2e8f0; }
    @media (min-width: 1024px) { .ssr-hero--light { padding: 4rem 0; } }
    .ssr-hero--light h1 { font-size: 2rem; max-width: 20ch; }
    @media (min-width: 768px) { .ssr-hero--light h1 { font-size: 2.75rem; } }
    @media (min-width: 1024px) { .ssr-hero--light h1 { font-size: 3.5rem; } }
    .ssr-hero--light .ssr-hero-badge { background: none; border: 0; padding: 0; border-radius: 0; color: #071D57; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .ssr-hero--light .ssr-hero-subtitle { color: #475569; }
    .ssr-hero--light .ssr-btn-outline { background: #fff; color: #071D57; border-color: #cbd5e1; }
    .ssr-hero--light .ssr-btn-outline:hover { background: #f4f6fa; }
    .ssr-hero--light .ssr-breadcrumb, .ssr-hero--light .ssr-breadcrumb a { color: #475569; }
    .ssr-hero-note { margin-top: 1rem; max-width: 28rem; font-size: 0.75rem; color: #475569; }

    /* Sections */
    .ssr-section { padding: 4rem 0; }
    .ssr-section-muted { background: #f8fafc; }
    .ssr-section-dark { background: linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 40%, #1e3a8a 100%); color: #fff; }
    .ssr-section-inner { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 640px) { .ssr-section-inner { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-section-inner { padding: 0 2rem; } }
    .ssr-section-heading { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; text-align: center; }
    @media (min-width: 768px) { .ssr-section-heading { font-size: 2rem; } }
    .ssr-section-subheading { color: #64748b; text-align: center; max-width: 40rem; margin: 0 auto 2.5rem; }
    .ssr-section-dark .ssr-section-subheading { color: rgba(255,255,255,0.7); }

    /* Cards */
    .ssr-grid-3 { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 768px) { .ssr-grid-3 { grid-template-columns: repeat(3, 1fr); } }
    .ssr-grid-2 { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 768px) { .ssr-grid-2 { grid-template-columns: repeat(2, 1fr); } }
    .ssr-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.5rem; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-stat-value { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 2rem; font-weight: 700; color: #071D57; margin-bottom: 0.25rem; }
    .ssr-stat-label { font-size: 0.875rem; color: #64748b; }
    .ssr-card-title { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; color: #0f172a; }
    .ssr-card-text { font-size: 0.875rem; color: #64748b; line-height: 1.6; }

    /* Glossary (hub and term pages): static documents that use the shared header, footer and tokens */
    .ssr-gl { max-width: 860px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    @media (min-width: 640px) { .ssr-gl { padding: 2rem 1.5rem 5rem; } }
    .ssr-gl-crumbs { max-width: 1280px; margin: 0 auto; padding: 0.75rem 1rem; font-size: 0.8125rem; color: #475569; }
    .ssr-gl-crumbs a { color: #071D57; text-decoration: underline; text-underline-offset: 3px; }
    .ssr-gl-badge { display: inline-block; margin-bottom: 0.75rem; padding: 0.25rem 0.75rem; border-radius: 9999px; background: #F4F6FA; color: #071D57; font-size: 0.8125rem; font-weight: 600; }
    .ssr-gl h1 { font-size: clamp(1.625rem, 4vw, 2.25rem); font-weight: 700; line-height: 1.2; color: #0f172a; margin-bottom: 1rem; }
    .ssr-gl h2 { font-size: 1.375rem; font-weight: 700; color: #0f172a; margin: 2.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }
    .ssr-gl p { color: #334155; line-height: 1.75; margin-bottom: 1rem; }
    .ssr-gl-shortdef { font-size: 1.125rem; color: #475569; background: #F4F6FA; border-left: 4px solid #071D57; padding: 1rem 1.25rem; border-radius: 0 0.5rem 0.5rem 0; margin-bottom: 2rem; }
    .ssr-gl-example { background: #F4F6FA; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1.25rem; margin: 1rem 0 2rem; }
    .ssr-gl-example pre { white-space: pre-wrap; font-family: inherit; font-size: 0.875rem; color: #334155; line-height: 1.7; }
    .ssr-gl-faq { border-bottom: 1px solid #e2e8f0; padding: 1.25rem 0; }
    .ssr-gl-faq h3 { font-size: 1.0625rem; font-weight: 600; color: #0f172a; margin-bottom: 0.5rem; }
    .ssr-gl-faq p { margin: 0; color: #475569; }
    .ssr-gl-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 2.5rem; }
    .ssr-gl-chip { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0.25rem 1rem; border-radius: 9999px; background: #F4F6FA; color: #071D57; font-size: 0.875rem; font-weight: 500; }
    .ssr-gl-cta { background: #071D57; color: #fff; border-radius: 0.75rem; padding: 2rem; margin: 3rem 0; }
    .ssr-gl-cta h2 { color: #fff; border-color: rgba(255,255,255,0.25); margin-top: 0; }
    .ssr-gl-cta p { color: rgba(255,255,255,0.92); }
    .ssr-gl-cta-links { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
    .ssr-gl-cta-links a { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0.5rem 1.25rem; border-radius: 0.5rem; background: #fff; color: #071D57; font-weight: 600; font-size: 0.9375rem; }
    .ssr-gl-note { margin-top: 2.5rem; padding: 1.5rem; background: #F4F6FA; border-radius: 0.5rem; }
    .ssr-gl-note p { margin: 0; font-size: 0.875rem; color: #475569; }
    .ssr-gl-note a, .ssr-gl-lead a { color: #071D57; text-decoration: underline; text-underline-offset: 3px; }
    .ssr-gl-count { margin-bottom: 1.5rem; font-size: 0.875rem; color: #475569; }
    .ssr-gl-category { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .ssr-gl-category h2 { margin: 0 0 1rem; font-size: 1.1875rem; }
    .ssr-gl-term { display: block; padding: 0.75rem 0; border-bottom: 1px solid #F4F6FA; }
    .ssr-gl-term strong { display: block; font-size: 0.9375rem; color: #0f172a; }
    .ssr-gl-term span { display: block; margin-top: 0.1875rem; font-size: 0.8125rem; color: #475569; }
    .ssr-gl-term:hover strong { color: #071D57; text-decoration: underline; }

    /* Home and overview building blocks */
    .ssr-card-link { display: block; text-decoration: none; border-top: 3px solid #071D57; }
    .ssr-card-cta { margin-top: 0.75rem; font-size: 0.875rem; font-weight: 600; color: #071D57; text-decoration: underline; text-underline-offset: 3px; }
    .ssr-card-accent { border-top: 3px solid #071D57; }
    .ssr-card-action { margin: 1rem 0 0.75rem; }
    .ssr-center-link { margin-top: 1.5rem; text-align: center; font-weight: 600; }
    .ssr-center-link a { text-decoration: underline; text-underline-offset: 3px; color: #071D57; }
    .ssr-founder { max-width: 48rem; border-left: 4px solid #C8102E; padding-left: 1.25rem; }
    .ssr-left { text-align: left; margin-left: 0; margin-right: 0; }
    .ssr-steps { list-style: none; display: grid; gap: 1rem; }
    .ssr-steps li { display: flex; gap: 1rem; align-items: flex-start; }
    .ssr-step-num { flex: 0 0 auto; width: 2.5rem; height: 2.5rem; border-radius: 9999px; background: #071D57; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
    /* W-D media: shared frame, Home hero, five industry cards, payment contexts and the statement-anatomy card */
    .ssr-frame { position: relative; overflow: hidden; border-radius: 1rem; background-color: #f6f1e9; }
    .ssr-frame picture { position: absolute; inset: 0; display: block; }
    .ssr-frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .ssr-hero--home .ssr-hero-inner { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    .ssr-hero--home h1 { max-width: 20ch; }
    .ssr-h1-first { color: #071D57; }
    .ssr-h1-second { color: #1650b5; }
    .ssr-hero--home .ssr-hero-subtitle { margin-bottom: 1.5rem; }
    .ssr-hero--home .ssr-hero-buttons { flex-direction: column; gap: 0.75rem; max-width: 28rem; }
    .ssr-hero--home .ssr-hero-buttons a { justify-content: center; width: 100%; }
    .ssr-hero-media .ssr-frame { aspect-ratio: 4 / 3; max-width: 36rem; margin: 0 auto; }
    .ssr-md-only { display: none; }
    @media (min-width: 768px) { .ssr-md-only { display: block; } }
    .ssr-hero-helper { margin-top: 1rem; font-size: 0.875rem; font-weight: 600; color: #0f172a; }
    .ssr-hero-qual { margin-top: 0.25rem; max-width: 28rem; font-size: 0.75rem; color: #475569; }
    @media (min-width: 1024px) {
      .ssr-hero--home { padding: 3.5rem 0; }
      .ssr-hero--home .ssr-hero-inner { grid-template-columns: 1fr 1fr; align-items: center; column-gap: 3.5rem; }
      .ssr-hero--home h1 { max-width: 16ch; }
      .ssr-hero--home .ssr-hero-buttons { flex-direction: row; max-width: none; }
      .ssr-hero--home .ssr-hero-buttons a { width: auto; }
      .ssr-hero-media .ssr-frame { aspect-ratio: 3 / 2; max-width: none; }
    }
    .ssr-ind-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; list-style: none; margin: 0; padding: 0; }
    .ssr-ind-card { display: flex; align-items: center; gap: 0.75rem; height: 100%; padding: 0.5rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; overflow: hidden; text-decoration: none; color: inherit; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-ind-card .ssr-frame { flex: 0 0 6rem; width: 6rem; aspect-ratio: 4 / 3; border-radius: 0.5rem; }
    .ssr-ind-card-body { min-width: 0; flex: 1; }
    .ssr-note { margin-top: 0.5rem; font-size: 0.75rem; color: #475569; }
    @media (min-width: 768px) {
      .ssr-ind-grid { grid-template-columns: repeat(6, 1fr); gap: 1.25rem; }
      .ssr-ind-grid li { grid-column: span 2; }
      .ssr-ind-grid li:nth-child(n+4) { grid-column: span 3; }
      .ssr-ind-card { flex-direction: column; align-items: stretch; gap: 0; padding: 0; }
      .ssr-ind-card .ssr-frame { flex: none; width: 100%; aspect-ratio: 16 / 10; border-radius: 0; }
      .ssr-ind-card-body { padding: 1rem; }
    }
    @media (min-width: 1024px) {
      .ssr-ind-grid { grid-template-columns: repeat(5, 1fr); }
      .ssr-ind-grid li, .ssr-ind-grid li:nth-child(n+4) { grid-column: span 1; }
      .ssr-ind-card .ssr-frame { aspect-ratio: 4 / 3; }
    }
    .ssr-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .ssr-industry-visual { margin-top: 2rem; max-width: 24rem; }
    .ssr-industry-visual .ssr-frame { aspect-ratio: 16 / 10; }
    .ssr-industry-visual-caption { margin-top: 0.5rem; font-size: 0.75rem; color: rgba(255,255,255,0.75); }
    @media (min-width: 1024px) { .ssr-industry-visual .ssr-frame { aspect-ratio: 4 / 3; } }
    .ssr-overview-split { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    .ssr-overview-media { margin: 0; }
    .ssr-overview-media .ssr-frame { aspect-ratio: 3 / 2; }
    @media (min-width: 1024px) { .ssr-overview-split { grid-template-columns: minmax(0, 1fr) 440px; gap: 2.5rem; align-items: start; } }
    .ssr-contexts { margin-top: 2.5rem; }
    .ssr-contexts .ssr-eyebrow { margin-bottom: 0.5rem; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #071D57; }
    .ssr-contexts h3 { font-size: 1.25rem; line-height: 1.75rem; font-weight: 700; color: #0f172a; }
    .ssr-ctx-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; list-style: none; margin: 1rem 0 0; padding: 0; }
    .ssr-ctx-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); }
    .ssr-ctx-visual { display: flex; align-items: center; justify-content: center; flex: 0 0 6rem; width: 6rem; height: 9rem; border-radius: 0.5rem; background: rgba(244,246,250,0.8); }
    .ssr-ctx-visual svg { display: block; width: 6rem; height: 9rem; }
    .ssr-ctx-term { width: 5rem; }
    .ssr-ctx-term picture, .ssr-ctx-term img { display: block; width: 100%; height: auto; }
    .ssr-ctx-body { min-width: 0; }
    @media (min-width: 768px) {
      .ssr-ctx-grid { grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
      .ssr-ctx-card { flex-direction: column; align-items: flex-start; gap: 0.75rem; padding: 1.25rem; }
      .ssr-ctx-visual { flex: none; width: 100%; }
    }
    .ssr-ws-head { padding: 1rem 1rem 0; }
    .ssr-ws-eyebrow { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #071D57; }
    .ssr-ws-head h3 { margin-top: 0.25rem; font-size: 1.25rem; line-height: 1.75rem; font-weight: 700; color: #0f172a; }
    .ssr-ws-head p { margin-top: 0.25rem; font-size: 0.875rem; color: #475569; }
    .ssr-ws-doc { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 1rem; padding: 0.75rem 1rem; background: #071D57; color: #fff; }
    .ssr-ws-doc strong { display: block; font-size: 0.875rem; letter-spacing: 0.02em; }
    .ssr-ws-doc small { display: block; font-size: 0.6875rem; color: rgba(255,255,255,0.75); }
    .ssr-ws-stamp { flex: 0 0 auto; padding: 0.125rem 0.5rem; border-radius: 0.25rem; background: #fff; color: #071D57; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .ssr-ws-num { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 9999px; background: #071D57; color: #fff; font-size: 0.75rem; font-weight: 700; }
    .ssr-ws-body { min-width: 0; flex: 1; }
    .ssr-ws-foot { padding: 0 1rem 0.75rem; font-size: 0.875rem; font-weight: 600; color: #0f172a; }
    .ssr-worksheet { padding: 0; overflow: hidden; }
    .ssr-worksheet dl { padding: 0 1rem; }
    .ssr-worksheet-row { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.75rem 0; border-bottom: 1px solid #e2e8f0; }
    .ssr-worksheet-row:last-child { border-bottom: 0; }
    .ssr-worksheet dt { font-size: 0.875rem; font-weight: 600; color: #0f172a; }
    .ssr-worksheet dd { font-size: 0.75rem; color: #475569; }
    .ssr-worksheet figcaption { border-top: 1px solid #e2e8f0; background: #f8fafc; padding: 0.75rem 1rem; font-size: 0.75rem; color: #475569; }
    .ssr-final-eyebrow { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.85); margin: 0 auto 0.5rem; }
    .ssr-final-channels { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.25rem 1.5rem; margin: 1.5rem 0 0; }
    .ssr-final-channels a { display: inline-flex; align-items: center; min-height: 2.75rem; color: #fff; text-decoration: underline; text-underline-offset: 3px; }
    .ssr-cta-section .ssr-final-note { max-width: 36rem; margin: 1rem auto 0; font-size: 0.75rem; color: rgba(255,255,255,0.8); }
    .ssr-overview-lead { font-size: 1.125rem; color: #475569; max-width: 40rem; line-height: 1.7; }
    .ssr-badge { display: inline-block; margin-bottom: 0.5rem; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #071D57; }
    .ssr-points { list-style: disc; margin: 0.75rem 0 0 1.25rem; font-size: 0.875rem; color: #475569; }
    .ssr-section-footnote { margin: 1.5rem auto 0; max-width: 48rem; font-size: 0.75rem; color: #475569; }
    .ssr-inline-link { margin-top: 0.75rem; font-size: 0.875rem; font-weight: 600; }
    .ssr-inline-link a { color: #071D57; text-decoration: underline; text-underline-offset: 3px; }
    .ssr-contact-channels { list-style: none; display: grid; gap: 0.5rem; margin-top: 1rem; }
    .ssr-contact-channels a { display: inline-flex; align-items: center; min-height: 2.75rem; color: #071D57; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }

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
    .ssr-cta-section h2 { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 1.75rem; font-weight: 700; color: #fff; margin-bottom: 1rem; }
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
    .ssr-savings-card.liberty { border-color: #071D57; }
    .ssr-savings-card.winner { border-color: #10b981; background: #f0fdf4; }
    .ssr-savings-label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 0.5rem; }
    .ssr-savings-label.liberty { color: #071D57; }
    .ssr-savings-label.winner { color: #059669; }
    .ssr-savings-value { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 1.625rem; font-weight: 700; color: #0f172a; }
    .ssr-savings-value.liberty { color: #071D57; }
    .ssr-savings-value.winner { font-size: 2rem; color: #059669; }
     .ssr-savings-sub { font-size: 0.75rem; color: #94a3b8; margin-top: 0.375rem; }
     }
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
  ${hydrate ? CLIENT_ASSET_TAGS : `<style data-ssr-static-fonts>${STATIC_PAGE_FONT_FACES}
  </style>`}
</body>
</html>`;
}

export function ssrNavbar(): string {
  const logoSrc = LOGO_BLUE_B64
    ? `data:image/png;base64,${LOGO_BLUE_B64}`
    : "/favicon.png";
  const topLevel = PUBLIC_NAV_GROUPS.map((g) => `        <a href="${escapeHtml(g.href)}">${escapeHtml(g.label)}</a>`).join("\n");
  const menuGroups = PUBLIC_NAV_GROUPS.map((g) => {
    const links = g.links.map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`);
    if (g.offer?.current) links.push(`<li class="ssr-menu-offer"><a href="${escapeHtml(g.offer.href)}">${escapeHtml(g.offer.label)}</a></li>`);
    return `        <p class="ssr-menu-group">${escapeHtml(g.label)}</p>
        <ul>${links.join("")}</ul>`;
  }).join("\n");
  const utilityLinks = PUBLIC_NAV_UTILITIES.map((u) => `<a href="${escapeHtml(u.href)}">${escapeHtml(u.label)}</a>`).join("");
  const utilityItems = PUBLIC_NAV_UTILITIES.map((u) => `<li><a href="${escapeHtml(u.href)}">${escapeHtml(u.label)}</a></li>`).join("");
  return `<header class="ssr-navbar">
  <div class="ssr-mainbar">
    <div class="ssr-mainbar-inner">
      <a href="/" class="ssr-logo">
        <img src="${logoSrc}" alt="Liberty Bancard" width="135" height="28" />
      </a>
      <nav class="ssr-nav-links" aria-label="Main">
${topLevel}
      </nav>
      <div class="ssr-nav-actions">
        <div class="ssr-nav-utilities">${utilityLinks}</div>
        <a href="${escapeHtml(PUBLIC_NAV_CTA.href)}" class="ssr-cta-btn">${escapeHtml(PUBLIC_NAV_CTA.label)}</a>
        <details class="ssr-menu">
          <summary aria-label="Open menu">Menu</summary>
          <div class="ssr-menu-panel">
${menuGroups}
            <p class="ssr-menu-group">Support and sign in</p>
            <ul>${utilityItems}</ul>
            <p class="ssr-menu-group">Contact</p>
            <ul><li><a href="${escapeHtml(PUBLIC_CONTACT_CHANNELS.phone.href)}">${escapeHtml(PUBLIC_CONTACT_CHANNELS.phone.label)}</a></li><li><a href="${escapeHtml(PUBLIC_CONTACT_CHANNELS.email.href)}">${escapeHtml(PUBLIC_CONTACT_CHANNELS.email.label)}</a></li></ul>
            <a href="${escapeHtml(PUBLIC_NAV_CTA.href)}" class="ssr-cta-btn ssr-menu-cta">${escapeHtml(PUBLIC_NAV_CTA.label)}</a>
          </div>
        </details>
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
  // Same groups as the React footer (shared/public-footer-links.ts). Groups are <details open>, so every link is
  // visible and crawlable without JavaScript; /ssr-shell.js (same origin, so no CSP change) collapses them
  // below 1024px. Legal is a full-width row after the grid.
  const renderGroup = (group: (typeof PUBLIC_FOOTER_GROUPS)[number]): string => {
    const items = group.links.map((link) => `        <li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`);
    if (group.viewAll) items.push(`        <li class="ssr-footer-viewall"><a href="${escapeHtml(group.viewAll.href)}">${escapeHtml(group.viewAll.label)}</a></li>`);
    return `    <details class="ssr-footer-group" data-footer-group="${group.id}" open>
      <summary>${escapeHtml(group.label)}</summary>
      <ul>
${items.join("\n")}
      </ul>
    </details>`;
  };
  const mainGroups = PUBLIC_FOOTER_GROUPS.filter((g) => g.id !== "legal").map(renderGroup).join("\n");
  const legalGroup = PUBLIC_FOOTER_GROUPS.filter((g) => g.id === "legal").map(renderGroup).join("\n");
  return `<footer class="ssr-footer">
  <div class="ssr-footer-grid">
    <div class="ssr-footer-brand">
      <a href="/"><img src="${logoSrc}" alt="Liberty Bancard" class="ssr-footer-logo" width="193" height="40" /></a>
      <p class="ssr-footer-tagline">${escapeHtml(PUBLIC_FOOTER_TAGLINE)}</p>
      <h4>Contact</h4>
      <ul>
        <li><a href="${escapeHtml(PUBLIC_CONTACT_CHANNELS.phone.href)}">${escapeHtml(PUBLIC_CONTACT_CHANNELS.phone.label)}</a></li>
        <li><a href="${escapeHtml(PUBLIC_CONTACT_CHANNELS.email.href)}">${escapeHtml(PUBLIC_CONTACT_CHANNELS.email.label)}</a></li>
        <li><a href="${escapeHtml(PUBLIC_CONTACT_CHANNELS.booking.href)}">${escapeHtml(PUBLIC_CONTACT_CHANNELS.booking.label)}</a></li>
      </ul>
    </div>
${mainGroups}
  </div>
  <div class="ssr-footer-legal">
${legalGroup}
  </div>
  <div class="ssr-footer-bottom">
    <p class="ssr-footer-disclaimer">${escapeHtml(PUBLIC_FOOTER_ISO_DISCLOSURE)}</p>
    <p class="ssr-footer-disclaimer">${FOOTER_DISCLAIMER}</p>
    <p class="ssr-footer-disclaimer">${FOOTER_COMPLIANCE}</p>
    <p class="ssr-footer-copy">&copy; ${year} Liberty Bancard. All rights reserved. &nbsp;<a href="/do-not-sell" style="color:rgba(255,255,255,0.72);text-decoration:underline;">Do Not Sell or Share My Personal Information</a></p>
  </div>
</footer>
<script src="/ssr-shell.js" defer></script>`;
}
